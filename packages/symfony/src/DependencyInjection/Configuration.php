<?php

declare(strict_types=1);

namespace Freshen\Bridge\Symfony\DependencyInjection;

use Symfony\Component\Config\Definition\Builder\ArrayNodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;
use Symfony\Component\Config\Definition\ConfigurationInterface;

/**
 * Config tree for the `freshen` root:
 *
 *   freshen:
 *     connection: Redis            # default \Redis client service id (optional)
 *     caches:
 *       top_sellers:
 *         loader: App\Cache\Loader # service id implementing Freshen\Interface\LoaderInterface (required)
 *         hard_ttl: 3600           # required, >= 1
 *         precompute: 60           # default 0; must be 0..hard_ttl
 *         jitter: 15               # default 15 (percent)
 *         fail_open: true          # default true
 *         connection: Redis        # optional per-cache override
 *         metrics: App\Cache\Sink  # optional Freshen\Interface\MetricsInterface service id
 *
 * A cache with no `connection` falls back to the top-level `connection`; if neither is
 * set the extension throws (validated there, since it is a cross-key rule).
 */
final class Configuration implements ConfigurationInterface
{
    public function getConfigTreeBuilder(): TreeBuilder
    {
        $treeBuilder = new TreeBuilder('freshen');
        $root = $treeBuilder->getRootNode();
        // getRootNode() is typed NodeDefinition|ArrayNodeDefinition on Symfony 6.4;
        // the root of a named tree is always an array node. Narrow it for PHPStan max.
        \assert($root instanceof ArrayNodeDefinition);

        $root
            ->children()
                ->scalarNode('connection')
                    ->info('Default \Redis client service id, used by caches that do not set their own.')
                    ->defaultNull()
                ->end()
                ->arrayNode('caches')
                    ->useAttributeAsKey('name')
                    ->arrayPrototype()
                        ->children()
                            ->scalarNode('loader')
                                ->info('Service id implementing Freshen\Interface\LoaderInterface.')
                                ->isRequired()
                                ->cannotBeEmpty()
                            ->end()
                            ->integerNode('hard_ttl')
                                ->info('Hard TTL in seconds (>= 1).')
                                ->isRequired()
                                ->min(1)
                            ->end()
                            ->integerNode('precompute')
                                ->info('Seconds before hard TTL to precompute (soft window); 0..hard_ttl.')
                                ->defaultValue(0)
                                ->min(0)
                            ->end()
                            ->integerNode('jitter')
                                ->info('TTL jitter percent.')
                                ->defaultValue(15)
                                ->min(0)
                            ->end()
                            ->booleanNode('fail_open')
                                ->info('Recompute-and-serve without caching under contention (true) vs MISS (false).')
                                ->defaultTrue()
                            ->end()
                            ->scalarNode('connection')
                                ->info('Per-cache \Redis client service id (overrides the top-level connection).')
                                ->defaultNull()
                            ->end()
                            ->scalarNode('metrics')
                                ->info('Optional Freshen\Interface\MetricsInterface service id.')
                                ->defaultNull()
                            ->end()
                        ->end()
                        ->validate()
                            ->ifTrue(static fn (array $c): bool => $c['precompute'] > $c['hard_ttl'])
                            ->thenInvalid('precompute must be <= hard_ttl.')
                        ->end()
                    ->end()
                ->end()
            ->end();

        return $treeBuilder;
    }
}
