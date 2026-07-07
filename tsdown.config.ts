import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/*.ts'],
  // Keep .js/.d.ts output (the package is already ESM via "type": "module");
  // tsdown otherwise defaults to .mjs/.d.mts, which would break package.json exports.
  fixedExtension: false,
})
