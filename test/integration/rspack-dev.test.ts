import type { RsbuildPlugin } from '@rsbuild/core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Symfony from '../../src/rspack'

const fixture = join(import.meta.dirname, '../fixtures/basic')

/**
 * Rsbuild's own `server.port: 0` handling does not resolve to the real OS-assigned port
 * (see `getPort()` in `@rsbuild/core`'s dist bundle: it probes port 0, which always succeeds,
 * but never reads back the actual ephemeral port from the probe socket) — `dev.assetPrefix: true`
 * then bakes the literal, unreachable "port 0" into `output.publicPath`. Picking a real free port
 * up front sidesteps that upstream quirk and exercises the real `assetPrefix -> output.publicPath
 * -> our origin` chain end to end.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

describe('rsbuild dev writes a dev entrypoints.json', () => {
  let server: Awaited<ReturnType<Awaited<ReturnType<typeof createRsbuild>>['startDevServer']>>
  let out: string

  beforeEach(async () => {
    out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-dev-'))
    const port = await getFreePort()

    // The `done` hook (Task 3) writes entrypoints.json synchronously as part of Rspack's `done`
    // tap chain, but `startDevServer()` resolves once the HTTP server is listening — which races
    // ahead of that first compilation finishing. `onAfterDevCompile` is Rsbuild's own first-build
    // signal (fires after all `compiler.hooks.done` taps, including ours, have run), so awaiting
    // it removes the race without polling or sleeping.
    let resolveFirstCompile: () => void
    const firstCompileDone = new Promise<void>((resolve) => {
      resolveFirstCompile = resolve
    })
    const waitForFirstCompilePlugin: RsbuildPlugin = {
      name: 'test-wait-for-first-compile',
      setup(api) {
        api.onAfterDevCompile(({ isFirstCompile }) => {
          if (isFirstCompile)
            resolveFirstCompile()
        })
      },
    }

    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        // Rsbuild derives its own internal `config.mode` from `process.env.NODE_ENV` unless told
        // otherwise, and only auto-sets NODE_ENV when starting the dev server if it isn't already
        // set (see `startDevServer` in `@rsbuild/core`'s dist bundle). Vitest sets NODE_ENV=test
        // ambiently, so without this, Rsbuild's own `config.mode` resolves to 'none' and it skips
        // computing the dev-server-origin asset prefix entirely (falling back to the production
        // default of '/') — nothing to do with our plugin. Setting `mode: 'development'` explicitly
        // reproduces what a real `rsbuild dev` invocation gets for free outside a test runner.
        mode: 'development',
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        server: { port },
        dev: { assetPrefix: true },
        plugins: [waitForFirstCompilePlugin],
        tools: { rspack: { plugins: [Symfony({ outputPath: out, publicPath: '/build/' })] } },
      },
    })
    server = await rsbuild.startDevServer()
    await firstCompileDone
  })

  afterEach(async () => {
    await server.server.close()
  })

  it('marks dev mode, sets an origin, and uses client:null', () => {
    const entry = JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'))

    expect(entry.isProd).toBe(false)
    expect(entry.publicPath).toBe('/build/')
    expect(entry.devServer).not.toBeNull()
    expect(entry.devServer.client).toBeNull()
    expect(entry.devServer.origin).toMatch(/^https?:\/\//)
    expect(Object.keys(entry.entryPoints).sort()).toEqual(['admin', 'app'])
  }, 60_000)
})
