import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildBuild, tmpDir, viteBuild } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const input = { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') };
const copySrc = join(import.meta.dirname, '../fixtures/copy-src');
const CDN = 'https://cdn.example.com/assets/';
const CDN_URL_RE = /^https:\/\/cdn\.example\.com\/assets\//;

describe('absolute (CDN) publicPath', () => {
    it('vite build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = tmpDir('cdn-vite');
        await viteBuild(fixture, input, {
            outputPath: out,
            publicPath: CDN,
            manifestKeyPrefix: 'assets/',
            copy: [{ from: copySrc, to: 'images' }],
        });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js[0]).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);

        const manifest = readJson(out, 'manifest.json');
        expect(manifest['assets/app.js']).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);
        expect(manifest['assets/images/logo.svg']).toMatch(
            /^https:\/\/cdn\.example\.com\/assets\/images\/logo\.[0-9a-f]{8}\.svg$/
        );
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    });

    it('rsbuild build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = tmpDir('cdn-rsbuild');
        await rsbuildBuild(fixture, input, {
            outputPath: out,
            publicPath: CDN,
            manifestKeyPrefix: 'assets/',
            copy: [{ from: copySrc, to: 'images' }],
        });

        const entry = readJson(out, 'entrypoints.json');
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js.some((u: string) => CDN_URL_RE.test(u))).toBe(true);

        const manifest = readJson(out, 'manifest.json');
        expect(Object.keys(manifest).length).toBeGreaterThan(0);
        expect(manifest['assets/images/logo.svg']).toMatch(
            /^https:\/\/cdn\.example\.com\/assets\/images\/logo\.[0-9a-f]{8}\.svg$/
        );
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    });
});
