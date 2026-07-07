# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@kocal/unplugin-symfony` — an [unplugin](https://github.com/unjs/unplugin) that brings Symfony Webpack Encore's key features to modern bundlers: **Vite** and **Rsbuild/Rspack**. Full ESM, greenfield (early stage, most features are stubs).

**Design principle — do NOT re-implement what the bundler already does.** Vite and Rsbuild natively handle Sass/Less/PostCSS, TypeScript, code splitting, content hashing, source maps, minification, HMR, and the dev server. This plugin does NOT wrap or re-expose any of those (so no `enableSassLoader()`-style API from Encore). Its job is the **Symfony integration glue** that the bundlers do not provide — see below.

## Commands

Package manager is **pnpm** (enforced via `packageManager` field). Node 22 (`.nvmrc`).

- `pnpm build` — build via `tsdown` (bundles every `src/*.ts` to `dist/`)
- `pnpm dev` — `tsdown -w`, watch/rebuild
- `pnpm lint` — `eslint .` (@antfu/eslint-config, flat config); `playground/` is ignored (fixture app, not library source)
- `pnpm test` — run tests (vitest, scoped to `test/` via `vitest.config.ts` so it never picks up `.references/` clones)
- `pnpm vitest run test/index.test.ts` — run a single test file
- `pnpm vitest run -t "hi vitest"` — run a single test by name

### Playground (manual end-to-end verification)

`playground/` is a **full Symfony 7 PHP app** used to exercise the plugin against a real backend. It defines two entries (`app`, `admin`) and imports the plugin directly from `../src` (Vite via `playground/vite.config.ts`, Rsbuild via `playground/rsbuild.config.ts`). `nodemon` rebuilds on `src/**/*.ts` changes.

Run from the playground dir (the root `pnpm play` script is broken — it calls a nonexistent `dev` script):

- `npm -C playground run vite:dev` / `npm -C playground run vite:build`
- `npm -C playground run rsbuild:dev` / `npm -C playground run rsbuild:build`

## Architecture

Standard unplugin factory layout:

- `src/index.ts` — the `unpluginFactory` (single source of truth) plus `unplugin`/default export via `createUnplugin`. Normalizes options (resolves `outputPath` against `cwd`, derives `manifestKeyPrefix` from `publicPath`) and returns the hooks.
- `src/vite.ts`, `src/rspack.ts` — thin per-bundler adapters (Vite, and Rspack which also backs Rsbuild), each just `createXxxPlugin(unpluginFactory)`. **All logic belongs in `index.ts`; adapters stay one-liners.** These map to the `exports` field (`unplugin-symfony/vite`, `unplugin-symfony/rspack`).
- `src/types.ts` — the public `Options` interface (`outputPath`, `publicPath`, `manifestKeyPrefix`) and the `EntrypointsJson` shape. Note: `Entrypoint` currently models only `js`/`css`, but Encore's `entrypoints.json` keys are arbitrary asset extensions (`woff2`, `png`, …) — widen this when implementing generation.

The factory uses cross-bundler hooks (`buildStart`/`buildEnd`) plus bundler-specific escape hatches: `vite.config()` sets `outDir`/`assetsDir` and disables Vite's own manifest/publicDir copy; `rspack(compiler)` sets output path/publicPath directly. `buildStart`/`buildEnd` are currently `console.log` stubs — this is where the two output files below must be generated.

## The Symfony integration contract (the core of this project)

Encore's real value to Symfony is two JSON files written into `outputPath`, consumed by WebpackEncoreBundle's Twig helpers (`encore_entry_script_tags()`, `encore_entry_link_tags()`, `asset()`). Generating these in Encore-compatible format is the primary work:

- **`entrypoints.json`** — maps each entry name to its asset URLs grouped by type, in load order (runtime chunks before app chunks). Optional `integrity` section for SRI hashes.
  ```json
  { "entrypoints": { "app": { "js": ["/build/runtime.js", "/build/app.js"], "css": ["/build/app.css"] } } }
  ```
- **`manifest.json`** — maps logical filename -> versioned/hashed URL, for cache-busting. Keys are prefixed with `manifestKeyPrefix` (defaults to `publicPath` minus leading slash). When `publicPath` is an absolute CDN URL (contains `://`), `manifestKeyPrefix` must be set explicitly. Encore enforces this by throwing (`../webpack-encore/lib/config/path-util.ts`, `validatePublicPathAndManifestKeyPrefix`); **porting that guard is still TODO** — the current factory does not throw and would use the absolute URL as the key prefix. The `publicPath === null` branch in `src/index.ts` is likewise dead (`publicPath` always defaults to `build/`).

### Dev server (build mode vs serve mode)

The plugin must behave differently depending on the bundler mode:

- **Build mode** (`vite build`, `rsbuild build`): assets are written to `outputPath` with content hashes; `entrypoints.json`/`manifest.json` point at those files under `publicPath`.
- **Serve/dev mode** (`vite`, `rsbuild dev`): the bundler's own dev server holds modules in memory and serves them over HTTP with native ESM + HMR. Here `entrypoints.json` must instead point at the dev server origin (e.g. `http://127.0.0.1:5173/build/app.js`) and inject the HMR client (`@vite/client`; React additionally needs the refresh preamble), so WebpackEncoreBundle's Twig tags load from the running dev server rather than from disk.

The dev server itself is native to Vite/Rsbuild — this plugin does not run one. Its only dev-server responsibility is detecting the mode (unplugin `meta`, or Vite's `configResolved` `command === 'serve'` vs `'build'`; Rsbuild/Rspack expose the same distinction) and emitting the dev-flavored `entrypoints.json` plus client injection. Encore's counterpart is `configureDevServerOptions()` (webpack-dev-server) in the reference `index.ts`, but that whole layer is replaced by the native dev server.

### Symfony UX / Stimulus controllers

Symfony UX ships Stimulus controllers from Composer packages, declared in `assets/controllers.json` (which controllers are enabled, `fetch: eager|lazy`, and each package's `autoimport` CSS). Local project controllers live in `assets/controllers/`.

Encore wires this with `enableStimulusBridge(controllerJsonPath)` (reference `lib/WebpackConfig.ts:882`), which only (1) adds the entries declared in `controllers.json`'s `entrypoints` map and (2) aliases `@symfony/stimulus-bridge/controllers.json` to the real file. The actual controller registration lives in the `@symfony/stimulus-bridge` npm package, whose webpack loader (`@symfony/stimulus-bridge/loader!./controllers.json`) plus a `require.context`-based lazy loader turn that JSON and the `assets/controllers/` dir into a registered Stimulus `Application`.

That loader is webpack-only, so it must be reimplemented here as a bundler-agnostic **virtual module** (unplugin `resolveId`/`load`): parse `controllers.json`, resolve each third-party controller from its npm package (honoring enabled + eager/lazy + `autoimport`), glob the local `assets/controllers/` dir, and emit the code that registers them on the Stimulus app. Prior art: `vite-plugin-symfony`'s `virtual:symfony/controllers` module.

Feature roadmap (see README): `entrypoints.json` (build + dev), `manifest.json`, asset versioning wired into the manifest, absolute/CDN `publicPath`, dev-server + HMR, SRI hashes, shared runtime chunk across entries, Symfony UX / Stimulus controllers.

## Reference: the project being replaced

The original Encore lives at `../webpack-encore`. Consult it for exact output formats and semantics:

- `index.ts` — full Encore public API (what to selectively port vs. drop as bundler-native)
- `lib/webpack/entry-points-plugin.ts` — canonical `entrypoints.json` generation logic
- `lib/plugins/manifest.ts` and `lib/utils/manifest-key-prefix-helper.ts` — `manifest.json` + key-prefix edge cases
- `test_apps/npm-with-babel/public/build/{entrypoints,manifest}.json` — real example outputs

The Encore bundle for Symfony lives at `../webpack-encore-bundle`.

## Reference: unplugin examples

Read-only clones under `.references/` (git-ignored) show how mature unplugins are built — same `index.ts` factory + thin per-bundler entry convention we use. See `reference-repos.md` for the list; each clone has an `AGENTS.md` on what to study. Most relevant: `.references/unplugin-icons` (virtual `resolveId`/`load` — the model for the Stimulus module) and `.references/unplugin-auto-import` (virtual-module code injection + `.d.ts` generation).

## Conventions

- ESM only, strict TypeScript, ES2017 target. Use the `node:` prefix for Node builtins.
- New public options go in `src/types.ts` with JSDoc; keep bundler adapters trivial.
- Releases: `pnpm release` (`bumpp` + `pnpm publish`); changelog via `changelogithub` on tag push.
