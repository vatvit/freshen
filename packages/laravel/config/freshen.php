<?php

declare(strict_types=1);

/**
 * Freshen bridge configuration.
 *
 * Publish with:  php artisan vendor:publish --tag=freshen-config
 *
 * Each entry under `caches` builds one Freshen\Cache (its own loader + TTLs). The
 * cache named by `default` is aliased to Freshen\Cache for plain constructor injection;
 * every cache is also bound by its service id `freshen.cache.<name>`.
 */
return [
    // Name of the cache aliased to Freshen\Cache (and resolvable as `freshen`).
    'default' => 'default',

    // Async invalidation/refresh are dispatched onto Laravel's queue (their handlers
    // run on a worker, off the request). Set connection to 'sync' to run inline.
    'queue' => [
        'connection' => env('FRESHEN_QUEUE_CONNECTION'), // null = default queue connection
        'queue' => env('FRESHEN_QUEUE'),                 // null = default queue name
    ],

    'caches' => [
        'default' => [
            // Required: a container id / class implementing Freshen\Interface\LoaderInterface.
            'loader' => null,

            // Hard TTL in seconds (>= 1).
            'hard_ttl' => 3600,

            // Seconds before the hard TTL to precompute (soft window); 0..hard_ttl.
            'precompute' => 0,

            // TTL jitter percent.
            'jitter' => 15,

            // Recompute-and-serve without caching under contention (true) vs MISS (false).
            'fail_open' => true,

            // Laravel redis connection name whose phpredis client Freshen reuses.
            'connection' => 'default',

            // Optional: a container id / class implementing Freshen\Interface\MetricsInterface.
            'metrics' => null,
        ],
    ],
];
