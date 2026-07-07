import type { Options, ResolvedOptions } from '../types'
import * as path from 'node:path'

export function normalizeOptions(options: Options | undefined, cwd: string): ResolvedOptions {
  let outputPath = options?.outputPath ?? 'public/build'
  outputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath)

  const publicPath = options?.publicPath ?? '/build/'

  let manifestKeyPrefix = options?.manifestKeyPrefix ?? null
  if (manifestKeyPrefix === null) {
    if (publicPath.includes('://')) {
      throw new Error(
        `unplugin-symfony: cannot derive "manifestKeyPrefix" from an absolute "publicPath" (${publicPath}). `
        + 'Set "manifestKeyPrefix" explicitly (e.g. "build/").',
      )
    }
    manifestKeyPrefix = publicPath.replace(/^\//, '')
  }

  return { outputPath, publicPath, manifestKeyPrefix }
}

export function resolvePublicPath(publicPath: string, devOrigin: string | null): string {
  if (!devOrigin || publicPath.includes('://'))
    return publicPath
  return `${devOrigin.replace(/\/$/, '')}${publicPath}`
}
