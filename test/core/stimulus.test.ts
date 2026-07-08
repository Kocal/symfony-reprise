import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateControllersModule } from '../../src/core/stimulus'

const root = join(import.meta.dirname, '../fixtures/stimulus')
const opts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'does-not-exist') }

describe('generateControllersModule — third-party', () => {
  it('emits an eager third-party controller with a static import and autoimport', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).toContain(`import controller_0 from "@acme/ux-hello/dist/hello_controller.js"`)
    expect(src).toContain(`import "@acme/ux-hello/dist/hello.css"`)
    expect(src).toContain(`"acme--ux-hello--hello": controller_0`)
  })

  it('emits a lazy third-party controller as a dynamic import factory', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).toContain(`"acme--ux-map--map": () => import("@acme/ux-map/dist/map_controller.js")`)
  })

  it('skips disabled controllers', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).not.toContain('mini-map')
  })

  it('sets isApplicationDebug from the isDev flag', () => {
    expect(generateControllersModule(opts, root, true)).toContain('export const isApplicationDebug = true')
    expect(generateControllersModule(opts, root, false)).toContain('export const isApplicationDebug = false')
  })

  it('throws a helpful error when a declared package is not installed', () => {
    const bad = { controllersJson: join(root, 'controllers.json'), controllersDir: opts.controllersDir }
    expect(() => generateControllersModule(bad, '/nonexistent-root', false)).toThrow(/npm install|could not/i)
  })
})
