# Design — Symfony UX / Stimulus controllers (B1)

Status: approved (2026-07-08)
Milestone: B1 (build + dev static). HMR/watch of controllers deferred to B2.

## Goal

Bring Symfony UX / Stimulus controller registration to Vite and Rsbuild, as a
bundler-agnostic port of `@symfony/stimulus-bundle`. A user who runs a Symfony
app on Vite or Rsbuild should be able to:

1. Drop a controller in `assets/controllers/foo_bar_controller.js` and have it
   registered on the Stimulus `Application` automatically.
2. Enable third-party UX controllers declared in `assets/controllers.json`
   (the file Flex maintains when a `symfony-ux` package is installed).
3. Get lazy loading for any controller annotated `/* stimulusFetch: 'lazy' */`.

The user-facing contract mirrors the modern AssetMapper/StimulusBundle one so
migration is a single import line.

## Non-goals (YAGNI for B1)

- **HMR / watch** of controllers (regenerate + invalidate the virtual module on
  edit, add/remove of a controller file, or `controllers.json` change). Deferred
  to B2. In B1 the controllers are globbed once at dev-server start; adding a new
  controller requires a restart.
- The `import.meta.stimulusFetch = 'lazy'` code-statement variant used by
  vite-plugin-symfony. We follow the `/* stimulusFetch: 'lazy' */` **comment**,
  which is what real Symfony controllers use.
- The `controllers.json` `entrypoints` key (an Encore-entries concept).
- `webpackMode` from a package's `symfony.controllers[name]` (webpack-only hint).
- A configurable identifier-resolution strategy (camelCase, custom fn). Snake-case
  (the Symfony convention) only.
- CDN / absolute-path concerns for controller assets — the bundler handles those.

## User-facing contract

In the app entry (`app.js`), exactly one import line changes vs. AssetMapper:

```diff
- import { startStimulusApp } from '@symfony/stimulus-bundle'
+ import { startStimulusApp } from '@kocal/unplugin-symfony/stimulus'
  const app = startStimulusApp()   // unchanged, no arguments
```

Plugin option — the path is explicit (passing it is what enables the feature):

```ts
// string shorthand
Symfony({ stimulus: 'assets/controllers.json' })

// object form (override the local dir)
Symfony({
  stimulus: {
    controllersJson: 'assets/controllers.json', // required
    controllersDir: 'assets/controllers',       // optional; default = <dir of controllersJson>/controllers
  },
})
```

Prerequisite, to state in the README: in a bundler project the UX JS packages
must be installed via npm (`npm i @symfony/ux-turbo @symfony/ux-leaflet-map …`),
exactly as Encore required. AssetMapper vendors them via importmap; a bundler
resolves the generated `import '@symfony/ux-turbo/…'` from `node_modules`.

## Architecture

Pure generator in core, thin per-bundler provisioning, one shipped runtime helper.

- `src/core/stimulus.ts` — **new**. `generateControllersModule(resolved, root): string`.
  Reads `controllers.json`, resolves each third-party package's `package.json`,
  globs the local controllers dir, and returns the virtual-module source string.
  Node `fs` only, no bundler imports (same latitude as `src/core/emit.ts`).
- `src/stimulus.ts` — **new**. The browser runtime helper, shipped as
  `@kocal/unplugin-symfony/stimulus`. A faithful port of stimulus-bundle's
  `loader.ts`: `startStimulusApp()`, `loadControllers()`, and the
  MutationObserver-based `StimulusLazyControllerHandler`. Imports
  `virtual:symfony/controllers` instead of `./controllers.js`. Peer-deps
  `@hotwired/stimulus`.
- `src/core/options.ts` — extend `normalizeOptions` to normalize `stimulus`
  (`string | object | undefined`) into `{ controllersJson: absPath, controllersDir: absPath } | undefined`.
- `src/types.ts` — add `stimulus?: string | { controllersJson: string, controllersDir?: string }`
  to `Options`, the resolved shape to `ResolvedOptions`, and the
  `eagerControllers`/`lazyControllers` module types for the helper.
- `src/index.ts` (Vite) — universal `resolveId`/`load` on the unplugin factory
  for `virtual:symfony/controllers`, calling the core generator. Only added when
  `stimulus` is configured.
- `src/rsbuild.ts` (Rsbuild) — register `rspack.experiments.VirtualModulesPlugin`
  (via `api.modifyRspackConfig`/`tools.rspack`) writing the same generated string
  under the `virtual:symfony/controllers` id. Only when `stimulus` is configured.
- `package.json` — `"./stimulus": "./dist/stimulus.mjs"` export; add
  `@hotwired/stimulus` as an (optional) peer dep.

Both bundlers serve **the same string** produced by the core generator — the only
per-bundler difference is the provisioning mechanism.

## The generator algorithm

Mirrors `@symfony/stimulus-bundle`'s `ControllersMapGenerator` +
`StimulusLoaderJavaScriptCompiler` (and Encore's `create-controllers-module.ts`).

Output shape (identical to the real generated `controllers.js`):

```js
import controller_0 from '@symfony/ux-turbo/dist/turbo_controller.js'
import '@symfony/ux-turbo/dist/mercure_stream_source_element.js'          // eager autoimport
export const eagerControllers = { 'symfony--ux-turbo--turbo-core': controller_0 }
export const lazyControllers = {
  'symfony--ux-leaflet-map--map': () => import('@symfony/ux-leaflet-map/dist/map_controller.js'),
  'code-highlight': () => import('/abs/assets/controllers/code_highlight_controller.js'),
}
export const isApplicationDebug = false
```

### Third-party controllers (from `controllers.json`)

For each `packageName` → `controllerName` in `controllers.json`'s `controllers`:

1. Resolve `<packageName>/package.json` from `root` (via `createRequire(root)`).
   If missing → throw a clear "run npm install" error.
2. Read `pkg.symfony.controllers[controllerName]`. If absent → throw
   "controller does not exist in the package".
3. Merge: package defaults (`main`, `name?`, `fetch?`, `autoimport?`) with the
   user's `controllers.json` entry (`enabled`, `fetch?`, `name?`, `autoimport?`).
   User values win.
4. Skip if `enabled === false`.
5. `main` module specifier = `` `${packageName}/${pkgControllerConfig.main}` `` —
   emitted as a **bare specifier** (the bundler resolves it from `node_modules`).
6. Identifier: `` `${packageName}/${controllerName}` `` → strip leading `@` →
   `_`→`-`, `/`→`--`. Overridden by package `name` then user `name` (with `/`→`--`).
7. `fetch` (default `eager`): eager → top-level `import controller_N from main` +
   entry in `eagerControllers`. lazy → `() => import(main)` entry in `lazyControllers`.
8. `autoimport`: for each truthy key — eager controller → top-level `import 'key'`;
   lazy controller → wrap as `() => Promise.all([import(main), import('key'), …]).then(r => r[0])`.

### Local controllers (glob `controllersDir`)

1. Glob `controllersDir` recursively for files matching `/^.*[-_]controller\.[jt]s$/`.
2. Identifier: path relative to `controllersDir`, strip the `[-_]controller.<ext>`
   suffix, `_`→`-`, `/`→`--`. E.g. `code_highlight_controller.js` → `code-highlight`,
   `admin/user_controller.js` → `admin--user`.
3. Read the file; lazy if it contains `/* stimulusFetch: 'lazy' */`
   (regex `/\/\*\s*stimulusFetch:\s*'lazy'\s*\*\//i`), else eager.
4. Import specifier = the controller's **absolute filesystem path** (a virtual
   module has no meaningful location for relative paths). eager → top-level import;
   lazy → `() => import('<abs path>')`.

A local identifier collision with a third-party one: local wins (last-write), and
we `log()` a warning. (Rare; matches "your controllers override" intuition.)

## The runtime helper (`src/stimulus.ts`)

Faithful port of stimulus-bundle's `loader.ts` (≈1.5 KB). Only the controllers
import source differs:

```js
import { Application } from '@hotwired/stimulus'
import { eagerControllers, lazyControllers, isApplicationDebug } from 'virtual:symfony/controllers'

export function startStimulusApp() {
  const app = Application.start()
  app.debug = isApplicationDebug
  loadControllers(app, eagerControllers, lazyControllers)
  return app
}
// loadControllers: register eager immediately; hand lazy to StimulusLazyControllerHandler
// StimulusLazyControllerHandler: on start, scan the DOM for [data-controller]; a MutationObserver
// loads a lazy controller the first time a matching element appears, then deletes it from the map.
export { loadControllers }
```

`isApplicationDebug` is generated from the bundler mode (dev → true).

A `virtual:symfony/controllers` module declaration ships in a `.d.ts` so the
helper (and user TS) type-check.

## Testing

- **Unit — generator** (`test/`): fixtures = a `controllers.json`, fake package
  dirs with `package.json` `symfony.controllers`, and a local controllers dir
  with one eager + one `/* stimulusFetch: 'lazy' */` file. Assert the generated
  source: correct bare/absolute import specifiers, identifiers, eager vs lazy
  placement, autoimport (eager top-level import + lazy Promise.all wrap),
  `enabled: false` skipped, missing-package throws.
- **Integration — Vite** (`test/integration`): a real build with
  `stimulus: '<fixture>/controllers.json'`; assert `virtual:symfony/controllers`
  resolves and the controllers' code lands in the output bundle.
- **Integration — Rsbuild**: the same, exercising the `VirtualModulesPlugin` path.
- Keep the existing entrypoints/manifest suites green (the stimulus option is
  additive and off by default).

## Open edge cases (decide during implementation)

- Exact `VirtualModulesPlugin` wiring for a `virtual:` scheme id in Rspack (may
  need a `resolve.alias` from `virtual:symfony/controllers` to the written module,
  or a real-looking path the resolver accepts).
- `.tsx/.jsx` controllers — the filename regex uses `[jt]s`; confirm whether to
  widen to `[jt]sx?`.
- Where `isApplicationDebug` comes from in each adapter (Vite `command`/mode vs
  Rspack `watchMode`).
