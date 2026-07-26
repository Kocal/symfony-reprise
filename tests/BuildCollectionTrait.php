<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests;

use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Reprise\Asset\EntrypointsLookupCollection;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;

trait BuildCollectionTrait
{
    /**
     * @param array<string, EntrypointsLookupInterface> $lookups
     */
    private function collection(array $lookups, ?string $default = '_default'): EntrypointsLookupCollection
    {
        return new EntrypointsLookupCollection(
            new ServiceLocator(array_map(static fn (EntrypointsLookupInterface $l): \Closure => static fn (): EntrypointsLookupInterface => $l, $lookups)),
            $default,
        );
    }
}
