<?php

declare(strict_types=1);

namespace Freshen\Tests;

use Freshen\Cache;
use Freshen\Interface\KeyInterface;
use Freshen\Interface\LoaderInterface;
use Freshen\Interface\JitterInterface;
use Freshen\Interface\MetricsInterface;
use Freshen\SyncMode;
use PHPUnit\Framework\TestCase;
use Psr\EventDispatcher\EventDispatcherInterface;
use Stash\Interfaces\ItemInterface;
use Stash\Interfaces\PoolInterface as StashPoolInterface;
use Stash\Interfaces\DriverInterface as StashDriverInterface;
use Stash\Invalidation;

final class CacheTest extends TestCase
{
    private function newKey(string $id = 'k'): KeyInterface
    {
        $key = $this->createMock(KeyInterface::class);
        $key->method('toString')->willReturn($id);
        return $key;
    }

    private function newDate(int $ts): \DateTime
    {
        return (new \DateTime())->setTimestamp($ts);
    }

    public function testGetFreshHit(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $item = $this->createMock(ItemInterface::class);
        $key = $this->newKey('fresh');

        // Fresh hit path
        $pool->method('getItem')->with('fresh')->willReturn($item);

        $item->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::PRECOMPUTE, 60);

        $item->method('get')->willReturn('value');
        $item->method('isHit')->willReturn(true);
        $item->method('getCreation')->willReturn($this->newDate(1_000));
        $item->method('getExpiration')->willReturn($this->newDate(1_600));

        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $res = $cache->get($key);

        $this->assertTrue($res->isHit());
        $this->assertSame('value', $res->value());
        $this->assertSame(1_000, $res->createdAt());
        $this->assertSame(1_600 - 60, $res->softExpiresAt());
    }

    public function testLeaderComputeAndSaveOnMissWithLock(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $itemInitial = $this->createMock(ItemInterface::class);
        $itemForSave = $this->createMock(ItemInterface::class);
        $key = $this->newKey('leader');

        // First getItem -> initial miss item
        $pool->expects($this->exactly(2))
            ->method('getItem')
            ->with('leader')
            ->willReturnOnConsecutiveCalls($itemInitial, $itemForSave);

        // Fast path miss
        $itemInitial->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::PRECOMPUTE, 60);
        $itemInitial->method('get')->willReturn(null);
        $itemInitial->method('isHit')->willReturn(false);

        // Become leader
        $itemInitial->expects($this->once())->method('lock')->willReturn(true);

        // Save path
        $itemForSave->expects($this->once())->method('set')->with('loaded');
        $itemForSave->expects($this->once())->method('expiresAfter')->with(600);
        $pool->expects($this->once())->method('save')->with($itemForSave);

        $loader = $this->createMock(LoaderInterface::class);
        $loader->expects($this->once())->method('resolve')->with($key)->willReturn('loaded');

        $jitter = $this->createMock(JitterInterface::class);
        $jitter->method('apply')->with(600, $key)->willReturn(600);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $res = $cache->get($key);

        $this->assertTrue($res->isHit());
        $this->assertSame('loaded', $res->value());
    }

    public function testFollowerServeStaleWhenLockedByAnother(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $itemInitial = $this->createMock(ItemInterface::class);
        $itemStale = $this->createMock(ItemInterface::class);
        $key = $this->newKey('stale');

        // First getItem -> initial miss item
        $pool->expects($this->exactly(2))
            ->method('getItem')
            ->with('stale')
            ->willReturnOnConsecutiveCalls($itemInitial, $itemStale);

        $itemInitial->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::PRECOMPUTE, 60);
        $itemInitial->method('get')->willReturn(null);
        $itemInitial->method('isHit')->willReturn(false);
        $itemInitial->expects($this->once())->method('lock')->willReturn(false);

        // Serve stale path
        $itemStale->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::OLD);
        $itemStale->method('get')->willReturn('stale-value');
        $itemStale->method('getCreation')->willReturn($this->newDate(1_000));
        $itemStale->method('getExpiration')->willReturn($this->newDate(1_600));

        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $res = $cache->get($key);

        $this->assertTrue($res->isStale());
        $this->assertSame('stale-value', $res->value());
        $this->assertSame(1_000, $res->createdAt());
        $this->assertSame(1_600 - 60, $res->softExpiresAt());
    }

    public function testFollowerWaitFreshAfterShortSleep(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $itemInitial = $this->createMock(ItemInterface::class);
        $itemStale = $this->createMock(ItemInterface::class);
        $itemWait = $this->createMock(ItemInterface::class);
        $key = $this->newKey('sleep');

        // getItem calls: initial (miss) -> stale (empty) -> wait (fresh)
        $pool->expects($this->exactly(3))
            ->method('getItem')
            ->with('sleep')
            ->willReturnOnConsecutiveCalls($itemInitial, $itemStale, $itemWait);

        $itemInitial->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::PRECOMPUTE, 60);
        $itemInitial->method('get')->willReturn(null);
        $itemInitial->method('isHit')->willReturn(false);
        $itemInitial->expects($this->once())->method('lock')->willReturn(false);

        // No stale value available -> fall through to the wait path
        $itemStale->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::OLD);
        $itemStale->method('get')->willReturn(null);

        // Follower waits, then the leader's fresh value appears
        $itemWait->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::SLEEP, 150, 6);
        $itemWait->method('get')->willReturn('fresh-after-wait');
        $itemWait->method('isHit')->willReturn(true);
        $itemWait->method('getCreation')->willReturn($this->newDate(2_000));
        $itemWait->method('getExpiration')->willReturn($this->newDate(2_600));

        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $res = $cache->get($key);

        $this->assertTrue($res->isHit());
        $this->assertSame('fresh-after-wait', $res->value());
        $this->assertSame(2_000, $res->createdAt());
        $this->assertSame(2_600 - 60, $res->softExpiresAt());
    }

    public function testFailOpenComputeWhenLeaderNotAvailable(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $itemInitial = $this->createMock(ItemInterface::class);
        $itemStale = $this->createMock(ItemInterface::class);
        $itemWait = $this->createMock(ItemInterface::class);
        $key = $this->newKey('race');

        // Sequence: initial -> stale try -> wait try
        $pool->expects($this->exactly(3))
            ->method('getItem')
            ->with('race')
            ->willReturnOnConsecutiveCalls($itemInitial, $itemStale, $itemWait);

        // Miss and can't lock
        $itemInitial->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::PRECOMPUTE, 60);
        $itemInitial->method('get')->willReturn(null);
        $itemInitial->method('isHit')->willReturn(false);
        $itemInitial->expects($this->once())->method('lock')->willReturn(false);

        // No stale available
        $itemStale->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::OLD);
        $itemStale->method('get')->willReturn(null);

        // Wait but still no hit
        $itemWait->expects($this->once())
            ->method('setInvalidationMethod')
            ->with(Invalidation::SLEEP, 150, 6);
        $itemWait->method('get')->willReturn(null);
        $itemWait->method('isHit')->willReturn(false);

        $loader = $this->createMock(LoaderInterface::class);
        $loader->expects($this->once())->method('resolve')->with($key)->willReturn('fallback');

        $jitter = $this->createMock(JitterInterface::class);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $res = $cache->get($key);

        $this->assertTrue($res->isHit(), 'Fail-open should produce a hit-like result with computed value');
        $this->assertSame('fallback', $res->value());
    }

    public function testPutSavesWithJitteredTtl(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $item = $this->createMock(ItemInterface::class);
        $key = $this->newKey('put');

        $pool->expects($this->once())->method('getItem')->with('put')->willReturn($item);
        $item->expects($this->once())->method('set')->with('v');
        $item->expects($this->once())->method('expiresAfter')->with(555);
        $pool->expects($this->once())->method('save')->with($item);

        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);
        $jitter->method('apply')->with(600, $key)->willReturn(555);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $cache->put($key, 'v');
        $this->addToAssertionCount(1); // if no exceptions, it's fine
    }

    public function testInvalidateAsyncAndSync(): void
    {
        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);
        $metrics = $this->createMock(MetricsInterface::class);
        $selector = $this->newKey('sel');

        // ASYNC invalidate should dispatch and not touch the driver
        $driverA = $this->createMock(StashDriverInterface::class);
        $poolA = $this->createMock(StashPoolInterface::class);
        $poolA->method('getDriver')->willReturn($driverA);
        $dispatcherA = $this->createMock(EventDispatcherInterface::class);
        $dispatcherA->expects($this->once())->method('dispatch')->with($this->anything());
        $driverA->expects($this->never())->method('clear');
        (new Cache($poolA, $loader, 600, 60, $jitter, $dispatcherA, $metrics))
            ->invalidate($selector, SyncMode::ASYNC);

        // SYNC invalidate should call driver->clear (hierarchical)
        $driverB = $this->createMock(StashDriverInterface::class);
        $poolB = $this->createMock(StashPoolInterface::class);
        $poolB->method('getDriver')->willReturn($driverB);
        $driverB->expects($this->once())->method('clear')->with($selector);
        (new Cache($poolB, $loader, 600, 60, $jitter, null, $metrics))
            ->invalidate($selector, SyncMode::SYNC);

        // invalidateExact SYNC should call clear with the exact flag
        $driverC = $this->createMock(StashDriverInterface::class);
        $poolC = $this->createMock(StashPoolInterface::class);
        $poolC->method('getDriver')->willReturn($driverC);
        $driverC->expects($this->once())->method('clear')->with($selector, true);
        (new Cache($poolC, $loader, 600, 60, $jitter, null, $metrics))
            ->invalidateExact($selector, SyncMode::SYNC);
    }

    public function testRefreshSyncLoadsAndPuts(): void
    {
        $pool = $this->createMock(StashPoolInterface::class);
        $item = $this->createMock(ItemInterface::class);
        $pool->method('getItem')->willReturn($item);

        $loader = $this->createMock(LoaderInterface::class);
        $jitter = $this->createMock(JitterInterface::class);

        $key = $this->newKey('r');
        $jitter->method('apply')->with(600, $key)->willReturn(600);

        $loader->expects($this->once())->method('resolve')->with($key)->willReturn('rv');
        $item->expects($this->once())->method('set')->with('rv');
        $item->expects($this->once())->method('expiresAfter')->with(600);
        $pool->expects($this->once())->method('save')->with($item);

        $cache = new Cache($pool, $loader, 600, 60, $jitter);
        $cache->refresh($key, SyncMode::SYNC);
    }
}
