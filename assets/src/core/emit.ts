import type { EntrypointsJson, ManifestJson } from '../types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeSymfonyFiles(metadataPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void {
    mkdirSync(metadataPath, { recursive: true });
    writeFileSync(join(metadataPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`);
    writeFileSync(join(metadataPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
