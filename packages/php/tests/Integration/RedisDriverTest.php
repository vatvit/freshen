<?php

declare(strict_types=1);

namespace Freshen\Tests\Integration;

use Freshen\Driver\Redis;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Live-Redis behavioural coverage for Freshen\Driver\Redis. Excluded from the
 * default unit suite (REQUIREMENTS §5: no live Redis in unit tests) — run via
 * scripts/php-redis-it.sh against a real Redis with ext-redis loaded.
 *
 * Covers the four Stash patches the driver exists for: injected-connection reuse
 * (FRSH-010 regression), atomic SET NX single-flight, exact vs hierarchical clear,
 * and the null-key whole-store-flush rejection.
 *
 * Assertions inspect the injected client's keyspace (dbSize) rather than
 * Driver::getData for negative cases, to avoid Stash's unserialize(false) warning
 * on a miss tripping PHPUnit's failOnWarning.
 */
#[Group('integration')]
final class RedisDriverTest extends TestCase
{
    private const DB = 5;

    private \Redis $client;
    private Redis $driver;

    protected function setUp(): void
    {
        if (!extension_loaded('redis')) {
            self::markTestSkipped('ext-redis is not loaded.');
        }

        $host = getenv('REDIS_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('REDIS_PORT') ?: '6379');

        $client = new \Redis();
        try {
            if (!$client->connect($host, $port)) {
                self::markTestSkipped("Could not connect to Redis at {$host}:{$port}.");
            }
        } catch (\RedisException $e) {
            self::markTestSkipped("Redis unavailable at {$host}:{$port}: {$e->getMessage()}");
        }

        $client->select(self::DB);
        $client->flushDB();

        $this->client = $client;
        // Constructing with 'connection' exercises the injection branch and avoids the
        // parent's default localhost connect (which would fail in the test container).
        $this->driver = new Redis(['connection' => $client]);
    }

    public function testInjectedConnectionIsReusedNotOverwritten(): void
    {
        // FRSH-010 regression: parent::setOptions() would build a fresh localhost
        // client and discard the injected one. If that happened, writes would not
        // land on our client's selected DB (and construction would have failed to
        // reach localhost). The write appearing on db5 proves the client is reused.
        $this->driver->storeData(['cache', 'reuse'], 'v', time() + 100);

        self::assertSame(1, $this->client->dbSize(), 'write must land on the injected client');
    }

    public function testSetOptionsWithConnectionIsIdempotentAndKeepsWorking(): void
    {
        // Re-injecting the same connection must keep the driver operational.
        $this->driver->setOptions(['connection' => $this->client]);
        $this->driver->storeData(['cache', 'again'], 'v', time() + 100);

        self::assertSame(1, $this->client->dbSize());
    }

    public function testSetOptionsRejectsNonRedisConnection(): void
    {
        $driver = $this->driver;

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('must be an instance of');
        // A non-\Redis/\RedisCluster connection must be rejected.
        $driver->setOptions(['connection' => new \stdClass()]);
    }

    public function testStoreAndGetRoundTrip(): void
    {
        $this->driver->storeData(['cache', 'a'], 'hello', time() + 100);

        $data = $this->driver->getData(['cache', 'a']);
        self::assertIsArray($data);
        self::assertSame('hello', $data['data']);
    }

    public function testSpKeyUsesSetNxSingleFlight(): void
    {
        // 'sp'-prefixed keys route to storeAsLock() → SET NX: the first writer wins,
        // concurrent writers get false. This is the atomic single-flight stock Stash
        // lacks (Item::lock() otherwise always "wins").
        self::assertTrue($this->driver->storeData(['sp', 'lock1'], 'x', 100), 'first NX write wins');
        self::assertFalse($this->driver->storeData(['sp', 'lock1'], 'x', 100), 'second NX write loses');
    }

    #[DataProvider('invalidLockTtlProvider')]
    public function testSpKeyRejectsOutOfRangeTtl(int $ttl): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid TTL');
        $this->driver->storeData(['sp', 'badttl'], 'x', $ttl);
    }

    /** @return array<string, array{0:int}> */
    public static function invalidLockTtlProvider(): array
    {
        return [
            'zero'          => [0],
            'negative'      => [-5],
            'above 300 cap' => [301],
        ];
    }

    public function testExactClearRemovesOnlyTheDirectKey(): void
    {
        $this->driver->storeData(['cache', 'exact'], 'v', time() + 100);
        self::assertSame(1, $this->client->dbSize(), 'precondition: one key stored');

        // Exact clear deletes the direct item without incrementing the path index.
        self::assertTrue($this->driver->clear(['cache', 'exact'], true));
        self::assertSame(0, $this->client->dbSize(), 'exact clear removes the direct key, no index left behind');
    }

    public function testHierarchicalClearBumpsThePathIndex(): void
    {
        $this->driver->storeData(['cache', 'parent', 'child'], 'v', time() + 100);
        self::assertSame(1, $this->client->dbSize());

        // Hierarchical clear increments the parent's path index (a new counter key)
        // so all children are invalidated — the cascade stock Stash always does.
        self::assertTrue($this->driver->clear(['cache', 'parent']));
        self::assertSame(2, $this->client->dbSize(), 'a path-index counter key must appear');
    }

    public function testNullKeyClearIsRejected(): void
    {
        $this->driver->storeData(['cache', 'keep'], 'v', time() + 100);

        try {
            $this->driver->clear(null);
            self::fail('clear(null) must throw — Freshen does not flush the whole store');
        } catch (\RuntimeException $e) {
            self::assertStringContainsString('does not support flushing', $e->getMessage());
        }

        // Crucially, the store was NOT flushed.
        self::assertSame(1, $this->client->dbSize(), 'the store must remain intact after a rejected flush');
    }
}
