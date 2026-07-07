import { describe, expect, it } from 'vitest'
import { normalizeOptions } from '../../src/core/options'

describe('normalizeOptions', () => {
  it('resolves a relative outputPath against cwd', () => {
    const r = normalizeOptions({ outputPath: 'public/build' }, '/app')
    expect(r.outputPath).toBe('/app/public/build')
  })

  it('keeps an absolute outputPath as-is', () => {
    const r = normalizeOptions({ outputPath: '/tmp/out' }, '/app')
    expect(r.outputPath).toBe('/tmp/out')
  })

  it('applies defaults (outputPath, publicPath)', () => {
    const r = normalizeOptions(undefined, '/app')
    expect(r.outputPath).toBe('/app/public/build')
    expect(r.publicPath).toBe('/build/')
  })

  it('derives manifestKeyPrefix from publicPath by stripping the leading slash', () => {
    const r = normalizeOptions({ publicPath: '/build/' }, '/app')
    expect(r.manifestKeyPrefix).toBe('build/')
  })

  it('honors an explicit manifestKeyPrefix', () => {
    const r = normalizeOptions({ publicPath: '/assets/', manifestKeyPrefix: 'build/' }, '/app')
    expect(r.manifestKeyPrefix).toBe('build/')
  })

  it('throws for an absolute publicPath without manifestKeyPrefix', () => {
    expect(() => normalizeOptions({ publicPath: 'https://cdn.example.com/x' }, '/app'))
      .toThrow(/manifestKeyPrefix/)
  })

  it('accepts an absolute publicPath when manifestKeyPrefix is set', () => {
    const r = normalizeOptions({ publicPath: 'https://cdn.example.com/x', manifestKeyPrefix: 'build/' }, '/app')
    expect(r.publicPath).toBe('https://cdn.example.com/x')
    expect(r.manifestKeyPrefix).toBe('build/')
  })
})
