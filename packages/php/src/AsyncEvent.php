<?php

declare(strict_types=1);

namespace Freshen;

use Freshen\Interface\KeyInterface;

class AsyncEvent
{
    public function __construct(
        public KeyInterface $key,
        public bool $exact = false,
    )
    {

    }
}
