<?php

declare(strict_types=1);

namespace Freshen;

use Stash\Driver\Redis as BaseRedis;

/**
 * Extension of Stash's built-in Redis driver that:
 *  1) Allows injecting a ready Redis connection via setOptions(['connection' => \Redis|\RedisCluster]).
 *  2) Uses NX when storing data for keys whose first segment equals 'sp' (single-put).
 *
 * Notes:
 *  - This code targets the PECL phpredis client, as Stash’s Redis driver is based on it.
 *  - If your project uses a custom Stash serializer/compressor, mirror that in the NX branch (see comment).
 */
final class MyRedisDriver extends BaseRedis
{
    /**
     * setOptions override:
     *  - Accepts ['connection' => \Redis|\RedisCluster] to reuse an existing client.
     *  - Falls back to parent behavior for standard options (servers, password, prefix, database, …).
     */
    public function setOptions(array $options = []): void
    {
        if (array_key_exists('connection', $options) && $options['connection'] !== null) {
            $conn = $options['connection'];
            if (!($conn instanceof \Redis) && !($conn instanceof \RedisCluster)) {
                throw new \InvalidArgumentException('Option "connection" must be an instance of \Redis or \RedisCluster.');
            }
            $this->redis = $conn;
        }

        // No external connection supplied — use parent setup (servers, auth, etc.).
        parent::setOptions($options);
    }

    public function storeData($key, $data, $expiration): bool
    {
        if (is_array($key) && isset($key[0]) && $key[0] === 'sp') {
            return $this->storeAsLock($key, $data, $expiration);
        }
        return parent::storeData($key, $data, $expiration);
    }

    /**
     * Store value using Redis SET NX (+ TTL) to emulate a lock/single-put.
     * Returns true only if the key did not exist and was set.
     */
    private function storeAsLock(array $key, mixed $data, int $ttl): bool
    {
        if ($ttl <= 0 || $ttl > 300) {
            throw new \InvalidArgumentException('Invalid TTL');
        }

        $opts = ['NX', 'EX' => $ttl];
        $ok = $this->redis->set($this->makeKeyString($key, true), $data, $opts);
        return $ok === true;
    }

    public function clear($key = null, bool $exact = false): bool
    {
        if ($key === null) {
            throw new \RuntimeException('Key must be provided');
        }

        if ($exact) {
            $keyReal = $this->makeKeyString($key);
            $this->redis->del($keyReal); // remove direct item.
            return true;
        }

        return parent::clear($key);
    }

}
