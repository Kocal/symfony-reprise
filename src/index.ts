import type { UnpluginFactory } from 'unplugin'
import type { BuildContext, Options } from './types'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'
import { bundleToGraph } from './collectors/vite'
import { buildEntrypoints, buildManifest } from './core/format'
import { normalizeOptions } from './core/options'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
  const resolved = normalizeOptions(options, process.cwd())

  return {
    name: 'unplugin-symfony',

    vite: {
      config: () => ({
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
          manifestKeyPrefix: resolved.manifestKeyPrefix,
        }
        const entrypoints = buildEntrypoints(graph, ctx)
        const manifest = buildManifest(graph, ctx)
        this.emitFile({ type: 'asset', fileName: 'entrypoints.json', source: `${JSON.stringify(entrypoints, null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(manifest, null, 2)}\n` })
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
