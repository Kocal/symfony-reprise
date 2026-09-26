import type { AssetEntry, BuildContext, EntryFiles, EntrypointsJson, ManifestJson, NormalizedGraph } from '../types';

function toReference(prefix: string, name: string): string {
    // Docroot-relative reference (ADR 0001): strips the leading slash (dev-server URLs have none).
    return (prefix + name).replace(/^\//, '');
}

export function buildEntrypoints(graph: NormalizedGraph, ctx: BuildContext): EntrypointsJson {
    const entryPoints: Record<string, EntryFiles> = {};
    for (const [name, files] of Object.entries(graph.entryPoints)) {
        entryPoints[name] = {
            js: files.js.map((f) => toReference(ctx.urlPrefix, f)),
            css: files.css.map((f) => toReference(ctx.urlPrefix, f)),
            preload: files.preload.map((f) => toReference(ctx.urlPrefix, f)),
            dynamic: files.dynamic.map((f) => toReference(ctx.urlPrefix, f)),
        };
    }
    const out: EntrypointsJson = {
        isProd: ctx.isProd,
        devServer: ctx.devServer,
        publicPath: ctx.publicPath,
        entryPoints,
    };
    if (graph.integrity) {
        // Re-key hashes by the same references used in the entry lists, for lookup by reference.
        out.integrity = Object.fromEntries(
            Object.entries(graph.integrity).map(([fileName, sri]) => [toReference(ctx.urlPrefix, fileName), sri])
        );
    }
    return out;
}

export function buildManifest(
    assets: AssetEntry[],
    ctx: Pick<BuildContext, 'publicPath' | 'manifestKeyPrefix'>
): ManifestJson {
    const manifest: ManifestJson = {};
    for (const { logicalName, fileName } of assets) {
        manifest[ctx.manifestKeyPrefix + logicalName] = ctx.publicPath + fileName;
    }
    return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
