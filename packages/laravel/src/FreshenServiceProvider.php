<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel;

use Freshen\Cache;
use Illuminate\Contracts\Config\Repository as ConfigRepository;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\ServiceProvider;

/**
 * Registers Freshen with Laravel: merges/publishes `config/freshen.php`, exposes the
 * {@see FreshenManager} singleton, binds one `freshen.cache.<name>` service per
 * configured cache, and aliases the configured default cache to {@see Cache} (plain
 * constructor injection) and to `freshen`.
 *
 * Auto-discovered via `extra.laravel.providers` — no manual registration.
 */
final class FreshenServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/freshen.php', 'freshen');

        $this->app->singleton(FreshenManager::class, function (Container $app): FreshenManager {
            /** @var ConfigRepository $repository */
            $repository = $app->make('config');
            /** @var array<string, mixed> $config */
            $config = $repository->get('freshen', []);

            return new FreshenManager($app, $config);
        });
    }

    public function boot(): void
    {
        // Bind the per-cache services in boot(), where `freshen` config is final
        // (env setup + every provider registered) — reading it in register() would
        // capture a stale tree if config is set after this provider registers.
        foreach ($this->configuredCacheNames() as $name) {
            $this->app->singleton('freshen.cache.' . $name, function (Container $app) use ($name): Cache {
                return $app->make(FreshenManager::class)->cache($name);
            });
        }

        // Alias the default cache to Freshen\Cache (plain injection) and to `freshen`.
        $default = $this->defaultCacheName();
        if ($default !== null) {
            $this->app->singleton(Cache::class, function (Container $app) use ($default): Cache {
                return $app->make(FreshenManager::class)->cache($default);
            });
            $this->app->alias(Cache::class, 'freshen');
        }

        $this->publishes([
            __DIR__ . '/../config/freshen.php' => $this->app->make('path.config') . '/freshen.php',
        ], 'freshen-config');
    }

    /**
     * @return list<string>
     */
    private function configuredCacheNames(): array
    {
        /** @var array<string, mixed> $caches */
        $caches = $this->config()->get('freshen.caches', []);

        return array_keys($caches);
    }

    private function defaultCacheName(): ?string
    {
        /** @var string|null $default */
        $default = $this->config()->get('freshen.default');
        if ($default === null) {
            return null;
        }

        /** @var array<string, mixed> $caches */
        $caches = $this->config()->get('freshen.caches', []);

        return isset($caches[$default]) ? $default : null;
    }

    private function config(): ConfigRepository
    {
        /** @var ConfigRepository $repository */
        $repository = $this->app->make('config');

        return $repository;
    }
}
