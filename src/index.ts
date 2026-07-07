import type { AddressInfo } from 'node:net'
import type { UnpluginFactory } from 'unplugin'
import type { BuildContext, Options } from './types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { bundleToGraph, configToDevGraph } from './collectors/vite'
import { resolveDevOrigin } from './core/dev-server'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions, resolvePublicPath } from './core/options'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())

  function writeDevFiles(entrypoints: unknown): void {
    mkdirSync(resolved.outputPath, { recursive: true })
    writeFileSync(join(resolved.outputPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`)
    writeFileSync(join(resolved.outputPath, 'manifest.json'), '{}\n')
  }

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
        server.httpServer?.once('listening', () => {
          const address = server.httpServer?.address()
          if (!address || typeof address === 'string')
            return

          const origin = resolveDevOrigin(address as AddressInfo, {
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
          writeDevFiles(buildEntrypoints(configToDevGraph(server.config), ctx))
        })
      },
    },

    rspack(compiler) {
      compiler.options.output.path = resolved.outputPath
      compiler.options.output.publicPath = resolved.publicPath
    },
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin
