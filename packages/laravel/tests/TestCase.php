<?php

declare(strict_types=1);

namespace Freshen\Bridge\Laravel\Tests;

use Freshen\Bridge\Laravel\FreshenServiceProvider;
use Orchestra\Testbench\TestCase as OrchestraTestCase;

/**
 * Base test case: boots a minimal real Laravel app (Testbench) with the Freshen
 * provider auto-registered. Concrete tests set `freshen.*` config via
 * {@see defineEnvironment()} overrides.
 */
abstract class TestCase extends OrchestraTestCase
{
    /**
     * @param \Illuminate\Foundation\Application $app
     * @return list<class-string>
     */
    protected function getPackageProviders($app): array
    {
        return [FreshenServiceProvider::class];
    }
}
