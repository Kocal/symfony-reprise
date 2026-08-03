import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import Inspect from 'vite-plugin-inspect'
import Unplugin from '../assets/src/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const publicPath = process.env.CDN_BASE ?? '/build/'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, './assets/app.ts'),
        admin: resolve(__dirname, './assets/admin.ts'),
      },
    },
  },
  plugins: [
    tailwindcss(),
    Inspect(),
    react(),
    vue(),
    Unplugin({
        stimulus: './assets/controllers.json',
        publicPath,
        manifestKeyPrefix: 'build/',
        integrity: {
            enabled: true,
        },
        copy: [
            { from: './assets/to-copy/', to: './media/' },
            { from: './assets/to-copy/', to: './tiles/', pattern: /^tile-\d+\.png$/ },
        ]
    }),
  ],
    resolve: {
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
