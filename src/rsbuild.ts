import type { RsbuildPlugin } from '@rsbuild/core'
import type { RspackStats } from './collectors/rspack'
import type { BuildContext, Options } from './types'
import * as path from 'node:path'
import * as process from 'node:process'
import { rspack } from '@rsbuild/core'
import { statsToGraph } from './collectors/rspack'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'
import { generateControllersModule, STIMULUS_NOT_ENABLED_MESSAGE, VIRTUAL_CONTROLLERS_ID } from './core/stimulus'

const VIRTUAL_ID = VIRTUAL_CONTROLLERS_ID

export default function symfony(options?: Options): RsbuildPlugin {
  const resolved = normalizeOptions(options, process.cwd())
  const stimulus = resolved.stimulus
  const virtualPath = path.join(process.cwd(), 'node_modules/.unplugin-symfony/controllers.mjs')

  return {
    name: 'unplugin-symfony',

    setup(api) {
      // Symfony UX / Stimulus: provision `virtual:symfony/controllers` via Rspack's own
      // virtual-module mechanism (unplugin has no `resolveId`/`load` hook for Rsbuild — see
      // AGENTS.md). `VirtualModulesPlugin`'s constructor content is what Rspack's native
      // compiler snapshots when its instance is created (`writeModule` only updates a store
      // that exists post-instantiation, so it cannot seed the very first build) — generate the
      // real module content up front, using `api.context.action` (available synchronously here)
      // to tell dev from build.
      const isDev = api.context.action === 'dev'
      const vmPlugin = stimulus
        ? new rspack.experiments.VirtualModulesPlugin({
            [virtualPath]: generateControllersModule(stimulus, process.cwd(), isDev),
          })
        : null

      // Rsbuild-level config: Symfony renders the HTML, so no per-entry HTML pages.
      api.modifyRsbuildConfig((config) => {
        config.tools ??= {}
        config.tools.htmlPlugin = false
        config.output ??= {}
        const prevDistPath = typeof config.output.distPath === 'object' ? config.output.distPath : {}
        config.output.distPath = { ...prevDistPath, root: resolved.outputPath }
        // `outputPath` (e.g. `public/build`) lives inside Rsbuild's default public dir
        // (`public`). On build, Rsbuild copies the public dir into the dist output, which
        // here means copying `public/` into `public/build/` — a subpath of itself — and
        // Node's `fs.cp` rejects that with `ERR_FS_CP_EINVAL`. Symfony's public dir isn't a
        // Rsbuild-managed static-assets folder anyway, so disable Rsbuild's own copy/serve of
        // it entirely (this is the Rspack analog of `copyPublicDir: false` in the Vite path).
        config.server ??= {}
        config.server.publicDir = false
        // Serve the dev server under `publicPath` (e.g. `/build/`), so the in-memory assets live
        // at the same URL path we advertise in the dev entrypoints.json. Rsbuild's `getPublicPath`
        // joins `server.base` onto the dev-server origin when `dev.assetPrefix` is left at its
        // default, yielding an absolute `http://host:port/build/` — matching production's
        // `/build/` prefix and the Vite path (whose `base` is likewise the publicPath). Without
        // this the dev server serves at the origin root (`/`) while we advertise `/build/`, so
        // every advertised URL 404s.
        config.server.base = resolved.publicPath
        // Rsbuild's own config defaults `output.assetPrefix` to `'/'` before this hook runs
        // (it is never left `undefined`), so `??=` would never apply ours — assign unconditionally.
        // This drives the production build's asset URLs; in dev the serving path comes from
        // `server.base` above.
        config.output.assetPrefix = resolved.publicPath

        // Handle the bare virtual specifier. `resolve.alias` cannot: Rspack's resolver
        // (enhanced-resolve) treats any request matching a URI-scheme pattern
        // (`^[a-z][a-z0-9+.-]*:`) — which `virtual:...` does — as a URI to hand to a scheme plugin
        // *before* alias lookup ever runs, so aliasing `virtual:symfony/controllers` throws
        // "Unhandled scheme" regardless of the alias map. `NormalModuleReplacementPlugin` instead
        // rewrites `resolveData.request` in the `beforeResolve` factory hook, ahead of the resolver
        // entirely, sidestepping scheme detection. Registered unconditionally so that when Stimulus
        // is off we can still turn an accidental helper import into a clear message rather than that
        // cryptic scheme error (the callback only fires if something actually imports the id).
        const prev = config.tools.rspack
        const prevList = Array.isArray(prev) ? prev : prev ? [prev] : []
        config.tools.rspack = [
          ...prevList,
          (_rspackConfig, { appendPlugins }) => {
            if (vmPlugin) {
              // Stimulus enabled: redirect to the absolute path backed by `vmPlugin` (see above).
              appendPlugins([
                vmPlugin,
                new rspack.NormalModuleReplacementPlugin(new RegExp(`^${VIRTUAL_ID}$`), virtualPath),
              ])
            }
            else {
              appendPlugins([
                new rspack.NormalModuleReplacementPlugin(new RegExp(`^${VIRTUAL_ID}$`), () => {
                  throw new Error(STIMULUS_NOT_ENABLED_MESSAGE)
                }),
              ])
            }
          },
        ]
      })

      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers = 'compilers' in compiler ? compiler.compilers : [compiler]
        for (const c of compilers) {
          c.hooks.done.tap('unplugin-symfony', (stats) => {
            const isDev = c.watchMode
            // The dev URLs we advertise must be the dev-server origin joined with our `publicPath`
            // (e.g. `http://127.0.0.1:3001/build/…`), which is exactly where `server.base` (set in
            // `modifyRsbuildConfig`) makes the dev server serve the in-memory assets. Rather than
            // read `compiler.options.output.publicPath` back (its dev value depends on how Rsbuild
            // merged `server.base`/`dev.assetPrefix`), derive the origin ourselves from
            // `api.context.devServer` (hostname/port/https — populated by the time the compiler is
            // created) and join our own `publicPath` onto it via `resolvePublicPath`. Keeps this in
            // lockstep with the `server.base` value above regardless of Rsbuild's internal merge.
            const devServer = api.context.devServer
            // Rsbuild's own equivalent (`getPublicPath()`) special-cases the "listen on all
            // interfaces" hostname the same way: a browser can't dial 0.0.0.0, so substitute
            // localhost for the URL we hand back to Symfony/Twig.
            const hostname = devServer?.hostname === '0.0.0.0' ? 'localhost' : devServer?.hostname
            const origin = isDev && devServer
              ? `${devServer.https ? 'https' : 'http'}://${hostname}:${devServer.port}`
              : null
            const urlPrefix = origin ? resolvePublicPath(resolved.publicPath, origin) : resolved.publicPath

            const ctx: BuildContext = {
              isProd: !isDev,
              devServer: origin ? { origin, client: null } : null,
              publicPath: resolved.publicPath,
              urlPrefix,
              manifestKeyPrefix: resolved.manifestKeyPrefix,
            }
            const graph = statsToGraph(stats.toJson({ assets: true, entrypoints: true }) as RspackStats)
            // In dev the manifest is empty: assets are served from the dev server, never looked
            // up on disk by hash, so cache-busting is moot. entrypoints.json alone drives loading.
            // Matches the Vite dev path (see `configureServer` in index.ts), which also writes `{}`.
            const manifest = isDev ? {} : buildManifest(graph, ctx)
            try {
              writeSymfonyFiles(resolved.outputPath, buildEntrypoints(graph, ctx), manifest)
            }
            catch (err) {
              c.getInfrastructureLogger('unplugin-symfony').error(`[unplugin-symfony] failed to write entrypoints.json: ${err instanceof Error ? err.message : String(err)}`)
            }
          })
        }
      })
    },
  }
}
