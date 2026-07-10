<?php

declare(strict_types=1);

namespace Freshen\Tests;

use Freshen\AsyncEvent;
use Freshen\AsyncHandler;
use Freshen\Cache;
use Freshen\Interface\KeyInterface;
use Freshen\SyncMode;
use PHPUnit\Framework\TestCase;

/**
 * AsyncHandler is the worker side of async invalidation/refresh: it consumes an
 * AsyncEvent and drives the Cache synchronously. These tests assert the routing
 * (exact vs hierarchical) and that SYNC mode is always used, with a mocked Cache.
 */
final class AsyncHandlerTest extends TestCase
{
    private function key(): KeyInterface
    {
        return $this->createMock(KeyInterface::class);
    }

    public function testHandleInvalidationExactRoutesToInvalidateExactSync(): void
    {
        $key = $this->key();
        $cache = $this->createMock(Cache::class);
        $cache->expects($this->once())
            ->method('invalidateExact')
            ->with($key, SyncMode::SYNC);
        $cache->expects($this->never())->method('invalidate');

        (new AsyncHandler($cache))->handleInvalidation(new AsyncEvent($key, true));
    }

    public function testHandleInvalidationHierarchicalRoutesToInvalidateSync(): void
    {
        $key = $this->key();
        $cache = $this->createMock(Cache::class);
        $cache->expects($this->once())
            ->method('invalidate')
            ->with($key, SyncMode::SYNC);
        $cache->expects($this->never())->method('invalidateExact');

        (new AsyncHandler($cache))->handleInvalidation(new AsyncEvent($key, false));
    }

    public function testHandleInvalidationDefaultsToHierarchical(): void
    {
        $key = $this->key();
        $cache = $this->createMock(Cache::class);
        // AsyncEvent's $exact defaults to false → hierarchical invalidate.
        $cache->expects($this->once())
            ->method('invalidate')
            ->with($key, SyncMode::SYNC);

        (new AsyncHandler($cache))->handleInvalidation(new AsyncEvent($key));
    }

    public function testHandleRefreshRoutesToRefreshSync(): void
    {
        $key = $this->key();
        $cache = $this->createMock(Cache::class);
        $cache->expects($this->once())
            ->method('refresh')
            ->with($key, SyncMode::SYNC);

        (new AsyncHandler($cache))->handleRefresh(new AsyncEvent($key));
    }
}
