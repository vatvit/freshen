<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Async;

use Freshen\AsyncEvent;
use Freshen\Bridge\Laravel\FreshenManager;
use Freshen\InvalidateEvent;
use Freshen\InvalidateExactEvent;
use Freshen\RefreshEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use LogicException;

/**
 * Queued worker for one Freshen async operation. Carries the target cache name and
 * the {@see AsyncEvent} (whose key is a serializable value object), then on the worker
 * resolves that cache's {@see \Freshen\AsyncHandler} and runs it SYNC — the class of
 * the event is the operation discriminator, so we route by instanceof.
 */
final class ProcessFreshenAsyncEvent implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public function __construct(
        public readonly string $cacheName,
        public readonly AsyncEvent $event,
    ) {
    }

    public function handle(FreshenManager $manager): void
    {
        $handler = $manager->handler($this->cacheName);

        // instanceof-in-if narrows the event type for the typed handler methods
        // (a match(true) arm would not narrow).
        $event = $this->event;
        if ($event instanceof InvalidateEvent) {
            $handler->handleInvalidation($event);

            return;
        }
        if ($event instanceof InvalidateExactEvent) {
            $handler->handleInvalidateExact($event);

            return;
        }
        if ($event instanceof RefreshEvent) {
            $handler->handleRefresh($event);

            return;
        }

        throw new LogicException(sprintf('freshen: unroutable async event %s.', $event::class));
    }
}
