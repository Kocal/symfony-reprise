# Design — Reprise monorepo restructure (bundle + npm package)

Status: approved (2026-07-09)
Scope: layout restructure + rebrand + installable Symfony bundle **skeleton**. No PHP consumer logic yet.

## Goal

Turn this JS-only repository into a monorepo that is BOTH:
- a **Symfony bundle** (Composer package `symfony/reprise`) — an empty-but-installable skeleton for now, and
- an **npm package** (`@symfony/reprise`) living under `assets/` — the existing Vite/Rsbuild plugin, moved and renamed.

The product is renamed from `@kocal/unplugin-symfony` to **Reprise**: Symfony's asset integration for Vite and Rsbuild, positioned as the heir to Webpack Encore.

## Names (frozen)

| Thing | Value |
|---|---|
| Product | Reprise |
| npm package | `@symfony/reprise` |
| Composer package | `symfony/reprise` (`type: symfony-bundle`) |
| PHP namespace | `Symfony\Reprise\` (tests: `Symfony\Reprise\Tests\`) |
| Bundle class | `Symfony\Reprise\RepriseBundle` |
| DI config key | `reprise` |

Package descriptions:
- npm: `Symfony asset integration for Vite and Rsbuild, a reprise of Webpack Encore.`
- Composer: `Integrate Vite and Rsbuild with Symfony, a reprise of Webpack Encore Bundle.`

## Non-goals (deferred)

- The PHP consumer logic — the bundle's real functionality (a Twig extension exposing `reprise_entry_*` tags that read `entrypoints.json`/`manifest.json`, like `WebpackEncoreBundle`'s `EntryFilesTwigExtension`, plus the `EntrypointLookup`/`TagRenderer` services and DI config). The bundle ships as an empty `AbstractBundle` now; the functionality is the next milestone.
- Publishing to npm / Packagist. This restructure only prepares the layout.
- Any change to the JS plugin's behaviour. `src/`/`test/` move verbatim (only the package name and internal doc references change).

## Target layout

```
/ (repo root = Symfony bundle "symfony/reprise" + pnpm workspace root)
├── composer.json               # symfony/reprise, type symfony-bundle
├── .symfony.bundle.yaml
├── phpunit.dist.xml
├── phpstan.dist.neon
├── .php-cs-fixer.dist.php
├── src/                        # PHP — Symfony\Reprise\
│   └── RepriseBundle.php
├── tests/                      # PHP — Symfony\Reprise\Tests\
│   └── RepriseBundleTest.php
├── package.json                # PRIVATE workspace root (JS tooling + scripts)
├── pnpm-workspace.yaml         # packages: [assets, playground]
├── eslint.config.js            # stays at root, lints assets/**
├── assets/                     # the npm package @symfony/reprise
│   ├── package.json
│   ├── tsdown.config.ts
│   ├── vitest.config.ts
│   ├── tsconfig.json
│   ├── src/                    # moved from ./src (verbatim)
│   │   └── … index.ts, vite.ts, rsbuild.ts, stimulus.ts, types.ts, virtual-modules.d.ts, core/, collectors/
│   └── test/                   # moved from ./test (verbatim)
├── playground/                 # Symfony app (workspace member, unchanged)
├── docs/  .github/  README.md  LICENSE  AGENTS.md  CLAUDE.md  .editorconfig  .gitignore  .nvmrc  .npmrc  reference-repos.md
```

## Component 1 — PHP bundle skeleton (repo root)

### `composer.json`
```json
{
    "name": "symfony/reprise",
    "type": "symfony-bundle",
    "description": "Integrate Vite and Rsbuild with Symfony, a reprise of Webpack Encore Bundle.",
    "license": "MIT",
    "keywords": ["symfony", "vite", "rsbuild", "assets", "encore"],
    "authors": [{ "name": "Hugo Alliaume", "email": "hugo@alliau.me" }],
    "require": {
        "php": ">=8.4"
    },
    "require-dev": {
        "symfony/framework-bundle": "^7.4|^8.0",
        "symfony/http-kernel": "^7.4|^8.0",
        "phpunit/phpunit": "^11.1|^12.0",
        "phpstan/phpstan": "^2.1",
        "friendsofphp/php-cs-fixer": "^3.60"
    },
    "autoload": {
        "psr-4": { "Symfony\\Reprise\\": "src/" }
    },
    "autoload-dev": {
        "psr-4": { "Symfony\\Reprise\\Tests\\": "tests/" }
    },
    "minimum-stability": "dev",
    "prefer-stable": true
}
```
(Symfony version floors — `^7.4|^8.0` — sit only in `require-dev` for now: the empty bundle depends on no Symfony runtime component yet. They move to `require` when the consumer logic lands.)

### `RepriseBundle.php`
```php
<?php

namespace Symfony\Reprise;

use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

final class RepriseBundle extends AbstractBundle
{
}
```
Modern `AbstractBundle`, intentionally empty. `configure()`/`loadExtension()`/`prependExtension()` are added with the consumer logic later (YAGNI now).

### `.symfony.bundle.yaml`
```yaml
branches: ['main']
maintained_branches: ['main']
doc_dir: 'doc'
```

### `tests/RepriseBundleTest.php`
A smoke test that boots a minimal in-memory kernel registering `RepriseBundle` and asserts the container compiles (proves the bundle installs and boots). Uses `Symfony\Component\HttpKernel\Kernel` with `FrameworkBundle` + `RepriseBundle`, `MicroKernelTrait` or an inline anonymous kernel. PHPUnit 11/12.

### QA config
- `phpunit.dist.xml` — bootstraps `vendor/autoload.php`, test suite over `tests/`.
- `phpstan.dist.neon` — level max over `src/` (+ `tests/`), Symfony-friendly.
- `.php-cs-fixer.dist.php` — the `@Symfony` + `@Symfony:risky` ruleset over `src/` and `tests/`.

## Component 2 — JS package (`assets/`)

- `git mv src assets/src`, `git mv test assets/test`.
- Move `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json` into `assets/` (adjust any relative paths — none currently reference outside their dir except vitest's fixture alias, which stays relative to `assets/`).
- `assets/package.json` = the current JS half of the root `package.json`, renamed to `@symfony/reprise`, description as above, `exports`/`main`/`module`/`types` unchanged (still `./dist/*`), `files: ["dist"]`, peer deps (`vite`, `@rsbuild/core`, `@hotwired/stimulus`), devDeps (the JS build/test deps), scripts (`build`, `dev`, `test`, `lint` scoped to this package). **No `symfony` key** (Reprise is a build plugin, not a Stimulus-controller package).
- Import specifiers inside `assets/src` are unchanged (relative + bare). The `@kocal/unplugin-symfony/stimulus` reference in `assets/test/fixtures/stimulus-app` and the helper's own package self-reference (if any) become `@symfony/reprise/stimulus`.
- `assets/vitest.config.ts` `include` stays `test/**` (now relative to `assets/`); the `resolve.alias` fixture path stays relative.

## Component 3 — root workspace + tooling

### root `package.json` (private)
```json
{
    "name": "symfony-reprise-dev",
    "private": true,
    "type": "module",
    "packageManager": "pnpm@…",
    "scripts": {
        "build": "pnpm -C assets run build",
        "test": "pnpm -C assets run test",
        "lint": "eslint ."
    },
    "devDependencies": {
        "@antfu/eslint-config": "…",
        "eslint": "…"
    }
}
```
Shared JS lint/format tooling + orchestration only; the publishable deps live in `assets/package.json`. Exact devDep split: the lint stack (`@antfu/eslint-config`, `eslint`) sits at root (it lints `assets/**`); everything else (`tsdown`, `vitest`, `vite`, `@rsbuild/core`, `@rspack/core`, `@types/node`, `typescript`, `jsdom`, `tsx`, `nodemon`, `@hotwired/stimulus`) moves to `assets/`.

### `pnpm-workspace.yaml`
`packages: [assets, playground]` (plus the existing `allowBuilds`/`onlyBuiltDependencies`/`minimumReleaseAgeExclude` blocks, kept).

### `eslint.config.js`
Stays at root. Update ignore globs: `assets/test/fixtures/**` (was `test/fixtures/**`), keep `playground/**`, `docs/**`, add `vendor/**`. The README markdown-code lint glob stays.

## Component 4 — CI (`.github/workflows/ci.yml`)

Keep the `concurrency` + `cancel-in-progress` block. Two job groups:
- **JS** — `lint` (root `eslint .`) and `test` (matrix `ubuntu`/`windows`/`macos`, `fail-fast: false`) running the `assets` package's build + test via the workspace (`pnpm -C assets …` or `pnpm --filter`).
- **PHP** — `composer validate --strict`, then a matrix `{ php: [8.4], symfony: [7.4.*, 8.0.*] }` running `composer install` + `phpunit`, plus `phpstan analyse` and `php-cs-fixer fix --dry-run --diff`.

## Migration mechanics + verification

1. `git mv` the JS `src/`, `test/`, and the three JS config files into `assets/`.
2. Split `package.json`: create `assets/package.json` (renamed `@symfony/reprise`) and rewrite root `package.json` as the private workspace root.
3. Create the PHP files (composer.json, .symfony.bundle.yaml, src/RepriseBundle.php, tests/, QA configs).
4. Update `pnpm-workspace.yaml`, `eslint.config.js`, `.gitignore` (`/vendor`, `/composer.lock` decision), CI.
5. Rebrand: `@kocal/unplugin-symfony` -> `@symfony/reprise` across README (done), AGENTS.md/CLAUDE.md path references (`src/` -> `assets/src/`, etc.), docs.

**Verification (the whole restructure is "done" when):**
- `pnpm install` at root links `assets` + `playground`; `pnpm -C assets run test` is green (the JS suite, unchanged, passes from its new home); `eslint .` is clean; `pnpm -C assets run build` emits `assets/dist`.
- `composer install` at root works; `vendor/bin/phpunit` boots the bundle test green; `phpstan` + `php-cs-fixer --dry-run` pass.
- The playground still builds against `../assets/src` (its Vite/Rsbuild configs import the plugin from the moved path).

## Open edge cases (decide during implementation)

- `.gitignore`: track `composer.lock` (bundles usually don't) vs ignore. Recommendation: ignore it (library convention).
- Playground config imports: `playground/vite.config.ts` / `rsbuild.config.ts` currently import from `../src/vite` etc. -> update to `../assets/src/vite`.
- Whether the root `package.json` keeps the `packageManager` field (yes) and any `pnpm.onlyBuiltDependencies` (those live in `pnpm-workspace.yaml` already).
