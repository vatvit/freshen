#!/usr/bin/env bash
#
# Run the live-Redis integration lane for packages/ts (the `integration` suite,
# excluded from the default unit run — REQUIREMENTS §5). Mirrors php-redis-it.sh:
# spins up a real Redis and a Node container on a shared Docker network, then runs
# only the integration suite. Everything runs in Docker — nothing on the host.
#
# This is the only coverage for RedisDriver over a real server: atomic SET NX
# single-flight, exact vs prefix-subtree vs batch delete, and MGET — exercised
# through BOTH the ioredis and node-redis adapters.
#
# Usage:
#   scripts/ts-redis-it.sh          # default node 20
#   scripts/ts-redis-it.sh 18       # a specific Node version
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_DIR="$REPO_ROOT/packages/ts"
NODE_VERSION="${1:-20}"

NET="freshen-ts-redis-it-$$"
REDIS_CT="freshen-ts-redis-$$"

cleanup() {
  docker rm -f "$REDIS_CT" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating network + Redis service (redis:7-alpine)"
docker network create "$NET" >/dev/null
docker run -d --rm --name "$REDIS_CT" --network "$NET" --network-alias redis redis:7-alpine >/dev/null

echo "==> Node ${NODE_VERSION}: integration suite against live Redis (ioredis + node-redis)"
docker run --rm --network "$NET" \
  -e REDIS_URL=redis://redis:6379 \
  -v "$TS_DIR":/app -w /app \
  "node:${NODE_VERSION}" sh -euc '
    npm install --no-audit --no-fund
    npm run test:integration
  '

echo "==> TS Redis integration lane passed."
