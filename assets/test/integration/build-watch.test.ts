import type { Options } from '../../src/types';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createSymfonyWriteWaiter } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const entry = { app: join(fixture, 'app.js') };

interface Watcher {
    on(event: 'event', listener: (event: { code: string; error?: unknown }) => void): unknown;
    close(): Promise<void>;
}

function options(out: string): Options {
    return {
        outputPath: out,
        publicPath: '/build/',
        integrity: { enabled: true },
        copy: [{ from: join(import.meta.dirname, '../fixtures/copy-src'), to: 'images' }],
    };
}

function readJson(dir: string, file: string): Record<string, never> {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

function expectBuildOutput(out: string): void {
    const entrypoints = readJson(out, 'entrypoints.json');
    expect(entrypoints.isProd).toBe(true);
    expect(entrypoints.devServer).toBeNull();
    expect(entrypoints.integrity).toBeDefined();

    const manifest = readJson(out, 'manifest.json');
    expect(manifest['build/app.js']).toMatch(/^\/build\/.*app.*\.js$/);
    expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
    expect(existsSync(join(out, 'images/logo.svg')), 'unhashed copy of logo.svg').toBe(false);
}

describe('build --watch writes the same Symfony files as a one-off build', () => {
    it('vite build --watch', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-watch-vite-'));
        const watcher = (await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, watch: {}, rollupOptions: { input: entry } },
            plugins: [SymfonyVite(options(out))],
        })) as unknown as Watcher;

        try {
            await new Promise<void>((resolve, reject) => {
                watcher.on('event', (event) => {
                    if (event.code === 'END') resolve();
                    if (event.code === 'ERROR') reject(event.error);
                });
            });
            expectBuildOutput(out);
        } finally {
            await watcher.close();
        }
    }, 30_000);

    it('rsbuild build --watch', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-watch-rsbuild-'));
        const waiter = createSymfonyWriteWaiter();
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry },
                plugins: [SymfonyRsbuild(options(out)), waiter.plugin],
            },
        });
        const result = await rsbuild.build({ watch: true });

        try {
            await waiter.written;
            expectBuildOutput(out);
        } finally {
            await result.close();
        }
    }, 60_000);
});
