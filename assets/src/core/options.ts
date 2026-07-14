import type { CopyEntry, Options, ResolvedCopyEntry, ResolvedOptions, ResolvedStimulusOptions } from '../types';
import * as path from 'node:path';

/**
 * Whether `publicPath` points off the docroot: an absolute URL (`https://cdn/…`) or a
 * protocol-relative one (`//cdn/…`). Both need an explicit `manifestKeyPrefix` and must never
 * get the dev-server origin prepended.
 */
export function isAbsolutePublicPath(publicPath: string): boolean {
    return publicPath.includes('://') || publicPath.startsWith('//');
}

function normalizeIntegrity(integrity: Options['integrity']): ResolvedOptions['integrity'] {
    if (!integrity?.enabled) return undefined;
    return { algorithms: integrity.algorithms?.length ? [...integrity.algorithms] : ['sha384'] };
}

function normalizeCopyTo(to: string): string {
    // Drop leading `./`|`/` and trailing `/`: they corrupt the manifest key and make Rollup reject
    // a relative-looking emitted fileName.
    const normalized = path.posix.normalize(to.replace(/\\/g, '/'));
    return normalized
        .replace(/^\.?\/+/, '')
        .replace(/^\.$/, '')
        .replace(/\/+$/, '');
}

function normalizeCopy(copy: CopyEntry[] | undefined, cwd: string): ResolvedCopyEntry[] {
    if (!copy) return [];
    return copy.map((entry) => ({
        from: path.isAbsolute(entry.from) ? entry.from : path.join(cwd, entry.from),
        to: normalizeCopyTo(entry.to),
        pattern: entry.pattern ?? /.*/,
        includeSubdirectories: entry.includeSubdirectories ?? true,
    }));
}

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
        if (isAbsolutePublicPath(publicPath)) {
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
        integrity: normalizeIntegrity(options?.integrity),
        copy: normalizeCopy(options?.copy, cwd),
    };
}

export function resolvePublicPath(publicPath: string, devOrigin: string | null): string {
    if (!devOrigin || isAbsolutePublicPath(publicPath)) return publicPath;
    return `${devOrigin.replace(/\/$/, '')}${publicPath}`;
}
