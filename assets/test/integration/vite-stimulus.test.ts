import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import Symfony from '../../src/vite';

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app');

describe('vite build resolves virtual:symfony/controllers', () => {
    it('bundles local controllers, eager inlined and lazy code-split', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-stim-'));
        await build({
            root: fixture,
            logLevel: 'silent',
            build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            // stimulus paths are resolved against process.cwd() (the repo root under vitest),
            // so pass an absolute controllers.json path.
            plugins: [Symfony({ outputPath: out, publicPath: '/build/', stimulus: join(fixture, 'controllers.json') })],
        });
        const files = readdirSync(out, { recursive: true }).map(String);
        const appJs = files.find((f) => f.startsWith('app') && f.endsWith('.js'))!;
        const code = readFileSync(join(out, appJs), 'utf8');
        // eager identifier + lazy identifier both present in the entry
        expect(code).toContain('greet');
        expect(code).toContain('heavy');
        // the lazy controller is code-split into its own chunk
        expect(files.some((f) => f.endsWith('.js') && f !== appJs)).toBe(true);
    }, 30_000);

    it('fails with a clear message when the virtual module is imported but stimulus is off', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-stim-off-'));
        await expect(
            build({
                root: fixture,
                logLevel: 'silent',
                build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
                // no `stimulus` option, yet app.js imports virtual:symfony/controllers
                plugins: [Symfony({ outputPath: out, publicPath: '/build/' })],
            })
        ).rejects.toThrow(/Stimulus integration is not enabled/);
    }, 30_000);
});
