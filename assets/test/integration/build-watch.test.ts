import type { Options } from '../../src/types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import { createSymfonyWriteWaiter, readJson, tmpDir, viteBuild } from './support';

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
        const out = tmpDir('watch-vite');
        const watcher = (await viteBuild(fixture, entry, options(out), { build: { watch: {} } })) as unknown as Watcher;

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
    });

    it('rsbuild build --watch', async () => {
        const out = tmpDir('watch-rsbuild');
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
    });
});
