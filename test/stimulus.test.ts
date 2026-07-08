// @vitest-environment jsdom
import type { Application as StimulusApplication } from '@hotwired/stimulus'
import { Application, Controller } from '@hotwired/stimulus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadControllers } from '../src/stimulus'

class Eager extends Controller {}
class Lazy extends Controller {}

describe('loadControllers', () => {
  let app: StimulusApplication | undefined

  afterEach(async () => {
    // Stop the app and clear the DOM, then let Stimulus's async stop and any queued
    // MutationObserver callbacks flush while the jsdom environment is still alive.
    // Otherwise a late `processRemovedNodes` callback fires during environment teardown,
    // when the `Node` global is already gone, printing a stray `ReferenceError`.
    app?.stop()
    app = undefined
    document.body.innerHTML = ''
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('registers eager controllers immediately', () => {
    app = Application.start()
    const spy = vi.spyOn(app, 'register')
    loadControllers(app, { greet: Eager }, {})
    expect(spy).toHaveBeenCalledWith('greet', Eager)
  })

  it('loads a lazy controller only when a matching element exists', async () => {
    document.body.innerHTML = `<div data-controller="heavy"></div>`
    app = Application.start()
    const spy = vi.spyOn(app, 'register')
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { heavy: loader })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('heavy', Lazy))
  })

  it('does not load a lazy controller that is absent from the DOM', () => {
    document.body.innerHTML = `<div></div>`
    app = Application.start()
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { absent: loader })
    expect(loader).not.toHaveBeenCalled()
  })
})
