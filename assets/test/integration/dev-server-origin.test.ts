import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, rsbuildDev, tmpDir, viteDev } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const input = { app: join(fixture, 'app.js') };
const ORIGIN = 'http://assets.example.test:8080';

describe('devServerOrigin overrides the advertised dev-server origin', () => {
    it('vite', async () => {
        const out = tmpDir('origin-vite');
        const server = await viteDev(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            devServerOrigin: `${ORIGIN}/`,
        });
        try {
            const entry = readJson(out, 'entrypoints.json');
            expect(entry.devServer.origin).toBe(ORIGIN);
            expect(entry.devServer.client).toBe(`${ORIGIN}/build/@vite/client`);
            expect(entry.entryPoints.app.js).toEqual([`${ORIGIN}/build/app.js`]);
        } finally {
            await server.close();
        }
    });

    it('rsbuild', async () => {
        const out = tmpDir('origin-rsbuild');
        const server = await rsbuildDev(fixture, input, {
            outputPath: out,
            publicPath: '/build/',
            devServerOrigin: `${ORIGIN}/`,
        });
        try {
            const entry = readJson(out, 'entrypoints.json');
            expect(entry.devServer.origin).toBe(ORIGIN);
            expect(entry.entryPoints.app.js[0]).toMatch(/^http:\/\/assets\.example\.test:8080\/build\//);
        } finally {
            await server.server.close();
        }
    });
});

describe('a wildcard or IPv6 dev-server host is advertised as a dialable origin', () => {
    it.each([
        ['0.0.0.0', 'localhost'],
        [true, 'localhost'],
        ['::1', '[::1]'],
    ] as const)('vite, server.host: %s -> %s', async (host, expected) => {
        const out = tmpDir('host-vite');
        const server = await viteDev(fixture, input, { outputPath: out, publicPath: '/build/' }, { server: { host } });
        try {
            const { port } = server.httpServer!.address() as AddressInfo;
            expect(readJson(out, 'entrypoints.json').devServer.origin).toBe(`http://${expected}:${port}`);
        } finally {
            await server.close();
        }
    });

    it.each([
        ['0.0.0.0', 'localhost'],
        ['::', 'localhost'],
        ['::1', '[::1]'],
    ])('rsbuild, server.host: %s -> %s', async (host, expected) => {
        const out = tmpDir('host-rsbuild');
        const server = await rsbuildDev(
            fixture,
            input,
            { outputPath: out, publicPath: '/build/' },
            { server: { host } }
        );
        try {
            expect(readJson(out, 'entrypoints.json').devServer.origin).toBe(`http://${expected}:${server.port}`);
        } finally {
            await server.server.close();
        }
    });
});
