import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import type { GlobalSetupContext } from 'vitest/node'

const e2eDir = dirname(fileURLToPath(import.meta.url))
const playgroundDir = resolve(e2eDir, '..', '..')
const repoRoot = resolve(playgroundDir, '..')

const BUNDLER = process.env.E2E_BUNDLER === 'rsbuild' ? 'rsbuild' : 'vite'
const PORT = process.env.E2E_PORT ?? '8099'

function runQuiet(cmd: string, args: string[]): void {
  try {
    execFileSync(cmd, args, { cwd: playgroundDir, stdio: 'ignore' })
  } catch {
    // best effort (e.g. stopping a server that isn't running)
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  // Point the suite at an already-running server (e.g. a local dev server) and skip build + serve.
  const external = process.env.E2E_BASE_URL
  if (external) {
    provide('baseURL', external)
    return
  }

  if (!existsSync(resolve(repoRoot, 'assets/dist/index.mjs'))) {
    throw new Error('Reprise is not built — run `pnpm build` at the repo root before the E2E tests.')
  }

  if (!process.env.E2E_SKIP_BUILD) {
    // Vitest sets NODE_ENV=test; force production so the bundlers emit a real production build
    // (otherwise Rsbuild leaves `process.env.NODE_ENV` unreplaced and the app throws at runtime).
    execFileSync('pnpm', ['run', `${BUNDLER}:build`], {
      cwd: playgroundDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    })
  }

  // Serve the built app with the Symfony CLI over plain HTTP (no local CA needed in CI).
  runQuiet('symfony', ['server:stop'])
  execFileSync('symfony', ['server:start', '-d', '--no-tls', `--port=${PORT}`], {
    cwd: playgroundDir,
    stdio: 'inherit',
  })

  const baseURL = `http://127.0.0.1:${PORT}`
  const stop = () => runQuiet('symfony', ['server:stop'])
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseURL + '/')
      if (res.status < 500) {
        provide('baseURL', baseURL)
        return stop
      }
    } catch {
      // server still booting
    }
    await sleep(500)
  }

  stop()
  throw new Error(`Symfony server did not answer on ${baseURL} within 30s.`)
}
