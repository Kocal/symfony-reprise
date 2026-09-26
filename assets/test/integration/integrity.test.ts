import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeIntegrity } from '../../src/core/integrity';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const app = { app: join(fixture, 'app.js') };
const appAndAdmin = { ...app, admin: join(fixture, 'admin.js') };

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
        const out = tmpDir('sri-vite');
        await viteBuild(fixture, appAndAdmin, {
            outputPath: out,
            integrity: { enabled: true, algorithms: ['sha384'] },
        });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.integrity[entry.entryPoints.app.js[0]]).toMatch(/^sha384-/);
        assertIntegrityMatchesDisk(out, entry.integrity);
    });

    it('rsbuild build writes an integrity map matching the emitted files', async () => {
        const out = tmpDir('sri-rsbuild');
        await rsbuildBuild(fixture, appAndAdmin, {
            outputPath: out,
            integrity: { enabled: true, algorithms: ['sha384'] },
        });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.integrity[entry.entryPoints.app.js[0]]).toMatch(/^sha384-/);
        assertIntegrityMatchesDisk(out, entry.integrity);
    });

    it('vite build without the option writes no integrity map', async () => {
        const out = tmpDir('sri-off-vite');
        await viteBuild(fixture, app, { outputPath: out });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.integrity).toBeUndefined();
    });

    it('rsbuild build without the option writes no integrity map', async () => {
        const out = tmpDir('sri-off-rsbuild');
        await rsbuildBuild(fixture, app, { outputPath: out });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.integrity).toBeUndefined();
    });
});
