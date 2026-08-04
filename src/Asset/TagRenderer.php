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
    /**
     * HMR client URLs already injected this request, kept as a set so each dev server (there is one per
     * build) injects its client exactly once, even when several builds render on the same page.
     *
     * @var array<string, true>
     */
    private array $injectedClients = [];

    /**
     * @param array<string, bool|string> $scriptAttributes
     * @param array<string, bool|string> $linkAttributes
     */
    public function __construct(
        private readonly EntrypointsLookupCollectionInterface $collection,
        private readonly Packages $packages,
        private readonly ?RequestStack $requestStack = null,
        private readonly ?string $defaultPackage = null,
        private readonly string|false $crossorigin = false,
        private readonly bool $preload = true,
        private readonly array $scriptAttributes = [],
        private readonly array $linkAttributes = [],
    ) {
    }

    /**
     * @param array<string, bool|string> $attributes per-call attributes, merged last so they win over the
     *                                               configured script_attributes (integrity/crossorigin stay authoritative)
     */
    public function renderScriptTags(string $entryName, ?string $packageName = null, ?string $build = null, array $attributes = []): string
    {
        $lookup = $this->collection->getEntrypointsLookup($build);
        $integrity = $lookup->getIntegrityData();
        $tags = [];

        $devServer = $lookup->getDevServer();
        if (null !== $devServer && null !== $devServer->client && !isset($this->injectedClients[$devServer->client])) {
            $tags[] = \sprintf('<script type="module" src="%s"></script>', htmlspecialchars($devServer->client, \ENT_QUOTES));
            if (null !== $devServer->reactRefresh) {
                $tags[] = $this->renderReactRefreshPreamble($devServer->reactRefresh);
            }
            $this->injectedClients[$devServer->client] = true;
        }

        foreach ($lookup->getPreloadFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $tagAttributes = ['rel' => 'modulepreload', 'href' => $url];
            $this->applyIntegrity($tagAttributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($tagAttributes));
            $this->preload($url, 'modulepreload', null, $reference, $integrity);
        }

        foreach ($lookup->getJavaScriptFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $tagAttributes = ['src' => $url, 'type' => 'module'] + $attributes + $this->scriptAttributes;
            $this->applyIntegrity($tagAttributes, $reference, $integrity);
            $tags[] = \sprintf('<script %s></script>', $this->attributes($tagAttributes));
            $this->preload($url, 'preload', 'script', $reference, $integrity);
        }

        return implode('', $tags);
    }

    /**
     * @param array<string, bool|string> $attributes per-call attributes, merged last so they win over the
     *                                               configured link_attributes (integrity/crossorigin stay authoritative)
     */
    public function renderLinkTags(string $entryName, ?string $packageName = null, ?string $build = null, array $attributes = []): string
    {
        $lookup = $this->collection->getEntrypointsLookup($build);
        $integrity = $lookup->getIntegrityData();
        $tags = [];
        foreach ($lookup->getCssFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $tagAttributes = ['rel' => 'stylesheet', 'href' => $url] + $attributes + $this->linkAttributes;
            $this->applyIntegrity($tagAttributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($tagAttributes));
            $this->preload($url, 'preload', 'style', $reference, $integrity);
        }

        return implode('', $tags);
    }

    /**
     * @return list<string>
     */
    public function getJsFiles(string $entryName, ?string $packageName = null, ?string $build = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->collection->getEntrypointsLookup($build)->getJavaScriptFiles($entryName));
    }

    /**
     * @return list<string>
     */
    public function getCssFiles(string $entryName, ?string $packageName = null, ?string $build = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->collection->getEntrypointsLookup($build)->getCssFiles($entryName));
    }

    public function entryExists(string $entryName, ?string $build = null): bool
    {
        return $this->collection->getEntrypointsLookup($build)->entryExists($entryName);
    }

    public function reset(): void
    {
        $this->injectedClients = [];
    }

    /**
     * Emits Vite's React Fast Refresh preamble. `@vitejs/plugin-react` normally injects this into the
     * HTML itself, but cannot when Symfony renders the page (backend integration), so we render it here
     * before the entry. See https://vite.dev/guide/backend-integration.
     */
    private function renderReactRefreshPreamble(string $reactRefreshUrl): string
    {
        return \sprintf(
            <<<'HTML'
                <script type="module">
                import RefreshRuntime from "%s";
                RefreshRuntime.injectIntoGlobalHook(window);
                window.$RefreshReg$ = () => {};
                window.$RefreshSig$ = () => (type) => type;
                window.__vite_plugin_react_preamble_installed__ = true;
                </script>
                HTML,
            htmlspecialchars($reactRefreshUrl, \ENT_QUOTES),
        );
    }

    private function url(string $reference, ?string $packageName): string
    {
        return $this->packages->getUrl($reference, $packageName ?? $this->defaultPackage);
    }

    /**
     * @param array<string, string> $integrity
     */
    private function preload(string $url, string $rel, ?string $as, string $reference, array $integrity): void
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
        // Mirror the tag's SRI onto the preload, or the browser discards the preloaded response as a mismatch.
        [$hash, $crossorigin] = $this->integrityFor($reference, $integrity);
        if (null !== $hash) {
            $link = $link->withAttribute('integrity', $hash)->withAttribute('crossorigin', $crossorigin);
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
        [$hash, $crossorigin] = $this->integrityFor($reference, $integrity);
        if (null === $hash) {
            return;
        }
        $attributes['integrity'] = $hash;
        $attributes['crossorigin'] = $crossorigin;
    }

    /**
     * Resolves the SRI hash + crossorigin for a reference, so a tag and its preload Link derive them
     * from one place and can never drift.
     *
     * @param array<string, string> $integrity
     *
     * @return array{0: ?string, 1: string}
     */
    private function integrityFor(string $reference, array $integrity): array
    {
        if (!isset($integrity[$reference])) {
            return [null, ''];
        }

        return [$integrity[$reference], false === $this->crossorigin ? 'anonymous' : $this->crossorigin];
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
