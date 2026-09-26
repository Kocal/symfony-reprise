import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');

describe('rsbuild build emits Symfony files and no HTML', () => {
    it('writes entrypoints.json + manifest.json under publicPath, and no per-entry HTML', async () => {
        const out = tmpDir('rsbuild-build');
        await rsbuildBuild(
            fixture,
            { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
            { outputPath: out, publicPath: '/build/' }
        );

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.isProd).toBe(true);
        expect(entry.devServer).toBeNull();
        expect(entry.publicPath).toBe('/build/');
        expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
        expect(entry.entryPoints.app.js.some((u: string) => /^build\/.*\.js$/.test(u))).toBe(true);

        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).length).toBeGreaterThan(0);

        // No per-entry HTML anywhere in the output dir.
        const htmlFiles = readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith('.html'));
        expect(htmlFiles).toEqual([]);
    });

    it('does not throw ERR_FS_CP_EINVAL when outputPath is nested inside the default public dir', async () => {
        // Regression test: Rsbuild's default public dir is `<cwd>/public`. When `outputPath`
        // resolves to a subdirectory of it (Symfony's usual `public/build` layout), Rsbuild's
        // own public-dir copy-on-build tries to copy `public/` into `public/build/` — a
        // subpath of itself — which Node's `fs.cp` rejects with `ERR_FS_CP_EINVAL`.
        const cwd = tmpDir('rsbuild-nested-public');
        const outputPath = join(cwd, 'public', 'build');
        // Rsbuild only attempts the public-dir copy if `<cwd>/public` exists on disk, so it must
        // be created (with something in it, mirroring Symfony's `public/index.php`) for this test
        // to actually exercise the self-copy path rather than short-circuiting before it.
        mkdirSync(join(cwd, 'public'), { recursive: true });
        writeFileSync(join(cwd, 'public', 'index.php'), '<?php // fixture\n');

        await expect(
            rsbuildBuild(cwd, { app: join(fixture, 'app.js') }, { outputPath, publicPath: '/build/' })
        ).resolves.not.toThrow();

        const entry = readJson(outputPath, 'entrypoints.json');
        expect(Object.keys(entry.entryPoints)).toEqual(['app']);
    });

    it('emits ES-module output (loadable under <script type="module">)', async () => {
        const out = tmpDir('rsbuild-esm');
        await rsbuildBuild(fixture, { app: join(fixture, 'app.js') }, { outputPath: out, publicPath: '/build/' });

        // The entry JS chunk is an ES module: ESM output uses `export`/`import` at top level.
        const entry = readJson(out, 'entrypoints.json');
        const appJs = (entry.entryPoints.app.js as string[]).find((u) => u.endsWith('.js'))!;
        const contents = readFileSync(join(out, appJs.replace(/^build\//, '')), 'utf8');
        expect(/\b(export|import)\b/.test(contents)).toBe(true);
    });
});
