<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests;

use Freshen\Bridge\Laravel\FreshenManager;
use Freshen\Cache;
use Illuminate\Support\ServiceProvider;

/**
 * The provider registers the manager, one binding per configured cache, and aliases
 * the default cache to Freshen\Cache + `freshen` — asserted on the container bindings
 * without resolving them (resolving would need a live redis; that is the integration
 * lane). Also checks config merge + the publish group.
 */
final class ServiceProviderTest extends TestCase
{
    /**
     * @param \Illuminate\Foundation\Application $app
     */
    protected function defineEnvironment($app): void
    {
        $app->make('config')->set('freshen', [
            'default' => 'top_sellers',
            'queue' => ['connection' => null, 'queue' => null],
            'caches' => [
                'top_sellers' => ['loader' => CountingLoader::class, 'hard_ttl' => 3600],
                'prices' => ['loader' => CountingLoader::class, 'hard_ttl' => 600],
            ],
        ]);
    }

    public function testManagerIsRegisteredAsSingleton(): void
    {
        $a = $this->app->make(FreshenManager::class);
        $b = $this->app->make(FreshenManager::class);

        self::assertInstanceOf(FreshenManager::class, $a);
        self::assertSame($a, $b);
        self::assertSame(['top_sellers', 'prices'], $a->names());
        self::assertSame('top_sellers', $a->defaultName());
    }

    public function testOneBindingPerConfiguredCache(): void
    {
        self::assertTrue($this->app->bound('freshen.cache.top_sellers'));
        self::assertTrue($this->app->bound('freshen.cache.prices'));
    }

    public function testDefaultCacheIsAliasedToFreshenCacheAndFreshen(): void
    {
        self::assertTrue($this->app->bound(Cache::class));
        self::assertTrue($this->app->bound('freshen'));
        // `freshen` and Freshen\Cache resolve to the same (default) binding.
        self::assertSame(Cache::class, $this->app->getAlias('freshen'));
    }

    public function testConfigPublishGroupIsRegistered(): void
    {
        self::assertArrayHasKey('freshen-config', ServiceProvider::$publishGroups);
    }
}
