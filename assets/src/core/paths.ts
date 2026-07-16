/** Normalize Windows backslash separators to forward slashes (portable URLs and ESM specifiers). */
export function slash(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Drop a single trailing slash, e.g. when composing a dev-server origin with a public path. */
export function trimTrailingSlash(s: string): string {
    return s.replace(/\/$/, '');
}
