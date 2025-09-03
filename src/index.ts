import type { UnpluginFactory } from 'unplugin'
import type { Options } from './types'
import * as path from 'node:path'
import * as process from 'node:process'
import { createUnplugin } from 'unplugin'

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, meta) => {
  let outputPath = options?.outputPath ?? 'public/build'
  outputPath = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath)

  const publicPath = options?.publicPath ?? 'build/'

  let manifestKeyPrefix = options?.manifestKeyPrefix ?? null
  if (manifestKeyPrefix === null) {
    if (publicPath === null) {
      throw new Error('Option "publicPath" is missing')
    }
    manifestKeyPrefix = publicPath.replace(/^\//, '')
  }

  return {
    name: 'unplugin-symfony',
    buildStart() {
      console.log('Build started!')
      console.log('Output path:', outputPath)
      console.log('Public path:', publicPath)
    },
    buildEnd() {
      console.log('build end!')
    },

    vite: {
      config: () => ({
        build: {
          outDir: outputPath,
          copyPublicDir: false,
          manifest: false,
          assetsDir: '.',
        },
      }),
    },

    rspack(compiler) {
      compiler.options.output.path = outputPath
      compiler.options.output.publicPath = publicPath
    },
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin
