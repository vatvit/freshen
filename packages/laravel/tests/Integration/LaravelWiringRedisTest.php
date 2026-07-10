<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests\Integration;

use Freshen\Bridge\Laravel\Facades\Freshen;
use Freshen\Bridge\Laravel\Tests\CountingLoader;
use Freshen\Bridge\Laravel\Tests\TestCase;
use Freshen\Key;

/**
 * End-to-end wiring against a live Redis: boot a real Laravel (Testbench) app with the
 * Freshen provider, resolve Freshen\Cache (built over Laravel's phpredis client), then
 * prove cold-fill works and that an async invalidate() — dispatched onto the queue and
 * run inline via the `sync` connection → AsyncHandler → SYNC invalidate — drops the entry.
 *
 * Skipped unless ext-redis is present and a Redis is reachable (the integration lane;
 * see scripts/laravel-it.sh).
 */
final class LaravelWiringRedisTest extends TestCase
{
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

        parent::setUp();

        /** @var CountingLoader $loader */
        $loader = $this->app->make(CountingLoader::class);
        $this->loader = $loader;
    }

    /**
     * @param \Illuminate\Foundation\Application $app
     */
    protected function defineEnvironment($app): void
    {
        $host = getenv('REDIS_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('REDIS_PORT') ?: 6379);

        $config = $app->make('config');
        $config->set('database.redis.client', 'phpredis');
        $config->set('database.redis.default', [
            'host' => $host,
            'port' => $port,
            'database' => 0,
        ]);
        // Run queued async jobs inline so the invalidation completes within the test.
        $config->set('queue.default', 'sync');

        $config->set('freshen', [
            'queue' => ['connection' => null, 'queue' => null],
            'caches' => [
                'it' => [
                    'loader' => CountingLoader::class,
                    'hard_ttl' => 3600,
                    'precompute' => 0,
                    'jitter' => 0,
                    'connection' => 'default',
                ],
            ],
        ]);

        // Shared loader instance so the test can read its call count.
        $app->singleton(CountingLoader::class);
    }

    public function testColdFillThenAsyncInvalidateDropsEntry(): void
    {
        $cache = Freshen::cache('it');
        $key = new Key('product', 'detail', 7);

        // 1) cold key → fill via loader.
        $first = $cache->get($key);
        self::assertTrue($first->isHit());
        self::assertSame('v1', $first->value());
        self::assertSame(1, $this->loader->calls);

        // 2) warm hit — no recompute.
        self::assertSame('v1', $cache->get($key)->value());
        self::assertSame(1, $this->loader->calls);

        // 3) async invalidate() → QueueDispatcher → job (sync) → AsyncHandler → SYNC clear.
        $cache->invalidate($key);

        // 4) next get recomputes and returns the fresh value.
        self::assertSame('v2', $cache->get($key)->value());
        self::assertSame(2, $this->loader->calls, 'invalidation forced a recompute');
    }
}
