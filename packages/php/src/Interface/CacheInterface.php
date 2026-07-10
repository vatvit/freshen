<?php

declare(strict_types=1);

namespace Freshen\Interface;

use Freshen\SyncMode;

interface CacheInterface
{
    public function get(KeyInterface $key): ValueResultInterface;

    public function put(KeyInterface $key, mixed $value): void;

    /** @param KeyPrefixInterface|KeyInterface|array<KeyInterface|KeyPrefixInterface> $selectors */
    public function invalidate(KeyPrefixInterface|KeyInterface|array $selectors, SyncMode $mode = SyncMode::ASYNC): void;

    /** @param KeyInterface|array<KeyInterface> $keys */
    public function invalidateExact(KeyInterface|array $keys, SyncMode $mode = SyncMode::ASYNC): void;

    /** @param KeyInterface|array<KeyInterface> $keys */
    public function refresh(KeyInterface|array $keys, SyncMode $mode = SyncMode::ASYNC): void;
}
