<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\Tests\DependencyInjection;

use Freshen\Bridge\Symfony\DependencyInjection\Configuration;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\Config\Definition\Processor;

final class ConfigurationTest extends TestCase
{
    /**
     * @param array<string, mixed> $config
     * @return array<string, mixed>
     */
    private function process(array $config): array
    {
        return (new Processor())->processConfiguration(new Configuration(), ['freshen' => $config]);
    }

    public function testDefaultsAreApplied(): void
    {
        $processed = $this->process([
            'connection' => 'Redis',
            'caches' => [
                'top_sellers' => ['loader' => 'App\\Loader', 'hard_ttl' => 3600],
            ],
        ]);

        self::assertSame('Redis', $processed['connection']);
        $cache = $processed['caches']['top_sellers'];
        self::assertSame('App\\Loader', $cache['loader']);
        self::assertSame(3600, $cache['hard_ttl']);
        self::assertSame(0, $cache['precompute']);
        self::assertSame(15, $cache['jitter']);
        self::assertTrue($cache['fail_open']);
        self::assertNull($cache['connection']);
        self::assertNull($cache['metrics']);
    }

    public function testConnectionDefaultsToNullWhenOmitted(): void
    {
        $processed = $this->process([
            'caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 10]],
        ]);

        self::assertNull($processed['connection']);
    }

    public function testLoaderIsRequired(): void
    {
        $this->expectException(InvalidConfigurationException::class);
        $this->process(['caches' => ['c' => ['hard_ttl' => 10]]]);
    }

    public function testHardTtlMustBeAtLeastOne(): void
    {
        $this->expectException(InvalidConfigurationException::class);
        $this->process(['caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 0]]]);
    }

    public function testPrecomputeCannotExceedHardTtl(): void
    {
        $this->expectException(InvalidConfigurationException::class);
        $this->expectExceptionMessageMatches('/precompute must be <= hard_ttl/');
        $this->process([
            'caches' => ['c' => ['loader' => 'L', 'hard_ttl' => 60, 'precompute' => 61]],
        ]);
    }
}
