# Conformance gate (pre-merge)

`scripts/conformance-gate.sh` is the pre-merge gate for fieldlog spins.
It runs four checks; every check prints `PASS: <name> (<detail>)` or
`FAIL: <name> (<reason>)`, then a final `GATE: PASS` / `GATE: FAIL` line.
Exit code is 0 only when all four checks pass.

## Checks

| # | Name    | Rule | Reason on FAIL |
|---|---------|------|----------------|
| 1 | `base`  | `git merge-base HEAD <main-ref>` equals the `<main-ref>` tip (default `main`) | `merge-base X != main tip Y; rebase onto main`, or `ref not found` |
| 2 | `tree`  | `git status --porcelain` is empty | `dirty: <first 5 lines>` |
| 3 | `tests` | `bun test` reports at least `EXPECTED_PASS` passes and `0` failures (default 266/0; floor pins last green total) | `bun test P/F, expected >=E/0` |
| 4 | `scope` | every file in `git diff --name-only <base>...HEAD` starts with a default allow prefix (`src/`, `test/`, `scripts/`, `docs/`, `.github/`) or a `--allow` path/prefix, and is not a generated/lock/vcs path (lockfiles, `dist/`, `node_modules/`, `.git/`, `*.log`, `*.tmp`) | `out-of-scope:<files>; allow prefixes: <prefixes>` |

## Usage

```sh
bash scripts/conformance-gate.sh [--expected-pass N] [--main-ref REF] [--allow PATH]
bash scripts/conformance-gate.sh --allow README.md --allow package.json
GATE_EXPECTED_PASS=266 GATE_MAIN_REF=main bash scripts/conformance-gate.sh
```

`--expected-pass` exists so a spin can pin its own green count, and so a
FAIL can be simulated on purpose (see below). `GATE_*` env vars do the same.
`--allow` is repeatable and adds extra paths/prefixes beyond the defaults
(`src/`, `test/`, `scripts/`, `docs/`, `.github/`); root files such as
`README.md` or `package.json` must be named explicitly. Generated, lock and
VCS paths (`bun.lock`, `dist/`, `node_modules/`, `.git/`, `*.log`, `*.tmp`)
stay denied even under an allowed prefix. `docs/internal/*` is covered by
the `docs/` prefix.

## Proving the gate

1. On a clean, committed branch whose base is the current `main` tip, run
   `bash scripts/conformance-gate.sh`; it must print `GATE: PASS` with
   `tests (bun test 266/0, expected 266/0)`.
2. Simulated FAIL: `bash scripts/conformance-gate.sh --expected-pass 267`
   must print `GATE: FAIL` with
   `FAIL: tests (bun test 266/0, expected 267/0)`.

Full `bun test` takes ~270 s (model-fuzz oracle + soak dominate), so each
proof run takes about five minutes. Phase-2 (merge + tag) runs only on
coordinator inbox instruction, never unilaterally.
