import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, rsbuildDev, tmpDir, viteBuild, viteDev } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const entry = { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') };

function dirs(label: string): { out: string; meta: string } {
    return {
        out: tmpDir(`meta-${label}-out`),
        meta: tmpDir(`meta-${label}-meta`),
    };
}

function expectMetadataOnlyIn(meta: string, out: string): void {
    for (const file of ['entrypoints.json', 'manifest.json']) {
        expect(existsSync(join(meta, file)), `${file} written to metadataPath`).toBe(true);
        expect(existsSync(join(out, file)), `${file} kept out of outputPath`).toBe(false);
    }
}

function expectSha384Integrity(entrypoints: Record<string, never>): void {
    const integrity = entrypoints.integrity as Record<string, string> | undefined;
    expect(integrity).toBeDefined();
    expect(Object.keys(integrity!).length).toBeGreaterThan(0);
    for (const hash of Object.values(integrity!)) {
        expect(hash).toMatch(/^sha384-/);
    }
}

describe('metadataPath separate from outputPath (cross-bundler parity)', () => {
    describe('build mode', () => {
        it('vite build writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('vite');

            await viteBuild(fixture, entry, { publicPath: '/build/', outputPath: out, metadataPath: meta });

            expectMetadataOnlyIn(meta, out);

            // Compiled assets still land in outputPath
            expect(readdirSync(out).some((f) => /^app-.*\.js$/.test(f))).toBe(true);

            const entrypoints = readJson(meta, 'entrypoints.json');
            expect(entrypoints.isProd).toBe(true);
            expect(Object.keys(entrypoints.entryPoints).sort()).toEqual(['admin', 'app']);

            expect(readJson(meta, 'manifest.json')['build/app.js']).toMatch(/^\/build\/app-.*\.js$/);
        });

        it('rsbuild build writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('rsbuild');

            await rsbuildBuild(fixture, entry, { publicPath: '/build/', outputPath: out, metadataPath: meta });

            expectMetadataOnlyIn(meta, out);

            // Compiled assets still land in outputPath
            const files = readdirSync(out, { recursive: true }).map((f) => String(f).replace(/\\/g, '/'));
            expect(files.some((f) => /^static\/js\/app\..*\.js$/.test(f))).toBe(true);

            const entrypoints = readJson(meta, 'entrypoints.json');
            expect(entrypoints.isProd).toBe(true);
            expect(Object.keys(entrypoints.entryPoints).sort()).toEqual(['admin', 'app']);

            expect(Object.keys(readJson(meta, 'manifest.json')).length).toBeGreaterThan(0);
        });

        it('vite build with SRI hashes assets in outputPath and writes the digest to metadataPath', async () => {
            const { out, meta } = dirs('sri-vite');

            await viteBuild(fixture, entry, {
                publicPath: '/build/',
                outputPath: out,
                metadataPath: meta,
                integrity: { enabled: true },
            });

            expectMetadataOnlyIn(meta, out);
            expectSha384Integrity(readJson(meta, 'entrypoints.json'));
        });

        it('rsbuild build with SRI hashes assets in outputPath and writes the digest to metadataPath', async () => {
            const { out, meta } = dirs('sri-rsbuild');

            await rsbuildBuild(fixture, entry, {
                publicPath: '/build/',
                outputPath: out,
                metadataPath: meta,
                integrity: { enabled: true },
            });

            expectMetadataOnlyIn(meta, out);
            expectSha384Integrity(readJson(meta, 'entrypoints.json'));
        });
    });

    describe('dev mode', () => {
        it('vite dev writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('dev-vite');

            const server = await viteDev(
                fixture,
                entry,
                { publicPath: '/build/', outputPath: out, metadataPath: meta },
                { server: { host: '127.0.0.1' } }
            );

            try {
                expectMetadataOnlyIn(meta, out);

                const entrypoints = readJson(meta, 'entrypoints.json');
                expect(entrypoints.isProd).toBe(false);
                expect(entrypoints.devServer).not.toBeNull();
            } finally {
                await server.close();
            }
        });

        it('rsbuild dev writes entrypoints.json and manifest.json to metadataPath only', async () => {
            const { out, meta } = dirs('dev-rsbuild');

            const server = await rsbuildDev(fixture, entry, {
                publicPath: '/build/',
                outputPath: out,
                metadataPath: meta,
            });

            try {
                expectMetadataOnlyIn(meta, out);

                const entrypoints = readJson(meta, 'entrypoints.json');
                expect(entrypoints.isProd).toBe(false);
                expect(entrypoints.devServer).not.toBeNull();
            } finally {
                await server.server.close();
            }
        });
    });
});
