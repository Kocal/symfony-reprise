import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// The `app` entry statically imports CSS but uses a top-level await and is imported by a second entry
// (other.js). Rollup therefore emits `app` as a thin *facade* chunk that only re-imports the real chunk;
// the CSS rides on that real chunk, not the facade. The collector must walk the facade's static imports
// so the entry CSS still lands in entrypoints.json (`css`) and manifest.json (`build/app.css`). Rspack has
// no facade split — it flattens every entry asset into the entrypoint — so Rsbuild gets this for free; the
// test pins the parity. This reproduces the Encore -> Reprise migration bug where entry CSS went missing.
const fixture = join(import.meta.dirname, '../fixtures/facade-css');
const input = { app: join(fixture, 'app.js'), other: join(fixture, 'other.js') };

describe('facade entry CSS is collected (Vite/Rsbuild parity)', () => {
    it('vite collects the entry CSS off the facade chunk', async () => {
        const out = tmpDir('facade-vite');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const entrypoints = readJson(out, 'entrypoints.json');
        const css: string[] = entrypoints.entryPoints.app.css;
        expect(css).toHaveLength(1);
        expect(css[0]).toMatch(/\.css$/);
        expect(existsSync(join(out, css[0].replace(/^build\//, '')))).toBe(true);

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    });

    it('rsbuild collects the entry CSS natively', async () => {
        const out = tmpDir('facade-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const entrypoints = readJson(out, 'entrypoints.json');
        const css: string[] = entrypoints.entryPoints.app.css;
        expect(css).toHaveLength(1);
        expect(css[0]).toMatch(/\.css$/);

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    });
});
