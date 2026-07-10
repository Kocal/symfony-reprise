import type { BuildContext, NormalizedGraph } from '../../src/types';
import { describe, expect, it } from 'vitest';
import { buildEntrypoints, buildManifest } from '../../src/core/format';

const ctx: BuildContext = {
    isProd: true,
    devServer: null,
    publicPath: '/build/',
    urlPrefix: '/build/',
    manifestKeyPrefix: 'build/',
};

const graph: NormalizedGraph = {
    entryPoints: {
        app: { js: ['app-a1b2.js'], css: ['app-c3d4.css'], preload: ['vendor-e5f6.js'], dynamic: ['lazy-x.js'] },
        admin: { js: ['admin-99.js'], css: [], preload: [], dynamic: [] },
    },
    assets: [],
};

describe('buildEntrypoints', () => {
    it('prefixes every asset list with publicPath', () => {
        const out = buildEntrypoints(graph, ctx);
        expect(out.entryPoints.app).toEqual({
            js: ['/build/app-a1b2.js'],
            css: ['/build/app-c3d4.css'],
            preload: ['/build/vendor-e5f6.js'],
            dynamic: ['/build/lazy-x.js'],
        });
    });

    it('carries the mode/devServer/publicPath fields', () => {
        const out = buildEntrypoints(graph, ctx);
        expect(out.isProd).toBe(true);
        expect(out.devServer).toBeNull();
        expect(out.publicPath).toBe('/build/');
    });

    it('keeps empty arrays for entries without css/preload/dynamic', () => {
        const out = buildEntrypoints(graph, ctx);
        expect(out.entryPoints.admin).toEqual({ js: ['/build/admin-99.js'], css: [], preload: [], dynamic: [] });
    });

    it('inserts a slash when urlPrefix has no trailing slash', () => {
        const out = buildEntrypoints(graph, { ...ctx, urlPrefix: '/build' });
        expect(out.entryPoints.app.js).toEqual(['/build/app-a1b2.js']);
    });

    it('builds URLs from urlPrefix but emits the original publicPath field', () => {
        const devCtx: BuildContext = {
            isProd: false,
            devServer: { origin: 'http://127.0.0.1:5173', client: 'vite' },
            publicPath: '/build/',
            urlPrefix: 'http://127.0.0.1:5173/build/',
            manifestKeyPrefix: 'build/',
        };
        const out = buildEntrypoints(
            { entryPoints: { app: { js: ['assets/app.js'], css: [], preload: [], dynamic: [] } }, assets: [] },
            devCtx
        );
        expect(out.publicPath).toBe('/build/');
        expect(out.devServer).toEqual({ origin: 'http://127.0.0.1:5173', client: 'vite' });
        expect(out.entryPoints.app.js).toEqual(['http://127.0.0.1:5173/build/assets/app.js']);
    });
});

describe('buildManifest', () => {
    it('maps logical keys (prefixed) to public URLs, sorted', () => {
        const g: NormalizedGraph = {
            entryPoints: {},
            assets: [
                { logicalName: 'app.js', fileName: 'app-a1b2.js' },
                { logicalName: 'app.css', fileName: 'app-c3d4.css' },
                { logicalName: 'images/logo.png', fileName: 'logo-77.png' },
            ],
        };
        expect(buildManifest(g, ctx)).toEqual({
            'build/app.css': '/build/app-c3d4.css',
            'build/app.js': '/build/app-a1b2.js',
            'build/images/logo.png': '/build/logo-77.png',
        });
    });

    it('returns an empty object for no assets', () => {
        expect(buildManifest({ entryPoints: {}, assets: [] }, ctx)).toEqual({});
    });

    it('builds manifest values from urlPrefix, keys from manifestKeyPrefix', () => {
        const g: NormalizedGraph = { entryPoints: {}, assets: [{ logicalName: 'app.js', fileName: 'app-a1b2.js' }] };
        const devCtx: BuildContext = {
            isProd: false,
            devServer: { origin: 'http://127.0.0.1:5173', client: 'vite' },
            publicPath: '/build/',
            urlPrefix: 'http://127.0.0.1:5173/build/',
            manifestKeyPrefix: 'build/',
        };
        expect(buildManifest(g, devCtx)).toEqual({ 'build/app.js': 'http://127.0.0.1:5173/build/app-a1b2.js' });
    });
});
