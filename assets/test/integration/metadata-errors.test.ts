import type { RsbuildPlugin } from '@rsbuild/core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { build, createLogger, createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createCompileWaiter, getFreePort } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const input = { app: join(fixture, 'app.js') };
const failure = /failed to write .*entrypoints\.json: .*blocker/;

// `metadataPath` sits under a regular file, so creating it fails.
function unwritable(): { outputPath: string; metadataPath: string; publicPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'ups-metadata-errors-'));
    writeFileSync(join(dir, 'blocker'), '');
    return { outputPath: join(dir, 'build'), metadataPath: join(dir, 'blocker', 'meta'), publicPath: '/build/' };
}

function captureInfrastructureLog(): { plugin: RsbuildPlugin; logged: string[] } {
    const logged: string[] = [];
    const plugin: RsbuildPlugin = {
        name: 'test-capture-infrastructure-log',
        setup(api) {
            api.onAfterCreateCompiler(({ compiler }) => {
                const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                for (const c of compilers) {
                    c.hooks.infrastructureLog.tap('test-capture-infrastructure-log', (name, _type, args) => {
                        if (name !== '@symfony/reprise') return;
                        logged.push(String(args[0]));
                        return true;
                    });
                }
            });
        },
    };
    return { plugin, logged };
}

describe('failing to write the Symfony files', () => {
    it('fails a vite build', async () => {
        await expect(
            build({
                root: fixture,
                logLevel: 'silent',
                build: { rollupOptions: { input } },
                plugins: [SymfonyVite(unwritable())],
            })
        ).rejects.toThrow(/blocker/);
    }, 30_000);

    it('fails an rsbuild build', async () => {
        const compile = createCompileWaiter();
        const errors = compile.next();
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'production',
                source: { entry: input },
                plugins: [SymfonyRsbuild(unwritable()), compile.plugin],
            },
        });

        await expect(rsbuild.build()).rejects.toThrow();
        expect(await errors).toEqual([expect.stringMatching(failure)]);
    }, 60_000);

    it('logs it in vite dev and keeps serving', async () => {
        const logger = createLogger('silent');
        const error = vi.spyOn(logger, 'error');
        const server = await createServer({
            root: fixture,
            customLogger: logger,
            server: { port: 0, host: '127.0.0.1' },
            build: { rollupOptions: { input } },
            plugins: [SymfonyVite(unwritable())],
        });
        await server.listen();
        try {
            expect(error).toHaveBeenCalledWith(expect.stringMatching(failure));
            expect((await fetch(`${server.resolvedUrls?.local[0]}app.js`)).status).toBe(200);
        } finally {
            await server.close();
        }
    }, 30_000);

    it('logs it in rsbuild dev and keeps serving', async () => {
        const log = captureInfrastructureLog();
        const compile = createCompileWaiter();
        const errors = compile.next();
        const port = await getFreePort();
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: input },
                server: { port },
                plugins: [SymfonyRsbuild(unwritable()), log.plugin, compile.plugin],
            },
        });
        const { server } = await rsbuild.startDevServer();
        try {
            expect(await errors).toEqual([]);
            expect(log.logged).toEqual([expect.stringMatching(failure)]);
            expect((await fetch(`http://localhost:${port}/build/static/js/app.js`)).status).toBe(200);
        } finally {
            await server.close();
        }
    }, 60_000);
});
