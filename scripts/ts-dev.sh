#!/usr/bin/env bash
#
# Fast TS inner-loop (single modern Node container): lint + typecheck + tests.
# No dist build, no Node matrix — use scripts/ts-test.sh for the full gate.
#
# Usage:
#   scripts/ts-dev.sh            # lint + typecheck + test (vitest run)
#   scripts/ts-dev.sh coverage   # same but with coverage
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_DIR="$REPO_ROOT/packages/ts"
TEST_TASK="${1:-test}"

docker run --rm -v "$TS_DIR":/app -w /app node:20 sh -euc "
  npm install --no-audit --no-fund
  npm run lint
  npm run typecheck
  npm run ${TEST_TASK}
"
