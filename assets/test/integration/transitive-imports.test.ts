import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

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
    const entrypoints = readJson(out, 'entrypoints.json');
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
        const out = tmpDir('transitive-vite');
        await viteBuild(fixture, entry, { outputPath: out, publicPath: '/build/' });

        expectEveryStaticImportAdvertised(out);
    });

    it('rsbuild build', async () => {
        const out = tmpDir('transitive-rsbuild');
        await rsbuildBuild(
            fixture,
            entry,
            { outputPath: out, publicPath: '/build/' },
            { tools: { rspack: { optimization: { splitChunks: { chunks: 'all', minSize: 0 } } } } }
        );

        expectEveryStaticImportAdvertised(out);
    });
});
