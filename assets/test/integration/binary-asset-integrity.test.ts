import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// A binary asset must be emitted byte-for-byte. On Rspack, unplugin's `load` loader (injected via
// createRsbuildPlugin for the Stimulus virtual module) attaches to every module unless gated by
// `loadInclude`; being non-`raw`, it re-emits binary as a UTF-8 string and corrupts it (bytes
// >0x7F -> U+FFFD, ~2x size). Guard both bundlers against re-encoding an imported image.
const fixture = join(import.meta.dirname, '../fixtures/imported-asset');
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
        const out = mkdtempSync(join(tmpdir(), 'ups-bin-vite-'));
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

        expect(emittedPng(out).equals(source)).toBe(true);
    }, 30_000);

    it('rsbuild emits the imported image byte-for-byte', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-bin-rsbuild-'));
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

        expect(emittedPng(out).equals(source)).toBe(true);
    }, 60_000);
});
