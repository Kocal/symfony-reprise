import type { Rollup } from 'vite'
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types'

interface ViteChunkMetadata {
  importedCss: Set<string>
}
type ViteOutputChunk = Rollup.OutputChunk & { viteMetadata?: ViteChunkMetadata }

export function bundleToGraph(bundle: Rollup.OutputBundle): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  const assets: AssetEntry[] = []

  for (const file of Object.values(bundle)) {
    if (file.type === 'chunk') {
      if (file.isEntry) {
        const chunk = file as ViteOutputChunk
        entryPoints[chunk.name] = {
          js: [chunk.fileName],
          css: chunk.viteMetadata ? [...chunk.viteMetadata.importedCss] : [],
          preload: [...chunk.imports],
          dynamic: [...chunk.dynamicImports],
        }
        assets.push({ logicalName: `${chunk.name}.js`, fileName: chunk.fileName })
      }
    }
    else {
      assets.push({ logicalName: file.names[0] ?? file.fileName, fileName: file.fileName })
    }
  }

  return { entryPoints, assets }
}
