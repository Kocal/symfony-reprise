import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ALL_ROUTES, expectNoErrors, withPage } from './support'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

describe('every page renders without errors', () => {
  test.each(ALL_ROUTES)('%s renders cleanly', async (path) => {
    await withPage(browser, async ({ page, errors }) => {
      const response = await page.goto(path, { waitUntil: 'load' })
      expect(response?.status(), `navigation to ${path}`).toBeLessThan(400)

      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10_000 })
      // Let deferred JS (Stimulus connect, lazy controllers, component mount) run so it can surface late errors.
      await page.waitForTimeout(800)

      expectNoErrors(errors)
    })
  })
})
