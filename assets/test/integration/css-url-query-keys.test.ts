import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// `@font-face { src: url('./x.woff2?v=1') }` and `url('./icon.svg#frag')` are everyday CSS. The
// query/fragment addresses the *reference*, not the file, so both bundlers must key the emitted asset
// under the bare source path — otherwise `asset('fonts/query.woff2')` misses in Twig on one bundler only.
const fixture = join(import.meta.dirname, '../fixtures/css-url-query');

describe('css url() query and fragment are stripped from manifest keys (Vite/Rsbuild parity)', () => {
    it('vite keys the asset without the query or fragment', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-urlq-vite-'));
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
        expect(manifest['build/fonts/query.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/fonts/plain.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/media/icon.svg']).toMatch(/^\/build\/.*\.svg$/);
        expect(Object.keys(manifest).filter((k) => k.includes('?') || k.includes('#'))).toEqual([]);
    }, 30_000);

    it('rsbuild keys the asset without the query or fragment', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-urlq-rsbuild-'));
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
        expect(manifest['build/fonts/query.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/fonts/plain.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/media/icon.svg']).toMatch(/^\/build\/.*\.svg$/);
        expect(Object.keys(manifest).filter((k) => k.includes('?') || k.includes('#'))).toEqual([]);
    }, 60_000);
});
