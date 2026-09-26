import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

// The other side of `style-entry.test.ts`: a CSS Module imported *from* a JS entry, which is how CSS Modules
// are meant to be used. The entry keeps its script (it carries the class-name mapping) and the extracted CSS
// joins its `css` bucket, exactly like a plain stylesheet import.
const fixture = join(import.meta.dirname, '../fixtures/css-modules');
const input = { app: join(fixture, 'app.js') };

interface Entrypoints {
    entryPoints: Record<string, { js: string[]; css: string[] }>;
}

function readEmitted(out: string, url: string): string {
    return readFileSync(join(out, url.replace(/^build\//, '')), 'utf8');
}

function expectScopedBadge(out: string, entrypoints: Entrypoints): void {
    const css = readEmitted(out, entrypoints.entryPoints.app.css[0]);
    // Both bundlers rewrite `.badge` to a generated name; only the mangling proves CSS Modules ran at all.
    expect(css).not.toMatch(/\.badge[\s,{]/);
    expect(css).toMatch(/#639|rebeccapurple/);

    const generated = css.match(/\.([\w-]+)\s*\{/)?.[1];
    expect(generated).toBeTruthy();
    // The mapping is what makes the entry script worth loading, so the same name must reach the JS.
    expect(readEmitted(out, entrypoints.entryPoints.app.js[0])).toContain(generated);
}

describe('CSS Modules imported from a JS entry (Vite/Rsbuild parity)', () => {
    it('vite keeps the entry js and lists the scoped css', async () => {
        const out = tmpDir('cssmod-vite');
        await viteBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const entrypoints: Entrypoints = readJson(out, 'entrypoints.json');
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);
        expect(entrypoints.entryPoints.app.css).toHaveLength(1);
        expectScopedBadge(out, entrypoints);

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/app.js']).toMatch(/\.js$/);
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    });

    it('rsbuild keeps the entry js and lists the scoped css', async () => {
        const out = tmpDir('cssmod-rsbuild');
        await rsbuildBuild(fixture, input, { outputPath: out, publicPath: '/build/' });

        const entrypoints: Entrypoints = readJson(out, 'entrypoints.json');
        expect(entrypoints.entryPoints.app.js).toHaveLength(1);
        expect(entrypoints.entryPoints.app.css).toHaveLength(1);
        expectScopedBadge(out, entrypoints);

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['build/app.js']).toMatch(/\.js$/);
        expect(manifest['build/app.css']).toMatch(/\.css$/);
    });
});
