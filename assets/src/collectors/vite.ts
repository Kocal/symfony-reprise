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
    // File names of the CSS emitted for any chunk (entry or lazily-imported). It stays keyed by its
    // logical name (e.g. `app.css`, `map_controller.css`), matching Rsbuild's chunk-name keying;
    // Vite reports its `originalFileNames` as the importing JS module, so the source-path branch
    // below (for imported images/fonts) must not apply to it.
    const chunkCss = new Set<string>();

    for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const chunk = file as ViteOutputChunk;
        const css = chunk.viteMetadata ? [...chunk.viteMetadata.importedCss] : [];
        for (const name of css) chunkCss.add(name);
        if (!chunk.isEntry) continue;
        entryPoints[chunk.name] = {
            js: [chunk.fileName],
            css,
            preload: [...chunk.imports],
            dynamic: [...chunk.dynamicImports],
        };
        assets.push({ logicalName: `${chunk.name}.js`, fileName: chunk.fileName });
    }

    for (const file of Object.values(bundle)) {
        if (file.type !== 'asset') continue;
        assets.push({ logicalName: assetLogicalName(file, root, chunkCss), fileName: file.fileName });
    }

    return { entryPoints, assets };
}

function assetLogicalName(file: Rollup.OutputAsset, root: string, chunkCss: Set<string>): string {
    // Imported assets (images, fonts) get their source path relative to the project root, so the
    // manifest key matches Rsbuild's `sourceFilename` and same-basename files in different folders
    // stay distinct. Chunk CSS and assets with no source path fall back to the basename.
    const original = chunkCss.has(file.fileName) ? undefined : file.originalFileNames[0];
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
