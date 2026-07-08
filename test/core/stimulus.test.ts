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

describe('generateControllersModule — local', () => {
  const localOpts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'controllers') }

  it('emits an eager local controller by absolute path', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toContain(join(root, 'controllers/greet_controller.js'))
    expect(src).toMatch(/"greet": controller_\d+/)
  })

  it('emits a lazy local controller when the stimulusFetch comment is present', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toContain(`"heavy": () => import(`)
    expect(src).toContain(join(root, 'controllers/heavy_controller.js'))
  })

  it('maps nested controllers with a double-dash identifier', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toMatch(/"admin--user": controller_\d+/)
  })

  it('returns valid empty maps when there are no controllers at all', () => {
    const empty = { controllersJson: join(root, 'empty-controllers.json'), controllersDir: join(root, 'nope') }
    const src = generateControllersModule(empty, root, false)
    expect(src).toContain('export const eagerControllers = {}')
    expect(src).toContain('export const lazyControllers = {}')
  })
})
