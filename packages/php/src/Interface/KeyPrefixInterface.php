<?php

declare(strict_types=1);

namespace Freshen\Interface;

interface KeyPrefixInterface
{
    /** @return list<string> */
    public function segments(): array;

    public function toString(): string;
}
