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

function asset(fileName: string, names: string[], originalFileNames: string[] = []): any {
    return { type: 'asset', fileName, names, originalFileNames, source: '' };
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

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.entryPoints.app).toEqual({
            js: ['app-a1b2.js'],
            css: ['app-c3.css'],
            preload: ['vendor-e5.js'],
            dynamic: ['lazy-x.js'],
        });
        expect(graph.entryPoints.admin).toEqual({ js: ['admin-99.js'], css: [], preload: [], dynamic: [] });
        expect(graph.entryPoints.vendor).toBeUndefined();
    });

    it('collects manifest assets: entry chunks by "<name>.js" and assets by names[0] without a source path', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'app-c3.css': asset('app-c3.css', ['app.css']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'app.js', fileName: 'app-a1b2.js' });
        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
    });

    it('falls back to fileName when an asset has no names', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'noname-x.png': asset('noname-x.png', []),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'noname-x.png', fileName: 'noname-x.png' });
    });

    it('keys imported assets by their source path relative to root (not the basename)', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'krkr-h.webp': asset('krkr-h.webp', ['krkr.webp'], ['/app/assets/images/krkr.webp']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'assets/images/krkr.webp', fileName: 'krkr-h.webp' });
    });

    it('gives same-basename assets from different directories distinct keys', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            'pic-1.png': asset('pic-1.png', ['pic.png'], ['/app/a/pic.png']),
            'pic-2.png': asset('pic-2.png', ['pic.png'], ['/app/b/pic.png']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'a/pic.png', fileName: 'pic-1.png' });
        expect(graph.assets).toContainEqual({ logicalName: 'b/pic.png', fileName: 'pic-2.png' });
    });

    it('keeps entry CSS keyed by name, not by its importing chunk path', () => {
        const bundle = {
            'app-a1b2.js': {
                ...chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
                viteMetadata: { importedCss: new Set(['app-c3.css']), importedAssets: new Set() },
            },
            // Vite/rolldown reports the entry CSS's originalFileNames as the importing JS, which would
            // be a misleading manifest key — the entry-CSS branch must win over the source-path branch.
            'app-c3.css': asset('app-c3.css', ['app.css'], ['/app/assets/app.js']),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'app.css', fileName: 'app-c3.css' });
        expect(graph.assets.some((a) => a.logicalName === 'assets/app.js')).toBe(false);
    });

    it('keeps async (non-entry) chunk CSS keyed by name, not its importing module path', () => {
        const bundle = {
            'app-a1b2.js': chunk({ fileName: 'app-a1b2.js', name: 'app', isEntry: true }),
            // A lazily-imported controller: its chunk is not an entry, but it still pulls in CSS whose
            // originalFileNames points at the importing JS (here inside node_modules).
            'map-x.js': {
                ...chunk({ fileName: 'map-x.js', name: 'map_controller', isEntry: false }),
                viteMetadata: { importedCss: new Set(['map-c.css']), importedAssets: new Set() },
            },
            'map-c.css': asset(
                'map-c.css',
                ['map_controller.css'],
                ['/app/node_modules/@x/ux-map/dist/map_controller.js']
            ),
        } as unknown as Rollup.OutputBundle;

        const graph = bundleToGraph(bundle, '/app');

        expect(graph.assets).toContainEqual({ logicalName: 'map_controller.css', fileName: 'map-c.css' });
        expect(graph.assets.some((a) => a.logicalName.includes('node_modules'))).toBe(false);
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
