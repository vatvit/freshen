<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\DependencyInjection;

use Freshen\AsyncHandler;
use Freshen\Cache;
use Freshen\DefaultJitter;
use Freshen\Driver\Redis as FreshenRedis;
use Freshen\InvalidateEvent;
use Freshen\InvalidateExactEvent;
use Freshen\RefreshEvent;
use Stash\Pool;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\DependencyInjection\Extension\Extension;
use Symfony\Component\DependencyInjection\Reference;

/**
 * Turns the `freshen` config into one {@see Cache} service per named cache, plus the
 * shared Stash pool/driver per connection and an {@see AsyncHandler} listener wired to
 * Symfony's PSR-14 `event_dispatcher` for each cache.
 *
 * Each cache is injected **by name** via a named-argument autowiring alias
 * (`Freshen\Cache $fooCache`), for one or many caches alike — a cache is one dataset, so
 * there is no bare `Freshen\Cache` "default".
 */
final class FreshenExtension extends Extension
{
    /**
     * @param array<int, array<string, mixed>> $configs
     */
    public function load(array $configs, ContainerBuilder $container): void
    {
        $config = $this->processConfiguration(new Configuration(), $configs);

        /** @var string|null $defaultConnection */
        $defaultConnection = $config['connection'] ?? null;
        /** @var array<string, array<string, mixed>> $caches */
        $caches = $config['caches'] ?? [];

        $cacheServiceIds = [];

        foreach ($caches as $name => $cache) {
            /** @var string|null $connection */
            $connection = $cache['connection'] ?? $defaultConnection;
            if ($connection === null || $connection === '') {
                throw new InvalidConfigurationException(sprintf(
                    'freshen: cache "%s" has no Redis connection and no top-level "connection" default is set.',
                    $name,
                ));
            }

            $poolId = $this->registerPool($container, $connection);

            /** @var int $jitterPercent */
            $jitterPercent = $cache['jitter'];
            $jitterId = 'freshen.jitter.' . $name;
            $container->setDefinition(
                $jitterId,
                (new Definition(DefaultJitter::class, [$jitterPercent]))->setPublic(false),
            );

            /** @var string $loader */
            $loader = $cache['loader'];
            /** @var string|null $metrics */
            $metrics = $cache['metrics'] ?? null;

            $cacheId = 'freshen.cache.' . $name;
            $container->setDefinition($cacheId, new Definition(Cache::class, [
                new Reference($poolId),
                new Reference($loader),
                $cache['hard_ttl'],
                $cache['precompute'],
                new Reference($jitterId),
                new Reference('event_dispatcher'),
                $metrics !== null ? new Reference($metrics) : null,
                $cache['fail_open'],
            ]));

            $this->registerAsyncHandler($container, $name, $cacheId);

            $cacheServiceIds[$name] = $cacheId;
        }

        $this->registerAutowiringAliases($container, $cacheServiceIds);
    }

    /**
     * Register (idempotently) the Stash pool + Freshen Redis driver for a connection
     * service id. Shared across every cache that names the same connection.
     */
    private function registerPool(ContainerBuilder $container, string $connection): string
    {
        $poolId = 'freshen.pool.' . $connection;
        if ($container->hasDefinition($poolId)) {
            return $poolId;
        }

        $driverId = 'freshen.driver.' . $connection;
        $container->setDefinition(
            $driverId,
            (new Definition(FreshenRedis::class, [['connection' => new Reference($connection)]]))->setPublic(false),
        );
        $container->setDefinition(
            $poolId,
            (new Definition(Pool::class, [new Reference($driverId)]))->setPublic(false),
        );

        return $poolId;
    }

    /**
     * One AsyncHandler per cache, tagged as a listener for each of the three async
     * events on the shared `event_dispatcher`.
     */
    private function registerAsyncHandler(ContainerBuilder $container, string $name, string $cacheId): void
    {
        $handler = new Definition(AsyncHandler::class, [new Reference($cacheId)]);
        $handler->setPublic(false);

        foreach ([
            [InvalidateEvent::class, 'handleInvalidation'],
            [InvalidateExactEvent::class, 'handleInvalidateExact'],
            [RefreshEvent::class, 'handleRefresh'],
        ] as [$event, $method]) {
            $handler->addTag('kernel.event_listener', ['event' => $event, 'method' => $method]);
        }

        $container->setDefinition('freshen.async_handler.' . $name, $handler);
    }

    /**
     * Make each cache injectable **by name** via named-argument autowiring, so a
     * controller requests `Freshen\Cache $topSellersCache` (the argument name is the
     * camel-cased cache name + `Cache`). This holds for one or many caches alike: a
     * Freshen cache is one dataset, so there is no bare `Freshen\Cache` "default" —
     * that would silently break the moment a second dataset is added.
     *
     * @param array<string, string> $cacheServiceIds  cache name => service id
     */
    private function registerAutowiringAliases(ContainerBuilder $container, array $cacheServiceIds): void
    {
        foreach ($cacheServiceIds as $name => $serviceId) {
            $container->registerAliasForArgument($serviceId, Cache::class, $this->camelCase($name) . 'Cache');
        }
    }

    private function camelCase(string $name): string
    {
        return lcfirst(str_replace(' ', '', ucwords(str_replace(['_', '-', '.'], ' ', $name))));
    }
}
