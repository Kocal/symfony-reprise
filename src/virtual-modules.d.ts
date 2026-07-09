declare module 'virtual:symfony/controllers' {
  import type { EagerControllersCollection, LazyControllersCollection } from './types'

  export const eagerControllers: EagerControllersCollection
  export const lazyControllers: LazyControllersCollection
  export const isApplicationDebug: boolean
}
