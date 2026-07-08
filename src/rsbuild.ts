import type { RsbuildPlugin } from '@rsbuild/core'
import type { RspackStats } from './collectors/rspack'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { statsToGraph } from './collectors/rspack'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'

export default function symfony(options?: Options): RsbuildPlugin {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

    setup(api) {
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
        // Rsbuild's own config defaults `output.assetPrefix` to `'/'` before this hook runs
        // (it is never left `undefined`), so `??=` would never apply ours — assign unconditionally.
        // Note: this only takes effect for the production build. In dev, Rsbuild's own
        // `getPublicPath()` ignores `output.assetPrefix` entirely and derives the dev-server
        // origin from `dev.assetPrefix` instead (see the `done` hook below, which computes the
        // dev urlPrefix itself rather than relying on that merge).
        config.output.assetPrefix = resolved.publicPath
      })

      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers = 'compilers' in compiler ? compiler.compilers : [compiler]
        for (const c of compilers) {
          c.hooks.done.tap('unplugin-symfony', (stats) => {
            const isDev = c.watchMode
            // In dev, Rsbuild's own `getPublicPath()` (called before this hook, to compute
            // `output.publicPath`) only ever returns EITHER the dev-server origin OR
            // `output.assetPrefix` — never both — so `compiler.options.output.publicPath` can't
            // be trusted to carry our `publicPath` (e.g. "/build/") once dev-server resolution
            // kicks in. `api.context.devServer` (hostname/port/https) is populated by the time
            // the compiler is created, independent of that merge, so derive the origin from it
            // directly and join it with our own `publicPath` via `resolvePublicPath`.
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
