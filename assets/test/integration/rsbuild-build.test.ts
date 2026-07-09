import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rsbuild'

const fixture = join(import.meta.dirname, '../fixtures/basic')

describe('rsbuild build emits Symfony files and no HTML', () => {
  it('writes entrypoints.json + manifest.json under publicPath, and no per-entry HTML', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rsbuild-build-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        mode: 'production',
        source: { entry: { app: join(fixture, 'app.js'), admin: join(fixture, 'admin.js') } },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
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

    // No per-entry HTML anywhere in the output dir.
    const htmlFiles = readdirSync(out, { recursive: true }).filter(f => String(f).endsWith('.html'))
    expect(htmlFiles).toEqual([])
  }, 60_000)

  it('does not throw ERR_FS_CP_EINVAL when outputPath is nested inside the default public dir', async () => {
    // Regression test: Rsbuild's default public dir is `<cwd>/public`. When `outputPath`
    // resolves to a subdirectory of it (Symfony's usual `public/build` layout), Rsbuild's
    // own public-dir copy-on-build tries to copy `public/` into `public/build/` — a
    // subpath of itself — which Node's `fs.cp` rejects with `ERR_FS_CP_EINVAL`.
    const cwd = mkdtempSync(join(tmpdir(), 'ups-rsbuild-nested-public-'))
    const outputPath = join(cwd, 'public', 'build')
    // Rsbuild only attempts the public-dir copy if `<cwd>/public` exists on disk, so it must
    // be created (with something in it, mirroring Symfony's `public/index.php`) for this test
    // to actually exercise the self-copy path rather than short-circuiting before it.
    mkdirSync(join(cwd, 'public'), { recursive: true })
    writeFileSync(join(cwd, 'public', 'index.php'), '<?php // fixture\n')
    const rsbuild = await createRsbuild({
      cwd,
      rsbuildConfig: {
        mode: 'production',
        source: { entry: { app: join(fixture, 'app.js') } },
        plugins: [Symfony({ outputPath, publicPath: '/build/' })],
      },
    })

    await expect(rsbuild.build()).resolves.not.toThrow()

    const entry = JSON.parse(readFileSync(join(outputPath, 'entrypoints.json'), 'utf8'))
    expect(Object.keys(entry.entryPoints)).toEqual(['app'])
  }, 60_000)
})
