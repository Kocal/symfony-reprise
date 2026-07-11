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
 * Thrown in strict mode when a requested entry is missing from the entrypoints.json file.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class EntrypointNotFoundException extends \InvalidArgumentException implements ExceptionInterface
{
}
