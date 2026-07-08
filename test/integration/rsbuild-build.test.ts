import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rspack'

const fixture = join(import.meta.dirname, '../fixtures/basic')

describe('rsbuild build emits Symfony files', () => {
  it('writes entrypoints.json + manifest.json under publicPath', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-build-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        mode: 'production',
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        output: { distPath: { root: out }, assetPrefix: '/build/' },
        tools: { rspack: { plugins: [Symfony({ outputPath: out, publicPath: '/build/' })] } },
      },
    })
    await rsbuild.build()

    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))
    expect(entry.isProd).toBe(true)
    expect(entry.devServer).toBeNull()
    expect(entry.publicPath).toBe('/build/')
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
    expect(entry.entryPoints.app.js.some((u: string) => /^\/build\/.*\.js$/.test(u))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest).length).toBeGreaterThan(0)
  }, 60_000)
})
