# Copy Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `copy` option that copies static files (images, fonts) into `outputPath` and registers them in `manifest.json`, in both build (content-hashed) and dev (verbatim), for Vite and Rsbuild.

**Architecture:** A pure, bundler-agnostic core (`assets/src/core/copy.ts`) enumerates + filters source files, hashes them, and produces both the bytes to write and the manifest fragment. Each bundler adapter calls it: Vite build emits the bytes through Rollup (`emitFile`) and merges the fragment into `manifest.json`; every other path (Vite dev, Rsbuild build + dev) writes the bytes to disk with `fs` and merges the fragment. Copied files are served by the Symfony web server from `public/build` via relative URLs — never the dev server — so the manifest value always uses `publicPath`, not the dev-server origin.

**Tech Stack:** TypeScript (ESM, strict, ES2017 target, `node:` prefix for builtins), Vite + Rollup plugin hooks, native Rsbuild plugin (`@rsbuild/core` + Rspack), Vitest, tsdown build.

## Global Constraints

- ESM only, strict TypeScript, ES2017 target. Use the `node:` prefix for Node builtins.
- New public options go in `assets/src/types.ts` with JSDoc; keep bundler adapters trivial.
- Bundler symmetry: every functional/integration test for one bundler (Vite or Rsbuild) ships with its equivalent for the other, including negative/off cases. Tasks 3 (Vite) and 4 (Rsbuild) ship together — do not merge one without the other.
- Docs: the feature ships with a short section in `doc/index.rst` showing **both** a Vite and an Rsbuild example, and the `*(planned)*`-style bullet is added to both `doc/index.rst` and `README.md` feature lists. Draft/polish prose with the `natural-writing-editor` agent.
- Commit messages: Symfony style, scope `[Copy]` (the feature's own name). Imperative mood, capitalized first word, no trailing period. No `[Tests]`/`[Docs]` scope — tests and docs are part of the feature.
- Manifest value prefix for copied files is always `resolved.publicPath` (relative in dev, absolute/CDN in build), never the dev-server origin.
- Content hash is injected into the file name in build only; dev names are verbatim.

---

## File Structure

- Create `assets/src/core/copy.ts` — enumeration, content hash, hashed-name, resolve (bytes + physical name), manifest fragment, disk write. Pure; no bundler imports.
- Modify `assets/src/types.ts` — add `CopyEntry` (public) and `ResolvedCopyEntry`; add `copy?` to `Options`, `copy` to `ResolvedOptions`.
- Modify `assets/src/core/options.ts` — `normalizeCopy` + wire into `normalizeOptions`.
- Modify `assets/src/core/format.ts` — export `joinUrl` (reused by `copy.ts`).
- Modify `assets/src/index.ts` — Vite build (`generateBundle`) + dev (`configureServer`) copy.
- Modify `assets/src/rsbuild.ts` — Rsbuild build + dev copy in the `compiler.hooks.done` tap.
- Create `assets/test/fixtures/copy-src/` — the source dir tests copy from.
- Create `assets/test/core/copy.test.ts` — unit tests for `core/copy.ts`.
- Modify `assets/test/core/options.test.ts` — `copy` normalization tests.
- Create `assets/test/integration/copy.test.ts` — Vite + Rsbuild, build + dev end-to-end.
- Modify `README.md` and `doc/index.rst` — feature bullet + doc section.

---

## Task 1: Options plumbing (`copy` types + normalization)

**Files:**
- Modify: `assets/src/types.ts`
- Modify: `assets/src/core/options.ts`
- Test: `assets/test/core/options.test.ts`

**Interfaces:**
- Produces: `CopyEntry { from: string; to: string; pattern?: RegExp; includeSubdirectories?: boolean }`, `ResolvedCopyEntry { from: string; to: string; pattern: RegExp; includeSubdirectories: boolean }` (both exported from `types.ts`). `Options.copy?: CopyEntry[]`. `ResolvedOptions.copy: ResolvedCopyEntry[]`.

- [ ] **Step 1: Write the failing normalization tests**

Add to `assets/test/core/options.test.ts` (inside the existing `describe('normalizeOptions', …)`):

```ts
it('defaults copy to an empty array', () => {
    const r = normalizeOptions(undefined, '/app');
    expect(r.copy).toEqual([]);
});

it('resolves a relative copy `from` against cwd and applies defaults', () => {
    const r = normalizeOptions({ copy: [{ from: 'assets/images', to: 'images' }] }, '/app');
    expect(r.copy).toEqual([
        { from: join('/app', 'assets/images'), to: 'images', pattern: /.*/, includeSubdirectories: true },
    ]);
});

it('keeps an absolute copy `from`, strips slashes from `to`, honors pattern/includeSubdirectories', () => {
    const r = normalizeOptions(
        { copy: [{ from: '/src/img', to: '/images/', pattern: /\.svg$/, includeSubdirectories: false }] },
        '/app',
    );
    expect(r.copy[0].from).toBe('/src/img');
    expect(r.copy[0].to).toBe('images');
    expect(r.copy[0].pattern).toEqual(/\.svg$/);
    expect(r.copy[0].includeSubdirectories).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run assets/test/core/options.test.ts`
Expected: FAIL — `r.copy` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the types to `assets/src/types.ts`**

Add these two interfaces (place them just above `ResolvedOptions`):

```ts
export interface CopyEntry {
    /** Source directory, relative to the project root (cwd) or absolute. */
    from: string;
    /** Logical destination prefix used for the manifest key (e.g. `images`). */
    to: string;
    /** Only files whose path relative to `from` matches this regex are copied. Default: every file. */
    pattern?: RegExp;
    /** Recurse into subdirectories of `from`. Default: true. */
    includeSubdirectories?: boolean;
}

export interface ResolvedCopyEntry {
    from: string;
    to: string;
    pattern: RegExp;
    includeSubdirectories: boolean;
}
```

Add the public option to the `Options` interface (after `integrity?`):

```ts
    /**
     * Copy static files (images, fonts…) into the build output and register them
     * in manifest.json, so Twig's `asset('<to>/<path>')` resolves to the file URL.
     * Works in both build (content-hashed names) and dev (verbatim names). Files are
     * written under `outputPath` and served by the Symfony web server from `public/`.
     *
     * ```js
     * Symfony({ copy: [{ from: 'assets/images', to: 'images' }] })
     * ```
     */
    copy?: CopyEntry[];
```

Add the resolved field to `ResolvedOptions` (after `integrity?`):

```ts
    copy: ResolvedCopyEntry[];
```

- [ ] **Step 4: Add `normalizeCopy` and wire it into `assets/src/core/options.ts`**

Add the import at the top (extend the existing type import):

```ts
import type { CopyEntry, Options, ResolvedCopyEntry, ResolvedOptions, ResolvedStimulusOptions } from '../types';
```

Add this helper above `normalizeOptions`:

```ts
function normalizeCopy(copy: CopyEntry[] | undefined, cwd: string): ResolvedCopyEntry[] {
    if (!copy) return [];
    return copy.map((entry) => ({
        from: path.isAbsolute(entry.from) ? entry.from : path.join(cwd, entry.from),
        to: entry.to.replace(/^\/+/, '').replace(/\/+$/, ''),
        pattern: entry.pattern ?? /.*/,
        includeSubdirectories: entry.includeSubdirectories ?? true,
    }));
}
```

In the object returned by `normalizeOptions`, add the field (next to `stimulus` / `integrity`):

```ts
        copy: normalizeCopy(options?.copy, cwd),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run assets/test/core/options.test.ts`
Expected: PASS (all, including the three new ones).

- [ ] **Step 6: Commit**

```bash
git add assets/src/types.ts assets/src/core/options.ts assets/test/core/options.test.ts
git commit -m "[Copy] Add copy option types and normalization"
```

---

## Task 2: Shared core (`assets/src/core/copy.ts`)

**Files:**
- Create: `assets/src/core/copy.ts`
- Modify: `assets/src/core/format.ts` (export `joinUrl`)
- Create fixtures: `assets/test/fixtures/copy-src/logo.svg`, `assets/test/fixtures/copy-src/icons/cat.svg`, `assets/test/fixtures/copy-src/notes.txt`
- Test: `assets/test/core/copy.test.ts`

**Interfaces:**
- Consumes: `ResolvedCopyEntry` (Task 1), `joinUrl` (from `format.ts`).
- Produces:
  - `CopyResult { logicalName: string; physicalName: string; source: Buffer }`
  - `enumerateCopyFiles(entries: ResolvedCopyEntry[]): Array<{ absPath: string; logicalName: string }>`
  - `contentHash(source: Buffer): string` (8 hex chars)
  - `hashedName(logicalName: string, hash: string): string`
  - `resolveCopyFiles(entries: ResolvedCopyEntry[], hashed: boolean): CopyResult[]`
  - `copyManifest(files: CopyResult[], opts: { publicPath: string; manifestKeyPrefix: string }): Record<string, string>`
  - `writeCopyFiles(files: CopyResult[], outputPath: string): void`

- [ ] **Step 1: Create the fixture files**

Create `assets/test/fixtures/copy-src/logo.svg`:

```
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>
```

Create `assets/test/fixtures/copy-src/icons/cat.svg`:

```
<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>
```

Create `assets/test/fixtures/copy-src/notes.txt`:

```
not an image
```

- [ ] **Step 2: Write the failing unit tests**

Create `assets/test/core/copy.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCopyEntry } from '../../src/types';
import {
    contentHash,
    copyManifest,
    enumerateCopyFiles,
    hashedName,
    resolveCopyFiles,
} from '../../src/core/copy';

const src = join(import.meta.dirname, '../fixtures/copy-src');

function entry(over: Partial<ResolvedCopyEntry> = {}): ResolvedCopyEntry {
    return { from: src, to: 'images', pattern: /.*/, includeSubdirectories: true, ...over };
}

describe('enumerateCopyFiles', () => {
    it('recurses and builds forward-slash logical names under `to`', () => {
        const names = enumerateCopyFiles([entry()])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg', 'images/notes.txt']);
    });

    it('filters by pattern against the from-relative path', () => {
        const names = enumerateCopyFiles([entry({ pattern: /\.svg$/ })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg']);
    });

    it('skips subdirectories when includeSubdirectories is false', () => {
        const names = enumerateCopyFiles([entry({ includeSubdirectories: false })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/logo.svg', 'images/notes.txt']);
    });

    it('warns and skips a missing `from` instead of throwing', () => {
        expect(enumerateCopyFiles([entry({ from: join(src, 'does-not-exist') })])).toEqual([]);
    });
});

describe('hashedName', () => {
    it('injects the hash before the extension, preserving subdirs', () => {
        expect(hashedName('images/icons/cat.svg', 'a1b2c3d4')).toBe('images/icons/cat.a1b2c3d4.svg');
    });

    it('appends the hash when there is no extension', () => {
        expect(hashedName('images/LICENSE', 'a1b2c3d4')).toBe('images/LICENSE.a1b2c3d4');
    });
});

describe('resolveCopyFiles', () => {
    it('uses hashed physical names when hashed=true', () => {
        const logo = resolveCopyFiles([entry()], true).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toMatch(/^images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(logo.source).toBeInstanceOf(Buffer);
    });

    it('uses verbatim physical names when hashed=false', () => {
        const logo = resolveCopyFiles([entry()], false).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toBe('images/logo.svg');
    });
});

describe('copyManifest', () => {
    it('keys by manifestKeyPrefix + logicalName, values by joinUrl(publicPath, physicalName)', () => {
        const files = resolveCopyFiles([entry()], true);
        const manifest = copyManifest(files, { publicPath: '/build/', manifestKeyPrefix: 'build/' });
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);
    });
});

describe('contentHash', () => {
    it('is deterministic and 8 hex chars', () => {
        const h = contentHash(Buffer.from('hello'));
        expect(h).toMatch(/^[0-9a-f]{8}$/);
        expect(h).toBe(contentHash(Buffer.from('hello')));
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run assets/test/core/copy.test.ts`
Expected: FAIL — cannot import from `../../src/core/copy` (module does not exist).

- [ ] **Step 4: Export `joinUrl` from `assets/src/core/format.ts`**

Change the declaration:

```ts
export function joinUrl(prefix: string, name: string): string {
    return prefix.endsWith('/') ? prefix + name : `${prefix}/${name}`;
}
```

- [ ] **Step 5: Create `assets/src/core/copy.ts`**

```ts
import type { ResolvedCopyEntry } from '../types';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { joinUrl } from './format';

export interface CopyResult {
    /** Path used for the manifest key, e.g. `images/icons/cat.svg`. */
    logicalName: string;
    /** Path written under outputPath, hashed in build, verbatim in dev. */
    physicalName: string;
    source: Buffer;
}

function walk(dir: string, includeSubdirectories: boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (includeSubdirectories) out.push(...walk(abs, includeSubdirectories));
        } else {
            out.push(abs);
        }
    }
    return out;
}

export function enumerateCopyFiles(entries: ResolvedCopyEntry[]): Array<{ absPath: string; logicalName: string }> {
    const out: Array<{ absPath: string; logicalName: string }> = [];
    for (const entry of entries) {
        let files: string[];
        try {
            files = walk(entry.from, entry.includeSubdirectories);
        } catch {
            console.warn(`[@symfony/reprise] copy: source directory "${entry.from}" not found, skipping`);
            continue;
        }
        for (const absPath of files) {
            const rel = relative(entry.from, absPath).split(sep).join('/');
            if (!entry.pattern.test(rel)) continue;
            out.push({ absPath, logicalName: `${entry.to}/${rel}` });
        }
    }
    return out;
}

export function contentHash(source: Buffer): string {
    return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

export function hashedName(logicalName: string, hash: string): string {
    const ext = extname(logicalName);
    const base = ext ? logicalName.slice(0, -ext.length) : logicalName;
    return `${base}.${hash}${ext}`;
}

export function resolveCopyFiles(entries: ResolvedCopyEntry[], hashed: boolean): CopyResult[] {
    return enumerateCopyFiles(entries).map(({ absPath, logicalName }) => {
        const source = readFileSync(absPath);
        const physicalName = hashed ? hashedName(logicalName, contentHash(source)) : logicalName;
        return { logicalName, physicalName, source };
    });
}

export function copyManifest(
    files: CopyResult[],
    opts: { publicPath: string; manifestKeyPrefix: string }
): Record<string, string> {
    const manifest: Record<string, string> = {};
    for (const file of files) {
        manifest[opts.manifestKeyPrefix + file.logicalName] = joinUrl(opts.publicPath, file.physicalName);
    }
    return manifest;
}

export function writeCopyFiles(files: CopyResult[], outputPath: string): void {
    for (const file of files) {
        const dest = join(outputPath, file.physicalName);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.source);
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run assets/test/core/copy.test.ts`
Expected: PASS. The missing-`from` test prints one `console.warn` line — that is expected.

- [ ] **Step 7: Commit**

```bash
git add assets/src/core/copy.ts assets/src/core/format.ts assets/test/core/copy.test.ts assets/test/fixtures/copy-src
git commit -m "[Copy] Add bundler-agnostic copy core"
```

---

## Task 3: Vite copy (build + dev)

**Files:**
- Modify: `assets/src/index.ts`
- Test: `assets/test/integration/copy.test.ts` (create; Vite cases now, Rsbuild cases in Task 4)

**Interfaces:**
- Consumes: `resolveCopyFiles`, `copyManifest`, `writeCopyFiles` (Task 2); `resolved.copy`, `resolved.publicPath`, `resolved.manifestKeyPrefix` (Task 1).

- [ ] **Step 1: Write the failing Vite integration tests**

Create `assets/test/integration/copy.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const copySrc = join(import.meta.dirname, '../fixtures/copy-src');
const copy = [{ from: copySrc, to: 'images' }];

describe('vite copy', () => {
    it('build: copied files are hashed on disk and keyed in manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-build-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', copy })],
        });

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);

        const physical = manifest['build/images/logo.svg'].replace('/build/', '');
        expect(existsSync(join(out, physical))).toBe(true);
    }, 30_000);

    it('build: no copy option leaves the manifest without image keys', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-off-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
        });
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest).some((k) => k.startsWith('build/images/'))).toBe(false);
    }, 30_000);

    describe('dev', () => {
        let server: Awaited<ReturnType<typeof createServer>>;
        let out: string;

        beforeEach(async () => {
            out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-dev-'));
            server = await createServer({
                root: fixture,
                logLevel: 'silent',
                server: { port: 0, host: '127.0.0.1' },
                build: { rollupOptions: { input: { app: join(fixture, 'app.js') } } },
                plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', copy })],
            });
            await server.listen();
        });

        afterEach(async () => {
            await server.close();
        });

        it('copies files verbatim on disk and keys them with relative URLs in manifest.json', () => {
            const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
            expect(manifest['build/images/logo.svg']).toBe('/build/images/logo.svg');
            expect(manifest['build/images/icons/cat.svg']).toBe('/build/images/icons/cat.svg');
            expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run assets/test/integration/copy.test.ts -t vite`
Expected: FAIL — `build/images/logo.svg` is missing from the manifest (build), and the dev manifest is `{}`.

- [ ] **Step 3: Add copy to the Vite build path in `assets/src/index.ts`**

Add the import (next to the other `./core/*` imports):

```ts
import { copyManifest, resolveCopyFiles, writeCopyFiles } from './core/copy';
```

In the `generateBundle` hook, replace the `manifest.json` emit block so copied bytes are emitted and their fragment merged. The current block is:

```ts
                this.emitFile({
                    type: 'asset',
                    fileName: 'manifest.json',
                    source: `${JSON.stringify(buildManifest(graph, ctx), null, 2)}\n`,
                });
```

Replace with:

```ts
                const copyFiles = resolveCopyFiles(resolved.copy, true);
                for (const file of copyFiles) {
                    this.emitFile({ type: 'asset', fileName: file.physicalName, source: file.source });
                }
                const manifest = {
                    ...buildManifest(graph, ctx),
                    ...copyManifest(copyFiles, {
                        publicPath: resolved.publicPath,
                        manifestKeyPrefix: resolved.manifestKeyPrefix,
                    }),
                };
                this.emitFile({
                    type: 'asset',
                    fileName: 'manifest.json',
                    source: `${JSON.stringify(manifest, null, 2)}\n`,
                });
```

- [ ] **Step 4: Add copy to the Vite dev path in `assets/src/index.ts`**

In `configureServer`, the current call writes an empty manifest:

```ts
                        writeSymfonyFiles(
                            resolved.outputPath,
                            buildEntrypoints(configToDevGraph(server.config), ctx),
                            {}
                        );
```

Replace with (resolve verbatim, write the bytes to disk, pass the fragment as the manifest):

```ts
                        const copyFiles = resolveCopyFiles(resolved.copy, false);
                        writeCopyFiles(copyFiles, resolved.outputPath);
                        writeSymfonyFiles(
                            resolved.outputPath,
                            buildEntrypoints(configToDevGraph(server.config), ctx),
                            copyManifest(copyFiles, {
                                publicPath: resolved.publicPath,
                                manifestKeyPrefix: resolved.manifestKeyPrefix,
                            })
                        );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run assets/test/integration/copy.test.ts -t vite`
Expected: PASS (build hashed + on disk, off case clean, dev verbatim + on disk).

- [ ] **Step 6: Commit**

```bash
git add assets/src/index.ts assets/test/integration/copy.test.ts
git commit -m "[Copy] Copy files into the build and manifest (Vite)"
```

---

## Task 4: Rsbuild copy (build + dev)

**Files:**
- Modify: `assets/src/rsbuild.ts`
- Test: `assets/test/integration/copy.test.ts` (add the Rsbuild `describe`)

**Interfaces:**
- Consumes: `resolveCopyFiles`, `copyManifest`, `writeCopyFiles` (Task 2); `resolved.copy`, `resolved.publicPath`, `resolved.manifestKeyPrefix` (Task 1).

- [ ] **Step 1: Write the failing Rsbuild integration tests**

Append a new top-level `describe` to `assets/test/integration/copy.test.ts`. Add the imports at the top of the file (merge with the existing import lines):

```ts
import { createRsbuild } from '@rsbuild/core';
import SymfonyRsbuild from '../../src/rsbuild';
```

Then append:

```ts
describe('rsbuild copy', () => {
    it('build: copied files are hashed on disk and keyed in manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-build-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/', copy })],
            },
        });
        await rsbuild.build();

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);

        const physical = manifest['build/images/logo.svg'].replace('/build/', '');
        expect(existsSync(join(out, physical))).toBe(true);
    }, 60_000);

    it('build: no copy option leaves the manifest without image keys', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-off-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest).some((k) => k.startsWith('build/images/'))).toBe(false);
    }, 60_000);

    it('dev: copies files verbatim on disk and keys them with relative URLs in manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-dev-'));
        let resolveFirstCompile: () => void;
        const firstCompileDone = new Promise<void>((resolve) => {
            resolveFirstCompile = resolve;
        });
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [
                    SymfonyRsbuild({ outputPath: out, publicPath: '/build/', copy }),
                    {
                        name: 'test-wait-for-first-compile',
                        setup(api) {
                            api.onAfterDevCompile(({ isFirstCompile }) => {
                                if (isFirstCompile) resolveFirstCompile();
                            });
                        },
                    },
                ],
            },
        });
        const server = await rsbuild.startDevServer();
        await firstCompileDone;
        try {
            const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
            expect(manifest['build/images/logo.svg']).toBe('/build/images/logo.svg');
            expect(manifest['build/images/icons/cat.svg']).toBe('/build/images/icons/cat.svg');
            expect(existsSync(join(out, 'images/logo.svg'))).toBe(true);
        } finally {
            await server.server.close();
        }
    }, 60_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run assets/test/integration/copy.test.ts -t rsbuild`
Expected: FAIL — image keys missing (build), dev manifest is `{}`.

- [ ] **Step 3: Add copy to `assets/src/rsbuild.ts`**

Add the import (next to the other `./core/*` imports):

```ts
import { copyManifest, resolveCopyFiles, writeCopyFiles } from './core/copy';
```

In the `c.hooks.done.tap('@symfony/reprise', (stats) => { … })` body, the current manifest line is:

```ts
                        const manifest = isDev ? {} : buildManifest(graph, ctx);
```

Replace it with (resolve hashed in build / verbatim in dev, write bytes to disk, merge the fragment):

```ts
                        const copyFiles = resolveCopyFiles(resolved.copy, !isDev);
                        writeCopyFiles(copyFiles, resolved.outputPath);
                        const copyFragment = copyManifest(copyFiles, {
                            publicPath: resolved.publicPath,
                            manifestKeyPrefix: resolved.manifestKeyPrefix,
                        });
                        const manifest = isDev
                            ? copyFragment
                            : { ...buildManifest(graph, ctx), ...copyFragment };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run assets/test/integration/copy.test.ts -t rsbuild`
Expected: PASS (build hashed + on disk, off case clean, dev verbatim + on disk).

- [ ] **Step 5: Run the whole copy suite for both bundlers**

Run: `pnpm vitest run assets/test/integration/copy.test.ts assets/test/core/copy.test.ts`
Expected: PASS — all Vite and Rsbuild, build and dev, core unit tests.

- [ ] **Step 6: Commit**

```bash
git add assets/src/rsbuild.ts assets/test/integration/copy.test.ts
git commit -m "[Copy] Copy files into the build and manifest (Rsbuild)"
```

---

## Task 5: Documentation

**Files:**
- Modify: `README.md`
- Modify: `doc/index.rst`

**Interfaces:** none (prose only).

- [ ] **Step 1: Add the feature bullet to `README.md`**

In the feature list (the `- 🎯 …` block), add after the `manifest.json` / Asset versioning bullets:

```
- 📁 **File copy**: copy static files (images, fonts…) into the build, keyed in the manifest
```

- [ ] **Step 2: Add the feature bullet to `doc/index.rst`**

In the matching feature list, add after the `manifest.json` / Asset versioning bullets:

```
- **File copy**: copy static files into the build, keyed in the manifest
```

- [ ] **Step 3: Add a `File copy` section to `doc/index.rst`**

Add a new section (place it before `Using a CDN`). Draft/polish the prose with the `natural-writing-editor` agent; the section must show **both** a Vite and an Rsbuild example and note the dev serving model:

```rst
File copy
---------

Some assets are referenced by a stable path straight from your templates —
``{{ asset('build/images/logo.svg') }}`` — rather than imported from JavaScript
or CSS. Point ``copy`` at the directories that hold them and Reprise copies each
file into the build and records it in ``manifest.json``, so the ``asset()`` helper
resolves it to the hashed URL:

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      plugins: [
        Symfony({ copy: [{ from: 'assets/images', to: 'images' }] }),
      ],
    })

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      plugins: [Symfony({ copy: [{ from: 'assets/images', to: 'images' }] })],
    })

``from`` and ``to`` are required: ``from`` is the source directory (relative to your
project root), ``to`` is the destination prefix used for the manifest key. Restrict
which files are copied with ``pattern`` (a regular expression tested against each
file's path relative to ``from``, default: every file), and turn off recursion with
``includeSubdirectories: false``.

In build, files are copied under ``outputPath`` with a content hash in the name for
cache busting. In dev, they are copied verbatim; either way they are written to
``public/build`` and served by the Symfony web server, so they are available whether
or not the dev server is running.
```

- [ ] **Step 4: Verify the docs build/render is not broken and prose is clean**

Run: `pnpm fmt:check`
Expected: PASS (README/rst are not reformatted, or run `pnpm fmt` if needed).
Manually confirm both code blocks (Vite + Rsbuild) are present in the new section.

- [ ] **Step 5: Commit**

```bash
git add README.md doc/index.rst
git commit -m "[Copy] Document the copy option"
```

---

## Final verification

- [ ] **Full test suite**

Run: `pnpm test`
Expected: PASS (all suites).

- [ ] **Lint, format, build**

Run: `pnpm lint && pnpm fmt:check && pnpm build`
Expected: PASS — no lint errors, formatting clean, tsdown builds `assets/dist/` with no type errors.

- [ ] **Spec cross-check**

Confirm against `docs/superpowers/specs/2026-07-11-copy-option-design.md`: API surface (`from`/`to`/`pattern`/`includeSubdirectories`), build hashed + dev verbatim, manifest uses `publicPath`, both bundlers, both modes, docs on both bundlers. All covered by Tasks 1–5.
