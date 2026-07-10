<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests;

use Freshen\Bridge\Laravel\Async\ProcessFreshenAsyncEvent;
use Freshen\Bridge\Laravel\Async\QueueDispatcher;
use Freshen\InvalidateEvent;
use Freshen\Key;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Illuminate\Support\Facades\Bus;

/**
 * The async seam: dispatching a Freshen event enqueues a job carrying the target
 * cache name + event (and the configured connection/queue); non-Freshen events are
 * ignored. No live backend — the bus is faked.
 */
final class QueueDispatcherTest extends TestCase
{
    public function testFreshenEventEnqueuesJobWithCacheNameAndEvent(): void
    {
        Bus::fake();
        $dispatcher = new QueueDispatcher('top_sellers', $this->app->make(BusDispatcher::class), null, null);

        $key = new Key('product', 'detail', 7);
        $dispatcher->dispatch(new InvalidateEvent($key));

        Bus::assertDispatched(
            ProcessFreshenAsyncEvent::class,
            static fn (ProcessFreshenAsyncEvent $job): bool =>
                $job->cacheName === 'top_sellers' && $job->event instanceof InvalidateEvent,
        );
    }

    public function testConnectionAndQueueAreAppliedToJob(): void
    {
        Bus::fake();
        $dispatcher = new QueueDispatcher('c', $this->app->make(BusDispatcher::class), 'redis', 'freshen');

        $dispatcher->dispatch(new InvalidateEvent(new Key('a', 'b', 1)));

        Bus::assertDispatched(
            ProcessFreshenAsyncEvent::class,
            static fn (ProcessFreshenAsyncEvent $job): bool =>
                $job->connection === 'redis' && $job->queue === 'freshen',
        );
    }

    public function testNonFreshenEventIsIgnored(): void
    {
        Bus::fake();
        $dispatcher = new QueueDispatcher('c', $this->app->make(BusDispatcher::class), null, null);

        $event = new \stdClass();
        $returned = $dispatcher->dispatch($event);

        self::assertSame($event, $returned);
        Bus::assertNothingDispatched();
    }
}
