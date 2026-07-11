import type { RsbuildPlugin } from '@rsbuild/core';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build, createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const copySrc = join(import.meta.dirname, '../fixtures/copy-src');
const copyBinary = join(import.meta.dirname, '../fixtures/copy-binary');
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

    it('build: a `to` with a leading "./" yields clean, non-relative fileNames and manifest keys', async () => {
        // Regression: Rollup rejects an emitted asset fileName that looks relative ("./images/…"),
        // so this build threw before `to` normalization stripped the leading "./".
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-dotslash-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [
                SymfonyVite({ outputPath: out, publicPath: '/build/', copy: [{ from: copySrc, to: './images/' }] }),
            ],
        });
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(Object.keys(manifest).some((k) => k.includes('/./'))).toBe(false);
    }, 30_000);

    it('build: preserves binary file bytes exactly', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-bin-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', copy: [{ from: copyBinary, to: 'bin' }] })],
        });
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        const physical = manifest['build/bin/pixel.png'].replace('/build/', '');
        expect(readFileSync(join(out, physical)).equals(readFileSync(join(copyBinary, 'pixel.png')))).toBe(true);
    }, 30_000);

    it('build: emits copied files as bundle assets (shown in the output)', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-vite-emit-'));
        let bundleKeys: string[] = [];
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [
                SymfonyVite({ outputPath: out, publicPath: '/build/', copy }),
                {
                    name: 'capture-bundle',
                    generateBundle(_options, bundle) {
                        bundleKeys = Object.keys(bundle);
                    },
                },
            ],
        });
        expect(bundleKeys.some((k) => /^images\/logo\.[0-9a-f]{8}\.svg$/.test(k))).toBe(true);
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

    it('build: a `to` with a leading "./" yields clean manifest keys (no "build/./…")', async () => {
        // Regression: without `to` normalization the keys came out as "build/./images/…".
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-dotslash-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [
                    SymfonyRsbuild({
                        outputPath: out,
                        publicPath: '/build/',
                        copy: [{ from: copySrc, to: './images/' }],
                    }),
                ],
            },
        });
        await rsbuild.build();
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(Object.keys(manifest).some((k) => k.includes('/./'))).toBe(false);
    }, 60_000);

    it('build: preserves binary file bytes exactly', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-bin-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [
                    SymfonyRsbuild({ outputPath: out, publicPath: '/build/', copy: [{ from: copyBinary, to: 'bin' }] }),
                ],
            },
        });
        await rsbuild.build();
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        const physical = manifest['build/bin/pixel.png'].replace('/build/', '');
        expect(readFileSync(join(out, physical)).equals(readFileSync(join(copyBinary, 'pixel.png')))).toBe(true);
    }, 60_000);

    it('build: emits copied files as Rspack compilation assets (shown in the output)', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-emit-'));
        let assetNames: string[] = [];
        const captureAssets: RsbuildPlugin = {
            name: 'capture-assets',
            setup(api) {
                api.onAfterCreateCompiler(({ compiler }) => {
                    const cs = 'compilers' in compiler ? compiler.compilers : [compiler];
                    for (const c of cs) {
                        c.hooks.done.tap('capture-assets', (stats) => {
                            assetNames = ((stats.toJson({ assets: true }).assets ?? []) as { name: string }[]).map(
                                (a) => a.name
                            );
                        });
                    }
                });
            },
        };
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/', copy }), captureAssets],
            },
        });
        await rsbuild.build();
        expect(assetNames.some((n) => /^images\/logo\.[0-9a-f]{8}\.svg$/.test(n))).toBe(true);
    }, 60_000);

    it('dev: copies files verbatim on disk and keys them with relative URLs in manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-copy-rsbuild-dev-'));
        let resolveWritten: () => void;
        const symfonyWritten = new Promise<void>((resolve) => {
            resolveWritten = resolve;
        });
        const waitForSymfonyWrite: RsbuildPlugin = {
            name: 'test-wait-for-symfony-write',
            setup(api) {
                api.onAfterCreateCompiler(({ compiler }) => {
                    const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                    // Resolves `symfonyWritten` on the first compile only. Fine for this single-compile
                    // dev test; an HMR/rebuild test reusing this pattern would need to re-arm the
                    // promise per compile instead of resolving once.
                    for (const c of compilers) {
                        c.hooks.done.tap('test-wait-for-symfony-write', () => resolveWritten());
                    }
                });
            },
        };
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/', copy }), waitForSymfonyWrite],
            },
        });
        const server = await rsbuild.startDevServer();
        await symfonyWritten;
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
