import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { computeIntegrity } from '../../src/core/integrity';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');

// Every URL in the integrity map must (a) look like an SRI hash and (b) match a fresh
// hash of the actual emitted file — proving the plugin hashed the bytes it shipped.
function assertIntegrityMatchesDisk(out: string, integrity: Record<string, string>): void {
    expect(Object.keys(integrity).length).toBeGreaterThan(0);
    for (const [url, sri] of Object.entries(integrity)) {
        expect(url).toMatch(/^build\//);
        expect(sri).toMatch(/^sha384-/);
        const diskPath = join(out, url.replace(/^build\//, ''));
        expect(computeIntegrity(readFileSync(diskPath), ['sha384'])).toBe(sri);
    }
}

describe('Subresource Integrity', () => {
    it('vite build writes an integrity map matching the emitted files', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-sri-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: {
                emptyOutDir: true,
                rollupOptions: { input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
            },
            plugins: [SymfonyVite({ outputPath: out, integrity: { enabled: true, algorithms: ['sha384'] } })],
        });

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.integrity[entry.entryPoints.app.js[0]]).toMatch(/^sha384-/);
        assertIntegrityMatchesDisk(out, entry.integrity);
    }, 30_000);

    it('rsbuild build writes an integrity map matching the emitted files', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-sri-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out, integrity: { enabled: true, algorithms: ['sha384'] } })],
            },
        });
        await rsbuild.build();

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.integrity[entry.entryPoints.app.js[0]]).toMatch(/^sha384-/);
        assertIntegrityMatchesDisk(out, entry.integrity);
    }, 60_000);

    it('vite build without the option writes no integrity map', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-sri-off-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out })],
        });

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.integrity).toBeUndefined();
    }, 30_000);

    it('rsbuild build without the option writes no integrity map', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-sri-off-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [SymfonyRsbuild({ outputPath: out })],
            },
        });
        await rsbuild.build();

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.integrity).toBeUndefined();
    }, 60_000);
});
