<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Component\DependencyInjection\Loader\Configurator;

use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Reprise\CacheWarmer\EntrypointsCacheWarmer;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->set('cache.reprise')
        ->parent('cache.system')
        ->tag('cache.pool')
    ;

    $services->set('reprise.cache', PhpArrayAdapter::class)
        ->args([
            '%kernel.build_dir%/reprise.cache.php',
            service('cache.reprise'),
        ])
    ;

    $services->set('reprise.entrypoints_cache_warmer', EntrypointsCacheWarmer::class)
        ->args([
            param('reprise.entrypoints_path'),
            'reprise.entrypoints',
            service('reprise.cache'),
        ])
        ->tag('kernel.cache_warmer')
    ;
};
