import { eagerControllers, lazyControllers } from 'virtual:symfony/controllers'
globalThis.__controllers = { eager: Object.keys(eagerControllers), lazy: Object.keys(lazyControllers) }
