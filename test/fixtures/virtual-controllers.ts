// Test-only stand-in for the `virtual:symfony/controllers` module that the
// unplugin resolver normally provides at build/dev time (see src/core/stimulus.ts).
// Aliased in vitest.config.ts so src/stimulus.ts can be imported under vitest.
export const eagerControllers = {}
export const lazyControllers = {}
export const isApplicationDebug = false
