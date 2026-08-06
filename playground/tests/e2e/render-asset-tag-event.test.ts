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

describe('RenderAssetTagEvent lets a listener stamp attributes on the rendered tags', () => {
  test('every app <script>/<link> on the home page carries data-rendered-by="reprise"', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/', { waitUntil: 'load' })

      const stamped = await page.evaluate(() => {
        const tags = document.querySelectorAll(
          'head script[src*="/build/"], head link[rel="stylesheet"][href*="/build/"]',
        )
        return Array.from(tags, (el) => el.getAttribute('data-rendered-by'))
      })

      expect(stamped.length, 'app script/link tags found').toBeGreaterThan(0)
      for (const value of stamped) {
        expect(value, 'each tag carries data-rendered-by').toBe('reprise')
      }

      expectNoErrors(errors)
    })
  })
})
