# CDN polish — end-to-end coverage for absolute publicPath

- **Date:** 2026-07-10 (revised same day)
- **Status:** approved design, pre-implementation
- **Scope:** JS plugin only (`@symfony/reprise`), test-only. First of the three roadmap "polish" items (CDN → SRI → shared runtime chunk).

## Context

The roadmap lists CDN / absolute `publicPath` as "mostly done in A1 — finalize". Absolute `publicPath` already works: `normalizeOptions` accepts it (requiring an explicit `manifestKeyPrefix`), and `buildEntrypoints`/`buildManifest` prefix every URL with it via `joinUrl`, so the emitted files carry CDN URLs. Both Vite (`config().base = publicPath`) and Rsbuild (`output.assetPrefix = publicPath`) propagate it.

What "finalize" turns out to mean, after investigation, is **closing a test gap**, not adding code.

## Rejected: porting Encore's second guard branch

Encore's `validatePublicPathAndManifestKeyPrefix` (`../webpack-encore/lib/config/path-util.js`) has two throw branches when `manifestKeyPrefix` is unset:

1. `publicPath` is absolute (`://`) → throw. **Already ported and tested** (`options.ts`, `options.test.ts:33`).
2. `outputPath` does not contain `publicPath` (subdirectory heuristic) → throw with a suggestion.

Branch 2 was implemented and **reverted**: it broke 15 integration tests. Root cause: those tests (and real Reprise usage) pass an `outputPath` that is an arbitrary temp/output directory decoupled from `publicPath` (a URL prefix). Encore couples the two only for its webpack-dev-server `getContentBase` document-root derivation — logic Reprise does not have (native dev server). In Reprise, `manifestKeyPrefix` derives from `publicPath` alone, independent of `outputPath`, so branch 2 rejects valid configs and protects nothing. It is intentionally not ported. Encore itself has no test asserting branch 2 throws — its subdirectory test (`config-generator.js:220`) sets `manifestKeyPrefix`, so branch 2 never fires; the expected pattern is "set `manifestKeyPrefix` for a subdir", which Reprise already supports (`options.test.ts:28`).

## Coverage gap vs Encore

Comparing the publicPath / manifestKeyPrefix / CDN slice (the rest of Encore's `config-generator.js` / `functional.js` covers bundler-native config — Sass, Babel, splitChunks, loaders — intentionally out of scope):

| Encore test | Reprise |
|---|---|
| `config-generator.js`: normal publicPath → `build/` | ✅ `options.test.ts:23` |
| `config-generator.js:220`: subdir + explicit manifestKeyPrefix | ✅ `options.test.ts:28` |
| `config-generator.js:237`: empty manifestKeyPrefix | ⚠️ not asserted |
| `functional.js:256`: `setPublicPath('http://…')` real build → CDN URLs in manifest/entrypoints | ❌ missing (only config-level) |

This spec closes the two gaps.

## Changes

### 1. CDN end-to-end integration test (the real gap)

New file `assets/test/integration/cdn.test.ts`, one test per bundler, mirroring the existing `vite-build.test.ts` / `rsbuild-build.test.ts` harness (fixture `test/fixtures/basic`, temp `outputPath`, parse emitted JSON). Config: `publicPath: 'https://cdn.example.com/assets/'` + `manifestKeyPrefix: 'assets/'`.

Assertions:
- `entrypoints.json` `publicPath` equals the CDN URL; entry `js[0]` matches `https://cdn.example.com/assets/…`.
- `manifest.json` values are all CDN-prefixed. For Vite, the key `assets/app.js` maps to a CDN URL (Vite entry `logicalName` is `<name>.js`). For Rsbuild, assert only that keys exist and every value is CDN-prefixed (Rspack logical names differ; same convention as the existing rsbuild-build test).

The trailing slash on `publicPath` avoids Vite's "base should end with /" normalization; it also matches Reprise's default `/build/`.

**These characterize existing behaviour and are expected to pass on the first run.** A failure would mean a genuine CDN bug in a real build — in that case, stop and fix the bug before the tests land.

### 2. Empty manifestKeyPrefix unit test (parity)

Add to `assets/test/core/options.test.ts`: `normalizeOptions({ publicPath: '/build/', manifestKeyPrefix: '' }, '/app')` yields `manifestKeyPrefix === ''`. Current code preserves it (`options?.manifestKeyPrefix ?? null` keeps `''`, skipping derivation), so this too passes as-is — it locks the behaviour.

## Docs

Correct the stale `AGENTS.md` "Symfony integration contract" paragraph: it says the guard is TODO and mentions a dead `publicPath === null` branch in `index.ts`. Reword to state branch 1 is implemented and tested, branch 2 is intentionally not ported (outputPath/publicPath are decoupled in Reprise), and drop the dead-branch sentence (no such branch exists in the current `index.ts`).

## Out of scope

- Branch 2 subdir guard (rejected above).
- Protocol-relative `//cdn` handling — Encore checks only `://`.
- SRI and shared runtime chunk — separate spec + plan each.
