# Rsbuild native adapter (no HTML, absolute dev URLs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rsbuild emit only assets + `entrypoints.json` + `manifest.json` for Symfony — no per-entry HTML — and make dev `entrypoints.json` URLs point at the dev-server origin, via a native Rsbuild plugin. Drop the raw Rspack plugin (Rsbuild is the supported Rspack layer).

**Context / why:** A3 wired Rspack via `tools.rspack.plugins` (a raw Rspack plugin). Running the real playground exposed two bugs: (1) `rsbuild dev` writes relative entry URLs that never point at the dev server; (2) `rsbuild build` also emits `app.html`/`admin.html`. Both are decided at the Rsbuild config layer (`dev.assetPrefix` default `/`; `html-rspack-plugin` per entry), which a raw Rspack plugin runs too late to change. Symfony needs assets-only output consumed via the two JSON files, like Encore.

**Architecture:** A native `RsbuildPlugin` (top-level `plugins: []`) uses `api.modifyRsbuildConfig` to force `tools.htmlPlugin = false`, default `dev.assetPrefix = true` (so Rsbuild resolves `output.publicPath` to the absolute dev origin), and set `output.distPath.root`/`assetPrefix` from the plugin options. `api.onAfterCreateCompiler` taps `compiler.hooks.done` to run the existing pure collector + core and write the files. The Rspack stats collector (`statsToGraph`) and the whole pure core are reused unchanged.

**Tech Stack:** TypeScript (ESM, strict, ES2017), `@rsbuild/core` ^2.1.5, `@rspack/core` (transitive), vitest 4, tsdown. (unplugin still backs the Vite path; the Rsbuild adapter is a hand-written `RsbuildPlugin`, not an unplugin adapter.)

**Sources (derive from these — do NOT copy any third-party plugin):** `@rsbuild/core@2.1.5` public API (`RsbuildPlugin`, `api.modifyRsbuildConfig`, `api.onAfterCreateCompiler`, `dev.assetPrefix`, `tools.htmlPlugin`) + the shipped A1/A2/A3 core. `vite-plugin-symfony` is Vite-only and irrelevant here.

## Global Constraints

- ESM only; strict TypeScript; ES2017 target; `node:` prefix for Node builtins.
- Format v1 unchanged: `entrypoints.json` keys `isProd`/`devServer`/`publicPath`/`entryPoints`; per-entry `js`/`css`/`preload`/`dynamic`. `devServer.client` is `null` for Rspack.
- The Rsbuild plugin MUST result in **zero HTML files** and **absolute dev-server entry URLs** out of the box (no user config required).
- Default export from `unplugin-symfony/rsbuild` is the plugin factory: `import Symfony from 'unplugin-symfony/rsbuild'` -> `plugins: [Symfony({ /* options */ })]`.
- Reuse the pure core (`normalizeOptions`, `buildEntrypoints`, `buildManifest`) and `statsToGraph` unchanged. Write files with `node:fs`.
- Drop the raw Rspack plugin: remove `src/rspack.ts`, the `rspack(compiler)` hook in `src/index.ts`, the `./rspack` export, and the raw-rspack integration tests. Keep `statsToGraph` + its unit test (used by the Rsbuild adapter).
- Node 22; pnpm; run commands with `CI=true` prefix. Tests use `test/fixtures/`, never `playground/`.

## File Structure

- `src/core/emit.ts` — **create.** `writeSymfonyFiles(outputPath, entrypoints, manifest)` (extracted from the `writeFiles` closure in `src/index.ts`).
- `src/rsbuild.ts` — **create.** The native `RsbuildPlugin` (default export).
- `src/index.ts` — **modify.** Use `writeSymfonyFiles` in the Vite dev path; remove the `rspack(compiler)` hook (and its collector imports).
- `src/rspack.ts` — **delete.**
- `package.json` — **modify.** Replace the `./rspack` export with `./rsbuild`; add `@rsbuild/core` as an optional peer dependency.
- `playground/rsbuild.config.ts` — **modify.** Use `plugins: [Symfony()]` (top-level) instead of `tools.rspack.plugins`.
- `README.md` — **modify.** Update the Rsbuild usage example.
- Tests: `test/integration/rsbuild-build.test.ts` (rewrite), `test/integration/rspack-dev.test.ts` -> `test/integration/rsbuild-dev.test.ts` (rewrite), delete `test/integration/rspack-build.test.ts`. Keep `test/collectors/rspack.test.ts`.

---

### Task 1: Extract the shared file writer

**Files:**
- Create: `src/core/emit.ts`
- Modify: `src/index.ts` (Vite dev path)

**Interfaces:**
- Consumes: `EntrypointsJson`, `ManifestJson` from `./types`.
- Produces: `writeSymfonyFiles(outputPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void`.

- [ ] **Step 1: Create the writer**

Create `src/core/emit.ts`:

```ts
import type { EntrypointsJson, ManifestJson } from '../types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writeSymfonyFiles(outputPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void {
  mkdirSync(outputPath, { recursive: true })
  writeFileSync(join(outputPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`)
  writeFileSync(join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}
```

- [ ] **Step 2: Use it in the Vite dev path**

In `src/index.ts`: remove the local `writeFiles` function; add `import { writeSymfonyFiles } from './core/emit'`; drop the now-unused `mkdirSync`/`writeFileSync`/`join` imports if nothing else uses them (the `rspack` hook still uses none of these after Task 4, but for Task 1 keep whatever the file still needs). Change the Vite `configureServer` write call to:

```ts
          try {
            writeSymfonyFiles(resolved.outputPath, buildEntrypoints(configToDevGraph(server.config), ctx), {})
          }
```

Note: the `rspack(compiler)` hook still calls the old `writeFiles`; until Task 4 removes it, update its call too — `writeSymfonyFiles(resolved.outputPath, buildEntrypoints(graph, ctx), buildManifest(graph, ctx))` inside its try/catch — so the file compiles between tasks.

- [ ] **Step 3: Verify**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all green (behavior unchanged — same files written).

- [ ] **Step 4: Commit**

```bash
git add src/core/emit.ts src/index.ts
git commit -m "refactor(core): extract writeSymfonyFiles(outputPath, entrypoints, manifest)"
```

---

### Task 2: Native Rsbuild adapter + build integration test (no HTML)

**Files:**
- Create: `src/rsbuild.ts`
- Modify: `package.json` (exports + peer dep)
- Test: `test/integration/rsbuild-build.test.ts` (rewrite)

**Interfaces:**
- Consumes: `normalizeOptions`, `statsToGraph`/`RspackStats`, `buildEntrypoints`/`buildManifest`, `writeSymfonyFiles`, `BuildContext`, `Options`.
- Produces: default export `Symfony(options?: Options): RsbuildPlugin`.

- [ ] **Step 1: Add `@rsbuild/core` as an optional peer dependency**

In `package.json`, add to `peerDependencies` (next to `vite`): `"@rsbuild/core": ">=1"`, and to `peerDependenciesMeta`: `"@rsbuild/core": { "optional": true }`. (`@rsbuild/core` is already a devDep from A3.)

Replace the `"./rspack": "./dist/rspack.mjs"` line in `exports` with `"./rsbuild": "./dist/rsbuild.mjs"`.

- [ ] **Step 2: Write the failing test**

Create `test/integration/rsbuild-build.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rsbuild'

const fixture = join(import.meta.dirname, '../fixtures/basic')

describe('rsbuild build emits Symfony files and no HTML', () => {
  it('writes entrypoints.json + manifest.json under publicPath, and no per-entry HTML', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-build-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        mode: 'production',
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
      },
    })
    await rsbuild.build()

    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))
    expect(entry.isProd).toBe(true)
    expect(entry.devServer).toBeNull()
    expect(entry.publicPath).toBe('/build/')
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js.some((u: string) => /^\/build\/.*\.js$/.test(u))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest).length).toBeGreaterThan(0)

    // No per-entry HTML anywhere in the output dir.
    const htmlFiles = readdirSync(out, { recursive: true }).filter(f => String(f).endsWith('.html'))
    expect(htmlFiles).toEqual([])
  }, 60_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true pnpm vitest run test/integration/rsbuild-build.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/rsbuild"`.

- [ ] **Step 4: Write the adapter**

Create `src/rsbuild.ts`:

```ts
import type { RsbuildPlugin } from '@rsbuild/core'
import type { RspackStats } from './collectors/rspack'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { statsToGraph } from './collectors/rspack'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions } from './core/options'

export default function symfony(options?: Options): RsbuildPlugin {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

    setup(api) {
      // Rsbuild-level config: Symfony renders the HTML, so no per-entry HTML pages; and in dev,
      // resolve output.publicPath to the absolute dev-server origin so entry URLs point at it.
      api.modifyRsbuildConfig((config) => {
        config.tools ??= {}
        config.tools.htmlPlugin = false
        config.dev ??= {}
        config.dev.assetPrefix ??= true
        config.output ??= {}
        config.output.distPath = { ...config.output.distPath, root: resolved.outputPath }
        config.output.assetPrefix ??= resolved.publicPath
      })

      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers = 'compilers' in compiler ? compiler.compilers : [compiler]
        for (const c of compilers) {
          c.hooks.done.tap('unplugin-symfony', (stats) => {
            const isDev = c.watchMode
            const urlPrefix = String(c.options.output.publicPath ?? resolved.publicPath)
            const origin = urlPrefix.includes('://') ? new URL(urlPrefix).origin : null

            const ctx: BuildContext = {
              isProd: !isDev,
              devServer: origin ? { origin, client: null } : null,
              publicPath: resolved.publicPath,
              urlPrefix,
              manifestKeyPrefix: resolved.manifestKeyPrefix,
            }
            const graph = statsToGraph(stats.toJson({ assets: true, entrypoints: true }) as RspackStats)
            try {
              writeSymfonyFiles(resolved.outputPath, buildEntrypoints(graph, ctx), buildManifest(graph, ctx))
            }
            catch (err) {
              c.getInfrastructureLogger('unplugin-symfony').error(`[unplugin-symfony] failed to write entrypoints.json: ${err instanceof Error ? err.message : String(err)}`)
            }
          })
        }
      })
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes — investigate, do not fake**

Run: `CI=true pnpm vitest run test/integration/rsbuild-build.test.ts`
Expected: PASS.

Real Rsbuild build — investigate rather than weaken if it fails:
- If HTML still appears, verify `config.tools.htmlPlugin = false` reached Rsbuild (check the exact key/shape against the installed `@rsbuild/core@2.1.5` types) and adjust.
- If entry URLs aren't under `/build/`, confirm `output.assetPrefix`/`distPath.root` are applied; read the real resolved `output.publicPath`.
- If `onAfterCreateCompiler` gives a `MultiCompiler` shape different from `'compilers' in compiler`, adjust the narrowing against the real type. Report any change.

- [ ] **Step 6: Full suite + lint + build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: green (raw-rspack tests still pass for now; removed in Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/rsbuild.ts package.json test/integration/rsbuild-build.test.ts
git commit -m "feat(rsbuild): native adapter — assets-only output, no per-entry HTML"
```

---

### Task 3: Rsbuild dev integration test (absolute dev URLs, no HTML)

**Files:**
- Create: `test/integration/rsbuild-dev.test.ts`

**Interfaces:**
- Consumes: the Task 2 adapter (no new production code expected).

- [ ] **Step 1: Write the failing test**

Create `test/integration/rsbuild-dev.test.ts`. It uses the adapter via `plugins: []` with NO `dev.assetPrefix` in the user config (the adapter must set it), and asserts absolute dev URLs + no HTML:

```ts
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Symfony from '../../src/rsbuild'

const fixture = join(import.meta.dirname, '../fixtures/basic')

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      }
      else {
        srv.close(() => reject(new Error('no port')))
      }
    })
  })
}

describe('rsbuild dev writes absolute dev-server URLs and no HTML', () => {
  let server: Awaited<ReturnType<Awaited<ReturnType<typeof createRsbuild>>['startDevServer']>>
  let out: string

  beforeEach(async () => {
    out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-dev-'))
    const port = await getFreePort()
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        mode: 'development',
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        server: { port },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
      },
    })
    server = await rsbuild.startDevServer()
  })

  afterEach(async () => {
    await server.server.close()
  })

  it('points entries at the dev-server origin, client:null, no HTML', () => {
    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))

    expect(entry.isProd).toBe(false)
    expect(entry.publicPath).toBe('/build/')
    expect(entry.devServer).not.toBeNull()
    expect(entry.devServer.client).toBeNull()
    expect(entry.devServer.origin).toMatch(/^https?:\/\//)
    expect(entry.entryPoints.app.js[0]).toMatch(/^https?:\/\/.*\/build\//)

    const htmlFiles = readdirSync(out, { recursive: true }).filter(f => String(f).endsWith('.html'))
    expect(htmlFiles).toEqual([])
  }, 60_000)
})
```

- [ ] **Step 2: Run test to verify it fails, then investigate to green**

Run: `CI=true pnpm vitest run test/integration/rsbuild-dev.test.ts`

First run may FAIL on the first-build race (the `done` hook writes on the first compilation; `startDevServer()` may resolve before/after it) or an API-shape mismatch. INVESTIGATE, do not fake:
- If the file isn't written yet when the assertion runs, await the first compile — add a tiny extra Rsbuild plugin to the `plugins` array that resolves a promise in `api.onDevCompileDone`/`onAfterEnvironmentCompile` (whichever `@rsbuild/core@2.1.5` exposes), or poll for the file with a short bounded loop. No arbitrary sleeps.
- If `devServer.origin` is null, the adapter's `dev.assetPrefix ??= true` didn't yield an absolute `output.publicPath` — inspect the real value and fix the adapter (this is the actual bug being fixed; the assertion is correct).
- Adjust the `startDevServer()` return / close method to the real `@rsbuild/core@2.1.5` shape. Report any adapter change.

Do not weaken an assertion; only correct one if it was factually wrong about Rsbuild, and say so.
Expected (after investigation): PASS.

- [ ] **Step 3: Full suite + lint + build**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add test/integration/rsbuild-dev.test.ts
git commit -m "test(rsbuild): dev entrypoints.json points at the dev-server origin, no HTML"
```

---

### Task 4: Drop the raw Rspack plugin + migrate playground/docs

**Files:**
- Delete: `src/rspack.ts`, `test/integration/rspack-build.test.ts`, `test/integration/rspack-dev.test.ts`
- Modify: `src/index.ts` (remove the `rspack(compiler)` hook + its imports)
- Modify: `playground/rsbuild.config.ts`, `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: only the Vite hooks remain in `unpluginFactory`; Rspack/Rsbuild is served solely by `src/rsbuild.ts`.

- [ ] **Step 1: Remove the raw Rspack plugin from the factory**

In `src/index.ts`: delete the entire `rspack(compiler) { ... }` hook from the returned object, and remove imports only it used (`statsToGraph`/`RspackStats` from `./collectors/rspack`). `statsToGraph` stays used by `src/rsbuild.ts`, so do not delete the collector module. The factory now returns `{ name, vite: {...} }`.

Delete `src/rspack.ts`.

- [ ] **Step 2: Delete the obsolete raw-rspack tests**

```bash
git rm test/integration/rspack-build.test.ts test/integration/rspack-dev.test.ts src/rspack.ts
```

(The Rsbuild build + dev tests from Tasks 2-3 cover Rspack now; `test/collectors/rspack.test.ts` stays.)

- [ ] **Step 3: Migrate the playground**

Replace `playground/rsbuild.config.ts` with:

```ts
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import Symfony from '../src/rsbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  source: {
    entry: {
      app: resolve(__dirname, './assets/app.js'),
      admin: resolve(__dirname, './assets/admin.js'),
    },
  },
  plugins: [
    Symfony(),
  ],
})
```

- [ ] **Step 4: Update the README Rsbuild example**

In `README.md`, replace the Rsbuild usage block so it imports from `unplugin-symfony/rsbuild` and registers via top-level `plugins`:

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core'
import Symfony from '@kocal/unplugin-symfony/rsbuild'

export default defineConfig({
  plugins: [Symfony({ /* options */ })],
})
```

- [ ] **Step 5: Verify + commit**

Run: `CI=true pnpm test run && CI=true pnpm lint && CI=true pnpm build`
Expected: all green (no more raw-rspack tests; Rsbuild build+dev tests pass; Vite untouched). Confirm `dist/` no longer has `rspack.*` and now has `rsbuild.*`, and `package.json` exports match.

```bash
git add -A src/index.ts playground/rsbuild.config.ts README.md
git commit -m "refactor: drop raw Rspack plugin; Rsbuild is the supported Rspack layer"
```

- [ ] **Step 6: Manual playground check (the original bug reproduction)**

Not automated, but the executor should note in the report: `npm -C playground run rsbuild:build` must produce assets + `entrypoints.json` + `manifest.json` and NO `app.html`/`admin.html`; `npm -C playground run rsbuild:dev` must write `entrypoints.json` whose entry URLs are `http://localhost:<port>/build/...`.

---

## Self-Review

**1. Coverage:** Bug #2 (HTML) -> `tools.htmlPlugin = false` (Task 2) + no-HTML assertions (Tasks 2-3). Bug #1 (relative dev URLs) -> `dev.assetPrefix ??= true` (Task 2) + absolute-URL assertion without the test crutch (Task 3). Native adapter + default export from `unplugin-symfony/rsbuild` -> Task 2. Raw Rspack dropped -> Task 4. Core/collector reused unchanged. Vite path untouched (only the shared writer extraction).

**2. Placeholder scan:** No TBD/TODO. The Task 2/3 "investigate to green" notes are explicit real-build verification, with complete starting code.

**3. Type consistency:** `writeSymfonyFiles(outputPath, entrypoints, manifest)` (Task 1) is called in the Vite path and the adapter. `Symfony(options): RsbuildPlugin` (Task 2) is the default export used in tests + playground. `statsToGraph`/`RspackStats`/`BuildContext` reused from the shipped code. `devServer.client: null` uses the existing union.

## Known verification risks (for the executor)

1. Exact `@rsbuild/core@2.1.5` shapes: `onAfterCreateCompiler` MultiCompiler narrowing; the first-build sync hook name for the dev test; `startDevServer()` return + close method; whether `dev.assetPrefix ??= true` resolves an absolute `output.publicPath` with the real port in time for the `done` hook. Tasks 2-3 instruct investigate-not-fake.
2. `config.tools.htmlPlugin = false` is the documented disable switch; if a future Rsbuild renames it, the no-HTML assertion catches it.
