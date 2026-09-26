import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const entry = { app: join(fixture, 'app.js') };

function expectManifestKeyedUnderBuild(out: string): void {
    const manifest: Record<string, string> = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest['build/app.js']).toMatch(/^\/build\/.*app.*\.js$/);
    for (const key of Object.keys(manifest)) {
        expect(key).toMatch(/^build\//);
    }
}

describe('a publicPath without a trailing slash still keys manifest.json under it', () => {
    it('vite build', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-public-path-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: entry } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build' })],
        });

        expectManifestKeyedUnderBuild(out);
    }, 30_000);

    it('rsbuild build', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-public-path-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build' })],
            },
        });
        await rsbuild.build();

        expectManifestKeyedUnderBuild(out);
    }, 60_000);
});
