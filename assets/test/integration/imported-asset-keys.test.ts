import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// An image imported from a subdirectory. Both bundlers must key it in manifest.json by its source
// path relative to the project root (`media/pic.png`), not by its basename (`pic.png`) — otherwise
// two same-basename files in different folders would collide, and the key would differ per bundler.
const fixture = join(import.meta.dirname, '../fixtures/imported-asset');

describe('imported asset manifest keys are the source path (Vite/Rsbuild parity)', () => {
    it('vite keys the imported asset by its root-relative path', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-imp-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: {
                emptyOutDir: true,
                assetsInlineLimit: 0,
                rollupOptions: { input: { app: join(fixture, 'app.js') } },
            },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
        });

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/media/pic.png']).toMatch(/^\/build\//);
        expect(manifest['build/pic.png']).toBeUndefined();
    }, 30_000);

    it('rsbuild keys the imported asset by the same root-relative path', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-imp-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                output: { dataUriLimit: 0 },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['build/media/pic.png']).toMatch(/^\/build\//);
        expect(manifest['build/pic.png']).toBeUndefined();
    }, 60_000);
});
