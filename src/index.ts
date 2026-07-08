import type { UnpluginFactory } from 'unplugin'
import type { RspackStats } from './collectors/rspack'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { statsToGraph } from './collectors/rspack'
import { bundleToGraph, configToDevGraph } from './collectors/vite'
import { resolveDevOrigin } from './core/dev-server'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

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
        const graph = bundleToGraph(bundle)
        const ctx: BuildContext = {
          isProd: true,
          devServer: null,
          publicPath: resolved.publicPath,
          urlPrefix: resolved.publicPath,
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
        this.emitFile({ type: 'asset', fileName: 'entrypoints.json', source: `${JSON.stringify(buildEntrypoints(graph, ctx), null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(buildManifest(graph, ctx), null, 2)}\n` })
      },

      configureServer(server) {
        // In Vite middleware mode `server.httpServer` is null, so no dev entrypoints.json is
        // written — the standalone Vite dev server is the supported Symfony workflow.
        server.httpServer?.once('listening', () => {
          const address = server.httpServer?.address()
          if (!address || typeof address === 'string')
            return

          const origin = resolveDevOrigin(address, {
            override: resolved.devServerOrigin,
            serverOrigin: server.config.server.origin,
            https: Boolean(server.config.server.https),
          })
          server.config.server.origin = origin // keep Vite's internal URL rewriting in sync

          const ctx: BuildContext = {
            isProd: false,
            devServer: { origin, client: 'vite' },
            publicPath: resolved.publicPath,
            urlPrefix: resolvePublicPath(resolved.publicPath, origin),
            manifestKeyPrefix: resolved.manifestKeyPrefix,
          }
          try {
            writeSymfonyFiles(resolved.outputPath, buildEntrypoints(configToDevGraph(server.config), ctx), {})
          }
          catch (err) {
            server.config.logger.error(`[unplugin-symfony] failed to write dev entrypoints.json: ${err instanceof Error ? err.message : String(err)}`)
          }
        })
      },
    },

    rspack(compiler) {
      // Build mode (a one-shot `compiler.run()`): our options drive Rspack's output so runtime
      // asset URLs and our JSON agree. In Rsbuild dev (`compiler.watch()`, i.e. `watchRun` instead
      // of `run`), Rsbuild has already resolved output.publicPath to the dev-server origin (from
      // dev.assetPrefix); leave it alone and read it back in the `done` hook below.
      //
      // We gate on `compiler.hooks.run` rather than `compiler.options.mode`: Rsbuild only derives
      // its own config mode from `process.env.NODE_ENV`, and only sets NODE_ENV when starting the
      // dev server if it isn't already set. Under a test runner (NODE_ENV=test) or any other
      // ambient value, `compiler.options.mode` resolves to 'none' even during a real dev run,
      // which would wrongly clobber the dev origin here. `run` vs `watchRun` instead reflects the
      // actual one-shot-build-vs-watch invocation, and is unaffected by NODE_ENV.
      compiler.hooks.run.tap('unplugin-symfony', () => {
        compiler.options.output.path = resolved.outputPath
        compiler.options.output.publicPath = resolved.publicPath
      })

      compiler.hooks.done.tap('unplugin-symfony', (stats) => {
        const isDev = compiler.watchMode
        const outputPublicPath = String(compiler.options.output.publicPath ?? resolved.publicPath)
        const urlPrefix = isDev ? outputPublicPath : resolved.publicPath
        const origin = isDev && urlPrefix.includes('://') ? new URL(urlPrefix).origin : null

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
          compiler.getInfrastructureLogger('unplugin-symfony').error(`[unplugin-symfony] failed to write entrypoints.json: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    },
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin
