// A corrupt revocation sidecar must fail closed, not un-revoke every device.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WsRelayClient, WsRelayServer } from '../src/relay.ts';
import { generateDeviceKey, mintCapToken } from '../src/auth.ts';

const fast = { baseMs: 1, maxMs: 30 };

describe('revocation sidecar fail-closed', () => {
  it('rejects all operations when the sidecar is unreadable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-revoke-unreadable-'));
    const file = join(dir, 'relay.log');
    const sidecar = `${file}.revocations`;
    const dev = generateDeviceKey('device-a');
    const trustedDevices = { [dev.deviceId]: dev.publicKeyPem };

    const first = new WsRelayServer({ port: 0, file, trustedDevices });
    first.revokeDevice(dev.deviceId);
    const persisted = JSON.parse(readFileSync(sidecar, 'utf8')) as string[];
    assert.deepEqual(persisted, [dev.deviceId]);
    first.kill();

    // A truncated sidecar used to load zero tombstones and un-revoke everyone.
    writeFileSync(sidecar, '{ not json');
    const second = new WsRelayServer({ port: 0, file, trustedDevices });
    try {
      assert.throws(() => second.revokeDevice('another-device'), /revocation sidecar is unreadable/);
      const port = await second.start();
      const token = mintCapToken(dev.privateKeyPem, dev.deviceId, ['relay:push', 'relay:pull']);
      const client = new WsRelayClient(`ws://127.0.0.1:${port}`, { ...fast, capToken: token });
      try {
        await assert.rejects(client.pull(0), /revocation sidecar unreadable/);
        assert.ok(second.rejectsReceived >= 1);
      } finally {
        client.close();
      }
    } finally {
      second.kill();
    }
  }, 30_000);
});
