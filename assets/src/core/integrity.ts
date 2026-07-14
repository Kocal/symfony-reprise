import type { EntryFiles } from '../types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** SRI string for `content`: space-joined `<algo>-<base64 digest>` tokens, one per algorithm. */
export function computeIntegrity(content: string | Uint8Array, algorithms: string[]): string {
    return algorithms.map((algo) => `${algo}-${createHash(algo).update(content).digest('base64')}`).join(' ');
}

/** Distinct file names across every entry's four buckets (first-seen order) — the SRI set. */
export function referencedFileNames(entryPoints: Record<string, EntryFiles>): string[] {
    const seen = new Set<string>();
    for (const files of Object.values(entryPoints)) {
        for (const fileName of [...files.js, ...files.css, ...files.preload, ...files.dynamic]) {
            seen.add(fileName);
        }
    }
    return [...seen];
}

/** Integrity of each file read back from disk (Rspack path; raw bytes, so binary assets work). */
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
