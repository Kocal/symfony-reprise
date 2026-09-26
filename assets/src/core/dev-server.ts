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

// The spellings Vite and Rsbuild both treat as "every interface".
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000']);

// A browser can't dial a wildcard bind address, so advertise localhost instead.
export function urlHost(host: string): string {
    if (WILDCARD_HOSTS.has(host)) return 'localhost';
    return host.includes(':') ? `[${host}]` : host;
}

export function resolveDevOrigin(address: Pick<AddressInfo, 'address' | 'port'>, input: DevOriginInput): string {
    if (input.override) return trimTrailingSlash(input.override);
    if (input.serverOrigin) return trimTrailingSlash(input.serverOrigin);

    return `${input.https ? 'https' : 'http'}://${urlHost(address.address)}:${address.port}`;
}
