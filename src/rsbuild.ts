import type { RsbuildPlugin } from '@rsbuild/core'
import type { RspackStats } from './collectors/rspack'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { statsToGraph } from './collectors/rspack'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions } from './core/options'

export default function symfony(options?: Options): RsbuildPlugin {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

    setup(api) {
      // Rsbuild-level config: Symfony renders the HTML, so no per-entry HTML pages; and in dev,
      // resolve output.publicPath to the absolute dev-server origin so entry URLs point at it.
      api.modifyRsbuildConfig((config) => {
        config.tools ??= {}
        config.tools.htmlPlugin = false
        config.dev ??= {}
        // Rsbuild presets dev.assetPrefix to server.base ('/') before this hook, so `??=` no-ops;
        // force `true` so Rsbuild resolves output.publicPath to the absolute dev-server origin.
        config.dev.assetPrefix = true
        config.output ??= {}
        config.output.distPath = { ...config.output.distPath, root: resolved.outputPath }
        // Rsbuild's own config defaults `output.assetPrefix` to `'/'` before this hook runs
        // (it is never left `undefined`), so `??=` would never apply ours — assign unconditionally.
        config.output.assetPrefix = resolved.publicPath
      })

      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers = 'compilers' in compiler ? compiler.compilers : [compiler]
        for (const c of compilers) {
          c.hooks.done.tap('unplugin-symfony', (stats) => {
            const isDev = c.watchMode
            const urlPrefix = String(c.options.output.publicPath ?? resolved.publicPath)
            const origin = urlPrefix.includes('://') ? new URL(urlPrefix).origin : null

            const ctx: BuildContext = {
              isProd: !isDev,
              devServer: origin ? { origin, client: null } : null,
              publicPath: resolved.publicPath,
              urlPrefix,
              manifestKeyPrefix: resolved.manifestKeyPrefix,
            }
            const graph = statsToGraph(stats.toJson({ assets: true, entrypoints: true }) as RspackStats)
            try {
              writeSymfonyFiles(resolved.outputPath, buildEntrypoints(graph, ctx), buildManifest(graph, ctx))
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
