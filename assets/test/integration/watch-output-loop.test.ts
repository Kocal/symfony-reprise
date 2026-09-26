import type { RsbuildPlugin } from '@rsbuild/core';
import type { Plugin } from 'vite';
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRsbuild } from '@rsbuild/core';
import { build, createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createSymfonyWriteWaiter, getFreePort } from './support';

const SETTLE_MS = 3_000;

function app(): { dir: string; publicDir: string; out: string; dependency: string } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ups-watch-loop-')));
    const publicDir = join(dir, 'public');
    const dependencyDir = join(dir, 'node_modules/dep');
    mkdirSync(publicDir);
    mkdirSync(dependencyDir, { recursive: true });
    writeFileSync(join(dependencyDir, 'package.json'), '{ "name": "dep", "main": "index.js" }\n');
    writeFileSync(join(dependencyDir, 'index.js'), 'export default 1\n');
    writeFileSync(join(dir, 'app.js'), "import dep from 'dep'\nconsole.log(dep)\n");
    // Backdated, or the watcher can count the fixture's own creation as a change and rebuild once.
    const past = new Date(Date.now() - 60_000);
    const created = [
        join(dir, 'app.js'),
        join(dependencyDir, 'index.js'),
        join(dependencyDir, 'package.json'),
        dependencyDir,
        join(dir, 'node_modules'),
        publicDir,
        dir,
    ];
    for (const path of created) {
        utimesSync(path, past, past);
    }
    return { dir, publicDir, out: join(publicDir, 'build'), dependency: join(dependencyDir, 'index.js') };
}

// Stands in for Tailwind CSS v4, which watches the project's directories, the one holding outputPath included.
function rsbuildWatching(dir: string): { plugin: RsbuildPlugin; rebuildTriggers: () => string[][] } {
    const builds: string[][] = [];
    const plugin: RsbuildPlugin = {
        name: 'test-watch-dir',
        setup(api) {
            api.onAfterCreateCompiler(({ compiler }) => {
                const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                for (const c of compilers) {
                    c.hooks.afterCompile.tap('test-watch-dir', (compilation) => {
                        compilation.contextDependencies.add(dir);
                    });
                    c.hooks.done.tap('test-watch-dir', () => {
                        builds.push([...(c.modifiedFiles ?? []), ...(c.removedFiles ?? [])]);
                    });
                }
            });
        },
    };
    return { plugin, rebuildTriggers: () => builds.slice(1) };
}

async function expectSingleRsbuildBuild(
    action: 'dev' | 'build',
    ignored?: RegExp | string | ((path: string) => boolean)
): Promise<void> {
    const { dir, publicDir, out, dependency } = app();
    const tool = rsbuildWatching(publicDir);
    const firstWrite = createSymfonyWriteWaiter();
    const rsbuild = await createRsbuild({
        cwd: dir,
        rsbuildConfig: {
            mode: action === 'dev' ? 'development' : 'production',
            source: { entry: { app: join(dir, 'app.js') } },
            server: { port: await getFreePort() },
            tools: ignored ? { rspack: { watchOptions: { ignored } } } : {},
            plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' }), tool.plugin, firstWrite.plugin],
        },
    });
    const running = action === 'dev' ? (await rsbuild.startDevServer()).server : await rsbuild.build({ watch: true });
    try {
        await firstWrite.written;
        // Without a user-set ignore, node_modules must stay ignored, as Rspack does by default.
        if (!ignored) utimesSync(dependency, new Date(), new Date());
        await sleep(SETTLE_MS);
        expect(tool.rebuildTriggers()).toEqual([]);
    } finally {
        await running.close();
    }
}

describe.concurrent('writing the Symfony files does not retrigger a build watching their directory', () => {
    it('rsbuild dev', () => expectSingleRsbuildBuild('dev'), 30_000);

    it('rsbuild build --watch', () => expectSingleRsbuildBuild('build'), 30_000);

    it(
        'rsbuild dev, with a user-set RegExp ignore',
        () => expectSingleRsbuildBuild('dev', /[\\/](?:node_modules|\.cache)[\\/]/),
        30_000
    );

    it('rsbuild dev, with a user-set glob ignore', () => expectSingleRsbuildBuild('dev', '**/node_modules/**'), 30_000);

    it(
        'rsbuild dev, with a user-set function ignore',
        () => expectSingleRsbuildBuild('dev', (path) => /[\\/]node_modules[\\/]/.test(path)),
        30_000
    );

    it('vite dev', async () => {
        const { dir, publicDir, out } = app();
        const watching: Plugin = {
            name: 'test-watch-dir',
            configureServer(server) {
                server.watcher.add(publicDir);
            },
        };
        const server = await createServer({
            root: dir,
            logLevel: 'silent',
            server: { port: await getFreePort() },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' }), watching],
        });
        const send = vi.spyOn(server.environments.client.hot, 'send');
        await server.listen();
        try {
            await sleep(SETTLE_MS);
            expect(send).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    }, 30_000);

    it('vite build --watch', async () => {
        const { dir, publicDir, out } = app();
        let builds = 0;
        const watching: Plugin = {
            name: 'test-watch-dir',
            buildStart() {
                this.addWatchFile(publicDir);
            },
            writeBundle() {
                builds++;
            },
        };
        const watcher = (await build({
            root: dir,
            logLevel: 'silent',
            build: { watch: {}, rollupOptions: { input: { app: join(dir, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' }), watching],
        })) as unknown as { close(): Promise<void> };
        try {
            await sleep(SETTLE_MS);
            // Windows CI reports one extra change after the first build; a loop would keep rebuilding.
            expect(builds).toBeLessThanOrEqual(2);
        } finally {
            await watcher.close();
        }
    }, 30_000);
});
