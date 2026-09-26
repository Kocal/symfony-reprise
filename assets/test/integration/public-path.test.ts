import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const entry = { app: join(fixture, 'app.js') };

function expectManifestKeyedUnderBuild(out: string): void {
    const manifest: Record<string, string> = readJson(out, 'manifest.json');
    expect(manifest['build/app.js']).toMatch(/^\/build\/.*app.*\.js$/);
    for (const key of Object.keys(manifest)) {
        expect(key).toMatch(/^build\//);
    }
}

describe('a publicPath without a trailing slash still keys manifest.json under it', () => {
    it('vite build', async () => {
        const out = tmpDir('public-path-vite');
        await viteBuild(fixture, entry, { outputPath: out, publicPath: '/build' });

        expectManifestKeyedUnderBuild(out);
    });

    it('rsbuild build', async () => {
        const out = tmpDir('public-path-rsbuild');
        await rsbuildBuild(fixture, entry, { outputPath: out, publicPath: '/build' });

        expectManifestKeyedUnderBuild(out);
    });
});
