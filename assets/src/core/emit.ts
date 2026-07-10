import type { EntrypointsJson, ManifestJson } from '../types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeSymfonyFiles(outputPath: string, entrypoints: EntrypointsJson, manifest: ManifestJson): void {
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, 'entrypoints.json'), `${JSON.stringify(entrypoints, null, 2)}\n`);
    writeFileSync(join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
