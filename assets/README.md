<p align="center"><a href="https://symfony.com" target="_blank">
    <img src="https://symfony.com/logos/symfony_dynamic_01.svg" alt="Symfony Logo">
</a></p>

<h3 align="center">
    <img src="https://raw.githubusercontent.com/symfony/reprise/main/doc/symfony-reprise.svg" alt="Symfony Reprise" height="32" align="center"> Symfony Reprise: Webpack Encore's heritage, for modern bundlers
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@symfony/reprise"><img src="https://img.shields.io/npm/v/@symfony%2Freprise?label=npm&color=crimson" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@symfony/reprise"><img src="https://img.shields.io/node/v/@symfony%2Freprise?label=node&color=crimson" alt="Node version"></a>
  <a href="https://github.com/symfony/reprise/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/symfony/reprise/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="https://github.com/symfony/reprise/blob/main/assets/LICENSE"><img src="https://img.shields.io/github/license/symfony/reprise?label=license&color=crimson" alt="License"></a>
</p>

The JavaScript half of **[Symfony Reprise](https://github.com/symfony/reprise)**: a Vite and Rsbuild plugin that generates the `entrypoints.json` and `manifest.json` the Symfony bundle reads.

Use it alongside the [`symfony/reprise` Composer bundle](https://packagist.org/packages/symfony/reprise). The plugin builds your assets and writes the manifests; the bundle renders the matching `<script>` and `<link>` tags from them.

## Installation

```bash
npm install @symfony/reprise --save-dev
```

## Usage

Vite:

```js
// vite.config.ts
import { defineConfig } from 'vite';
import Symfony from '@symfony/reprise/vite';

export default defineConfig({
    plugins: [Symfony({/* options */})],
});
```

Rsbuild:

```js
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import Symfony from '@symfony/reprise/rsbuild';

export default defineConfig({
    plugins: [Symfony({/* options */})],
});
```

See the [full documentation](https://github.com/symfony/reprise/blob/main/doc/index.rst) for entrypoints, manifest, dev server and Stimulus setup.

## License

[MIT](./LICENSE)
