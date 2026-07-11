import type { ResolvedCopyEntry } from '../types';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { joinUrl } from './format';

export interface CopyResult {
    /** Path used for the manifest key, e.g. `images/icons/cat.svg`. */
    logicalName: string;
    /** Path written under outputPath, hashed in build, verbatim in dev. */
    physicalName: string;
    source: Buffer;
}

function walk(dir: string, includeSubdirectories: boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (includeSubdirectories) out.push(...walk(abs, includeSubdirectories));
        } else {
            out.push(abs);
        }
    }
    return out;
}

export function enumerateCopyFiles(entries: ResolvedCopyEntry[]): Array<{ absPath: string; logicalName: string }> {
    const out: Array<{ absPath: string; logicalName: string }> = [];
    for (const entry of entries) {
        let files: string[];
        try {
            files = walk(entry.from, entry.includeSubdirectories);
        } catch {
            console.warn(`[@symfony/reprise] copy: source directory "${entry.from}" not found, skipping`);
            continue;
        }
        for (const absPath of files) {
            const rel = relative(entry.from, absPath).split(sep).join('/');
            if (!entry.pattern.test(rel)) continue;
            out.push({ absPath, logicalName: `${entry.to}/${rel}` });
        }
    }
    return out;
}

export function contentHash(source: Buffer): string {
    return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

export function hashedName(logicalName: string, hash: string): string {
    const ext = extname(logicalName);
    const base = ext ? logicalName.slice(0, -ext.length) : logicalName;
    return `${base}.${hash}${ext}`;
}

export function resolveCopyFiles(entries: ResolvedCopyEntry[], hashed: boolean): CopyResult[] {
    return enumerateCopyFiles(entries).map(({ absPath, logicalName }) => {
        const source = readFileSync(absPath);
        const physicalName = hashed ? hashedName(logicalName, contentHash(source)) : logicalName;
        return { logicalName, physicalName, source };
    });
}

export function copyManifest(
    files: CopyResult[],
    opts: { publicPath: string; manifestKeyPrefix: string }
): Record<string, string> {
    const manifest: Record<string, string> = {};
    for (const file of files) {
        manifest[opts.manifestKeyPrefix + file.logicalName] = joinUrl(opts.publicPath, file.physicalName);
    }
    return manifest;
}

export function writeCopyFiles(files: CopyResult[], outputPath: string): void {
    for (const file of files) {
        const dest = join(outputPath, file.physicalName);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.source);
    }
}
