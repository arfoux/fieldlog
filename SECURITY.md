# Security Policy

## Reporting

Found a hole? Do not open a public issue yet. Preferred channel: the private
advisory form at https://github.com/arfoux/fieldlog/security/advisories/new
Fallback: send a description + repro steps to this repo's maintainer via
DM/contact listed on the repo profile or the latest commit.

Include: version (`package.json`), affected file/line, impact
(what an attacker could do), and a minimal PoC if you have one.

## Scope

In scope: `src/` (log chain, store apply, sync verify, relay authorize,
auth, retain clamp, tombstone guard, cas re-hash, quota fail-closed),
`bin/fieldlog.ts` (signed mode by default), `demo/` + `example/` as patterns
copied by users.

Out of scope: hardening of users' own deployments (terminating TLS, firewall,
production key management), and the intentionally open `--unsigned` relay
(already documented as dev-only in [docs/cli](docs/cli.md)).

## Response SLA

Solo/small-team repo — honest, not enterprise promises:

- Receipt confirmed: <= 72 hours.
- Triage + fix plan: <= 7 days for impactful ones.
- Fixes: priority over features; released + noted in CHANGELOG.
- If there is no news within 14 days, ping once more — then responsible
  full disclosure is fair.

## Already pinned

The living threat model is in `docs/`: tokens ([capability-token](docs/capability-token.md)),
revocation ([revoke-handshake](docs/revoke-handshake.md),
[revoke-event-log](docs/revoke-event-log.md)), quarantine
([quarantine](docs/quarantine.md)), anti-data-loss contracts
([contracts](docs/contracts.md)). Security PRs should add a test that
pins the hole, not just a patch.
