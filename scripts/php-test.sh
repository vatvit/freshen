#!/usr/bin/env bash
#
# Run the PHP suite (PHPUnit + PHPStan) inside each supported PHP version's
# Docker container. The library is single-source, PHP 8.1+, and runs natively
# across the whole range — there is no downgrade or dist step.
#
# Composer resolves a version-appropriate PHPUnit per container (10.x on 8.1,
# 11.x on 8.2+), so we `composer update` rather than install from a lock file.
#
# Usage:
#   scripts/php-test.sh            # full matrix: 8.1 8.2 8.3 8.4
#   scripts/php-test.sh 8.1        # a single version
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHP_DIR="$REPO_ROOT/packages/php"
VERSIONS="${*:-8.1 8.2 8.3 8.4}"

install_composer='
  apt-get update -qq && apt-get install -y -qq git unzip >/dev/null
  php -r "copy(\"https://getcomposer.org/installer\", \"composer-setup.php\");"
  php composer-setup.php --install-dir=/usr/local/bin --filename=composer --quiet
  php -r "unlink(\"composer-setup.php\");"
'

for v in $VERSIONS; do
  echo "==> PHP ${v}: composer update + phpunit + phpstan"
  docker run --rm -v "$PHP_DIR":/app -w /app "php:${v}-cli" sh -euc "
    $install_composer
    composer update --no-interaction --no-progress --prefer-dist
    vendor/bin/phpunit
    vendor/bin/phpstan analyse
  "
done
