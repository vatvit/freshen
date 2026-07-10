<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel;

use Freshen\AsyncHandler;
use Freshen\Bridge\Laravel\Async\QueueDispatcher;
use Freshen\Cache;
use Freshen\DefaultJitter;
use Freshen\Driver\Redis as FreshenRedis;
use Freshen\Interface\LoaderInterface;
use Freshen\Interface\MetricsInterface;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Illuminate\Contracts\Container\Container;
use InvalidArgumentException;
use Stash\Pool;

/**
 * Builds and memoizes the Freshen services from the `freshen` config: one
 * {@see Cache} per named cache (its own loader/TTLs, reusing Laravel's phpredis
 * client), a shared Stash pool per redis connection, and the per-cache
 * {@see QueueDispatcher} that routes async invalidation/refresh onto the queue.
 *
 * Resolved once as a singleton by {@see FreshenServiceProvider}; the queued
 * {@see Async\ProcessFreshenAsyncEvent} job resolves it again on the worker to get
 * the target cache's {@see AsyncHandler}.
 *
 * Not final so tests can override {@see handler()} to route the async job at an
 * in-memory cache (the redis pool build is the only backend-coupled part).
 */
class FreshenManager
{
    /** @var array<string, Cache> */
    private array $caches = [];

    /** @var array<string, Pool> */
    private array $pools = [];

    /**
     * @param array<string, mixed> $config the `freshen` config tree
     */
    public function __construct(
        private readonly Container $container,
        private readonly array $config,
    ) {
    }

    /** Build (or return the memoized) Cache for a configured cache name. */
    public function cache(string $name): Cache
    {
        if (isset($this->caches[$name])) {
            return $this->caches[$name];
        }

        $cacheConfig = $this->cacheConfig($name);

        /** @var string|null $loaderId */
        $loaderId = $cacheConfig['loader'] ?? null;
        if ($loaderId === null || $loaderId === '') {
            throw new InvalidArgumentException(
                sprintf('freshen: cache "%s" has no "loader" configured.', $name),
            );
        }

        /** @var LoaderInterface $loader */
        $loader = $this->container->make($loaderId);

        /** @var string $connection */
        $connection = $cacheConfig['connection'] ?? 'default';

        /** @var int $hardTtl */
        $hardTtl = $cacheConfig['hard_ttl'] ?? 3600;
        /** @var int $precompute */
        $precompute = $cacheConfig['precompute'] ?? 0;
        /** @var int $jitter */
        $jitter = $cacheConfig['jitter'] ?? 15;
        /** @var bool $failOpen */
        $failOpen = $cacheConfig['fail_open'] ?? true;

        /** @var string|null $metricsId */
        $metricsId = $cacheConfig['metrics'] ?? null;
        $metrics = null;
        if ($metricsId !== null && $metricsId !== '') {
            /** @var MetricsInterface $metrics */
            $metrics = $this->container->make($metricsId);
        }

        $cache = new Cache(
            $this->pool($connection),
            $loader,
            $hardTtl,
            $precompute,
            new DefaultJitter($jitter),
            $this->dispatcher($name),
            $metrics,
            $failOpen,
        );

        return $this->caches[$name] = $cache;
    }

    /** The AsyncHandler that drives a named cache synchronously (worker side). */
    public function handler(string $name): AsyncHandler
    {
        return new AsyncHandler($this->cache($name));
    }

    /**
     * Names of every configured cache.
     *
     * @return list<string>
     */
    public function names(): array
    {
        /** @var array<string, mixed> $caches */
        $caches = $this->config['caches'] ?? [];

        return array_keys($caches);
    }

    /** Shared Stash pool for a Laravel redis connection, reusing its phpredis client. */
    private function pool(string $connection): Pool
    {
        if (isset($this->pools[$connection])) {
            return $this->pools[$connection];
        }

        // Reuse the app's configured phpredis client rather than opening a second
        // connection. make('redis') is the RedisManager (a Redis Factory); its
        // connection() is untyped in the contract, so narrow both hops for PHPStan.
        /** @var \Illuminate\Contracts\Redis\Factory $manager */
        $manager = $this->container->make('redis');
        /** @var \Illuminate\Redis\Connections\Connection $conn */
        $conn = $manager->connection($connection);
        /** @var \Redis $client */
        $client = $conn->client();

        $driver = new FreshenRedis(['connection' => $client]);

        return $this->pools[$connection] = new Pool($driver);
    }

    private function dispatcher(string $name): QueueDispatcher
    {
        /** @var array<string, mixed> $queue */
        $queue = $this->config['queue'] ?? [];
        /** @var string|null $connection */
        $connection = $queue['connection'] ?? null;
        /** @var string|null $queueName */
        $queueName = $queue['queue'] ?? null;

        /** @var BusDispatcher $bus */
        $bus = $this->container->make(BusDispatcher::class);

        return new QueueDispatcher($name, $bus, $connection, $queueName);
    }

    /**
     * @return array<string, mixed>
     */
    private function cacheConfig(string $name): array
    {
        /** @var array<string, array<string, mixed>> $caches */
        $caches = $this->config['caches'] ?? [];

        if (!isset($caches[$name])) {
            throw new InvalidArgumentException(sprintf('freshen: no cache named "%s" is configured.', $name));
        }

        return $caches[$name];
    }
}
