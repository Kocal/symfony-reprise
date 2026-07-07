# unplugin-symfony

[![npm version](https://img.shields.io/npm/v/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)
[![npm downloads](https://img.shields.io/npm/dm/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)
[![license](https://img.shields.io/npm/l/@kocal%40unplugin-symfony?color=crimson&label=)](https://www.npmjs.com/package/@kocal/unplugin-symfony)

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
import Symfony from '@kocal/unplugin-symfony/vite'

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
import Symfony from '@kocal/unplugin-symfony/rspack'
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  tools: {
    rspack: {
      plugins: [Symfony({ /* options */ })],
    },
  },
})
```

<br></details>
