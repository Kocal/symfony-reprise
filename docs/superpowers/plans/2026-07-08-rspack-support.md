# Rspack support (build + dev) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Symfony `entrypoints.json` + `manifest.json` from a Rspack compilation, for both `rspack build` and `rsbuild dev`, reusing the pure core built for Vite.

**Architecture:** A new pure collector `statsToGraph(stats)` turns the Rspack stats JSON into the existing `NormalizedGraph`. The `rspack(compiler)` factory hook drives Rspack's `output` for build only (mode-gated), then taps `compiler.hooks.done` to collect the stats and write both JSON files via `node:fs` — one hook serves build and dev (Rspack runs a real compilation in both). Dev is detected via `compiler.watchMode`; the dev-server origin is read from `output.publicPath` (Rsbuild resolves it from `dev.assetPrefix`); the HMR client is baked into the entry chunk, so `devServer.client` is `null`.

**Tech Stack:** TypeScript (ESM, strict, ES2017), unplugin 2, `@rspack/core` ~2.1.3, `@rsbuild/core` ^2.1.5, vitest 4, tsdown.

**Sources (derive from these — do NOT copy any third-party plugin):**
- **Rspack/Rsbuild public API** (the platform): `Compiler.hooks.done` (-> `Stats`), `Stats.toJson({ assets, entrypoints })`, `compiler.watchMode`, `compiler.options.mode`/`output`. Rsbuild resolves the dev origin into `output.publicPath` before the Compiler is created (from `dev.assetPrefix`).
- **Encore's webpack entry-points plugin** (`../webpack-encore/lib/webpack/entry-points-plugin.ts`, our own lineage — Rspack is webpack-API-compatible): taps `afterEmit`, reads `stats.toJson({ assets: true })`, iterates `stats.entrypoints[name].assets`, groups by file extension, skips `.hot-update.` files, writes with `fs.writeFileSync`. This is the portable pattern.
- `.references/*` clones are for understanding only. No third-party plugin code is copied.

**Reference (our own):** design spec `docs/superpowers/specs/2026-07-07-unplugin-symfony-roadmap-design.md` (milestone A3); the shipped A1/A2 `src/core`, `src/collectors/vite.ts`, `src/index.ts`.

## Global Constraints

- ESM only; strict TypeScript; ES2017 target; `node:` prefix for Node builtins.
- unplugin factory pattern: logic in `index.ts` + `core/` + `collectors/`; `src/vite.ts`/`src/rspack.ts` stay one-line adapters.
- Format v1: `entrypoints.json` top-level keys `isProd`, `devServer`, `publicPath`, `entryPoints`; per-entry `js`, `css`, `preload`, `dynamic`. Build URLs from `ctx.urlPrefix`, emit `ctx.publicPath`.
- For Rspack, `devServer.client` is `null` (the HMR client is compiled into the entry chunk — no separate script). No `src/types.ts` change (the `'vite' | null` union already covers it).
- Skip files containing `.hot-update.` (a Rspack/webpack-dev-server artifact).
- Write both JSON files via `node:fs` for build AND dev — Rsbuild dev output is memory-only (`dev.writeToDisk` defaults to `false`), so `compilation.emitAsset` would not produce a real file. Encore writes with `fs` too.
- Reuse A1/A2's pure core (`buildEntrypoints`/`buildManifest`/`normalizeOptions`) and `NormalizedGraph`/`EntryFiles`/`AssetEntry`/`BuildContext` types unchanged.
- Node 22; pnpm; run commands with `CI=true` prefix.
- Automated tests use `test/fixtures/`, never `playground/`.

## File Structure

- `src/collectors/rspack.ts` — **create.** `statsToGraph(stats)` + the `RspackStats` shape.
- `src/index.ts` — **modify.** Generalize the file writer (`writeDevFiles` -> `writeFiles(entrypoints, manifest)`); replace the `rspack(compiler)` stub with the mode-gated output override + `done` hook.
- `package.json` — **modify.** Add `@rspack/core` + `@rsbuild/core` root devDependencies (for integration tests).
- Tests: `test/collectors/rspack.test.ts` (create), `test/integration/rspack-build.test.ts` (create), `test/integration/rspack-dev.test.ts` (create).

---

### Task 1: Rspack collector — statsToGraph

**Files:**
- Create: `src/collectors/rspack.ts`
- Test: `test/collectors/rspack.test.ts`

**Interfaces:**
- Consumes: `NormalizedGraph`, `EntryFiles`, `AssetEntry` from `src/types.ts`.
- Produces: `statsToGraph(stats: RspackStats): NormalizedGraph` and the exported `RspackStats` shape.

- [ ] **Step 1: Write the failing test**

Create `test/collectors/rspack.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { statsToGraph } from '../../src/collectors/rspack'

describe('statsToGraph', () => {
  it('extracts js/css per entry and skips hot-update files', () => {
    const graph = statsToGraph({
      entrypoints: {
        app: { assets: [{ name: 'runtime.js' }, { name: 'app.a1.js' }, { name: 'app.b2.css' }, { name: 'app.c3.hot-update.js' }] },
        admin: { assets: [{ name: 'admin.d4.js' }] },
      },
    })
    expect(graph.entryPoints.app).toEqual({ js: ['runtime.js', 'app.a1.js'], css: ['app.b2.css'], preload: [], dynamic: [] })
    expect(graph.entryPoints.admin).toEqual({ js: ['admin.d4.js'], css: [], preload: [], dynamic: [] })
  })

  it('builds manifest assets from assetsByChunkName and sourceFilename', () => {
    const graph = statsToGraph({
      entrypoints: {},
      assetsByChunkName: { app: ['app.a1.js', 'app.b2.css'] },
      assets: [{ name: 'logo.e5.svg', info: { sourceFilename: 'images/logo.svg' } }],
    })
    expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app.a1.js' })
    expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app.b2.css' })
    expect(graph.assets).toContainEqual({ logicalName: 'images/logo.svg', fileName: 'logo.e5.svg' })
  })

  it('tolerates empty/absent stats sections', () => {
    expect(statsToGraph({})).toEqual({ entryPoints: {}, assets: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/collectors/rspack.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/collectors/rspack"`.

- [ ] **Step 3: Write the implementation**

Create `src/collectors/rspack.ts`:

```ts
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types'
import { extname } from 'node:path'

/** Minimal subset of the Rspack/webpack stats JSON (from `compilation.getStats().toJson(...)`). */
export interface RspackStats {
  entrypoints?: Record<string, { assets?: { name: string }[] }>
  assetsByChunkName?: Record<string, string[]>
  assets?: { name: string, info?: { sourceFilename?: string } }[]
}

function fileExt(name: string): string {
  return extname(name).slice(1).split('?')[0] ?? ''
}

function isHotUpdate(name: string): boolean {
  return name.includes('.hot-update.')
}

export function statsToGraph(stats: RspackStats): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
    const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] }
    for (const asset of entry.assets ?? []) {
      if (isHotUpdate(asset.name))
        continue
      const ext = fileExt(asset.name)
      if (ext === 'js')
        files.js.push(asset.name)
      else if (ext === 'css')
        files.css.push(asset.name)
    }
    entryPoints[name] = files
  }

  const assets: AssetEntry[] = []
  for (const [chunkName, files] of Object.entries(stats.assetsByChunkName ?? {})) {
    for (const fileName of files) {
      if (isHotUpdate(fileName))
        continue
      assets.push({ logicalName: `${chunkName}.${fileExt(fileName)}`, fileName })
    }
  }
  for (const asset of stats.assets ?? []) {
    const logical = asset.info?.sourceFilename
    if (logical && !isHotUpdate(asset.name))
      assets.push({ logicalName: logical, fileName: asset.name })
  }

  return { entryPoints, assets }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm vitest run test/collectors/rspack.test.ts && CI=true pnpm lint`
Expected: PASS (3 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/rspack.ts test/collectors/rspack.test.ts
git commit -m "feat(rspack): map compilation stats to the normalized graph"
```

---

### Task 2: Generalize the file writer

The dev writer currently hardcodes an empty `manifest.json`. Rspack needs a real one, so make one `writeFiles(entrypoints, manifest)` helper used by both the Vite dev path and (next task) Rspack.

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `EntrypointsJson`, `ManifestJson` from `./types`.
- Produces: `writeFiles(entrypoints: EntrypointsJson, manifest: ManifestJson): void` (replaces `writeDevFiles`).

- [ ] **Step 1: Replace the helper**

In `src/index.ts`, add `ManifestJson` to the type import on line 2:

```ts
import type { BuildContext, EntrypointsJson, ManifestJson, Options } from './types'
```

Replace the `writeDevFiles` function (currently lines 15-19) with:

```ts
  function writeFiles(entrypoints: EntrypointsJson, manifest: ManifestJson): void {
    mkdirSync(resolved.outputPath, { recursive: true })
    writeFileSync(join(resolved.outputPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`)
    writeFileSync(join(resolved.outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
```

- [ ] **Step 2: Update the Vite dev call site**

In the Vite `configureServer` handler, change the write call (currently `writeDevFiles(buildEntrypoints(configToDevGraph(server.config), ctx))`) to pass an empty manifest:

```ts
          try {
            writeFiles(buildEntrypoints(configToDevGraph(server.config), ctx), {})
          }
```

- [ ] **Step 3: Run the Vite tests + lint to verify nothing regressed**

Run: `CI=true pnpm vitest run test/integration/vite-dev.test.ts && CI=true pnpm lint`
Expected: PASS — `writeFiles(..., {})` writes `manifest.json` as `{}\n`, identical to before, so the Vite dev integration test still passes; lint clean.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor(core): generalize the dev writer to writeFiles(entrypoints, manifest)"
```

---

### Task 3: Wire the Rspack hook + build integration test

**Files:**
- Modify: `src/index.ts` (the `rspack(compiler)` hook)
- Modify: `package.json` (add `@rspack/core` devDependency)
- Test: `test/integration/rspack-build.test.ts`

**Interfaces:**
- Consumes: `statsToGraph`/`RspackStats` (Task 1), `writeFiles` (Task 2), `buildEntrypoints`/`buildManifest`, `normalizeOptions`, `BuildContext`.
- Produces: `rspack build` writes `entrypoints.json` + `manifest.json` into `outputPath`.

- [ ] **Step 1: Add `@rspack/core` as a root devDependency**

Run: `CI=true pnpm add -D @rspack/core@~2.1.3`
(This matches the version the workspace already resolves; it makes a real Rspack compiler available to the test.)

- [ ] **Step 2: Write the failing integration test**

Create `test/integration/rspack-build.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rspack } from '@rspack/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rspack'

const fixture = join(import.meta.dirname, '../fixtures/basic')

function build(out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    rspack(
      {
        context: fixture,
        mode: 'production',
        entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
        output: { path: out },
        experiments: { css: true },
        module: { rules: [{ test: /\.svg$/, type: 'asset/resource' }] },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
      },
      (err, stats) => {
        if (err)
          return reject(err)
        if (stats?.hasErrors())
          return reject(new Error(stats.toString({ all: false, errors: true })))
        resolve()
      },
    )
  })
}

describe('rspack build emits Symfony files', () => {
  it('writes entrypoints.json with entries under publicPath', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rspack-'))
    await build(out)

    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))
    expect(entry.isProd).toBe(true)
    expect(entry.devServer).toBeNull()
    expect(entry.publicPath).toBe('/build/')
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js.some((u: string) => /^\/build\/.*\.js$/.test(u))).toBe(true)
  }, 60_000)

  it('writes a non-empty manifest.json with values under publicPath', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rspack-'))
    await build(out)

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest).length).toBeGreaterThan(0)
    for (const value of Object.values(manifest))
      expect(value).toMatch(/^\/build\//)
  }, 60_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/integration/rspack-build.test.ts`
Expected: FAIL — the current `rspack` hook is the old stub (no `done` tap), so `entrypoints.json` is never written and `readFileSync` throws `ENOENT`.

- [ ] **Step 4: Replace the Rspack hook**

In `src/index.ts`, add the collector import next to the existing imports:

```ts
import { statsToGraph } from './collectors/rspack'
import type { RspackStats } from './collectors/rspack'
```

Replace the whole `rspack(compiler)` hook (currently lines 80-83) with:

```ts
    rspack(compiler) {
      // Build mode: our options drive Rspack's output so runtime asset URLs and our JSON agree.
      // In Rsbuild dev (mode 'development'), Rsbuild has already resolved output.publicPath to the
      // dev-server origin (from dev.assetPrefix); leave it and read it in the `done` hook below.
      if (compiler.options.mode !== 'development') {
        compiler.options.output.path = resolved.outputPath
        compiler.options.output.publicPath = resolved.publicPath
      }

      compiler.hooks.done.tap('unplugin-symfony', (stats) => {
        const isDev = compiler.watchMode
        const outputPublicPath = String(compiler.options.output.publicPath ?? resolved.publicPath)
        const urlPrefix = isDev ? outputPublicPath : resolved.publicPath
        const origin = isDev && urlPrefix.includes('://') ? new URL(urlPrefix).origin : null

        const ctx: BuildContext = {
          isProd: !isDev,
          devServer: origin ? { origin, client: null } : null,
          publicPath: resolved.publicPath,
          urlPrefix,
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
        const graph = statsToGraph(stats.toJson({ assets: true, entrypoints: true }) as RspackStats)
        writeFiles(buildEntrypoints(graph, ctx), buildManifest(graph, ctx))
      })
    },
```

If TypeScript rejects the `as RspackStats` cast (Rspack's `StatsCompilation` is a wider type), use `as unknown as RspackStats`.

- [ ] **Step 5: Run test to verify it passes — investigate, do not fake**

Run: `CI=true pnpm vitest run test/integration/rspack-build.test.ts`
Expected: PASS.

This is a real Rspack build, so if it fails, INVESTIGATE the cause rather than weakening the assertions:
- If the build errors on `.css`/`.svg`, adjust the test's Rspack config (the `experiments.css` / `module.rules` above are the starting point) — the fixture (`app.js` imports `style.css` imports `logo.svg`) must build.
- If `entrypoints.json` is written but entry URLs are not under `/build/`, the `mode`-gated `output.publicPath` override did not take effect — verify `compiler.options.mode` is `'production'` here and that setting `output.publicPath` at apply-time reaches code generation. If it does not, move the override into `compiler.hooks.thisCompilation`/`compiler.hooks.run` and re-verify. Report any such change in your report.
- Only change an assertion if it was factually wrong about Rspack's output; call that out explicitly.

- [ ] **Step 6: Full suite + lint + build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all green (Vite tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts package.json pnpm-lock.yaml test/integration/rspack-build.test.ts
git commit -m "feat(rspack): emit entrypoints.json + manifest.json on build"
```

---

### Task 4: Rsbuild dev integration test

Verify the same `done`-hook wiring produces a dev-flavored `entrypoints.json` when driven by a real Rsbuild dev server (which resolves `output.publicPath` to the dev origin and runs in watch mode).

**Files:**
- Modify: `package.json` (add `@rsbuild/core` devDependency)
- Test: `test/integration/rspack-dev.test.ts`

**Interfaces:**
- Consumes: the Rspack `done`-hook wiring from Task 3 (no new production code).
- Produces: confidence that dev mode writes `isProd:false` + `devServer.client:null` + a dev origin.

- [ ] **Step 1: Add `@rsbuild/core` as a root devDependency**

Run: `CI=true pnpm add -D @rsbuild/core@^2.1.5`

- [ ] **Step 2: Write the failing integration test**

Create `test/integration/rspack-dev.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Symfony from '../../src/rspack'

const fixture = join(import.meta.dirname, '../fixtures/basic')

describe('rsbuild dev writes a dev entrypoints.json', () => {
  let server: Awaited<ReturnType<Awaited<ReturnType<typeof createRsbuild>>['startDevServer']>>
  let out: string

  beforeEach(async () => {
    out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-dev-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        server: { port: 0 },
        dev: { assetPrefix: true },
        tools: { rspack: { plugins: [Symfony({ outputPath: out, publicPath: '/build/' })] } },
      },
    })
    server = await rsbuild.startDevServer()
  })

  afterEach(async () => {
    await server.server.close()
  })

  it('marks dev mode, sets an origin, and uses client:null', () => {
    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))

    expect(entry.isProd).toBe(false)
    expect(entry.publicPath).toBe('/build/')
    expect(entry.devServer).not.toBeNull()
    expect(entry.devServer.client).toBeNull()
    expect(entry.devServer.origin).toMatch(/^https?:\/\//)
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
  }, 60_000)
})
```

- [ ] **Step 3: Run test to verify it fails, then investigate to green**

Run: `CI=true pnpm vitest run test/integration/rspack-dev.test.ts`

First run: it may FAIL because the dev file is not yet written when the assertion runs, or the Rsbuild dev API shape differs. This is a real Rsbuild dev server — INVESTIGATE, do not fake:
- The `done` hook fires on each compilation; confirm the first compilation completes before `startDevServer()` resolves (Rsbuild waits for the initial build). If there is a race, await the server's `waitDevCompileDone`/first-build signal if the installed `@rsbuild/core` exposes one, or poll for the file with a short bounded loop.
- If `dev.assetPrefix: true` does not yield an absolute `output.publicPath` (so `devServer.origin` is null), check what Rsbuild set `output.publicPath` to and adjust the config (e.g. an explicit `dev.assetPrefix: 'http://localhost:<port>'`) — the goal is to exercise the real `assetPrefix -> output.publicPath -> our origin` chain.
- The exact `startDevServer()` return shape / how to close the server may differ in `@rsbuild/core@2.1.5`; adjust `afterEach` to the real close method. Report any API adjustments.

Do not weaken an assertion to pass; only correct one if it was factually wrong about Rsbuild's behavior, and say so.
Expected (after investigation): PASS.

- [ ] **Step 4: Full suite + lint + build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml test/integration/rspack-dev.test.ts
git commit -m "test(rspack): cover Rsbuild dev entrypoints.json end-to-end"
```

---

## Self-Review

**1. Spec coverage (A3 = Rspack port, build + dev):**
- Rspack collector (stats -> normalized graph) -> Task 1. ✔
- One hook (`compiler.hooks.done`) serving build + dev -> Task 3. ✔
- Build-mode output driven by our options; dev-mode origin read from `output.publicPath` (mode-gated override) -> Task 3. ✔
- Write both JSON via `node:fs` (dev memory-only) -> Tasks 2 + 3. ✔
- `devServer.client: null` for Rspack -> Task 3 (`origin ? { origin, client: null } : null`). ✔
- Skip `.hot-update.` -> Task 1. ✔
- Real build + real dev integration tests -> Tasks 3, 4. ✔
- Out of scope, tracked: `preload`/`dynamic` population for Rspack (kept `[]` for now, mirroring the dev graph); SRI; shared runtime chunk; Stimulus (B1). The Vite path is untouched (build uses `generateBundle`+`emitFile`; only the shared `writeFiles` helper name changed).

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code; every test step has real assertions. The Task 3/4 "investigate to green" notes are explicit verification instructions against real builds, not deferred work — the concrete starting code is present.

**3. Type consistency:** `statsToGraph(stats: RspackStats): NormalizedGraph` (Task 1) is called in Task 3 with `stats.toJson(...) as RspackStats`. `writeFiles(entrypoints, manifest)` (Task 2) is called in Task 3 (`writeFiles(buildEntrypoints(...), buildManifest(...))`) and in the Vite path (`writeFiles(..., {})`). `BuildContext` fields (`isProd`, `devServer`, `publicPath`, `urlPrefix`, `manifestKeyPrefix`) match the shipped type; `devServer.client: null` uses the existing `'vite' | null` union. Names are consistent.

## Known verification risks (for the executor)

These are the two places most likely to need a real-build adjustment (Task 3/4 already instruct "investigate, don't fake"):
1. Whether setting `output.publicPath` at apply-time (mode-gated) reaches Rspack's code generation. Fallback: move to `compiler.hooks.run`/`thisCompilation`.
2. The exact `@rsbuild/core@2.1.5` dev-server API (`startDevServer()` return shape, first-build timing, `dev.assetPrefix` -> absolute `output.publicPath`).
