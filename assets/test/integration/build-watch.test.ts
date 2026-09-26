import type { Options } from '../../src/types';
import { appendFileSync, cpSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import { createCompileWaiter, createSymfonyWriteWaiter, readJson, tmpDir, viteBuild } from './support';

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

// A copy of the fixture, so the rebuild can be triggered by editing its entry.
function importedAssetProject(): string {
    const dir = tmpDir('watch-rebuild-src');
    cpSync(join(import.meta.dirname, '../fixtures/imported-asset'), dir, { recursive: true });
    // Backdated, or the watcher can count the copy itself as a change and rebuild once.
    const past = new Date(Date.now() - 60_000);
    for (const path of [join(dir, 'app.js'), join(dir, 'media/pic.png'), join(dir, 'media'), dir]) {
        utimesSync(path, past, past);
    }
    return dir;
}

function expectUnchangedAssetsKept(out: string): void {
    const manifest = readJson(out, 'manifest.json');
    expect(manifest['build/app.js']).toMatch(/^\/build\/.*app.*\.js$/);
    expect(manifest['build/media/pic.png']).toMatch(/^\/build\//);
    expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
}

describe('a build --watch rebuild keeps the assets it did not re-emit in manifest.json', () => {
    it('vite build --watch', async () => {
        const dir = importedAssetProject();
        const out = tmpDir('watch-rebuild-vite');
        const watcher = (await viteBuild(dir, { app: join(dir, 'app.js') }, options(out), {
            build: { watch: {}, assetsInlineLimit: 0 },
        })) as unknown as Watcher;
        let builds = 0;
        const ended = (count: number): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                watcher.on('event', (event) => {
                    if (event.code === 'END' && ++builds >= count) resolve();
                    if (event.code === 'ERROR') reject(event.error);
                });
            });

        try {
            await ended(1);
            appendFileSync(join(dir, 'app.js'), 'console.log(2);\n');
            await ended(2);
            expectUnchangedAssetsKept(out);
        } finally {
            await watcher.close();
        }
    });

    it('rsbuild build --watch', async () => {
        const dir = importedAssetProject();
        const out = tmpDir('watch-rebuild-rsbuild');
        const compile = createCompileWaiter();
        const first = compile.next();
        const rsbuild = await createRsbuild({
            cwd: dir,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(dir, 'app.js') } },
                output: { dataUriLimit: 0 },
                plugins: [SymfonyRsbuild(options(out)), compile.plugin],
            },
        });
        const result = await rsbuild.build({ watch: true });

        try {
            expect(await first).toEqual([]);
            const rebuilt = compile.next();
            appendFileSync(join(dir, 'app.js'), 'console.log(2);\n');
            expect(await rebuilt).toEqual([]);
            expectUnchangedAssetsKept(out);
        } finally {
            await result.close();
        }
    });
});
