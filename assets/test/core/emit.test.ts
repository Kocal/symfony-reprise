import type { EntrypointsJson } from '../../src/types';
import { mkdtempSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeSymfonyFiles } from '../../src/core/emit';

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
