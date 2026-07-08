import { describe, expect, it } from 'vitest'
import { statsToGraph } from '../../src/collectors/rspack'

describe('statsToGraph', () => {
  it('extracts js/css per entry and skips hot-update files', () => {
    const graph = statsToGraph({
      entrypoints: {
        app: { assets: [{ name: 'runtime.js' }, { name: 'app.a1.js' }, { name: 'app.b2.css' }, { name: 'app.c3.hot-update.js' }] },
        admin: { assets: [{ name: 'admin.d4.js' }] },
      },
    })
    expect(graph.entryPoints.app).toEqual({ js: ['runtime.js', 'app.a1.js'], css: ['app.b2.css'], preload: [], dynamic: [] })
    expect(graph.entryPoints.admin).toEqual({ js: ['admin.d4.js'], css: [], preload: [], dynamic: [] })
  })

  it('builds manifest assets from assetsByChunkName and sourceFilename', () => {
    const graph = statsToGraph({
      entrypoints: {},
      assetsByChunkName: { app: ['app.a1.js', 'app.b2.css'] },
      assets: [{ name: 'logo.e5.svg', info: { sourceFilename: 'images/logo.svg' } }],
    })
    expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app.a1.js' })
    expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app.b2.css' })
    expect(graph.assets).toContainEqual({ logicalName: 'images/logo.svg', fileName: 'logo.e5.svg' })
  })

  it('tolerates empty/absent stats sections', () => {
    expect(statsToGraph({})).toEqual({ entryPoints: {}, assets: [] })
  })
})
