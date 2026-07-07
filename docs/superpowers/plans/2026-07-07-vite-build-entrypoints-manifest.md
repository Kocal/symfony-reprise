# Vite build-mode: entrypoints.json + manifest.json — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vite build` emit our own-format `entrypoints.json` and a flat `manifest.json` into `outputPath`, generated from the real Rollup bundle.

**Architecture:** A pure, bundler-agnostic `core/` (options normalization + format serialization) plus a pure Vite `collector` that turns the Rollup `OutputBundle` into a normalized graph. `src/index.ts` (the factory) wires them into Vite's `generateBundle` hook and writes the two files via `this.emitFile`. No logic lives in the per-bundler adapter files.

**Tech Stack:** TypeScript (ESM, strict, ES2017), unplugin 2, Vite 6 / Rollup 4, vitest 3, tsdown.

**Reference:** `docs/superpowers/specs/2026-07-07-unplugin-symfony-roadmap-design.md` (this is milestone A1 of that roadmap).

## Global Constraints

- ESM only; strict TypeScript; ES2017 target; use the `node:` prefix for Node builtins.
- unplugin factory pattern: all logic in `index.ts` + `core/` + `collectors/`; `src/vite.ts`/`src/rspack.ts` stay one-line adapters.
- Format v1 is frozen by this plan (contract with the future PHP bundle). `entrypoints.json` top-level keys: `isProd`, `devServer`, `publicPath`, `entryPoints`. Per-entry keys: `js`, `css`, `preload`, `dynamic`.
- `manifest.json` is a flat map with **logical keys** (`manifestKeyPrefix` + logical name), compatible with Symfony's `JsonManifestVersionStrategy`.
- When `publicPath` is absolute (contains `://`) and `manifestKeyPrefix` is not set, throw (do not silently use the URL as key prefix).
- Node 22; package manager pnpm; run commands with `CI=true` prefix in this environment (pnpm purges/reinstalls without a TTY otherwise).
- Automated tests use `test/fixtures/`, never the `playground/` Symfony app.

## File Structure

- `src/types.ts` — **modify.** Public + internal types: `Options` (existing), `ResolvedOptions`, `EntryFiles`, `DevServer`, `AssetEntry`, `NormalizedGraph`, `BuildContext`, `EntrypointsJson`, `ManifestJson`. Replaces the old Encore-shaped `Entrypoint`/`EntrypointsJson`.
- `src/core/options.ts` — **create.** `normalizeOptions(options, cwd) -> ResolvedOptions` with the CDN guard.
- `src/core/format.ts` — **create.** `buildEntrypoints(graph, ctx) -> EntrypointsJson`; `buildManifest(graph, ctx) -> ManifestJson`.
- `src/collectors/vite.ts` — **create.** `bundleToGraph(bundle) -> NormalizedGraph` (pure).
- `src/index.ts` — **modify.** Use `normalizeOptions`; add the Vite `generateBundle` hook that calls the collector + core and emits the two files; drop the `console.log` stubs.
- `test/core/options.test.ts`, `test/core/format.test.ts`, `test/collectors/vite.test.ts`, `test/integration/vite-build.test.ts` — **create.**
- `test/fixtures/basic/{app.js,admin.js,shared.js,lazy.js,style.css}` — **create** (integration fixture).

---

### Task 1: Types + options normalization

**Files:**
- Modify: `src/types.ts`
- Create: `src/core/options.ts`
- Test: `test/core/options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types in `src/types.ts` (see Step 3) used by every later task.
  - `normalizeOptions(options: Options | undefined, cwd: string): ResolvedOptions`.

- [ ] **Step 1: Write the failing test**

Create `test/core/options.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeOptions } from '../../src/core/options'

describe('normalizeOptions', () => {
  it('resolves a relative outputPath against cwd', () => {
    const r = normalizeOptions({ outputPath: 'public/build' }, '/app')
    expect(r.outputPath).toBe('/app/public/build')
  })

  it('keeps an absolute outputPath as-is', () => {
    const r = normalizeOptions({ outputPath: '/tmp/out' }, '/app')
    expect(r.outputPath).toBe('/tmp/out')
  })

  it('applies defaults (outputPath, publicPath)', () => {
    const r = normalizeOptions(undefined, '/app')
    expect(r.outputPath).toBe('/app/public/build')
    expect(r.publicPath).toBe('/build/')
  })

  it('derives manifestKeyPrefix from publicPath by stripping the leading slash', () => {
    const r = normalizeOptions({ publicPath: '/build/' }, '/app')
    expect(r.manifestKeyPrefix).toBe('build/')
  })

  it('honors an explicit manifestKeyPrefix', () => {
    const r = normalizeOptions({ publicPath: '/assets/', manifestKeyPrefix: 'build/' }, '/app')
    expect(r.manifestKeyPrefix).toBe('build/')
  })

  it('throws for an absolute publicPath without manifestKeyPrefix', () => {
    expect(() => normalizeOptions({ publicPath: 'https://cdn.example.com/x' }, '/app'))
      .toThrow(/manifestKeyPrefix/)
  })

  it('accepts an absolute publicPath when manifestKeyPrefix is set', () => {
    const r = normalizeOptions({ publicPath: 'https://cdn.example.com/x', manifestKeyPrefix: 'build/' }, '/app')
    expect(r.publicPath).toBe('https://cdn.example.com/x')
    expect(r.manifestKeyPrefix).toBe('build/')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/core/options.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/options"` / `normalizeOptions is not a function`.

- [ ] **Step 3: Add the types**

Replace the type section at the bottom of `src/types.ts` (everything from `export type EntrypointName` onward) with:

```ts
export interface ResolvedOptions {
  outputPath: string
  publicPath: string
  manifestKeyPrefix: string
}

export interface EntryFiles {
  js: string[]
  css: string[]
  preload: string[]
  dynamic: string[]
}

export interface DevServer {
  origin: string
  client: 'vite' | null
}

export interface AssetEntry {
  logicalName: string
  fileName: string
}

export interface NormalizedGraph {
  entryPoints: Record<string, EntryFiles>
  assets: AssetEntry[]
}

export interface BuildContext {
  isProd: boolean
  devServer: DevServer | null
  /** URL prefix for entrypoint/manifest asset URLs (the configured publicPath in build mode). */
  publicPath: string
  /** Logical key prefix for manifest.json keys (publicPath minus leading slash, by default). */
  manifestKeyPrefix: string
}

export interface EntrypointsJson {
  isProd: boolean
  devServer: DevServer | null
  publicPath: string
  entryPoints: Record<string, EntryFiles>
}

export type ManifestJson = Record<string, string>
```

Keep the existing `Options` interface and its JSDoc unchanged above this block.

- [ ] **Step 4: Write the implementation**

Create `src/core/options.ts`:

```ts
import type { Options, ResolvedOptions } from '../types'
import * as path from 'node:path'

export function normalizeOptions(options: Options | undefined, cwd: string): ResolvedOptions {
  let outputPath = options?.outputPath ?? 'public/build'
  outputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath)

  const publicPath = options?.publicPath ?? '/build/'

  let manifestKeyPrefix = options?.manifestKeyPrefix ?? null
  if (manifestKeyPrefix === null) {
    if (publicPath.includes('://')) {
      throw new Error(
        `unplugin-symfony: cannot derive "manifestKeyPrefix" from an absolute "publicPath" (${publicPath}). `
        + 'Set "manifestKeyPrefix" explicitly (e.g. "build/").',
      )
    }
    manifestKeyPrefix = publicPath.replace(/^\//, '')
  }

  return { outputPath, publicPath, manifestKeyPrefix }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/core/options.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/core/options.ts test/core/options.test.ts
git commit -m "feat(core): add options normalization with CDN guard"
```

---

### Task 2: Serialize entrypoints.json

**Files:**
- Create: `src/core/format.ts`
- Test: `test/core/format.test.ts`

**Interfaces:**
- Consumes: `NormalizedGraph`, `BuildContext`, `EntrypointsJson` from `src/types.ts`.
- Produces: `buildEntrypoints(graph: NormalizedGraph, ctx: BuildContext): EntrypointsJson`.

- [ ] **Step 1: Write the failing test**

Create `test/core/format.test.ts`:

```ts
import type { BuildContext, NormalizedGraph } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { buildEntrypoints } from '../../src/core/format'

const ctx: BuildContext = {
  isProd: true,
  devServer: null,
  publicPath: '/build/',
  manifestKeyPrefix: 'build/',
}

const graph: NormalizedGraph = {
  entryPoints: {
    app: { js: ['app-a1b2.js'], css: ['app-c3d4.css'], preload: ['vendor-e5f6.js'], dynamic: ['lazy-x.js'] },
    admin: { js: ['admin-99.js'], css: [], preload: [], dynamic: [] },
  },
  assets: [],
}

describe('buildEntrypoints', () => {
  it('prefixes every asset list with publicPath', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.entryPoints.app).toEqual({
      js: ['/build/app-a1b2.js'],
      css: ['/build/app-c3d4.css'],
      preload: ['/build/vendor-e5f6.js'],
      dynamic: ['/build/lazy-x.js'],
    })
  })

  it('carries the mode/devServer/publicPath fields', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.isProd).toBe(true)
    expect(out.devServer).toBeNull()
    expect(out.publicPath).toBe('/build/')
  })

  it('keeps empty arrays for entries without css/preload/dynamic', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.entryPoints.admin).toEqual({ js: ['/build/admin-99.js'], css: [], preload: [], dynamic: [] })
  })

  it('inserts a slash when publicPath has no trailing slash', () => {
    const out = buildEntrypoints(graph, { ...ctx, publicPath: '/build' })
    expect(out.entryPoints.app.js).toEqual(['/build/app-a1b2.js'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/core/format.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/format"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/format.ts`:

```ts
import type { BuildContext, EntryFiles, EntrypointsJson, NormalizedGraph } from '../types'

function joinUrl(prefix: string, name: string): string {
  return prefix.endsWith('/') ? prefix + name : `${prefix}/${name}`
}

export function buildEntrypoints(graph: NormalizedGraph, ctx: BuildContext): EntrypointsJson {
  const entryPoints: Record<string, EntryFiles> = {}
  for (const [name, files] of Object.entries(graph.entryPoints)) {
    entryPoints[name] = {
      js: files.js.map(f => joinUrl(ctx.publicPath, f)),
      css: files.css.map(f => joinUrl(ctx.publicPath, f)),
      preload: files.preload.map(f => joinUrl(ctx.publicPath, f)),
      dynamic: files.dynamic.map(f => joinUrl(ctx.publicPath, f)),
    }
  }
  return { isProd: ctx.isProd, devServer: ctx.devServer, publicPath: ctx.publicPath, entryPoints }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/core/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/format.ts test/core/format.test.ts
git commit -m "feat(core): serialize entrypoints.json"
```

---

### Task 3: Serialize manifest.json

**Files:**
- Modify: `src/core/format.ts`
- Test: `test/core/format.test.ts` (add cases)

**Interfaces:**
- Consumes: `NormalizedGraph`, `BuildContext`, `ManifestJson`, plus `joinUrl` (already in `format.ts`).
- Produces: `buildManifest(graph: NormalizedGraph, ctx: BuildContext): ManifestJson`.

- [ ] **Step 1: Write the failing test**

Append to `test/core/format.test.ts`:

```ts
import { buildManifest } from '../../src/core/format'

describe('buildManifest', () => {
  it('maps logical keys (prefixed) to public URLs, sorted', () => {
    const g: NormalizedGraph = {
      entryPoints: {},
      assets: [
        { logicalName: 'app.js', fileName: 'app-a1b2.js' },
        { logicalName: 'app.css', fileName: 'app-c3d4.css' },
        { logicalName: 'images/logo.png', fileName: 'logo-77.png' },
      ],
    }
    expect(buildManifest(g, ctx)).toEqual({
      'build/app.css': '/build/app-c3d4.css',
      'build/app.js': '/build/app-a1b2.js',
      'build/images/logo.png': '/build/logo-77.png',
    })
  })

  it('returns an empty object for no assets', () => {
    expect(buildManifest({ entryPoints: {}, assets: [] }, ctx)).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/core/format.test.ts`
Expected: FAIL — `buildManifest is not a function` (import resolves; export missing).

- [ ] **Step 3: Write the implementation**

Append to `src/core/format.ts`:

```ts
import type { ManifestJson } from '../types'

export function buildManifest(graph: NormalizedGraph, ctx: BuildContext): ManifestJson {
  const manifest: ManifestJson = {}
  for (const { logicalName, fileName } of graph.assets) {
    manifest[ctx.manifestKeyPrefix + logicalName] = joinUrl(ctx.publicPath, fileName)
  }
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
}
```

(Merge the two `import type` lines from the same module if your linter prefers a single import; `pnpm lint --fix` will do this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/core/format.test.ts`
Expected: PASS (6 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/core/format.ts test/core/format.test.ts
git commit -m "feat(core): serialize manifest.json"
```

---

### Task 4: Vite bundle → normalized graph

**Files:**
- Create: `src/collectors/vite.ts`
- Test: `test/collectors/vite.test.ts`

**Interfaces:**
- Consumes: `NormalizedGraph`, `EntryFiles`, `AssetEntry` from `src/types.ts`; `Rollup` types from `vite`.
- Produces: `bundleToGraph(bundle: Rollup.OutputBundle): NormalizedGraph`.

- [ ] **Step 1: Write the failing test**

Create `test/collectors/vite.test.ts`. The test builds a minimal fake bundle shaped like Rollup's `OutputBundle` and casts it, so we do not depend on a real build here:

```ts
import type { Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import { bundleToGraph } from '../../src/collectors/vite'

function chunk(partial: Partial<Rollup.OutputChunk> & { fileName: string, name: string, isEntry: boolean }): any {
  return {
    type: 'chunk',
    imports: [],
    dynamicImports: [],
    ...partial,
  }
}

function asset(fileName: string, names: string[]): any {
  return { type: 'asset', fileName, names, originalFileNames: [], source: '' }
}

describe('bundleToGraph', () => {
  it('extracts entry js, css, preload and dynamic from entry chunks', () => {
    const bundle = {
      'app-a1b2.js': {
        ...chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true, imports: ['vendor-e5.js'], dynamicImports: ['lazy-x.js'] }),
        viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
      },
      'admin-99.js': chunk({ fileName: 'admin-99.js', name: 'admin', isEntry: true }),
      'vendor-e5.js': chunk({ fileName: 'vendor-e5.js', name: 'vendor', isEntry: false }),
      'app-c3.css': asset('app-c3.css', ['app.css']),
    } as unknown as Rollup.OutputBundle

    const graph = bundleToGraph(bundle)

    expect(graph.entryPoints.app).toEqual({
      js: ['app-a1b2.js'],
      css: ['app-c3.css'],
      preload: ['vendor-e5.js'],
      dynamic: ['lazy-x.js'],
    })
    expect(graph.entryPoints.admin).toEqual({ js: ['admin-99.js'], css: [], preload: [], dynamic: [] })
    expect(graph.entryPoints.vendor).toBeUndefined()
  })

  it('collects manifest assets: entry chunks by "<name>.js" and assets by names[0]', () => {
    const bundle = {
      'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
      'app-c3.css': asset('app-c3.css', ['app.css']),
    } as unknown as Rollup.OutputBundle

    const graph = bundleToGraph(bundle)

    expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app-a1b2.js' })
    expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/collectors/vite.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/collectors/vite"`.

- [ ] **Step 3: Write the implementation**

Create `src/collectors/vite.ts`:

```ts
import type { Rollup } from 'vite'
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types'

interface ViteChunkMetadata {
  importedAssets: Set<string>
  importedCss: Set<string>
}
type ViteOutputChunk = Rollup.OutputChunk & { viteMetadata?: ViteChunkMetadata }

export function bundleToGraph(bundle: Rollup.OutputBundle): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  const assets: AssetEntry[] = []

  for (const file of Object.values(bundle)) {
    if (file.type === 'chunk') {
      if (file.isEntry) {
        const chunk = file as ViteOutputChunk
        entryPoints[chunk.name] = {
          js: [chunk.fileName],
          css: chunk.viteMetadata ? [...chunk.viteMetadata.importedCss] : [],
          preload: [...chunk.imports],
          dynamic: [...chunk.dynamicImports],
        }
        assets.push({ logicalName: `${chunk.name}.js`, fileName: chunk.fileName })
      }
    }
    else {
      assets.push({ logicalName: file.names[0] ?? file.fileName, fileName: file.fileName })
    }
  }

  return { entryPoints, assets }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/collectors/vite.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/collectors/vite.ts test/collectors/vite.test.ts
git commit -m "feat(vite): map rollup bundle to normalized graph"
```

---

### Task 5: Wire the factory + integration test on a real build

**Files:**
- Modify: `src/index.ts`
- Create: `test/fixtures/basic/{app.js,admin.js,shared.js,lazy.js,style.css}`
- Test: `test/integration/vite-build.test.ts`

**Interfaces:**
- Consumes: `normalizeOptions` (Task 1), `buildEntrypoints`/`buildManifest` (Tasks 2-3), `bundleToGraph` (Task 4), `BuildContext` type.
- Produces: `vite build` writes `entrypoints.json` and `manifest.json` into `outputPath`.

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/basic/shared.js`:

```js
export const hi = 'hi'
```

Create `test/fixtures/basic/lazy.js`:

```js
export const lazy = 42
```

Create `test/fixtures/basic/style.css`:

```css
body { color: red; }
```

Create `test/fixtures/basic/app.js`:

```js
import { hi } from './shared.js'
import './style.css'

console.log(hi)
import('./lazy.js').then(m => console.log(m.lazy))
```

Create `test/fixtures/basic/admin.js`:

```js
import { hi } from './shared.js'

console.log('admin', hi)
```

- [ ] **Step 2: Write the failing integration test**

Create `test/integration/vite-build.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/vite'

const fixture = join(import.meta.dirname, '../fixtures/basic')

async function runBuild(): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'ups-'))
  await build({
    root: fixture,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
      },
    },
    plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
  })
  return out
}

describe('vite build emits Symfony files', () => {
  it('writes a valid entrypoints.json', async () => {
    const out = await runBuild()
    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))

    expect(entry.isProd).toBe(true)
    expect(entry.devServer).toBeNull()
    expect(entry.publicPath).toBe('/build/')
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js).toHaveLength(1)
    expect(entry.entryPoints.app.js[0]).toMatch(/^\/build\/app-.*\.js$/)
    expect(entry.entryPoints.app.css[0]).toMatch(/^\/build\/.*\.css$/)
    expect(entry.entryPoints.app.dynamic[0]).toMatch(/^\/build\/.*\.js$/)
  }, 30_000)

  it('writes a flat manifest.json with logical keys and public URLs', async () => {
    const out = await runBuild()
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))

    expect(manifest['build/app.js']).toMatch(/^\/build\/app-.*\.js$/)
    expect(manifest['build/admin.js']).toMatch(/^\/build\/admin-.*\.js$/)
    for (const value of Object.values(manifest)) {
      expect(value).toMatch(/^\/build\//)
    }
  }, 30_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/integration/vite-build.test.ts`
Expected: FAIL — the file `entrypoints.json` does not exist (the current `index.ts` still has `console.log` stubs and emits nothing), so `readFileSync` throws `ENOENT`.

- [ ] **Step 4: Rewire the factory**

Replace the entire contents of `src/index.ts` with:

```ts
import type { UnpluginFactory } from 'unplugin'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { bundleToGraph } from './collectors/vite'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions } from './core/options'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

    vite: {
      config: () => ({
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
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
        const entrypoints = buildEntrypoints(graph, ctx)
        const manifest = buildManifest(graph, ctx)
        this.emitFile({ type: 'asset', fileName: 'entrypoints.json', source: `${JSON.stringify(entrypoints, null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(manifest, null, 2)}\n` })
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

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `CI=true pnpm vitest run test/integration/vite-build.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite, lint, and build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all tests pass, `ESLint: No issues found`, `Build complete`. If lint flags import grouping in `format.ts` or `index.ts`, run `CI=true pnpm lint --fix` and re-run, then include the change in the commit below.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/fixtures/basic test/integration/vite-build.test.ts
git commit -m "feat(vite): emit entrypoints.json + manifest.json on build"
```

---

## Self-Review

**1. Spec coverage (A1 slice of the roadmap spec):**
- Core `options.ts` (normalize + CDN guard + `resolvePublicPath` seed) → Task 1. `resolvePublicPath` is intentionally deferred to A2 (dev needs it); A1 uses `ctx.publicPath` directly. ✔ (noted deviation, not a gap)
- Core `format.ts` (`buildEntrypoints` + `buildManifest`, our format, logical manifest keys) → Tasks 2-3. ✔
- `collectors/vite.ts` (`bundleToGraph`) → Task 4. ✔
- Factory writes both files in build mode → Task 5. ✔
- Freeze format v1 as a shared TS type → `EntrypointsJson` in `src/types.ts`, Task 1. ✔
- Testing layers: Layer 1 (core pure) → Tasks 1-3; Layer 2 (collector extractor pure) → Task 4; Layer 3 (real vite build, hash-normalized/structural) → Task 5. Layer 4 (dev smoke) and cross-bundler parity are out of A1 scope (A2/A3). ✔
- Out of A1 scope, tracked elsewhere: Vite dev/HMR (A2), Rspack (A3), Stimulus (B1), SRI/CDN-finalize/shared-runtime (polish). ✔

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code; every test step shows real assertions. ✔

**3. Type consistency:** `normalizeOptions -> ResolvedOptions` (Task 1) feeds `BuildContext` construction (Task 5). `BuildContext` fields (`isProd`, `devServer`, `publicPath`, `manifestKeyPrefix`) are consumed identically in `buildEntrypoints`/`buildManifest` (Tasks 2-3). `NormalizedGraph`/`EntryFiles`/`AssetEntry` produced by `bundleToGraph` (Task 4) match what the core consumes (Tasks 2-3). `EntrypointsJson`/`ManifestJson` are the emitted shapes (Task 5). Names are consistent across tasks. ✔

## Notes carried to the next plan (A2 — Vite dev/HMR)

- Introduce `resolvePublicPath(mode, opts, devOrigin)` in `core/options.ts` (port of Encore `getRealPublicPath`) and set `ctx.publicPath` to the dev-server-prefixed value in serve mode.
- Add the Vite dev collector path: `configResolved` (detect `command === 'serve'`) + `configureServer`/listen to compute `devOrigin`, write a dev `entrypoints.json` with `devServer: { origin, client: 'vite' }` and `isProd: false`.
- Manifest keys stay logical even in dev (already the case; `manifestKeyPrefix` is independent of the URL prefix).
