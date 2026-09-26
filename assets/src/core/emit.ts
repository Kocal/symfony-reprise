import type { EntrypointsJson, ManifestJson } from '../types';
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// RepriseBundle can read these files mid-rebuild, so it must never see a truncated one.
function writeFileAtomic(path: string, content: string): void {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, content);
    try {
        renameSync(tmp, path);
    } catch {
        // Windows refuses to rename over a file another process holds open.
        rmSync(tmp, { force: true });
        writeFileSync(path, content);
    }
}

export function writeSymfonyFiles(metadataPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void {
    mkdirSync(metadataPath, { recursive: true });
    writeFileAtomic(join(metadataPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`);
    writeFileAtomic(join(metadataPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
