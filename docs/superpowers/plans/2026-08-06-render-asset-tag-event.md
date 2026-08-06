# RenderAssetTagEvent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dispatch a `RenderAssetTagEvent` before every `<script>`/`<link>` Reprise renders — including the injected HMR client and the React Refresh preamble — so listeners can add/change/remove attributes such as a CSP `nonce`.

**Architecture:** A new public `Symfony\Reprise\Event\RenderAssetTagEvent` (private `type`, public mutable `attributes`, `isScript()`/`isLink()`). `TagRenderer` gains a nullable `EventDispatcherInterface` and one private `tag()` helper that every user-facing tag flows through: it dispatches the event, reads back `attributes`, then renders. Config `script_attributes`/`link_attributes` and per-call `attributes` seed all script tags (files, client, preamble) — the "unified path". `modulepreload` links stay out of the event.

**Tech Stack:** PHP 8.4, Symfony (asset + event-dispatcher-contracts in `require`, framework-bundle for tests), PHPUnit 13.

## Global Constraints

- PHP `>=8.4`; strict types match the rest of `src/` (readonly promoted props, `node:`-style discipline N/A here).
- Commit messages: Symfony style `[Scope] Imperative subject`, subject line only (no body). Final squashed commit scope: `[TagRenderer]`.
- Comments: zero by default; one short line only when the "why" is non-obvious. Applies to tests too.
- Docs: this is a backend, bundler-agnostic feature — ship a **single PHP listener example**, not a Vite+Rsbuild pair; no JS/functional bundler test symmetry.
- CHANGELOG: features only; one terse bullet under a new `## 0.7.0`.
- Existing output must stay byte-identical when no listener is registered (regression guard = the existing `TagRendererTest` + `DevAssetTagsTest` staying green).
- Declare `symfony/event-dispatcher-contracts` (`^3`) in `require` — it provides the type-hinted `EventDispatcherInterface` (honest: `symfony/event-dispatcher` is already used unconditionally by `ResetAssetsEventListener`). The concrete `event_dispatcher` **service** stays app-provided (framework-bundle): wire `service('event_dispatcher')->nullOnInvalid()` + nullable ctor arg + `if (null !== $this->eventDispatcher)` guard. **No `composer suggest` block.** (The bundle's broader missing runtime `require`s — http-kernel/config/DI/http-foundation/event-dispatcher/service-contracts — are a separate audit, out of this plan's scope.)

---

### Task 1: The `RenderAssetTagEvent` class

**Files:**
- Create: `src/Event/RenderAssetTagEvent.php`
- Modify: `composer.json` (add `symfony/event-dispatcher-contracts` to `require`)

**Interfaces:**
- Produces: `Symfony\Reprise\Event\RenderAssetTagEvent` with `public const TYPE_SCRIPT = 'script'`, `public const TYPE_LINK = 'link'`, constructor `__construct(private readonly string $type, public array $attributes)`, methods `isScript(): bool`, `isLink(): bool`. `$attributes` is `array<string, bool|string>`, mutated in place by listeners.

`symfony/event-dispatcher-contracts` provides `Symfony\Contracts\EventDispatcher\EventDispatcherInterface`, type-hinted by `TagRenderer` in Task 2. It goes in `require` (not `require-dev`): it is a genuine runtime interface dependency.

- [ ] **Step 1: Add the composer dependency**

In `composer.json`, add to the `require` block (after `"symfony/asset": "^7.4|^8.0",`):

```json
"symfony/event-dispatcher-contracts": "^3",
```

- [ ] **Step 2: Sync the lock file**

Run: `composer update symfony/event-dispatcher-contracts --no-interaction`
Expected: the package is recorded in `composer.lock` (it is likely already installed transitively via framework-bundle; this pins it as a direct dependency).

- [ ] **Step 3: Create the event class**

Create `src/Event/RenderAssetTagEvent.php`:

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

namespace Symfony\Reprise\Event;

/**
 * Dispatched each time a <script> or <link> tag is rendered, so listeners can add, change or
 * remove attributes (e.g. a CSP nonce) before the tag is written. Covers the entry files, the
 * CSS, and the dev-server tags Reprise injects itself (the HMR client and React preamble).
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class RenderAssetTagEvent
{
    public const TYPE_SCRIPT = 'script';
    public const TYPE_LINK = 'link';

    /**
     * @param array<string, bool|string> $attributes mutable; add/change/remove entries directly
     */
    public function __construct(
        private readonly string $type,
        public array $attributes,
    ) {
    }

    public function isScript(): bool
    {
        return self::TYPE_SCRIPT === $this->type;
    }

    public function isLink(): bool
    {
        return self::TYPE_LINK === $this->type;
    }
}
```

- [ ] **Step 4: Static analysis + style on the new file**

Run: `vendor/bin/phpstan analyse src/Event/RenderAssetTagEvent.php` then `vendor/bin/php-cs-fixer fix src/Event/RenderAssetTagEvent.php`
Expected: no PHPStan errors; file already conforms (no diff, or the header/spacing gets normalized).

- [ ] **Step 5: Commit**

```bash
git add src/Event/RenderAssetTagEvent.php composer.json composer.lock
git commit -m "[TagRenderer] Add the RenderAssetTagEvent class"
```

---

### Task 2: Route file tags through a dispatching `tag()` helper + wire the dispatcher

**Files:**
- Modify: `src/Asset/TagRenderer.php`
- Modify: `src/RepriseBundle.php:148-160` (the `reprise.tag_renderer` definition)
- Test: `tests/Asset/TagRendererTest.php`

**Interfaces:**
- Consumes: `RenderAssetTagEvent` (Task 1); `Symfony\Contracts\EventDispatcher\EventDispatcherInterface`.
- Produces: `TagRenderer::__construct(..., ?EventDispatcherInterface $eventDispatcher = null)` — new **last** parameter; private `TagRenderer::tag(string $type, array $attributes, ?string $inlineBody = null): string`.

- [ ] **Step 1: Update the test helper to accept a dispatcher**

In `tests/Asset/TagRendererTest.php`, add the import and extend the `renderer()` helper signature + call:

```php
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
```

Add a parameter to `renderer()` (after `?Packages $packages = null`):

```php
        ?EventDispatcherInterface $eventDispatcher = null,
```

and pass it as the new last argument of the `new TagRenderer(...)` call (after `$linkAttributes,`):

```php
            $eventDispatcher,
```

- [ ] **Step 2: Write the failing test — a listener adds an attribute to a script tag**

Add to `tests/Asset/TagRendererTest.php` (add `use Symfony\Component\EventDispatcher\EventDispatcher;` at the top):

```php
    public function testAListenerCanAddAnAttributeToAScriptTag()
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            $event->attributes['nonce'] = 'r4nd0m';
        });

        $html = $this->renderer(js: ['build/app.js'], eventDispatcher: $dispatcher)->renderScriptTags('app');

        $this->assertSame('<script src="/build/app.js" type="module" nonce="r4nd0m"></script>', $html);
    }
```

Add the import `use Symfony\Reprise\Event\RenderAssetTagEvent;` too.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec true; vendor/bin/phpunit --filter testAListenerCanAddAnAttributeToAScriptTag`
Expected: FAIL — the dispatcher is never called (no `nonce` in the output).

- [ ] **Step 4: Add the constructor arg + `tag()` helper, route JS/CSS through it**

In `src/Asset/TagRenderer.php`:

Add imports:

```php
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Symfony\Reprise\Event\RenderAssetTagEvent;
```

Add the constructor parameter as the **last** one (after `array $linkAttributes = []`):

```php
        private readonly ?EventDispatcherInterface $eventDispatcher = null,
```

Add the private helper (e.g. just above `attributes()`):

```php
    /**
     * @param array<string, bool|string> $attributes
     */
    private function tag(string $type, array $attributes, ?string $inlineBody = null): string
    {
        if (null !== $this->eventDispatcher) {
            $event = $this->eventDispatcher->dispatch(new RenderAssetTagEvent($type, $attributes));
            $attributes = $event->attributes;
        }

        if (RenderAssetTagEvent::TYPE_LINK === $type) {
            return \sprintf('<link %s>', $this->attributes($attributes));
        }

        return \sprintf('<script %s>%s</script>', $this->attributes($attributes), $inlineBody ?? '');
    }
```

In `renderScriptTags()`, replace the JS-files loop body line that builds the tag:

```php
            $tags[] = \sprintf('<script %s></script>', $this->attributes($tagAttributes));
```

with:

```php
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $tagAttributes);
```

In `renderLinkTags()`, replace:

```php
            $tags[] = \sprintf('<link %s>', $this->attributes($tagAttributes));
```

with:

```php
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_LINK, $tagAttributes);
```

Leave the `modulepreload` loop's `\sprintf('<link %s>', $this->attributes($tagAttributes))` untouched.

- [ ] **Step 5: Run the new test + the full TagRenderer suite**

Run: `vendor/bin/phpunit tests/Asset/TagRendererTest.php`
Expected: the new test PASSES and every existing test still PASSES (byte-identical output when no dispatcher is passed).

- [ ] **Step 6: Wire the dispatcher in the bundle**

In `src/RepriseBundle.php`, in the `reprise.tag_renderer` `->args([...])`, add as the **last** argument (after `$config['link_attributes'],`):

```php
                service('event_dispatcher')->nullOnInvalid(),
```

`->nullOnInvalid()` guards the concrete **service** (registered by the app, not by the contracts package from Task 1): if no `event_dispatcher` service exists, `null` is injected and the `tag()` guard skips dispatch. (`service` and `->nullOnInvalid()` come from `Symfony\Component\DependencyInjection\Loader\Configurator` — `service` is already imported at the top of the file.)

- [ ] **Step 7: Run the bundle boot tests**

Run: `vendor/bin/phpunit tests/RepriseBundleTest.php tests/Functional/DevAssetTagsTest.php tests/Functional/AssetTagsTest.php`
Expected: PASS — the container compiles with the new argument, and the dev/build functional exact-match tests are unchanged (no listener → identical output).

- [ ] **Step 8: Static analysis + style**

Run: `vendor/bin/phpstan analyse` then `vendor/bin/php-cs-fixer fix src/Asset/TagRenderer.php src/RepriseBundle.php`
Expected: no PHPStan errors; style clean.

- [ ] **Step 9: Commit**

```bash
git add src/Asset/TagRenderer.php src/RepriseBundle.php tests/Asset/TagRendererTest.php
git commit -m "[TagRenderer] Route asset tags through a dispatched RenderAssetTagEvent"
```

---

### Task 3: Apply the event to the injected HMR client and the React preamble

**Files:**
- Modify: `src/Asset/TagRenderer.php` (the dev-server block in `renderScriptTags()`, and `renderReactRefreshPreamble()`)
- Test: `tests/Asset/TagRendererTest.php`

**Interfaces:**
- Consumes: `TagRenderer::tag()` (Task 2).
- Produces: `TagRenderer::reactRefreshPreamble(string $reactRefreshUrl): string` (renamed from `renderReactRefreshPreamble`, now returns the **inner JS body only**).

- [ ] **Step 1: Write the failing tests — event reaches the client, preamble, css; type reported; attr removal; modulepreload excluded; leak test inverted**

In `tests/Asset/TagRendererTest.php`, **replace** the existing `testPerCallAttributesDoNotLeakIntoTheHmrClient` method entirely with:

```php
    public function testPerCallAttributesApplyToTheHmrClient()
    {
        // Unified path: per-call attributes now seed the injected client too (issue #71).
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        )->renderScriptTags('app', attributes: ['defer' => true]);

        $this->assertStringContainsString('<script type="module" src="http://127.0.0.1:5173/build/@vite/client" defer></script>', $html);
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" defer></script>', $html);
    }
```

Then add these new tests:

```php
    public function testAListenerCanAddAnAttributeToEveryRenderedTag()
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            $event->attributes['nonce'] = 'r4nd0m';
        });

        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            css: ['build/app.css'],
            devServer: new DevServer(
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5173/build/@vite/client',
                'http://127.0.0.1:5173/build/@react-refresh',
            ),
            eventDispatcher: $dispatcher,
        );

        $scripts = $renderer->renderScriptTags('app');
        $links = $renderer->renderLinkTags('app');

        $this->assertStringContainsString('<script type="module" src="http://127.0.0.1:5173/build/@vite/client" nonce="r4nd0m"></script>', $scripts);
        $this->assertStringContainsString('<script type="module" nonce="r4nd0m">', $scripts); // the preamble
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" nonce="r4nd0m"></script>', $scripts);
        $this->assertStringContainsString('<link rel="stylesheet" href="/build/app.css" nonce="r4nd0m">', $links);
    }

    public function testTheEventReportsScriptOrLinkToTheListener()
    {
        $types = [];
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event) use (&$types): void {
            $types[] = $event->isScript() ? 'script' : ($event->isLink() ? 'link' : 'other');
        });

        $renderer = $this->renderer(js: ['build/app.js'], css: ['build/app.css'], eventDispatcher: $dispatcher);
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $this->assertSame(['script', 'link'], $types);
    }

    public function testAListenerCanRemoveAConfiguredAttribute()
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            unset($event->attributes['defer']);
        });

        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true], eventDispatcher: $dispatcher)
            ->renderScriptTags('app');

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testModulepreloadLinksAreNotDispatchedToListeners()
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            $event->attributes['nonce'] = 'r4nd0m';
        });

        $html = $this->renderer(js: ['build/app.js'], preload: ['build/shared.js'], eventDispatcher: $dispatcher)
            ->renderScriptTags('app');

        // The modulepreload link never reaches a listener; only the <script> carries the nonce.
        $this->assertStringContainsString('<link rel="modulepreload" href="/build/shared.js">', $html);
        $this->assertStringContainsString('<script src="/build/app.js" type="module" nonce="r4nd0m"></script>', $html);
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `vendor/bin/phpunit tests/Asset/TagRendererTest.php --filter 'testPerCallAttributesApplyToTheHmrClient|testAListenerCanAddAnAttributeToEveryRenderedTag|testTheEventReportsScriptOrLinkToTheListener|testAListenerCanRemoveAConfiguredAttribute|testModulepreloadLinksAreNotDispatchedToListeners'`
Expected: FAIL — the client/preamble are still emitted with the old raw `sprintf` (no per-call attrs, no event), so the nonce/`defer` do not appear on them and the preamble is not dispatched.

- [ ] **Step 3: Route the client + preamble through `tag()`; split out the preamble body**

In `src/Asset/TagRenderer.php`, replace the dev-server block in `renderScriptTags()`:

```php
        $devServer = $lookup->getDevServer();
        if (null !== $devServer && null !== $devServer->client && !isset($this->injectedClients[$devServer->client])) {
            $tags[] = \sprintf('<script type="module" src="%s"></script>', htmlspecialchars($devServer->client, \ENT_QUOTES));
            if (null !== $devServer->reactRefresh) {
                $tags[] = $this->renderReactRefreshPreamble($devServer->reactRefresh);
            }
            $this->injectedClients[$devServer->client] = true;
        }
```

with:

```php
        $devServer = $lookup->getDevServer();
        if (null !== $devServer && null !== $devServer->client && !isset($this->injectedClients[$devServer->client])) {
            $clientAttributes = ['type' => 'module', 'src' => $devServer->client] + $attributes + $this->scriptAttributes;
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $clientAttributes);
            if (null !== $devServer->reactRefresh) {
                $preambleAttributes = ['type' => 'module'] + $attributes + $this->scriptAttributes;
                $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $preambleAttributes, $this->reactRefreshPreamble($devServer->reactRefresh));
            }
            $this->injectedClients[$devServer->client] = true;
        }
```

Then replace the whole `renderReactRefreshPreamble()` method:

```php
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
```

with one that returns only the inner JS body (leading + trailing newline so the wrapped output stays byte-identical, and the doc comment kept):

```php
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
```

(The blank first and last lines inside the heredoc become the leading/trailing `\n`, so `tag()` produces `<script type="module">\nimport …true;\n</script>` — identical to today when no listener runs.)

- [ ] **Step 4: Run the new tests + the full suite**

Run: `vendor/bin/phpunit tests/Asset/TagRendererTest.php`
Expected: all the new tests PASS, and the pre-existing dev tests (`testInjectsViteHmrClientOncePerRequestInDev`, `testInjectsReactRefreshPreambleAfterTheClientAndBeforeTheEntryInDev`, `testDoesNotInjectReactRefreshPreambleWhenNotAReactApp`, `testInjectsEachBuildsHmrClientOncePerRequest`) still PASS unchanged.

- [ ] **Step 5: Run the functional dev suite (byte-identical guard)**

Run: `vendor/bin/phpunit tests/Functional/DevAssetTagsTest.php`
Expected: PASS — the injected client's exact HTML is unchanged (no listener registered in that kernel path).

- [ ] **Step 6: Static analysis + style**

Run: `vendor/bin/phpstan analyse` then `vendor/bin/php-cs-fixer fix src/Asset/TagRenderer.php`
Expected: no errors; style clean.

- [ ] **Step 7: Commit**

```bash
git add src/Asset/TagRenderer.php tests/Asset/TagRendererTest.php
git commit -m "[TagRenderer] Dispatch the event for the injected client and preamble"
```

---

### Task 4: End-to-end integration test through the container

**Files:**
- Modify: `tests/Kernel/FunctionalAppKernel.php:73-86` (expose `event_dispatcher` publicly for the test)
- Test: `tests/Functional/DevAssetTagsTest.php`

**Interfaces:**
- Consumes: the wired `reprise.tag_renderer` + `event_dispatcher` from the booted container.

- [ ] **Step 1: Expose `event_dispatcher` in the functional kernel**

In `tests/Kernel/FunctionalAppKernel.php`, inside `process()`, after the existing `setPublic(true)` lines, add:

```php
        if ($container->hasAlias('event_dispatcher')) {
            $container->getAlias('event_dispatcher')->setPublic(true);
        } elseif ($container->hasDefinition('event_dispatcher')) {
            $container->getDefinition('event_dispatcher')->setPublic(true);
        }
```

- [ ] **Step 2: Write the failing integration test**

In `tests/Functional/DevAssetTagsTest.php`, add the import `use Symfony\Reprise\Event\RenderAssetTagEvent;` and the test:

```php
    public function testARenderAssetTagListenerCanNonceTheInjectedClientAndScripts()
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/dev');
        $kernel->boot();
        $container = $kernel->getContainer();

        $container->get('event_dispatcher')->addListener(
            RenderAssetTagEvent::class,
            static function (RenderAssetTagEvent $event): void {
                $event->attributes['nonce'] = 'test-nonce';
            },
        );

        $html = $container->get('reprise.tag_renderer')->renderScriptTags('app');

        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/@vite/client" nonce="test-nonce">', $html);
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" nonce="test-nonce">', $html);
    }
```

- [ ] **Step 3: Run it**

Run: `vendor/bin/phpunit tests/Functional/DevAssetTagsTest.php --filter testARenderAssetTagListenerCanNonceTheInjectedClientAndScripts`
Expected: PASS — the same dispatcher instance is injected into `reprise.tag_renderer`, so the runtime listener's nonce lands on both the injected client and the entry script end-to-end. (If it fails because `event_dispatcher` is not fetchable, re-check Step 1 ran in the compiled container.)

- [ ] **Step 4: Run the whole PHP suite**

Run: `vendor/bin/phpunit`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add tests/Kernel/FunctionalAppKernel.php tests/Functional/DevAssetTagsTest.php
git commit -m "[TagRenderer] Cover RenderAssetTagEvent end to end"
```

---

### Task 5: Docs, CHANGELOG, README

**Files:**
- Modify: `doc/index.rst` (new section after the per-call attributes paragraph, before `Features`)
- Modify: `CHANGELOG.md` (new `## 0.7.0` at the top)
- Modify: `README.md` (add one bullet to the feature list)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the docs section**

In `doc/index.rst`, immediately after the paragraph that ends `…while under Rsbuild the client is compiled into the bundle.` (the block ending around line 172) and before the `Features` heading, insert:

```rst

Customizing rendered tags (CSP nonce)
-------------------------------------

Every ``<script>`` and ``<link>`` Reprise renders — the entry files, the CSS, **and** the dev-server tags it injects
itself (the Vite HMR client and, for React, the Fast Refresh preamble) — is passed through a ``RenderAssetTagEvent``
just before it is written. Listen to it to add, change or remove attributes on every tag at once; the canonical use is
a Content-Security-Policy ``nonce``:

.. code-block:: php

    namespace App\EventListener;

    use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
    use Symfony\Reprise\Event\RenderAssetTagEvent;

    #[AsEventListener]
    final class CspNonceListener
    {
        public function __construct(private NonceGenerator $nonceGenerator)
        {
        }

        public function __invoke(RenderAssetTagEvent $event): void
        {
            $event->attributes['nonce'] = $this->nonceGenerator->getNonce();
        }
    }

``$event->attributes`` is a mutable map (assign to set, ``unset()`` to remove) and ``$event->isScript()`` /
``$event->isLink()`` tell the two tag kinds apart. Because the injected HMR client and the React preamble go through
the same event, a ``nonce`` added here also lands on them — which is exactly what a strict CSP needs, and the hook a
NelmioSecurityBundle integration plugs into.
```

- [ ] **Step 2: Build the docs sanity-check (no RST errors)**

Run: `git diff --check doc/index.rst`
Expected: no whitespace errors. Visually confirm the heading underline length is at least as long as the title.

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, add a new section at the very top (above `## 0.6.0`):

```markdown
## 0.7.0

- Add the `RenderAssetTagEvent`, dispatched before each rendered `<script>`/`<link>` (including the injected dev client and React preamble), so listeners can add, change or remove attributes such as a CSP nonce
```

- [ ] **Step 4: Add the README feature bullet**

Open `README.md`, find the feature list, and add one bullet matching the existing style, e.g.:

```markdown
- Customizable tag attributes via a `RenderAssetTagEvent` (e.g. CSP nonce)
```

- [ ] **Step 5: Commit**

```bash
git add doc/index.rst CHANGELOG.md README.md
git commit -m "[TagRenderer] Document the RenderAssetTagEvent"
```

---

### Final: squash for the PR

- [ ] **Squash the branch into one commit** (per the Symfony squash workflow — confirm the split with the maintainer first):

```bash
git reset --soft $(git merge-base main HEAD)
git commit -m "[TagRenderer] Dispatch a RenderAssetTagEvent before rendering each tag"
```

(The design spec `docs/superpowers/specs/2026-08-06-render-asset-tag-event-design.md` is already committed on the branch and will fold into the squash.)

- [ ] **Full green gate before pushing:**

Run: `vendor/bin/phpunit && vendor/bin/phpstan analyse && vendor/bin/php-cs-fixer fix --dry-run --diff`
Expected: tests pass, zero PHPStan errors, no style diff.

## Self-Review

**Spec coverage:**
- Event class (private `type`, public `attributes`, `isScript`/`isLink`, no url, no getters) → Task 1. ✅
- Unified attribute path (config + per-call seed client/preamble) → Task 3 (client/preamble build `+ $attributes + $this->scriptAttributes`). ✅
- `tag()` helper routing files + client + preamble + css → Tasks 2 & 3. ✅
- modulepreload excluded from the event → Task 2 (loop left untouched) + Task 3 `testModulepreloadLinksAreNotDispatchedToListeners`. ✅
- DI wiring (`event_dispatcher`, nullable last arg) → Task 2 Steps 4/6. ✅
- Tests: nonce on all tag kinds, isScript/isLink, attr removal, modulepreload-not-dispatched, no-dispatcher regression (existing suite), leak test inverted → Task 3; end-to-end wiring → Task 4. ✅
- Docs single PHP example + NelmioSecurityBundle mention → Task 5 Step 1. ✅
- CHANGELOG 0.7.0 + README → Task 5. ✅
- event-dispatcher-contracts declared in `require` (interface); `event_dispatcher` service kept app-provided via `->nullOnInvalid()` + nullable guard; no `suggest` → Task 1 + Task 2 Step 6. ✅

**Deviation from the spec (justified):** the spec put the end-to-end listener test in `DevAssetTagsTest` covering client + preamble + app. `FunctionalAppKernel` is `final` and takes no custom services, so Task 4 registers the listener on the booted container's `event_dispatcher` (made public) and asserts on the injected client + app script; the React preamble's nonce is proven in the Task 3 unit test (`testAListenerCanAddAnAttributeToEveryRenderedTag`), which uses the real `EventDispatcher`. Equivalent coverage.

**Type consistency:** `RenderAssetTagEvent(type, attributes)`, `->attributes`, `->isScript()`/`->isLink()`, `tag(type, attributes, inlineBody)`, `reactRefreshPreamble(url)` are used identically across Tasks 1–4. `TYPE_SCRIPT`/`TYPE_LINK` are the only type literals. ✅

**Placeholder scan:** every code step contains full code; test steps include assertions; no TBD/TODO. ✅
