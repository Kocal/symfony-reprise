import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // The real module is emitted by the unplugin resolver at build/dev time
            // (src/core/stimulus.ts); stand in with a fixture so src/stimulus.ts is importable under vitest.
            'virtual:symfony/controllers': fileURLToPath(
                new URL('./test/fixtures/virtual-controllers.ts', import.meta.url)
            ),
        },
    },
    test: {
        // Only the plugin's own tests; keep vitest out of .references/ and playground/.
        include: ['test/**/*.{test,spec}.ts'],
    },
});
