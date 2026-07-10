# CDN end-to-end coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the test gap around absolute (CDN) `publicPath` and empty `manifestKeyPrefix`, reaching parity with Encore's `functional.js:256` and `config-generator.js:237`. Test-only; no production code changes.

**Architecture:** Two additions — a new cross-bundler integration test that runs a real Vite build and a real Rsbuild build with a CDN `publicPath` and asserts CDN-prefixed URLs in `entrypoints.json`/`manifest.json`, plus one unit test asserting an explicit empty `manifestKeyPrefix` is preserved. Both characterize existing behaviour.

**Tech Stack:** TypeScript (ESM, strict), vitest, `vite` + `@rsbuild/core` programmatic builds.

## Global Constraints

- ESM only, strict TypeScript, ES2017 target; `node:` prefix for Node builtins.
- Tests live under `assets/test/`; run via `pnpm vitest run <file>` from the repo root; full suite via `pnpm test`.
- Integration tests use `assets/test/fixtures/basic` (entries `app`, `admin`), a temp `outputPath` via `mkdtempSync`, and parse the emitted JSON — never the playground.
- CDN config under test: `publicPath: 'https://cdn.example.com/assets/'` (trailing slash) + `manifestKeyPrefix: 'assets/'`.
- Commit messages: Symfony style `[<Scope>] <Short description>`. Scopes: `[Tests]` for tests, `[Docs]` for AGENTS.md.
- Spec: `docs/superpowers/specs/2026-07-10-cdn-manifestkeyprefix-guard-design.md`.

**Note on TDD framing:** these are characterization tests for behaviour that already exists, so they are expected to PASS on first run. If a CDN integration test FAILS, that is a real bug — stop and report it before continuing.

---

### Task 1: Empty manifestKeyPrefix unit test

**Files:**
- Test: `assets/test/core/options.test.ts` (add one case to `describe('normalizeOptions')`)

**Interfaces:**
- Consumes: `normalizeOptions(options, cwd): ResolvedOptions` — unchanged.
- Produces: nothing new.

- [ ] **Step 1: Add the test**

Insert after the "honors an explicit manifestKeyPrefix" test (`options.test.ts:31`):

```ts
    it('honors an explicit empty manifestKeyPrefix', () => {
        const r = normalizeOptions({ publicPath: '/build/', manifestKeyPrefix: '' }, '/app');
        expect(r.manifestKeyPrefix).toBe('');
    });
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run assets/test/core/options.test.ts`
Expected: PASS (current code keeps `''` because `options?.manifestKeyPrefix ?? null` preserves the empty string and skips derivation).

- [ ] **Step 3: Commit**

```bash
git add assets/test/core/options.test.ts
git commit -m "[Tests] Cover explicit empty manifestKeyPrefix"
```

---

### Task 2: CDN end-to-end integration test (Vite + Rsbuild)

**Files:**
- Create: `assets/test/integration/cdn.test.ts`

**Interfaces:**
- Consumes: default exports `../../src/vite` (Vite plugin) and `../../src/rsbuild` (Rsbuild plugin), both `(options?: Options) => plugin`; `Options` includes `outputPath`, `publicPath`, `manifestKeyPrefix`.
- Produces: nothing new.

- [ ] **Step 1: Write the test file**

Create `assets/test/integration/cdn.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const CDN = 'https://cdn.example.com/assets/';
const CDN_URL_RE = /^https:\/\/cdn\.example\.com\/assets\//;

describe('absolute (CDN) publicPath', () => {
    it('vite build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cdn-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: {
                emptyOutDir: true,
                rollupOptions: { input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
            },
            plugins: [SymfonyVite({ outputPath: out, publicPath: CDN, manifestKeyPrefix: 'assets/' })],
        });

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js[0]).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['assets/app.js']).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    }, 30_000);

    it('rsbuild build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cdn-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: CDN, manifestKeyPrefix: 'assets/' })],
            },
        });
        await rsbuild.build();

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js.some((u: string) => CDN_URL_RE.test(u))).toBe(true);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest).length).toBeGreaterThan(0);
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    }, 60_000);
});
```

- [ ] **Step 2: Run the new file**

Run: `pnpm vitest run assets/test/integration/cdn.test.ts`
Expected: PASS (2 tests). Absolute `publicPath` already flows through `joinUrl` in `buildEntrypoints`/`buildManifest`, so both files carry CDN URLs.
If it FAILS: a real CDN bug — stop, diagnose (systematic-debugging), fix the production code, then re-run.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: PASS (was 66; now 69 — +1 unit from Task 1, +2 integration here).

- [ ] **Step 4: Commit**

```bash
git add assets/test/integration/cdn.test.ts
git commit -m "[Tests] Add CDN publicPath end-to-end build coverage for Vite and Rsbuild"
```

---

### Task 3: Fix the stale AGENTS.md paragraph

**Files:**
- Modify: `AGENTS.md` (the "The Symfony integration contract" section)

**Interfaces:** none.

- [ ] **Step 1: Replace the stale sentences**

In `AGENTS.md`, read the "The Symfony integration contract" section and replace:

> Encore enforces this by throwing (`../webpack-encore/lib/config/path-util.ts`, `validatePublicPathAndManifestKeyPrefix`); **porting that guard is still TODO** — the current factory does not throw and would use the absolute URL as the key prefix. The `publicPath === null` branch in `assets/src/index.ts` is likewise dead (`publicPath` always defaults to `build/`).

with:

> Reprise ports the relevant half of Encore's `validatePublicPathAndManifestKeyPrefix` (`../webpack-encore/lib/config/path-util.js`) in `normalizeOptions`: an absolute `publicPath` (containing `://`) without an explicit `manifestKeyPrefix` throws. Encore's second branch — rejecting a `publicPath` not contained in `outputPath` — is intentionally not ported: Reprise's `outputPath` (a filesystem dir) and `publicPath` (a URL prefix) are decoupled, so that heuristic would reject valid configs. CDN URLs in `entrypoints.json`/`manifest.json` are covered end-to-end by `assets/test/integration/cdn.test.ts`.

(If the surrounding wording differs slightly, keep it and swap only these sentences.)

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "[Docs] Clarify the manifestKeyPrefix guard and CDN coverage"
```

---

## Self-Review

**Spec coverage:**
- Empty manifestKeyPrefix parity → Task 1. ✓
- CDN e2e (Vite + Rsbuild) → Task 2. ✓
- Branch 2 rejection recorded, not implemented → no task (correct). ✓
- AGENTS.md correction → Task 3. ✓

**Placeholder scan:** No TBD/TODO; all test code shown in full. ✓

**Type consistency:** Plugins imported as default exports `SymfonyVite`/`SymfonyRsbuild`, both `(options?: Options) => plugin`; assertions read `entry.publicPath`, `entry.entryPoints.app.js`, `manifest[...]` — matching the shapes in `vite-build.test.ts`/`rsbuild-build.test.ts`. ✓
