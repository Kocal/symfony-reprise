import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const copySrc = join(import.meta.dirname, '../fixtures/copy-src');
const CDN = 'https://cdn.example.com/assets/';
const CDN_URL_RE = /^https:\/\/cdn\.example\.com\/assets\//;

describe('absolute (CDN) publicPath', () => {
    it('vite build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cdn-vite-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: {
                emptyOutDir: true,
                rollupOptions: { input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
            },
            plugins: [
                SymfonyVite({
                    outputPath: out,
                    publicPath: CDN,
                    manifestKeyPrefix: 'assets/',
                    copy: [{ from: copySrc, to: 'images' }],
                }),
            ],
        });

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js[0]).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest['assets/app.js']).toMatch(/^https:\/\/cdn\.example\.com\/assets\/app-.*\.js$/);
        expect(manifest['assets/images/logo.svg']).toMatch(
            /^https:\/\/cdn\.example\.com\/assets\/images\/logo\.[0-9a-f]{8}\.svg$/
        );
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    }, 30_000);

    it('rsbuild build emits CDN-prefixed URLs in entrypoints.json and manifest.json', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-cdn-rsbuild-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
                plugins: [
                    SymfonyRsbuild({
                        outputPath: out,
                        publicPath: CDN,
                        manifestKeyPrefix: 'assets/',
                        copy: [{ from: copySrc, to: 'images' }],
                    }),
                ],
            },
        });
        await rsbuild.build();

        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));
        expect(entry.publicPath).toBe(CDN);
        expect(entry.entryPoints.app.js.some((u: string) => CDN_URL_RE.test(u))).toBe(true);

        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(Object.keys(manifest).length).toBeGreaterThan(0);
        expect(manifest['assets/images/logo.svg']).toMatch(
            /^https:\/\/cdn\.example\.com\/assets\/images\/logo\.[0-9a-f]{8}\.svg$/
        );
        for (const value of Object.values(manifest)) {
            expect(value).toMatch(CDN_URL_RE);
        }
    }, 60_000);
});
