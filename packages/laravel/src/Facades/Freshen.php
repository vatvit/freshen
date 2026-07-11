<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Facades;

use Freshen\Bridge\Laravel\FreshenManager;
use Illuminate\Support\Facades\Facade;

/**
 * Facade for resolving caches by name — the idiomatic Laravel way to reach one of several
 * same-type instances (cf. `Cache::store()`, `DB::connection()`). A Freshen cache is one
 * **dataset** (its own loader + TTLs), so a project defines *many* and always asks for one
 * by name — there is no "default" cache:
 *
 *   Freshen::cache('top_sellers')
 *   Freshen::cache('prices')
 *
 * Auto-registered as the `Freshen` alias via package discovery (composer `extra.laravel`).
 *
 * @method static \Freshen\Cache cache(string $name)
 * @method static \Freshen\AsyncHandler handler(string $name)
 * @method static list<string> names()
 *
 * @see FreshenManager
 */
final class Freshen extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return FreshenManager::class;
    }
}
