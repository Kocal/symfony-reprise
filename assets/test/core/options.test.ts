import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeOptions, resolvePublicPath } from '../../src/core/options';

describe('normalizeOptions', () => {
    it('resolves a relative outputPath against cwd', () => {
        const r = normalizeOptions({ outputPath: 'public/build' }, '/app');
        // outputPath is a filesystem path -> native separators (backslashes on Windows).
        expect(r.outputPath).toBe(join('/app', 'public/build'));
    });

    it('keeps an absolute outputPath as-is', () => {
        const r = normalizeOptions({ outputPath: '/tmp/out' }, '/app');
        expect(r.outputPath).toBe('/tmp/out');
    });

    it('applies defaults (outputPath, publicPath)', () => {
        const r = normalizeOptions(undefined, '/app');
        expect(r.outputPath).toBe(join('/app', 'public/build'));
        expect(r.publicPath).toBe('/build/');
    });

    it('derives manifestKeyPrefix from publicPath by stripping the leading slash', () => {
        const r = normalizeOptions({ publicPath: '/build/' }, '/app');
        expect(r.manifestKeyPrefix).toBe('build/');
    });

    it('honors an explicit manifestKeyPrefix', () => {
        const r = normalizeOptions({ publicPath: '/assets/', manifestKeyPrefix: 'build/' }, '/app');
        expect(r.manifestKeyPrefix).toBe('build/');
    });

    it('honors an explicit empty manifestKeyPrefix', () => {
        const r = normalizeOptions({ publicPath: '/build/', manifestKeyPrefix: '' }, '/app');
        expect(r.manifestKeyPrefix).toBe('');
    });

    it('throws for an absolute publicPath without manifestKeyPrefix', () => {
        expect(() => normalizeOptions({ publicPath: 'https://cdn.example.com/x' }, '/app')).toThrow(
            /manifestKeyPrefix/
        );
    });

    it('accepts an absolute publicPath when manifestKeyPrefix is set', () => {
        const r = normalizeOptions({ publicPath: 'https://cdn.example.com/x', manifestKeyPrefix: 'build/' }, '/app');
        expect(r.publicPath).toBe('https://cdn.example.com/x');
        expect(r.manifestKeyPrefix).toBe('build/');
    });

    it('throws for a protocol-relative publicPath without manifestKeyPrefix', () => {
        expect(() => normalizeOptions({ publicPath: '//cdn.example.com/x' }, '/app')).toThrow(/manifestKeyPrefix/);
    });

    it('accepts a protocol-relative publicPath when manifestKeyPrefix is set', () => {
        const r = normalizeOptions({ publicPath: '//cdn.example.com/x', manifestKeyPrefix: 'build/' }, '/app');
        expect(r.publicPath).toBe('//cdn.example.com/x');
        expect(r.manifestKeyPrefix).toBe('build/');
    });

    it('leaves stimulus undefined when not configured', () => {
        const r = normalizeOptions(undefined, '/app');
        expect(r.stimulus).toBeUndefined();
    });

    it('resolves the string shorthand to abs controllersJson + sibling controllers dir', () => {
        const r = normalizeOptions({ stimulus: 'assets/controllers.json' }, '/app');
        expect(r.stimulus).toEqual({
            controllersJson: join('/app', 'assets/controllers.json'),
            controllersDir: join('/app', 'assets/controllers'),
        });
    });

    it('resolves the object form and honors an explicit controllersDir', () => {
        const r = normalizeOptions(
            { stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/stimulus' } },
            '/app'
        );
        expect(r.stimulus).toEqual({
            controllersJson: join('/app', 'assets/controllers.json'),
            controllersDir: join('/app', 'assets/stimulus'),
        });
    });

    it('leaves integrity undefined when not configured', () => {
        expect(normalizeOptions(undefined, '/app').integrity).toBeUndefined();
    });

    it('leaves integrity undefined when explicitly disabled', () => {
        expect(normalizeOptions({ integrity: { enabled: false } }, '/app').integrity).toBeUndefined();
    });

    it('defaults enabled integrity to the sha384 algorithm', () => {
        expect(normalizeOptions({ integrity: { enabled: true } }, '/app').integrity).toEqual({
            algorithms: ['sha384'],
        });
    });

    it('honors explicit algorithms', () => {
        expect(
            normalizeOptions({ integrity: { enabled: true, algorithms: ['sha256', 'sha512'] } }, '/app').integrity
        ).toEqual({ algorithms: ['sha256', 'sha512'] });
    });

    it('falls back to sha384 when enabled with an empty algorithm list', () => {
        expect(normalizeOptions({ integrity: { enabled: true, algorithms: [] } }, '/app').integrity).toEqual({
            algorithms: ['sha384'],
        });
    });

    it('defaults copy to an empty array', () => {
        const r = normalizeOptions(undefined, '/app');
        expect(r.copy).toEqual([]);
    });

    it('resolves a relative copy `from` against cwd and applies defaults', () => {
        const r = normalizeOptions({ copy: [{ from: 'assets/images', to: 'images' }] }, '/app');
        expect(r.copy).toEqual([
            { from: join('/app', 'assets/images'), to: 'images', pattern: /.*/, includeSubdirectories: true },
        ]);
    });

    it('keeps an absolute copy `from`, strips slashes from `to`, honors pattern/includeSubdirectories', () => {
        const r = normalizeOptions(
            { copy: [{ from: '/src/img', to: '/images/', pattern: /\.svg$/, includeSubdirectories: false }] },
            '/app'
        );
        expect(r.copy[0].from).toBe('/src/img');
        expect(r.copy[0].to).toBe('images');
        expect(r.copy[0].pattern).toEqual(/\.svg$/);
        expect(r.copy[0].includeSubdirectories).toBe(false);
    });

    it('normalizes a `to` with a leading "./" and trailing slash to a clean prefix', () => {
        // A leading "./" would leak into the manifest key ("build/./to-copy/…") and, in Vite,
        // Rollup rejects an emitted fileName that looks like a relative path ("./to-copy/…").
        const r = normalizeOptions({ copy: [{ from: 'assets/to-copy', to: './to-copy/' }] }, '/app');
        expect(r.copy[0].to).toBe('to-copy');
    });

    it('collapses "." segments and redundant slashes in `to`', () => {
        expect(normalizeOptions({ copy: [{ from: 'a', to: './images//icons/' }] }, '/app').copy[0].to).toBe(
            'images/icons'
        );
        expect(normalizeOptions({ copy: [{ from: 'a', to: '.' }] }, '/app').copy[0].to).toBe('');
    });
});

describe('resolvePublicPath', () => {
    it('returns publicPath unchanged in build mode (no dev origin)', () => {
        expect(resolvePublicPath('/build/', null)).toBe('/build/');
    });
    it('prefixes the dev-server origin in dev mode', () => {
        expect(resolvePublicPath('/build/', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/build/');
    });
    it('strips a trailing slash from the origin before joining', () => {
        expect(resolvePublicPath('/build/', 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/build/');
    });
    it('keeps an already-absolute publicPath (CDN) as-is even in dev', () => {
        expect(resolvePublicPath('https://cdn.example.com/x/', 'http://127.0.0.1:5173')).toBe(
            'https://cdn.example.com/x/'
        );
    });
    it('keeps a protocol-relative publicPath as-is even in dev', () => {
        expect(resolvePublicPath('//cdn.example.com/x/', 'http://127.0.0.1:5173')).toBe('//cdn.example.com/x/');
    });
});
