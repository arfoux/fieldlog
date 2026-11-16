# merge-runner: ff-only merge spin -> main

`scripts/merge-spin.sh` merges one spin branch into `main` without a merge
commit, only when `bun test` is green both before and after the merge. The tag
is `v<package.json version>` (for example `v0.15.1`), so it always matches what
the publish workflow accepts. `--order` is only a coordination token claimed
via the coordinator inbox; it no longer determines the tag. Two runners must
never claim the same order.

## Prerequisites

- `main` green on the current `bun test`; check live state, not a pinned hash.
- The release version is already set in `package.json`. Bump it before spinning.
- `bun:sqlite` only in `src/store.ts`, `src/retain.ts` (mismatch-stop).
- shell: `bash`, `git`, `bun`, `node`. `shellcheck` if present (not required).

## Procedure

1. Claim an order: ask for `--order k` via the coordinator inbox.
2. Dry-run from your own worktree (touches neither `main`, branches, nor tags):
   `bash scripts/merge-spin.sh --spin <branch> --order <k> --dry-run`
3. On `DRY-RUN OK`, report to the coordinator: commit hash, test numbers,
   dry-run log. WAIT for phase-2.
4. Phase-2 ONLY via the coordinator inbox (which holds `main`):
   `git checkout main && bash scripts/merge-spin.sh --spin <branch> --order <k>`
   then push the exact tag the script prints: `git push origin main <tag>`.
5. NEVER merge into `main` yourself from a dispatch worktree.

## Example output

Dry-run (worktree `w2-merge-runner`, spin `w2-watchdog` one commit ahead of
`main`, `--order 0`):

```text
$ bash scripts/merge-spin.sh --spin w2-watchdog --order 0 --dry-run
merge-runner: spin=w2-watchdog order=0 tag=v<version> dry_run=1
merge-runner: base=<sha> branch=w2-merge-runner
merge-runner: tag v<version> free
merge-runner: PRE bun test on main ...
merge-runner: PRE green (<pass> pass 0 fail)
DRY-RUN OK: would run: git merge --ff-only w2-watchdog && bun test && git tag v<version>
DRY-RUN OK: no branch, tag, or working tree was mutated
```

Real run (phase-2, on the coordinator's `main` checkout):

```text
$ git checkout main && bash scripts/merge-spin.sh --spin w2-watchdog --order 0
merge-runner: spin=w2-watchdog order=0 tag=v<version> dry_run=0
merge-runner: base=<sha> branch=main
merge-runner: tag v<version> free
merge-runner: PRE bun test on main ...
merge-runner: PRE green (<pass> pass 0 fail)
Updating <old>..<new>
Fast-forward
merge-runner: POST bun test on merged main ...
merge-runner: POST green (<pass> pass 0 fail)
merge-runner: DONE merged w2-watchdog -> main, tagged v<version>
```

## Failure decision table

| condition | script signal | action |
|---|---|---|
| not on `main` (real mode) | `REJECT: not on main` | `git checkout main`, retry |
| dirty tree (including untracked) | `REJECT: dirty working tree` | commit/stash (`-u`), retry |
| spin branch missing | `REJECT: spin branch ... does not exist` | fix the name / fetch |
| not fast-forward | `REJECT: non-fast-forward` | rebase the spin onto `main` in the spin worktree, request a fresh dry-run; the script NEVER merge-commits |
| nothing to merge | `REJECT: nothing to merge` | spin is already in `main`; abort, the order claim is void |
| tag exists | `REJECT: tag ... already exists` | version already released or order claim stale; re-coordinate via inbox |
| PRE `bun test` red | `REJECT: PRE bun test red` | merge ABORTED; fix on the spin branch, not on `main` |
| POST `bun test` red | `REJECT: POST bun test red ... UNTAGGED` | `main` is merged but UNTAGGED; STOP, escalate before tagging/manual revert |
| tag format violated | `error: generated tag ... is not vMAJOR.MINOR.PATCH` | fix `package.json` version, do not tag manually |

## Design notes

- `--ff-only` is used in two layers: a `merge-base --is-ancestor` check up
  front (clear rejection message) plus the `git merge --ff-only` flag at
  execution (anti-race if `main` moves mid-flight).
- Tags are created ONLY after a green POST; a red `main` never gets a tag.
- `set -euo pipefail`; syntax check: `bash -n scripts/merge-spin.sh`.
