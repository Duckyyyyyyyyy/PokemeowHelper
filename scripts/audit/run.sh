#!/bin/bash
# run.sh <tag> <source dir, or . for this repo> <seed0> <battles> <rollouts> <match|audit>: 8 processes, results in .out/<tag>_<i>.jsonl
D=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$2" && pwd); command -v cygpath >/dev/null && R=$(cygpath -m "$R") && D=$(cygpath -m "$D")
export REPO=$R
mkdir -p "$D/.out"; rm -f "$D/.out/$1"_*
cd "$D/../.." || exit 1
for i in 1 2 3 4 5 6 7 8; do npx tsx "$D/audit.mts" $(($3 + i)) "$4" "$5" "$D/.out/$1_$i.jsonl" "$6" >/dev/null 2>"$D/.out/$1_$i.err" & done; wait
