<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Asset;

use Symfony\Reprise\Exception\UndefinedBuildException;

/**
 * Resolves the EntrypointsLookup for a named build (or the default build when none is given).
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
interface EntrypointsLookupCollectionInterface
{
    /**
     * @throws UndefinedBuildException when the build is unknown, or when null is given and no default build exists
     */
    public function getEntrypointsLookup(?string $build = null): EntrypointsLookupInterface;
}
