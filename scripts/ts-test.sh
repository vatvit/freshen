#!/usr/bin/env bash
#
# Two-stage, mirroring the PHP source/dist split:
#
#   1. BUILD + QUALITY on a modern Node (the dev toolchain — ESLint 9, Vitest 2,
#      tsup — requires Node >=18, so it cannot run on the Node 16 floor).
#   2. SMOKE-LOAD the built dist/ on every supported Node (16 18 20 22),
#      proving the ES2020/Node 16 build target actually loads and runs there.
#
# Usage:
#   scripts/ts-test.sh            # build on Node 20, smoke on 16 18 20 22
#   scripts/ts-test.sh 16 18      # build on Node 20, smoke on the given versions
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_DIR="$REPO_ROOT/packages/ts"

BUILD_NODE=20
SMOKE_VERSIONS="${*:-16 18 20 22}"

echo "==> Build + quality on node:${BUILD_NODE}"
docker run --rm -v "$TS_DIR":/app -w /app "node:${BUILD_NODE}" sh -euc '
  npm install --no-audit --no-fund
  npm run lint
  npm run typecheck
  npm run coverage
  npm run build
'

for v in $SMOKE_VERSIONS; do
  echo "==> Smoke-load dist on node:${v} (esm + cjs)"
  docker run --rm -v "$TS_DIR":/app -w /app "node:${v}" sh -euc '
    node -e "import(\"./dist/index.js\").then(m => { if (!m.VERSION) { throw new Error(\"esm load failed\"); } })"
    node -e "const m = require(\"./dist/index.cjs\"); if (!m.VERSION) { throw new Error(\"cjs load failed\"); }"
  '
done
