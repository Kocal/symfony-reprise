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

Enable it by pointing the plugin at your `controllers.json` (this is what turns the feature on):

```ts
Symfony({ stimulus: 'assets/controllers.json' })
// or, to override the local controllers dir:
Symfony({ stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/controllers' } })
```

In your entry, swap the AssetMapper import for this plugin's — everything else stays the same:

```diff
- import { startStimulusApp } from '@symfony/stimulus-bundle'
+ import { startStimulusApp } from '@kocal/unplugin-symfony/stimulus'
  const app = startStimulusApp()
```

**Local controllers.** Any `assets/controllers/*_controller.{js,ts}` is registered automatically. The filename becomes the identifier (`hello_controller.js` -> `hello`, `admin/user_controller.js` -> `admin--user`). Add a `stimulusFetch: 'lazy'` comment above the class to load it on demand — either a block or a single-line comment works:

```js
// stimulusFetch: 'lazy'
import { Controller } from '@hotwired/stimulus'

export default class extends Controller {}
```

(`/* stimulusFetch: 'lazy' */` works too.)

**Third-party UX packages.** Controllers declared in `controllers.json` work too, but unlike AssetMapper (which vendors them via importmap) a bundler resolves them from `node_modules` — install them with your package manager, exactly like Webpack Encore did:

```bash
npm install @hotwired/stimulus @symfony/ux-turbo @symfony/ux-leaflet-map
```
