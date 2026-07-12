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
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;
use Symfony\Reprise\Twig\AssetExtension;
use Symfony\Reprise\Twig\AssetRuntime;

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
                ->booleanNode('preload')
                    ->defaultTrue()
                    ->info('Register rendered assets as WebLink Link: headers (HTTP/2 preload). No-op when symfony/web-link is absent.')
                ->end()
                ->scalarNode('asset_package')
                    ->defaultNull()
                    ->info('Name of a framework.assets package used to resolve entry URLs (must have no version strategy). Null uses the default package.')
                ->end()
                ->enumNode('crossorigin')
                    ->values([false, 'anonymous', 'use-credentials'])
                    ->defaultFalse()
                    ->info('crossorigin attribute added alongside SRI integrity: false, "anonymous", or "use-credentials".')
                ->end()
                ->arrayNode('script_attributes')
                    ->normalizeKeys(false)->variablePrototype()->end()->defaultValue([])
                    ->info('Default attributes added to every <script> tag.')
                ->end()
                ->arrayNode('link_attributes')
                    ->normalizeKeys(false)->variablePrototype()->end()->defaultValue([])
                    ->info('Default attributes added to every <link> tag.')
                ->end()
            ->end()
        ;
    }

    /**
     * @param array{output_path: string, strict_mode: bool, preload: bool, asset_package: ?string, crossorigin: string|false, script_attributes: array<string, bool|string>, link_attributes: array<string, bool|string>} $config
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

        $services->set('reprise.tag_renderer', TagRenderer::class)
            ->args([
                service('reprise.entrypoints_lookup'),
                service('assets.packages'),
                service('request_stack'),
                $config['asset_package'],
                $config['crossorigin'],
                $config['preload'],
                $config['script_attributes'],
                $config['link_attributes'],
            ])
            ->tag('kernel.reset', ['method' => 'reset'])
        ;

        $services->set('reprise.asset_runtime', AssetRuntime::class)
            ->args([service('reprise.tag_renderer')])
            ->tag('twig.runtime')
        ;

        $services->set('reprise.twig_extension', AssetExtension::class)
            ->tag('twig.extension')
        ;
    }
}
