# Twig Asset Tags — Phase 2b (dev HMR + modulepreload + WebLink + docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Twig asset-tag renderer — dev-server HMR client injection, `modulepreload` hints for preload chunks, optional WebLink `Link:` headers — and document the whole feature (a new "Rendering asset tags" section plus a CDN reframe around `framework.assets`).

**Architecture:** Extends the existing `TagRenderer` (Phase 2a) in place. `renderScriptTags` gains two responsibilities before emitting the entry scripts: inject the Vite HMR client once per request in dev, and emit `<link rel="modulepreload">` for the entry's preload chunks. A new optional WebLink hook registers preloadable references on the current request so `AddLinkHeaderListener` turns them into `Link:` headers. Docs follow.

**Tech Stack:** PHP 8.4, Symfony bundle (`AbstractBundle`), `symfony/asset` `Packages`, `symfony/web-link` (optional), Twig, PHPUnit 13, PHPStan max, php-cs-fixer.

## Global Constraints

- PHP: `final` classes, `readonly` promoted constructor props; Symfony license header + `@author Hugo Alliaume <hugo@alliau.me>` on every new `.php`; `@internal` on implementations, never on the public interface.
- Entry references are always resolved through `Packages::getUrl()` — never emitted as-is. A dev absolute URL (`http://…/build/app.js`) passes through `Packages` unchanged.
- Dev HMR client injection is **Vite-only**: inject `<script type="module" src="{origin}/@vite/client"></script>` when `devServer.client === 'vite'`. Rsbuild dev emits `client: null` (its HMR client is compiled into the bundle) → inject nothing. This asymmetry is by design; both bundlers get a functional test (Vite injects, Rsbuild is the off case).
- `modulepreload` is for `getPreloadFiles()` references only; `dynamic` chunks are never rendered.
- SRI: when `getIntegrityData()[$reference]` exists, add `integrity="…"` + `crossorigin` (`anonymous` unless `crossorigin` is configured otherwise). The dev integrity map is empty, so no SRI in dev.
- WebLink is an **optional** dependency: every WebLink code path is guarded by `class_exists(GenericLinkProvider::class)` and a present current request; it is a silent no-op otherwise.
- Per-request state (`clientInjected` flag) is cleared by `TagRenderer::reset()`, already wired through `kernel.reset`.
- Bundler test symmetry: any functional test for one bundler ships with its equivalent (or documented off-case) for the other.
- Docs: any user-facing feature ships a `doc/index.rst` section with **both** a Vite and an Rsbuild example. Prose drafted/polished via the `natural-writing-editor` agent. ASCII `->`, never `→`.
- QA gate per task: `vendor/bin/phpunit`, `vendor/bin/phpstan analyse`, `vendor/bin/php-cs-fixer fix`.

---

## File Structure

- `src/Asset/TagRenderer.php` — modified across Tasks 1–3 (HMR flag, modulepreload loop, WebLink hook + two new constructor args).
- `src/RepriseBundle.php` — modified in Task 3 (new `preload` config key, `request_stack` + `preload` service args, updated config docblock).
- `composer.json` — modified in Task 3 (`symfony/web-link` added to `require-dev`).
- `tests/Asset/TagRendererTest.php` — modified across Tasks 1–3 (unit tests; the `renderer()` helper gains `preload`, `requestStack`, `preloadEnabled` params and updates the `new TagRenderer(...)` call).
- `tests/fixtures/dev/entrypoints.json` — the existing Vite dev fixture (`client: "vite"`); used by Task 4. Unused by any test today.
- `tests/fixtures/dev-rspack/entrypoints.json` — created in Task 4 (Rsbuild dev fixture, `client: null`).
- `tests/Functional/DevAssetTagsTest.php` — created in Task 4 (dev-mode E2E for both bundlers).
- `tests/Functional/AssetTagsTest.php` — modified in Task 2 (the `app` prod entry now emits a `modulepreload` link before its script).
- `doc/index.rst`, `README.md` — modified in Task 5 (new section, CDN reframe, feature markers).

---

### Task 1: Dev HMR client injection

Inject the Vite HMR client once per request at the top of `renderScriptTags`, gated on `devServer.client === 'vite'`, cleared by `reset()`. No DI or constructor change.

**Files:**
- Modify: `src/Asset/TagRenderer.php`
- Test: `tests/Asset/TagRendererTest.php`

**Interfaces:**
- Consumes: `EntrypointsLookupInterface::getDevServer(): ?DevServer`; `DevServer { public readonly string $origin; public readonly ?string $client; }` (`client` is `'vite'` for Vite dev, `null` for Rsbuild dev, absent/null in prod).
- Produces: no signature change. Adds private state `bool $clientInjected`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/Asset/TagRendererTest.php`:

```php
    public function testInjectsViteHmrClientOncePerRequestInDev()
    {
        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'vite'),
        );

        $first = $renderer->renderScriptTags('app');
        $this->assertSame(
            '<script type="module" src="http://127.0.0.1:5173/@vite/client"></script>'
            .'<script src="http://127.0.0.1:5173/build/app.js" type="module"></script>',
            $first,
        );

        // Same request, second call (e.g. a second entry): the client is not injected again.
        $second = $renderer->renderScriptTags('app');
        $this->assertStringNotContainsString('@vite/client', $second);

        // A new request resets the flag and the client is injected again.
        $renderer->reset();
        $this->assertStringContainsString('@vite/client', $renderer->renderScriptTags('app'));
    }

    public function testDoesNotInjectHmrClientWhenDevServerClientIsNull()
    {
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', null),
        )->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function testDoesNotInjectHmrClientInProd()
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `vendor/bin/phpunit --filter 'HmrClient|InjectsViteHmr' tests/Asset/TagRendererTest.php`
Expected: FAIL — the `@vite/client` script is not emitted yet.

- [ ] **Step 3: Implement the injection**

In `src/Asset/TagRenderer.php`, add the private flag right after the class opening brace:

```php
    private bool $clientInjected = false;
```

Rewrite the top of `renderScriptTags` so the HMR client is prepended before the script loop (leave the existing `$integrity`/`$tags` setup and the `foreach (getJavaScriptFiles …)` loop in place):

```php
    public function renderScriptTags(string $entryName, ?string $packageName = null): string
    {
        $integrity = $this->lookup->getIntegrityData();
        $tags = [];

        $devServer = $this->lookup->getDevServer();
        if (!$this->clientInjected && null !== $devServer && 'vite' === $devServer->client) {
            $tags[] = \sprintf('<script type="module" src="%s/@vite/client"></script>', $devServer->origin);
            $this->clientInjected = true;
        }

        foreach ($this->lookup->getJavaScriptFiles($entryName) as $reference) {
            $attributes = ['src' => $this->url($reference, $packageName), 'type' => 'module'];
            $attributes += $this->scriptAttributes;
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<script %s></script>', $this->attributes($attributes));
        }

        return implode('', $tags);
    }
```

Update `reset()` to clear the flag (replace the Phase-2a no-op body):

```php
    public function reset(): void
    {
        $this->clientInjected = false;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/Asset/TagRendererTest.php`
Expected: PASS (all TagRenderer unit tests green).

- [ ] **Step 5: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php
vendor/bin/phpstan analyse
git add src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php
git commit -m "[Twig] Inject the Vite HMR client once per request in dev"
```

---

### Task 2: modulepreload hints for preload chunks

Emit `<link rel="modulepreload" href="…">` (with SRI when present) for each `getPreloadFiles()` reference, between the HMR client and the entry scripts.

**Files:**
- Modify: `src/Asset/TagRenderer.php`
- Test: `tests/Asset/TagRendererTest.php`, `tests/Functional/AssetTagsTest.php`

**Interfaces:**
- Consumes: `EntrypointsLookupInterface::getPreloadFiles(string): list<string>`.
- Produces: no signature change.

- [ ] **Step 1: Extend the test helper to drive preload files**

In `tests/Asset/TagRendererTest.php`, add a `preload` parameter to the `renderer()` helper and return it from the anonymous lookup's `getPreloadFiles()`.

Change the helper signature (add `array $preload = []` after `array $css = []`):

```php
    private function renderer(
        array $js = [],
        array $css = [],
        array $preload = [],
        array $integrity = [],
        ?DevServer $devServer = null,
        string|false $crossorigin = false,
        array $scriptAttributes = [],
        array $linkAttributes = [],
    ): TagRenderer {
```

Add `private array $preload` to the anonymous class constructor and pass `$preload` into it (mirror the existing `$js`/`$css` wiring), then make `getPreloadFiles` return it:

```php
            public function getPreloadFiles(string $entryName): array
            {
                return $this->preload;
            }
```

- [ ] **Step 2: Write the failing test**

```php
    public function testRendersModulepreloadLinksWithIntegrityBeforeScripts()
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            preload: ['build/shared-e5.js'],
            integrity: ['build/shared-e5.js' => 'sha384-shared'],
        )->renderScriptTags('app');

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared-e5.js" integrity="sha384-shared" crossorigin="anonymous">'
            .'<script src="/build/app-a1b2.js" type="module"></script>',
            $html,
        );
    }
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `vendor/bin/phpunit --filter Modulepreload tests/Asset/TagRendererTest.php`
Expected: FAIL — no `modulepreload` link emitted yet.

- [ ] **Step 4: Implement the modulepreload loop**

In `src/Asset/TagRenderer.php`, insert the preload loop in `renderScriptTags` between the HMR-client block and the `getJavaScriptFiles` loop:

```php
        foreach ($this->lookup->getPreloadFiles($entryName) as $reference) {
            $attributes = ['rel' => 'modulepreload', 'href' => $this->url($reference, $packageName)];
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($attributes));
        }
```

- [ ] **Step 5: Update the prod functional assertion**

The `app` entry in `tests/fixtures/build/entrypoints.json` has `preload: ["build/shared-e5f6.js"]` with `integrity["build/shared-e5f6.js"] = "sha384-shared"`, so `renderScriptTags('app')` now emits a `modulepreload` link before the script. Update the expected heredoc in `tests/Functional/AssetTagsTest.php::testScriptTagsRenderTheEntryWithResolvedUrlAndIntegrity`:

```php
        $expected = <<<'HTML'
            <link rel="modulepreload" href="/build/shared-e5f6.js" integrity="sha384-shared" crossorigin="anonymous"><script src="/build/app-a1b2.js" type="module" integrity="sha384-app" crossorigin="anonymous"></script>
            HTML;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/Asset/TagRendererTest.php tests/Functional/AssetTagsTest.php`
Expected: PASS.

- [ ] **Step 7: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src tests
vendor/bin/phpstan analyse
git add src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php tests/Functional/AssetTagsTest.php
git commit -m "[Twig] Emit modulepreload hints for an entry's preload chunks"
```

---

### Task 3: WebLink `Link:` header registration (optional)

When `symfony/web-link` is installed and a request is in flight, register each rendered reference on the request's `_links` provider so `AddLinkHeaderListener` emits `Link:` headers. Gated by a `reprise.preload` config toggle (default on).

**Files:**
- Modify: `composer.json`, `src/Asset/TagRenderer.php`, `src/RepriseBundle.php`
- Test: `tests/Asset/TagRendererTest.php`

**Interfaces:**
- Consumes: `Symfony\Component\HttpFoundation\RequestStack`; `Symfony\Component\WebLink\{Link, GenericLinkProvider}`.
- Produces: new `TagRenderer` constructor signature — `__construct(EntrypointsLookupInterface $lookup, Packages $packages, ?RequestStack $requestStack = null, ?string $defaultPackage = null, string|false $crossorigin = false, bool $preload = true, array $scriptAttributes = [], array $linkAttributes = [])`. New Reprise config key `preload` (bool, default true).

- [ ] **Step 1: Add web-link to require-dev**

```bash
composer require --dev "symfony/web-link:^7.4|^8.0"
```

Confirm `composer.json`'s `require-dev` now lists `symfony/web-link`. (If offline, add `"symfony/web-link": "^7.4|^8.0"` to `require-dev` by hand and run `composer update symfony/web-link`.)

- [ ] **Step 2: Update the test helper for requestStack + preload toggle**

In `tests/Asset/TagRendererTest.php`, add `?RequestStack $requestStack = null` and `bool $preloadEnabled = true` to the `renderer()` helper signature (after `array $linkAttributes = []`), add the `use` imports, and update the `new TagRenderer(...)` construction to the new arg order:

```php
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
```

```php
        return new TagRenderer(
            $lookup,
            $packages,
            $requestStack,
            null,
            $crossorigin,
            $preloadEnabled,
            $scriptAttributes,
            $linkAttributes,
        );
```

- [ ] **Step 3: Write the failing tests**

```php
    public function testRegistersPreloadLinksOnTheRequestWhenWebLinkIsAvailable()
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $renderer = $this->renderer(
            js: ['build/app-a1b2.js'],
            css: ['build/app-c3.css'],
            preload: ['build/shared-e5.js'],
            requestStack: $stack,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $links = $request->attributes->get('_links');
        $this->assertInstanceOf(GenericLinkProvider::class, $links);

        $byHref = [];
        foreach ($links->getLinks() as $link) {
            $byHref[$link->getHref()] = ['rels' => $link->getRels(), 'as' => $link->getAttributes()['as'] ?? null];
        }

        $this->assertSame(['modulepreload'], $byHref['/build/shared-e5.js']['rels']);
        $this->assertSame(['preload'], $byHref['/build/app-a1b2.js']['rels']);
        $this->assertSame('script', $byHref['/build/app-a1b2.js']['as']);
        $this->assertSame(['preload'], $byHref['/build/app-c3.css']['rels']);
        $this->assertSame('style', $byHref['/build/app-c3.css']['as']);
    }

    public function testDoesNotRegisterLinksWithoutACurrentRequest()
    {
        $renderer = $this->renderer(js: ['build/app-a1b2.js'], requestStack: new RequestStack());

        // No current request pushed: rendering must not throw and returns the tags as usual.
        $this->assertStringContainsString('<script', $renderer->renderScriptTags('app'));
    }

    public function testPreloadToggleDisablesLinkRegistration()
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(js: ['build/app-a1b2.js'], requestStack: $stack, preloadEnabled: false)
            ->renderScriptTags('app');

        $this->assertNull($request->attributes->get('_links'));
    }
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `vendor/bin/phpunit --filter 'Preload|WebLink|RegistersPreload' tests/Asset/TagRendererTest.php`
Expected: FAIL — constructor does not accept `requestStack`/`preload` and no links are registered.

- [ ] **Step 5: Implement the WebLink hook**

In `src/Asset/TagRenderer.php`, add imports:

```php
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
use Symfony\Component\WebLink\Link;
```

Update the constructor (insert `$requestStack` after `$packages`, `$preload` after `$crossorigin`):

```php
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
```

Register links from the render loops. In `renderScriptTags`, after building each `modulepreload` link add `$this->preload($this->url($reference, $packageName), 'modulepreload');` and after each entry script add `$this->preload($this->url($reference, $packageName), 'preload', 'script');`. In `renderLinkTags`, after each stylesheet add `$this->preload($this->url($reference, $packageName), 'preload', 'style');`. (Reuse the URL already computed for the tag rather than resolving twice — assign it to a `$url` local in each loop and pass that.)

Add the helper:

```php
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

        $linkProvider = $request->attributes->get('_links', new GenericLinkProvider());
        $request->attributes->set('_links', $linkProvider->withLink($link));
    }
```

- [ ] **Step 6: Wire the config key + service args**

In `src/RepriseBundle.php`, add the `preload` config node after `strict_mode`:

```php
                ->booleanNode('preload')
                    ->defaultTrue()
                    ->info('Register rendered assets as WebLink Link: headers (HTTP/2 preload). No-op when symfony/web-link is absent.')
                ->end()
```

Update the `loadExtension` config-array docblock to include `preload: bool`, and update the `reprise.tag_renderer` service args to the new constructor order:

```php
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `vendor/bin/phpunit`
Expected: PASS (full suite — the functional kernel picks up the new `preload` config default and the new service args).

- [ ] **Step 8: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src tests
vendor/bin/phpstan analyse
composer validate --strict
git add composer.json composer.lock src tests
git commit -m "[WebLink] Register rendered assets as Link: preload headers"
```

---

### Task 4: Dev-mode functional coverage for both bundlers

Boot the real kernel against a dev `entrypoints.json` and assert the rendered tags: Vite injects `@vite/client` and serves scripts from the dev-server origin; Rsbuild serves from the origin with no client injection.

**Files:**
- Create: `tests/fixtures/dev-rspack/entrypoints.json`, `tests/Functional/DevAssetTagsTest.php`
- Reuse: `tests/fixtures/dev/entrypoints.json` (Vite, `client: "vite"`), `tests/Kernel/FunctionalAppKernel.php`

**Interfaces:**
- Consumes: `FunctionalAppKernel(string $outputPath)` (exposes `reprise.tag_renderer` publicly).

- [ ] **Step 1: Create the Rsbuild dev fixture**

`tests/fixtures/dev-rspack/entrypoints.json` — same shape as the Vite dev fixture but `client: null`:

```json
{
    "isProd": false,
    "devServer": { "origin": "http://127.0.0.1:3000", "client": null },
    "publicPath": "/build/",
    "entryPoints": {
        "app": {
            "js": ["http://127.0.0.1:3000/build/app.js"],
            "css": [],
            "preload": [],
            "dynamic": []
        }
    }
}
```

- [ ] **Step 2: Write the dev functional tests**

`tests/Functional/DevAssetTagsTest.php`:

```php
<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Functional;

use PHPUnit\Framework\TestCase;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class DevAssetTagsTest extends TestCase
{
    private function renderer(string $fixture): TagRenderer
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/'.$fixture);
        $kernel->boot();

        return $kernel->getContainer()->get('reprise.tag_renderer');
    }

    public function testViteDevInjectsTheHmrClientAndServesFromTheOrigin()
    {
        // Vite dev emits `client: "vite"`, so the HMR client is injected once, before the entry
        // script; the script src is the dev-server origin URL, passed through by Packages unchanged.
        $expected = <<<'HTML'
            <script type="module" src="http://127.0.0.1:5173/@vite/client"></script><script src="http://127.0.0.1:5173/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev')->renderScriptTags('app'));
    }

    public function testRsbuildDevServesFromTheOriginWithNoClientInjection()
    {
        // Rsbuild dev emits `client: null` (its HMR client is compiled into the bundle), so nothing
        // is injected; the entry script still loads from the dev-server origin.
        $expected = <<<'HTML'
            <script src="http://127.0.0.1:3000/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev-rspack')->renderScriptTags('app'));
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/Functional/DevAssetTagsTest.php`
Expected: PASS (both bundlers).

- [ ] **Step 4: QA + commit**

```bash
vendor/bin/php-cs-fixer fix tests
vendor/bin/phpstan analyse
git add tests/fixtures/dev-rspack tests/Functional/DevAssetTagsTest.php
git commit -m "[Tests] Cover dev-mode tag rendering for Vite and Rsbuild"
```

---

### Task 5: Documentation — Rendering asset tags

Document the feature as an Encore-like experience: a new "Rendering asset tags" section (the four Twig functions, works out of the box) and flipped feature markers. **The existing "Using a CDN" section is left unchanged** — CDN stays the Encore way (`publicPath` set to the CDN URL for the build + `manifestKeyPrefix`), which is what a migrating Encore user already knows and which still works end-to-end under ADR 0001 (an absolute `publicPath` yields absolute refs that `Packages` passes through). Do **not** reframe CDN around `framework.assets`.

**Files:**
- Modify: `doc/index.rst`, `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Draft the "Rendering asset tags" section**

Use the `natural-writing-editor` agent to draft the prose. Insert a new section in `doc/index.rst` after the two bundler setup blocks (after the "Rsbuild" section, before "Symfony UX / Stimulus controllers"). It must contain, in the project's voice, framed as "it just works, like Encore":

- What the feature does: `RepriseBundle` reads `entrypoints.json` and renders the `<script>`/`<link>` tags for an entry in Twig — the same experience as WebpackEncoreBundle's `encore_entry_script_tags`/`encore_entry_link_tags`.
- The four Twig functions with a usage snippet: `reprise_entry_script_tags('app')` and `reprise_entry_link_tags('app')` in a template `<head>`, plus `reprise_entry_js_files('app')` / `reprise_entry_css_files('app')` (the raw URL lists, for when you need the paths rather than the tags).
- **No setup required for the common case.** The tags render against Symfony's default asset package, so a standard project needs nothing beyond installing the bundle and setting `output_path` if it differs from the default. The build writes docroot-relative references and the default package resolves them to `/build/...`.
- The optional Reprise config keys, briefly: `output_path`, `strict_mode`, `crossorigin`, `preload` (WebLink HTTP/2 preload headers), `script_attributes`, `link_attributes`. Write the YAML `reprise:` block with each key on its own line.
- **Advanced note (short):** `asset_package` lets you resolve URLs through a specific `framework.assets` package instead of the default — needed only if your default package applies a version strategy (which would re-hash the already-hashed Reprise files); point it at a package with `version: false`. Keep this to a couple of sentences; it is not the main flow.
- For CDN, cross-reference the existing "Using a CDN" section (set `publicPath` to the CDN URL for the build) rather than repeating it.
- Both bundlers: the Twig side is identical for Vite and Rsbuild, so show that explicitly (one Twig snippet, a note that it is the same regardless of which of the two `vite.config.ts` / `rsbuild.config.ts` setups from above you use). This satisfies the both-bundlers docs convention.
- The dev-server note: in dev, `reprise_entry_script_tags` injects the Vite HMR client automatically; with Rsbuild the HMR client is bundled in, so nothing extra is emitted — either way there is nothing to configure.

Follow the memory note on doc formatting: write `Symfony({...})` options and the `reprise:` YAML multi-line, one key per line.

- [ ] **Step 2: Flip the feature markers**

In `doc/index.rst` (lines ~16-26) and `README.md` (the feature bullet list), ensure "Dev server & HMR" and the tag-rendering capability read as delivered rather than planned. If a `*(planned)*` marker is present on the relevant bullets, remove it; if the lists carry no such markers, add a bullet naming the Twig tag rendering as a shipped capability. Keep both lists in sync. **Do not touch the "CDN support" or "Subresource Integrity" bullets or the "Using a CDN" section.**

- [ ] **Step 3: Verify the docs lint clean**

Run: `pnpm lint` (the repo lint; `doc/` is ignored by Oxlint, so this only confirms nothing else regressed) and re-read the edited `doc/index.rst` section to confirm the Twig usage is shown, both bundlers are addressed, and the RST code-block directives are well-formed.
Expected: no errors; the new section is Encore-like and the CDN section is untouched.

- [ ] **Step 4: Commit**

```bash
git add doc/index.rst README.md
git commit -m "[Docs] Document rendering asset tags in Twig"
```

---

## Self-Review

- **Spec coverage:** dev HMR (Task 1) ✓; modulepreload (Task 2) ✓; WebLink incl. `reprise.preload` toggle + `as=script`/`as=style` (Task 3) ✓; URL resolution via the default asset package, `asset_package`/`version: false` as an advanced note (documented Task 5, implemented Phase 2a) ✓; dev-mode functional for both bundlers (Task 4) ✓; docs "Rendering asset tags" (Task 5) ✓. **Deviation from spec (user decision):** the spec's "reframe CDN around framework.assets" is NOT done — CDN stays the Encore way (`publicPath` + `manifestKeyPrefix`), for coherence with Encore's own CDN doc; the "Using a CDN" section is left unchanged. Out of scope (unchanged): manifest.json / `asset()`, multi-build, `encore_*` aliases, React refresh preamble, rendering `dynamic` chunks.
- **Type consistency:** `TagRenderer` constructor final order (lookup, packages, requestStack, defaultPackage, crossorigin, preload, scriptAttributes, linkAttributes) is applied identically in Task 3's class, the `RepriseBundle` service args, and the test helper's `new TagRenderer(...)`. The test helper param order (js, css, preload, integrity, devServer, crossorigin, scriptAttributes, linkAttributes, requestStack, preloadEnabled) is internal to the test and passed by name.
- **Placeholder scan:** none — every code step carries complete code; doc steps name exact insertion points and required content.
```
