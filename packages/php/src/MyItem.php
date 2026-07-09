<?php

declare(strict_types=1);

namespace Freshen;

class MyItem extends \Stash\Item {

    public function clear(bool $exact = false): bool
    {
        if ($exact) {
            return $this->driver->clear($this->key, $exact);
        }

        return parent::clear();
    }

}
