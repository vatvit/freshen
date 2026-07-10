<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests;

use Freshen\AsyncHandler;
use Freshen\Bridge\Laravel\Async\ProcessFreshenAsyncEvent;
use Freshen\Bridge\Laravel\FreshenManager;
use Freshen\Cache;
use Freshen\DefaultJitter;
use Freshen\InvalidateExactEvent;
use Freshen\Key;
use Freshen\RefreshEvent;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase as PhpUnitTestCase;
use Stash\Driver\Ephemeral;
use Stash\Pool;

/**
 * The queued job routes each async event class to the matching AsyncHandler method,
 * proved by effect on an in-memory (Ephemeral) cache — no redis, no queue. A test
 * manager returns the handler over that cache; the real manager only differs in
 * building a redis-backed pool.
 */
final class AsyncRoutingTest extends PhpUnitTestCase
{
    private CountingLoader $loader;
    private Cache $cache;
    private FreshenManager $manager;

    protected function setUp(): void
    {
        $this->loader = new CountingLoader();
        $this->cache = new Cache(
            new Pool(new Ephemeral()),
            $this->loader,
            3600,
            0,
            new DefaultJitter(0),
            null,
            null,
            true,
        );

        $cache = $this->cache;
        $this->manager = new class(new Container(), []) extends FreshenManager {
            public AsyncHandler $handler;

            public function handler(string $name): AsyncHandler
            {
                return $this->handler;
            }
        };
        $this->manager->handler = new AsyncHandler($cache);
    }

    public function testRefreshEventRecomputesAndStores(): void
    {
        $key = new Key('product', 'detail', 7);

        (new ProcessFreshenAsyncEvent('any', new RefreshEvent($key)))->handle($this->manager);

        self::assertSame(1, $this->loader->calls, 'refresh recomputed via the loader');
        self::assertSame('v1', $this->cache->get($key)->value());
    }

    public function testInvalidateExactEventDropsTheEntry(): void
    {
        $key = new Key('product', 'detail', 7);

        // Prime the entry.
        self::assertSame('v1', $this->cache->get($key)->value());
        self::assertSame(1, $this->loader->calls);

        // Route an exact-invalidation through the job.
        (new ProcessFreshenAsyncEvent('any', new InvalidateExactEvent($key)))->handle($this->manager);

        // Next read recomputes → loader called again.
        self::assertSame('v2', $this->cache->get($key)->value());
        self::assertSame(2, $this->loader->calls);
    }
}
