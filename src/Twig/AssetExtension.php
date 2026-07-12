<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Twig;

use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;

/**
 * Declares the reprise_entry_* Twig functions, each delegating to the lazily-loaded AssetRuntime so
 * the TagRenderer is built only when a template actually renders Reprise tags.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class AssetExtension extends AbstractExtension
{
    public function getFunctions(): array
    {
        return [
            new TwigFunction('reprise_entry_script_tags', [AssetRuntime::class, 'renderScriptTags'], ['is_safe' => ['html']]),
            new TwigFunction('reprise_entry_link_tags', [AssetRuntime::class, 'renderLinkTags'], ['is_safe' => ['html']]),
            new TwigFunction('reprise_entry_js_files', [AssetRuntime::class, 'getJsFiles']),
            new TwigFunction('reprise_entry_css_files', [AssetRuntime::class, 'getCssFiles']),
        ];
    }
}
