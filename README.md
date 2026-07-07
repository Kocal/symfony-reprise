# unplugin-symfony

[![npm version](https://img.shields.io/npm/v/unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/unplugin-symfony)
[![npm downloads](https://img.shields.io/npm/dm/unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/unplugin-symfony)
[![license](https://img.shields.io/npm/l/unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/unplugin-symfony)

Easily integrate the key features of Symfony's Webpack Encore into your Vite or Rsbuild/Rspack setup using a single unplugin.

## Features

⚡️Vite and 🦀Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**, **JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**, **minification** and **HMR** on their own, so this plugin doesn't reimplement any of that.
It only covers the Symfony-side integration that bundlers don't provide out of the box:

- [x] Multiple entries
- [ ] `entrypoints.json` generation (build + dev-server modes)
- [ ] `manifest.json` generation
- [ ] Asset versioning wired into the manifest
- [ ] CDN support (absolute `publicPath`)
- [ ] Dev server & HMR integration
- [ ] Subresource Integrity (SRI) hashes
- [ ] Shared runtime chunk across entries
- [ ] Symfony UX / Stimulus controllers (`controllers.json` + local `assets/controllers/`)

## Install

```bash
npm install @kocal/unplugin-symfony --save-dev
```

<details>
<summary>Vite</summary><br>

```ts
// vite.config.ts
import Symfony from 'unplugin-symfony/vite'

export default defineConfig({
  plugins: [
    Symfony({ /* options */ }),
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
import Symfony from 'unplugin-symfony/rspack'

export default defineConfig({
  tools: {
    rspack: {
      plugins: [Symfony({ /* options */ })],
    },
  },
})
```

<br></details>
