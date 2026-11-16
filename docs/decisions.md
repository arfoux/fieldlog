# fieldlog design decisions — five standing calls

Date: 2026-09-12. Sources: `src/auth.ts`, `src/relay.ts`, `docs/contracts.md`.
No verbal decisions remain after this file.

This file records the calls that shape the design. For completed and dropped
investigations, see [decision-log](decision-log.md).

## 1. Token epochs: wont-fix; reissue mints a new UUID

- Decision: `CapToken` has no `epoch` field. Revocation kills one full id.
  Reissue mints a fresh UUID; the old sibling dies and the new sibling lives.
- Context: `CapToken` = `{ id, deviceId, scopes, issuedAt, expiresAt, notBefore?, signature? }` (`src/auth.ts:148-156`); minting uses `randomUUID`, with no epoch (`src/auth.ts:168-183`); verification is fail-closed for a token with no id, `expiresAt <= issuedAt`, expiry, and per-id revocation (`src/auth.ts:199-215`). On the revoke side: `isRevoked(tokenId, tokenEpoch = 0)` (`src/revokelog.ts:267`), `isTokenRevoked(tokenId, tokenEpoch = 0)` (`src/relay.ts:257`); a `CapToken` is always epoch 0 because it has no such field. Written policy: "`CapToken` ids are random UUIDs with no epoch, so any event for the id kills it" (`docs/revoke-handshake.md:44-48`).
- Rejected alternative: add `epoch` to the canonical token. That duplicates the revoke-event epoch mechanism into the token and splits the canonical form, verification, and migration — with no real need.
- Revisit if: stable-id rotation becomes a requirement (same id on reissue, epoch increments, revoking an old epoch kills only that epoch). Requirements then: evidence of the need plus a migration plan (old epoch-less tokens fail closed and are re-minted). Until then: one new UUID per reissue.

## 2. `dist/`: out of scope; canonical run is `src` + Bun

- Decision: `dist/` is a local build artifact. Do not read, edit, cite, or
  publish it. The canonical run is Bun over the TypeScript in `src` directly;
  `tsc` is only a type/build check.
- Context: `tsconfig.json` (`outDir: dist`, `rootDir: src`); `.gitignore`
  lists `dist/`; `package.json` (`main: src/index.ts`,
  `bin: bin/fieldlog.js` (npm shim spawning `bin/fieldlog.ts` under Bun),
  `files: [src, bin, README, LICENSE, CHANGELOG, docs/*.md]` — no `dist`);
  canonical scripts are `bun test`, `bun bench/bench-*.ts`,
  `bun demo/two-node.ts`, `build: tsc -p tsconfig.json`.
- Rejected alternative: use `node dist/*` as the reference run. That duplicates
  the source of truth and goes stale after every `src` edit.
- Revisit if: publishing requires compiled JS. Then change `files` and make the
  canonical run explicit — not silently.

## 3. Plaintext relay; confidentiality via WireGuard (moltarc runbook)

- Decision: the relay stays plain WebSocket (`Bun.serve`, no TLS in code).
  Authentication provides integrity and authenticity, not confidentiality.
  Across sites or over the internet, wrap the TCP connection in WireGuard.
- Context: the relay "accept raw log, broadcast, store. No business logic",
  persists JSONL before ack, and treats live delivery as a hint only
  (`src/relay.ts:1-5`); `push`/`pull` frames carry a raw `LogEvent` plus an
  optional `CapToken` (`src/relay.ts:57-62`); authorization is device tombstone
  → per-id revocation → signature → expiry → scope
  (`docs/capability-token.md:33-34`); a leaked token gives its holder full use
  until expiry or revocation and is not bound to a socket
  (`docs/capability-token.md:62-64`, `src/auth.ts:142-146`). An unsigned relay
  (empty registry) is for local development only; production is fail-closed
  (`docs/auth.md:43-44`, `src/relay.ts:40-46`).
- Runbook: [moltarc WireGuard P2P](https://github.com/arfoux/moltarc/blob/main/docs/wireguard-p2p.md)
  (old `../../molt/...` paths only resolve in a local sibling checkout).
  Tunnel topology only: why encryption lives outside the code (HMAC/auth
  without confidentiality), two peers, PSK rotation, ports/firewall, and
  verifying a wrong PSK fails the handshake. Moltarc's `MOLTARC_PSK` and
  `allowPeers` knobs configure its own relay — they do NOT apply to
  fieldlog's `WsRelayServer`.
- Rejected alternative: TLS inside `src/relay.ts`. Heavier deployment for a LAN
  relay; confidentiality across sites is already answered by the tunnel.
- Revisit if: the relay must be exposed to the internet without a tunnel. Then
  TLS/WSS becomes a requirement, not an option.

## 4. Claims: ephemeral, 15-minute default TTL — owned by moltarc; pointer only

- Decision: fieldlog has no claim module. Claims live only in moltarc; fieldlog
  money-state completes through resolve/sync-ack, not through a permit.
- moltarc context (a pointer, not a duplicate; `../../molt/...` = local
  sibling checkout): `ClaimStore` is explicitly
  EPHEMERAL in memory; a restart without a `toJSON` snapshot and `fromJSON`
  restore makes spent claims spendable again (double-spend) — there is no
  automatic persistence ([src/claim.ts:4-10](https://github.com/arfoux/moltarc/blob/main/src/claim.ts),
  [src/claim.ts:63-65](https://github.com/arfoux/moltarc/blob/main/src/claim.ts)); `DEFAULT_TTL_MS` is 15 minutes with the
  window rationale ([src/claim.ts:41-46](https://github.com/arfoux/moltarc/blob/main/src/claim.ts)); an omitted argument uses
  the default, explicit `undefined`/`null` means never-expire, and a number sets
  a custom window ([src/claim.ts:48-53](https://github.com/arfoux/moltarc/blob/main/src/claim.ts)); an expired `use()` reports
  `expired` and is never marked spent ([src/claim.ts:97-105](https://github.com/arfoux/moltarc/blob/main/src/claim.ts));
  canonical contract in [docs/contracts.md](https://github.com/arfoux/moltarc/blob/main/docs/contracts.md) → Claim TTL. The fieldlog
  parallel: relay token TTLs `GRANT_TTL_MS` 24 hours / `CAP_TOKEN_TTL_MS`
  15 minutes (`src/auth.ts:68-69`, `docs/capability-token.md:38-46`) — those are
  relay capability tokens, not claims.
- Rejected alternative: a second claim engine in fieldlog. That would fork the
  expiry/persist/reconcile semantics already in moltarc.
- Revisit if: fieldlog needs an offline single-spend permit. Then import from
  moltarc — do not fork.

## 5. One dated bench source; canonical CHANGELOG and honesty gate

- Decision: the single source of numbers is the dated `docs/bench.md`. A number
  is valid only with a pinned slice, corpus, and machine. `CHANGELOG.md` is the
  canonical record of user-visible changes; `bench/honesty.md` plus
  `scripts/bench-check.sh` enforce the honesty gate.
- Context: `docs/bench.md` ("Measured 2026-09-12 … no estimates", with machine,
  method, and results sections); honesty means slice (git HEAD) + corpus (bench
  file, N, parameters) + machine (os/arch/bun), with a mismatch → STOP and no
  estimates (`bench/honesty.md:1-28`); checker exits 0 PASS / 2 FAIL / 1 usage
  (`bench/honesty.md:30-49`); numbers from different days are not comparable
  (`bench/honesty.md:76-80`); `CHANGELOG.md` follows Unreleased → tag order,
  with untagged changes folded in.
- Rejected alternative: numbers scattered across chat and docs without a date
  or pins. Not reproducible, therefore rejected.
- Revisit if: never — the pinning rule is permanent. A new bench gets its own
  date and pins, not an average across days.
