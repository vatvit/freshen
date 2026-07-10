<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\Tests\Integration;

use Freshen\Interface\KeyInterface;
use Freshen\Interface\LoaderInterface;

/**
 * Test loader: returns "v{n}" and counts calls, so a test can prove a cold-key fill
 * happened once and that an invalidation forces a recompute.
 */
final class CountingLoader implements LoaderInterface
{
    public int $calls = 0;

    public function resolve(KeyInterface $key): mixed
    {
        $this->calls++;

        return 'v' . $this->calls;
    }
}
