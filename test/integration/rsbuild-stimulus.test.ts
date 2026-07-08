import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rsbuild'

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app')

describe('rsbuild build resolves virtual:symfony/controllers', () => {
  it('bundles local controllers via VirtualModulesPlugin', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rstim-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        source: { entry: { app: join(fixture, 'app.js') } },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/', stimulus: join(fixture, 'controllers.json') })],
      },
    })
    await rsbuild.build()
    const files = readdirSync(out, { recursive: true }).map(String)
    const code = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf8')).join('\n')
    expect(code).toContain('greet')
    expect(code).toContain('heavy')
  }, 60_000)
})
