# Design: entrypoints cache (`cache` config key)

Date: 2026-07-12
Scope: one PHP-only feature in `RepriseBundle`. An opt-in `cache` config key that warms the parsed
`entrypoints.json` into a compiled PHP file at `cache:warmup`, so the runtime never re-decodes the
JSON. Mirrors WebpackEncoreBundle's `cache` option. Commit scope: `[Cache]`.

## Problem

Under PHP-FPM (a fresh process per request), `EntrypointsLookup` reads and `json_decode`s
`entrypoints.json` on every request before it can resolve a single URL. WebpackEncoreBundle solves
this with a `cache` option: the file is parsed once at `cache:warmup` (deploy time), stored in a
`PhpArrayAdapter` (a single opcache-friendly `.php` file), and read from there at runtime. Reprise
should offer the same.

(A long-running worker — FrankenPHP/RoadRunner — already parses once per worker via the lookup's
per-instance `loaded` flag; the cache is the equivalent win for FPM, and warms even the first
request.)

## Decisions (from brainstorming)

1. **Config: `cache` bool, `defaultFalse`** — exactly like WebpackEncoreBundle. When `true`, Reprise
   wires its own dedicated pool; the user configures nothing else.
2. **Dedicated pool `reprise.cache`** = `PhpArrayAdapter` over `%kernel.build_dir%/reprise.cache.php`
   with a fallback pool `cache.reprise` (parent `cache.system`). Wired **only when `cache: true`**.
3. **Cache the built `Entrypoints` object**, not the decoded array. `PhpArrayAdapter` exports values
   through `symfony/var-exporter` (`VarExporter::export()`), which hydrates our `final`/`readonly`
   classes by reflection with **no `__set_state`**. Validation (`Entrypoints::fromArray()`) runs once
   at warmup, not per request.
4. **Invalidation is Encore-style**: one fixed cache key (Reprise is mono-build); populated at
   `cache:warmup`; `cache:clear` refreshes it after an asset rebuild. This is a **production**
   optimization — `cache: true` is not meant for dev, where assets change constantly.
5. **The warmer is optional** (`isOptional() === true`): a missing or invalid `entrypoints.json` at
   warmup is skipped without failing `cache:warmup` (assets may be built after `composer install` in
   a deploy). The runtime then falls back to reading the file.
6. **Dependencies are optional**: `symfony/cache` and `symfony/var-exporter` go in `require-dev` (for
   the test suite), not `require`. The cache is opt-in, so its components are too — the same shape as
   `symfony/web-link` for the preload feature. When `cache: true` but they're absent, a
   `class_exists(VarExporter::class)` guard throws a clear error. No composer `suggest` (Symfony does
   not use that field).

## Design

### Config

Add a `cache` boolean node to `RepriseBundle::configure()`:

```yaml
reprise:
    cache: false   # default; set true in production to cache the parsed entrypoints.json
```

### Pool (wired only when `cache: true`)

- `cache.reprise` — an empty pool definition, parent `cache.system`, tagged `cache.pool`. Acts as the
  runtime fallback store for cache misses (see data flow).
- `reprise.cache` — `Symfony\Component\Cache\Adapter\PhpArrayAdapter`, args
  `['%kernel.build_dir%/reprise.cache.php', service('cache.reprise')]`. This is the read path the
  lookup uses and the compiled file the warmer writes.

### `EntrypointsLookup`

Constructor gains two optional args (kept last so nothing else moves):

```php
public function __construct(
    private readonly string $entrypointsPath,
    private readonly bool $strictMode = true,
    private readonly ?CacheItemPoolInterface $cache = null,   // psr/cache (PSR-6)
    private readonly string $cacheKey = 'reprise.entrypoints',
) {}
```

`getEntrypoints()` becomes:

1. If already loaded this request (`$this->loaded`), return the in-memory value (unchanged).
2. If `$this->cache` is set, `getItem($cacheKey)`:
   - **hit** — return the cached `Entrypoints` object (or its cached `null` for a known-missing file).
   - **miss** — read + `json_decode` + `Entrypoints::fromArray()` as today, then `save()` the result
     onto the item, then return it.
3. If `$this->cache` is null — current behavior (read + decode every request, `loaded` flag still
   short-circuits within the request).

Only a *successful* resolution is cached. In strict mode a missing file still throws (never cached);
in non-strict mode a missing file yields `null` — that `null` may be cached so repeated misses don't
re-`stat` the file. `strict_mode` remains orthogonal to caching: it governs missing-entry behavior at
lookup time regardless of the cache.

### `EntrypointsCacheWarmer`

`final class EntrypointsCacheWarmer implements CacheWarmerInterface` (`@internal`), constructor
`(string $entrypointsPath, string $cacheKey, PhpArrayAdapter $cache)`:

- `isOptional(): bool` → `true`.
- `warmUp(string $cacheDir, ?string $buildDir = null): array`:
  - if the file is missing, return `[]` (nothing to warm).
  - otherwise read + `json_decode` + `Entrypoints::fromArray()`, then
    `$this->cache->warmUp([$this->cacheKey => $entrypoints])` — this is what writes the compiled
    `reprise.cache.php`. Wrap in a `try/catch (\Throwable)` and skip on any error (a malformed file at
    deploy must not break `cache:warmup`).
  - return `[]` (no preloadable classes to declare).

`PhpArrayAdapter::warmUp(array $values)` is the public method that renders the values (via
VarExporter) into the compiled file — the same mechanism WebpackEncoreBundle's warmer uses.

### DI wiring (`loadExtension`)

When `$config['cache']` is `true`:

- **first**, guard: if `!class_exists(VarExporter::class)`, throw a `\LogicException` telling the user
  the cache needs the Symfony Cache component (`composer require symfony/cache`). This fails the
  container build early with a clear message instead of a cryptic "PhpArrayAdapter not found".
- register `cache.reprise` (parent `cache.system`, tag `cache.pool`),
- register `reprise.cache` (`PhpArrayAdapter`, the two args above),
- pass `service('reprise.cache')` + the fixed key as the new `EntrypointsLookup` args,
- register `reprise.entrypoints_cache_warmer` (args: path, key, `service('reprise.cache')`; tag
  `kernel.cache_warmer`).

When `false`: none of the above; `EntrypointsLookup` keeps its current two args (cache stays `null`).

## Data flow

- **Deploy (`cache:warmup`)** — the warmer reads `entrypoints.json`, decodes + validates it once, and
  `PhpArrayAdapter::warmUp()` writes the `Entrypoints` object into `reprise.cache.php`.
- **Request (warmed)** — `PhpArrayAdapter` reads the compiled file: the hydrated `Entrypoints` object
  is returned directly. No file I/O, no `json_decode`, no `fromArray`.
- **Request (not warmed — file built after warmup)** — miss on the `.php` file; the lookup reads the
  file, decodes it, and `save()` writes the object to the fallback pool (`cache.reprise` →
  `cache.system`, using native `serialize()` — our plain `readonly` objects serialize fine). Later
  requests hit the fallback pool. `cache:clear` + rebuild re-warms the compiled file.

## Dependencies

- `require-dev`: add `symfony/cache: ^7.4 || ^8.0` and `symfony/var-exporter: ^7.4 || ^8.0` — needed
  only to run the cache tests. They stay out of `require` because the cache is opt-in.
- Runtime guard: `RepriseBundle::loadExtension()` throws `\LogicException` when `cache: true` and
  `!class_exists(VarExporter::class)` (`composer require symfony/cache`). Mirrors the
  `symfony/web-link` handling for the preload option.
- No composer `suggest` entry — Symfony does not use it.
- `psr/cache`'s `CacheItemPoolInterface` (the `EntrypointsLookup` type-hint) is resolved lazily: when
  `cache` is false the null argument never triggers autoloading; when `cache` is true the guard has
  already ensured `symfony/cache` (which pulls `psr/cache`) is present. So no explicit `psr/cache`
  entry is required.

## Non-goals

- Per-build cache keys / multi-build — Reprise is mono-build (one `entrypoints.json`, one key).
- Auto-invalidation on file change (mtime in the key) — rejected in brainstorming; `cache: true` is a
  prod optimization refreshed by the deploy's `cache:clear` + `cache:warmup`.
- Caching `manifest.json` — out of scope; this feature is only about `entrypoints.json`.
- A user-supplied custom cache pool — YAGNI; the dedicated `reprise.cache` is the only pool.

## Testing

- **Unit — `EntrypointsLookup` with a cache pool** (use `ArrayAdapter` as the PSR-6 pool):
  - a warmed pool returns the entry data **without touching the file** (assert by pointing the lookup
    at a non-existent path but pre-seeding the pool — proves the read comes from cache).
  - a cache miss reads the file and populates the pool (second call served from the pool).
  - `cache: null` (no pool) keeps today's behavior (covered by existing tests, unchanged).
- **Unit — `EntrypointsCacheWarmer`**:
  - warms the `PhpArrayAdapter` from a fixture `entrypoints.json` (assert the key is a hit afterwards
    and resolves an entry).
  - a missing file is skipped without throwing; `isOptional()` is `true`.
- **Functional** — boot a kernel with `reprise: { cache: true }`, run the cache warmer, and resolve an
  entry through the wired `reprise.entrypoints_lookup`, proving pool + warmer + lookup are wired
  together end to end.

## Risks

1. **Stale class shape across deploys** — the compiled file holds instances of `Entrypoints`/`Entry`/
   `DevServer`; if their shape changes between two deploys without a `cache:clear`, VarExporter could
   mis-hydrate. Mitigated by the deploy's `cache:clear` (already the Encore-style contract) — document
   it in the `cache` option's docs.
2. **`PhpArrayAdapter::warmUp` value support** — confirmed: it exports via `symfony/var-exporter`, so
   the object graph round-trips without `__set_state` (verified in `PhpArrayAdapter` source). The
   fallback pool uses native `serialize()`, which our plain `readonly` objects also support.
