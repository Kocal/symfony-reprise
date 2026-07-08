import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rspack } from '@rspack/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rspack'

const fixture = join(import.meta.dirname, '../fixtures/basic')

function build(out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    rspack(
      {
        context: fixture,
        mode: 'production',
        entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') },
        output: { path: out },
        experiments: { css: true },
        module: {
          rules: [
            { test: /\.svg$/, type: 'asset/resource' },
            // Rspack 2 deprecated auto-enabling CSS rules from `experiments.css` — declare it explicitly.
            { test: /\.css$/, type: 'css/auto' },
          ],
        },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
      },
      (err, stats) => {
        if (err)
          return reject(err)
        if (stats?.hasErrors())
          return reject(new Error(stats.toString({ all: false, errors: true })))
        resolve()
      },
    )
  })
}

describe('rspack build emits Symfony files', () => {
  it('writes entrypoints.json with entries under publicPath', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rspack-'))
    await build(out)

    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))
    expect(entry.isProd).toBe(true)
    expect(entry.devServer).toBeNull()
    expect(entry.publicPath).toBe('/build/')
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js.some((u: string) => /^\/build\/.*\.js$/.test(u))).toBe(true)
  }, 60_000)

  it('writes a non-empty manifest.json with values under publicPath', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rspack-'))
    await build(out)

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest).length).toBeGreaterThan(0)
    for (const value of Object.values(manifest))
      expect(value).toMatch(/^\/build\//)
  }, 60_000)
})
