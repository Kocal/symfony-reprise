import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// The entry lazily imports a module that pulls in its own CSS. That CSS ships as an async chunk
// stylesheet, loaded at runtime with the chunk (never via asset()), so it must not appear in
// manifest.json — Rsbuild already omits it, and keeping it in Vite caused a divergence and a
// same-name collision (see the collector unit tests).
const fixture = join(import.meta.dirname, '../fixtures/async-css');

describe('async chunk CSS is kept out of the manifest (Vite/Rsbuild parity)', () => {
    it('vite omits the async chunk CSS but still emits the file', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-async-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
        });

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest).some((k) => k.includes('widget'))).toBe(false);
        // The stylesheet is still emitted to disk, it just has no manifest key.
        expect(readdirSync(out).some((f) => f.endsWith('.css'))).toBe(true);
    }, 30_000);

    it('rsbuild also omits the async chunk CSS', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-async-rsbuild-'));
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
        expect(Object.keys(manifest).some((k) => k.includes('widget'))).toBe(false);
        expect(existsSync(join(out, 'manifest.json'))).toBe(true);
    }, 60_000);
});
