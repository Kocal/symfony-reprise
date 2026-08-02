import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

// A CSS-only dynamic import (`import('x.css')`) makes rolldown-vite prune the async JS chunk while still
// listing its name in dynamicImports. The collector must not carry that phantom into `dynamic`, or SRI
// (integrityFromDisk) crashes reading a file that was never written. Common in the wild: a lazy UX
// Stimulus controller whose autoimport is a stylesheet.
const fixture = join(import.meta.dirname, '../fixtures/dynamic-css');

function referenced(app: { js: string[]; css: string[]; preload: string[]; dynamic: string[] }): string[] {
    return [...app.js, ...app.css, ...app.preload, ...app.dynamic];
}

describe('CSS-only dynamic import leaves no phantom in `dynamic` (Vite/Rsbuild parity)', () => {
    it('vite: integrity build succeeds and every referenced file exists on disk', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-dyncss-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', integrity: { enabled: true } })],
        });

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        for (const ref of referenced(entry.entryPoints.app)) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
        for (const ref of Object.keys(entry.integrity ?? {})) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
        // the stylesheet is still emitted, it just carries no phantom JS reference
        expect(readdirSync(out).some((f) => f.endsWith('.css'))).toBe(true);
    }, 30_000);

    it('rsbuild: integrity build succeeds and every referenced file exists on disk', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-dyncss-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [
                    SymfonyRsbuild({
                        outputPath: out,
                        publicPath: '/build/',
                        integrity: { enabled: true, algorithms: ['sha384'] },
                    }),
                ],
            },
        });
        await rsbuild.build();

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        for (const ref of referenced(entry.entryPoints.app)) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
    }, 60_000);
});
