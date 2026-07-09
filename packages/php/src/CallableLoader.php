<?php

declare(strict_types=1);

namespace Freshen;

use Freshen\Interface\KeyInterface;
use Freshen\Interface\LoaderInterface;

final class CallableLoader implements LoaderInterface
{
    public function resolve(KeyInterface $key): mixed
    {
        return ($this->fn)($key);
    }
}
