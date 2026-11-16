// Snapshot unlink failures must be retried/reported, never silently swallowed.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKernel } from '../src/kernel.ts';
import { openStore } from '../src/store.ts';
import { MemoryRelay } from '../src/sync.ts';
import { snapshotLockPathFor, unlinkWithRetry } from '../src/retain.ts';

function busy(): Error & { code: string } {
  return Object.assign(new Error('the process cannot access the file'), { code: 'EPERM' });
}

describe('snapshot unlink retry', () => {
  it('retries EPERM/EBUSY, accepts ENOENT, and reports exhaustion', () => {
    let attempts = 0;
    unlinkWithRetry('target.db', 'snapshot target', () => {
      attempts += 1;
      if (attempts < 3) throw busy();
    }, () => {});
    assert.equal(attempts, 3);

    attempts = 0;
    unlinkWithRetry('gone.db', 'snapshot lock', () => {
      attempts += 1;
      const err = busy();
      err.code = 'ENOENT';
      throw err;
    }, () => {});
    assert.equal(attempts, 1);

    assert.throws(
      () => unlinkWithRetry('stuck.db', 'snapshot lock', () => { throw busy(); }, () => {}),
      /cannot remove snapshot lock 'stuck\.db' after 8 attempts/,
    );
  });

  it('snapshot stamping works through the live connection and clears its lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-retain-snapshot-'));
    const file = join(dir, 'ledger.db');
    const k = await createKernel({ file });
    try {
      await k.append({ type: 'entry', value: 7, actor: 'test' });
      await k.sync(new MemoryRelay(), { baseMs: 1, maxMs: 30 });
      const snap = (await k.snapshot()).snapshot;
      assert.ok(existsSync(snap), 'snapshot file must exist');
      assert.ok(!existsSync(snapshotLockPathFor(file)), 'snapshot lock must be gone');
      const snapStore = openStore(snap);
      try {
        assert.equal(snapStore.getMeta('snapshot.sealed_seq'), '1');
      } finally {
        snapStore.close();
      }
    } finally {
      k.close();
    }
  });
});
