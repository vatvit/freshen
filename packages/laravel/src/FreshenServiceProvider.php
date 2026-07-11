<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel;

use Illuminate\Contracts\Config\Repository as ConfigRepository;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\ServiceProvider;

/**
 * Registers Freshen with Laravel: merges/publishes `config/freshen.php` and exposes the
 * {@see FreshenManager} singleton. Caches are resolved **by name** through the manager /
 * the `Freshen` facade (`Freshen::cache('top_sellers')`) — a Freshen cache is one dataset,
 * so a project has many and there is no "default" cache to bind by bare type.
 *
 * Auto-discovered via `extra.laravel.providers` (+ the `Freshen` facade alias) — no manual
 * registration.
 */
final class FreshenServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/freshen.php', 'freshen');

        // The manager reads `freshen` config lazily on first resolve (after env setup +
        // every provider has registered), so it always sees the final config tree.
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
        $this->publishes([
            __DIR__ . '/../config/freshen.php' => $this->app->make('path.config') . '/freshen.php',
        ], 'freshen-config');
    }
}
