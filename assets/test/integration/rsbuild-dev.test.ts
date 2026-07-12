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
        // ahead of that first compilation finishing. `onAfterDevCompile` fires after the first dev
        // compile, but does NOT reliably postdate the adapter's own `compiler.hooks.done` tap that
        // writes the Symfony files (see `copy.test.ts`'s rsbuild dev test, which taps
        // `compiler.hooks.done` directly instead to get a guaranteed-ordered signal). This test only
        // asserts on `entrypoints.json`/`manifest.json` contents that don't depend on that ordering
        // in practice, but it is not a guarantee — just an empirical observation for this branch.
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

describe('rsbuild dev pins the HMR client to the loopback dev-server origin', () => {
    it('sets dev.client host/port/protocol so HMR and lazy compilation target the dev server', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-devclient-'));
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(fixture, 'app.js') } },
                plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
            },
        });

        const { origin } = await rsbuild.inspectConfig();

        // Without this, the compiled HMR client derives its socket URL from window.location (the
        // Symfony page) and 404s. `<port>` is substituted with the real port at server start; the
        // 127.0.0.1 loopback host keeps `ws://` allowed from an HTTPS Symfony page; `ws` matches the
        // plain-HTTP dev server. Lazy compilation reads the same config.
        expect(origin.rsbuildConfig.dev?.client).toMatchObject({
            host: '127.0.0.1',
            port: '<port>',
            protocol: 'ws',
        });

        // Async chunks build their URLs from the dev runtime publicPath; it must point at the dev
        // server + publicPath (verbatim, `<port>` resolved at start), not the page origin.
        expect(origin.rsbuildConfig.dev?.assetPrefix).toBe('http://127.0.0.1:<port>/build/');
    });
});
