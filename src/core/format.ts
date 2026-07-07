import type { BuildContext, EntryFiles, EntrypointsJson, NormalizedGraph } from '../types'

function joinUrl(prefix: string, name: string): string {
  return prefix.endsWith('/') ? prefix + name : `${prefix}/${name}`
}

export function buildEntrypoints(graph: NormalizedGraph, ctx: BuildContext): EntrypointsJson {
  const entryPoints: Record<string, EntryFiles> = {}
  for (const [name, files] of Object.entries(graph.entryPoints)) {
    entryPoints[name] = {
      js: files.js.map(f => joinUrl(ctx.publicPath, f)),
      css: files.css.map(f => joinUrl(ctx.publicPath, f)),
      preload: files.preload.map(f => joinUrl(ctx.publicPath, f)),
      dynamic: files.dynamic.map(f => joinUrl(ctx.publicPath, f)),
    }
  }
  return { isProd: ctx.isProd, devServer: ctx.devServer, publicPath: ctx.publicPath, entryPoints }
}
