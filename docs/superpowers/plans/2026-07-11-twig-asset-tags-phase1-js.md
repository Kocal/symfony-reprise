# Twig Asset Tags — Phase 1 (JS: ADR 0001 entrypoints format + ESM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JS plugin emit `entrypoints.json` in the ADR-0001 shape the PHP tag renderer (Phase 2) consumes: build references are docroot-relative (no leading slash), the SRI map is keyed by those references, and both bundlers emit ES modules so the renderer can always use `type="module"`.

**Architecture:** A one-line format tweak in `assets/src/core/format.ts` (`buildEntrypoints` only; `buildManifest` untouched) turns build references from `/build/app-<hash>.js` into `build/app-<hash>.js` and keys the integrity map the same way. Dev references stay absolute (nothing to strip). Separately, the Rsbuild adapter is switched to ES-module output so the entry chunks load under `<script type="module">` like Vite's.

**Tech Stack:** TypeScript (ESM, strict, ES2017, `node:` prefix), Vitest, tsdown; Vite + Rollup; Rsbuild + Rspack.

## Global Constraints

- ESM only, strict TypeScript, ES2017 target, `node:` prefix for Node builtins.
- Bundler symmetry: a functional/integration test for one bundler ships with the other, including negative/off cases.
- Only `entrypoints.json` changes in Phase 1. `manifest.json` (`buildManifest`) is a separate concern and MUST NOT change.
- Build references: docroot-relative, no leading slash (`build/app-<hash>.js`). Dev references: absolute dev-server-origin URLs, unchanged.
- SRI integrity map keyed by the reference (relative in build), not the final URL.
- Commit scope `[Entrypoints]` for the format/SRI change, `[Rsbuild]` for the ESM-output change.
- Note (context, not a task): Symfony `PathPackage`/`UrlPackage` `ltrim($path, '/')`, so `/build/app.js` and `build/app.js` resolve identically. The strip is for ADR fidelity and a clean reference contract, not because Packages needs it.

---

## Task 1: Emit docroot-relative build references + re-key SRI

**Files:**
- Modify: `assets/src/core/format.ts`
- Test: `assets/test/core/format.test.ts`
- Test (assertions updated): `assets/test/integration/vite-build.test.ts`, `assets/test/integration/rsbuild-build.test.ts`, `assets/test/integration/integrity.test.ts`

**Interfaces:**
- Produces: `buildEntrypoints(graph, ctx)` now emits each `js`/`css`/`preload`/`dynamic` reference and each `integrity` key with the leading slash stripped (build: `build/app-<hash>.js`; dev absolute URLs unchanged). `buildManifest` unchanged.

- [ ] **Step 1: Update the `buildEntrypoints` unit expectations to the relative shape (RED)**

In `assets/test/core/format.test.ts`, change the build-mode expectations to have no leading slash, and rename the two affected tests. Replace lines 22-30 (the `prefixes every asset list with publicPath` test):

```ts
    it('emits docroot-relative references (no leading slash) for a build', () => {
        const out = buildEntrypoints(graph, ctx);
        expect(out.entryPoints.app).toEqual({
            js: ['build/app-a1b2.js'],
            css: ['build/app-c3d4.css'],
            preload: ['build/vendor-e5f6.js'],
            dynamic: ['build/lazy-x.js'],
        });
    });
```

In the `keeps empty arrays…` test, replace its assertion (line 41) with the relative shape:

```ts
        expect(out.entryPoints.admin).toEqual({ js: ['build/admin-99.js'], css: [], preload: [], dynamic: [] });
```

Replace the `inserts a slash…` test body (lines 44-47):

```ts
    it('strips the leading slash even when urlPrefix has no trailing slash', () => {
        const out = buildEntrypoints(graph, { ...ctx, urlPrefix: '/build' });
        expect(out.entryPoints.app.js).toEqual(['build/app-a1b2.js']);
    });
```

Replace the integrity test (lines 49-58) to be keyed by reference:

```ts
    it('emits a top-level integrity map keyed by reference when the graph carries hashes', () => {
        const out = buildEntrypoints(
            { ...graph, integrity: { 'app-a1b2.js': 'sha384-JS', 'app-c3d4.css': 'sha384-CSS' } },
            ctx
        );
        expect(out.integrity).toEqual({
            'build/app-a1b2.js': 'sha384-JS',
            'build/app-c3d4.css': 'sha384-CSS',
        });
    });
```

Leave the dev test (lines 64-79) unchanged: its reference `http://127.0.0.1:5173/build/assets/app.js` has no leading slash to strip. Leave the entire `buildManifest` describe (lines 82-113) unchanged.

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `pnpm vitest run assets/test/core/format.test.ts`
Expected: FAIL — current `buildEntrypoints` emits `/build/app-a1b2.js` (leading slash), tests now expect `build/app-a1b2.js`.

- [ ] **Step 3: Implement the relative reference in `assets/src/core/format.ts`**

Add a helper and use it in `buildEntrypoints` only (leave `joinUrl` and `buildManifest` as-is):

```ts
function toReference(prefix: string, name: string): string {
    // Docroot-relative reference (ADR 0001): a build URL like `/build/app-<hash>.js` becomes
    // `build/app-<hash>.js`; an absolute dev-server URL has no leading slash and is unchanged.
    return joinUrl(prefix, name).replace(/^\//, '');
}
```

In `buildEntrypoints`, replace the four `joinUrl(ctx.urlPrefix, f)` mappings and the integrity `joinUrl(ctx.urlPrefix, fileName)` key with `toReference`:

```ts
        entryPoints[name] = {
            js: files.js.map((f) => toReference(ctx.urlPrefix, f)),
            css: files.css.map((f) => toReference(ctx.urlPrefix, f)),
            preload: files.preload.map((f) => toReference(ctx.urlPrefix, f)),
            dynamic: files.dynamic.map((f) => toReference(ctx.urlPrefix, f)),
        };
```

and:

```ts
        out.integrity = Object.fromEntries(
            Object.entries(graph.integrity).map(([fileName, sri]) => [toReference(ctx.urlPrefix, fileName), sri])
        );
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm vitest run assets/test/core/format.test.ts`
Expected: PASS (buildEntrypoints relative; buildManifest unchanged).

- [ ] **Step 5: Update the integration test assertions (they assert leading slashes)**

In `assets/test/integration/vite-build.test.ts`, lines 36-38, drop the leading slash:

```ts
        expect(entry.entryPoints.app.js[0]).toMatch(/^build\/app-.*\.js$/);
        expect(entry.entryPoints.app.css[0]).toMatch(/^build\/.*\.css$/);
        expect(entry.entryPoints.app.dynamic[0]).toMatch(/^build\/.*\.js$/);
```

(Leave the manifest assertions on lines 45-48 unchanged — the manifest still carries `/build/…` values.)

In `assets/test/integration/rsbuild-build.test.ts`, line 28:

```ts
        expect(entry.entryPoints.app.js.some((u: string) => /^build\/.*\.js$/.test(u))).toBe(true);
```

In `assets/test/integration/integrity.test.ts`, line 18 (integrity keys are references now):

```ts
        expect(url).toMatch(/^build\//);
```

- [ ] **Step 6: Run the full suite (CDN test must still pass unchanged)**

Run: `pnpm test`
Expected: PASS. Note the CDN test (`assets/test/integration/cdn.test.ts`) is unaffected: an absolute `publicPath` produces absolute references (`https://cdn…/app.js`) with no leading slash to strip, so they stay absolute and the assertions hold.

- [ ] **Step 7: Format, lint, commit**

Run: `pnpm exec oxfmt assets/src/core/format.ts assets/test/core/format.test.ts assets/test/integration/vite-build.test.ts assets/test/integration/rsbuild-build.test.ts assets/test/integration/integrity.test.ts` then `pnpm fmt:check` and `pnpm exec oxlint assets/src assets/test`.

```bash
git add assets/src/core/format.ts assets/test/core/format.test.ts assets/test/integration/vite-build.test.ts assets/test/integration/rsbuild-build.test.ts assets/test/integration/integrity.test.ts
git commit -m "[Entrypoints] Emit docroot-relative build references and key SRI by reference"
```

---

## Task 2: Standardise Rsbuild on ES-module output

**Files:**
- Modify: `assets/src/rsbuild.ts`
- Test: `assets/test/integration/rsbuild-build.test.ts`

**Interfaces:**
- Consumes: the Rsbuild adapter's existing `api.modifyRsbuildConfig` / `tools.rspack` wiring.
- Produces: Rsbuild build output is ES modules (entry chunks load under `<script type="module">`), matching Vite.

**Risk gate:** Rspack ES-module output for a *web* target (not a library) may not be reliable. This task is de-risk-first. Vite already emits ESM, so it needs no change.

- [ ] **Step 1: Spike — determine the working Rspack ESM config**

Before writing the test, verify feasibility. In `assets/src/rsbuild.ts`, inside the existing `api.modifyRsbuildConfig((config) => { … })`, try enabling module output (best current guess — adjust to what actually works):

```ts
                config.output ??= {};
                // Standardise on ESM so the tags render as <script type="module"> like Vite.
                (config.output as Record<string, unknown>).module = true;
```

and, in the existing `config.tools.rspack` array callback, enable the experiment on the raw Rspack config:

```ts
                    (rspackConfig) => {
                        rspackConfig.experiments ??= {};
                        rspackConfig.experiments.outputModule = true;
                        rspackConfig.output ??= {};
                        rspackConfig.output.module = true;
                        rspackConfig.output.chunkFormat = 'module';
                    },
```

Then run the playground Rsbuild build and inspect the entry chunk:

Run: `cd playground && npm run rsbuild:build 2>&1 | tail -20` then check an entry chunk in `public/build/static/js/` uses ESM syntax (`export`/`import`) or is a module chunk.

**Decision point:**
- If the build succeeds and the entry chunk is an ES module -> proceed to Step 2 with the config that worked (fold the two snippets into the existing hooks; do not add a second `tools.rspack` callback if one already exists — extend it).
- If the build fails or cannot produce loadable ESM web output -> **STOP and escalate**: report `BLOCKED` with the exact error. The `type="module"` decision (spec §A "ESM standardisation") must be revisited (fall back to per-bundler handling) before Phase 2. Do not force a broken config.

- [ ] **Step 2: Write the failing test asserting ESM output**

Add to `assets/test/integration/rsbuild-build.test.ts` (a new `it`, using the same `basic` fixture and build setup as the first test in the file — read that test for the exact `createRsbuild`/`build()` shape, then assert the emitted entry chunk is an ES module):

```ts
    it('emits ES-module output (loadable under <script type="module">)', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-esm-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();

        // The entry JS chunk is an ES module: ESM output uses `export`/`import` at top level.
        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        const appJs = (entry.entryPoints.app.js as string[]).find((u) => /\.js$/.test(u))!;
        const contents = readFileSync(join(out, appJs), 'utf8');
        expect(/\b(export|import)\b/.test(contents)).toBe(true);
    }, 60_000);
```

Note: `appJs` is a docroot-relative reference (`build/…`, Task 1). The file on disk is at `join(out, appJs)` since `out` is the `build` output dir and `appJs` starts with `build/`... confirm the path: the reference is `build/static/js/app.<hash>.js` and `out` already IS the build dir, so read from `join(out, appJs.replace(/^build\//, ''))`. Use:

```ts
        const contents = readFileSync(join(out, appJs.replace(/^build\//, '')), 'utf8');
```

- [ ] **Step 3: Run the test to verify it fails (before the ESM config), then passes (after)**

Run: `pnpm vitest run assets/test/integration/rsbuild-build.test.ts -t "ES-module"`
Expected: with the Step 1 config applied, PASS. If you reached Step 2, the config is in place, so this asserts it holds. (If you want a clean RED first, stash the Step 1 config, run -> FAIL "no export/import", unstash.)

- [ ] **Step 4: Run the full suite + playground**

Run: `pnpm test` (all green — the ESM switch must not break existing Rsbuild build/dev tests) then `cd playground && npm run rsbuild:build && npm run rsbuild:dev`-smoke (build succeeds; dev serves).
Expected: PASS; playground Rsbuild build/dev still work.

- [ ] **Step 5: Format, lint, commit**

```bash
git add assets/src/rsbuild.ts assets/test/integration/rsbuild-build.test.ts
git commit -m "[Rsbuild] Emit ES-module output for parity with Vite"
```

---

## Final verification

- [ ] **Full gate**

Run: `pnpm test && pnpm exec oxlint assets/src assets/test && pnpm fmt:check && pnpm build`
Expected: PASS.

- [ ] **Spec cross-check (Phase 1 slice of the spec)**

Confirm against `docs/superpowers/specs/2026-07-11-twig-asset-tags-design.md` §A: build references relative (no leading slash); dev absolute unchanged; SRI keyed by reference; `manifest.json` unchanged; both bundlers ESM (or the ESM decision escalated per Task 2's gate). The CDN reframe *docs* and the PHP renderer live in Phase 2.
