<?php

declare(strict_types=1);

namespace Freshen;

class AsyncHandler {

    public function __construct(
        private Cache $cache,
    ) {}

    public function handleInvalidation(AsyncEvent $event): void
    {
        $key = $event->key;
        $exact = $event->exact;

        if ($exact) {
            $this->cache->invalidateExact($key, SyncMode::SYNC);
        } else {
            $this->cache->invalidate($key, SyncMode::SYNC);
        }
    }

    public function handleRefresh(AsyncEvent $event): void
    {
        $key = $event->key;

        $this->cache->refresh($key, SyncMode::SYNC);
    }
}
