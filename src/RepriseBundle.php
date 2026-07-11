<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise;

use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

/**
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class RepriseBundle extends AbstractBundle
{
    public function configure(DefinitionConfigurator $definition): void
    {
        $definition->rootNode()
            ->children()
                ->scalarNode('output_path')
                    ->defaultValue('%kernel.project_dir%/public/build')
                    ->info('Directory where the @symfony/reprise plugin writes entrypoints.json and manifest.json.')
                ->end()
                ->booleanNode('strict_mode')
                    ->defaultTrue()
                    ->info('Throw when the entrypoints.json file or a requested entry is missing.')
                ->end()
            ->end()
        ;
    }

    /**
     * @param array{output_path: string, strict_mode: bool} $config
     */
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $services = $container->services();

        $services->set('reprise.entrypoints_lookup', EntrypointsLookup::class)
            ->args([
                $config['output_path'].'/entrypoints.json',
                $config['strict_mode'],
            ])
            ->tag('kernel.reset', ['method' => 'reset'])
        ;

        $services->alias(EntrypointsLookupInterface::class, 'reprise.entrypoints_lookup');

        $services->set('reprise.reset_assets_listener', ResetAssetsEventListener::class)
            ->args([service('reprise.entrypoints_lookup')])
            ->tag('kernel.event_subscriber')
        ;
    }
}
