<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Kernel;

use Symfony\Reprise\Asset\EntrypointsLookupInterface;

/**
 * A user-land-style service that receives the lookup autowired by its interface.
 */
final class LookupConsumer
{
    public function __construct(
        public readonly EntrypointsLookupInterface $lookup,
    ) {
    }
}
