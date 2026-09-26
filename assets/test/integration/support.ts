import type { RsbuildPlugin } from '@rsbuild/core';
import { createServer } from 'node:http';

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
