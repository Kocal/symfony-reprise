<?php

namespace Symfony\Reprise\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Loader\LoaderInterface;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Reprise\RepriseBundle;

final class RepriseBundleTest extends TestCase
{
    public function testBundleBootsInAKernel(): void
    {
        $kernel = new class('test', true) extends Kernel {
            public function registerBundles(): iterable
            {
                return [new RepriseBundle()];
            }

            public function registerContainerConfiguration(LoaderInterface $loader): void
            {
            }

            public function getProjectDir(): string
            {
                return sys_get_temp_dir().'/reprise-test';
            }
        };

        $kernel->boot();

        self::assertArrayHasKey('RepriseBundle', $kernel->getBundles());

        $kernel->shutdown();
        (new Filesystem())->remove($kernel->getProjectDir());
    }
}
