#!/usr/bin/env bash
#
# Drift guard for the frozen Key parity oracle (REQUIREMENTS §6 / CLAUDE.md).
#
# The oracle lives in the PHP package (`packages/php/tests/fixtures/key-parity.json`,
# the reference). The TS package vendors a byte-for-byte COPY so its parity test can
# run inside the Node-only container (which mounts just `packages/ts`). This script
# asserts the copy has not drifted from the reference — run it in CI so a change to
# one file without the other fails the build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$REPO_ROOT/packages/php/tests/fixtures/key-parity.json"
COPY="$REPO_ROOT/packages/ts/tests/fixtures/key-parity.json"

if [ ! -f "$REF" ]; then
  echo "FAIL: reference fixture missing: $REF" >&2
  exit 1
fi
if [ ! -f "$COPY" ]; then
  echo "FAIL: vendored TS copy missing: $COPY" >&2
  exit 1
fi

if ! diff -u "$REF" "$COPY"; then
  echo "" >&2
  echo "FAIL: packages/ts key-parity.json has drifted from the PHP reference." >&2
  echo "      Re-sync with: cp '$REF' '$COPY'" >&2
  exit 1
fi

echo "OK: TS parity fixture is byte-identical to the PHP reference oracle."
