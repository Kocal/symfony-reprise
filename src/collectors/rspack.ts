import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types'
import { extname } from 'node:path'

/** Minimal subset of the Rspack/webpack stats JSON (from `compilation.getStats().toJson(...)`). */
export interface RspackStats {
  entrypoints?: Record<string, { assets?: { name: string }[] }>
  assetsByChunkName?: Record<string, string[]>
  assets?: { name: string, info?: { sourceFilename?: string } }[]
}

function fileExt(name: string): string {
  return extname(name).slice(1).split('?')[0] ?? ''
}

function isHotUpdate(name: string): boolean {
  return name.includes('.hot-update.')
}

export function statsToGraph(stats: RspackStats): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
    const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] }
    for (const asset of entry.assets ?? []) {
      if (isHotUpdate(asset.name))
        continue
      const ext = fileExt(asset.name)
      if (ext === 'js')
        files.js.push(asset.name)
      else if (ext === 'css')
        files.css.push(asset.name)
    }
    entryPoints[name] = files
  }

  const assets: AssetEntry[] = []
  for (const [chunkName, files] of Object.entries(stats.assetsByChunkName ?? {})) {
    for (const fileName of files) {
      if (isHotUpdate(fileName))
        continue
      assets.push({ logicalName: `${chunkName}.${fileExt(fileName)}`, fileName })
    }
  }
  for (const asset of stats.assets ?? []) {
    const logical = asset.info?.sourceFilename
    if (logical && !isHotUpdate(asset.name))
      assets.push({ logicalName: logical, fileName: asset.name })
  }

  return { entryPoints, assets }
}
