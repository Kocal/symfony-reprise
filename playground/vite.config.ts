import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import Unplugin from '../src/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, './assets/app.js'),
        admin: resolve(__dirname, './assets/admin.js'),
      },
    },
  },
  plugins: [
    Inspect(),
    Unplugin({
        stimulus: './assets/controllers.json',
    }),
  ],
    resolve: {
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
