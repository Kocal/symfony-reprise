# Playground UX Showcase Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking. This targets the demo app under `playground/`, not the shipped library — there is no TDD/unit-test loop; each phase is verified by running the real Vite/Rsbuild build + dev server and opening the pages.

**Goal:** Turn `playground/` from a minimal two-entry app into a full showcase that (1) exercises the Reprise/bundler features end-to-end and (2) installs the curated Symfony UX set, each with an interactive demo card reachable from a dashboard (one page per demo). Vite **and** Rsbuild must both stay green.

**Architecture:** A data-driven dashboard (`DashboardController` + a PHP demo registry) renders a card grid in two sections — "Reprise features" and "Symfony UX". Each card links to its own route: `FeatureController` for the Reprise-feature pages, `DemoController` for the UX demos. Site-wide assets load through the `app` entry (`reprise_entry_*('app')` in `base.html.twig`); the `/admin` page loads a second `admin` entry to prove multiple entries. UX controllers register through Reprise's Stimulus virtual module (`controllers.json` + local `assets/controllers/`); React/Vue components register via `import.meta.glob(..., { eager: true })` in `app.ts`.

## Corrected assumptions (validated with the user)

- **Package manager: pnpm.** `playground` is a member of the root `pnpm-workspace.yaml`; there is no local lockfile and deps use the `link:` protocol. AGENTS.md's `npm -C playground …` is stale. Use `pnpm -C playground run …` and `pnpm install` at the repo root.
- **Flex is active** (`symfony/flex` + `extra.symfony.allow-contrib: true`). `composer require symfony/ux-*` auto-applies recipes: registers bundles in `config/bundles.php`, drops `config/packages/*` config, and adds entries to `assets/controllers.json`. Do **not** edit `bundles.php` by hand.
- **But `synchronize_package_json: false`** (in `composer.json` `extra.symfony/flex`) — Flex will **not** touch `package.json`. JS deps are added manually to `playground/package.json`, then `pnpm install`.
- **ux-translator dumps JS translations automatically on `cache:clear`** (via the `auto-scripts` block). No manual `ux:translator:dump` step.
- **UX 3.4 is released.** Switch `@symfony/ux-react`/`@symfony/ux-vue` from the local `link:../../ux-3712/...` to published `^3.4.0` (npm) and drop the ux-3712 dependency.

## Curated UX set (15 demos, one route each)

| Package | npm dep(s) | Demo | Notes |
|---|---|---|---|
| ux-react | `@symfony/ux-react@^3.4`, react/react-dom (present) | React counter/form in Twig | published 3.4, `react_component()` |
| ux-vue | `@symfony/ux-vue@^3.4`, vue (present) | Vue counter/form in Twig | published 3.4, `vue_component()` |
| ux-chartjs | `@symfony/ux-chartjs`, `chart.js` | chart + "regenerate data" button | `ChartBuilderInterface` PHP |
| ux-autocomplete | `@symfony/ux-autocomplete`, `tom-select` | searchable select | autoimport CSS |
| ux-dropzone | `@symfony/ux-dropzone` | drag-drop + preview | `DropzoneType` form |
| ux-cropperjs | `@symfony/ux-cropperjs`, `cropperjs` | upload + crop + preview | `CropperType` form |
| ux-notify | `@symfony/ux-notify` | **degraded**: button + "requires Mercure" note | no hub |
| ux-toggle-password | `@symfony/ux-toggle-password` | show/hide password | pure Stimulus |
| ux-lazy-image | `@symfony/ux-lazy-image` | blur -> sharp on scroll | Twig fn + Stimulus |
| ux-map (Leaflet) | present | map + markers | already wired |
| ux-icons | — (PHP-only) | icon gallery (several sets) | no controllers.json entry |
| ux-translator | `@symfony/ux-translator` | language switch affecting JS strings | import from dumped module |
| ux-live-component | `@symfony/ux-live-component` | live search / server-rendered counter | `AsLiveComponent` |
| ux-twig-component | — (PHP-only) | reusable card/alert (props + slots) | `AsTwigComponent` |
| ux-turbo | `@symfony/ux-turbo`, `@hotwired/turbo` | Drive nav + lazy turbo-frame | Drive/Frame only, no Mercure |

## Reprise feature showcases (6 pages, `/feature/{slug}`)

1. **Multiple entries** — `/admin` renders `reprise_entry_*('admin')`; everything else uses `app`.
2. **Code-splitting** — `app.ts` `import('./demos/…')` populates `entrypoints.json.dynamic`; plus one local controller marked `/* stimulusFetch: 'lazy' */`.
3. **SCSS + TypeScript** — entries are `.ts`, styles `.scss` (bundler-native; Reprise reimplements neither).
4. **Copied files gallery + CDN** — render copied images via `asset()`/manifest (keep the 2 `copy` rules incl. `pattern`); document/test an absolute CDN `publicPath` via env.
5. **Build-contract viewer** — `/feature/build-contract` reads `public/build/{entrypoints,manifest}.json` and pretty-prints them (isProd, devServer, integrity…); reflects dev vs build live.
6. **SRI** — already enabled (`integrity`); surfaced through the viewer + rendered tag attributes.

## File structure

- Modify: `playground/vite.config.ts`, `playground/rsbuild.config.ts` — `.ts` entries `app`/`admin`, SCSS (Vite `sass-embedded`, Rsbuild `@rsbuild/plugin-sass`), env-driven `publicPath` + explicit `manifestKeyPrefix`.
- Modify: `playground/composer.json` (via `composer require`), `playground/package.json` (manual JS deps).
- Rename/convert: `playground/assets/{app,admin}.js` -> `.ts`; `playground/assets/styles/{app,admin}.css` -> `.scss`.
- Create: `playground/assets/demos/*.ts` (dynamically-imported modules), extra `playground/assets/controllers/*` (incl. one lazy), UX React/Vue demo components under `assets/react/controllers/`, `assets/vue/controllers/`.
- Modify: `playground/assets/controllers.json` (recipes + fetch tweaks).
- Create: `playground/src/Controller/{DashboardController,DemoController,FeatureController}.php`, `playground/src/Components/*` (Live + Twig), `playground/src/Form/{DropzoneDemoType,CropperDemoType}.php`, a `DemoRegistry` (PHP array/service).
- Create/modify: `playground/templates/{base,dashboard}.html.twig`, `playground/templates/demo/*.html.twig`, `playground/templates/feature/*.html.twig`, `playground/templates/components/*`.
- Reduce: `playground/assets/to-copy/` to ~8 images (keep the `me_5x` pattern subset so the `pattern` copy rule still matches).

---

## Phase 0 — Dependencies & bundler config

- [ ] **Composer (Flex auto-registers):**
  ```bash
  composer -d playground require \
    symfony/ux-chartjs symfony/ux-autocomplete symfony/ux-dropzone \
    symfony/ux-cropperjs symfony/ux-toggle-password symfony/ux-lazy-image \
    symfony/ux-icons symfony/ux-translator symfony/ux-live-component \
    symfony/ux-twig-component symfony/ux-turbo symfony/ux-notify
  ```
  Accept recipe contrib prompts. Verify `config/bundles.php`, `config/packages/*`, and `assets/controllers.json` were updated.
- [ ] **package.json (manual — Flex sync is off):** in `playground/package.json`, replace the two `link:../../ux-3712/...` entries with `"@symfony/ux-react": "^3.4.0"`, `"@symfony/ux-vue": "^3.4.0"`; add deps `@symfony/ux-chartjs, chart.js, @symfony/ux-autocomplete, tom-select, @symfony/ux-dropzone, @symfony/ux-cropperjs, cropperjs, @symfony/ux-toggle-password, @symfony/ux-lazy-image, @symfony/ux-translator, @symfony/ux-live-component, @symfony/ux-turbo, @hotwired/turbo, @symfony/ux-notify`; add devDeps `sass-embedded, @rsbuild/plugin-sass`. Then `pnpm install` at repo root.
- [ ] **Bundler configs:** in both `vite.config.ts` and `rsbuild.config.ts`: entries `{ app: './assets/app.ts', admin: './assets/admin.ts' }`; keep `stimulus`, `integrity`, the 2 `copy` rules; add SCSS (Vite: `sass-embedded` is auto-detected, no plugin; Rsbuild: add `pluginSass()`); set `const publicPath = process.env.CDN_BASE ?? '/build/'` and pass `publicPath` + `manifestKeyPrefix: 'build'` (explicit prefix is required once `publicPath` can be an absolute CDN URL).
- [ ] **Verify:** `pnpm -C playground run vite:build` and `pnpm -C playground run rsbuild:build` both succeed; `public/build/{entrypoints,manifest}.json` still valid.

## Phase 1 — App shell & dashboard

- [ ] Convert `assets/{app,admin}.js` -> `.ts`; `styles/{app,admin}.css` -> `.scss` (update imports). Keep the existing `registerReactControllerComponents(import.meta.glob('./react/controllers/**/*.{jsx,tsx}', { eager: true }))` + Vue equivalent + `startStimulusApp()` in `app.ts`.
- [ ] `base.html.twig`: nav (link to dashboard), `reprise_entry_link_tags('app')` / `reprise_entry_script_tags('app')` only — **remove** the `encore_entry_*` lines.
- [ ] `DemoRegistry` (PHP array): each item `{ slug, title, description, section: 'feature'|'ux', route }`. `DashboardController` (`GET /`) passes it to `dashboard.html.twig`, rendered as a two-section card grid.
- [ ] Base SCSS for cards/nav/layout in `styles/app.scss`.
- [ ] **Verify:** `pnpm -C playground run vite:dev`, open `/`, dashboard renders both sections, no console errors.

## Phase 2 — Reprise feature pages

- [ ] `FeatureController` with one action per feature route + templates under `templates/feature/`.
- [ ] **Multiple entries:** `/admin` renders `reprise_entry_*('admin')`; `admin.ts`/`admin.scss` distinct content.
- [ ] **Code-splitting:** add `assets/demos/heavy.ts` (some non-trivial module), `import('./demos/heavy.ts')` in `app.ts` guarded by a DOM marker present on the code-splitting page; add one local controller `assets/controllers/lazy_hello_controller.ts` with `/* stimulusFetch: 'lazy' */`.
- [ ] **SCSS+TS:** feature page documents that `.ts`/`.scss` work with zero Reprise config.
- [ ] **Copied files gallery + CDN:** reduce `to-copy/` to ~8 images; gallery page renders them via `{{ asset('build/to-copy/…') }}`; document the CDN build (`CDN_BASE=https://cdn.example.com/build/ pnpm -C playground run vite:build`) and show the resulting absolute manifest URLs.
- [ ] **Build-contract viewer:** `/feature/build-contract` reads `public/build/{entrypoints,manifest}.json` and pretty-prints them in `<pre>` with short explanations.
- [ ] **Verify:** each feature page opens (dev); `dynamic` array populated after a build; CDN build yields absolute URLs in `manifest.json`.

## Phase 3 — UX demo pages

Implement the 15 cards from the table. Group by need:

- [ ] **Pure Twig/Stimulus** (chartjs, autocomplete, toggle-password, lazy-image, icons, twig-component): template per demo under `templates/demo/`, `DemoController` action each. chartjs uses `ChartBuilderInterface`; icons uses `ux_icon()` across a few sets; twig-component builds one reusable component in `src/Components/`.
- [ ] **Forms** (dropzone, cropperjs): `src/Form/*Type`, controller action rendering the form, template.
- [ ] **Framework components** (react, vue): demo components under `assets/react/controllers/`, `assets/vue/controllers/`; pages use `react_component()` / `vue_component()`.
- [ ] **Server-reactive** (live-component): `src/Components/` `AsLiveComponent` (e.g. live search or counter) + template.
- [ ] **Turbo** (Drive + Frame): a page with a `turbo-frame` whose `src` hits a `DemoController` fragment action.
- [ ] **notify (degraded):** page with a button + a callout explaining it needs a Mercure hub (not provisioned).
- [ ] **controllers.json:** confirm recipe entries exist; keep react/vue `eager`, map `lazy`; set heavy/rarely-used controllers to `lazy` where sensible.
- [ ] **Verify:** open each demo page in `vite:dev`; interact (chart regenerates, autocomplete filters, crop works, live-component updates, turbo-frame lazy-loads); no console errors.

## Phase 4 — Wiring & parity

- [ ] Confirm React/Vue registration + `startStimulusApp()` run once, site-wide, from `app.ts`.
- [ ] `cache:clear` so ux-translator dumps JS translations; import the dumped module in the translator demo.
- [ ] Mirror any bundler-specific need in **both** `vite.config.ts` and `rsbuild.config.ts` (project symmetry rule).

## Final verification

- [ ] **Vite:** `pnpm -C playground run vite:build` then `vite:dev`; dashboard + all pages load; `entrypoints.json` has `app`+`admin`, populated `dynamic`, `integrity` present; copied files (incl. `pattern` subset) keyed in `manifest.json`.
- [ ] **Rsbuild:** `pnpm -C playground run rsbuild:build` then `rsbuild:dev`; same pages load; outputs consistent with Vite.
- [ ] **Screenshots (chrome-devtools MCP):** dashboard + ~4 representative demos (react, chartjs, live-component, turbo-frame) + the build-contract page, under both dev and build.
- [ ] **CDN:** a `CDN_BASE=…` build yields absolute URLs in `manifest.json`/`entrypoints.json`.
- [ ] Console clean across the visited pages on both bundlers.
