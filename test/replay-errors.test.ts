// Replay must skip intentional poison but never swallow operational failures.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLog } from '../src/log.ts';
import { openStore } from '../src/store.ts';

describe('replay error classification', () => {
  it('skips only poison events, rethrows SQLITE_BUSY-style failures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-replay-errors-'));
    const store = openStore(join(dir, 'ledger.db'));
    const log = openLog(join(dir, 'ledger.log'), 'replay-test');
    try {
      const good = log.append({ type: 'entry', payload: { value: 10 } });
      const badHash = { ...log.append({ type: 'entry', payload: { value: 11 } }), hash: '0'.repeat(64) };
      const badHash2 = { ...log.append({ type: 'entry', payload: { value: 12 } }), hash: 'f'.repeat(64) };
      assert.deepEqual(store.replay([good, badHash, badHash2]), { applied: 1, skipped: 2 });
      assert.equal(store.query<{ n: number }>('SELECT COUNT(*) AS n FROM _events')[0]?.n, 1);

      // Simulate a transient operational failure at the insert boundary.
      store.exec(
        `CREATE TRIGGER fail_replay BEFORE INSERT ON _events ` +
          `BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY simulated'); END;`,
      );
      const blocked = log.append({ type: 'entry', payload: { value: 12 } });
      assert.throws(() => store.replay([blocked]), /SQLITE_BUSY simulated/);
      // The failed event must not be counted as a skipped poison line.
      assert.equal(store.query<{ n: number }>('SELECT COUNT(*) AS n FROM _events')[0]?.n, 1);
    } finally {
      store.close();
    }
  });
});
