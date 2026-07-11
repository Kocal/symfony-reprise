<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Exception;

/**
 * Thrown in strict mode when the entrypoints.json file cannot be found.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class EntrypointsFileNotFoundException extends \RuntimeException implements ExceptionInterface
{
}
