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
    // Entry CSS is kept in the manifest (keyed by logical name like `app.css`); async chunk CSS isn't
    // (it loads with its chunk, never via `asset()`, and would collide across same-named chunks).
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
    // Imported assets key by source path relative to root (matches Rsbuild's `sourceFilename`, keeps
    // same-basename files distinct); entry CSS and path-less assets fall back to the basename.
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
