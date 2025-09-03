# unplugin-symfony

## Install

```bash
npm i unplugin-symfony
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
<summary>Rollup</summary><br>

```ts
// rollup.config.js
import Symfony from 'unplugin-symfony/rollup'

export default {
  plugins: [
    Symfony({ /* options */ }),
  ],
}
```

<br></details>

<details>
<summary>Webpack</summary><br>

```ts
// webpack.config.js
module.exports = {
  /* ... */
  plugins: [
    require('unplugin-symfony/webpack')({ /* options */ })
  ]
}
```

<br></details>
<details>
<summary>Rspack</summary><br>

```ts
// rspack.config.js
module.exports = {
  /* ... */
  plugins: [
    require('unplugin-symfony/webpack')({ /* options */ })
  ]
}
```

<br></details>
