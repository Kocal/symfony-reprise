import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/transitive-imports');
// `b` is shared more widely than `a`, so both become chunks and `app` only reaches `b` through `a`.
const entry = {
    app: join(fixture, 'app.js'),
    admin: join(fixture, 'admin.js'),
    third: join(fixture, 'third.js'),
};

const STATIC_IMPORT_RE = /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;

function expectEveryStaticImportAdvertised(out: string): void {
    expect.hasAssertions();
    const entrypoints = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
    const app = entrypoints.entryPoints.app;
    const advertised = new Set<string>([...app.js, ...app.preload]);

    for (const reference of advertised) {
        const code = readFileSync(join(out, reference.replace(/^build\//, '')), 'utf8');
        for (const [, specifier] of code.matchAll(STATIC_IMPORT_RE)) {
            const imported = posix.join(posix.dirname(reference), specifier);
            expect(advertised, `${reference} imports ${imported}`).toContain(imported);
        }
    }
}

describe('an entry advertises every chunk it statically imports, directly or not', () => {
    it('vite build', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-transitive-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: entry } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
        });

        expectEveryStaticImportAdvertised(out);
    }, 30_000);

    it('rsbuild build', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-transitive-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry },
                tools: { rspack: { optimization: { splitChunks: { chunks: 'all', minSize: 0 } } } },
                plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' })],
            },
        });
        await rsbuild.build();

        expectEveryStaticImportAdvertised(out);
    }, 60_000);
});
