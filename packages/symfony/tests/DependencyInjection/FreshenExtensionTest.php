<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\Tests\DependencyInjection;

use Freshen\AsyncHandler;
use Freshen\Bridge\Symfony\DependencyInjection\FreshenExtension;
use Freshen\Cache;
use Freshen\InvalidateEvent;
use Freshen\InvalidateExactEvent;
use Freshen\RefreshEvent;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\ContainerBuilder;

final class FreshenExtensionTest extends TestCase
{
    /**
     * @param array<string, mixed> $config
     */
    private function load(array $config): ContainerBuilder
    {
        $container = new ContainerBuilder();
        (new FreshenExtension())->load([$config], $container);

        return $container;
    }

    public function testSingleCacheRegistersServiceAndAliasesFreshenCache(): void
    {
        $container = $this->load([
            'connection' => 'Redis',
            'caches' => ['top_sellers' => ['loader' => 'App\\Loader', 'hard_ttl' => 3600, 'precompute' => 60]],
        ]);

        self::assertTrue($container->hasDefinition('freshen.cache.top_sellers'));
        self::assertTrue($container->hasDefinition('freshen.pool.Redis'));
        self::assertTrue($container->hasDefinition('freshen.driver.Redis'));

        // Exactly one cache → Freshen\Cache is aliased for plain autowiring.
        self::assertTrue($container->hasAlias(Cache::class));
        self::assertSame('freshen.cache.top_sellers', (string) $container->getAlias(Cache::class));

        // Cache is built with the configured scalars + the correct references.
        $args = $container->getDefinition('freshen.cache.top_sellers')->getArguments();
        self::assertSame(3600, $args[2]);
        self::assertSame(60, $args[3]);
        self::assertSame('event_dispatcher', (string) $args[5]);
        self::assertNull($args[6]); // no metrics
        self::assertTrue($args[7]); // fail_open default
    }

    public function testAsyncHandlerIsTaggedForAllThreeEvents(): void
    {
        $container = $this->load([
            'connection' => 'Redis',
            'caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 10]],
        ]);

        $handler = $container->getDefinition('freshen.async_handler.c');
        self::assertSame(AsyncHandler::class, $handler->getClass());

        $events = array_map(
            static fn (array $tag): string => $tag['event'],
            $handler->getTag('kernel.event_listener'),
        );
        self::assertContains(InvalidateEvent::class, $events);
        self::assertContains(InvalidateExactEvent::class, $events);
        self::assertContains(RefreshEvent::class, $events);
    }

    public function testMetricsReferenceWiredWhenConfigured(): void
    {
        $container = $this->load([
            'connection' => 'Redis',
            'caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 10, 'metrics' => 'App\\Metrics']],
        ]);

        $args = $container->getDefinition('freshen.cache.c')->getArguments();
        self::assertSame('App\\Metrics', (string) $args[6]);
    }

    public function testMultipleCachesUseNamedAutowiringNotAlias(): void
    {
        $container = $this->load([
            'connection' => 'Redis',
            'caches' => [
                'top_sellers' => ['loader' => 'L1', 'hard_ttl' => 10],
                'prices' => ['loader' => 'L2', 'hard_ttl' => 20],
            ],
        ]);

        self::assertTrue($container->hasDefinition('freshen.cache.top_sellers'));
        self::assertTrue($container->hasDefinition('freshen.cache.prices'));
        // No bare Freshen\Cache alias when there is more than one.
        self::assertFalse($container->hasAlias(Cache::class));
        // Named-argument autowiring aliases exist instead.
        self::assertTrue($container->hasAlias(Cache::class . ' $topSellersCache'));
        self::assertTrue($container->hasAlias(Cache::class . ' $pricesCache'));
    }

    public function testSharedPoolReusedAcrossCachesOnSameConnection(): void
    {
        $container = $this->load([
            'connection' => 'Redis',
            'caches' => [
                'a' => ['loader' => 'L1', 'hard_ttl' => 10],
                'b' => ['loader' => 'L2', 'hard_ttl' => 20],
            ],
        ]);

        // One pool/driver definition shared by both caches on the "Redis" connection.
        self::assertCount(1, array_filter(
            array_keys($container->getDefinitions()),
            static fn (string $id): bool => str_starts_with($id, 'freshen.pool.'),
        ));
    }

    public function testMissingConnectionThrows(): void
    {
        $this->expectException(InvalidConfigurationException::class);
        $this->expectExceptionMessageMatches('/no Redis connection/');
        $this->load(['caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 10]]]);
    }
}
