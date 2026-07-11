import type { EntryFiles } from '../../src/types';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeIntegrity, integrityFromDisk, referencedFileNames } from '../../src/core/integrity';

describe('computeIntegrity', () => {
    it('formats a single algorithm as `<algo>-<base64>`', () => {
        expect(computeIntegrity('reprise', ['sha384'])).toBe(
            'sha384-faAamSmmStfxJQ9skVshC6f5CFqO35HWc37M47/RU370OJxAaGp/EDpOhEtMqHU6'
        );
        expect(computeIntegrity('reprise', ['sha256'])).toBe('sha256-9HI/4mqcitIofBrwxywRV2OTHrfkKZSVAdGtr3AidrQ=');
    });

    it('joins multiple algorithms with a space, in the given order', () => {
        expect(computeIntegrity('reprise', ['sha256', 'sha512'])).toBe(
            'sha256-9HI/4mqcitIofBrwxywRV2OTHrfkKZSVAdGtr3AidrQ= sha512-lMCBX5XJ7xq9zWMR7zg7rQXzt0U1v/qX3vtUkCDkrBvOULn+UWCMFvf0hTGqKr+GMj+gTY5zzqQhISiHJlMDXg=='
        );
    });

    it('hashes raw bytes (Uint8Array) the same as the equivalent string', () => {
        expect(computeIntegrity(new TextEncoder().encode('reprise'), ['sha256'])).toBe(
            computeIntegrity('reprise', ['sha256'])
        );
    });
});

describe('referencedFileNames', () => {
    it('collects js/css/preload/dynamic across entries, deduped in first-seen order', () => {
        const entryPoints: Record<string, EntryFiles> = {
            app: { js: ['app.js'], css: ['app.css'], preload: ['vendor.js'], dynamic: ['lazy.js'] },
            admin: { js: ['admin.js'], css: [], preload: ['vendor.js'], dynamic: [] },
        };
        expect(referencedFileNames(entryPoints)).toEqual(['app.js', 'app.css', 'vendor.js', 'lazy.js', 'admin.js']);
    });
});

describe('integrityFromDisk', () => {
    it('hashes each named file (including nested paths) read from the output directory', () => {
        const dir = mkdtempSync(join(tmpdir(), 'reprise-sri-'));
        writeFileSync(join(dir, 'app.js'), 'reprise');
        mkdirSync(dirname(join(dir, 'static/js/vendor.js')), { recursive: true });
        writeFileSync(join(dir, 'static/js/vendor.js'), 'reprise');

        expect(integrityFromDisk(['app.js', 'static/js/vendor.js'], dir, ['sha384'])).toEqual({
            'app.js': 'sha384-faAamSmmStfxJQ9skVshC6f5CFqO35HWc37M47/RU370OJxAaGp/EDpOhEtMqHU6',
            'static/js/vendor.js': 'sha384-faAamSmmStfxJQ9skVshC6f5CFqO35HWc37M47/RU370OJxAaGp/EDpOhEtMqHU6',
        });
    });
});
