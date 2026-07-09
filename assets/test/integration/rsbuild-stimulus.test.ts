import type { RsbuildPlugin } from '@rsbuild/core'
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

  it('fails with a clear message when the virtual module is imported but stimulus is off', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rstim-off-'))

    // Rspack wraps the plugin's throw as a generic "Rspack build failed." rejection, but records the
    // real module error on `stats.compilation.errors`. Tap `done` to read it and assert our guidance
    // is what the user sees.
    const errors: string[] = []
    const capture: RsbuildPlugin = {
      name: 'capture-errors',
      setup(api) {
        api.onAfterCreateCompiler(({ compiler }) => {
          const compilers = 'compilers' in compiler ? compiler.compilers : [compiler]
          for (const c of compilers) {
            c.hooks.done.tap('capture', (stats) => {
              for (const e of stats.compilation.errors)
                errors.push(String((e as { message?: string }).message ?? e))
            })
          }
        })
      },
    }
    const rsbuildOff = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        source: { entry: { app: join(fixture, 'app.js') } },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' }), capture],
      },
    })

    let failed = false
    try {
      await rsbuildOff.build()
    }
    catch {
      failed = true
    }

    expect(failed).toBe(true)
    expect(errors.join('\n')).toMatch(/Stimulus integration is not enabled/)
  }, 60_000)
})
