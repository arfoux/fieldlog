// Focused gaps against docs/contracts.md items 1 and 4.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKernel } from '../src/kernel.ts';
import { MemoryRelay } from '../src/sync.ts';
import { generateDeviceKey, signEvent, type DeviceKeypair } from '../src/auth.ts';
import { hashFor, type LogEvent } from '../src/log.ts';

const fast = { baseMs: 1, maxMs: 30 };

function eventFor(
  dev: DeviceKeypair,
  id: string,
  seq: number,
  value: number,
  forged = false,
): LogEvent {
  const core = {
    id, seq, type: 'entry', actor: 'origin', device_id: dev.deviceId,
    ts_device: seq, payload: { value }, prev_hash: 'GENESIS',
  };
  const hash = hashFor(core);
  const signature = forged ? 'deadbeef' : signEvent(dev.privateKeyPem, { ...core, hash });
  return { ...core, hash, signature };
}

describe('contract gaps', () => {
  it('#1 poison and forged pulls are skipped without a _quarantine row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-contract-deadletter-'));
    const dev = generateDeviceKey('origin-device');
    const trustedDevices = new Map([[dev.deviceId, dev.publicKeyPem]]);
    const good = eventFor(dev, 'good', 1, 1000);
    const poison = eventFor(dev, 'poison', 2, -1);
    const forged = eventFor(dev, 'forged', 3, 999_999, true);

    const relay = new MemoryRelay();
    await relay.push([good, poison, forged]);
    const k = await createKernel({ file: join(dir, 'ledger.db') });
    try {
      const result = await k.sync(relay, { chunkSize: 10, ...fast, trustedDevices });
      assert.equal(result.pulled, 3);
      assert.equal(result.applied, 1, 'only the valid signed event lands');
      assert.equal(result.quarantined, 0);
      const qtable = await k.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_quarantine'`,
      );
      if (qtable[0]?.n) {
        const quarantined = await k.query<{ n: number }>('SELECT COUNT(*) AS n FROM _quarantine');
        assert.equal(quarantined[0]?.n, 0);
      }
      const cursor = await k.query<{ v: string }>(`SELECT v FROM _meta WHERE k = 'sync.pull_cursor'`);
      assert.equal(cursor[0]?.v, '3', 'cursor advances past skipped poison/forgery');
    } finally {
      k.close();
    }
  });

  it('#4 first explicit device id is adopted once, then mismatches throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-contract-device-'));
    const file = join(dir, 'ledger.db');
    const auto = await createKernel({ file });
    const autoId = auto.deviceId;
    auto.close();

    const explicit = await createKernel({ file, deviceId: 'hq' });
    try {
      assert.equal(explicit.deviceId, 'hq');
      const flag = await explicit.query<{ v: string }>(`SELECT v FROM _meta WHERE k = 'device.explicit'`);
      assert.equal(flag[0]?.v, '1');
    } finally {
      explicit.close();
    }
    await assert.rejects(createKernel({ file, deviceId: 'other' }), /ERR_DEVICE_MISMATCH/);
    assert.ok(autoId.length > 0);
  });
});
