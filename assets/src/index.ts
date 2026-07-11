import type { UnpluginFactory } from 'unplugin';
import type { BuildContext, NormalizedGraph, Options } from './types';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as process from 'node:process';
import { createUnplugin } from 'unplugin';
import { bundleToGraph, configToDevGraph } from './collectors/vite';
import { copyManifest, resolveCopyFiles, writeCopyFiles } from './core/copy';
import { resolveDevOrigin } from './core/dev-server';
import { writeSymfonyFiles } from './core/emit';
import { buildEntrypoints, buildManifest } from './core/format';
import { integrityFromDisk, referencedFileNames } from './core/integrity';
import { normalizeOptions, resolvePublicPath } from './core/options';
import { generateControllersModule, STIMULUS_NOT_ENABLED_MESSAGE, VIRTUAL_CONTROLLERS_ID } from './core/stimulus';

const VIRTUAL_ID = VIRTUAL_CONTROLLERS_ID;
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
    const resolved = normalizeOptions(options, process.cwd());
    let isDev = false;
    // When SRI is on, entrypoints.json is finished in `writeBundle` (see below); stash what it needs.
    let pendingIntegrity: { graph: NormalizedGraph; ctx: BuildContext } | null = null;

    return {
        name: '@symfony/reprise',

        vite: {
            config: () => ({
                base: resolved.publicPath,
                build: {
                    outDir: resolved.outputPath,
                    copyPublicDir: false,
                    manifest: false,
                    assetsDir: '.',
                },
            }),

            generateBundle(_outputOptions, bundle) {
                const graph = bundleToGraph(bundle);
                const ctx: BuildContext = {
                    isProd: true,
                    devServer: null,
                    publicPath: resolved.publicPath,
                    urlPrefix: resolved.publicPath,
                    manifestKeyPrefix: resolved.manifestKeyPrefix,
                };
                this.emitFile({
                    type: 'asset',
                    fileName: 'entrypoints.json',
                    source: `${JSON.stringify(buildEntrypoints(graph, ctx), null, 2)}\n`,
                });
                const copyFiles = resolveCopyFiles(resolved.copy, true);
                for (const file of copyFiles) {
                    this.emitFile({ type: 'asset', fileName: file.physicalName, source: file.source });
                }
                const manifest = {
                    ...buildManifest(graph, ctx),
                    ...copyManifest(copyFiles, {
                        publicPath: resolved.publicPath,
                        manifestKeyPrefix: resolved.manifestKeyPrefix,
                    }),
                };
                this.emitFile({
                    type: 'asset',
                    fileName: 'manifest.json',
                    source: `${JSON.stringify(manifest, null, 2)}\n`,
                });
                // SRI must hash the bytes that ship: Vite only finalizes chunks (replacing markers like
                // `__VITE_PRELOAD__`) when writing to disk, so the in-memory bundle differs from the file.
                // Defer to writeBundle (files on disk) and rewrite entrypoints.json with the integrity map.
                if (resolved.integrity) pendingIntegrity = { graph, ctx };
            },

            writeBundle() {
                if (!pendingIntegrity || !resolved.integrity) return;
                const { graph, ctx } = pendingIntegrity;
                pendingIntegrity = null;
                graph.integrity = integrityFromDisk(
                    referencedFileNames(graph.entryPoints),
                    resolved.outputPath,
                    resolved.integrity.algorithms
                );
                writeFileSync(
                    join(resolved.outputPath, 'entrypoints.json'),
                    `${JSON.stringify(buildEntrypoints(graph, ctx), null, 2)}\n`
                );
            },

            configResolved(config) {
                isDev = config.command === 'serve';
            },

            resolveId(id) {
                if (id !== VIRTUAL_ID) return;
                // The helper (`@symfony/reprise/stimulus`) imports this unconditionally, so if a
                // user pulls in `startStimulusApp()` without turning the feature on, fail with a clear,
                // actionable message rather than Rollup's generic "failed to resolve".
                if (!resolved.stimulus) throw new Error(STIMULUS_NOT_ENABLED_MESSAGE);
                return RESOLVED_VIRTUAL_ID;
            },

            load(id) {
                if (resolved.stimulus && id === RESOLVED_VIRTUAL_ID)
                    return generateControllersModule(resolved.stimulus, process.cwd(), isDev);
            },

            configureServer(server) {
                // In Vite middleware mode `server.httpServer` is null, so no dev entrypoints.json is
                // written — the standalone Vite dev server is the supported Symfony workflow.
                server.httpServer?.once('listening', () => {
                    const address = server.httpServer?.address();
                    if (!address || typeof address === 'string') return;

                    const origin = resolveDevOrigin(address, {
                        override: resolved.devServerOrigin,
                        serverOrigin: server.config.server.origin,
                        https: Boolean(server.config.server.https),
                    });
                    server.config.server.origin = origin; // keep Vite's internal URL rewriting in sync

                    const ctx: BuildContext = {
                        isProd: false,
                        devServer: { origin, client: 'vite' },
                        publicPath: resolved.publicPath,
                        urlPrefix: resolvePublicPath(resolved.publicPath, origin),
                        manifestKeyPrefix: resolved.manifestKeyPrefix,
                    };
                    try {
                        const copyFiles = resolveCopyFiles(resolved.copy, false);
                        writeCopyFiles(copyFiles, resolved.outputPath);
                        writeSymfonyFiles(
                            resolved.outputPath,
                            buildEntrypoints(configToDevGraph(server.config), ctx),
                            copyManifest(copyFiles, {
                                publicPath: resolved.publicPath,
                                manifestKeyPrefix: resolved.manifestKeyPrefix,
                            })
                        );
                    } catch (err) {
                        server.config.logger.error(
                            `[@symfony/reprise] failed to write dev entrypoints.json: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }
                });
            },
        },
    };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);

export default unplugin;
