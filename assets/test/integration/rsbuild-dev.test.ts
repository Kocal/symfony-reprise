import type { RsbuildPlugin } from '@rsbuild/core';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Symfony from '../../src/rsbuild';

const fixture = join(import.meta.dirname, '../fixtures/basic');

function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            if (addr && typeof addr === 'object') {
                const { port } = addr;
                srv.close(() => resolve(port));
            } else {
                srv.close(() => reject(new Error('no port')));
            }
        });
    });
}

describe('rsbuild dev writes absolute dev-server URLs and no HTML', () => {
    let server: Awaited<ReturnType<Awaited<ReturnType<typeof createRsbuild>>['startDevServer']>>;
    let out: string;

    beforeEach(async () => {
        out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-dev-'));
        const port = await getFreePort();

        // The `done` hook writes entrypoints.json synchronously as part of Rspack's `done` tap
        // chain, but `startDevServer()` resolves once the HTTP server is listening — which races
        // ahead of that first compilation finishing. `onAfterDevCompile` is Rsbuild's own first-build
        // signal (fires after all `compiler.hooks.done` taps, including the adapter's, have run), so
        // awaiting it removes the race without polling or sleeping.
        let resolveFirstCompile: () => void;
        const firstCompileDone = new Promise<void>((resolve) => {
            resolveFirstCompile = resolve;
        });
        const waitForFirstCompilePlugin: RsbuildPlugin = {
            name: 'test-wait-for-first-compile',
            setup(api) {
                api.onAfterDevCompile(({ isFirstCompile }) => {
                    if (isFirstCompile) resolveFirstCompile();
                });
            },
        };

        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
                server: { port },
                plugins: [Symfony({ outputPath: out, publicPath: '/build/' }), waitForFirstCompilePlugin],
            },
        });
        server = await rsbuild.startDevServer();
        await firstCompileDone;
    });

    afterEach(async () => {
        await server.server.close();
    });

    it('points entries at the dev-server origin, client:null, no HTML', async () => {
        const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));

        expect(entry.isProd).toBe(false);
        expect(entry.publicPath).toBe('/build/');
        expect(entry.devServer).not.toBeNull();
        expect(entry.devServer.client).toBeNull();
        expect(entry.devServer.origin).toMatch(/^https?:\/\//);
        expect(entry.entryPoints.app.js[0]).toMatch(/^https?:\/\/.*\/build\//);

        // The advertised URL must actually be served by the dev server — the whole point of the
        // dev-flavoured entrypoints.json is that Symfony/Twig can load it as-is. A URL that 404s is
        // worthless. This caught the `/build/` prefix mismatch: we advertised `origin/build/...` but
        // the dev server served assets at `origin/...`.
        const res = await fetch(entry.entryPoints.app.js[0]);
        expect(res.status).toBe(200);

        // In dev the manifest is empty (assets come from the dev server, no on-disk hash lookups),
        // matching the Vite dev path.
        const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        expect(manifest).toEqual({});

        const htmlFiles = readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith('.html'));
        expect(htmlFiles).toEqual([]);
    }, 60_000);
});
