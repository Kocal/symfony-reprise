import type { RsbuildConfig, RsbuildPlugin } from '@rsbuild/core';
import type { InlineConfig } from 'vite';
import type { TestContext } from 'vitest';
import type { Options } from '../../src/types';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild, mergeRsbuildConfig } from '@rsbuild/core';
import { build, createServer as createViteServer, mergeConfig } from 'vite';
import { onTestFinished } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';

export function getFreePort(): Promise<number> {
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

/**
 * Taps `compiler.hooks.done` — the same hook the Rsbuild adapter writes the Symfony files from — so
 * awaiting `written` guarantees they are on disk. `startDevServer()` alone only guarantees the HTTP
 * server is listening, which races ahead of the first compilation.
 *
 * Resolves on the first compile only; rebuild tests use `createCompileWaiter()`.
 */
export function createSymfonyWriteWaiter(): { plugin: RsbuildPlugin; written: Promise<void> } {
    const { plugin, next } = createCompileWaiter();
    return { plugin, written: next().then(() => undefined) };
}

/** Re-armable: `next()` resolves with the next compilation's error messages; call it before the change. */
export function createCompileWaiter(): { plugin: RsbuildPlugin; next: () => Promise<string[]> } {
    let resolveNext: ((errors: string[]) => void) | null = null;
    const plugin: RsbuildPlugin = {
        name: 'test-wait-for-compile',
        setup(api) {
            api.onAfterCreateCompiler(({ compiler }) => {
                const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                for (const c of compilers) {
                    c.hooks.done.tap('test-wait-for-compile', (stats) => {
                        const errors = (stats.toJson({ all: false, errors: true }).errors ?? []).map((e) => e.message);
                        resolveNext?.(errors);
                        resolveNext = null;
                    });
                }
            });
        },
    };
    const next = (): Promise<string[]> =>
        new Promise((resolve) => {
            resolveNext = resolve;
        });
    return { plugin, next };
}

/**
 * A fresh `ups-<prefix>-*` dir, removed after the test and its `afterEach` hooks (so after servers close).
 * Concurrent tests must pass their context: the global `onTestFinished` cannot tell them apart.
 */
export function tmpDir(prefix: string, context?: Pick<TestContext, 'onTestFinished'>): string {
    // macOS's tmpdir is a symlink, which breaks Rspack's virtual modules.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `ups-${prefix}-`)));
    (context?.onTestFinished ?? onTestFinished)(() => {
        try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
            // Windows can keep a handle open on a file in there; a leftover tmp dir must not fail the test.
        }
    });
    return dir;
}

export function readJson(dir: string, file: string): any {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

export function viteBuild(root: string, input: Record<string, string>, options: Options, config: InlineConfig = {}) {
    return build(
        mergeConfig<InlineConfig, InlineConfig>(
            {
                root,
                logLevel: 'silent',
                build: { emptyOutDir: true, rollupOptions: { input } },
                plugins: [SymfonyVite(options)],
            },
            config
        )
    );
}

export async function viteDev(
    root: string,
    input: Record<string, string>,
    options: Options,
    config: InlineConfig = {}
) {
    const server = await createViteServer(
        mergeConfig<InlineConfig, InlineConfig>(
            {
                root,
                logLevel: 'silent',
                server: { port: 0 },
                build: { rollupOptions: { input } },
                plugins: [SymfonyVite(options)],
            },
            config
        )
    );
    await server.listen();
    return server;
}

export async function rsbuildBuild(
    cwd: string,
    entry: Record<string, string>,
    options: Options,
    config: RsbuildConfig = {}
) {
    const rsbuild = await createRsbuild({
        cwd,
        rsbuildConfig: mergeRsbuildConfig(
            { mode: 'production', source: { entry }, plugins: [SymfonyRsbuild(options)] },
            config
        ),
    });
    return rsbuild.build();
}

/** Resolves once the first compilation has written the Symfony files, not just once the server listens. */
export async function rsbuildDev(
    cwd: string,
    entry: Record<string, string>,
    options: Options,
    config: RsbuildConfig = {}
) {
    const firstWrite = createSymfonyWriteWaiter();
    const rsbuild = await createRsbuild({
        cwd,
        rsbuildConfig: mergeRsbuildConfig(
            {
                mode: 'development',
                source: { entry },
                server: { port: await getFreePort() },
                plugins: [SymfonyRsbuild(options), firstWrite.plugin],
            },
            config
        ),
    });
    const server = await rsbuild.startDevServer();
    await firstWrite.written;
    return server;
}
