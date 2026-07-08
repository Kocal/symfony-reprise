// @vitest-environment jsdom
import { Application, Controller } from '@hotwired/stimulus'
import { describe, expect, it, vi } from 'vitest'
import { loadControllers } from '../src/stimulus'

class Eager extends Controller {}
class Lazy extends Controller {}

describe('loadControllers', () => {
  it('registers eager controllers immediately', () => {
    const app = Application.start()
    const spy = vi.spyOn(app, 'register')
    loadControllers(app, { greet: Eager }, {})
    expect(spy).toHaveBeenCalledWith('greet', Eager)
    app.stop()
  })

  it('loads a lazy controller only when a matching element exists', async () => {
    document.body.innerHTML = `<div data-controller="heavy"></div>`
    const app = Application.start()
    const spy = vi.spyOn(app, 'register')
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { heavy: loader })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('heavy', Lazy))
    app.stop()
  })

  it('does not load a lazy controller that is absent from the DOM', () => {
    document.body.innerHTML = `<div></div>`
    const app = Application.start()
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { absent: loader })
    expect(loader).not.toHaveBeenCalled()
    app.stop()
  })
})
