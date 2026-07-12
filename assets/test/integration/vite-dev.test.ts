import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Symfony from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/basic');

describe('vite serve writes a dev entrypoints.json', () => {
    let server: Awaited<ReturnType<typeof createServer>>;
    let out: string;

    beforeEach(async () => {
        out = mkdtempSync(join(tmpdir(), 'ups-dev-'));
        server = await createServer({
            root: fixture,
            logLevel: 'silent',
            server: { port: 0, host: '127.0.0.1' },
            build: { rollupOptions: { input: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } } },
            plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
        });
        await server.listen();
    });

    afterEach(async () => {
        await server.close();
    });

    it('points entries at the dev-server origin and marks the mode', () => {
        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));

        expect(entry.isProd).toBe(false);
        expect(entry.publicPath).toBe('/build/');
        const origin = entry.devServer.origin;
        expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        // The HMR client is served under `base` (our publicPath), so its URL carries `/build/`.
        expect(entry.devServer.client).toBe(`${origin}/build/@vite/client`);

        expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app']);
        expect(entry.entryPoints.app.js).toEqual([`${origin}/build/app.js`]);
        expect(entry.entryPoints.app.css).toEqual([]);
    });
});
