import type { ViteDevServer } from 'vite';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Symfony from '../../src/vite';
import { hasTopLevelInput } from '../vite-version';
import { readJson, tmpDir, viteDev } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');

describe('vite serve writes a dev entrypoints.json', () => {
    let server: ViteDevServer;
    let out: string;

    beforeEach(async () => {
        out = tmpDir('dev');
        server = await viteDev(
            fixture,
            { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
            { outputPath: out, publicPath: '/build/' },
            { server: { host: '127.0.0.1' } }
        );
    });

    afterEach(async () => {
        await server.close();
    });

    it('points entries at the dev-server origin and marks the mode', () => {
        const entry = readJson(out, 'entrypoints.json');

        expect(entry.isProd).toBe(false);
        expect(entry.publicPath).toBe('/build/');
        const origin = entry.devServer.origin;
        expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        // The HMR client is served under `base` (our publicPath), so its URL carries `/build/`.
        expect(entry.devServer.client).toBe(`${origin}/build/@vite/client`);
        // No React plugin in this fixture, so no Fast Refresh preamble URL.
        expect(entry.devServer.reactRefresh ?? null).toBe(null);

        expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
        expect(entry.entryPoints.app.js).toEqual([`${origin}/build/app.js`]);
        expect(entry.entryPoints.app.css).toEqual([]);
    });

    it('exposes the React Fast Refresh URL when a React plugin is present', async () => {
        const reactOut = tmpDir('dev-react');
        const reactServer = await viteDev(
            fixture,
            { app: join(fixture, 'app.js') },
            { outputPath: reactOut, publicPath: '/build/' },
            { server: { host: '127.0.0.1' }, plugins: [react()] }
        );
        try {
            const entry = readJson(reactOut, 'entrypoints.json');
            expect(entry.devServer.reactRefresh).toBe(`${entry.devServer.origin}/build/@react-refresh`);
        } finally {
            await reactServer.close();
        }
    });
});

describe('vite top-level input', () => {
    it.skipIf(!hasTopLevelInput)('writes dev entries from the top-level input', async () => {
        const out = tmpDir('dev-top-level-input');
        const server = await createServer({
            root: fixture,
            logLevel: 'silent',
            input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
            server: { port: 0, host: '127.0.0.1' },
            plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
        });
        await server.listen();
        try {
            const entry = readJson(out, 'entrypoints.json');
            expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
        } finally {
            await server.close();
        }
    });
});
