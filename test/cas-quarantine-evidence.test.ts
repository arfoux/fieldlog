// Re-putting a quarantined key must preserve the corrupt sidecar as evidence.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  casKeyFor,
  casPathFor,
  casQuarantinePathFor,
  openCas,
} from '../src/cas.ts';

describe('cas quarantine evidence', () => {
  it('archives the old sidecar with a reason when a quarantined key is re-put', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldlog-cas-evidence-'));
    const c = openCas(dir);
    try {
      const payload = 'forensic-original';
      const key = c.put(payload);
      assert.equal(key, casKeyFor(payload));
      writeFileSync(casPathFor(dir, key), 'corrupt');
      assert.equal(c.get(key), null);
      assert.equal(c.quarantined, 1);
      const sidecar = casQuarantinePathFor(dir, key);
      assert.equal(readFileSync(sidecar, 'utf8'), 'corrupt');

      assert.equal(c.put(payload), key);
      assert.equal(c.get(key)?.toString(), payload);
      assert.ok(!existsSync(sidecar), 'live quarantine sidecar must be retired');

      const qdir = join(dir, 'quarantine');
      const archive = readdirSync(qdir).find(
        (n) => n.startsWith(`${key}.retired-`) && !n.endsWith('.reason.json'),
      );
      const manifest = JSON.parse(readFileSync(join(dir, 'cas.json'), 'utf8')) as { quarantined: string[] };
      assert.ok(!manifest.quarantined.includes(key), 'manifest quarantine flag must be cleared');
      assert.ok(archive, `no archived sidecar in ${qdir}`);
      assert.equal(readFileSync(join(qdir, archive), 'utf8'), 'corrupt');
      const reasonPath = readdirSync(qdir).find((n) => n === `${archive}.reason.json`);
      assert.ok(reasonPath, 'retirement reason must be recorded');
      const reason = JSON.parse(readFileSync(join(qdir, reasonPath), 'utf8')) as {
        key: string;
        reason: string;
        observedHash: string;
      };
      assert.equal(reason.key, key);
      assert.equal(reason.observedHash, casKeyFor('corrupt'));
      assert.match(reason.reason, /re-put.*quarantined/);
    } finally {
      c.close();
    }
  });
});
