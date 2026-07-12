# Entrypoints Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `cache` config key that warms the parsed `entrypoints.json` into a compiled PHP file at `cache:warmup`, so the runtime never re-decodes the JSON.

**Architecture:** `EntrypointsLookup` gains an optional PSR-6 cache it checks before reading the file, caching the built `Entrypoints` object (exported by `symfony/var-exporter`, no `__set_state`). An optional `EntrypointsCacheWarmer` writes the compiled `PhpArrayAdapter` file at deploy. `RepriseBundle` wires the dedicated pool + warmer only when `cache: true`, behind a `class_exists(VarExporter::class)` guard.

**Tech Stack:** PHP 8.4, Symfony bundle (`AbstractBundle`), `symfony/cache` (`PhpArrayAdapter`, `ArrayAdapter`), `symfony/var-exporter`, `psr/cache` (`CacheItemPoolInterface`), PHPUnit 13.

## Global Constraints

- PHP: `final` classes, `readonly` promoted constructor props; Symfony license header + `@author Hugo Alliaume <hugo@alliau.me>` on every new `.php`; `@internal` on implementations.
- `symfony/cache` and `symfony/var-exporter` go in `require-dev` only — the cache is opt-in. When `cache: true` but they're absent, `RepriseBundle::loadExtension()` throws a `\LogicException` gated on `!class_exists(VarExporter::class)`. No composer `suggest` (Symfony does not use it).
- Cache the built `Entrypoints` object (not the decoded array). One fixed key: `'reprise.entrypoints'` (Reprise is mono-build).
- The warmer is optional (`isOptional() === true`) and never throws — a missing/invalid file at warmup is skipped so `cache:warmup` cannot break a deploy.
- `cache` defaults to `false`; when false, `EntrypointsLookup` behaves exactly as today (cache arg stays `null`) — existing tests must stay green.
- QA gate per task: `vendor/bin/phpunit`, `vendor/bin/phpstan analyse`, `vendor/bin/php-cs-fixer fix`.
- Commit scope: `[Cache]`.

---

## File Structure

- `composer.json` — add `symfony/cache` + `symfony/var-exporter` to `require-dev` (Task 1).
- `src/Asset/EntrypointsLookup.php` — constructor gains `?CacheItemPoolInterface $cache` + `string $cacheKey`; `getEntrypoints()` checks the cache; the file read/decode moves to a private `load()` (Task 1).
- `src/CacheWarmer/EntrypointsCacheWarmer.php` — new; writes the compiled pool file (Task 2).
- `src/RepriseBundle.php` — `cache` config node + conditional DI wiring + guard (Task 3).
- Tests: `tests/Asset/EntrypointsLookupTest.php` (Task 1), `tests/CacheWarmer/EntrypointsCacheWarmerTest.php` (Task 2), `tests/Functional/EntrypointsCacheTest.php` (Task 3).

---

### Task 1: EntrypointsLookup reads through an optional cache

**Files:**
- Modify: `composer.json` (`require-dev`)
- Modify: `src/Asset/EntrypointsLookup.php`
- Test: `tests/Asset/EntrypointsLookupTest.php`

**Interfaces:**
- Consumes: `Psr\Cache\CacheItemPoolInterface`; the existing `Entrypoints::fromArray(array): self` value object.
- Produces: `EntrypointsLookup::__construct(string $entrypointsPath, bool $strictMode = true, ?CacheItemPoolInterface $cache = null, string $cacheKey = 'reprise.entrypoints')`. On a cache hit `getEntrypoints()` returns the stored `?Entrypoints` without touching the file; on a miss it reads the file and `save()`s the result under `$cacheKey`.

- [ ] **Step 1: Add the dev dependencies**

```bash
composer require --dev "symfony/cache:^7.4|^8.0" "symfony/var-exporter:^7.4|^8.0"
```

Confirm `composer.json`'s `require-dev` now lists both. (They may already be present transitively via `symfony/framework-bundle`; declaring them explicitly is required because the cache tests use them directly.)

- [ ] **Step 2: Write the failing tests**

Add to `tests/Asset/EntrypointsLookupTest.php` — new imports at the top:

```php
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Reprise\Asset\Entrypoints;
```

and the tests:

```php
    public function testACacheHitResolvesWithoutTouchingTheFile()
    {
        $cache = new ArrayAdapter();
        $entrypoints = Entrypoints::fromArray([
            'isProd' => true,
            'devServer' => null,
            'publicPath' => '/build/',
            'entryPoints' => ['app' => ['js' => ['build/app.js']]],
            'integrity' => [],
        ]);
        $cache->save($cache->getItem('reprise.entrypoints')->set($entrypoints));

        // The path does not exist: a hit must serve from the cache, never the file (which would
        // throw in strict mode).
        $lookup = new EntrypointsLookup('/does/not/exist/entrypoints.json', true, $cache, 'reprise.entrypoints');

        $this->assertSame(['build/app.js'], $lookup->getJavaScriptFiles('app'));
    }

    public function testACacheMissReadsTheFileAndPopulatesThePool()
    {
        $cache = new ArrayAdapter();
        $lookup = new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json', true, $cache, 'reprise.entrypoints');

        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));

        $item = $cache->getItem('reprise.entrypoints');
        $this->assertTrue($item->isHit());
        $this->assertInstanceOf(Entrypoints::class, $item->get());
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `vendor/bin/phpunit --filter 'CacheHit|CacheMiss' tests/Asset/EntrypointsLookupTest.php`
Expected: FAIL — the constructor does not accept a cache argument yet.

- [ ] **Step 4: Add the constructor arguments**

In `src/Asset/EntrypointsLookup.php`, add the import:

```php
use Psr\Cache\CacheItemPoolInterface;
```

and extend the constructor (append the two args; nothing else moves):

```php
    public function __construct(
        private readonly string $entrypointsPath,
        private readonly bool $strictMode = true,
        private readonly ?CacheItemPoolInterface $cache = null,
        private readonly string $cacheKey = 'reprise.entrypoints',
    ) {
    }
```

- [ ] **Step 5: Route `getEntrypoints()` through the cache**

Replace the whole `getEntrypoints()` method with the cache-aware version plus a new private `load()` that holds the (unchanged) file read + decode:

```php
    private function getEntrypoints(): ?Entrypoints
    {
        if ($this->loaded) {
            return $this->entrypoints;
        }
        $this->loaded = true;

        if (null === $this->cache) {
            return $this->entrypoints = $this->load();
        }

        $item = $this->cache->getItem($this->cacheKey);
        if ($item->isHit()) {
            return $this->entrypoints = $item->get();
        }

        $entrypoints = $this->load();
        $this->cache->save($item->set($entrypoints));

        return $this->entrypoints = $entrypoints;
    }

    private function load(): ?Entrypoints
    {
        if (!is_file($this->entrypointsPath)) {
            if ($this->strictMode) {
                throw new EntrypointsFileNotFoundException(\sprintf('Could not find the entrypoints file "%s". Did the assets get built?', $this->entrypointsPath));
            }

            return null;
        }

        $decoded = json_decode((string) file_get_contents($this->entrypointsPath), true, flags: \JSON_THROW_ON_ERROR);
        if (!\is_array($decoded)) {
            throw new InvalidEntrypointsException(\sprintf('The entrypoints file "%s" must contain a JSON object.', $this->entrypointsPath));
        }

        return Entrypoints::fromArray($decoded);
    }
```

(This preserves today's behavior when `$cache` is null: `load()` does exactly what `getEntrypoints()` used to do. A strict + missing file still throws from `load()`, uncached, exactly as before.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/Asset/EntrypointsLookupTest.php`
Expected: PASS (the two new tests plus every existing EntrypointsLookup test — the null-cache path is unchanged).

- [ ] **Step 7: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src/Asset/EntrypointsLookup.php tests/Asset/EntrypointsLookupTest.php
vendor/bin/phpstan analyse
git add composer.json composer.lock src/Asset/EntrypointsLookup.php tests/Asset/EntrypointsLookupTest.php
git commit -m "[Cache] Let EntrypointsLookup read through an optional PSR-6 cache"
```

---

### Task 2: EntrypointsCacheWarmer

**Files:**
- Create: `src/CacheWarmer/EntrypointsCacheWarmer.php`
- Test: `tests/CacheWarmer/EntrypointsCacheWarmerTest.php`

**Interfaces:**
- Consumes: `Symfony\Component\Cache\Adapter\PhpArrayAdapter` (its public `warmUp(array $values): array`); `Entrypoints::fromArray()`.
- Produces: `new EntrypointsCacheWarmer(string $entrypointsPath, string $cacheKey, PhpArrayAdapter $cache)`; `isOptional(): true`; `warmUp(string $cacheDir, ?string $buildDir = null): array` writes `[$cacheKey => Entrypoints]` into the compiled file, or returns `[]` (and skips) when the file is missing/invalid.

- [ ] **Step 1: Write the failing tests**

Create `tests/CacheWarmer/EntrypointsCacheWarmerTest.php`:

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

namespace Symfony\Reprise\Tests\CacheWarmer;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Reprise\Asset\Entrypoints;
use Symfony\Reprise\CacheWarmer\EntrypointsCacheWarmer;

final class EntrypointsCacheWarmerTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        $this->file = sys_get_temp_dir().'/reprise_warm_'.uniqid('', true).'.cache.php';
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
    }

    public function testWarmsThePoolFromTheEntrypointsFile()
    {
        $warmer = new EntrypointsCacheWarmer(
            __DIR__.'/../fixtures/build/entrypoints.json',
            'reprise.entrypoints',
            new PhpArrayAdapter($this->file, new ArrayAdapter()),
        );

        $this->assertTrue($warmer->isOptional());
        $this->assertSame([], $warmer->warmUp(sys_get_temp_dir()));

        // A fresh adapter reading the compiled file must hit and hold a built Entrypoints object.
        $item = (new PhpArrayAdapter($this->file, new ArrayAdapter()))->getItem('reprise.entrypoints');
        $this->assertTrue($item->isHit());
        $this->assertInstanceOf(Entrypoints::class, $item->get());
        $this->assertSame(['build/app-a1b2.js'], $item->get()->entryPoints['app']->js);
    }

    public function testSkipsAMissingFileWithoutThrowing()
    {
        $cache = new PhpArrayAdapter($this->file, new ArrayAdapter());
        $warmer = new EntrypointsCacheWarmer('/does/not/exist/entrypoints.json', 'reprise.entrypoints', $cache);

        $this->assertSame([], $warmer->warmUp(sys_get_temp_dir()));
        $this->assertFalse($cache->getItem('reprise.entrypoints')->isHit());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `vendor/bin/phpunit tests/CacheWarmer/EntrypointsCacheWarmerTest.php`
Expected: FAIL — `EntrypointsCacheWarmer` does not exist.

- [ ] **Step 3: Create the warmer**

Create `src/CacheWarmer/EntrypointsCacheWarmer.php`:

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

namespace Symfony\Reprise\CacheWarmer;

use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;
use Symfony\Reprise\Asset\Entrypoints;

/**
 * Parses entrypoints.json once at cache:warmup and compiles the built Entrypoints object into the
 * PhpArrayAdapter file, so the runtime never re-decodes the JSON.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class EntrypointsCacheWarmer implements CacheWarmerInterface
{
    public function __construct(
        private readonly string $entrypointsPath,
        private readonly string $cacheKey,
        private readonly PhpArrayAdapter $cache,
    ) {
    }

    public function isOptional(): bool
    {
        return true;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        if (!is_file($this->entrypointsPath)) {
            return [];
        }

        try {
            $decoded = json_decode((string) file_get_contents($this->entrypointsPath), true, flags: \JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $this->cache->warmUp([$this->cacheKey => Entrypoints::fromArray($decoded)]);
            }
        } catch (\Throwable) {
            // A malformed entrypoints.json at deploy time must not break cache:warmup.
        }

        return [];
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/CacheWarmer/EntrypointsCacheWarmerTest.php`
Expected: PASS.

- [ ] **Step 5: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src/CacheWarmer tests/CacheWarmer
vendor/bin/phpstan analyse
git add src/CacheWarmer/EntrypointsCacheWarmer.php tests/CacheWarmer/EntrypointsCacheWarmerTest.php
git commit -m "[Cache] Add EntrypointsCacheWarmer to compile the entrypoints at warmup"
```

---

### Task 3: Config key + DI wiring + guard

**Files:**
- Modify: `src/RepriseBundle.php`
- Test: `tests/Functional/EntrypointsCacheTest.php`

**Interfaces:**
- Consumes: Task 1's `EntrypointsLookup(..., ?CacheItemPoolInterface $cache, string $cacheKey)`; Task 2's `EntrypointsCacheWarmer(string $path, string $cacheKey, PhpArrayAdapter $cache)`; `PhpArrayAdapter`; `Symfony\Component\VarExporter\VarExporter` (for the guard's `class_exists`).
- Produces: `reprise` config gains `cache: bool` (default false). When true, services `cache.reprise`, `reprise.cache`, `reprise.entrypoints_cache_warmer` are registered and `reprise.entrypoints_lookup` receives the cache + key.

- [ ] **Step 1: Write the failing functional test**

Create `tests/Functional/EntrypointsCacheTest.php`:

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
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class EntrypointsCacheTest extends TestCase
{
    public function testCacheEnabledWiresThePoolAndResolvesAnEntry()
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build', ['cache' => true]);
        $kernel->boot();
        $container = $kernel->getContainer();

        // The whole cache stack compiled (pool + warmer + guard) and the lookup resolves.
        $this->assertTrue($container->has('reprise.entrypoints_cache_warmer'));

        $lookup = $container->get(EntrypointsLookupInterface::class);
        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
    }
}
```

Note: `FunctionalAppKernel` already accepts an extra `array $repriseConfig` constructor argument (merged over `output_path`) and makes `reprise.entrypoints_lookup` public via its compiler pass. To also assert on `reprise.entrypoints_cache_warmer`, make it public in the kernel's `process()` — add this line, guarded so the non-cache kernels still boot:

`tests/Kernel/FunctionalAppKernel.php`, inside `process(ContainerBuilder $container)`:

```php
        if ($container->hasDefinition('reprise.entrypoints_cache_warmer')) {
            $container->getDefinition('reprise.entrypoints_cache_warmer')->setPublic(true);
        }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vendor/bin/phpunit tests/Functional/EntrypointsCacheTest.php`
Expected: FAIL — `cache` is not a known config key / the warmer service is not registered.

- [ ] **Step 3: Add the `cache` config node**

In `src/RepriseBundle.php`, add to `configure()` (after the `strict_mode` node):

```php
                ->booleanNode('cache')
                    ->defaultFalse()
                    ->info('Cache the parsed entrypoints.json in a compiled PHP file (warmed at cache:warmup). Enable in production; requires symfony/cache.')
                ->end()
```

- [ ] **Step 4: Wire the pool, warmer and guard**

In `src/RepriseBundle.php`, add the imports:

```php
use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Component\VarExporter\VarExporter;
use Symfony\Reprise\CacheWarmer\EntrypointsCacheWarmer;
```

Update the `loadExtension` config-array docblock to include `cache: bool`. Replace the current `reprise.entrypoints_lookup` registration so its arguments depend on `cache`, and register the cache services when enabled. The existing block is:

```php
        $services->set('reprise.entrypoints_lookup', EntrypointsLookup::class)
            ->args([
                $config['output_path'].'/entrypoints.json',
                $config['strict_mode'],
            ])
            ->tag('kernel.reset', ['method' => 'reset'])
        ;
```

Change it to:

```php
        $entrypointsPath = $config['output_path'].'/entrypoints.json';

        if ($config['cache'] && !class_exists(VarExporter::class)) {
            throw new \LogicException('Enabling "reprise.cache" requires the Symfony Cache component. Run "composer require symfony/cache".');
        }

        $lookupArgs = [$entrypointsPath, $config['strict_mode']];
        if ($config['cache']) {
            $lookupArgs[] = service('reprise.cache');
            $lookupArgs[] = 'reprise.entrypoints';
        }

        $services->set('reprise.entrypoints_lookup', EntrypointsLookup::class)
            ->args($lookupArgs)
            ->tag('kernel.reset', ['method' => 'reset'])
        ;

        if ($config['cache']) {
            $services->set('cache.reprise')
                ->parent('cache.system')
                ->tag('cache.pool')
            ;

            $services->set('reprise.cache', PhpArrayAdapter::class)
                ->args([
                    '%kernel.build_dir%/reprise.cache.php',
                    service('cache.reprise'),
                ])
            ;

            $services->set('reprise.entrypoints_cache_warmer', EntrypointsCacheWarmer::class)
                ->args([
                    $entrypointsPath,
                    'reprise.entrypoints',
                    service('reprise.cache'),
                ])
                ->tag('kernel.cache_warmer')
            ;
        }
```

(The rest of `loadExtension` — the `EntrypointsLookupInterface` alias, the reset listener, `reprise.tag_renderer`, the Twig runtime/extension — stays exactly as it is.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `vendor/bin/phpunit tests/Functional/EntrypointsCacheTest.php`
Expected: PASS. Then run the full suite `vendor/bin/phpunit` — the default-config kernels (`cache: false`) must still boot and every existing test stays green.

- [ ] **Step 6: QA + commit**

```bash
vendor/bin/php-cs-fixer fix src tests
vendor/bin/phpstan analyse
composer validate --strict
git add src/RepriseBundle.php tests/Functional/EntrypointsCacheTest.php tests/Kernel/FunctionalAppKernel.php
git commit -m "[Cache] Add the cache config key and wire the pool and warmer"
```

---

## Self-Review

- **Spec coverage:** `cache` bool default false (Task 3) ✓; dedicated `reprise.cache` PhpArrayAdapter + `cache.reprise` fallback, wired only when true (Task 3) ✓; cache the `Entrypoints` object via VarExporter (Tasks 1+2, no `__set_state`) ✓; `EntrypointsLookup` cache hit/miss/save (Task 1) ✓; optional warmer via `PhpArrayAdapter::warmUp` (Task 2) ✓; `require-dev` deps + `class_exists(VarExporter::class)` guard, no suggest (Tasks 1+3) ✓; Encore-style fixed key `reprise.entrypoints` ✓. Tests: ArrayAdapter unit (Task 1), warmer unit (Task 2), `cache: true` functional kernel (Task 3) ✓.
- **Known coverage gap (spec-acknowledged):** the guard's `!class_exists(VarExporter::class)` throw path can't be exercised in a suite where `symfony/cache` is installed — same as the existing `symfony/web-link` guard. Left untested; note it for the final review.
- **Type consistency:** the constructor arg order `(entrypointsPath, strictMode, cache, cacheKey)` and the fixed key literal `'reprise.entrypoints'` are identical across `EntrypointsLookup` (Task 1), the warmer (Task 2), and the DI args (Task 3). `PhpArrayAdapter::warmUp([$key => $entrypoints])` (Task 2) matches what the lookup reads via `getItem($key)->get()` (Task 1).
- **Placeholder scan:** none — every step carries complete code and exact commands.
