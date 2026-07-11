import type { EntryFiles } from '../types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build a Subresource Integrity string for `content`: one `<algorithm>-<base64 digest>`
 * token per algorithm, joined by spaces (the format browsers expect in an `integrity`
 * attribute, and the one Webpack Encore writes into `entrypoints.json`).
 */
export function computeIntegrity(content: string | Uint8Array, algorithms: string[]): string {
    return algorithms.map((algo) => `${algo}-${createHash(algo).update(content).digest('base64')}`).join(' ');
}

/**
 * The distinct file names referenced by every entry, across all four buckets
 * (js/css/preload/dynamic), in first-seen order. This is the set of emitted files
 * that get an integrity hash.
 */
export function referencedFileNames(entryPoints: Record<string, EntryFiles>): string[] {
    const seen = new Set<string>();
    for (const files of Object.values(entryPoints)) {
        for (const fileName of [...files.js, ...files.css, ...files.preload, ...files.dynamic]) {
            seen.add(fileName);
        }
    }
    return [...seen];
}

/**
 * Compute the integrity of each file read from `outputPath` on disk, keyed by file name.
 * Used by the Rspack path, whose `done` hook fires after the assets are emitted (like
 * Encore, which reads the emitted files back). Bytes are hashed raw, so binary assets work.
 */
export function integrityFromDisk(
    fileNames: string[],
    outputPath: string,
    algorithms: string[]
): Record<string, string> {
    const integrity: Record<string, string> = {};
    for (const fileName of fileNames) {
        integrity[fileName] = computeIntegrity(readFileSync(join(outputPath, fileName)), algorithms);
    }
    return integrity;
}
