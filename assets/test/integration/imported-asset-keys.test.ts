import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// An image imported from a subdirectory. Both bundlers must key it in manifest.json by its source
// path relative to the project root (`media/pic.png`), not by its basename (`pic.png`) — otherwise
// two same-basename files in different folders would collide, and the key would differ per bundler.
const fixture = join(import.meta.dirname, '../fixtures/imported-asset');
const input = { app: join(fixture, 'app.js') };

describe('imported asset manifest keys are the source path (Vite/Rsbuild parity)', () => {
    it('vite keys the imported asset by its root-relative path', async () => {
        const out = tmpDir('imp-vite');
        await viteBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/' },
            { build: { assetsInlineLimit: 0 } }
        );

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/media/pic.png']).toMatch(/^\/build\//);
        expect(manifest['build/pic.png']).toBeUndefined();
    });

    it('rsbuild keys the imported asset by the same root-relative path', async () => {
        const out = tmpDir('imp-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' }, { output: { dataUriLimit: 0 } });

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/media/pic.png']).toMatch(/^\/build\//);
        expect(manifest['build/pic.png']).toBeUndefined();
    });
});
