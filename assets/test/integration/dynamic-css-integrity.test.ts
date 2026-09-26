import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// A CSS-only dynamic import (`import('x.css')`) makes rolldown-vite prune the async JS chunk while still
// listing its name in dynamicImports. The collector must not carry that phantom into `dynamic`, or SRI
// (integrityFromDisk) crashes reading a file that was never written. Common in the wild: a lazy UX
// Stimulus controller whose autoimport is a stylesheet.
const fixture = join(import.meta.dirname, '../fixtures/dynamic-css');
const input = { app: join(fixture, 'app.js') };

function referenced(app: { js: string[]; css: string[]; preload: string[]; dynamic: string[] }): string[] {
    return [...app.js, ...app.css, ...app.preload, ...app.dynamic];
}

describe('CSS-only dynamic import leaves no phantom in `dynamic` (Vite/Rsbuild parity)', () => {
    it('vite: integrity build succeeds and every referenced file exists on disk', async () => {
        const out = tmpDir('dyncss-vite');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/', integrity: { enabled: true } });

        const entry = readJson(out, 'entrypoints.json');
        for (const ref of referenced(entry.entryPoints.app)) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
        for (const ref of Object.keys(entry.integrity ?? {})) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
        // the stylesheet is still emitted, it just carries no phantom JS reference
        expect(readdirSync(out).some((f) => f.endsWith('.css'))).toBe(true);
    });

    it('rsbuild: integrity build succeeds and every referenced file exists on disk', async () => {
        const out = tmpDir('dyncss-rsbuild');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            integrity: { enabled: true, algorithms: ['sha384'] },
        });

        const entry = readJson(out, 'entrypoints.json');
        for (const ref of referenced(entry.entryPoints.app)) {
            expect(existsSync(join(out, ref.replace(/^build\//, '')))).toBe(true);
        }
    });
});
