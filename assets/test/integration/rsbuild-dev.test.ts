import type { RsbuildConfig, RsbuildPlugin } from '@rsbuild/core';
import type { Options } from '../../src/types';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRsbuild, mergeRsbuildConfig } from '@rsbuild/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Symfony from '../../src/rsbuild';
import { getFreePort, readJson, tmpDir } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');

async function inspectDevConfig(options: Options, config: RsbuildConfig = {}) {
    const rsbuild = await createRsbuild({
        cwd: fixture,
        rsbuildConfig: mergeRsbuildConfig(
            { mode: 'development', source: { entry: { app: join(fixture, 'app.js') } }, plugins: [Symfony(options)] },
            config
        ),
    });
    const { origin } = await rsbuild.inspectConfig();
    return origin.rsbuildConfig;
}

describe('rsbuild dev writes absolute dev-server URLs and no HTML', () => {
    let server: Awaited<ReturnType<Awaited<ReturnType<typeof createRsbuild>>['startDevServer']>>;
    let out: string;

    beforeEach(async () => {
        out = tmpDir('rsbuild-dev');
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
        const entry = readJson(out, 'entrypoints.json');

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
        const manifest = readJson(out, 'manifest.json');
        expect(manifest).toEqual({});

        const htmlFiles = readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith('.html'));
        expect(htmlFiles).toEqual([]);
    });
});

describe('rsbuild dev pins the HMR client to the dev-server host', () => {
    it('sets dev.client host/port/protocol so HMR and lazy compilation target the dev server', async () => {
        const { dev } = await inspectDevConfig({ outputPath: tmpDir('rsbuild-devclient'), publicPath: '/build/' });

        // Without this, the compiled HMR client derives its socket URL from window.location (the
        // Symfony page) and 404s. `<port>` is substituted with the real port at server start; `ws`
        // matches the plain-HTTP dev server. The host MUST be the host the dev server binds to:
        // Rsbuild's default `server.host` resolves to `localhost` (which binds `::1` on IPv6-capable
        // machines), so a literal `127.0.0.1` (IPv4 loopback) would not be listening and every HMR /
        // lazy-compilation / async-chunk request to it would be refused. `localhost` is also
        // "potentially trustworthy", so `ws://`/`http://` stay allowed from an HTTPS Symfony page.
        // Lazy compilation reads the same config.
        expect(dev?.client).toMatchObject({
            host: 'localhost',
            port: '<port>',
            protocol: 'ws',
        });

        // Async chunks build their URLs from the dev runtime publicPath; it must point at the dev
        // server host + publicPath (verbatim, `<port>` resolved at start), not the page origin, and
        // uses the same host as the client so it lands where the server actually listens.
        expect(dev?.assetPrefix).toBe('http://localhost:<port>/build/');
    });

    it('honours a custom server.host for the client + asset prefix', async () => {
        const { dev } = await inspectDevConfig(
            { outputPath: tmpDir('rsbuild-devhost'), publicPath: '/build/' },
            { server: { host: '127.0.0.1' } }
        );

        // A user who pins the dev server to a specific host must have the advertised URLs follow it,
        // so they still match where the server binds (here IPv4 loopback, explicitly requested).
        expect(dev?.client).toMatchObject({ host: '127.0.0.1' });
        expect(dev?.assetPrefix).toBe('http://127.0.0.1:<port>/build/');
    });

    it.each([
        ['0.0.0.0', 'localhost'],
        ['::', 'localhost'],
        ['::1', '[::1]'],
    ])('maps server.host %s to %s for the client + asset prefix', async (host, expected) => {
        const { dev } = await inspectDevConfig(
            { outputPath: tmpDir('rsbuild-devhost'), publicPath: '/build/' },
            { server: { host } }
        );

        expect(dev?.client).toMatchObject({ host: expected });
        expect(dev?.assetPrefix).toBe(`http://${expected}:<port>/build/`);
    });

    it('follows devServerOrigin for the client + asset prefix', async () => {
        const { dev } = await inspectDevConfig({
            outputPath: tmpDir('rsbuild-devorigin'),
            publicPath: '/build/',
            devServerOrigin: 'https://assets.example.test/',
        });

        expect(dev?.client).toMatchObject({
            host: 'assets.example.test',
            port: '443',
            protocol: 'wss',
        });
        expect(dev?.assetPrefix).toBe('https://assets.example.test/build/');
    });
});
