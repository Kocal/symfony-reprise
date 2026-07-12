<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Asset;

use Symfony\Component\Asset\Packages;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
use Symfony\Component\WebLink\Link;
use Symfony\Contracts\Service\ResetInterface;

/**
 * Renders the <script>/<link> tags for an entry, resolving each entrypoints.json reference through
 * Symfony's asset Packages (ADR 0001) and adding SRI integrity/crossorigin when present.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class TagRenderer implements ResetInterface
{
    private bool $clientInjected = false;

    /**
     * @param array<string, bool|string> $scriptAttributes
     * @param array<string, bool|string> $linkAttributes
     */
    public function __construct(
        private readonly EntrypointsLookupInterface $lookup,
        private readonly Packages $packages,
        private readonly ?RequestStack $requestStack = null,
        private readonly ?string $defaultPackage = null,
        private readonly string|false $crossorigin = false,
        private readonly bool $preload = true,
        private readonly array $scriptAttributes = [],
        private readonly array $linkAttributes = [],
    ) {
    }

    public function renderScriptTags(string $entryName, ?string $packageName = null): string
    {
        $integrity = $this->lookup->getIntegrityData();
        $tags = [];

        $devServer = $this->lookup->getDevServer();
        if (!$this->clientInjected && null !== $devServer && null !== $devServer->client) {
            $tags[] = \sprintf('<script type="module" src="%s"></script>', htmlspecialchars($devServer->client, \ENT_QUOTES));
            $this->clientInjected = true;
        }

        foreach ($this->lookup->getPreloadFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $attributes = ['rel' => 'modulepreload', 'href' => $url];
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($attributes));
            $this->preload($url, 'modulepreload');
        }

        foreach ($this->lookup->getJavaScriptFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $attributes = ['src' => $url, 'type' => 'module'];
            $attributes += $this->scriptAttributes;
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<script %s></script>', $this->attributes($attributes));
            $this->preload($url, 'preload', 'script');
        }

        return implode('', $tags);
    }

    public function renderLinkTags(string $entryName, ?string $packageName = null): string
    {
        $integrity = $this->lookup->getIntegrityData();
        $tags = [];
        foreach ($this->lookup->getCssFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $attributes = ['rel' => 'stylesheet', 'href' => $url];
            $attributes += $this->linkAttributes;
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($attributes));
            $this->preload($url, 'preload', 'style');
        }

        return implode('', $tags);
    }

    /**
     * @return list<string>
     */
    public function getJsFiles(string $entryName, ?string $packageName = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->lookup->getJavaScriptFiles($entryName));
    }

    /**
     * @return list<string>
     */
    public function getCssFiles(string $entryName, ?string $packageName = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->lookup->getCssFiles($entryName));
    }

    public function reset(): void
    {
        $this->clientInjected = false;
    }

    private function url(string $reference, ?string $packageName): string
    {
        return $this->packages->getUrl($reference, $packageName ?? $this->defaultPackage);
    }

    private function preload(string $url, string $rel, ?string $as = null): void
    {
        if (!$this->preload || null === $this->requestStack || !class_exists(GenericLinkProvider::class)) {
            return;
        }

        $request = $this->requestStack->getCurrentRequest();
        if (null === $request) {
            return;
        }

        $link = new Link($rel, $url);
        if (null !== $as) {
            $link = $link->withAttribute('as', $as);
        }

        $linkProvider = $request->attributes->get('_links');
        if (!$linkProvider instanceof GenericLinkProvider) {
            $linkProvider = new GenericLinkProvider();
        }
        $request->attributes->set('_links', $linkProvider->withLink($link));
    }

    /**
     * @param array<string, bool|string> $attributes
     * @param array<string, string>      $integrity
     */
    private function applyIntegrity(array &$attributes, string $reference, array $integrity): void
    {
        if (!isset($integrity[$reference])) {
            return;
        }
        $attributes['integrity'] = $integrity[$reference];
        $attributes['crossorigin'] = false === $this->crossorigin ? 'anonymous' : $this->crossorigin;
    }

    /**
     * @param array<string, bool|string> $attributes
     */
    private function attributes(array $attributes): string
    {
        $attributes = array_filter($attributes, static fn (bool|string $v) => false !== $v);

        return implode(' ', array_map(
            static fn (string $k, bool|string $v) => true === $v ? $k : \sprintf('%s="%s"', $k, htmlspecialchars($v, \ENT_QUOTES)),
            array_keys($attributes),
            $attributes,
        ));
    }
}
