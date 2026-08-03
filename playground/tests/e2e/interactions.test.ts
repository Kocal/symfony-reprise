import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { expectNoErrors, withPage } from './support'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

describe('interactive demos react to input', () => {
  test.each([
    ['React', 'react'],
    ['Vue', 'vue'],
  ])('UX %s contrast checker recomputes on colour change', async (_name, slug) => {
    await withPage(browser, async ({ page }) => {
      await page.goto(`/demo/${slug}`, { waitUntil: 'load' })
      const colour = page.locator('input[type=color]').first()
      await colour.waitFor({ state: 'visible' })
      // Black on the default white background is exactly 21:1.
      await colour.fill('#000000')
      await page.getByText('21.00:1').waitFor({ timeout: 5_000 })
    })
  })

  test('UX Chart.js paints a canvas', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/demo/chartjs', { waitUntil: 'load' })
      const canvas = page.locator('canvas').first()
      await canvas.waitFor({ state: 'visible', timeout: 5_000 })
      const box = await canvas.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThan(0)
      expectNoErrors(errors)
    })
  })

  test('UX Autocomplete enhances the select with Tom Select', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/demo/autocomplete', { waitUntil: 'load' })
      await page.locator('.ts-control').waitFor({ state: 'visible', timeout: 5_000 })
      expectNoErrors(errors)
    })
  })

  test('UX Translator renders JS messages and reacts to interaction', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/demo/translator', { waitUntil: 'load' })
      // The greeting target starts as "…" and is filled once the JS catalog is loaded.
      await page.waitForFunction(
        () => {
          const text = document.querySelector('[data-translator-target="greeting"]')?.textContent?.trim()
          return !!text && text !== '…'
        },
        undefined,
        { timeout: 5_000 },
      )

      const before = await page.locator('[data-translator-target="apples"]').textContent()
      await page.locator('[data-action="translator#more"]').click()
      await page.waitForFunction(
        (previous) => document.querySelector('[data-translator-target="apples"]')?.textContent !== previous,
        before,
        { timeout: 5_000 },
      )
      expectNoErrors(errors)
    })
  })

  test('UX Live Component re-renders the counter from the server', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/demo/live-component', { waitUntil: 'load' })
      const count = page.getByTestId('counter-value')
      await count.waitFor({ state: 'visible' })
      const before = (await count.textContent())?.trim()

      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/_components/') && res.request().method() === 'POST'),
        page.locator('[data-live-action-param="increment"]').click(),
      ])
      expect(response.status()).toBeLessThan(400)

      await page.waitForFunction(
        (previous) => document.querySelector('[data-testid="counter-value"]')?.textContent?.trim() !== previous,
        before,
        { timeout: 5_000 },
      )
      expectNoErrors(errors)
    })
  })

  test('UX Turbo swaps a frame without a full reload', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/demo/turbo', { waitUntil: 'load' })
      await page.locator('a[data-turbo-frame="detail"]').first().waitFor({ state: 'visible' })

      // Sentinel survives a frame swap but not a full page reload.
      await page.evaluate(() => {
        ;(window as unknown as { __probe: string }).__probe = 'kept'
      })
      await page.locator('a[data-turbo-frame="detail"]').first().click()
      await page.waitForFunction(
        () => {
          const frame = document.querySelector('turbo-frame#detail')
          return !!frame && !frame.textContent?.includes('Pick a bundler')
        },
        undefined,
        { timeout: 5_000 },
      )

      expect(await page.evaluate(() => (window as unknown as { __probe?: string }).__probe)).toBe('kept')
      expectNoErrors(errors)
    })
  })

  test('Code splitting loads the confetti chunk on demand', async () => {
    await withPage(browser, async ({ page, errors }) => {
      // Chunk file names differ per bundler (Vite: confetti-<hash>.js, Rsbuild: async/<n>.js),
      // so assert "a new /build script loads", not the name.
      const buildScripts: string[] = []
      page.on('request', (req) => {
        if (/\/build\/.*\.js(\?|$)/.test(req.url())) buildScripts.push(req.url())
      })

      await page.goto('/feature/code-splitting', { waitUntil: 'load' })
      await page.locator('[data-confetti]').waitFor({ state: 'visible' })
      const before = buildScripts.length

      await page.locator('[data-confetti]').click()

      await expect.poll(() => buildScripts.length, { timeout: 5_000 }).toBeGreaterThan(before)
      await page.waitForFunction(() => document.querySelectorAll('[data-confetti-piece]').length > 0, undefined, {
        timeout: 2_000,
      })
      expectNoErrors(errors)
    })
  })
})
