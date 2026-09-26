import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// The entry lazily imports a module that pulls in its own CSS. That CSS ships as an async chunk
// stylesheet, loaded at runtime with the chunk (never via asset()), so it must not appear in
// manifest.json — Rsbuild already omits it, and keeping it in Vite caused a divergence and a
// same-name collision (see the collector unit tests).
const fixture = join(import.meta.dirname, '../fixtures/async-css');
const input = { app: join(fixture, 'app.js') };

describe('async chunk CSS is kept out of the manifest (Vite/Rsbuild parity)', () => {
    it('vite omits the async chunk CSS but still emits the file', async () => {
        const out = tmpDir('async-vite');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).some((k) => k.includes('widget'))).toBe(false);
        // The stylesheet is still emitted to disk, it just has no manifest key.
        expect(readdirSync(out).some((f) => f.endsWith('.css'))).toBe(true);
    });

    it('rsbuild also omits the async chunk CSS', async () => {
        const out = tmpDir('async-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).some((k) => k.includes('widget'))).toBe(false);
        expect(existsSync(join(out, 'manifest.json'))).toBe(true);
    });
});
