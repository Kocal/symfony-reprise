import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCopyEntry } from '../../src/types';
import { contentHash, copyManifest, enumerateCopyFiles, hashedName, resolveCopyFiles } from '../../src/core/copy';

const src = join(import.meta.dirname, '../fixtures/copy-src');
const binSrc = join(import.meta.dirname, '../fixtures/copy-binary');

function entry(over: Partial<ResolvedCopyEntry> = {}): ResolvedCopyEntry {
    return { from: src, to: 'images', pattern: /.*/, includeSubdirectories: true, ...over };
}

describe('enumerateCopyFiles', () => {
    it('recurses and builds forward-slash logical names under `to`', () => {
        const names = enumerateCopyFiles([entry()])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg', 'images/notes.txt']);
    });

    it('filters by pattern against the from-relative path', () => {
        const names = enumerateCopyFiles([entry({ pattern: /\.svg$/ })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/icons/cat.svg', 'images/logo.svg']);
    });

    it('skips subdirectories when includeSubdirectories is false', () => {
        const names = enumerateCopyFiles([entry({ includeSubdirectories: false })])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['images/logo.svg', 'images/notes.txt']);
    });

    it('warns and skips a missing `from` instead of throwing', () => {
        expect(enumerateCopyFiles([entry({ from: join(src, 'does-not-exist') })])).toEqual([]);
    });

    it('aggregates multiple entries under their own `to` prefixes', () => {
        const names = enumerateCopyFiles([
            entry({ to: 'a', pattern: /\.svg$/ }),
            { from: binSrc, to: 'b', pattern: /.*/, includeSubdirectories: true },
        ])
            .map((f) => f.logicalName)
            .sort();
        expect(names).toEqual(['a/icons/cat.svg', 'a/logo.svg', 'b/pixel.png']);
    });
});

describe('hashedName', () => {
    it('injects the hash before the extension, preserving subdirs', () => {
        expect(hashedName('images/icons/cat.svg', 'a1b2c3d4')).toBe('images/icons/cat.a1b2c3d4.svg');
    });

    it('appends the hash when there is no extension', () => {
        expect(hashedName('images/LICENSE', 'a1b2c3d4')).toBe('images/LICENSE.a1b2c3d4');
    });
});

describe('resolveCopyFiles', () => {
    it('uses hashed physical names when hashed=true', () => {
        const logo = resolveCopyFiles([entry()], true).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toMatch(/^images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(logo.source).toBeInstanceOf(Buffer);
    });

    it('uses verbatim physical names when hashed=false', () => {
        const logo = resolveCopyFiles([entry()], false).find((f) => f.logicalName === 'images/logo.svg')!;
        expect(logo.physicalName).toBe('images/logo.svg');
    });
});

describe('copyManifest', () => {
    it('keys by manifestKeyPrefix + logicalName, values by joinUrl(publicPath, physicalName)', () => {
        const files = resolveCopyFiles([entry()], true);
        const manifest = copyManifest(files, { publicPath: '/build/', manifestKeyPrefix: 'build/' });
        expect(manifest['build/images/logo.svg']).toMatch(/^\/build\/images\/logo\.[0-9a-f]{8}\.svg$/);
        expect(manifest['build/images/icons/cat.svg']).toMatch(/^\/build\/images\/icons\/cat\.[0-9a-f]{8}\.svg$/);
    });
});

describe('contentHash', () => {
    it('is deterministic and 8 hex chars', () => {
        const h = contentHash(Buffer.from('hello'));
        expect(h).toMatch(/^[0-9a-f]{8}$/);
        expect(h).toBe(contentHash(Buffer.from('hello')));
    });
});
