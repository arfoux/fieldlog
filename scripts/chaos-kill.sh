#!/bin/sh
# chaos-kill.sh - run the SIGKILL chaos drills: the owned chaos-kill suite
# (kill at write, seal, sync) plus the kill9 reference (read-only, never
# modified here). reports pass/fail counts for the merge gate.
#
# usage:
#   scripts/chaos-kill.sh
#
# exit codes:
#   0  every drill green
#   1  at least one drill failed
#   2  usage or environment error (bun missing)

set -eu

command -v bun >/dev/null 2>&1 || { echo "[chaos-kill] bun not on PATH" >&2; exit 2; }

set +e
OUT="$(bun test test/chaos-kill.test.ts test/kill9.test.ts 2>&1)"
ST=$?
set -e
if [ "$ST" -ne 0 ]; then
  printf '%s\n' "$OUT"
else
  printf '%s\n' "$OUT" | tail -5
fi
printf '[chaos-kill] exit=%s\n' "$ST"
exit "$ST"
