import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// `@font-face { src: url('./x.woff2?v=1') }` and `url('./icon.svg#frag')` are everyday CSS. The
// query/fragment addresses the *reference*, not the file, so both bundlers must key the emitted asset
// under the bare source path — otherwise `asset('fonts/query.woff2')` misses in Twig on one bundler only.
const fixture = join(import.meta.dirname, '../fixtures/css-url-query');
const input = { app: join(fixture, 'app.js') };

describe('css url() query and fragment are stripped from manifest keys (Vite/Rsbuild parity)', () => {
    it('vite keys the asset without the query or fragment', async () => {
        const out = tmpDir('urlq-vite');
        await viteBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/' },
            { build: { assetsInlineLimit: 0 } }
        );

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/fonts/query.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/fonts/plain.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/media/icon.svg']).toMatch(/^\/build\/.*\.svg$/);
        expect(Object.keys(manifest).filter((k) => k.includes('?') || k.includes('#'))).toEqual([]);
    });

    it('rsbuild keys the asset without the query or fragment', async () => {
        const out = tmpDir('urlq-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' }, { output: { dataUriLimit: 0 } });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/fonts/query.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/fonts/plain.woff2']).toMatch(/^\/build\/.*\.woff2$/);
        expect(manifest['build/media/icon.svg']).toMatch(/^\/build\/.*\.svg$/);
        expect(Object.keys(manifest).filter((k) => k.includes('?') || k.includes('#'))).toEqual([]);
    });
});
