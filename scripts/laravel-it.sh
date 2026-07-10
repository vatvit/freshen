#!/usr/bin/env bash
#
# Run the Laravel bridge live-Redis lane (the `integration` suite, excluded from the
# default unit run). Spins up a real Redis and a PHP container with ext-redis on a
# shared Docker network, boots a real Laravel app, and asserts a
# cold-key fill + async invalidate() (routed through a real queue (sync)) works
# end-to-end. Everything runs in Docker — nothing on the host.
#
# Usage:
#   scripts/laravel-it.sh          # default PHP 8.3
#   scripts/laravel-it.sh 8.4      # a specific PHP version
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LV_DIR="$REPO_ROOT/packages/laravel"
PHP_VERSION="${1:-8.3}"

NET="freshen-laravel-it-$$"
REDIS_CT="freshen-laravel-redis-$$"

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
  echo "==> Running Laravel integration suite against live Redis"
  vendor/bin/phpunit --testsuite integration
'

echo "==> PHP ${PHP_VERSION}: ext-redis + integration suite"
docker run --rm --network "$NET" \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -v "$LV_DIR":/app -w /app \
  "php:${PHP_VERSION}-cli" sh -euc "$run_php"

echo "==> Laravel integration lane passed."
