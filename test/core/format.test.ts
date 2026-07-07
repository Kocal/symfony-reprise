import type { BuildContext, NormalizedGraph } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { buildEntrypoints } from '../../src/core/format'

const ctx: BuildContext = {
  isProd: true,
  devServer: null,
  publicPath: '/build/',
  manifestKeyPrefix: 'build/',
}

const graph: NormalizedGraph = {
  entryPoints: {
    app: { js: ['app-a1b2.js'], css: ['app-c3d4.css'], preload: ['vendor-e5f6.js'], dynamic: ['lazy-x.js'] },
    admin: { js: ['admin-99.js'], css: [], preload: [], dynamic: [] },
  },
  assets: [],
}

describe('buildEntrypoints', () => {
  it('prefixes every asset list with publicPath', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.entryPoints.app).toEqual({
      js: ['/build/app-a1b2.js'],
      css: ['/build/app-c3d4.css'],
      preload: ['/build/vendor-e5f6.js'],
      dynamic: ['/build/lazy-x.js'],
    })
  })

  it('carries the mode/devServer/publicPath fields', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.isProd).toBe(true)
    expect(out.devServer).toBeNull()
    expect(out.publicPath).toBe('/build/')
  })

  it('keeps empty arrays for entries without css/preload/dynamic', () => {
    const out = buildEntrypoints(graph, ctx)
    expect(out.entryPoints.admin).toEqual({ js: ['/build/admin-99.js'], css: [], preload: [], dynamic: [] })
  })

  it('inserts a slash when publicPath has no trailing slash', () => {
    const out = buildEntrypoints(graph, { ...ctx, publicPath: '/build' })
    expect(out.entryPoints.app.js).toEqual(['/build/app-a1b2.js'])
  })
})
