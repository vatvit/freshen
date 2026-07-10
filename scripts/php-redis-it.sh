#!/usr/bin/env bash
#
# Run the live-Redis integration lane for packages/php (the `integration` test
# suite, excluded from the default unit run — REQUIREMENTS §5). Spins up a real
# Redis and a PHP container with ext-redis, on a shared Docker network, then runs
# only the integration suite. Everything runs in Docker — nothing on the host.
#
# This is the only coverage for Freshen\Driver\Redis: atomic SET NX single-flight,
# exact vs hierarchical clear, the injected-connection fix (FRSH-010), and the
# null-key flush rejection.
#
# Usage:
#   scripts/php-redis-it.sh          # default PHP 8.3
#   scripts/php-redis-it.sh 8.4      # a specific PHP version
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHP_DIR="$REPO_ROOT/packages/php"
PHP_VERSION="${1:-8.3}"

NET="freshen-redis-it-$$"
REDIS_CT="freshen-redis-$$"

cleanup() {
  docker rm -f "$REDIS_CT" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating network + Redis service (redis:7-alpine)"
docker network create "$NET" >/dev/null
docker run -d --rm --name "$REDIS_CT" --network "$NET" --network-alias redis redis:7-alpine >/dev/null

run_php='
  set -eu
  apt-get update -qq && apt-get install -y -qq git unzip $PHPIZE_DEPS >/dev/null
  pecl install redis >/dev/null 2>&1
  docker-php-ext-enable redis
  curl -sS https://getcomposer.org/installer -o cs.php
  php cs.php --install-dir=/usr/local/bin --filename=composer --quiet
  rm -f cs.php
  composer update --no-interaction --no-progress --prefer-dist
  echo "==> Running integration suite against live Redis"
  vendor/bin/phpunit --testsuite integration
'

echo "==> PHP ${PHP_VERSION}: ext-redis + integration suite"
docker run --rm --network "$NET" \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -v "$PHP_DIR":/app -w /app \
  "php:${PHP_VERSION}-cli" sh -euc "$run_php"

echo "==> Redis integration lane passed."
