import type { Rollup } from 'vite';
import type { AssetEntry, EntryFiles, NormalizedGraph } from '../types';
import { extname, relative, resolve } from 'node:path';

interface ViteChunkMetadata {
    importedCss: Set<string>;
}
type ViteOutputChunk = Rollup.OutputChunk & { viteMetadata?: ViteChunkMetadata };

export function bundleToGraph(bundle: Rollup.OutputBundle, root: string): NormalizedGraph {
    const entryPoints: Record<string, EntryFiles> = {};
    const assets: AssetEntry[] = [];
    // Entry CSS stays in the manifest, keyed by its logical name (e.g. `app.css`, matching Rsbuild's
    // chunk-name keying). Async (non-entry) chunk CSS does not: it loads at runtime with its lazily
    // imported chunk, never via `asset()`, so a manifest entry would only be a byproduct that diverges
    // from Rsbuild and collides when two chunks share a name. Both kinds report `originalFileNames` as
    // the importing JS, so neither must reach the source-path branch (that is for imported images/fonts).
    const entryCss = new Set<string>();
    const asyncCss = new Set<string>();

    for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const chunk = file as ViteOutputChunk;
        const css = chunk.viteMetadata ? [...chunk.viteMetadata.importedCss] : [];
        if (chunk.isEntry) {
            for (const name of css) entryCss.add(name);
            entryPoints[chunk.name] = {
                js: [chunk.fileName],
                css,
                preload: [...chunk.imports],
                dynamic: [...chunk.dynamicImports],
            };
            assets.push({ logicalName: `${chunk.name}.js`, fileName: chunk.fileName });
        } else {
            for (const name of css) asyncCss.add(name);
        }
    }

    for (const file of Object.values(bundle)) {
        if (file.type !== 'asset') continue;
        // Drop async-only chunk CSS (see above); entry CSS (also referenced by an entry) is kept.
        if (asyncCss.has(file.fileName) && !entryCss.has(file.fileName)) continue;
        assets.push({ logicalName: assetLogicalName(file, root, entryCss), fileName: file.fileName });
    }

    return { entryPoints, assets };
}

function assetLogicalName(file: Rollup.OutputAsset, root: string, entryCss: Set<string>): string {
    // Imported assets (images, fonts) get their source path relative to the project root, so the
    // manifest key matches Rsbuild's `sourceFilename` and same-basename files in different folders
    // stay distinct. Entry CSS and assets with no source path fall back to the basename.
    const original = entryCss.has(file.fileName) ? undefined : file.originalFileNames[0];
    if (original) return slash(relative(root, resolve(root, original)));
    return file.names[0] ?? file.fileName;
}

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus', '.postcss', '.pcss']);

export interface DevConfig {
    root: string;
    build: {
        rollupOptions?: { input?: Rollup.InputOption };
        rolldownOptions?: { input?: Rollup.InputOption };
    };
}

function slash(p: string): string {
    return p.replace(/\\/g, '/');
}

export function configToDevGraph(config: DevConfig): NormalizedGraph {
    const entryPoints: Record<string, EntryFiles> = {};
    // Vite 8 (rolldown) exposes the input under either key.
    const input = config.build.rollupOptions?.input ?? config.build.rolldownOptions?.input;
    const entries: Record<string, string> =
        typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, string>) : {};

    for (const [name, inputPath] of Object.entries(entries)) {
        const rel = slash(relative(config.root, resolve(config.root, inputPath)));
        const type: 'js' | 'css' = CSS_EXTS.has(extname(inputPath)) ? 'css' : 'js';
        const files: EntryFiles = { js: [], css: [], preload: [], dynamic: [] };
        files[type] = [rel];
        entryPoints[name] = files;
    }

    return { entryPoints, assets: [] };
}
