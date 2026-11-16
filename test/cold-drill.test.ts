// Cold-drill (adapted): rise from the primary log alone in a fresh directory.
// fieldlog has no cold tier (wave-1 fact), so the drill copies only ledger.log
// into a private temp dir and rebuilds the sqlite read-model there; no live
// database handles are ever deleted (Windows releases them asynchronously).
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKernel } from '../src/kernel.ts';

const N = 30;
const value = (i: number): number => 1000 + i;

describe('cold-drill from primary log only', () => {
  it('rebuilds identical state from a copied ledger.log in a fresh dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-cold-drill-'));
    const file = join(dir, 'ledger.db');
    const logPath = join(dir, 'ledger.log');

    const seed = await createKernel({ file, deviceId: 'cold-drill-test' });
    let expected = 0;
    try {
      for (let i = 0; i < N; i++) {
        expected += value(i);
        await seed.append({ type: 'entry', value: value(i), actor: 'cold-drill' });
      }
      assert.equal(seed.health().events, N);
      assert.equal(seed.verifyLog().ok, true);
      const before = await seed.query<{ total: number }>(
        'SELECT SUM(value) AS total FROM entries WHERE voided = 0',
      );
      assert.equal(before[0].total, expected);
    } finally {
      seed.close();
    }

    // Copy only the primary log into a fresh dir; the risen kernel creates
    // its own db there. No retries, sleeps, or handle-release guessing.
    const risenDir = mkdtempSync(join(tmpdir(), 'fieldlog-cold-drill-risen-'));
    const risenLog = join(risenDir, 'ledger.log');
    copyFileSync(logPath, risenLog);
    assert.deepEqual(readdirSync(risenDir), ['ledger.log']);
    assert.equal(
      readFileSync(risenLog, 'utf8').split('\n').filter((l) => l.trim()).length,
      N,
    );

    // Rise from the log alone: replay + verify.
    const risen = await createKernel({ file: join(risenDir, 'ledger.db'), deviceId: 'cold-drill-test' });
    try {
      assert.equal(risen.health().events, N);
      const v = risen.verifyLog();
      assert.equal(v.ok, true);
      assert.deepEqual(v.gaps ?? [], []);
      const after = await risen.query<{ total: number }>(
        'SELECT SUM(value) AS total FROM entries WHERE voided = 0',
      );
      assert.equal(after[0].total, expected);
    } finally {
      risen.close();
    }
  }, 30_000);
});
