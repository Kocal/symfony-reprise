# manifest.json -> asset() Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make copied/loose static assets referenced by logical name (`asset('build/images/logo.png')`) resolve to their content-hashed URL from `manifest.json`, by wiring Symfony's native `framework.assets.json_manifest_path`.

**Architecture:** Approach A (approved): no `RepriseBundle` source change. The JS plugin already writes `manifest.json` (logical name -> hashed URL). We prove and document that Symfony's built-in `JsonManifestVersionStrategy`, pointed at that file via `framework.assets.json_manifest_path`, resolves loose asset references — while leaving entry references (relative hashed paths, not manifest keys) untouched because the strategy is non-strict by default.

**Tech Stack:** PHP 8.4, Symfony FrameworkBundle (`framework.assets`), `symfony/asset` (`Packages`, `JsonManifestVersionStrategy`), PHPUnit. Docs in reStructuredText (`doc/index.rst`).

## Global Constraints

- **No `RepriseBundle` source change.** The feature is Symfony-native config + one functional test + docs + playground wiring. Only test-support code (`tests/Kernel/FunctionalAppKernel.php`) and a fixture may be added under `tests/`.
- **The mechanism is non-strict passthrough:** `JsonManifestVersionStrategy::applyVersion($path) = getManifestPath($path) ?: $path`; `framework.assets.strict_mode` defaults to `false`. A reference absent from the manifest is returned unchanged.
- **One PHP functional test, NOT mirrored per bundler.** The `manifest.json` shape is identical for Vite and Rsbuild and consumption is pure PHP with no bundler branch. The test file carries a comment stating this. Do not add a second bundler-specific test.
- **The manifest-wiring doc block is intentionally bundler-agnostic** (a single YAML block, identical for both bundlers). This is the one case where the "always show both a Vite and an Rsbuild example" rule does not apply — there is no bundler-specific code to show. Do not flag the missing Vite/Rsbuild pair as a defect.
- **Docs prose is drafted/polished via the `natural-writing-editor` agent.** Soft-wrap at ~120 chars (no hard-wrap at 72/80). ASCII arrows `->`, never Unicode `→`. The bundle is called `RepriseBundle`.
- **Commit scope `[Manifest]`** on every task commit (imperative, capitalized, no trailing period). The branch squash-merges to a single `[Manifest]` commit; do not add `[Tests]`/`[Docs]` scopes.
- **Out of scope (do not implement):** making loose-asset URLs honor `base_path`/CDN (manifest values are absolute today; that needs a JS format change) and a Flex recipe. Both are follow-ups.
- Branch: `feat/manifest-asset-versioning` (already checked out; the design spec is committed there as `d1c8269`).

## File Structure

- `tests/Kernel/FunctionalAppKernel.php` (MODIFY) — gain an optional `array $frameworkConfig = []` constructor argument merged into the `framework` extension load, and make `assets.packages` public in the compiler pass so a test can fetch it. Backward-compatible: existing callers pass nothing new.
- `tests/fixtures/build/manifest.json` (CREATE) — a minimal manifest fixture mapping one logical loose-asset name to a hashed URL. Lives beside the existing `entrypoints.json` fixture; inert for tests that only read `entrypoints.json`.
- `tests/Functional/ManifestAssetVersioningTest.php` (CREATE) — boots a kernel with `json_manifest_path` at the fixture and asserts loose-asset resolution + entry passthrough.
- `doc/index.rst` (MODIFY) — `File copy` section: fix the `asset()` promise sentence and add the `json_manifest_path` wiring block + strict-mode caveat.
- `playground/config/packages/framework.yaml` (MODIFY) — add `framework.assets.json_manifest_path` so the reference app resolves loose assets end-to-end.

---

### Task 1: Functional test proving manifest-backed `asset()` resolution

**Files:**
- Create: `tests/fixtures/build/manifest.json`
- Create: `tests/Functional/ManifestAssetVersioningTest.php`
- Modify: `tests/Kernel/FunctionalAppKernel.php`

**Interfaces:**
- Consumes: `Symfony\Reprise\Tests\Kernel\FunctionalAppKernel` — after this task its constructor is `__construct(string $outputPath, array $repriseConfig = [], array $frameworkConfig = [])`; the third argument is deep-merged into the `framework` extension config. `assets.packages` (the `Symfony\Component\Asset\Packages` service) is made public.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create the manifest fixture**

Create `tests/fixtures/build/manifest.json`:

```json
{
    "build/images/logo.png": "/build/logo-77.png"
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/Functional/ManifestAssetVersioningTest.php`:

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
use Symfony\Component\Asset\Packages;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class ManifestAssetVersioningTest extends TestCase
{
    /**
     * Not mirrored per bundler on purpose: the manifest.json shape is identical for Vite and
     * Rsbuild, and consuming it is pure PHP with no bundler branch, so one test covers both.
     */
    public function testManifestResolvesLooseAssetsAndPassesEntryReferencesThrough()
    {
        $buildDir = __DIR__.'/../fixtures/build';
        $kernel = new FunctionalAppKernel(
            $buildDir,
            [],
            ['assets' => ['json_manifest_path' => $buildDir.'/manifest.json']],
        );
        $kernel->boot();

        /** @var Packages $packages */
        $packages = $kernel->getContainer()->get('assets.packages');

        // A copied/loose asset, referenced by its logical name, resolves to the hashed URL.
        $this->assertSame('/build/logo-77.png', $packages->getUrl('build/images/logo.png'));

        // An entry-style reference is absent from the manifest, so the non-strict strategy leaves
        // it untouched (its hash is preserved) - entry tag rendering is undisturbed.
        $this->assertStringContainsString('build/app-a1b2.js', $packages->getUrl('build/app-a1b2.js'));
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `vendor/bin/phpunit tests/Functional/ManifestAssetVersioningTest.php`
Expected: FAIL — `Symfony\Component\DependencyInjection\Exception\ServiceNotFoundException` (or an "is private" error) for `assets.packages`, because the current `FunctionalAppKernel` ignores the third constructor argument and never makes `assets.packages` public.

- [ ] **Step 4: Extend `FunctionalAppKernel` to inject framework config and expose `assets.packages`**

In `tests/Kernel/FunctionalAppKernel.php`, change the constructor and its docblock to add the third argument:

```php
    /**
     * @param array<string, mixed> $repriseConfig   extra reprise config merged over `output_path`
     * @param array<string, mixed> $frameworkConfig  extra framework config merged over the defaults
     */
    public function __construct(
        private readonly string $outputPath,
        private readonly array $repriseConfig = [],
        private readonly array $frameworkConfig = [],
    ) {
        parent::__construct('test', true);
    }
```

In the same file, spread `$this->frameworkConfig` into the `framework` extension load:

```php
            $container->loadFromExtension('framework', [
                'secret' => '$ecret',
                'test' => true,
                'http_method_override' => false,
                ...$this->frameworkConfig,
            ]);
```

In the `process()` compiler pass, make `assets.packages` public (add after the existing lines that publicize the lookup alias and the tag renderer):

```php
        if ($container->hasDefinition('assets.packages')) {
            $container->getDefinition('assets.packages')->setPublic(true);
        }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `vendor/bin/phpunit tests/Functional/ManifestAssetVersioningTest.php`
Expected: PASS (1 test, 2 assertions).

- [ ] **Step 6: Run the full suite, PHPStan, and CS-Fixer**

Run: `vendor/bin/phpunit`
Expected: all green (the new test added; existing tests unchanged because `$frameworkConfig` defaults to `[]`).

Run: `vendor/bin/phpstan analyse`
Expected: `[OK] No errors`.

Run: `vendor/bin/php-cs-fixer fix --dry-run tests/Functional/ManifestAssetVersioningTest.php tests/Kernel/FunctionalAppKernel.php`
Expected: `Found 0 of 2 files that can be fixed` (test methods keep no `: void` return type per the project's `void_return` customiser; do not add one).

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/build/manifest.json tests/Functional/ManifestAssetVersioningTest.php tests/Kernel/FunctionalAppKernel.php
git commit -m "[Manifest] Verify manifest.json feeds asset() via json_manifest_path"
```

---

### Task 2: Document the manifest wiring and wire the playground

**Files:**
- Modify: `doc/index.rst` (the `File copy` section, currently around lines 272-329)
- Modify: `playground/config/packages/framework.yaml`

**Interfaces:**
- Consumes: nothing from Task 1 (independent; both tasks describe the same `framework.assets.json_manifest_path` wiring — Task 1 proves it, Task 2 documents and demonstrates it).
- Produces: nothing.

- [ ] **Step 1: Fix the `asset()` promise sentence in the `File copy` section**

In `doc/index.rst`, the `File copy` intro currently ends with an unconditional promise. Replace:

```rst
Some assets are referenced by a stable path straight from your templates, like
``{{ asset('build/images/logo.svg') }}``, rather than imported from JavaScript or CSS. Point ``copy`` at the
directories that hold them and Reprise copies each file into the build and records it in ``manifest.json``, so the
``asset()`` helper resolves it to the hashed URL:
```

with (note the `->` is ASCII, prose soft-wrapped ~120 chars):

```rst
Some assets are referenced by a stable path straight from your templates, like
``{{ asset('build/images/logo.svg') }}``, rather than imported from JavaScript or CSS. Point ``copy`` at the
directories that hold them and Reprise copies each file into the build and records it in ``manifest.json``. Once you
point Symfony at that manifest (below), the ``asset()`` helper resolves the logical path to the hashed URL:
```

- [ ] **Step 2: Add the manifest-wiring block at the end of the `File copy` section**

In `doc/index.rst`, immediately after the paragraph that ends `...so they're available whether or not the dev server is running.` and before the `Using a CDN` heading, insert:

```rst
For ``asset()`` to return the hashed URL, point Symfony's asset component at the generated ``manifest.json`` with
``framework.assets.json_manifest_path``:

.. code-block:: yaml

    # config/packages/framework.yaml
    framework:
        assets:
            json_manifest_path: '%kernel.project_dir%/public/build/manifest.json'

This is Symfony's native manifest support, the same setting Webpack Encore relies on, so it applies to every logical
asset reference, not just copied files. The entry references ``RepriseBundle`` renders already carry their hash and are
not manifest keys, so they pass through untouched.

By default the lookup is lenient: a reference missing from the manifest is returned unchanged. Set
``framework.assets.strict_mode: true`` to fail loudly on an unknown reference instead. Under strict mode the entry
references Reprise renders would be rejected too, so send them through a package that skips the manifest: set
``reprise.asset_package`` to a package with ``version: false`` (see `Configuration`_) and keep ``json_manifest_path``
on the default package for your other assets.
```

- [ ] **Step 3: Polish the two prose edits with the natural-writing-editor agent**

Dispatch the `natural-writing-editor` agent on the two new/changed prose passages in `doc/index.rst` (the revised intro sentence and the new wiring block). Constraints to preserve: soft-wrap ~120 chars (no hard-wrap), ASCII `->`, the bundle named `RepriseBundle`, RST directives (`.. code-block:: yaml`) and inline `` `Configuration`_ `` cross-reference intact. Apply its edits.

- [ ] **Step 4: Wire the playground**

In `playground/config/packages/framework.yaml`, add an `assets` block under the top-level `framework:` key (leave the `when@test:` block untouched). The result:

```yaml
# see https://symfony.com/doc/current/reference/configuration/framework.html
framework:
    secret: '%env(APP_SECRET)%'

    assets:
        json_manifest_path: '%kernel.project_dir%/public/build/manifest.json'

    # Note that the session will be started ONLY if you read or write from it.
    session: true

    #esi: true
    #fragments: true

when@test:
    framework:
        test: true
        session:
            storage_factory_id: session.storage.factory.mock_file
```

- [ ] **Step 5: Verify the playground config is valid**

Run: `php playground/bin/console debug:config framework assets 2>&1 | grep json_manifest_path`
Expected: a line showing `json_manifest_path: .../public/build/manifest.json` (proves the config loads).
If the playground's PHP dependencies are not installed (`vendor/` missing), skip this check and note it; the YAML change is a three-line addition validated by review.

- [ ] **Step 6: Self-review the docs against the constraints**

Run: `git diff doc/index.rst playground/config/packages/framework.yaml`
Confirm: no hard-wrap (long lines OK), no Unicode `→`, bundle called `RepriseBundle`, the YAML block is present once and is bundler-agnostic (no Vite/Rsbuild pair needed here). No automated docs gate exists; this review is the gate.

- [ ] **Step 7: Commit**

```bash
git add doc/index.rst playground/config/packages/framework.yaml
git commit -m "[Manifest] Document json_manifest_path wiring and wire the playground"
```

---

## Self-Review

**Spec coverage:**
- Docs `File copy` fix + wiring block -> Task 2 Steps 1-3. ✓
- Docs `Configuration` strict-mode caveat -> folded into the `File copy` wiring block (Task 2 Step 2), which cross-references `Configuration`_ for the existing `asset_package`/`version: false` escape. The escape itself is already documented in the `Configuration` section (lines 190-201), so no duplicate is added. ✓
- Playground `json_manifest_path` -> Task 2 Step 4. ✓
- One PHP functional test, not mirrored, with explanatory comment, using `FunctionalAppKernel`, asserting loose-asset resolution AND entry passthrough -> Task 1. ✓
- No `RepriseBundle` source change -> only `tests/` and docs/playground touched. ✓
- Out of scope (base_path/CDN, Flex recipe) -> not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code and prose block is complete and literal. ✓

**Type consistency:** `FunctionalAppKernel::__construct(string, array, array)` is defined in Task 1 Step 4 and used with three positional args in Task 1 Step 2. `assets.packages` -> `Symfony\Component\Asset\Packages::getUrl(string): string` used consistently. Fixture key `build/images/logo.png` and value `/build/logo-77.png` match the test's `assertSame`. Entry ref `build/app-a1b2.js` matches the existing `entrypoints.json` fixture and is deliberately absent from `manifest.json`. ✓
