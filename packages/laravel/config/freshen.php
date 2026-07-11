<?php

declare(strict_types=1);

/**
 * Freshen bridge configuration.
 *
 * Publish with:  php artisan vendor:publish --tag=freshen-config
 *
 * A Freshen cache is one **dataset** (its own loader + TTLs), so you define **one entry
 * per data structure** under `caches` — a real app has several. Resolve each by name:
 *
 *     use Freshen\Bridge\Laravel\Facades\Freshen;
 *     Freshen::cache('top_sellers')->get($key);
 *
 * There is no "default" cache — you always name the dataset you want.
 */
return [
    // Async invalidation/refresh are dispatched onto Laravel's queue (their handlers
    // run on a worker, off the request). Set connection to 'sync' to run inline.
    'queue' => [
        'connection' => env('FRESHEN_QUEUE_CONNECTION'), // null = default queue connection
        'queue' => env('FRESHEN_QUEUE'),                 // null = default queue name
    ],

    // One entry per dataset. Keys are the names you pass to Freshen::cache('<name>').
    'caches' => [
        'top_sellers' => [
            // Required: a container id / class implementing Freshen\Interface\LoaderInterface.
            'loader' => App\Cache\TopSellersLoader::class,

            // Hard TTL in seconds (>= 1).
            'hard_ttl' => 3600,

            // Seconds before the hard TTL to precompute (soft window); 0..hard_ttl.
            'precompute' => 60,

            // TTL jitter percent.
            'jitter' => 15,

            // Recompute-and-serve without caching under contention (true) vs MISS (false).
            'fail_open' => true,

            // Laravel redis connection name whose phpredis client Freshen reuses.
            'connection' => 'default',

            // Optional: a container id / class implementing Freshen\Interface\MetricsInterface.
            'metrics' => null,
        ],

        // A second dataset — its own loader, TTLs and (optionally) redis connection.
        'prices' => [
            'loader' => App\Cache\PricesLoader::class,
            'hard_ttl' => 600,
            'precompute' => 30,
            'connection' => 'default',
        ],
    ],
];
