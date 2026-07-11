#!/usr/bin/env bash
#
# Unit-test line coverage + floor gate for a framework bridge (symfony | laravel),
# mirroring scripts/php-coverage.sh and reusing scripts/php-coverage-gate.php. Runs in
# Docker with PCOV — nothing on the host.
#
# The bridge's **live-Redis wiring path** is excluded from the gate denominator (it is
# covered by the bridge's integration lane, scripts/<bridge>-it.sh) — exactly as core
# excludes Freshen\Driver\Redis. What that path is per bridge:
#   - symfony: none — the extension builds service *definitions*, fully unit-covered.
#   - laravel: src/FreshenManager.php — it reuses Laravel's live phpredis client to
#              build the Stash pool + Cache, so it is exercised only by the live lane.
#
# Usage:
#   scripts/bridge-coverage.sh symfony            # PHP 8.3, floor 90%
#   scripts/bridge-coverage.sh laravel 8.4 90     # a specific PHP version + floor
set -euo pipefail

BRIDGE="${1:?usage: bridge-coverage.sh <symfony|laravel> [php-version] [floor]}"
PHP_VERSION="${2:-8.3}"
FLOOR="${3:-90}"

case "$BRIDGE" in
  symfony) PKG_DIR="packages/symfony"; EXCLUDE="" ;;
  laravel) PKG_DIR="packages/laravel"; EXCLUDE="src/FreshenManager.php" ;;
  *) echo "bridge-coverage: unknown bridge '$BRIDGE' (expected symfony|laravel)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run='
  set -eu
  apt-get update -qq && apt-get install -y -qq git unzip $PHPIZE_DEPS >/dev/null
  pecl list 2>/dev/null | grep -qi pcov || pecl install pcov >/dev/null 2>&1
  docker-php-ext-enable pcov
  curl -sS https://getcomposer.org/installer -o cs.php
  php cs.php --install-dir=/usr/local/bin --filename=composer --quiet
  rm -f cs.php
  composer update --no-interaction --no-progress --prefer-dist >/dev/null
  mkdir -p build
  php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover build/clover.xml
  php ../../scripts/php-coverage-gate.php build/clover.xml '"$FLOOR"' "'"$EXCLUDE"'"
'

echo "==> ${BRIDGE} bridge, PHP ${PHP_VERSION}: unit coverage + gate (floor ${FLOOR}%, exclude '${EXCLUDE:-none}')"
docker run --rm -v "$REPO_ROOT":/repo -w "/repo/${PKG_DIR}" "php:${PHP_VERSION}-cli" sh -euc "$run"
