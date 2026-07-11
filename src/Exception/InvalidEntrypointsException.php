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
 * Thrown when an entrypoints.json file exists but its contents do not match the expected shape.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class InvalidEntrypointsException extends \UnexpectedValueException implements ExceptionInterface
{
}
