<?php

declare(strict_types=1);

namespace Freshen;

use Freshen\Interface\JitterInterface;
use Freshen\Interface\KeyInterface;

final class DefaultJitter implements JitterInterface
{
    public function __construct(private int $percent = 15)
    {
    }

    public function apply(int $ttlSec, KeyInterface $key): int
    {
        // Deterministic jitter based on key hash in range [-delta, +delta].
        $delta = max(0, (int)floor($ttlSec * $this->percent / 100));
        if ($delta === 0) return max(1, $ttlSec);
        $h = crc32($key->toString());
        $offset = (int)($h % (2 * $delta + 1)) - $delta;
        return max(1, $ttlSec + $offset);
    }
}
