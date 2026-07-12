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

use Symfony\Reprise\Asset\TagRenderer;
use Twig\Extension\RuntimeExtensionInterface;

/**
 * Lazily-instantiated runtime backing the reprise_entry_* Twig functions.
 *
 * Twig instantiates every registered extension as soon as it boots, but a runtime is built only when
 * one of its functions is actually called. Holding the TagRenderer here (rather than on the
 * extension) keeps templates that never render Reprise tags from constructing it and its
 * dependencies (entrypoints lookup, asset packages, request stack).
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class AssetRuntime implements RuntimeExtensionInterface
{
    public function __construct(private readonly TagRenderer $tagRenderer)
    {
    }

    public function renderScriptTags(string $entryName, ?string $packageName = null): string
    {
        return $this->tagRenderer->renderScriptTags($entryName, $packageName);
    }

    public function renderLinkTags(string $entryName, ?string $packageName = null): string
    {
        return $this->tagRenderer->renderLinkTags($entryName, $packageName);
    }

    /**
     * @return list<string>
     */
    public function getJsFiles(string $entryName, ?string $packageName = null): array
    {
        return $this->tagRenderer->getJsFiles($entryName, $packageName);
    }

    /**
     * @return list<string>
     */
    public function getCssFiles(string $entryName, ?string $packageName = null): array
    {
        return $this->tagRenderer->getCssFiles($entryName, $packageName);
    }
}
