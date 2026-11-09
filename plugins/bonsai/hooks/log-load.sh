#!/bin/sh
# Runs on every instruction file load, so the off path starts nothing.
[ "${BONSAI_LOAD_LOG:-}" = 1 ] || exit 0
command -v bun >/dev/null 2>&1 || exit 0
bun "$(dirname "$0")/log-load.ts" >/dev/null 2>&1
exit 0
