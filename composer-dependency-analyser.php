<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

use ShipMonk\ComposerDependencyAnalyser\Config\Configuration;
use ShipMonk\ComposerDependencyAnalyser\Config\ErrorType;

return new Configuration()
    // Symfony's DI configurator helpers are plain functions the analyser cannot resolve statically.
    ->ignoreUnknownFunctions([
        'Symfony\Component\DependencyInjection\Loader\Configurator\service',
        'Symfony\Component\DependencyInjection\Loader\Configurator\service_locator',
    ])
    // Interface-only packages pulled in transitively by components we require (psr/cache by symfony/cache,
    // event-dispatcher-contracts by symfony/event-dispatcher).
    ->ignoreErrorsOnPackage('psr/cache', [ErrorType::SHADOW_DEPENDENCY])
    ->ignoreErrorsOnPackage('symfony/event-dispatcher-contracts', [ErrorType::SHADOW_DEPENDENCY])
    // Optional dependencies used behind class_exists() guards, so kept in require-dev.
    ->ignoreErrorsOnPackage('symfony/cache', [ErrorType::DEV_DEPENDENCY_IN_PROD])
    ->ignoreErrorsOnPackage('symfony/web-link', [ErrorType::DEV_DEPENDENCY_IN_PROD]);
