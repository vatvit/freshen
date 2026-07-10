<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\Tests\Integration;

use Freshen\Bridge\Symfony\DependencyInjection\FreshenExtension;
use Freshen\Cache;
use Freshen\Key;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\EventDispatcher\DependencyInjection\RegisterListenersPass;
use Symfony\Component\EventDispatcher\EventDispatcher;

/**
 * End-to-end wiring against a live Redis: compile the real container the bundle
 * produces (pool → Freshen\Driver\Redis → Cache, plus the AsyncHandler tagged onto a
 * real Symfony PSR-14 dispatcher), then prove a cold-key fill works and that an async
 * invalidate() — routed through the dispatcher — actually drops the entry.
 *
 * Skipped unless ext-redis is present and a Redis is reachable (the integration lane;
 * see scripts/symfony-it.sh).
 */
final class SymfonyWiringRedisTest extends TestCase
{
    private ContainerBuilder $container;
    private \Redis $redis;
    private Cache $cache;
    private CountingLoader $loader;

    protected function setUp(): void
    {
        if (!extension_loaded('redis')) {
            self::markTestSkipped('ext-redis not loaded.');
        }

        $host = getenv('REDIS_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('REDIS_PORT') ?: 6379);

        $probe = new \Redis();
        if (!@$probe->connect($host, $port, 0.5)) {
            self::markTestSkipped("No Redis at {$host}:{$port}.");
        }
        $probe->flushDB();
        $probe->close();

        $this->container = $this->buildContainer($host, $port);

        $this->redis = $this->container->get('Redis');
        $this->cache = $this->container->get(Cache::class);
        $this->loader = $this->container->get('test.loader');
    }

    private function buildContainer(string $host, int $port): ContainerBuilder
    {
        $container = new ContainerBuilder();
        $container->setParameter('event_dispatcher.event_aliases', []);

        // A real PSR-14 dispatcher (stands in for Symfony's `event_dispatcher`).
        $container->setDefinition('event_dispatcher', (new Definition(EventDispatcher::class))->setPublic(true));

        // The app-provided \Redis client the bundle's driver reuses.
        $redis = new Definition(\Redis::class);
        $redis->addMethodCall('connect', [$host, $port]);
        $redis->setPublic(true);
        $container->setDefinition('Redis', $redis);

        // The app-provided loader.
        $container->setDefinition('test.loader', (new Definition(CountingLoader::class))->setPublic(true));

        (new FreshenExtension())->load([[
            'connection' => 'Redis',
            'caches' => [
                'it' => ['loader' => 'test.loader', 'hard_ttl' => 3600, 'precompute' => 0, 'jitter' => 0],
            ],
        ]], $container);

        // Attach the `kernel.event_listener`-tagged AsyncHandler to the dispatcher,
        // exactly as FrameworkBundle would.
        $container->addCompilerPass(new RegisterListenersPass());
        $container->compile();

        return $container;
    }

    public function testColdKeyFillsThenAsyncInvalidateDropsEntry(): void
    {
        $key = new Key('product', 'detail', 7);

        // 1) cold key → fill via loader, returns a hit with the computed value.
        $first = $this->cache->get($key);
        self::assertTrue($first->isHit());
        self::assertSame('v1', $first->value());
        self::assertSame(1, $this->loader->calls);
        self::assertGreaterThan(0, $this->redis->dbSize(), 'value was written to Redis');

        // 2) warm hit — no recompute.
        $second = $this->cache->get($key);
        self::assertSame('v1', $second->value());
        self::assertSame(1, $this->loader->calls);

        // 3) async invalidate() dispatches InvalidateEvent → AsyncHandler → SYNC invalidate.
        //    The in-process dispatcher runs listeners inline, so the delete has happened
        //    by the time invalidate() returns.
        $this->cache->invalidate($key);

        // 4) next get recomputes (loader called again) and returns the fresh value.
        $third = $this->cache->get($key);
        self::assertSame('v2', $third->value());
        self::assertSame(2, $this->loader->calls, 'invalidation forced a recompute');
    }
}
