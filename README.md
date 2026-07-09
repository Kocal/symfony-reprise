# unplugin-symfony

[![npm version](https://img.shields.io/npm/v/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)
[![npm downloads](https://img.shields.io/npm/dm/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)
[![license](https://img.shields.io/npm/l/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)

Easily integrate the key features of Symfony's Webpack Encore into your Vite or Rsbuild/Rspack setup using a single unplugin.

## Features

⚡️Vite and 🦀Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**, **JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**, **minification** and **HMR** on their own, so this plugin doesn't reimplement any of that.
It only covers the Symfony-side integration that bundlers don't provide out of the box:

- [x] Multiple entries
- [x] `entrypoints.json` generation (build + dev-server modes)
- [x] `manifest.json` generation
- [x] Asset versioning wired into the manifest
- [ ] CDN support (absolute `publicPath`)
- [x] Dev server & HMR integration
- [ ] Subresource Integrity (SRI) hashes
- [ ] Shared runtime chunk across entries
- [x] Symfony UX / Stimulus controllers (`controllers.json` + local `assets/controllers/`)

## Install

```bash
npm install @kocal/unplugin-symfony --save-dev
```

<details>
<summary>Vite</summary><br>

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import Symfony from '@kocal/unplugin-symfony/vite'

export default defineConfig({
  plugins: [
    Symfony({ /* options */}),
  ],
})
```

Example: [`playground/`](./playground/)

<br></details>

<details>
<summary>Rsbuild</summary><br>

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core'
import Symfony from '@kocal/unplugin-symfony/rsbuild'

export default defineConfig({
  plugins: [Symfony({ /* options */ })],
})
```

<br></details>

## Symfony UX / Stimulus controllers

This is the Vite/Rsbuild counterpart of what `@symfony/stimulus-bridge` did for Webpack Encore: it turns your `controllers.json` into a Stimulus application, with the same enable step, same helper, same local-controllers convention.

Enable it by pointing the plugin at your `controllers.json` (this is what turns the feature on):

```ts
Symfony({ stimulus: 'assets/controllers.json' })
// or, to override the local controllers dir:
Symfony({ stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/controllers' } })
```

Then start the app from your entry:

```ts
import { startStimulusApp } from '@kocal/unplugin-symfony/stimulus'

const app = startStimulusApp()
```

**Local controllers.** Any `assets/controllers/*_controller.{js,ts}` is registered automatically. The filename becomes the identifier (`hello_controller.js` -> `hello`, `admin/user_controller.js` -> `admin--user`). To load a controller on demand, put a `stimulusFetch: 'lazy'` comment directly above the class (after the imports) — a block or a single-line comment both work:

```js
import { Controller } from '@hotwired/stimulus'

/* stimulusFetch: 'lazy' */
export default class extends Controller {}
```

(`// stimulusFetch: 'lazy'` on the line above the class works too. The marker only counts directly above the class — not above the imports.)

**Third-party UX packages.** Controllers declared in `controllers.json` are resolved from `node_modules`, so install them with your package manager, same as you would with Webpack Encore (AssetMapper instead vendors them via importmap):

```bash
npm install @hotwired/stimulus @symfony/ux-turbo @symfony/ux-leaflet-map
```

Some packages need a bit of bundler-specific setup on top, the same way they did under Webpack Encore. UX Leaflet Map, for instance, ships a CSS file meant for Webpack's loader and needs an alias to the plain CSS build:

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: {
      'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
    },
  },
})
```

Check each package's own docs for this kind of tweak.
