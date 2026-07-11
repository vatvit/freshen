<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Async;

use Freshen\AsyncEvent;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Psr\EventDispatcher\EventDispatcherInterface;

/**
 * PSR-14 dispatcher adapter for Laravel. Freshen calls this on the ASYNC path;
 * for a Freshen {@see AsyncEvent} it enqueues a {@see ProcessFreshenAsyncEvent}
 * job carrying the target cache name + event, so the invalidation/refresh runs on
 * a queue worker (off the request). A `sync` queue connection runs it inline.
 *
 * One dispatcher per cache: the cache name is captured here because Freshen's events
 * carry only a key, not a cache id — the job needs the name to resolve the right cache.
 * Non-Freshen events are ignored (this adapter exists solely for Freshen's async seam).
 */
final class QueueDispatcher implements EventDispatcherInterface
{
    public function __construct(
        private readonly string $cacheName,
        private readonly BusDispatcher $bus,
        private readonly ?string $connection,
        private readonly ?string $queue,
    ) {
    }

    public function dispatch(object $event): object
    {
        if ($event instanceof AsyncEvent) {
            $job = new ProcessFreshenAsyncEvent($this->cacheName, $event);

            if ($this->connection !== null) {
                $job->onConnection($this->connection);
            }
            if ($this->queue !== null) {
                $job->onQueue($this->queue);
            }

            $this->bus->dispatch($job);
        }

        return $event;
    }
}
