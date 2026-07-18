import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginVue } from '@rsbuild/plugin-vue'
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
    pluginReact(),
    pluginVue(),
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
      // @symfony/ux-react is linked to a local UX build that ships its own React copy,
      // so force a single one here (Rsbuild, unlike Vite, doesn't dedupe React).
      dedupe: ['react', 'react-dom'],
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
