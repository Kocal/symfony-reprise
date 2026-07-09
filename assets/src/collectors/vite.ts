import type { Rollup } from 'vite'
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types'
import { extname, relative, resolve } from 'node:path'

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

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.postcss', '.pcss'])

export interface DevConfig {
  root: string
  build: {
    rollupOptions?: { input?: Rollup.InputOption }
    rolldownOptions?: { input?: Rollup.InputOption }
  }
}

function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

export function configToDevGraph(config: DevConfig): NormalizedGraph {
  const entryPoints: Record<string, EntryFiles> = {}
  // Vite 8 (rolldown) exposes the input under either key.
  const input = config.build.rollupOptions?.input ?? config.build.rolldownOptions?.input
  const entries: Record<string, string>
    = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, string> : {}

  for (const [name, inputPath] of Object.entries(entries)) {
    const rel = slash(relative(config.root, resolve(config.root, inputPath)))
    const type: 'js' | 'css' = CSS_EXTS.has(extname(inputPath)) ? 'css' : 'js'
    const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] }
    files[type] = [rel]
    entryPoints[name] = files
  }

  return { entryPoints, assets: [] }
}
