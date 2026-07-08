import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import Symfony from '../src/rsbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  source: {
    entry: {
      app: resolve(__dirname, './assets/app.js'),
      admin: resolve(__dirname, './assets/admin.js'),
    },
  },
  plugins: [
    Symfony(),
  ],
})
