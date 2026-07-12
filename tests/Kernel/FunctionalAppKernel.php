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

use Symfony\Bundle\FrameworkBundle\FrameworkBundle;
use Symfony\Component\Config\Loader\LoaderInterface;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\RepriseBundle;

/**
 * A framework kernel wired with a given Reprise `output_path`, exposing the lookup and the tag
 * renderer publicly so functional tests can fetch them from the container.
 */
final class FunctionalAppKernel extends Kernel implements CompilerPassInterface
{
    use AppKernelTrait;

    /**
     * @param array<string, mixed> $repriseConfig extra reprise config merged over `output_path`
     */
    public function __construct(
        private readonly string $outputPath,
        private readonly array $repriseConfig = [],
    ) {
        parent::__construct('test', true);
    }

    public function registerBundles(): iterable
    {
        return [new FrameworkBundle(), new RepriseBundle()];
    }

    public function registerContainerConfiguration(LoaderInterface $loader): void
    {
        $loader->load(function (ContainerBuilder $container): void {
            $container->loadFromExtension('framework', [
                'secret' => '$ecret',
                'test' => true,
                'http_method_override' => false,
            ]);
            $container->loadFromExtension('reprise', [
                'output_path' => $this->outputPath,
                ...$this->repriseConfig,
            ]);

            // A user-land service autowiring the lookup by its interface.
            $container->register(LookupConsumer::class)
                ->setAutowired(true)
                ->setPublic(true);
        });
    }

    protected function build(ContainerBuilder $container): void
    {
        $container->addCompilerPass($this);
    }

    public function process(ContainerBuilder $container): void
    {
        $container->getAlias(EntrypointsLookupInterface::class)->setPublic(true);
        $container->getDefinition('reprise.tag_renderer')->setPublic(true);
    }
}
