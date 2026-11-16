# quota-guard

Port of skill-15 (`quota-guard`) to fieldlog. Admission control over
on-disk usage: callers `reserve(n)` before growing state (append,
snapshot, sync spool) and `release(n)` when the growth is dropped.
Every decision re-measures the tracked files, so growth behind the
guard's back is caught, not trusted.

Fail-closed: usage that cannot be measured denies admission. Any stat
failure other than "missing file" throws `ERR_QUOTA_UNKNOWN` and every
admission check (`reserve`, `check`, `remaining`, `status`) propagates
it — the guard never reports "space available" it cannot prove.
Over-quota throws `ERR_QUOTA_EXCEEDED` carrying the measured numbers;
bad inputs throw `ERR_QUOTA_INVALID`.

Wired into the kernel since v0.15: `createKernel({ quotaLimitBytes })` opens
one guard over the `[db, log]` file pair, reserves each append's estimated
bytes before writing (fail-closed `ERR_QUOTA_EXCEEDED` /
`ERR_QUOTA_UNKNOWN`), and exposes a live snapshot via `kernel.quota()`.
The kernel's outbox cap (`ERR_OUTBOX_FULL`, `maxPending` in `src/kernel.ts`)
is a different axis. `openQuotaGuard` stays the lower-level API for callers
that need direct reserve/release control (e.g. snapshot spools).

## Usage

```ts
import { openQuotaGuard } from '../src/quota.ts';

const g = openQuotaGuard({ limitBytes: 1_000_000, files: [dbPath, logPath] });
g.reserve(4096);   // throws ERR_QUOTA_EXCEEDED / ERR_QUOTA_UNKNOWN
try {
  /* ... grow state ... */
} finally {
  g.release(4096);
}
g.check(); // throws ERR_QUOTA_EXCEEDED if files outgrew the ceiling
```

Kernel wiring (since v0.15):

```ts
const k = await createKernel({ file: 'ledger.db', quotaLimitBytes: 1_000_000 });
await k.append({ type: 'entry', value: 1 }); // reserves estimate, throws ERR_QUOTA_* before writing
k.quota(); // { limit, used, reserved, remaining }, or null when no limit was set
```

| api | meaning |
|---|---|
| `usage()` | measured bytes of `files`; missing file = 0, unmeasurable = throw |
| `reserve(n)` / `release(n)` | hold / free `n` bytes (`n` positive integer; release clamps at 0) |
| `remaining()` | `limit - used - held` (measured, so it can throw) |
| `check()` / `status()` | deny / report against the ceiling right now |

## Run evidence (2026-09-06, base a80c1b9 = v0.14.16)

```text
$ bun test test/quota.test.ts
6 pass, 0 fail (82.00ms)
```

6 cases: exact accounting within ceiling, real-file measurement with
deny on the byte past the ceiling (40 used + 60 held = 100, +1
refused), release freeing + clamp at zero, `check()` catching external
growth (10 + 90 admitted, file grown to 60 behind the back, then both
`check` and `reserve` refuse), fail-closed on unmeasurable path (all
five reads refuse with `ERR_QUOTA_UNKNOWN`), invalid limit/sizes
rejected with nothing held.

## limits (by design)

- Pre-v0.15 history (base a80c1b9 = v0.14.16): the guard had no kernel
  wiring — `append`/`snapshot` did not call it, callers reserved explicitly,
  and scope was limited to `src/quota.ts`, this doc, and `test/quota.test.ts`
  (`src/index.ts` untouched). Superseded in v0.15 by the kernel option above.
- Reservations are in-memory: a restart drops held bytes (measured
  usage survives, it is re-statted from disk).
- Full suite (`bun test`, 95 pass / 0 fail / 37 files at base) NOT
  re-run here: previous worker died OOM on it; only the new file ran.
- Phase-2 (merge + tag) only via coordinator inbox instruction.
