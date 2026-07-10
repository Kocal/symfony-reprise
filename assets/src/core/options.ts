import type { Options, ResolvedOptions, ResolvedStimulusOptions } from '../types';
import * as path from 'node:path';

function normalizeStimulus(stimulus: Options['stimulus'], cwd: string): ResolvedStimulusOptions | undefined {
    if (!stimulus) return undefined;
    const raw = typeof stimulus === 'string' ? { controllersJson: stimulus } : stimulus;
    const controllersJson = path.isAbsolute(raw.controllersJson)
        ? raw.controllersJson
        : path.join(cwd, raw.controllersJson);
    const controllersDir = raw.controllersDir
        ? path.isAbsolute(raw.controllersDir)
            ? raw.controllersDir
            : path.join(cwd, raw.controllersDir)
        : path.join(path.dirname(controllersJson), 'controllers');
    return { controllersJson, controllersDir };
}

export function normalizeOptions(options: Options | undefined, cwd: string): ResolvedOptions {
    let outputPath = options?.outputPath ?? 'public/build';
    outputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath);

    const publicPath = options?.publicPath ?? '/build/';

    let manifestKeyPrefix = options?.manifestKeyPrefix ?? null;
    if (manifestKeyPrefix === null) {
        if (publicPath.includes('://')) {
            throw new Error(
                `@symfony/reprise: cannot derive "manifestKeyPrefix" from an absolute "publicPath" (${publicPath}). ` +
                    'Set "manifestKeyPrefix" explicitly (e.g. "build/").'
            );
        }
        manifestKeyPrefix = publicPath.replace(/^\//, '');
    }

    return {
        outputPath,
        publicPath,
        manifestKeyPrefix,
        devServerOrigin: options?.devServerOrigin,
        stimulus: normalizeStimulus(options?.stimulus, cwd),
    };
}

export function resolvePublicPath(publicPath: string, devOrigin: string | null): string {
    if (!devOrigin || publicPath.includes('://')) return publicPath;
    return `${devOrigin.replace(/\/$/, '')}${publicPath}`;
}
