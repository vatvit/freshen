#!/usr/bin/env bash
#
# Run the Symfony bridge suite (PHPUnit unit + PHPStan) inside each supported PHP
# version's Docker container. The bundle is single-source, PHP 8.1+. The default
# PHPUnit suite is config + container wiring only (no live backends); the live-Redis
# lane is separate — see scripts/symfony-it.sh.
#
# Composer pulls vatvit/freshen from Packagist (^1.0@rc) plus the Symfony components.
#
# Usage:
#   scripts/symfony-test.sh          # full matrix: 8.1 8.2 8.3 8.4
#   scripts/symfony-test.sh 8.1      # a single version
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SF_DIR="$REPO_ROOT/packages/symfony"
VERSIONS="${*:-8.1 8.2 8.3 8.4}"

install_composer='
  apt-get update -qq && apt-get install -y -qq git unzip >/dev/null
  php -r "copy(\"https://getcomposer.org/installer\", \"composer-setup.php\");"
  php composer-setup.php --install-dir=/usr/local/bin --filename=composer --quiet
  php -r "unlink(\"composer-setup.php\");"
'

for v in $VERSIONS; do
  echo "==> PHP ${v}: composer update + phpunit + phpstan"
  docker run --rm -v "$SF_DIR":/app -w /app "php:${v}-cli" sh -euc "
    $install_composer
    composer update --no-interaction --no-progress --prefer-dist
    vendor/bin/phpunit
    vendor/bin/phpstan analyse --memory-limit=512M
  "
done
