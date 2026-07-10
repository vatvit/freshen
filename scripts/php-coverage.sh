#!/usr/bin/env bash
#
# Measure unit-test line coverage for packages/php and enforce the floor gate
# (REQUIREMENTS §4: coverage tracked, no regression). Runs in Docker with PCOV —
# nothing on the host. Mirrors what the CI `coverage` job does, for local parity.
#
# Freshen\Driver\Redis is excluded from the gate denominator (covered by the
# separate live-Redis lane, scripts/php-redis-it.sh).
#
# Usage:
#   scripts/php-coverage.sh            # default PHP 8.3, floor 90%
#   scripts/php-coverage.sh 8.4 92     # a specific PHP version + floor
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHP_DIR="$REPO_ROOT/packages/php"
PHP_VERSION="${1:-8.3}"
FLOOR="${2:-90}"

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
  php ../../scripts/php-coverage-gate.php build/clover.xml '"$FLOOR"'
'

echo "==> PHP ${PHP_VERSION}: unit coverage + gate (floor ${FLOOR}%)"
docker run --rm -v "$REPO_ROOT":/repo -w /repo/packages/php "php:${PHP_VERSION}-cli" sh -euc "$run"
