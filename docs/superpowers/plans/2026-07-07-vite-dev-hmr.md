# Vite dev-server / HMR: dev-flavored entrypoints.json — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Vite serve mode, write a dev-flavored `entrypoints.json` pointing at the running dev server's origin, and fix the build-mode `base` so runtime asset URLs resolve under `publicPath`.

**Architecture:** Reuse A1's pure core. Add a dev-origin resolver and a config→graph collector; the factory writes the dev file from `configureServer` on the server's `listening` event. Entrypoint URLs are built from a `urlPrefix` (= `publicPath` in build, = `origin + publicPath` in dev), kept separate from the `publicPath` field emitted in the JSON.

**Tech Stack:** TypeScript (ESM, strict, ES2017), unplugin 2, Vite 6, vitest 3, tsdown.

**Sources (derive from these — do NOT copy any third-party plugin):**
- **Vite's public plugin API** (the platform): `configResolved`/`configureServer` hooks, `ResolvedConfig.{command,base,root,server,build.rollupOptions.input}`, `ViteDevServer.httpServer`, and `ServerOptions.origin`. This is the legitimate substrate to build on.
- **Encore's dev-server semantics** (`../webpack-encore`, the project we replace — same Symfony lineage): `lib/config/path-util.ts` `calculateDevServerUrl` (the `--public` override precedence) and `lib/WebpackConfig.ts` `getRealPublicPath` (prefix `publicPath` with the dev origin). We reimplement these ideas in our own core.
- `.references/vite-plugin-symfony` and `.references/vite-bundle` are for **understanding the problem space only** — do not lift their code. Our implementation is independent ("Symfony sauce").

**Reference (our own):** design spec `docs/superpowers/specs/2026-07-07-unplugin-symfony-roadmap-design.md` (milestone A2), and A1's shipped `src/core`, `src/collectors/vite.ts`, `src/index.ts`.

## Global Constraints

- ESM only; strict TypeScript; ES2017 target; `node:` prefix for Node builtins.
- unplugin factory pattern: all logic in `index.ts` + `core/` + `collectors/`; `src/vite.ts`/`src/rspack.ts` stay one-line adapters.
- Format v1: `entrypoints.json` top-level keys `isProd`, `devServer`, `publicPath`, `entryPoints`; per-entry `js`, `css`, `preload`, `dynamic`.
- **Dev entry URLs are absolute**: `origin + publicPath + inputRelPath`. The emitted top-level `publicPath` stays the original (e.g. `/build/`); the origin is carried in `devServer.origin`. `devServer.client` is `'vite'` in serve mode, `null` otherwise.
- **`base` equals `publicPath` in both modes** (so Vite's own asset/CSS-url references resolve under `publicPath`).
- Dev entries carry only `js` OR `css` (native ESM in dev — no `preload`/`dynamic` chunk graph). Those arrays stay present but empty.
- In serve mode there is no bundle: write with `node:fs`, not `emitFile`. Trigger on the dev server's `listening` event (the address/port is only valid then).
- Node 22 (so `AddressInfo.family === 'IPv6'` is the string form — no legacy integer check); pnpm; run commands with `CI=true` prefix in this environment.
- Automated tests use `test/fixtures/`, never the `playground/` app.

## File Structure

- `src/types.ts` — **modify.** `Options` gains `devServerOrigin?`; `ResolvedOptions` carries it; `BuildContext` gains `urlPrefix`.
- `src/core/options.ts` — **modify.** `normalizeOptions` forwards `devServerOrigin`; add `resolvePublicPath(publicPath, devOrigin)`.
- `src/core/format.ts` — **modify.** `buildEntrypoints`/`buildManifest` build URLs from `ctx.urlPrefix`; `buildEntrypoints` emits `ctx.publicPath` as the top-level field.
- `src/core/dev-server.ts` — **create.** `resolveDevOrigin(address, input)` (pure).
- `src/collectors/vite.ts` — **modify.** Add `configToDevGraph(config)` + a `slash` helper.
- `src/index.ts` — **modify.** `base` in vite config; `configResolved`; build `ctx` gains `urlPrefix`; `configureServer` writes the dev file.
- Tests: `test/core/dev-server.test.ts` (create), `test/core/options.test.ts` / `test/core/format.test.ts` / `test/collectors/vite.test.ts` (extend), `test/integration/vite-build.test.ts` (extend — base assertion), `test/integration/vite-dev.test.ts` (create).
- `test/fixtures/basic/logo.svg` + `style.css` url() — **create/modify** (for the base test).

---

### Task 1: Set Vite `base = publicPath` (fix A1 latent bug)

Without this, Vite emits CSS `url()` / preload references under `/` instead of `publicPath`, so assets 404 when served under `/build/`.

**Files:**
- Modify: `src/index.ts` (the `vite.config()` return)
- Create: `test/fixtures/basic/logo.svg`
- Modify: `test/fixtures/basic/style.css`
- Test: `test/integration/vite-build.test.ts`

**Interfaces:**
- Consumes: `resolved.publicPath` (from `normalizeOptions`, A1).
- Produces: Vite `base` set to `publicPath` for both build and serve.

- [ ] **Step 1: Add the fixture asset + a CSS url() reference**

Create `test/fixtures/basic/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#f00"/></svg>
```

Replace `test/fixtures/basic/style.css` with:

```css
body {
  color: red;
  background: url('./logo.svg');
}
```

- [ ] **Step 2: Write the failing test**

Append to `test/integration/vite-build.test.ts` (add `readdirSync` to the existing `node:fs` import):

```ts
it('sets Vite base to publicPath so emitted CSS references assets under /build/', async () => {
  const out = mkdtempSync(join(tmpdir(), 'ups-'))
  await build({
    root: fixture,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      assetsInlineLimit: 0, // force logo.svg to a file so the CSS keeps a url()
      rollupOptions: {
        input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
      },
    },
    plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
  })

  const cssFile = readdirSync(out).find(f => f.endsWith('.css'))!
  const css = readFileSync(join(out, cssFile), 'utf8')
  expect(css).toContain('/build/')
  expect(css).not.toMatch(/url\(\/logo/) // must NOT reference /logo… at the root
}, 30_000)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/integration/vite-build.test.ts -t "base to publicPath"`
Expected: FAIL — the emitted CSS contains `url(/logo-….svg)` (base `/`), so `toContain('/build/')` fails / the negative match trips.

- [ ] **Step 4: Set `base` in the factory**

In `src/index.ts`, change the `vite.config` return to add `base`:

```ts
    vite: {
      config: () => ({
        base: resolved.publicPath,
        build: {
          outDir: resolved.outputPath,
          copyPublicDir: false,
          manifest: false,
          assetsDir: '.',
        },
      }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/integration/vite-build.test.ts`
Expected: PASS (the new test + the existing build tests). The existing `app.css` assertion still holds; the small `logo.svg` is inlined at the default inline limit used by the other tests, so their assertions are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/fixtures/basic/logo.svg test/fixtures/basic/style.css test/integration/vite-build.test.ts
git commit -m "fix(vite): set base to publicPath so runtime asset URLs resolve"
```

---

### Task 2: Separate URL prefix from the emitted publicPath; add resolvePublicPath

Dev URLs are absolute (`origin + publicPath + path`) while the emitted `publicPath` field stays original. The core must build URLs from a `urlPrefix` distinct from the `publicPath` field. `resolvePublicPath` reimplements Encore's `getRealPublicPath` idea (prefix `publicPath` with the dev origin) in our own core.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/core/options.ts`
- Modify: `src/core/format.ts`
- Modify: `src/index.ts` (build `ctx`)
- Test: `test/core/format.test.ts`, `test/core/options.test.ts`

**Interfaces:**
- Consumes: `BuildContext`, `NormalizedGraph` (A1).
- Produces:
  - `BuildContext.urlPrefix: string` (URL prefix for entry/asset URLs).
  - `resolvePublicPath(publicPath: string, devOrigin: string | null): string`.

- [ ] **Step 1: Write the failing tests**

Add to `test/core/options.test.ts`:

```ts
import { resolvePublicPath } from '../../src/core/options'

describe('resolvePublicPath', () => {
  it('returns publicPath unchanged in build mode (no dev origin)', () => {
    expect(resolvePublicPath('/build/', null)).toBe('/build/')
  })
  it('prefixes the dev-server origin in dev mode', () => {
    expect(resolvePublicPath('/build/', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/build/')
  })
  it('strips a trailing slash from the origin before joining', () => {
    expect(resolvePublicPath('/build/', 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/build/')
  })
  it('keeps an already-absolute publicPath (CDN) as-is even in dev', () => {
    expect(resolvePublicPath('https://cdn.example.com/x/', 'http://127.0.0.1:5173')).toBe('https://cdn.example.com/x/')
  })
})
```

In `test/core/format.test.ts`, update the shared `ctx` to include `urlPrefix` and add a dev-like case. Change the existing `ctx` object to:

```ts
const ctx: BuildContext = {
  isProd: true,
  devServer: null,
  publicPath: '/build/',
  urlPrefix: '/build/',
  manifestKeyPrefix: 'build/',
}
```

and append this test inside `describe('buildEntrypoints', ...)`:

```ts
  it('builds URLs from urlPrefix but emits the original publicPath field', () => {
    const devCtx: BuildContext = {
      isProd: false,
      devServer: { origin: 'http://127.0.0.1:5173', client: 'vite' },
      publicPath: '/build/',
      urlPrefix: 'http://127.0.0.1:5173/build/',
      manifestKeyPrefix: 'build/',
    }
    const out = buildEntrypoints({ entryPoints: { app: { js: ['assets/app.js'], css: [], preload: [], dynamic: [] } }, assets: [] }, devCtx)
    expect(out.publicPath).toBe('/build/')
    expect(out.devServer).toEqual({ origin: 'http://127.0.0.1:5173', client: 'vite' })
    expect(out.entryPoints.app.js).toEqual(['http://127.0.0.1:5173/build/assets/app.js'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true pnpm vitest run test/core/options.test.ts test/core/format.test.ts`
Expected: FAIL — `resolvePublicPath` is not exported; `BuildContext` has no `urlPrefix` (type error) and `buildEntrypoints` still joins on `ctx.publicPath`.

- [ ] **Step 3: Add the type + resolver**

In `src/types.ts`, add `urlPrefix` to `BuildContext`:

```ts
export interface BuildContext {
  isProd: boolean
  devServer: DevServer | null
  /** Prefix for entry/asset URLs. Equals publicPath in build; origin+publicPath in dev. */
  urlPrefix: string
  /** The configured publicPath, emitted as the top-level `publicPath` field. */
  publicPath: string
  /** Logical key prefix for manifest.json keys. */
  manifestKeyPrefix: string
}
```

In `src/core/options.ts`, add:

```ts
export function resolvePublicPath(publicPath: string, devOrigin: string | null): string {
  if (!devOrigin || publicPath.includes('://'))
    return publicPath
  return `${devOrigin.replace(/\/$/, '')}${publicPath}`
}
```

- [ ] **Step 4: Build URLs from urlPrefix**

In `src/core/format.ts`, change every `ctx.publicPath` used for URL building to `ctx.urlPrefix`. `buildEntrypoints` becomes:

```ts
export function buildEntrypoints(graph: NormalizedGraph, ctx: BuildContext): EntrypointsJson {
  const entryPoints: Record<string, EntryFiles> = {}
  for (const [name, files] of Object.entries(graph.entryPoints)) {
    entryPoints[name] = {
      js: files.js.map(f => joinUrl(ctx.urlPrefix, f)),
      css: files.css.map(f => joinUrl(ctx.urlPrefix, f)),
      preload: files.preload.map(f => joinUrl(ctx.urlPrefix, f)),
      dynamic: files.dynamic.map(f => joinUrl(ctx.urlPrefix, f)),
    }
  }
  return { isProd: ctx.isProd, devServer: ctx.devServer, publicPath: ctx.publicPath, entryPoints }
}
```

and in `buildManifest`, change the value join to `joinUrl(ctx.urlPrefix, fileName)` (keys still use `ctx.manifestKeyPrefix`).

- [ ] **Step 5: Update the build ctx in the factory**

In `src/index.ts`, the build `ctx` inside `generateBundle` becomes:

```ts
        const ctx: BuildContext = {
          isProd: true,
          devServer: null,
          publicPath: resolved.publicPath,
          urlPrefix: resolved.publicPath,
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `CI=true pnpm vitest run test/core && CI=true pnpm vitest run test/integration/vite-build.test.ts`
Expected: PASS — build output is unchanged (urlPrefix == publicPath in build), and the new dev-like unit test passes.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/core/options.ts src/core/format.ts src/index.ts test/core/options.test.ts test/core/format.test.ts
git commit -m "refactor(core): separate urlPrefix from publicPath field; add resolvePublicPath"
```

---

### Task 3: Dev-server origin resolver

A small, independent resolver: our own `devServerOrigin` option (an explicit override, mirroring Encore's `--public`) takes precedence, then Vite's own `server.origin` option, then a plain `http(s)://host:port` assembled from the Node `AddressInfo` the dev server is listening on. No third-party plugin code is used.

**Files:**
- Create: `src/core/dev-server.ts`
- Test: `test/core/dev-server.test.ts`

**Interfaces:**
- Consumes: `AddressInfo` from `node:net` (pure).
- Produces: `resolveDevOrigin(address: AddressInfo, input: DevOriginInput): string` and the `DevOriginInput` type.

- [ ] **Step 1: Write the failing test**

Create `test/core/dev-server.test.ts`:

```ts
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { resolveDevOrigin } from '../../src/core/dev-server'

const addr = (over: Partial<AddressInfo> = {}): AddressInfo =>
  ({ address: '127.0.0.1', family: 'IPv4', port: 5173, ...over })

describe('resolveDevOrigin', () => {
  it('prefers the explicit override (and trims a trailing slash)', () => {
    expect(resolveDevOrigin(addr(), { override: 'https://assets.test/' })).toBe('https://assets.test')
  })
  it('prefers Vite server.origin when no override', () => {
    expect(resolveDevOrigin(addr(), { serverOrigin: 'http://sf.test:5173' })).toBe('http://sf.test:5173')
  })
  it('assembles http://host:port from the address', () => {
    expect(resolveDevOrigin(addr({ port: 5199 }), {})).toBe('http://127.0.0.1:5199')
  })
  it('uses https when the dev server is https', () => {
    expect(resolveDevOrigin(addr(), { https: true })).toBe('https://127.0.0.1:5173')
  })
  it('brackets an IPv6 address', () => {
    expect(resolveDevOrigin(addr({ address: '::1', family: 'IPv6' }), {})).toBe('http://[::1]:5173')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/core/dev-server.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/dev-server"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/dev-server.ts`:

```ts
import type { AddressInfo } from 'node:net'

export interface DevOriginInput {
  /** Explicit override — our `devServerOrigin` option (mirrors Encore's `--public`). */
  override?: string
  /** Vite's own `server.origin` option. */
  serverOrigin?: string
  /** Whether the dev server is serving over HTTPS. */
  https?: boolean
}

export function resolveDevOrigin(address: AddressInfo, input: DevOriginInput): string {
  if (input.override)
    return input.override.replace(/\/$/, '')
  if (input.serverOrigin)
    return input.serverOrigin.replace(/\/$/, '')

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return `${input.https ? 'https' : 'http'}://${host}:${address.port}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/core/dev-server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/dev-server.ts test/core/dev-server.test.ts
git commit -m "feat(core): resolve the dev-server origin from address + options"
```

---

### Task 4: Dev entry graph from the resolved config

In serve mode there is no bundle, so entries come from Vite's resolved config (`config.build.rollupOptions.input`, a public API field). Each named entry maps to its source path relative to `config.root`; Vite serves that module at `origin + base + path`, so the graph carries the bare relative path and the core prefixes it. Entry type (`js`/`css`) is inferred from the extension.

**Files:**
- Modify: `src/collectors/vite.ts`
- Test: `test/collectors/vite.test.ts`

**Interfaces:**
- Consumes: `NormalizedGraph`, `EntryFiles` (A1); `Rollup` from `vite`.
- Produces: `configToDevGraph(config: DevConfig): NormalizedGraph` and the `DevConfig` type. Adds a `slash` helper.

- [ ] **Step 1: Write the failing test**

Append to `test/collectors/vite.test.ts`:

```ts
import { configToDevGraph } from '../../src/collectors/vite'

describe('configToDevGraph', () => {
  const config = {
    root: '/app',
    build: { rollupOptions: { input: { app: '/app/assets/app.js', theme: '/app/assets/theme.scss' } } },
  }

  it('maps object inputs to bare relative entry files, typed by extension', () => {
    const graph = configToDevGraph(config as any)
    expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] })
    expect(graph.entryPoints.theme).toEqual({ js: [], css: ['assets/theme.scss'], preload: [], dynamic: [] })
    expect(graph.assets).toEqual([])
  })

  it('ignores array/undefined inputs (named entries only)', () => {
    expect(configToDevGraph({ root: '/app', build: { rollupOptions: { input: ['/app/a.js'] } } } as any).entryPoints).toEqual({})
    expect(configToDevGraph({ root: '/app', build: { rollupOptions: {} } } as any).entryPoints).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/collectors/vite.test.ts -t configToDevGraph`
Expected: FAIL — `configToDevGraph` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/collectors/vite.ts` (add the `node:path` import at the top alongside the existing imports):

```ts
import { extname, relative, resolve } from 'node:path'

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.postcss', '.pcss'])

export interface DevConfig {
  root: string
  build: { rollupOptions: { input?: Rollup.InputOption } }
}

function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

export function configToDevGraph(config: DevConfig): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  const input = config.build.rollupOptions.input
  const entries: Record<string, string>
    = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, string> : {}

  for (const [name, inputPath] of Object.entries(entries)) {
    const rel = slash(relative(config.root, resolve(config.root, inputPath)))
    const type: 'js' | 'css' = CSS_EXTS.has(extname(inputPath)) ? 'css' : 'js'
    const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] }
    files[type] = [rel]
    entryPoints[name] = files
  }

  return { entryPoints, assets: [] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/collectors/vite.test.ts`
Expected: PASS (existing `bundleToGraph` tests + the 2 new `configToDevGraph` tests).

- [ ] **Step 5: Commit**

```bash
git add src/collectors/vite.ts test/collectors/vite.test.ts
git commit -m "feat(vite): build the dev entry graph from the resolved config"
```

---

### Task 5: Wire dev mode into the factory + real dev-server integration test

**Files:**
- Modify: `src/index.ts`
- Modify: `src/types.ts` (the `devServerOrigin` option), `src/core/options.ts` (forward it)
- Test: `test/integration/vite-dev.test.ts`

**Interfaces:**
- Consumes: `normalizeOptions`/`resolvePublicPath` (Tasks 1-2), `resolveDevOrigin` (Task 3), `configToDevGraph` (Task 4), `buildEntrypoints` (Task 2).
- Produces: `vite` serve mode writes a dev `entrypoints.json` (+ empty `manifest.json`) into `outputPath`.

- [ ] **Step 1: Add the `devServerOrigin` option**

In `src/types.ts`, inside the `Options` interface (after `manifestKeyPrefix`), add:

```ts
  /**
   * Explicit dev-server origin used in `entrypoints.json` (serve mode),
   * e.g. `http://localhost:5173`. Overrides the auto-detected origin.
   * Useful behind a proxy or when the server binds to `0.0.0.0` (Docker).
   */
  devServerOrigin?: string
```

In `src/types.ts`, add it to `ResolvedOptions`:

```ts
export interface ResolvedOptions {
  outputPath: string
  publicPath: string
  manifestKeyPrefix: string
  devServerOrigin?: string
}
```

In `src/core/options.ts`, forward it in the returned object:

```ts
  return {
    outputPath,
    publicPath,
    manifestKeyPrefix,
    devServerOrigin: options?.devServerOrigin,
  }
```

- [ ] **Step 2: Write the failing integration test**

Create `test/integration/vite-dev.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Symfony from '../../src/vite'

const fixture = join(import.meta.dirname, '../fixtures/basic')

describe('vite serve writes a dev entrypoints.json', () => {
  let server: Awaited<ReturnType<typeof createServer>>
  let out: string

  beforeEach(async () => {
    out = mkdtempSync(join(tmpdir(), 'ups-dev-'))
    server = await createServer({
      root: fixture,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      build: { rollupOptions: { input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } } },
      plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
    })
    await server.listen()
  })

  afterEach(async () => {
    await server.close()
  })

  it('points entries at the dev-server origin and marks the mode', () => {
    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))

    expect(entry.isProd).toBe(false)
    expect(entry.publicPath).toBe('/build/')
    expect(entry.devServer.client).toBe('vite')
    expect(entry.devServer.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const origin = entry.devServer.origin
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js).toEqual([`${origin}/build/app.js`])
    expect(entry.entryPoints.app.css).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/integration/vite-dev.test.ts`
Expected: FAIL — `entrypoints.json` does not exist in `out` (the factory has no `configureServer` yet), so `readFileSync` throws `ENOENT`.

- [ ] **Step 4: Wire `configureServer` (the build path already has `base`)**

In `src/index.ts`, add the imports and the `configureServer` hook. The full file becomes:

```ts
import type { AddressInfo } from 'node:net'
import type { UnpluginFactory } from 'unplugin'
import type { BuildContext, Options } from './types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { bundleToGraph, configToDevGraph } from './collectors/vite'
import { resolveDevOrigin } from './core/dev-server'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())

  function writeDevFiles(entrypoints: unknown): void {
    mkdirSync(resolved.outputPath, { recursive: true })
    writeFileSync(join(resolved.outputPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`)
    writeFileSync(join(resolved.outputPath, 'manifest.json'), '{}\n')
  }

  return {
    name: 'unplugin-symfony',

    vite: {
      config: () => ({
        base: resolved.publicPath,
        build: {
          outDir: resolved.outputPath,
          copyPublicDir: false,
          manifest: false,
          assetsDir: '.',
        },
      }),

      generateBundle(_outputOptions, bundle) {
        const graph = bundleToGraph(bundle)
        const ctx: BuildContext = {
          isProd: true,
          devServer: null,
          publicPath: resolved.publicPath,
          urlPrefix: resolved.publicPath,
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
        this.emitFile({ type: 'asset', fileName: 'entrypoints.json', source: `${JSON.stringify(buildEntrypoints(graph, ctx), null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(buildManifest(graph, ctx), null, 2)}\n` })
      },

      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const address = server.httpServer?.address()
          if (!address || typeof address === 'string')
            return

          const origin = resolveDevOrigin(address as AddressInfo, {
            override: resolved.devServerOrigin,
            serverOrigin: server.config.server.origin,
            https: Boolean(server.config.server.https),
          })
          server.config.server.origin = origin // keep Vite's internal URL rewriting in sync

          const ctx: BuildContext = {
            isProd: false,
            devServer: { origin, client: 'vite' },
            publicPath: resolved.publicPath,
            urlPrefix: resolvePublicPath(resolved.publicPath, origin),
            manifestKeyPrefix: resolved.manifestKeyPrefix,
          }
          writeDevFiles(buildEntrypoints(configToDevGraph(server.config), ctx))
        })
      },
    },

    rspack(compiler) {
      compiler.options.output.path = resolved.outputPath
      compiler.options.output.publicPath = resolved.publicPath
    },
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/integration/vite-dev.test.ts`
Expected: PASS (`entrypoints.json` written with `isProd:false`, the origin, and absolute entry URLs).

- [ ] **Step 6: Full suite + lint + build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all green. Run `CI=true pnpm lint --fix` if import ordering is flagged, and fold it into the commit.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/types.ts src/core/options.ts test/integration/vite-dev.test.ts
git commit -m "feat(vite): write dev entrypoints.json from the running dev server"
```

---

## Self-Review

**1. Spec coverage (A2 = dev-server/HMR):**
- Serve-mode dev file written at the dev origin → Task 5 (`configureServer`→`listening`). ✔
- Dev-origin resolution (override → Vite `server.origin` → assembled from address) → Task 3, from Vite's API + our own option. ✔
- `base = publicPath` so runtime URLs resolve (the flagged A1 bug) → Task 1. ✔
- Absolute dev entry URLs + original `publicPath` field → Tasks 2 + 5. ✔
- `devServer.client:'vite'` so the PHP bundle injects `@vite/client`/preamble → Task 5 (JS side does not inject — matches the design). ✔
- `devServerOrigin` option for proxy/Docker → Task 5. ✔
- Real dev-server integration test → Task 5. ✔
- Out of A2 scope, tracked for later: Rspack (A3), Stimulus (B1), SRI/shared-runtime/CDN-finalize (polish). The `isProd`-from-mode note is handled (dev sets `isProd:false`); transitive-preload stays an A3/polish item (dev has no preload).

**2. Independence check (no copied third-party code):** the dev-origin resolver (Task 3) is assembled from `node:net` `AddressInfo` + our own option precedence, anchored on Encore's `--public`/`getRealPublicPath` semantics; the entry graph (Task 4) reads Vite's public `config.build.rollupOptions.input`; the `base`/URL formation (Tasks 1-2) follows Vite's documented `origin + base + path` behavior. None of it lifts `vite-plugin-symfony`'s code — those clones are background only. ✔

**3. Placeholder scan:** No TBD/TODO. Every code step shows complete code; every test step has real assertions. ✔

**4. Type consistency:** `BuildContext` gains `urlPrefix` in Task 2 and every `ctx` literal (Tasks 2, 5) includes it. `resolvePublicPath(publicPath, devOrigin)` (Task 2) is called in Task 5. `resolveDevOrigin(address, input)` (Task 3) is called in Task 5 with `{ override, serverOrigin, https }`. `configToDevGraph(config)` (Task 4) is called in Task 5 with `server.config`. `ResolvedOptions.devServerOrigin` (Task 5) is consumed as the resolver `override`. Names are consistent. ✔
