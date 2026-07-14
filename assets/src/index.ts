import type { UnpluginFactory } from 'unplugin';
import type { RspackStats } from './collectors/rspack';
import type { BuildContext, ManifestJson, NormalizedGraph, Options } from './types';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as process from 'node:process';
import { createUnplugin } from 'unplugin';
import { statsToGraph } from './collectors/rspack';
import { bundleToGraph, configToDevGraph } from './collectors/vite';
import { copyManifest, resolveCopyFiles, writeCopyFiles } from './core/copy';
import { resolveDevOrigin } from './core/dev-server';
import { writeSymfonyFiles } from './core/emit';
import { buildEntrypoints, buildManifest, joinUrl } from './core/format';
import { integrityFromDisk, referencedFileNames } from './core/integrity';
import { normalizeOptions, resolvePublicPath } from './core/options';
import { generateControllersModule, STIMULUS_NOT_ENABLED_MESSAGE, VIRTUAL_CONTROLLERS_ID } from './core/stimulus';

const VIRTUAL_ID = VIRTUAL_CONTROLLERS_ID;
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
    const cwd = process.cwd();
    const resolved = normalizeOptions(options, cwd);
    let isDev = false;
    // Vite's project root, captured in `configResolved` (defaults to cwd). Used to key imported
    // assets relative to it in `bundleToGraph`, matching Rsbuild's context-relative sourceFilename.
    let root = cwd;
    // When SRI is on, entrypoints.json is finished in `writeBundle` (see below); stash what it needs.
    let pendingIntegrity: { graph: NormalizedGraph; ctx: BuildContext } | null = null;

    return {
        name: '@symfony/reprise',

        // Symfony UX / Stimulus virtual module, shared across bundlers. These universal hooks are
        // applied to the Vite plugin directly and forwarded to Rspack by unplugin's Rsbuild adapter
        // (it injects the raw plugin into the Rspack config via `api.modifyRspackConfig`), so a single
        // implementation serves `virtual:symfony/controllers` on both — no per-bundler virtual-module
        // plumbing. The `\0` prefix is Rollup's virtual-id convention; unplugin passes it through to
        // Rspack's resolver unchanged, and Rspack accepts it (it never reaches enhanced-resolve's
        // URI-scheme detection, which is what a raw `virtual:` alias would trip over).
        resolveId(id) {
            if (id !== VIRTUAL_ID) return;
            // The helper (`@symfony/reprise/stimulus`) imports this unconditionally, so if a
            // user pulls in `startStimulusApp()` without turning the feature on, fail with a clear,
            // actionable message rather than the bundler's generic "failed to resolve".
            if (!resolved.stimulus) throw new Error(STIMULUS_NOT_ENABLED_MESSAGE);
            return RESOLVED_VIRTUAL_ID;
        },

        load(id) {
            if (resolved.stimulus && id === RESOLVED_VIRTUAL_ID)
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
                root = config.root;
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

                    // Vite serves its HMR client under `base` (our publicPath), so the client URL is
                    // `<origin><publicPath>@vite/client` — not `<origin>/@vite/client`. Emit the full URL
                    // so the Symfony side injects it verbatim.
                    const urlPrefix = resolvePublicPath(resolved.publicPath, origin);
                    const ctx: BuildContext = {
                        isProd: false,
                        devServer: { origin, client: joinUrl(urlPrefix, '@vite/client') },
                        publicPath: resolved.publicPath,
                        urlPrefix,
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

        rsbuild: {
            // Rsbuild needs config-level control the universal hooks can't reach, so unplugin forwards
            // the real Rsbuild plugin `api` here (same object any native RsbuildPlugin.setup receives).
            // `@rsbuild/core` is an optional peer: importing it statically would drag it into the shared
            // factory (and thus the Vite bundle), breaking Vite-only installs that never added it. Load
            // it lazily instead — this `import()` only runs when the plugin is actually driven by
            // Rsbuild. `rspack.*` (`Compilation`/`sources`) is used inside the synchronous
            // `processAssets` tap below, so bind it up front, before the taps are registered.
            async setup(api) {
                const { rspack } = await import('@rsbuild/core');
                // `api.context.action` ('dev' vs 'build') is the Rsbuild analog of Vite's
                // `configResolved` command; feeds the shared `isDev` the universal `load` reads.
                isDev = api.context.action === 'dev';

                // Rsbuild-level config: Symfony renders the HTML, so no per-entry HTML pages.
                api.modifyRsbuildConfig((config) => {
                    config.tools ??= {};
                    config.tools.htmlPlugin = false;
                    config.output ??= {};
                    const prevDistPath = typeof config.output.distPath === 'object' ? config.output.distPath : {};
                    config.output.distPath = { ...prevDistPath, root: resolved.outputPath };
                    // `outputPath` (e.g. `public/build`) lives inside Rsbuild's default public dir
                    // (`public`). On build, Rsbuild copies the public dir into the dist output, which
                    // here means copying `public/` into `public/build/` — a subpath of itself — and
                    // Node's `fs.cp` rejects that with `ERR_FS_CP_EINVAL`. Symfony's public dir isn't a
                    // Rsbuild-managed static-assets folder anyway, so disable Rsbuild's own copy/serve of
                    // it entirely (this is the Rspack analog of `copyPublicDir: false` in the Vite path).
                    config.server ??= {};
                    config.server.publicDir = false;
                    // Serve the dev server under `publicPath` (e.g. `/build/`), so the in-memory assets live
                    // at the same URL path we advertise in the dev entrypoints.json. Rsbuild's `getPublicPath`
                    // joins `server.base` onto the dev-server origin when `dev.assetPrefix` is left at its
                    // default, yielding an absolute `http://host:port/build/` — matching production's
                    // `/build/` prefix and the Vite path (whose `base` is likewise the publicPath). Without
                    // this the dev server serves at the origin root (`/`) while we advertise `/build/`, so
                    // every advertised URL 404s.
                    // `server.base` must be a slash-path (Rsbuild rejects anything else). An absolute
                    // (CDN) publicPath cannot be served by the local dev server, so fall back to the root;
                    // in dev the advertised URLs come from `resolvePublicPath` (which keeps an absolute
                    // publicPath as-is), so nothing is served under the CDN prefix locally anyway.
                    config.server.base = resolved.publicPath.includes('://') ? '/' : resolved.publicPath;
                    // Rsbuild's own config defaults `output.assetPrefix` to `'/'` before this hook runs
                    // (it is never left `undefined`), so `??=` would never apply ours — assign unconditionally.
                    // This drives the production build's asset URLs; in dev the serving path comes from
                    // `server.base` above.
                    config.output.assetPrefix = resolved.publicPath;
                    // Standardise on ESM so the tags render as `<script type="module">` like Vite.
                    config.output.module = true;

                    // The host the advertised dev URLs must point at. It has to be the host the dev server
                    // actually binds to, which is why we can't hardcode a literal: Rsbuild's default
                    // `server.host` resolves to `localhost`, and on an IPv6-capable machine `localhost`
                    // binds to `::1` only — so a hardcoded `127.0.0.1` (IPv4 loopback) is NOT listening and
                    // every request to it is refused (HMR socket, `/_rspack/lazy/trigger`, async chunks).
                    // Derive it from the configured host instead, with the same `0.0.0.0`/unset -> `localhost`
                    // mapping the `done` tap applies to `devServer.hostname` for the entrypoints origin, so
                    // the two stay in lockstep. `localhost` (and loopback IPs) are "potentially trustworthy",
                    // so `ws://`/`http://` are allowed even from an HTTPS Symfony page (not mixed content).
                    const devHost =
                        config.server.host && config.server.host !== '0.0.0.0' ? config.server.host : 'localhost';

                    // HMR + lazy-compilation client. Rspack compiles the client INTO the bundle, and by
                    // default it derives its WebSocket URL from `window.location` — which is the Symfony
                    // page, not our dev server — so HMR and the `/_rspack/lazy/trigger` request hit the
                    // wrong origin (Symfony 404s them). Pin the client to the dev-server host instead.
                    // `<port>` is a token Rsbuild substitutes with the real resolved port at server start
                    // (the port is dynamic and unknown in this config-time hook). Setting the protocol
                    // explicitly stops the client inferring `wss` from an HTTPS page when the dev server
                    // itself is plain HTTP. Lazy compilation reads the same `dev.client`, so this fixes it
                    // too. (A non-loopback dev host with an HTTPS Symfony page would need the dev server on
                    // HTTPS; the loopback default needs no TLS on the dev server.)
                    config.dev ??= {};
                    config.dev.client = {
                        ...config.dev.client,
                        host: devHost,
                        port: '<port>',
                        protocol: config.server.https ? 'wss' : 'ws',
                    };
                    // Async chunks (code-split JS/CSS, e.g. a lazy Stimulus controller's stylesheet) load
                    // through Rspack's chunk-loading runtime, which builds their URLs from
                    // `output.publicPath`. In dev that comes from `dev.assetPrefix` (default `/`), so the
                    // chunks resolve against the Symfony page origin and 404. The string form is used
                    // verbatim — `server.base` is NOT composed in — so it must carry the full publicPath;
                    // `<port>` is substituted with the real dev-server port at server start. Skip an
                    // absolute (CDN) publicPath, which the local dev server can't serve (mirrors the
                    // `server.base` fallback above). Dev-only: the production build uses `output.assetPrefix`.
                    if (!resolved.publicPath.includes('://')) {
                        config.dev.assetPrefix = `${config.server.https ? 'https' : 'http'}://${devHost}:<port>${resolved.publicPath}`;
                    }

                    // Emit ES modules at the Rspack layer too, so async chunks are `import()`ed and the
                    // output matches Vite's `<script type="module">`. `output.module` above is the Rsbuild
                    // knob; these are the underlying Rspack experiments/output flags it maps to.
                    const prev = config.tools.rspack;
                    const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
                    config.tools.rspack = [
                        ...prevList,
                        (rspackConfig) => {
                            rspackConfig.experiments ??= {};
                            rspackConfig.experiments.outputModule = true;
                            rspackConfig.output ??= {};
                            rspackConfig.output.module = true;
                            rspackConfig.output.chunkFormat = 'module';
                        },
                    ];
                });

                api.onAfterCreateCompiler(({ compiler }) => {
                    const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
                    for (const c of compilers) {
                        // Build: emit the copied files into the compilation, so Rspack writes them, lists
                        // them in the build output, and cleans them like any other asset. `sourceFilename`
                        // lets the existing statsToGraph collector key them in manifest.json (no manual
                        // merge — see the `done` tap). Dev instead writes them to disk in `done`: there they
                        // are served by the Symfony web server from `public/build`, not by the dev server,
                        // so they must not become in-memory compilation assets.
                        if (!isDev) {
                            c.hooks.thisCompilation.tap('@symfony/reprise:copy', (compilation) => {
                                compilation.hooks.processAssets.tap(
                                    {
                                        name: '@symfony/reprise:copy',
                                        stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                                    },
                                    () => {
                                        for (const file of resolveCopyFiles(resolved.copy, true)) {
                                            compilation.emitAsset(
                                                file.physicalName,
                                                new rspack.sources.RawSource(file.source),
                                                { sourceFilename: file.logicalName }
                                            );
                                        }
                                    }
                                );
                            });
                        }

                        c.hooks.done.tap('@symfony/reprise', (stats) => {
                            const isDev = c.watchMode;
                            // The dev URLs we advertise must be the dev-server origin joined with our `publicPath`
                            // (e.g. `http://127.0.0.1:3001/build/…`), which is exactly where `server.base` (set in
                            // `modifyRsbuildConfig`) makes the dev server serve the in-memory assets. Rather than
                            // read `compiler.options.output.publicPath` back (its dev value depends on how Rsbuild
                            // merged `server.base`/`dev.assetPrefix`), derive the origin ourselves from
                            // `api.context.devServer` (hostname/port/https — populated by the time the compiler is
                            // created) and join our own `publicPath` onto it via `resolvePublicPath`. Keeps this in
                            // lockstep with the `server.base` value above regardless of Rsbuild's internal merge.
                            const devServer = api.context.devServer;
                            // Rsbuild's own equivalent (`getPublicPath()`) special-cases the "listen on all
                            // interfaces" hostname the same way: a browser can't dial 0.0.0.0, so substitute
                            // localhost for the URL we hand back to Symfony/Twig.
                            const hostname = devServer?.hostname === '0.0.0.0' ? 'localhost' : devServer?.hostname;
                            const origin =
                                isDev && devServer
                                    ? `${devServer.https ? 'https' : 'http'}://${hostname}:${devServer.port}`
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
                                stats.toJson({ assets: true, entrypoints: true }) as RspackStats
                            );
                            // SRI (build only): `done` fires after emit, so hash the files back off disk
                            // (the same approach Encore takes). Dev serves changing in-memory assets, no hashes.
                            if (!isDev && resolved.integrity) {
                                graph.integrity = integrityFromDisk(
                                    referencedFileNames(graph.entryPoints),
                                    resolved.outputPath,
                                    resolved.integrity.algorithms
                                );
                            }
                            // Copied static files: in build they were emitted into the compilation (see the
                            // processAssets tap above), so statsToGraph already carries them in `graph.assets`
                            // and `buildManifest` keys them. In dev they are not emitted (served by the Symfony
                            // web server from disk, not the dev server), so write them out here and key them by
                            // their relative publicPath URL.
                            let manifest: ManifestJson;
                            if (isDev) {
                                const copyFiles = resolveCopyFiles(resolved.copy, false);
                                writeCopyFiles(copyFiles, resolved.outputPath);
                                manifest = copyManifest(copyFiles, {
                                    publicPath: resolved.publicPath,
                                    manifestKeyPrefix: resolved.manifestKeyPrefix,
                                });
                            } else {
                                manifest = buildManifest(graph, ctx);
                            }
                            try {
                                writeSymfonyFiles(resolved.outputPath, buildEntrypoints(graph, ctx), manifest);
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

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);

export default unplugin;
