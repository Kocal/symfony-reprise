# unplugin-symfony — feature migration roadmap & design

- **Date:** 2026-07-07
- **Status:** approved design, pre-implementation
- **Scope:** the JS/unplugin side only — generate the Symfony integration files and freeze their format. The PHP companion bundle is a separate deliverable (own plan/repo).

## Context & goal

`@kocal/unplugin-symfony` brings Webpack Encore's Symfony-integration features to Vite and Rsbuild/Rspack. It does **not** re-implement what the bundlers already do (Sass/PostCSS/TS, code splitting, hashing, HMR, dev server). Its job is the glue Symfony needs: emitting `entrypoints.json` and `manifest.json` so a Symfony app can render the right `<script>`/`<link>` tags and cache-bust assets.

This document plans which features to migrate, how to structure the code, and how to test it.

## Decisions (locked)

- **Bundler order:** Vite first, then port to Rspack. The core stays bundler-agnostic; only the collectors differ.
- **First shippable milestone:** Vite build **and** dev-server/HMR (entrypoints.json + manifest.json).
- **Stimulus controllers:** prioritized early, as an independent parallel track.
- **Testing:** layered — pure-core unit tests plus a thin layer of real-build integration tests.
- **Consumer:** a **companion PHP/Symfony bundle of our own** (separate repo/plan), **not** WebpackEncoreBundle. The user of this plugin does not install WebpackEncoreBundle.
- **Output format:** **our own rich format** (build/dev mode, dev-server origin, integrity), modeled on `vite-plugin-symfony` — not byte-compatible with Encore.

## Consumer & integration model

The plugin writes JSON files into `outputPath`. A companion Symfony bundle (separate deliverable) reads them and provides Twig helpers to render tags. The exact Twig function names are that bundle's concern, not the plugin's; a neutral, non-`symfony_`/`vite_`/`encore_` prefix is preferred since the plugin is multi-bundler.

Because the format is ours, it is a **contract** between two deliverables. This plan freezes format **v1** (as a shared TS type); the PHP bundle plan consumes it. The exact field set is finalized against real `vite-plugin-symfony` output and the PHP bundle's needs.

`manifest.json` is additionally kept flat and compatible with Symfony's native `JsonManifestVersionStrategy`, so `asset()` cache-busting works even without the companion bundle installed.

## Output format v1 (draft)

`entrypoints.json` — build:

```jsonc
{
  "isProd": true,
  "devServer": null,
  "publicPath": "/build/",
  "entryPoints": {
    "app": {
      "js": ["/build/app-a1b2.js"],
      "css": ["/build/app-c3d4.css"],
      "preload": ["/build/vendor-e5f6.js"],
      "dynamic": ["/build/lazy-x.js"]
    }
  }
}
```

`entrypoints.json` — dev (serve):

```jsonc
{
  "isProd": false,
  "devServer": { "origin": "http://127.0.0.1:5173", "client": "vite" },
  "publicPath": "/build/",
  "entryPoints": { "app": { "js": ["…"], "css": ["…"], "preload": [], "dynamic": [] } }
}
```

- `devServer.client: "vite"` tells the PHP bundle to add `@vite/client` (+ the React refresh preamble when relevant) as a separate script, because Vite serves the HMR client separately.
- `devServer.client: null` (Rspack dev) means the HMR client is already baked into the entry chunks by the dev server; the PHP side injects nothing and just loads the absolute URLs.

`manifest.json` — flat, logical keys, compatible with `JsonManifestVersionStrategy`:

```jsonc
{ "build/app.js": "/build/app-a1b2.js", "build/app.css": "/build/app-c3d4.css" }
```

Field names above (`devServer`, `client`, `preload`, `dynamic`) are the v1 draft; final names are pinned with the PHP bundle plan.

## Architecture

The core serializes **our** format and knows nothing about any bundler. Each collector extracts a normalized graph from its bundler and knows nothing about the output format.

```
src/
  core/
    options.ts    normalizeOptions + CDN guard + resolvePublicPath(mode, opts, devOrigin)
    format.ts     buildEntrypoints(graph, ctx) -> EntrypointsJson ; buildManifest(assets, ctx) -> ManifestJson
    types.ts      Options, normalized shapes, EntrypointsJson / ManifestJson
  collectors/
    vite.ts       build: generateBundle(bundle) ; dev: configResolved(serve) + configureServer/listen
    rspack.ts     unified compilation hook (build + dev)                     [milestone 2]
  index.ts        factory: normalize options -> select collector -> core -> write files
  vite.ts / rspack.ts   one-line adapters (createVitePlugin / createRspackPlugin)
```

**Boundary:** the core always receives the same normalized shape — `{ entry -> { js, css, preload, dynamic } }` plus `{ isProd, devServer }` — whether from a build or a dev server. One serializer, two collectors.

**Why per-bundler collectors are unavoidable:** unplugin's *universal* hooks (`buildStart`/`buildEnd`/`writeBundle`) do not expose the chunk graph (`writeBundle` has `this: void`). Extracting the entry→assets mapping must go through per-bundler escape hatches (`vite.generateBundle`, the Rspack `compiler`). The Stimulus virtual module is the exception — `resolveId`/`load` *are* universal, so it is bundler-agnostic from the start.

## Data flow

**Build (`vite build`):** `generateBundle(_, bundle)` reads each `isEntry` chunk, follows `imports` (topological order — shared chunks before the entry) and `viteMetadata.importedCss` for CSS, and collects assets into a flat map. Then `core.buildEntrypoints` + `core.buildManifest` → write both files to `outputPath`.

**Dev (`vite`, serve):** no `generateBundle` runs. At `configureServer`/listen the plugin knows the dev-server origin and the configured entries, and writes a dev-flavored `entrypoints.json` with absolute dev-server URLs. No `@vite/client` hack in the `js` array — the PHP bundle handles it from `devServer.client`.

### Dev-server origin resolution (ported from Encore)

Encore solves this cleanly; we port two functions into `core`.

- `calculateDevServerUrl()` (`../webpack-encore/lib/config/path-util.ts:119-139`): builds the origin from a `--public`-style override (used as-is when it contains `://`, otherwise prefixed with the detected scheme) or from `http(s)://host:port`.
- `getRealPublicPath()` (`../webpack-encore/lib/WebpackConfig.ts:460-477`): the key trick — when not on the dev server (or `keepPublicPath`, or publicPath already absolute) return publicPath unchanged; otherwise `devServerUrl.replace(/\/$/,'') + publicPath`.

Our `core.resolvePublicPath(mode, opts, devOrigin)`:

```
build              -> opts.publicPath
dev & '://'        -> opts.publicPath            (already absolute / CDN)
dev & keepPublic   -> opts.publicPath
dev                -> stripTrailingSlash(devOrigin) + opts.publicPath
```

Entrypoint URLs are then `resolvedPublicPath + fileName` — **mode-agnostic prefixing**, exactly like Encore (`entry-points-plugin.ts:91-94`), with no separate dev codepath. Crucially, **manifest keys stay logical** (`build/app.js`), derived from the *original* publicPath, never the absolute one — mirroring Encore's `manifest-key-prefix-helper.ts`.

**Per-bundler differences reduce to two things:**

1. Where `devOrigin` comes from — Vite: resolved `server` config (host/port/https) + optional `origin` override; Rsbuild: resolved dev server / `dev.assetPrefix` + a `--public`-style override.
2. The `devServer.client` flag — Vite needs a separate `@vite/client` script; Rspack bakes HMR into the entry chunks, so nothing extra is injected.

Rspack detail: it runs a real in-memory compilation in dev too, so the collector uses a **single** compilation hook for both build and dev — simpler than Vite's split (`generateBundle` vs `configureServer`). Exact Rsbuild dev APIs (hook to read entrypoints, `assetPrefix` behavior) are verified at implementation time, not fixed here.

## Roadmap

### Track A — JSON generation (Vite first)

- **A1 · Core + Vite build** (foundation; everything depends on it)
  - `core/options.ts`, `core/format.ts`, `core/types.ts`
  - `collectors/vite.ts` (build path)
  - `index.ts` writes `entrypoints.json` + `manifest.json`
  - Delivers `vite build` output and **freezes format v1**. Vite's content hashes are the versioning, so this covers both "manifest.json" and "asset versioning".
- **A2 · Vite dev + HMR** (depends on A1)
  - `collectors/vite.ts` (dev path), `resolvePublicPath` dev branch, `devServer.client: "vite"`
  - **Milestone 1 = A1 + A2.**
- **A3 · Rspack port, build + dev** (depends on A1/A2)
  - `collectors/rspack.ts`, unified compilation hook, `devOrigin` from server/`assetPrefix`, `devServer.client: null`
  - **Milestone 2** — Vite/Rspack parity.

### Track B — Stimulus (parallel, early, independent)

- **B1 · `virtual:symfony/controllers`**
  - Universal `resolveId`/`load` hooks → works on Vite and Rspack with no port.
  - Parse `controllers.json` (enabled + eager/lazy + autoimport), resolve each third-party controller from its npm package, glob `assets/controllers/`, emit code registering them on the Stimulus `Application`.
  - **Milestone B**, runs alongside Track A.

### Polish (after milestones, order flexible)

- **CDN** (absolute `publicPath`): mostly done in A1 (`resolvePublicPath` handles `://` + the guard). Finalize.
- **SRI**: optional `integrity` in entrypoints (hash emitted assets). After A3.
- **Shared runtime chunk**: mostly bundler config (Rollup `manualChunks` / Rspack) + load order, not core logic. Last.

### Front order

A1 → A2 (Milestone 1) → A3 (Milestone 2); B1 in parallel from the start; polish after.

## Testing strategy (layered)

Most correctness and parity live in fast pure-unit tests; a thin real-build layer catches extraction regressions.

- **Layer 1 — core (pure).** `buildEntrypoints`/`buildManifest` against normalized-graph fixtures (single/multi entry, shared-chunk order, CSS grouping, dynamic/preload, build vs dev, empty entry). `normalizeOptions`/`resolvePublicPath`/CDN guard as table-driven tests (relative/absolute outputPath, publicPath `/build` vs `build/` vs `://`, manifestKeyPrefix derivation, the CDN throw, dev-origin prefixing, keepPublicPath, trailing slash). No bundler, no filesystem.
- **Layer 2 — collector extractors (pure).** `bundleToGraph(bundle)` fed a fixture Rollup bundle object → assert normalized graph, without running a build. Same for `statsToGraph` (Rspack) in A3.
- **Layer 3 — integration (real builds, few).** `import { build } from 'vite'` on a minimal fixture (`test/fixtures/basic/`: two entries, a CSS import, a dynamic import, a shared module) into a temp dir → read emitted JSON → assert with **hashes normalized** (regex → placeholder) for stability. `createRsbuild().build()` likewise in A3.
- **Layer 4 — dev smoke.** One test that boots a programmatic Vite dev server, asserts the dev `entrypoints.json` is written (`isProd:false`, `devServer.origin`, entry URLs), then closes. Kept minimal (port flakiness); dev logic is covered in Layer 1.
- **Cross-bundler parity** (when A3 lands): one parametrized test runs the same fixture through `vite build` and `rsbuild build` and asserts the two `entrypoints.json` are equivalent after hash normalization. This is our parity guarantee (for our format, not Encore's).
- **Stimulus (B1):** unit test the virtual-module code generator (parsed `controllers.json` + fake package resolver + fake glob → snapshot the emitted source; covers enabled/eager/lazy/autoimport). Integration: a fixture with `controllers.json` + `assets/controllers/` through a real `vite build`, asserting the virtual module resolves/loads and the output contains the registrations.
- **Format contract:** format v1 is a shared TS type (`EntrypointsJson`); a shape test asserts conformance. This is the contract with the PHP bundle.

**Tooling / limits:** vitest, already scoped to `test/`. Temp dirs via `node:fs` `mkdtemp`, cleaned up after. Programmatic builds make `vite`/`@rsbuild/core` root devDeps (needed for A3). Integration tests are kept few for CI speed. The **playground stays manual** (the user's E2E harness); automated tests use `test/fixtures/`, never the playground Symfony app.

## Out of scope

- The companion PHP/Symfony bundle (separate plan/repo). It consumes the frozen format v1.
- Re-implementing bundler-native features (Sass/PostCSS/TS, splitting, hashing, minification, HMR transport, the dev server itself).

## Follow-up: AGENTS.md changes (after implementation direction is set)

The current AGENTS.md is written around Encore/WebpackEncoreBundle and needs updating to match these decisions:

- Rewrite "The Symfony integration contract" (lines ~43–58): the consumer is our own companion bundle, not WebpackEncoreBundle; the format is ours (rich), not Encore-compatible.
- Reword line 36 ("All logic belongs in `index.ts`"): logic lives in the factory layer (`index.ts` + `core/` + `collectors/`); the per-bundler *adapter files* stay one-liners.
- Shift the format reference from Encore's `entry-points-plugin.ts` to `vite-plugin-symfony`; keep `webpack-encore` as the reference for dev-server-URL and manifest-key-prefix semantics.

## Open questions (to finalize during implementation)

- Exact field set/names of format v1 — pinned against real `vite-plugin-symfony` output and the PHP bundle's needs.
- Exact Rsbuild dev APIs for reading entrypoints and the dev-server origin (`dev.assetPrefix` behavior) — verified against the real API in A3.
- Whether the Rsbuild dev path warrants a dedicated `RsbuildPlugin` adapter (auto-detect the server URL via `api.onAfterStartDevServer`) or stays on the raw `rspack(compiler)` hook with a user-set absolute `assetPrefix`.
