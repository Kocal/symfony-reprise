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
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Symfony\Contracts\Service\ResetInterface;
use Symfony\Reprise\Event\RenderAssetTagEvent;

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
        private readonly ?EventDispatcherInterface $eventDispatcher = null,
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
        $scriptDefaults = $attributes + $this->scriptAttributes;

        $devServer = $lookup->getDevServer();
        if (null !== $devServer && null !== $devServer->client && !isset($this->injectedClients[$devServer->client])) {
            $clientAttributes = ['type' => 'module', 'src' => $devServer->client] + $scriptDefaults;
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $clientAttributes);
            if (null !== $devServer->reactRefresh) {
                $preambleAttributes = ['type' => 'module'] + $scriptDefaults;
                $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $preambleAttributes, $this->reactRefreshPreamble($devServer->reactRefresh));
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
            $tagAttributes = ['src' => $url, 'type' => 'module'] + $scriptDefaults;
            $this->applyIntegrity($tagAttributes, $reference, $integrity);
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $tagAttributes);
            // modulepreload, not `preload as=script`: the tag is a module, and a classic-script preload
            // mismatches its credentials/CORS mode so the browser discards it.
            $this->preload($url, 'modulepreload', null, $reference, $integrity);
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
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_LINK, $tagAttributes);
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
     * The inner body of Vite's React Fast Refresh preamble. `@vitejs/plugin-react` normally injects this
     * into the HTML itself, but cannot when Symfony renders the page (backend integration), so we render
     * it here before the entry, wrapped in a <script type="module"> by tag(). See
     * https://vite.dev/guide/backend-integration.
     */
    private function reactRefreshPreamble(string $reactRefreshUrl): string
    {
        return \sprintf(
            <<<'JS'

                import RefreshRuntime from "%s";
                RefreshRuntime.injectIntoGlobalHook(window);
                window.$RefreshReg$ = () => {};
                window.$RefreshSig$ = () => (type) => type;
                window.__vite_plugin_react_preamble_installed__ = true;

                JS,
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
    private function tag(string $type, array $attributes, ?string $inlineBody = null): string
    {
        if (null !== $this->eventDispatcher) {
            $event = $this->eventDispatcher->dispatch(new RenderAssetTagEvent($type, $attributes));
            $attributes = $event->attributes;
        }

        return match ($type) {
            RenderAssetTagEvent::TYPE_LINK => \sprintf('<link %s>', $this->attributes($attributes)),
            default => \sprintf('<script %s>%s</script>', $this->attributes($attributes), $inlineBody ?? ''),
        };
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
