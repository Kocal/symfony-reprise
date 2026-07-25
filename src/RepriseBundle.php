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
use Symfony\Component\VarExporter\VarExporter;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupCollection;
use Symfony\Reprise\Asset\EntrypointsLookupCollectionInterface;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;
use Symfony\Reprise\Twig\AssetExtension;
use Symfony\Reprise\Twig\AssetRuntime;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;
use function Symfony\Component\DependencyInjection\Loader\Configurator\service_locator;

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
                    ->info('Directory where the @symfony/reprise plugin writes entrypoints.json and manifest.json. Set to false to only use named "builds".')
                ->end()
                ->arrayNode('builds')
                    ->info('Additional named builds: a map of build name to output directory, each with its own entrypoints.json.')
                    ->useAttributeAsKey('name')
                    ->scalarPrototype()->end()
                    ->defaultValue([])
                    ->validate()
                        ->ifTrue(static fn (array $builds): bool => \array_key_exists('_default', $builds))
                        ->thenInvalid('The build name "_default" is reserved for "reprise.output_path".')
                    ->end()
                ->end()
                ->booleanNode('strict_mode')
                    ->defaultTrue()
                    ->info('Throw when the entrypoints.json file or a requested entry is missing.')
                ->end()
                ->booleanNode('cache')
                    ->defaultFalse()
                    ->info('Cache the parsed entrypoints.json in a compiled PHP file (warmed at cache:warmup). Enable in production; requires symfony/cache.')
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
     * @param array{output_path: string|false, builds: array<string, string>, strict_mode: bool, cache: bool, preload: bool, asset_package: ?string, crossorigin: string|false, script_attributes: array<string, bool|string>, link_attributes: array<string, bool|string>} $config
     */
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $services = $container->services();

        if ($config['cache'] && !class_exists(VarExporter::class)) {
            throw new \LogicException('Enabling "reprise.cache" requires the Symfony Cache component. Run "composer require symfony/cache".');
        }

        // Build the map of build name -> entrypoints.json path. The default build (from output_path) is
        // keyed "_default"; named builds keep their configured name.
        $entrypointsPaths = [];
        if (false !== $config['output_path']) {
            $entrypointsPaths['_default'] = $config['output_path'].'/entrypoints.json';
        }
        foreach ($config['builds'] as $name => $dir) {
            $entrypointsPaths[$name] = $dir.'/entrypoints.json';
        }
        if (!$entrypointsPaths) {
            throw new \LogicException('Configure at least one build: set "reprise.output_path" or add entries under "reprise.builds".');
        }

        $lookupLocator = [];
        $resettables = [];
        foreach ($entrypointsPaths as $name => $path) {
            $serviceId = '_default' === $name ? 'reprise.entrypoints_lookup' : 'reprise.entrypoints_lookup.'.$name;

            $lookupArgs = [$path, $config['strict_mode']];
            if ($config['cache']) {
                $lookupArgs[] = service('reprise.cache');
                $lookupArgs[] = 'reprise.entrypoints.'.$name;
            }

            $services->set($serviceId, EntrypointsLookup::class)
                ->args($lookupArgs)
                ->tag('kernel.reset', ['method' => 'reset'])
            ;

            $lookupLocator[$name] = service($serviceId);
            $resettables[] = service($serviceId);
        }

        if ($config['cache']) {
            $container->parameters()->set('reprise.entrypoints_paths', $entrypointsPaths);
            $container->import('../config/cache.php');
        }

        $defaultBuild = false !== $config['output_path'] ? '_default' : null;

        $services->set('reprise.entrypoints_lookup_collection', EntrypointsLookupCollection::class)
            ->args([service_locator($lookupLocator), $defaultBuild])
        ;
        $services->alias(EntrypointsLookupCollectionInterface::class, 'reprise.entrypoints_lookup_collection');

        // Keep the default lookup autowirable by its interface (BC), but only when there is a default build.
        if (null !== $defaultBuild) {
            $services->alias(EntrypointsLookupInterface::class, 'reprise.entrypoints_lookup');
        }

        $services->set('reprise.tag_renderer', TagRenderer::class)
            ->args([
                service('reprise.entrypoints_lookup_collection'),
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

        $resettables[] = service('reprise.tag_renderer');
        $services->set('reprise.reset_assets_listener', ResetAssetsEventListener::class)
            ->args([$resettables])
            ->tag('kernel.event_subscriber')
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
