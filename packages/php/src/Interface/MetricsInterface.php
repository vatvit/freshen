<?php

declare(strict_types=1);

namespace Freshen\Interface;

interface MetricsInterface
{
    /** @param array<string, string> $labels */
    public function inc(string $name, array $labels = []): void;

    /** @param array<string, string> $labels */
    public function observe(string $name, float $value, array $labels = []): void;
}
