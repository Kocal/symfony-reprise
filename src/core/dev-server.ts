import type { AddressInfo } from 'node:net'

export interface DevOriginInput {
  /** Explicit override — our `devServerOrigin` option (mirrors Encore's `--public`). */
  override?: string
  /** Vite's own `server.origin` option. */
  serverOrigin?: string
  /** Whether the dev server is serving over HTTPS. */
  https?: boolean
}

export function resolveDevOrigin(address: AddressInfo, input: DevOriginInput): string {
  if (input.override)
    return input.override.replace(/\/$/, '')
  if (input.serverOrigin)
    return input.serverOrigin.replace(/\/$/, '')

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return `${input.https ? 'https' : 'http'}://${host}:${address.port}`
}
