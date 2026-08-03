import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright'
import { expect, inject } from 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    baseURL: string
  }
}

// With E2E_ARTIFACTS set, every context records a video; a failing test also dumps a screenshot and its
// full console transcript into tests/e2e/artifacts/ (kept only for failures). CI uploads that directory.
const ARTIFACTS = !!process.env.E2E_ARTIFACTS
const ARTIFACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'artifacts')

let seq = 0
function artifactName(): string {
  const name = expect.getState().currentTestName ?? ''
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || `test-${++seq}`
}

// Every routable page in the playground (mirrors src/Demo/DemoCatalog.php).
export const ALL_ROUTES: string[] = [
  '/',
  '/admin',
  '/feature/code-splitting',
  '/feature/scss-typescript',
  '/feature/copied-files',
  '/feature/build-contract',
  '/demo/react',
  '/demo/vue',
  '/demo/chartjs',
  '/demo/autocomplete',
  '/demo/dropzone',
  '/demo/cropperjs',
  '/demo/map',
  '/demo/icons',
  '/demo/translator',
  '/demo/live-component',
  '/demo/turbo',
]

export interface PageErrors {
  console: string[]
  pageErrors: string[]
  http: string[]
}

export interface PageProbe {
  context: BrowserContext
  page: Page
  errors: PageErrors
  log: string[]
}

async function openPage(browser: Browser): Promise<PageProbe> {
  const base = inject('baseURL')
  const origin = new URL(base).origin
  const context = await browser.newContext({
    baseURL: base,
    ignoreHTTPSErrors: true,
    ...(ARTIFACTS ? { recordVideo: { dir: ARTIFACT_DIR } } : {}),
  })
  const page = await context.newPage()
  const errors: PageErrors = { console: [], pageErrors: [], http: [] }
  const log: string[] = []

  page.on('console', (msg) => {
    log.push(`[console:${msg.type()}] ${msg.text()}`)
    if (msg.type() === 'error') errors.console.push(msg.text())
  })
  page.on('pageerror', (err) => {
    log.push(`[pageerror] ${err.message}`)
    errors.pageErrors.push(err.message)
  })
  page.on('response', (res) => {
    const url = new URL(res.url())
    // Only the app's own responses matter: skip third-party assets (map tiles, fonts), the favicon,
    // and Symfony's reserved `/_*` routes (dev toolbar, profiler, fragments, live components).
    if (url.origin !== origin) return
    if (url.pathname === '/favicon.ico') return
    if (url.pathname.startsWith('/_')) return
    if (res.status() >= 400) {
      log.push(`[response:${res.status()}] ${url.pathname}`)
      errors.http.push(`${res.status()} ${url.pathname}`)
    }
  })

  return { context, page, errors, log }
}

export async function withPage(browser: Browser, fn: (probe: PageProbe) => Promise<void>): Promise<void> {
  const probe = await openPage(browser)
  const label = artifactName()
  let failed = false
  try {
    await fn(probe)
  } catch (error) {
    failed = true
    if (ARTIFACTS) {
      await mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {})
      await probe.page.screenshot({ path: join(ARTIFACT_DIR, `${label}.png`), fullPage: true }).catch(() => {})
      await writeFile(join(ARTIFACT_DIR, `${label}.log`), probe.log.join('\n'), 'utf8').catch(() => {})
    }
    throw error
  } finally {
    const video = probe.page.video()
    await probe.context.close()
    if (video) {
      if (failed) await video.saveAs(join(ARTIFACT_DIR, `${label}.webm`)).catch(() => {})
      await video.delete().catch(() => {})
    }
  }
}

export function expectNoErrors(errors: PageErrors): void {
  expect(errors.pageErrors, 'uncaught JS exceptions').toEqual([])
  expect(errors.console, 'console.error output').toEqual([])
  expect(errors.http, 'same-origin HTTP >= 400 responses').toEqual([])
}
