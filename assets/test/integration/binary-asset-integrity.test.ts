import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rsbuildBuild, tmpDir, viteBuild } from './support';

// A binary asset must be emitted byte-for-byte. On Rspack, unplugin's `load` loader (injected via
// createRsbuildPlugin for the Stimulus virtual module) attaches to every module unless gated by
// `loadInclude`; being non-`raw`, it re-emits binary as a UTF-8 string and corrupts it (bytes
// >0x7F -> U+FFFD, ~2x size). Guard both bundlers against re-encoding an imported image.
const fixture = join(import.meta.dirname, '../fixtures/imported-asset');
const input = { app: join(fixture, 'app.js') };
const source = readFileSync(join(fixture, 'media/pic.png'));

function emittedPng(out: string): Buffer {
    const pngs = readdirSync(out, { recursive: true })
        .map(String)
        .filter((f) => /\.png$/.test(f));
    expect(pngs).toHaveLength(1);
    return readFileSync(join(out, pngs[0]));
}

describe('binary assets are emitted intact (Vite/Rsbuild parity)', () => {
    it('vite emits the imported image byte-for-byte', async () => {
        const out = tmpDir('bin-vite');
        await viteBuild(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/' },
            { build: { assetsInlineLimit: 0 } }
        );

        expect(emittedPng(out).equals(source)).toBe(true);
    });

    it('rsbuild emits the imported image byte-for-byte', async () => {
        const out = tmpDir('bin-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' }, { output: { dataUriLimit: 0 } });

        expect(emittedPng(out).equals(source)).toBe(true);
    });
});
