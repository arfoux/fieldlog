// chaos-kill: real SIGKILL at three points — write, seal, sync — then
// reopen, verify, continue. No mocks: a child process dies mid-operation,
// the parent proves the durable prefix survives and work continues.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../src/kernel.ts';
import { MemoryRelay } from '../src/sync.ts';

const BUDGET = Number(process.env.FIELDLOG_CHAOS_WAIT_MS ?? 90_000);
const KERNEL = JSON.stringify(fileURLToPath(new URL('../src/kernel.ts', import.meta.url)));
const SYNC = JSON.stringify(fileURLToPath(new URL('../src/sync.ts', import.meta.url)));

async function waitFor(cond: () => boolean, ms = BUDGET): Promise<void> {
  const end = Date.now() + ms;
  // Integration poll: the milestone is a filesystem sentinel written by a
  // real killed child; fake timers cannot observe another process's writes.
  while (!cond()) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 5);
    await promise;
  }
}

function childOutput(proc: Bun.Subprocess): Promise<string> {
  return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    .then(([out, err]) => `child stdout:\n${out}\nchild stderr:\n${err}`);
}

function linesOf(logPath: string): string[] {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

function isMarkerLine(line: string): boolean {
  try {
    const o = JSON.parse(line) as { marker?: string };
    return o.marker === 'fieldlog-truncate';
  } catch {
    return false;
  }
}

/** Sum of payload.value over every durable (non-marker) log line. */
function logTotal(logPath: string): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const line of linesOf(logPath)) {
    if (isMarkerLine(line)) continue;
    sum += Number((JSON.parse(line) as { payload: { value: number } }).payload.value);
    count += 1;
  }
  return { sum, count };
}

async function dbTotal(k: { query: <T>(sql: string) => Promise<T[]> }): Promise<{ sum: number; count: number }> {
  const rows = await k.query<{ total: number; n: number }>(
    `SELECT SUM(value) AS total, COUNT(*) AS n FROM entries WHERE voided = 0`,
  );
  return { sum: rows[0].total, count: rows[0].n };
}

describe('chaos-kill', () => {
  it('kill during write: durable prefix survives, verify passes, appends continue', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-chaos-write-'));
    writeFileSync(
      join(dir, 'child.ts'),
      `import { writeFileSync } from 'node:fs';\n` +
        `import { createKernel } from ${KERNEL};\n` +
        `const k = await createKernel({ file: ${JSON.stringify(join(dir, 'ledger.db'))} });\n` +
        `for (let i = 0; i < 5000; i++) {\n` +
        `  await k.append({ type: 'entry', value: 100 + (i % 997), actor: 'device' });\n` +
        `  if (i === 59) writeFileSync(${JSON.stringify(join(dir, 'durable-60'))}, 'written');\n` +
        `}\n` +
        `k.close();\n`,
    );
    const logPath = join(dir, 'ledger.log');
    const proc = Bun.spawn(['bun', join(dir, 'child.ts')], { stdout: 'pipe', stderr: 'pipe' });
    const output = childOutput(proc);
    try {
      await waitFor(() => existsSync(join(dir, 'durable-60')));
      proc.kill('SIGKILL');
      await proc.exited;
    } catch (err) {
      throw new Error(`write case: ${String(err)}\n${await output}`, { cause: err });
    } finally {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await proc.exited.catch(() => {});
      }
    }

    const k = await createKernel({ file: join(dir, 'ledger.db') });
    try {
      const h = k.health();
      assert.ok(h.events >= 50, `expected durable prefix, got ${h.events}`);
      const v = k.verifyLog() as { ok: boolean; gaps?: number[] };
      assert.equal(v.ok, true);
      assert.deepEqual(v.gaps ?? [], []);
      // Nothing half-applied: read-model totals equal the durable log.
      const { sum, count } = logTotal(logPath);
      assert.equal(h.events, count);
      assert.deepEqual(await dbTotal(k), { sum, count });

      // Continue: the reopened kernel appends on the same chain.
      const before = h.events;
      for (let i = 0; i < 20; i++) await k.append({ type: 'entry', value: 7, actor: 'device' });
      assert.equal(k.health().events, before + 20);
      assert.equal((k.verifyLog() as { ok: boolean }).ok, true);
    } finally {
      k.close();
    }
  }, BUDGET + 30_000);

  it('kill during seal: swept prefix stays sealed, chain re-anchors on the marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-chaos-seal-'));
    writeFileSync(
      join(dir, 'child.ts'),
      `import { writeFileSync } from 'node:fs';\n` +
        `import { createKernel } from ${KERNEL};\n` +
        `import { MemoryRelay } from ${SYNC};\n` +
        `const dir = ${JSON.stringify(dir)};\n` +
        `const k = await createKernel({ file: dir + '/ledger.db' });\n` +
        `const relay = new MemoryRelay();\n` +
        `let n = 0;\n` +
        `for (let r = 0; r < 200; r++) {\n` +
        `  for (let i = 0; i < 10; i++, n++) await k.append({ type: 'entry', value: 100, actor: 'device' });\n` +
        `  await k.sync(relay, { chunkSize: 10, baseMs: 1 });\n` +
        `  await k.snapshot();\n` +
        `  await k.truncate();\n` +
        `  if (r === 0) writeFileSync(dir + '/sealed', '1');\n` +
        `}\n` +
        `k.close();\n`,
    );
    const logPath = join(dir, 'ledger.log');
    const proc = Bun.spawn(['bun', join(dir, 'child.ts')], { stdout: 'pipe', stderr: 'pipe' });
    const output = childOutput(proc);
    try {
      // Strike only after a full sync -> snapshot -> truncate cycle finished.
      await waitFor(() => existsSync(join(dir, 'sealed')));
      proc.kill('SIGKILL');
      await proc.exited;
    } catch (err) {
      throw new Error(`seal case: ${String(err)}\n${await output}`, { cause: err });
    } finally {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await proc.exited.catch(() => {});
      }
    }

    const k = await createKernel({ file: join(dir, 'ledger.db') });
    try {
      assert.ok(existsSync(join(dir, 'ledger.snapshot.db')), 'snapshot from the pre-kill seal must exist');
      const v = k.verifyLog() as { ok: boolean; gaps?: number[] };
      assert.equal(v.ok, true);
      assert.deepEqual(v.gaps ?? [], []);
      const ls = linesOf(logPath);
      assert.ok(isMarkerLine(ls[0]), 'swept log must still open with its marker');
      const marker = JSON.parse(ls[0]) as { truncated_before: number };
      const kept = ls.length - 1;
      // Swept rows stay in the read-model: count == sealed prefix + kept suffix.
      const sealed = marker.truncated_before - 1;
      assert.ok(sealed > 0, `expected a swept prefix, got sealed=${sealed}`);
      assert.deepEqual(await dbTotal(k), { sum: 100 * (sealed + kept), count: sealed + kept });

      // Continue: append, seal again, chain still verifies.
      for (let i = 0; i < 10; i++) await k.append({ type: 'entry', value: 100, actor: 'device' });
      await k.sync(new MemoryRelay(), { chunkSize: 10, baseMs: 1 });
      await k.snapshot();
      await k.truncate();
      assert.equal((k.verifyLog() as { ok: boolean }).ok, true);
    } finally {
      k.close();
    }
  }, BUDGET + 30_000);

  it('kill during sync: ack cursor resumes, re-push is exact-once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-chaos-sync-'));
    writeFileSync(
      join(dir, 'child.ts'),
      `import { createKernel } from ${KERNEL};\n` +
        `import { MemoryRelay } from ${SYNC};\n` +
        `import { writeFileSync } from 'node:fs';\n` +
        `const dir = ${JSON.stringify(dir)};\n` +
        `const k = await createKernel({ file: dir + '/ledger.db' });\n` +
        `const relay = new MemoryRelay();\n` +
        `for (let i = 0; i < 500; i++) await k.append({ type: 'entry', value: 100 + (i % 997), actor: 'device' });\n` +
        `writeFileSync(dir + '/ready', 'appended');\n` +
        `for (let r = 0; r < 30; r++) {\n` +
        `  await k.sync(relay, { chunkSize: 5, baseMs: 1 });\n` +
        `  if (k.ackSeq() > 0) writeFileSync(dir + '/acked', String(k.ackSeq()));\n` +
        `}\n` +
        `for (;;) await k.sync(relay, { chunkSize: 5, baseMs: 1 });\n`,
    );
    const proc = Bun.spawn(['bun', join(dir, 'child.ts')], { stdout: 'pipe', stderr: 'pipe' });
    const output = childOutput(proc);
    try {
      // Both milestones: all appends durable, and at least one ack written.
      await waitFor(() => existsSync(join(dir, 'ready')) && existsSync(join(dir, 'acked')));
      proc.kill('SIGKILL');
      await proc.exited;
    } catch (err) {
      throw new Error(`sync case: ${String(err)}\n${await output}`, { cause: err });
    } finally {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await proc.exited.catch(() => {});
      }
    }

    const k = await createKernel({ file: join(dir, 'ledger.db') });
    try {
      const h = k.health();
      assert.equal(h.events, 500); // every append finished before the kill window
      assert.equal((k.verifyLog() as { ok: boolean }).ok, true);
      const ackBefore = k.ackSeq();
      // Fresh relay: only the unacked suffix is pushed, UUID dedupe keeps it exact.
      const relay2 = new MemoryRelay();
      await k.sync(relay2, { chunkSize: 5, baseMs: 1 });
      assert.equal(k.ackSeq(), 500);
      assert.equal(relay2.size, 500 - ackBefore);
      const { sum, count } = logTotal(join(dir, 'ledger.log'));
      assert.deepEqual(await dbTotal(k), { sum, count });

      // Continue: new appends sync to the tip.
      for (let i = 0; i < 10; i++) await k.append({ type: 'entry', value: 3, actor: 'device' });
      await k.sync(relay2, { chunkSize: 5, baseMs: 1 });
      assert.equal(k.ackSeq(), 510);
      assert.equal(relay2.size, 510 - ackBefore);
    } finally {
      k.close();
    }
  }, BUDGET + 30_000);
});
