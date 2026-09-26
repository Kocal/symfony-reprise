import { describe, expect, it } from 'vitest';
import { mergeWatchIgnored } from '../../src/bundlers/rsbuild';

const own = { pattern: /^\/own(?:\/|$)/, globs: ['/own', '/own/**'] };

function matcher(ignored: ReturnType<typeof mergeWatchIgnored>): (path: string) => boolean {
    if (ignored instanceof RegExp) return (path) => ignored.test(path);
    if (typeof ignored === 'function') return ignored;
    throw new Error('Expected a RegExp or a function');
}

describe('mergeWatchIgnored', () => {
    it("keeps Rspack's default ignores when none is set", () => {
        const ignored = matcher(mergeWatchIgnored(undefined, own));
        for (const path of ['/own/app.js', '/app/node_modules/x/index.js', '/app/.git/HEAD']) {
            expect(ignored(path), path).toBe(true);
        }
        expect(ignored('/app/assets/app.js')).toBe(false);
    });

    it('extends a RegExp and drops its stateful flags', () => {
        const merged = mergeWatchIgnored(/[\\/]\.CACHE[\\/]/gi, own);
        expect(merged).toBeInstanceOf(RegExp);
        expect((merged as RegExp).flags).toBe('i');
        const ignored = matcher(merged);
        for (const path of ['/own/app.js', '/app/.cache/x']) expect(ignored(path), path).toBe(true);
        for (const path of ['/app/assets/app.js', '/app/node_modules/x/index.js']) {
            expect(ignored(path), path).toBe(false);
        }
    });

    it('wraps a function and matches Windows paths', () => {
        const ignored = matcher(mergeWatchIgnored((path) => path.includes('/.cache/'), own));
        for (const path of ['/own/app.js', '\\own\\app.js', '/app/.cache/x']) expect(ignored(path), path).toBe(true);
        expect(ignored('/app/assets/app.js')).toBe(false);
    });

    it.each([['**/.cache/**'], [['**/.cache/**', '**/tmp/**']]])('appends globs to %j', (user) => {
        expect(mergeWatchIgnored(user, own)).toEqual([...[user].flat(), ...own.globs]);
    });
});
