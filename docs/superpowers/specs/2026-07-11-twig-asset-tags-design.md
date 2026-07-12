# Design: Twig asset tags + ADR 0001 (relative paths + Packages)

Date: 2026-07-11
Scope: one combined feature spanning the JS plugin (`@symfony/reprise`) and the PHP bundle (`RepriseBundle`).
Commit scopes (per-task, decided in the plan): `[Entrypoints]` for the JS ADR-0001 slice (`entrypoints.json` relative refs + SRI keying), `[Rsbuild]` for the ESM-output change, `[Twig]` for the PHP renderer + extension + config. One cohesive feature, sliced by the plan.

## Problem

`RepriseBundle` reads `entrypoints.json` (via `EntrypointsLookup`, done) but has **no way to render
the `<script>`/`<link>` tags** a template needs. This is the keystone that connects the JS build to
Symfony: `{{ reprise_entry_script_tags('app') }}` in Twig -> the actual tags.

Rendering the tags correctly also means adopting **ADR 0001** (accepted): the bundler emits
content-hashed files and the PHP side turns a reference into a URL via `symfony/asset` `Packages`
(`base_path` + `base_urls`), instead of the plugin baking final URLs into `entrypoints.json`. That
is why this is one feature spanning JS + PHP.

## Scope (one feature, JS + PHP)

Chosen over decomposing into two specs: implement ADR 0001 end to end plus the Twig renderer in a
single design. The plan will slice it into JS tasks and PHP tasks.

Covered:
- **A. JS** — `entrypoints.json` (build) emits relative hashed paths; SRI keyed by the reference;
  both bundlers standardise on ESM output.
- **B. PHP** — `TagRenderer` + Twig extension with four functions; dev HMR client auto-injection;
  `modulepreload`; SRI + crossorigin.
- **C. URL resolution** — via a `framework.assets` package (`reprise.asset_package`).
- **D. WebLink** — `Link:` headers when `symfony/web-link` is installed.

## Decisions (from brainstorming)

1. Twig API: `reprise_entry_script_tags(entry, package?)`, `reprise_entry_link_tags(entry, package?)`,
   `reprise_entry_js_files(entry)`, `reprise_entry_css_files(entry)`. `reprise_` prefix, no `encore_` alias.
2. `type="module"` is the uniform default; both bundlers standardise on ESM output.
3. Dev HMR: `reprise_entry_script_tags` auto-injects `@vite/client` once per request when in dev.
4. `preload` chunks -> `<link rel="modulepreload">`; `dynamic` not rendered (runtime).
5. WebLink integration included (optional dep).
6. Mono-build (single `entrypoints.json`).
7. `crossorigin`: `anonymous` automatically when `integrity` is present; otherwise config-driven (default off).
8. Config path key: `output_path` (a **directory**, Encore- and JS-`outputPath`-consistent); the
   bundle reads `output_path/entrypoints.json`.
9. URL resolution via a **`framework.assets` package** named by `reprise.asset_package` (no custom
   `reprise.assets.base_path/base_urls`).

## A. JS side (entrypoints.json + ESM)

### Relative hashed paths (build)

`buildEntrypoints` (`assets/src/core/format.ts`) currently maps each file to `joinUrl(urlPrefix, fileName)`.
For **build**, the reference becomes the **docroot-relative path**: `publicPath` with the leading
slash stripped, joined with the file name -> `build/app-<hash>.js` (no leading slash, no origin).
For **dev**, references stay **absolute** dev-server-origin URLs (`http://127.0.0.1:5173/build/app.js`),
unchanged — `Packages` returns absolute URLs as-is.

Concretely: the build `BuildContext.urlPrefix` drops its leading slash (`build/` instead of `/build/`);
the dev path is untouched.

### CDN reframe

An absolute (CDN) `publicPath` is no longer how CDN works. CDN moves to the PHP side via
`framework.assets.base_urls` on the Reprise package. `publicPath` (JS) is once again just the local
path prefix. The docs' "Using a CDN" section is rewritten around `framework.assets`. The JS `cdn`
integration test and the `publicPath`-with-`://` guard change accordingly (an absolute build
`publicPath` is no longer the CDN mechanism; keep the guard's behaviour scoped to what still needs it).

### SRI keying

The `integrity` map in `entrypoints.json` is keyed by the **reference** the renderer resolves — the
relative path in build (`build/app-<hash>.js`), the absolute URL in dev. Today it is keyed by the
final URL; the change is the key only (SRI hashing of on-disk bytes is unaffected). `getIntegrityData()`
then answers `map[$reference]`.

### ESM standardisation

Both bundlers emit ESM so `type="module"` is always correct. Vite already does. The **Rsbuild adapter**
sets Rspack's output to ESM (`output.module` / the Rsbuild equivalent). `entrypoints.json` needs no
per-entry module flag.

**Risk (verify early):** Rspack ESM output for a web target must load and run correctly (chunk loading,
browser support). If it turns out unreliable, fall back to decision #2's "config-driven per bundler".

### manifest.json is out of scope

Only `entrypoints.json` changes. `manifest.json` (copied files / images, consumed via `asset()` +
a manifest version strategy) is a **separate concern**, not this feature. The Reprise package's
empty version strategy is for **entry references only** (used by `TagRenderer`), not for `asset()`
image lookups.

## B. PHP tag renderer

### `TagRenderer` (`src/Asset/TagRenderer.php`, final, `@internal`, `ResetInterface`)

Consumes `EntrypointsLookupInterface` and `Symfony\Component\Asset\Packages`. Modelled on
WebpackEncoreBundle's `TagRenderer`, adapted.

`renderScriptTags(string $entryName, ?string $packageName = null): string`:
1. **Dev HMR** (once per request): if `getDevServer()` is non-null, prepend
   `<script type="module" src="{devServer.origin}/@vite/client"></script>`. Guarded by a per-request
   "client injected" flag (reset via `reset()`).
2. **modulepreload**: for each `getPreloadFiles($entryName)` reference -> `<link rel="modulepreload" href="{url}">`
   and register it with WebLink (Part D).
3. **scripts**: for each `getJavaScriptFiles($entryName)` reference -> `<script type="module" src="{url}"`
   + `integrity`/`crossorigin` when present + configured `script_attributes` + `></script>`.
   The entry script references are also registered with WebLink as `preload`.

`renderLinkTags(string $entryName, ?string $packageName = null): string`: for each `getCssFiles($entryName)`
reference -> `<link rel="stylesheet" href="{url}"` + `integrity`/`crossorigin` + `link_attributes` + `>`;
also registered with WebLink as `preload`.

`getJsFiles`/`getCssFiles(string $entryName): list<string>`: the resolved URLs, no tags (delegate to
`getJavaScriptFiles`/`getCssFiles` + URL resolution).

URL resolution helper: `resolveUrl(string $reference, ?string $packageName): string` ->
`$this->packages->getUrl($reference, $packageName ?? $this->defaultPackage)`. A dev absolute URL is
returned unchanged by `Packages`.

Integrity/crossorigin: when `getIntegrityData()[$reference]` exists, add `integrity="..."` and
`crossorigin="anonymous"` (unless `crossorigin` is configured otherwise). No integrity in dev (the
map is empty there).

Per-request dedup: `EntrypointsLookup` already dedups references across calls in a request; a chunk
shared by two entries is emitted once. `TagRenderer::reset()` clears the HMR-injected flag;
`EntrypointsLookup::reset()` clears its dedup. Both are wired through the existing
`ResetAssetsEventListener`.

### Twig extension (`src/Twig/AssetExtension.php`)

An `AbstractExtension` exposing the four `reprise_entry_*` functions (`is_safe: html` for the tag
functions), each delegating to `TagRenderer`.

## C. URL resolution & config

Resolution goes through a `framework.assets` package the app configures. Reprise config:

```yaml
reprise:
    output_path: '%kernel.project_dir%/public/build'   # directory holding entrypoints.json
    asset_package: 'reprise'                            # optional; a framework.assets package name
    strict_mode: true
    crossorigin: false                                  # false | 'anonymous' | 'use-credentials'
    script_attributes: { }                              # default attributes on <script>
    link_attributes: { }                                # default attributes on <link>
```

The app configures the package under `framework.assets`:

```yaml
framework:
    assets:
        packages:
            reprise:
                version: false                          # Reprise files are already content-hashed
                base_urls: ['https://cdn.example.com']  # optional CDN
```

**Version caveat (documented):** the Reprise package must have `version: false`. The files are
already content-hashed; a version strategy would version them again. If `asset_package` is unset,
`TagRenderer` uses the framework **default** package (`getUrl($ref)`); the docs warn this is safe
only when the default package has no versioning, otherwise configure a dedicated version-less package.

## D. WebLink integration (optional)

When `symfony/web-link` is installed, `TagRenderer` registers the preloadable references on the
current request's link provider (`_links` attribute, `GenericLinkProvider`), so
`AddLinkHeaderListener` emits them as `Link:` HTTP headers:
- `preload` chunks -> `new Link('modulepreload', $url)`.
- entry JS/CSS -> `new Link('preload', $url)` with `as=script` / `as=style`.

Graceful no-op when `web-link` or the current request is absent. A `reprise.preload` config toggle
(default: on when web-link is present) allows disabling it.

## Components / files

- JS: `assets/src/core/format.ts` (relative refs + SRI keying), `assets/src/rsbuild.ts` (ESM output),
  affected tests (`assets/test/core/format.test.ts`, collectors, `integration/cdn.test.ts`,
  build/dev integration), `doc/index.rst` (CDN reframe + a new "Rendering asset tags" section — Vite
  and Rsbuild examples).
- PHP: `src/Asset/TagRenderer.php`, `src/Twig/AssetExtension.php`, `src/DependencyInjection/Configuration.php`,
  `src/DependencyInjection/RepriseExtension.php`, `config/services.php` (or the bundle's service wiring),
  reusing existing `EntrypointsLookup`, `DevServer`, `ResetAssetsEventListener`.

## Non-goals

- Multi-build (`builds:` / `entrypointName`) — mono-build now.
- `encore_*` Twig aliases.
- React refresh preamble (only `@vite/client` generic injection; note the `devServer.client` field
  can carry a variant later).
- `manifest.json` / `asset()` image resolution.
- Rendering `dynamic` chunks as tags.

## Testing

- **JS** — `format.ts` build refs are relative (no leading slash), dev refs absolute; SRI keyed by
  reference; both collectors unaffected; the entrypoints.json shape assertions in the build/dev
  integration tests updated; the CDN test reframed (no absolute build `publicPath`). Rsbuild ESM
  output asserted (an entry chunk is an ES module).
- **PHP unit** (`tests/`) — `TagRenderer`: script/link tag HTML, `type="module"`, integrity +
  crossorigin when present, dev `@vite/client` injected once, `modulepreload` for preload refs,
  per-request dedup, `Packages` resolution (relative -> base_path; absolute dev -> unchanged),
  strict-mode error, WebLink links registered when available.
- **PHP functional** — boot a kernel with the bundle + a `framework.assets` package + a fixture
  `entrypoints.json`, render each Twig function, assert the output.
- **Docs** — a "Rendering asset tags" section with a Vite and an Rsbuild example, and the CDN section
  reframed around `framework.assets`. Prose via the `natural-writing-editor` agent.

## Open risks

1. **Rspack ESM output** (see Part A) — verify a web build loads/runs as ESM before committing to it.
2. **Dev absolute URL through `Packages`** — confirm `Packages::getUrl('http://127.0.0.1:5173/build/app.js')`
   returns it unchanged (it should: absolute URLs bypass base_path/version). A unit test pins this.
3. **`base_path` double-prefix** — confirm a relative ref `build/app-<hash>.js` through a package with
   `base_path: /myapp/` yields `/myapp/build/app-<hash>.js` (not `/build/...` or a doubled prefix).
