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

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Reprise\Tests\Kernel\EmptyAppKernel;
use Symfony\Reprise\Tests\Kernel\FrameworkAppKernel;

final class RepriseBundleTest extends TestCase
{
    /**
     * @return iterable<string, array{Kernel}>
     */
    public static function provideKernels(): iterable
    {
        yield 'empty' => [new EmptyAppKernel('test', true)];
        yield 'framework' => [new FrameworkAppKernel('test', true)];
    }

    #[DataProvider('provideKernels')]
    public function testBundleBootsInAKernel(Kernel $kernel): void
    {
        $kernel->boot();

        $this->assertArrayHasKey('RepriseBundle', $kernel->getBundles());
    }
}
