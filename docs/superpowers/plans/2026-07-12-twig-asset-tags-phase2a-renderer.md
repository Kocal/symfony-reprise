# Twig Asset Tags — Phase 2a (PHP renderer core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `{{ reprise_entry_script_tags('app') }}` / `reprise_entry_link_tags` / `reprise_entry_js_files` / `reprise_entry_css_files` render the `<script type="module">` / `<link rel="stylesheet">` tags for an entry, resolving each entrypoints.json reference through Symfony `Packages` (ADR 0001) and adding SRI `integrity`/`crossorigin` when present.

**Architecture:** A `TagRenderer` (in `src/Asset/`) consumes the existing `EntrypointsLookupInterface` plus Symfony's `Packages`, resolves each reference via `Packages::getUrl($ref, $packageName ?? $defaultPackage)`, and builds the tag HTML (modelled on WebpackEncoreBundle's `TagRenderer`). A Twig extension exposes the four `reprise_entry_*` functions. The bundle wires it up and adds config (`asset_package`, `crossorigin`, `script_attributes`, `link_attributes`). Dev-HMR injection, `modulepreload`, and WebLink are Phase 2b.

**Tech Stack:** PHP 8.4, Symfony (framework-bundle, asset, config, dependency-injection, http-kernel), Twig, PHPUnit.

## Global Constraints

- PHP style: `final` classes, `readonly` constructor-promoted props; validate untrusted input in factories (loose `array<mixed,mixed>` in, precise types out, no `@var`); `@internal` on implementations, not on the public interface; wirable-by-interface.
- Symfony license header on every new `.php` file (copy from an existing `src/` file verbatim), `@author Hugo Alliaume <hugo@alliau.me>`.
- Entrypoints references are docroot-relative in build (`build/app-<hash>.js`, from Phase 1); the renderer resolves them via `Packages`, never renders them as-is.
- The Reprise asset package must have no version strategy (files are pre-hashed). `reprise.asset_package` names a `framework.assets` package; unset -> framework default package.
- SRI: add `integrity` when `getIntegrityData()[$reference]` exists; add `crossorigin="anonymous"` alongside it (unless `crossorigin` config says otherwise).
- Commit scope `[Twig]`.
- QA gates: `vendor/bin/phpunit`, `vendor/bin/phpstan analyse` (level max), `vendor/bin/php-cs-fixer fix --dry-run`. Run the JS suite too only if JS changes (this plan is PHP-only except Task 1's fixture).

---

## Task 1: Align the PHP entrypoints fixture with the Phase-1 relative format

**Files:**
- Modify: `tests/fixtures/build/entrypoints.json`
- Modify: `tests/Asset/EntrypointsLookupFunctionalTest.php`

**Interfaces:**
- Produces: the build fixture carries docroot-relative references (`build/app-a1b2.js`), matching what the JS plugin now emits, so the renderer's Packages resolution is exercised realistically.

- [ ] **Step 1: Read the current fixture and test**

Read `tests/fixtures/build/entrypoints.json` and `tests/Asset/EntrypointsLookupFunctionalTest.php`. The fixture currently holds final URLs (`/build/app-a1b2.js`); the test asserts `['/build/app-a1b2.js']`.

- [ ] **Step 2: Update the fixture to relative references**

In `tests/fixtures/build/entrypoints.json`, strip the leading slash from every reference under `entryPoints.*.{js,css,preload,dynamic}` and from every `integrity` key (so `/build/app-a1b2.js` -> `build/app-a1b2.js`). Leave `isProd`, `publicPath`, `devServer` as they are.

- [ ] **Step 3: Update the lookup functional test assertions**

In `tests/Asset/EntrypointsLookupFunctionalTest.php`, change both `assertSame(['/build/app-a1b2.js'], …)` to `assertSame(['build/app-a1b2.js'], …)`.

- [ ] **Step 4: Run the PHP suite**

Run: `vendor/bin/phpunit`
Expected: PASS (the lookup returns the fixture's references verbatim; only the expected strings changed).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/build/entrypoints.json tests/Asset/EntrypointsLookupFunctionalTest.php
git commit -m "[Twig] Align the PHP entrypoints fixture with relative references"
```

---

## Task 2: `TagRenderer` — script/link tags via Packages + SRI

**Files:**
- Create: `src/Asset/TagRenderer.php`
- Test: `tests/Asset/TagRendererTest.php`

**Interfaces:**
- Consumes: `EntrypointsLookupInterface` (existing: `getJavaScriptFiles/getCssFiles(string): list<string>`, `getIntegrityData(): array<string,string>`, `getDevServer(): ?DevServer`, `reset()`), `Symfony\Component\Asset\Packages`.
- Produces:
  - `renderScriptTags(string $entryName, ?string $packageName = null): string`
  - `renderLinkTags(string $entryName, ?string $packageName = null): string`
  - `getJsFiles(string $entryName, ?string $packageName = null): list<string>`
  - `getCssFiles(string $entryName, ?string $packageName = null): list<string>`
  - `reset(): void`
  Constructor: `__construct(EntrypointsLookupInterface $lookup, Packages $packages, ?string $defaultPackage = null, string|false $crossorigin = false, array $scriptAttributes = [], array $linkAttributes = [])`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/Asset/TagRendererTest.php`. Use a hand-rolled fake lookup and a real `Packages` with a `PathPackage('/', new EmptyVersionStrategy())` so `getUrl('build/app.js')` -> `/build/app.js`. (Read `tests/Asset/EntrypointsLookupTest.php` for the license header to copy.)

```php
<?php

// <license header copied from an existing src/ file>

namespace Symfony\Reprise\Tests\Asset;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Asset\Package;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Reprise\Asset\DevServer;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;

final class TagRendererTest extends TestCase
{
    private function renderer(
        array $js = [],
        array $css = [],
        array $integrity = [],
        ?DevServer $devServer = null,
        string|false $crossorigin = false,
        array $scriptAttributes = [],
        array $linkAttributes = [],
    ): TagRenderer {
        $lookup = new class($js, $css, $integrity, $devServer) implements EntrypointsLookupInterface {
            public function __construct(
                private array $js,
                private array $css,
                private array $integrity,
                private ?DevServer $devServer,
            ) {
            }

            public function getJavaScriptFiles(string $entryName): array { return $this->js; }
            public function getCssFiles(string $entryName): array { return $this->css; }
            public function getPreloadFiles(string $entryName): array { return []; }
            public function getDynamicFiles(string $entryName): array { return []; }
            public function entryExists(string $entryName): bool { return true; }
            public function getIntegrityData(): array { return $this->integrity; }
            public function isProd(): bool { return null === $this->devServer; }
            public function getDevServer(): ?DevServer { return $this->devServer; }
            public function reset(): void {}
        };

        $packages = new Packages(new PathPackage('/', new EmptyVersionStrategy()));

        return new TagRenderer($lookup, $packages, null, $crossorigin, $scriptAttributes, $linkAttributes);
    }

    public function testRendersModuleScriptTagsWithPackagesResolvedSrc(): void
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertSame('<script src="/build/app-a1b2.js" type="module"></script>', $html);
    }

    public function testRendersStylesheetLinkTags(): void
    {
        $html = $this->renderer(css: ['build/app-c3.css'])->renderLinkTags('app');
        $this->assertSame('<link rel="stylesheet" href="/build/app-c3.css">', $html);
    }

    public function testAddsIntegrityAndCrossoriginWhenPresent(): void
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            integrity: ['build/app-a1b2.js' => 'sha384-XYZ'],
        )->renderScriptTags('app');
        $this->assertStringContainsString('integrity="sha384-XYZ"', $html);
        $this->assertStringContainsString('crossorigin="anonymous"', $html);
    }

    public function testNoCrossoriginWithoutIntegrity(): void
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertStringNotContainsString('crossorigin', $html);
    }

    public function testGetJsFilesReturnsResolvedUrlsWithoutTags(): void
    {
        $urls = $this->renderer(js: ['build/app-a1b2.js', 'build/vendor-e5.js'])->getJsFiles('app');
        $this->assertSame(['/build/app-a1b2.js', '/build/vendor-e5.js'], $urls);
    }

    public function testScriptAndLinkDefaultAttributesAreApplied(): void
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true])->renderScriptTags('app');
        $this->assertStringContainsString(' defer', $html);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vendor/bin/phpunit --filter TagRendererTest`
Expected: FAIL — `Symfony\Reprise\Asset\TagRenderer` does not exist.

- [ ] **Step 3: Implement `src/Asset/TagRenderer.php`**

```php
<?php

// <license header copied from an existing src/ file>

namespace Symfony\Reprise\Asset;

use Symfony\Component\Asset\Packages;
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
     * @param array<string, mixed> $scriptAttributes
     * @param array<string, mixed> $linkAttributes
     */
    public function __construct(
        private readonly EntrypointsLookupInterface $lookup,
        private readonly Packages $packages,
        private readonly ?string $defaultPackage = null,
        private readonly string|false $crossorigin = false,
        private readonly array $scriptAttributes = [],
        private readonly array $linkAttributes = [],
    ) {
    }

    public function renderScriptTags(string $entryName, ?string $packageName = null): string
    {
        $integrity = $this->lookup->getIntegrityData();
        $tags = [];
        foreach ($this->lookup->getJavaScriptFiles($entryName) as $reference) {
            $attributes = ['src' => $this->url($reference, $packageName), 'type' => 'module'];
            $attributes += $this->scriptAttributes;
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<script %s></script>', $this->attributes($attributes));
        }

        return implode('', $tags);
    }

    public function renderLinkTags(string $entryName, ?string $packageName = null): string
    {
        $integrity = $this->lookup->getIntegrityData();
        $tags = [];
        foreach ($this->lookup->getCssFiles($entryName) as $reference) {
            $attributes = ['rel' => 'stylesheet', 'href' => $this->url($reference, $packageName)];
            $attributes += $this->linkAttributes;
            $this->applyIntegrity($attributes, $reference, $integrity);
            $tags[] = \sprintf('<link %s>', $this->attributes($attributes));
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
        // No per-request state yet (dev-HMR injection is Phase 2b). The lookup owns reference dedup.
    }

    private function url(string $reference, ?string $packageName): string
    {
        return $this->packages->getUrl($reference, $packageName ?? $this->defaultPackage);
    }

    /**
     * @param array<string, mixed>  $attributes
     * @param array<string, string> $integrity
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
     * @param array<string, mixed> $attributes
     */
    private function attributes(array $attributes): string
    {
        $attributes = array_filter($attributes, static fn ($v) => false !== $v);

        return implode(' ', array_map(
            static fn (string $k, $v) => true === $v || null === $v ? $k : \sprintf('%s="%s"', $k, htmlspecialchars((string) $v, \ENT_QUOTES)),
            array_keys($attributes),
            $attributes,
        ));
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `vendor/bin/phpunit --filter TagRendererTest`
Expected: PASS (6 tests).

- [ ] **Step 5: PHP QA + commit**

Run: `vendor/bin/php-cs-fixer fix src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php` then `vendor/bin/phpstan analyse` and `vendor/bin/phpunit`.

```bash
git add src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php
git commit -m "[Twig] Add TagRenderer resolving entry references through Packages"
```

---

## Task 3: Twig extension + DI wiring + config options

**Files:**
- Create: `src/Twig/AssetExtension.php`
- Modify: `src/RepriseBundle.php`
- Test: `tests/Twig/AssetExtensionTest.php`

**Interfaces:**
- Consumes: `TagRenderer` (Task 2).
- Produces: Twig functions `reprise_entry_script_tags(entry, package=null)`, `reprise_entry_link_tags(entry, package=null)`, `reprise_entry_js_files(entry, package=null)`, `reprise_entry_css_files(entry, package=null)`. New config keys `asset_package` (nullable string), `crossorigin` (false|'anonymous'|'use-credentials'), `script_attributes` (array), `link_attributes` (array).

- [ ] **Step 1: Write the failing extension unit test**

Create `tests/Twig/AssetExtensionTest.php`: build a `TagRenderer` (reuse the fake-lookup pattern from `TagRendererTest` — copy the anonymous-class lookup) and assert the extension's functions delegate to it.

```php
// header + namespace Symfony\Reprise\Tests\Twig;
// use the same fake lookup + real Packages(PathPackage('/', EmptyVersionStrategy)) as TagRendererTest
final class AssetExtensionTest extends TestCase
{
    public function testExposesTheFourRepriseFunctions(): void
    {
        $ext = new AssetExtension($this->tagRenderer(js: ['build/app.js']));
        $names = array_map(fn ($f) => $f->getName(), $ext->getFunctions());
        sort($names);
        $this->assertSame(
            ['reprise_entry_css_files', 'reprise_entry_js_files', 'reprise_entry_link_tags', 'reprise_entry_script_tags'],
            $names,
        );
    }

    public function testScriptTagsFunctionDelegatesToTheRenderer(): void
    {
        $ext = new AssetExtension($this->tagRenderer(js: ['build/app-a1b2.js']));
        $this->assertSame('<script src="/build/app-a1b2.js" type="module"></script>', $ext->scriptTags('app'));
    }

    public function testTagFunctionsAreMarkedHtmlSafe(): void
    {
        $ext = new AssetExtension($this->tagRenderer());
        foreach ($ext->getFunctions() as $fn) {
            if (str_ends_with($fn->getName(), '_tags')) {
                $this->assertContains('html', $fn->getSafe(new \Twig\Node\Node()) ?: []);
            }
        }
    }
}
```

(`tagRenderer(...)` is a small helper that builds a `TagRenderer` the same way `TagRendererTest::renderer` does — copy it.)

- [ ] **Step 2: Run to verify it fails**

Run: `vendor/bin/phpunit --filter AssetExtensionTest`
Expected: FAIL — `Symfony\Reprise\Twig\AssetExtension` does not exist.

- [ ] **Step 3: Implement `src/Twig/AssetExtension.php`**

```php
<?php

// <license header>

namespace Symfony\Reprise\Twig;

use Symfony\Reprise\Asset\TagRenderer;
use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;

/**
 * Exposes the reprise_entry_* Twig functions.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class AssetExtension extends AbstractExtension
{
    public function __construct(private readonly TagRenderer $tagRenderer)
    {
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('reprise_entry_script_tags', $this->scriptTags(...), ['is_safe' => ['html']]),
            new TwigFunction('reprise_entry_link_tags', $this->linkTags(...), ['is_safe' => ['html']]),
            new TwigFunction('reprise_entry_js_files', $this->jsFiles(...)),
            new TwigFunction('reprise_entry_css_files', $this->cssFiles(...)),
        ];
    }

    public function scriptTags(string $entryName, ?string $packageName = null): string
    {
        return $this->tagRenderer->renderScriptTags($entryName, $packageName);
    }

    public function linkTags(string $entryName, ?string $packageName = null): string
    {
        return $this->tagRenderer->renderLinkTags($entryName, $packageName);
    }

    /**
     * @return list<string>
     */
    public function jsFiles(string $entryName, ?string $packageName = null): array
    {
        return $this->tagRenderer->getJsFiles($entryName, $packageName);
    }

    /**
     * @return list<string>
     */
    public function cssFiles(string $entryName, ?string $packageName = null): array
    {
        return $this->tagRenderer->getCssFiles($entryName, $packageName);
    }
}
```

- [ ] **Step 4: Run the extension test to verify it passes**

Run: `vendor/bin/phpunit --filter AssetExtensionTest`
Expected: PASS.

- [ ] **Step 5: Add config keys + wire the services in `src/RepriseBundle.php`**

In `configure()`, add under the existing children (after `strict_mode`):

```php
                ->scalarNode('asset_package')
                    ->defaultNull()
                    ->info('Name of a framework.assets package used to resolve entry URLs (must have no version strategy). Null uses the default package.')
                ->end()
                ->scalarNode('crossorigin')
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
```

Update the `loadExtension` `@param` phpdoc shape to include the new keys, then register the services (after the existing `reprise.entrypoints_lookup` / reset listener):

```php
        $services->set('reprise.tag_renderer', TagRenderer::class)
            ->args([
                service('reprise.entrypoints_lookup'),
                service('assets.packages'),
                $config['asset_package'],
                $config['crossorigin'],
                $config['script_attributes'],
                $config['link_attributes'],
            ])
            ->tag('kernel.reset', ['method' => 'reset'])
        ;

        $services->set('reprise.twig_extension', AssetExtension::class)
            ->args([service('reprise.tag_renderer')])
            ->tag('twig.extension')
        ;
```

Add the imports (`use Symfony\Reprise\Asset\TagRenderer; use Symfony\Reprise\Twig\AssetExtension;`).

Note: `assets.packages` is the framework `Packages` service; it only exists when `framework.assets` is enabled. That is a documented requirement (Phase 2b docs); the functional test in Task 4 enables it.

- [ ] **Step 6: PHP QA + commit**

Run: `vendor/bin/php-cs-fixer fix src/ tests/Twig/` then `vendor/bin/phpstan analyse` and `vendor/bin/phpunit`.

```bash
git add src/Twig/AssetExtension.php src/RepriseBundle.php tests/Twig/AssetExtensionTest.php
git commit -m "[Twig] Add the reprise_entry_* Twig functions and wire the renderer"
```

---

## Task 4: Functional test — render tags through a booted kernel

**Files:**
- Create: `tests/Kernel/RendererAppKernel.php` (a kernel enabling `framework.assets` + a version-less `reprise` package + `reprise.asset_package: reprise`)
- Test: `tests/Twig/AssetExtensionFunctionalTest.php`

**Interfaces:**
- Consumes: the wired `reprise.tag_renderer` + `reprise.twig_extension`, the `build` fixture (Task 1).

- [ ] **Step 1: Write the failing functional test**

Read `tests/Kernel/FrameworkAppKernel.php` and `tests/Asset/EntrypointsLookupFunctionalTest.php` for the exact kernel + fixture-path pattern. Create `tests/Kernel/RendererAppKernel.php` mirroring `FrameworkAppKernel` but whose `registerContainerConfiguration` also configures assets and the reprise output_path/package:

```php
            $container->loadFromExtension('framework', [
                'secret' => '$ecret',
                'test' => true,
                'http_method_override' => false,
                'assets' => [
                    'packages' => [
                        'reprise' => [
                            'version' => null, // no versioning: Reprise files are already hashed
                        ],
                    ],
                ],
            ]);
            $container->loadFromExtension('reprise', [
                'output_path' => $this->buildDir,
                'asset_package' => 'reprise',
            ]);
```

(The kernel takes the fixture build dir in its constructor like `FunctionalAppKernel`; store it in `$this->buildDir`. Confirm the exact constructor/property pattern by reading `FunctionalAppKernel.php`.)

Create `tests/Twig/AssetExtensionFunctionalTest.php`:

```php
final class AssetExtensionFunctionalTest extends TestCase
{
    public function testScriptTagsRenderThroughTheContainer(): void
    {
        $kernel = new RendererAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();
        $renderer = $kernel->getContainer()->get('reprise.tag_renderer');

        $html = $renderer->renderScriptTags('app');
        $this->assertStringContainsString('<script ', $html);
        $this->assertStringContainsString('type="module"', $html);
        $this->assertStringContainsString('src="/build/app-a1b2.js"', $html); // relative ref -> Packages -> /build/…
    }

    public function testLinkTagsRenderThroughTheContainer(): void
    {
        $kernel = new RendererAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();
        $renderer = $kernel->getContainer()->get('reprise.tag_renderer');

        $this->assertStringContainsString('rel="stylesheet"', $renderer->renderLinkTags('app'));
    }
}
```

Make `reprise.tag_renderer` fetchable in the test: either mark it public in a test-only pass, or fetch it via `$kernel->getContainer()->get()` in a `test` env (services are public in the test container when fetched through `getContainer()` on a `test`-enabled kernel; confirm by mirroring how `EntrypointsLookupFunctionalTest` fetches `EntrypointsLookupInterface`). If the service is private, add `->public()` to `reprise.tag_renderer` in `loadExtension`, or fetch via the `EntrypointsLookupInterface`-style alias.

- [ ] **Step 2: Run to verify it fails, then implement/adjust, then passes**

Run: `vendor/bin/phpunit --filter AssetExtensionFunctionalTest`
Expected: FAIL first (kernel/service wiring), then PASS once the kernel + service visibility are correct. If `assets.packages` is missing, confirm `framework.assets` is enabled in the kernel; if the service is private, make `reprise.tag_renderer` public.

- [ ] **Step 3: Full PHP suite + QA**

Run: `vendor/bin/phpunit && vendor/bin/phpstan analyse && vendor/bin/php-cs-fixer fix --dry-run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/Kernel/RendererAppKernel.php tests/Twig/AssetExtensionFunctionalTest.php src/RepriseBundle.php
git commit -m "[Twig] Cover tag rendering end-to-end through a booted kernel"
```

---

## Final verification

- [ ] **Full PHP gate**

Run: `vendor/bin/phpunit && vendor/bin/phpstan analyse && vendor/bin/php-cs-fixer fix --dry-run && composer validate --strict`
Expected: PASS.

- [ ] **Spec cross-check (Phase 2a slice)**

Confirm against `docs/superpowers/specs/2026-07-11-twig-asset-tags-design.md` §B/§C: four `reprise_entry_*` functions; `type="module"`; integrity + crossorigin when present; resolution via a `framework.assets` package (`asset_package`, version-less); config keys added. Deferred to Phase 2b (not this plan): dev `@vite/client` injection, `modulepreload`/`preload` rendering, WebLink, and the docs section.
