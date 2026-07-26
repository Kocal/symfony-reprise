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
 * Thrown when a requested build name is not configured under "reprise.builds".
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class UndefinedBuildException extends \InvalidArgumentException implements ExceptionInterface
{
}
