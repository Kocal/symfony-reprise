import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { bundleToGraph, configToDevGraph } from '../../src/collectors/vite';

function chunk(partial: Partial<Rollup.OutputChunk> & { fileName: string; name: string; isEntry: boolean }): any {
    return {
        type: 'chunk',
        imports: [],
        dynamicImports: [],
        ...partial,
    };
}

function asset(fileName: string, names: string[]): any {
    return { type: 'asset', fileName, names, originalFileNames: [], source: '' };
}

describe('bundleToGraph', () => {
    it('extracts entry js, css, preload and dynamic from entry chunks', () => {
        const bundle = {
            'app-a1b2.js': {
                ...chunk({
                    fileName: 'app-a1b2.js',
                    name: 'app',
                    isEntry: true,
                    imports: ['vendor-e5.js'],
                    dynamicImports: ['lazy-x.js'],
                }),
                viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
            },
            'admin-99.js': chunk({ fileName: 'admin-99.js', name: 'admin', isEntry: true }),
            'vendor-e5.js': chunk({ fileName: 'vendor-e5.js', name: 'vendor', isEntry: false }),
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle);

        expect(graph.entryPoints.app).toEqual({
            js: ['app-a1b2.js'],
            css: ['app-c3.css'],
            preload: ['vendor-e5.js'],
            dynamic: ['lazy-x.js'],
        });
        expect(graph.entryPoints.admin).toEqual({ js: ['admin-99.js'], css: [], preload: [], dynamic: [] });
        expect(graph.entryPoints.vendor).toBeUndefined();
    });

    it('collects manifest assets: entry chunks by "<name>.js" and assets by names[0]', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle);

        expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app-a1b2.js' });
        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
    });

    it('falls back to fileName when an asset has no names', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'noname-x.png': asset('noname-x.png', []),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle);

        expect(graph.assets).toContainEqual({ logicalName: 'noname-x.png', fileName: 'noname-x.png' });
    });
});

describe('configToDevGraph', () => {
    const config = {
        root: '/app',
        build: { rollupOptions: { input: { app: '/app/assets/app.js', theme: '/app/assets/theme.scss' } } },
    };

    it('maps object inputs to bare relative entry files, typed by extension', () => {
        const graph = configToDevGraph(config as any);
        expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] });
        expect(graph.entryPoints.theme).toEqual({ js: [], css: ['assets/theme.scss'], preload: [], dynamic: [] });
        expect(graph.assets).toEqual([]);
    });

    it('ignores array/undefined inputs (named entries only)', () => {
        expect(
            configToDevGraph({ root: '/app', build: { rollupOptions: { input: ['/app/a.js'] } } } as any).entryPoints
        ).toEqual({});
        expect(configToDevGraph({ root: '/app', build: { rollupOptions: {} } } as any).entryPoints).toEqual({});
    });

    it('reads rolldownOptions.input when rollupOptions is absent (Vite 8)', () => {
        const graph = configToDevGraph({
            root: '/app',
            build: { rolldownOptions: { input: { app: '/app/assets/app.js' } } },
        } as any);
        expect(graph.entryPoints.app).toEqual({ js: ['assets/app.js'], css: [], preload: [], dynamic: [] });
    });
});
