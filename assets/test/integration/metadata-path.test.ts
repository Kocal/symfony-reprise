import type { RsbuildPlugin } from '@rsbuild/core';
import type { InlineConfig } from 'vite';
import type { Options } from '../../src/types';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build, createServer as createViteServer } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createSymfonyWriteWaiter, getFreePort } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const entry = { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') };

function dirs(label: string): { out: string; meta: string } {
    return {
        out: mkdtempSync(join(tmpdir(), `ups-meta-${label}-out-`)),
        meta: mkdtempSync(join(tmpdir(), `ups-meta-${label}-meta-`)),
    };
}

function viteConfig(options: Options, extra?: InlineConfig): InlineConfig {
    return {
        root: fixture,
        logLevel: 'silent',
        ...extra,
        build: { rollupOptions: { input: entry }, ...extra?.build },
        plugins: [SymfonyVite({ publicPath: '/build/', ...options })],
    };
}

function rsbuildConfig(
    options: Options,
    mode: 'production' | 'development',
    dev?: { plugins: RsbuildPlugin[]; port: number }
) {
    return {
        cwd: fixture,
        rsbuildConfig: {
            mode,
            source: { entry },
            ...(dev ? { server: { port: dev.port } } : {}),
            plugins: [SymfonyRsbuild({ publicPath: '/build/', ...options }), ...(dev?.plugins ?? [])],
        },
    } satisfies Parameters<typeof createRsbuild>[0];
}

function expectMetadataOnlyIn(meta: string, out: string): void {
    for (const file of ['entrypoints.json', 'manifest.json']) {
        expect(existsSync(join(meta, file)), `${file} written to metadataPath`).toBe(true);
        expect(existsSync(join(out, file)), `${file} kept out of outputPath`).toBe(false);
    }
}

function readJson(dir: string, file: string): Record<string, never> {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

function expectSha384Integrity(entrypoints: Record<string, never>): void {
    const integrity = entrypoints.integrity as Record<string, string> | undefined;
    expect(integrity).toBeDefined();
    expect(Object.keys(integrity!).length).toBeGreaterThan(0);
    for (const hash of Object.values(integrity!)) {
        expect(hash).toMatch(/^sha384-/);
    }
}

describe('metadataPath separate from outputPath (cross-bundler parity)', () => {
    describe('build mode', () => {
        it('vite build writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('vite');

            await build(viteConfig({ outputPath: out, metadataPath: meta }, { build: { emptyOutDir: true } }));

            expectMetadataOnlyIn(meta, out);

            // Compiled assets still land in outputPath
            expect(readdirSync(out).some((f) => /^app-.*\.js$/.test(f))).toBe(true);

            const entrypoints = readJson(meta, 'entrypoints.json');
            expect(entrypoints.isProd).toBe(true);
            expect(Object.keys(entrypoints.entryPoints).sort()).toEqual(['admin', 'app']);

            expect(readJson(meta, 'manifest.json')['build/app.js']).toMatch(/^\/build\/app-.*\.js$/);
        }, 30_000);

        it('rsbuild build writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('rsbuild');

            const rsbuild = await createRsbuild(rsbuildConfig({ outputPath: out, metadataPath: meta }, 'production'));
            await rsbuild.build();

            expectMetadataOnlyIn(meta, out);

            // Compiled assets still land in outputPath
            const files = readdirSync(out, { recursive: true }).map((f) => String(f).replace(/\\/g, '/'));
            expect(files.some((f) => /^static\/js\/app\..*\.js$/.test(f))).toBe(true);

            const entrypoints = readJson(meta, 'entrypoints.json');
            expect(entrypoints.isProd).toBe(true);
            expect(Object.keys(entrypoints.entryPoints).sort()).toEqual(['admin', 'app']);

            expect(Object.keys(readJson(meta, 'manifest.json')).length).toBeGreaterThan(0);
        }, 60_000);

        it('vite build with SRI hashes assets in outputPath and writes the digest to metadataPath', async () => {
            const { out, meta } = dirs('sri-vite');

            await build(
                viteConfig(
                    { outputPath: out, metadataPath: meta, integrity: { enabled: true } },
                    { build: { emptyOutDir: true } }
                )
            );

            expectMetadataOnlyIn(meta, out);
            expectSha384Integrity(readJson(meta, 'entrypoints.json'));
        }, 30_000);

        it('rsbuild build with SRI hashes assets in outputPath and writes the digest to metadataPath', async () => {
            const { out, meta } = dirs('sri-rsbuild');

            const rsbuild = await createRsbuild(
                rsbuildConfig({ outputPath: out, metadataPath: meta, integrity: { enabled: true } }, 'production')
            );
            await rsbuild.build();

            expectMetadataOnlyIn(meta, out);
            expectSha384Integrity(readJson(meta, 'entrypoints.json'));
        }, 60_000);
    });

    describe('dev mode', () => {
        it('vite dev writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('dev-vite');

            const server = await createViteServer(
                viteConfig({ outputPath: out, metadataPath: meta }, { server: { port: 0, host: '127.0.0.1' } })
            );
            await server.listen();

            try {
                expectMetadataOnlyIn(meta, out);

                const entrypoints = readJson(meta, 'entrypoints.json');
                expect(entrypoints.isProd).toBe(false);
                expect(entrypoints.devServer).not.toBeNull();
            } finally {
                await server.close();
            }
        }, 30_000);

        it('rsbuild dev writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('dev-rsbuild');
            const port = await getFreePort();
            const { plugin: waitForSymfonyWrite, written: symfonyWritten } = createSymfonyWriteWaiter();

            const rsbuild = await createRsbuild(
                rsbuildConfig({ outputPath: out, metadataPath: meta }, 'development', {
                    plugins: [waitForSymfonyWrite],
                    port,
                })
            );
            const server = await rsbuild.startDevServer();
            await symfonyWritten;

            try {
                expectMetadataOnlyIn(meta, out);

                const entrypoints = readJson(meta, 'entrypoints.json');
                expect(entrypoints.isProd).toBe(false);
                expect(entrypoints.devServer).not.toBeNull();
            } finally {
                await server.server.close();
            }
        }, 60_000);
    });
});
