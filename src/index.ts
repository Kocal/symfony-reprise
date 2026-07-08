import type { UnpluginFactory } from 'unplugin'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { bundleToGraph, configToDevGraph } from './collectors/vite'
import { resolveDevOrigin } from './core/dev-server'
import { writeSymfonyFiles } from './core/emit'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'
import { generateControllersModule } from './core/stimulus'

const VIRTUAL_ID = 'virtual:symfony/controllers'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())
  let isDev = false

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

      configResolved(config) {
        isDev = config.command === 'serve'
      },

      resolveId(id) {
        if (resolved.stimulus && id === VIRTUAL_ID)
          return RESOLVED_VIRTUAL_ID
      },

      load(id) {
        if (resolved.stimulus && id === RESOLVED_VIRTUAL_ID)
          return generateControllersModule(resolved.stimulus, process.cwd(), isDev)
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
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin
