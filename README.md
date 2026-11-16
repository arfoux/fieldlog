<p align="center">
  <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/logo.svg" alt="fieldlog logo — event log with verification stamp" width="128">
</p>

# fieldlog — write anywhere, resolve later

Write anywhere, resolve later.

Offline-first event log for apps that keep writing through outages and
sync later: append-only log (source of truth) + SQLite read-model + sync-later.
Works for game events, file versions, telemetry samples — a ledger entry
(below) is one domain, not the whole story.

```js
import { createKernel } from 'fieldlog';

const k = await createKernel({ file: 'ledger.db' });
await k.append({ type: 'entry', value: 5000, actor: 'device-01' });
const rows = await k.query('SELECT SUM(value) AS total FROM entries WHERE voided = 0');
console.log(rows[0].total); // 5000 — RECORDED, not resolved
k.close();
```

Any event shape is stored and synced — game kills, file versions, telemetry
samples ride the same log:

```js
import { createKernel } from 'fieldlog';

const k = await createKernel({ file: 'app.db' });
await k.append({ type: 'kill', killer: 'player-1', victim: 'boss-3' });
await k.append({ type: 'version', file: 'notes.txt', rev: 3 });
await k.append({ type: 'sample', sensor: 'temp-1', celsius: 21.5 });
k.close();
```

Offline writes are stored as `DRAFT`/`RECORDED` (pre-resolved); sync/ack happens when online.
`append`/`query`/`undo` never touch the network — only `sync` does. Any event
shape is stored and synced; the read-model projects `entry` / `tally` / `undo`
into queryable tables.

## Getting started

- [quickstart](docs/quickstart.md) — 1 device offline, 2 devices syncing (dev + signed mode), runnable
- [install](docs/install.md) — Bun runtime requirement and what ships in the package
- [cli](docs/cli.md) — `serve` / `sync` / `demo`, every flag verified against `bin/fieldlog.ts`
- Two demos, one regime each, no surviving state: `bun run demo`
  (`demo/two-node.ts`, unsigned dev, fixed port 8091) vs
  `bun bin/fieldlog.ts demo` (`bin/fieldlog.ts:cmdDemo`, signed, ephemeral
  port). Either proves 20-entry totals then exits; neither graduates to
  the other (unsigned rows carry no signatures). Real ledger example:
  `example/ledger.mjs` (`bun example/ledger.mjs`)
  These commands (`bun run demo`, `bun example/ledger.mjs`, `bun run bench:*`)
  run from a checkout or an unpacked tarball: `demo/`, `example/`, and `bench/`
  ship in `files`, but are not part of the importable `fieldlog` module.
- Single writer, one process per file: the kernel mutex is cooperative
  in-process only (`src/kernel.ts:177-186`). Details:
  [kernel-api](docs/kernel-api.md),
  [limits-troubleshooting](docs/limits-troubleshooting.md).

## Gallery

| | |
|---|---|
| <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part1-log.png" alt="Every append seals to the previous entry, forming a hash chain." width="480"><br>hash chain — every append seals to the previous entry | <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part2-sync.png" alt="Delta sync sends only the diff, resuming from the last ack." width="480"><br>delta sync — only the diff flies, resuming from the last ack |
| <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part3-relay.png" alt="Offline devices exchange messages through the relay server." width="480"><br>relay — offline devices exchange messages via the server | <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part4-retain.png" alt="Snapshot plus truncate trims the log without losing the trail." width="480"><br>snapshot+truncate — trim the log without losing the trail |
| <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part5-auth.png" alt="Signed capability tokens gate access, and revocation is ruthless." width="480"><br>capability+revoke — signed tokens, ruthless revocation | <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part6-quarantine.png" alt="Corrupt entries are quarantined, never silently dropped." width="480"><br>quarantine — corrupt entries jailed, never silently dropped |
| <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part7-readmodel.png" alt="The SQLite read model is rebuilt from the append-only log." width="480"><br>read model — SQLite rebuilt from the log | <img src="https://raw.githubusercontent.com/arfoux/fieldlog/main/docs/gifs/part8-tombstone.png" alt="Delete writes a tombstone, so history stays intact." width="480"><br>soft delete — delete = tombstone, history stays intact |

## Concepts & architecture

- [architecture](docs/architecture.md) — module map: log/store/kernel/sync/relay/cas/retain
- [contracts](docs/contracts.md) — binding promises: dead-letter, blind compensators,
  seal<=ack, device.explicit, incremental purge, deterministic jitter, v0.5 superset
- [kernel-api](docs/kernel-api.md) — `createKernel`, `Kernel`, `LogEvent`, `EventStore`
- [sync-protocol](docs/sync-protocol.md) — push/pull, failover, backoff, deltasync
- [relay](docs/relay.md) — `WsRelayServer` + `WsRelayClient`
- [retention](docs/retention.md) — snapshot + truncate
- [auth](docs/auth.md) — device key, grant, capability token, countersign, revoke

## Subsystems (details)

- token: [capability-token](docs/capability-token.md) · revoke:
  [revoke-handshake](docs/revoke-handshake.md),
  [revoke-event-log](docs/revoke-event-log.md) — regrouped in [auth](docs/auth.md)
- delta-sync: [delta-sync](docs/delta-sync.md) · hash chain:
  [hash-chain-log](docs/hash-chain-log.md) · quarantine: [quarantine](docs/quarantine.md)
- attachments: [cas-store](docs/cas-store.md) · soft-delete:
  [tombstone-engine](docs/tombstone-engine.md) · quota: [quota-guard](docs/quota-guard.md)
- rig & harness (maintainer runbooks): [multi-device-rig](https://github.com/arfoux/fieldlog/blob/main/docs/internal/multi-device-rig.md),
  [corpus-generator](https://github.com/arfoux/fieldlog/blob/main/docs/internal/corpus-generator.md),
  [corruption-generator](https://github.com/arfoux/fieldlog/blob/main/docs/internal/corruption-generator.md),
  [cold-drill](https://github.com/arfoux/fieldlog/blob/main/docs/internal/cold-drill.md), [soak-runner](https://github.com/arfoux/fieldlog/blob/main/docs/internal/soak-runner.md),
  [chaos-kill](https://github.com/arfoux/fieldlog/blob/main/docs/internal/chaos-kill.md), [flake-hunter](https://github.com/arfoux/fieldlog/blob/main/docs/internal/flake-hunter.md),
  [conformance-gate](https://github.com/arfoux/fieldlog/blob/main/docs/internal/conformance-gate.md), [watchdog](https://github.com/arfoux/fieldlog/blob/main/docs/internal/watchdog.md),
  [mismatch-stop](https://github.com/arfoux/fieldlog/blob/main/docs/internal/mismatch-stop.md), [completion-protocol](https://github.com/arfoux/fieldlog/blob/main/docs/internal/completion-protocol.md),
  [merge-runner](https://github.com/arfoux/fieldlog/blob/main/docs/internal/merge-runner.md), [model-oracle](https://github.com/arfoux/fieldlog/blob/main/docs/internal/model-oracle.md),
  [compat-vectors](https://github.com/arfoux/fieldlog/blob/main/docs/internal/compat-vectors.md)
- decisions: [design decisions](docs/decisions.md) — five standing calls;
  [decision-log](docs/decision-log.md) — completed and dropped investigations

## Numbers, limits, contributing

- Benchmark: [bench](docs/bench.md) — all figures live there (single source
  of truth). Re-run from a checkout or unpacked tarball via `bun run bench:append | bench:query | bench:sync`.
- Log compat: [compat](docs/compat.md) · changelog: [CHANGELOG](CHANGELOG.md)
- Limits + troubleshooting: [limits-troubleshooting](docs/limits-troubleshooting.md)
- Contributing: [CONTRIBUTING](CONTRIBUTING.md) · security: [SECURITY](SECURITY.md) ·
  conduct: [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md)

CLI serve/sync default to signed mode: serve needs `--trust <id=pub.pem>`
(repeat per device), sync needs `--key <priv.pem> --as <device>`.
`--unsigned` open relay is for local dev only, not production.
