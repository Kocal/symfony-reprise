import type { CopyResult } from '../../src/core/copy';
import type { EntrypointsJson, NormalizedGraph, Options, ResolvedOptions } from '../../src/types';
import { mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { watchIgnore, writeMetadata, writeSymfonyFiles } from '../../src/core/emit';
import { computeIntegrity } from '../../src/core/integrity';
import { normalizeOptions } from '../../src/core/options';
import { slash } from '../../src/core/paths';

vi.mock('node:fs', async (importOriginal) => {
    const fs = await importOriginal<typeof import('node:fs')>();
    return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

const files = ['entrypoints.json', 'manifest.json'];

function entrypoints(publicPath: string): EntrypointsJson {
    return {
        isProd: true,
        devServer: null,
        publicPath,
        entryPoints: { app: { js: [`${publicPath}app.js`], css: [], preload: [], dynamic: [] } },
    };
}

describe('writeSymfonyFiles', () => {
    it.each([false, true])('overwrites both files and leaves no temporary file behind (rename fails: %s)', (fails) => {
        const dir = mkdtempSync(join(tmpdir(), 'reprise-emit-'));
        writeSymfonyFiles(dir, entrypoints('/build/'), { 'build/app.js': '/build/app.js' });

        if (fails) {
            vi.mocked(renameSync).mockImplementation(() => {
                throw new Error('EPERM');
            });
        }
        try {
            writeSymfonyFiles(dir, entrypoints('/assets/'), { 'assets/app.js': '/assets/app.js' });
        } finally {
            vi.mocked(renameSync).mockReset();
        }

        expect(readdirSync(dir).sort()).toEqual(files);
        expect(JSON.parse(readFileSync(join(dir, 'entrypoints.json'), 'utf8'))).toEqual(entrypoints('/assets/'));
        expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toEqual({
            'assets/app.js': '/assets/app.js',
        });
    });

    it.skipIf(process.platform === 'win32')('replaces the files instead of rewriting them in place', () => {
        const dir = mkdtempSync(join(tmpdir(), 'reprise-emit-'));
        const inodes = () => files.map((file) => statSync(join(dir, file)).ino);

        writeSymfonyFiles(dir, entrypoints('/build/'), {});
        const before = inodes();
        writeSymfonyFiles(dir, entrypoints('/build/'), {});
        const after = inodes();

        expect(after[0]).not.toBe(before[0]);
        expect(after[1]).not.toBe(before[1]);
    });
});

describe('watchIgnore', () => {
    it('covers the output dir and every path writeSymfonyFiles touches, and nothing else', () => {
        const dir = mkdtempSync(join(tmpdir(), 'reprise-emit-'));
        vi.mocked(renameSync).mockClear();
        writeSymfonyFiles(dir, entrypoints('/build/'), {});
        const written = vi
            .mocked(renameSync)
            .mock.calls.flat()
            .map((path) => slash(String(path)));
        const outputDir = `${slash(dir)}/build`;
        const { pattern, globs } = watchIgnore({ outputPath: `${outputDir}/`, metadataPath: dir });
        const globbed = (path: string): boolean => globs.some((glob) => posix.matchesGlob(path, glob));

        expect(written).toHaveLength(4);
        expect(pattern.test(slash(dir))).toBe(true);
        for (const path of [...written, outputDir, `${outputDir}/app.js`]) {
            expect(pattern.test(path), path).toBe(true);
            expect(globbed(path), path).toBe(true);
        }
        for (const path of [`${slash(dir)}/app.js`, `${slash(dir)}.old/manifest.json`, `${outputDir}er/app.js`]) {
            expect(pattern.test(path), path).toBe(false);
            expect(globbed(path), path).toBe(false);
        }
    });
});

describe('writeMetadata', () => {
    const graph: NormalizedGraph = {
        entryPoints: { app: { js: ['app-a1.js'], css: ['app-b2.css'], preload: [], dynamic: [] } },
        assets: [
            { logicalName: 'app.js', fileName: 'app-a1.js' },
            { logicalName: 'images/logo.svg', fileName: 'images/logo.svg' },
        ],
    };
    const copied = (physicalName: string, versionQuery: string, logicalName = physicalName): CopyResult => ({
        logicalName,
        physicalName,
        versionQuery,
        source: Buffer.from(''),
    });

    function setup(options: Options = {}): { dir: string; resolved: ResolvedOptions } {
        const dir = mkdtempSync(join(tmpdir(), 'reprise-metadata-'));
        return { dir, resolved: normalizeOptions({ outputPath: dir, ...options }, dir) };
    }

    function read(dir: string, file: string): Record<string, unknown> {
        return JSON.parse(readFileSync(join(dir, file), 'utf8'));
    }

    it('build: keys the graph assets and the copied files in one sorted manifest, copied files winning', () => {
        const { dir, resolved } = setup();
        writeMetadata(resolved, graph, {
            isProd: true,
            devServer: null,
            copyFiles: [copied('images/logo.svg', '?c0ffee00'), copied('fonts/a.1234abcd.woff2', '', 'fonts/a.woff2')],
        });

        expect(read(dir, 'entrypoints.json')).toEqual({
            isProd: true,
            devServer: null,
            publicPath: '/build/',
            entryPoints: { app: { js: ['build/app-a1.js'], css: ['build/app-b2.css'], preload: [], dynamic: [] } },
        });
        const manifest = read(dir, 'manifest.json');
        expect(Object.entries(manifest)).toEqual([
            ['build/app.js', '/build/app-a1.js'],
            ['build/fonts/a.woff2', '/build/fonts/a.1234abcd.woff2'],
            ['build/images/logo.svg', '/build/images/logo.svg?c0ffee00'],
        ]);
    });

    it('dev: points the entries at the dev server and keys only the copied files, under publicPath', () => {
        const { dir, resolved } = setup();
        const devServer = { origin: 'http://localhost:5173', client: null };
        writeMetadata(resolved, graph, { isProd: false, devServer, copyFiles: [copied('images/logo.svg', '')] });

        expect(read(dir, 'entrypoints.json')).toEqual({
            isProd: false,
            devServer,
            publicPath: '/build/',
            entryPoints: {
                app: {
                    js: ['http://localhost:5173/build/app-a1.js'],
                    css: ['http://localhost:5173/build/app-b2.css'],
                    preload: [],
                    dynamic: [],
                },
            },
        });
        expect(read(dir, 'manifest.json')).toEqual({ 'build/images/logo.svg': '/build/images/logo.svg' });
    });

    it('hashes the entry files off disk for SRI, in build only', () => {
        const { dir, resolved } = setup({ integrity: { enabled: true } });
        writeFileSync(join(dir, 'app-a1.js'), 'js');
        writeFileSync(join(dir, 'app-b2.css'), 'css');

        writeMetadata(resolved, graph, { isProd: true, devServer: null, copyFiles: [] });
        expect(read(dir, 'entrypoints.json').integrity).toEqual({
            'build/app-a1.js': computeIntegrity('js', ['sha384']),
            'build/app-b2.css': computeIntegrity('css', ['sha384']),
        });

        writeMetadata(resolved, graph, {
            isProd: false,
            devServer: { origin: 'http://localhost:5173', client: null },
            copyFiles: [],
        });
        expect(read(dir, 'entrypoints.json').integrity).toBeUndefined();
    });
});
