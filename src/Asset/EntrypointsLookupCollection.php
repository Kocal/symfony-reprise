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

use Symfony\Contracts\Service\ServiceProviderInterface;
use Symfony\Reprise\Exception\UndefinedBuildException;

/**
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class EntrypointsLookupCollection implements EntrypointsLookupCollectionInterface
{
    /**
     * @param ServiceProviderInterface<EntrypointsLookupInterface> $lookups a service locator keyed by build name (the default build under "_default")
     */
    public function __construct(
        private readonly ServiceProviderInterface $lookups,
        private readonly ?string $defaultBuildName = null,
    ) {
    }

    public function getEntrypointsLookup(?string $build = null): EntrypointsLookupInterface
    {
        $build ??= $this->defaultBuildName;

        if (null === $build) {
            throw new UndefinedBuildException('There is no default build configured: set "reprise.output_path", or pass an explicit build name.');
        }

        if (!$this->lookups->has($build)) {
            throw new UndefinedBuildException(\sprintf('The build "%s" is not configured under "reprise.builds".', $build));
        }

        return $this->lookups->get($build);
    }
}
