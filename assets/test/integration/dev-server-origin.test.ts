import { mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import SymfonyRsbuild from '../../src/rsbuild';
import SymfonyVite from '../../src/vite';
import { createSymfonyWriteWaiter, getFreePort } from './support';

const fixture = join(import.meta.dirname, '../fixtures/basic');
const ORIGIN = 'http://assets.example.test:8080';

const readEntrypoints = (out: string) => JSON.parse(readFileSync(join(out, 'entrypoints.json'), 'utf8'));

describe('devServerOrigin overrides the advertised dev-server origin', () => {
    it('vite', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-origin-vite-'));
        const server = await createServer({
            root: fixture,
            logLevel: 'silent',
            server: { port: 0 },
            build: { rollupOptions: { input: { app: join(fixture, 'app.js') } } },
            plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/', devServerOrigin: `${ORIGIN}/` })],
        });
        await server.listen();
        try {
            const entry = readEntrypoints(out);
            expect(entry.devServer.origin).toBe(ORIGIN);
            expect(entry.devServer.client).toBe(`${ORIGIN}/build/@vite/client`);
            expect(entry.entryPoints.app.js).toEqual([`${ORIGIN}/build/app.js`]);
        } finally {
            await server.close();
        }
    }, 30_000);

    it('rsbuild', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ups-origin-rsbuild-'));
        const firstWrite = createSymfonyWriteWaiter();
        const rsbuild = await createRsbuild({
            cwd: fixture,
            rsbuildConfig: {
                mode: 'development',
                source: { entry: { app: join(fixture, 'app.js') } },
                server: { port: await getFreePort() },
                plugins: [
                    SymfonyRsbuild({ outputPath: out, publicPath: '/build/', devServerOrigin: `${ORIGIN}/` }),
                    firstWrite.plugin,
                ],
            },
        });
        const server = await rsbuild.startDevServer();
        try {
            await firstWrite.written;
            const entry = readEntrypoints(out);
            expect(entry.devServer.origin).toBe(ORIGIN);
            expect(entry.entryPoints.app.js[0]).toMatch(/^http:\/\/assets\.example\.test:8080\/build\//);
        } finally {
            await server.server.close();
        }
    }, 30_000);
});

describe('a wildcard or IPv6 dev-server host is advertised as a dialable origin', () => {
    it.each([
        ['0.0.0.0', 'localhost'],
        [true, 'localhost'],
        ['::1', '[::1]'],
    ] as const)(
        'vite, server.host: %s -> %s',
        async (host, expected) => {
            const out = mkdtempSync(join(tmpdir(), 'ups-host-vite-'));
            const server = await createServer({
                root: fixture,
                logLevel: 'silent',
                server: { port: 0, host },
                build: { rollupOptions: { input: { app: join(fixture, 'app.js') } } },
                plugins: [SymfonyVite({ outputPath: out, publicPath: '/build/' })],
            });
            await server.listen();
            try {
                const { port } = server.httpServer!.address() as AddressInfo;
                expect(readEntrypoints(out).devServer.origin).toBe(`http://${expected}:${port}`);
            } finally {
                await server.close();
            }
        },
        30_000
    );

    it.each([
        ['0.0.0.0', 'localhost'],
        ['::', 'localhost'],
        ['::1', '[::1]'],
    ])(
        'rsbuild, server.host: %s -> %s',
        async (host, expected) => {
            const out = mkdtempSync(join(tmpdir(), 'ups-host-rsbuild-'));
            const firstWrite = createSymfonyWriteWaiter();
            const rsbuild = await createRsbuild({
                cwd: fixture,
                rsbuildConfig: {
                    mode: 'development',
                    source: { entry: { app: join(fixture, 'app.js') } },
                    server: { port: await getFreePort(), host },
                    plugins: [SymfonyRsbuild({ outputPath: out, publicPath: '/build/' }), firstWrite.plugin],
                },
            });
            const server = await rsbuild.startDevServer();
            try {
                await firstWrite.written;
                expect(readEntrypoints(out).devServer.origin).toBe(`http://${expected}:${server.port}`);
            } finally {
                await server.server.close();
            }
        },
        30_000
    );
});
