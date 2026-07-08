import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { resolveDevOrigin } from '../../src/core/dev-server'

function addr(over: Partial<AddressInfo> = {}): AddressInfo {
  return { address: '127.0.0.1', family: 'IPv4', port: 5173, ...over }
}

describe('resolveDevOrigin', () => {
  it('prefers the explicit override (and trims a trailing slash)', () => {
    expect(resolveDevOrigin(addr(), { override: 'https://assets.test/' })).toBe('https://assets.test')
  })
  it('prefers Vite server.origin when no override', () => {
    expect(resolveDevOrigin(addr(), { serverOrigin: 'http://sf.test:5173' })).toBe('http://sf.test:5173')
  })
  it('assembles http://host:port from the address', () => {
    expect(resolveDevOrigin(addr({ port: 5199 }), {})).toBe('http://127.0.0.1:5199')
  })
  it('uses https when the dev server is https', () => {
    expect(resolveDevOrigin(addr(), { https: true })).toBe('https://127.0.0.1:5173')
  })
  it('brackets an IPv6 address', () => {
    expect(resolveDevOrigin(addr({ address: '::1', family: 'IPv6' }), {})).toBe('http://[::1]:5173')
  })
  it('trims a trailing slash on serverOrigin too', () => {
    expect(resolveDevOrigin(addr(), { serverOrigin: 'http://sf.test:5173/' })).toBe('http://sf.test:5173')
  })
  it('override wins even when serverOrigin is also set', () => {
    expect(resolveDevOrigin(addr(), { override: 'https://assets.test', serverOrigin: 'http://sf.test:5173' })).toBe('https://assets.test')
  })
})
