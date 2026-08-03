import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['./tests/e2e/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
    // One Symfony server shared across files: keep the files from running in parallel.
    fileParallelism: false,
  },
})
