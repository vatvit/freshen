<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony;

use Symfony\Component\HttpKernel\Bundle\Bundle;

/**
 * Freshen Symfony bundle. Registers one {@see \Freshen\Cache} service per configured
 * cache (see {@see DependencyInjection\Configuration}) and auto-wires the async
 * invalidation listeners onto Symfony's PSR-14 event dispatcher.
 *
 * The DI extension is discovered by naming convention (FreshenExtension), so this
 * class is intentionally empty.
 */
final class FreshenBundle extends Bundle
{
}
