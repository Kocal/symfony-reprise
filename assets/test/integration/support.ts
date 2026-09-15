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
 * Resolves on the first compile only. Fine for a single-compile dev test; an HMR/rebuild test reusing
 * this pattern would need to re-arm the promise per compile instead of resolving once.
 */
export function createSymfonyWriteWaiter(): { plugin: RsbuildPlugin; written: Promise<void> } {
    let resolveWritten: () => void;
    const written = new Promise<void>((resolve) => {
        resolveWritten = resolve;
    });
    const plugin: RsbuildPlugin = {
        name: 'test-wait-for-symfony-write',
        setup(api) {
            api.onAfterCreateCompiler(({ compiler }) => {
                const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                for (const c of compilers) {
                    c.hooks.done.tap('test-wait-for-symfony-write', () => resolveWritten());
                }
            });
        },
    };
    return { plugin, written };
}
