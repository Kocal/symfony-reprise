import type { UnpluginFactory, UnpluginInstance } from 'unplugin';
import type { RspackEntry, RspackStats } from './collectors/rspack';
import type { CopyResult } from './core/copy';
import type { BuildContext, ManifestJson, NormalizedGraph, Options } from './types';
import * as process from 'node:process';
import { createUnplugin } from 'unplugin';
import { statsToGraph, styleEntryNames } from './collectors/rspack';
import { bundleToGraph, configToDevGraph } from './collectors/vite';
import { copyManifest, resolveCopyFiles, writeCopyFiles } from './core/copy';
import { resolveDevOrigin, urlHost } from './core/dev-server';
import { writeSymfonyFiles } from './core/emit';
import { buildEntrypoints, buildManifest, joinUrl } from './core/format';
import { integrityFromDisk, referencedFileNames } from './core/integrity';
import { isAbsolutePublicPath, normalizeOptions, resolvePublicPath } from './core/options';
import { slash, trimTrailingSlash } from './core/paths';
import {
    affectsControllersModule,
    generateControllersModule,
    STIMULUS_NOT_ENABLED_MESSAGE,
    stimulusWatchFiles,
    VIRTUAL_CONTROLLERS_ID,
} from './core/stimulus';

const VIRTUAL_ID = VIRTUAL_CONTROLLERS_ID;
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
    const cwd = process.cwd();
    const resolved = normalizeOptions(options, cwd);
    let isDev = false;
    // Vite project root (from `configResolved`); keys imported assets in `bundleToGraph`.
    let root = cwd;
    // The Symfony files are written in `writeBundle`; stash what they need.
    let pending: { graph: NormalizedGraph; ctx: BuildContext; manifest: ManifestJson } | null = null;

    return {
        name: '@symfony/reprise',

        // Shared Stimulus virtual module: unplugin applies these universal hooks to Vite and forwards
        // them to Rspack (via `api.modifyRspackConfig`), so one implementation serves both bundlers. The
        // `\0` prefix sidesteps Rspack's URI-scheme rejection of a raw `virtual:` id.
        //
        // On Rspack, unplugin attaches its `load` loader to every module whose `loadInclude` passes
        // (and retypes it `javascript/auto`). Without this gate it would match binary assets too —
        // the loader is not `raw`, so it re-emits them as UTF-8 strings and corrupts images/fonts in
        // dev. Restrict it to the virtual id so real files are never touched.
        loadInclude: (id) => id.includes(VIRTUAL_ID),
        resolveId(id) {
            if (id !== VIRTUAL_ID) return;
            // Imported unconditionally by `startStimulusApp()`; fail clearly when the feature is off.
            if (!resolved.stimulus) throw new Error(STIMULUS_NOT_ENABLED_MESSAGE);
            return RESOLVED_VIRTUAL_ID;
        },

        load(id) {
            if (!resolved.stimulus || id !== RESOLVED_VIRTUAL_ID) return;
            for (const file of stimulusWatchFiles(resolved.stimulus)) this.addWatchFile(file);
            const native = this.getNativeBuildContext?.();
            if (native?.framework === 'rspack')
                native.loaderContext?.addContextDependency(resolved.stimulus.controllersDir);
            return generateControllersModule(resolved.stimulus, cwd, isDev);
        },

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
                const graph = bundleToGraph(bundle, root);
                const ctx: BuildContext = {
                    isProd: true,
                    devServer: null,
                    publicPath: resolved.publicPath,
                    urlPrefix: resolved.publicPath,
                    manifestKeyPrefix: resolved.manifestKeyPrefix,
                };
                const copyFiles = resolveCopyFiles(resolved.copy, true);
                for (const file of copyFiles) {
                    this.emitFile({ type: 'asset', fileName: file.physicalName, source: file.source });
                }
                const manifest = {
                    ...buildManifest(graph, ctx),
                    ...copyManifest(copyFiles, resolved),
                };
                // Vite finalizes chunk bytes only on disk write (replacing markers like `__VITE_PRELOAD__`),
                // so the in-memory bundle differs from the file — hash for SRI in `writeBundle`, not here.
                pending = { graph, ctx, manifest };
            },

            writeBundle() {
                if (!pending) return;
                const { graph, ctx, manifest } = pending;
                pending = null;
                if (resolved.integrity) {
                    graph.integrity = integrityFromDisk(
                        referencedFileNames(graph.entryPoints),
                        resolved.outputPath,
                        resolved.integrity.algorithms
                    );
                }
                writeSymfonyFiles(resolved.metadataPath, buildEntrypoints(graph, ctx), manifest);
            },

            configResolved(config) {
                isDev = config.command === 'serve';
                root = config.root;
            },

            configureServer(server) {
                const stimulus = resolved.stimulus;
                if (stimulus) {
                    // `addWatchFile()` can't cover a controller that doesn't exist yet.
                    server.watcher.add([stimulus.controllersJson, stimulus.controllersDir]);
                    server.watcher.on('all', (_event, file) => {
                        if (!affectsControllersModule(file, stimulus)) return;
                        const client = server.environments.client;
                        const mod = client.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
                        if (mod) client.moduleGraph.invalidateModule(mod);
                        client.hot.send({ type: 'full-reload' });
                    });
                }

                // Middleware mode has no `httpServer`; only the standalone dev server is supported.
                server.httpServer?.once('listening', () => {
                    const address = server.httpServer?.address();
                    if (!address || typeof address === 'string') return;

                    const origin = resolveDevOrigin(address, {
                        override: resolved.devServerOrigin,
                        serverOrigin: server.config.server.origin,
                        https: Boolean(server.config.server.https),
                    });
                    server.config.server.origin = origin; // keep Vite's internal URL rewriting in sync

                    // Vite serves `@vite/client` (and `@react-refresh`) under `base` (publicPath), not
                    // at the origin root.
                    const urlPrefix = resolvePublicPath(resolved.publicPath, origin);
                    // `@vitejs/plugin-react` (and `-react-swc`) register plugins named `vite:react-*`.
                    // When present, Symfony must emit the Fast Refresh preamble itself (it can't touch the HTML).
                    const usesReactPlugin = server.config.plugins.some((plugin) =>
                        plugin.name?.startsWith('vite:react')
                    );
                    const ctx: BuildContext = {
                        isProd: false,
                        devServer: {
                            origin,
                            client: joinUrl(urlPrefix, '@vite/client'),
                            reactRefresh: usesReactPlugin ? joinUrl(urlPrefix, '@react-refresh') : null,
                        },
                        publicPath: resolved.publicPath,
                        urlPrefix,
                        manifestKeyPrefix: resolved.manifestKeyPrefix,
                    };
                    try {
                        const copyFiles = resolveCopyFiles(resolved.copy, false);
                        writeCopyFiles(copyFiles, resolved.outputPath);
                        writeSymfonyFiles(
                            resolved.metadataPath,
                            buildEntrypoints(configToDevGraph(server.config), ctx),
                            copyManifest(copyFiles, resolved)
                        );
                    } catch (err) {
                        server.config.logger.error(
                            `[@symfony/reprise] failed to write dev entrypoints.json: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }
                });
            },
        },

        rsbuild: {
            // `@rsbuild/core` is an optional peer, so we never import it here (a static import would pull it
            // into the shared factory — and thus the Vite bundle — breaking Vite-only installs). The `rspack`
            // namespace we need for the copy tap is read off the compiler instance (`c.rspack`) instead.
            setup(api) {
                // Rsbuild's dev/build signal; feeds the shared `isDev` the universal `load` reads.
                isDev = api.context.action === 'dev';
                const publicOrigin = resolved.devServerOrigin ? new URL(resolved.devServerOrigin) : null;

                // Symfony renders the HTML, so no per-entry HTML pages.
                api.modifyRsbuildConfig((config) => {
                    config.tools ??= {};
                    config.tools.htmlPlugin = false;
                    config.output ??= {};
                    const prevDistPath = typeof config.output.distPath === 'object' ? config.output.distPath : {};
                    config.output.distPath = { ...prevDistPath, root: resolved.outputPath };
                    // `outputPath` is inside Rsbuild's public dir; copying public/ into public/build/ (a subpath)
                    // throws `ERR_FS_CP_EINVAL`. Disable the copy (the Rspack analog of Vite's `copyPublicDir: false`).
                    config.server ??= {};
                    config.server.publicDir = false;
                    // Serve the dev server under `publicPath` so advertised URLs match (else every URL 404s).
                    // `server.base` must be a slash-path, so an absolute (CDN) publicPath falls back to `/`.
                    config.server.base = isAbsolutePublicPath(resolved.publicPath) ? '/' : resolved.publicPath;
                    // Already defaulted to `/` by Rsbuild, so `??=` wouldn't apply — assign unconditionally.
                    // Drives production asset URLs (dev uses `server.base` above).
                    config.output.assetPrefix = resolved.publicPath;
                    // Standardise on ESM so the tags render as `<script type="module">` like Vite.
                    config.output.module = true;

                    // The advertised dev host must be the one the server binds to: Rsbuild's default `localhost`
                    // binds `::1` only, so a literal `127.0.0.1` isn't listening and refuses HMR/lazy/chunk requests.
                    // Same wildcard/unset -> `localhost` mapping as the `done` tap, so client + origin stay in sync.
                    const devHost = urlHost(typeof config.server.host === 'string' ? config.server.host : 'localhost');
                    const secure = publicOrigin ? publicOrigin.protocol === 'https:' : Boolean(config.server.https);

                    // Pin the HMR/lazy-compilation client to the dev server: by default it derives its WS URL from
                    // `window.location` (the Symfony page) and 404s. `<port>` is substituted at server start; the
                    // explicit protocol stops it inferring `wss` from an HTTPS page against a plain-HTTP dev server.
                    config.dev ??= {};
                    config.dev.client = {
                        ...config.dev.client,
                        host: publicOrigin?.hostname ?? devHost,
                        port: publicOrigin ? publicOrigin.port || (secure ? '443' : '80') : '<port>',
                        protocol: secure ? 'wss' : 'ws',
                    };
                    // Async chunk URLs come from `dev.assetPrefix` (default `/` -> 404 against the Symfony page).
                    // It's used verbatim (no `server.base` composed in), so carry the full publicPath; skip CDN.
                    if (!isAbsolutePublicPath(resolved.publicPath)) {
                        const origin = resolved.devServerOrigin ?? `${secure ? 'https' : 'http'}://${devHost}:<port>`;
                        config.dev.assetPrefix = `${origin}${resolved.publicPath}`;
                    }

                    // The Rspack-layer flags behind `output.module` above, so async chunks are `import()`ed.
                    const prev = config.tools.rspack;
                    const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
                    config.tools.rspack = [
                        ...prevList,
                        (rspackConfig) => {
                            rspackConfig.experiments ??= {};
                            // `outputModule` is a valid Rspack experiment but missing from its typings.
                            (rspackConfig.experiments as { outputModule?: boolean }).outputModule = true;
                            rspackConfig.output ??= {};
                            rspackConfig.output.module = true;
                            rspackConfig.output.chunkFormat = 'module';
                        },
                        (rspackConfig) => {
                            // A tool watching outputPath's parent (Tailwind CSS v4 watches `public/`) would otherwise
                            // rebuild on every write of the Symfony files, forever.
                            const outputDir = trimTrailingSlash(slash(resolved.outputPath));
                            const metadataDir = trimTrailingSlash(slash(resolved.metadataPath));
                            const metadataFiles = [`${metadataDir}/entrypoints.json`, `${metadataDir}/manifest.json`];
                            const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            // The metadata files are written through a temporary sibling that changes their directory too.
                            const own = new RegExp(
                                `^(?:${escape(outputDir)}(?:/|$)|${escape(metadataDir)}(?:/(?:entrypoints|manifest)\\.json(?:\\.[^/]+\\.tmp)?)?$)`
                            );

                            rspackConfig.watchOptions ??= {};
                            const { ignored } = rspackConfig.watchOptions;
                            if (ignored === undefined || ignored instanceof RegExp) {
                                // Setting `ignored` replaces Rspack's default (node_modules, .git): extend it instead.
                                const base = ignored ?? /[\\/](?:\.git|node_modules)[\\/]/;
                                rspackConfig.watchOptions.ignored = new RegExp(
                                    `(?:${base.source})|${own.source}`,
                                    base.flags.replace(/[gy]/g, '')
                                );
                            } else if (typeof ignored === 'function') {
                                rspackConfig.watchOptions.ignored = (path: string) =>
                                    ignored(path) || own.test(slash(path));
                            } else {
                                rspackConfig.watchOptions.ignored = [
                                    ignored,
                                    outputDir,
                                    `${outputDir}/**`,
                                    metadataFiles,
                                    metadataFiles.map((file) => `${file}.*.tmp`),
                                ].flat();
                            }
                        },
                    ];
                });

                api.onAfterCreateCompiler(({ compiler }) => {
                    const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                    for (const c of compilers) {
                        // Build: emit copied files into the compilation so Rspack writes/cleans them and
                        // `sourceFilename` lets statsToGraph key them in the manifest. Dev writes them to disk in
                        // `done` instead (served by Symfony, not the dev server), so they aren't in-memory assets.
                        // Resolved per compilation, so a rebuild picks up edits to the copied files.
                        let copiedInBuild: CopyResult[] = [];
                        if (!isDev) {
                            c.hooks.thisCompilation.tap('@symfony/reprise:copy', (compilation) => {
                                compilation.hooks.processAssets.tap(
                                    {
                                        name: '@symfony/reprise:copy',
                                        stage: c.rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                                    },
                                    () => {
                                        copiedInBuild = resolveCopyFiles(resolved.copy, true);
                                        for (const file of copiedInBuild) {
                                            compilation.emitAsset(
                                                file.physicalName,
                                                new c.rspack.sources.RawSource(file.source),
                                                { sourceFilename: file.logicalName }
                                            );
                                        }
                                    }
                                );
                            });
                            // Rspack emits a runtime-only JS file for a style entry; delete it so the build
                            // matches Vite, which prunes its equivalent. Dev keeps it: nothing reaches the disk
                            // there, and the file carries the entry's HMR runtime.
                            const styleEntries = styleEntryNames(c.options.entry as RspackEntry);
                            c.hooks.thisCompilation.tap('@symfony/reprise:style-entries', (compilation) => {
                                compilation.hooks.processAssets.tap(
                                    {
                                        name: '@symfony/reprise:style-entries',
                                        stage: c.rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                                    },
                                    () => {
                                        for (const chunk of compilation.chunks) {
                                            if (!chunk.name || !styleEntries.has(chunk.name)) continue;
                                            for (const file of chunk.files) {
                                                if (file.endsWith('.js')) compilation.deleteAsset(file);
                                            }
                                            for (const file of chunk.auxiliaryFiles) {
                                                if (file.endsWith('.js.map')) compilation.deleteAsset(file);
                                            }
                                        }
                                    }
                                );
                            });
                        }

                        c.hooks.done.tap('@symfony/reprise', (stats) => {
                            // Derive the dev origin ourselves from `api.context.devServer` + our `publicPath`, rather
                            // than reading back `compiler.options.output.publicPath` (whose dev value depends on Rsbuild's merge).
                            const devServer = api.context.devServer;
                            const origin =
                                isDev && devServer
                                    ? resolveDevOrigin(
                                          { address: devServer.hostname, port: devServer.port },
                                          { override: resolved.devServerOrigin, https: devServer.https }
                                      )
                                    : null;
                            const urlPrefix = origin
                                ? resolvePublicPath(resolved.publicPath, origin)
                                : resolved.publicPath;

                            const ctx: BuildContext = {
                                isProd: !isDev,
                                devServer: origin ? { origin, client: null } : null,
                                publicPath: resolved.publicPath,
                                urlPrefix,
                                manifestKeyPrefix: resolved.manifestKeyPrefix,
                            };
                            const graph = statsToGraph(
                                stats.toJson({ assets: true, entrypoints: true }) as RspackStats,
                                // The normalized entry rather than `source.entry`: Rsbuild resolves and reshapes
                                // entries on the way to Rspack, and this is the form the stats keys match.
                                c.options.entry as RspackEntry
                            );
                            // SRI (build only): `done` fires after emit, so hash files off disk. Dev has no stable hashes.
                            if (!isDev && resolved.integrity) {
                                graph.integrity = integrityFromDisk(
                                    referencedFileNames(graph.entryPoints),
                                    resolved.outputPath,
                                    resolved.integrity.algorithms
                                );
                            }
                            // Copied files: build emits them into the compilation, so statsToGraph already keys them,
                            // but only `copyManifest` knows the `hash: false` version query, hence the overlay. Dev
                            // isn't emitted, so write them to disk and key them here.
                            let manifest: ManifestJson;
                            if (isDev) {
                                const copyFiles = resolveCopyFiles(resolved.copy, false);
                                writeCopyFiles(copyFiles, resolved.outputPath);
                                manifest = copyManifest(copyFiles, resolved);
                            } else {
                                manifest = { ...buildManifest(graph, ctx), ...copyManifest(copiedInBuild, resolved) };
                            }
                            try {
                                writeSymfonyFiles(resolved.metadataPath, buildEntrypoints(graph, ctx), manifest);
                            } catch (err) {
                                c.getInfrastructureLogger('@symfony/reprise').error(
                                    `[@symfony/reprise] failed to write entrypoints.json: ${err instanceof Error ? err.message : String(err)}`
                                );
                            }
                        });
                    }
                });
            },
        },
    };
};

export const unplugin: UnpluginInstance<Options | undefined> = /* #__PURE__ */ createUnplugin<Options | undefined>(
    unpluginFactory
);

export default unplugin;
