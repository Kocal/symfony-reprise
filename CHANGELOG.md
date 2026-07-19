# CHANGELOG

## 0.4.0

- Support React Fast Refresh (HMR) with Vite by rendering the `@vitejs/plugin-react` preamble in dev

## 0.3.0

- Fix an entry's CSS being silently dropped under Vite when the entry is emitted as a facade chunk (a top-level `await` in an entry also imported by another entry)
- Prefer `build.rolldownOptions` over the deprecated `build.rollupOptions` (rolldown-vite / Vite 8)

## 0.2.0

- Update Unplugin from ^2.3.4 to ^3.3.0
- Rsbuild support now runs on unplugin's `createRsbuildPlugin`
- Fix the Rsbuild dev server to target `localhost` instead of a hardcoded `127.0.0.1`

## 0.1.0

- Initial release
