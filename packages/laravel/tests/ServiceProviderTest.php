<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests;

use Freshen\Bridge\Laravel\Facades\Freshen;
use Freshen\Bridge\Laravel\FreshenManager;
use Illuminate\Support\ServiceProvider;

/**
 * The provider registers the manager singleton, publishes the config, and wires the
 * `Freshen` facade to the manager. Caches are resolved by name through the manager /
 * facade — there is no "default" cache and no bare Freshen\Cache binding (a cache is one
 * dataset; a project has many). Asserted without resolving a cache (that needs live redis
 * — the integration lane).
 */
final class ServiceProviderTest extends TestCase
{
    /**
     * @param \Illuminate\Foundation\Application $app
     */
    protected function defineEnvironment($app): void
    {
        $app->make('config')->set('freshen', [
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
    }

    public function testFacadeResolvesToTheManager(): void
    {
        self::assertInstanceOf(FreshenManager::class, Freshen::getFacadeRoot());
        self::assertSame(['top_sellers', 'prices'], Freshen::names());
    }

    public function testNoDefaultCacheOrBareBinding(): void
    {
        // A Freshen cache is one dataset — nothing is bound to the bare Freshen\Cache type.
        self::assertFalse($this->app->bound(\Freshen\Cache::class));
        self::assertFalse($this->app->bound('freshen'));
    }

    public function testConfigPublishGroupIsRegistered(): void
    {
        self::assertArrayHasKey('freshen-config', ServiceProvider::$publishGroups);
    }
}
