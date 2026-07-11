import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import Symfony from '../assets/src/rsbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  source: {
    entry: {
      app: resolve(__dirname, './assets/app.js'),
      admin: resolve(__dirname, './assets/admin.js'),
    },
  },
  plugins: [
    Symfony({
        stimulus: './assets/controllers.json',
        integrity: {
            enabled: true,
            algorithms: ['sha256', 'sha384']
        },
        copy: [
            { from: './assets/to-copy/', to: './to-copy/' },
            { from: './assets/to-copy/', to: './to-copy-5/', pattern: /me_5\d+\.jpeg/ },
        ]
    }),
  ],
    resolve: {
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
