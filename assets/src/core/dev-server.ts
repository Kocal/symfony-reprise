import type { AddressInfo } from 'node:net';
import { trimTrailingSlash } from './paths';

export interface DevOriginInput {
    /** Explicit override — our `devServerOrigin` option (mirrors Encore's `--public`). */
    override?: string;
    /** Vite's own `server.origin` option. */
    serverOrigin?: string;
    /** Whether the dev server is serving over HTTPS. */
    https?: boolean;
}

export function resolveDevOrigin(address: AddressInfo, input: DevOriginInput): string {
    if (input.override) return trimTrailingSlash(input.override);
    if (input.serverOrigin) return trimTrailingSlash(input.serverOrigin);

    const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    return `${input.https ? 'https' : 'http'}://${host}:${address.port}`;
}
