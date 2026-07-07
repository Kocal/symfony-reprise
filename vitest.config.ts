import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only the plugin's own tests; keep vitest out of .references/ and playground/.
    include: ['test/**/*.{test,spec}.ts'],
  },
})
