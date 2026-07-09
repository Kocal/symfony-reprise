# Reprise Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this JS-only repo into a monorepo — a Symfony bundle (`symfony/reprise`, empty skeleton) at the root, the JS plugin moved to `assets/` and renamed `@symfony/reprise`.

**Architecture:** The repo root becomes the Composer package (PHP bundle) AND the pnpm workspace root. The existing JS plugin (`src/`, `test/`, its build/test configs) moves verbatim into `assets/`, keeping its behaviour; only the package name changes (`@kocal/unplugin-symfony` -> `@symfony/reprise`). A minimal `AbstractBundle` skeleton with a boot smoke-test proves the bundle installs. No PHP consumer logic yet.

**Tech Stack:** pnpm workspaces, tsdown + vitest (JS, unchanged), Composer, Symfony bundle (`AbstractBundle`), PHPUnit 11/12, PHPStan, PHP-CS-Fixer.

## Global Constraints

- Frozen names: npm `@symfony/reprise`; Composer `symfony/reprise` (`type: symfony-bundle`); PHP namespace `Symfony\Reprise\` (tests `Symfony\Reprise\Tests\`); Bundle class `Symfony\Reprise\RepriseBundle`; DI key `reprise` (reserved, unused yet).
- Descriptions (verbatim): npm = `Symfony asset integration for Vite and Rsbuild, a reprise of Webpack Encore.`; Composer = `Integrate Vite and Rsbuild with Symfony, a reprise of Webpack Encore Bundle.`
- PHP `>=8.4`. Symfony `^7.4|^8.0` (in `require-dev` only for now — the empty bundle has no Symfony runtime dependency).
- The JS plugin's behaviour must not change: `src/`/`test/` move verbatim; only the package name and internal `@kocal/unplugin-symfony` references change to `@symfony/reprise`.
- `.npmrc` already sets `shamefully-hoist=true` (all workspace deps hoist to root `node_modules`), so root `eslint` finds TS tooling installed under `assets`.
- Commit signing is disabled locally for this run (`commit.gpgsign=false`); a plain `git commit` works. Every commit ends with the trailer `Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc`.

---

### Task 1: Relocate the JS package into `assets/` and make the root a private workspace

This is one atomic move — the repo only builds again once every part is done. No TDD (a move, not new logic); the deliverable is "the existing JS suite passes from its new home + lint + build are green".

**Files:**
- Move: `src/` -> `assets/src/`, `test/` -> `assets/test/`, `tsdown.config.ts` -> `assets/tsdown.config.ts`, `vitest.config.ts` -> `assets/vitest.config.ts`, `tsconfig.json` -> `assets/tsconfig.json`
- Create: `assets/package.json`
- Rewrite: `package.json` (root), `pnpm-workspace.yaml`, `eslint.config.js`, `.gitignore`
- Modify: `playground/vite.config.ts:5`, `playground/rsbuild.config.ts:4`, plus `@kocal/unplugin-symfony` references under `playground/` and `assets/test/`

- [ ] **Step 1: Move the JS source, tests and configs with `git mv`**

```bash
cd /Users/kocal/workspace/symfony/unplugin-symfony
mkdir -p assets
git mv src assets/src
git mv test assets/test
git mv tsdown.config.ts assets/tsdown.config.ts
git mv vitest.config.ts assets/vitest.config.ts
git mv tsconfig.json assets/tsconfig.json
```

`assets/tsdown.config.ts` (`entry: ['src/*.ts']`), `assets/vitest.config.ts` (`include: ['test/**']`, alias `./test/fixtures/virtual-controllers.ts`) and `assets/tsconfig.json` all use paths relative to their own dir, so they need NO edits after the move.

- [ ] **Step 2: Create `assets/package.json`** (the published npm package — the JS half of the old root `package.json`, renamed)

```json
{
  "name": "@symfony/reprise",
  "type": "module",
  "version": "0.1.0",
  "description": "Symfony asset integration for Vite and Rsbuild, a reprise of Webpack Encore.",
  "license": "MIT",
  "homepage": "https://github.com/symfony/reprise#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/symfony/reprise.git",
    "directory": "assets"
  },
  "bugs": {
    "url": "https://github.com/symfony/reprise/issues"
  },
  "keywords": [
    "symfony",
    "vite",
    "rsbuild",
    "encore",
    "assets"
  ],
  "exports": {
    ".": "./dist/index.mjs",
    "./rsbuild": "./dist/rsbuild.mjs",
    "./stimulus": "./dist/stimulus.mjs",
    "./types": "./dist/types.mjs",
    "./vite": "./dist/vite.mjs",
    "./package.json": "./package.json"
  },
  "main": "./dist/index.mjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "typesVersions": {
    "*": {
      "*": [
        "./dist/*",
        "./*"
      ]
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown -w",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "tsdown"
  },
  "peerDependencies": {
    "@hotwired/stimulus": ">=3",
    "@rsbuild/core": ">=1",
    "vite": ">=3"
  },
  "peerDependenciesMeta": {
    "@hotwired/stimulus": { "optional": true },
    "@rsbuild/core": { "optional": true },
    "vite": { "optional": true }
  },
  "dependencies": {
    "unplugin": "^2.3.4"
  },
  "devDependencies": {
    "@hotwired/stimulus": "^3.2.2",
    "@rsbuild/core": "^2.1.5",
    "@rspack/core": "~2.1.3",
    "@types/node": "^26.1.0",
    "jsdom": "^29.1.1",
    "nodemon": "^3.1.14",
    "tsdown": "^0.22.3",
    "tsx": "^4.23.0",
    "typescript": "^6.0.3",
    "vite": "^8.1.3",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 3: Rewrite the root `package.json`** as the private workspace root (lint tooling + orchestration only)

```json
{
  "name": "reprise-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.10.0+sha512.0b7f8b98060031904c017e3a41eb187a16d40eeb829b95c4f8cb03681761fc4ab53dd219115b9b447f4dce1a05a214764461e7d3703392a9f32f9511ce8c86c8",
  "scripts": {
    "build": "pnpm -C assets run build",
    "dev": "pnpm -C assets run dev",
    "test": "pnpm -C assets run test",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@antfu/eslint-config": "^9.1.0",
    "eslint": "^10.6.0"
  }
}
```

- [ ] **Step 4: Point the workspace at `assets`** — edit `pnpm-workspace.yaml`, changing only the `packages:` list (keep the `allowBuilds`, `minimumReleaseAgeExclude`, `onlyBuiltDependencies` blocks exactly as they are):

```yaml
packages:
  - assets
  - playground
```

- [ ] **Step 5: Update `eslint.config.js` ignore globs** — replace `'test/fixtures/**'` with `'assets/test/fixtures/**'` and add `'vendor/**'`:

```js
    ignores: [
      // playground/ is a fixture Symfony app (vendored + generated files); not library source.
      'playground/**',
      // assets/test/fixtures/ holds sample app code built by integration tests; not library source.
      'assets/test/fixtures/**',
      // docs/ holds design specs + implementation plans; their fenced code blocks are illustrative, not source.
      'docs/**',
      // vendor/ is Composer's PHP dependencies.
      'vendor/**',
    ],
```

- [ ] **Step 6: Update `.gitignore`** — the fixture-node_modules un-ignore paths moved under `assets/`, and add PHP ignores. Replace the two `!test/fixtures/**/node_modules/*` lines with the `assets/`-prefixed versions, and append the PHP block:

```gitignore
# Test fixtures ship fake node_modules packages on purpose:
# the Stimulus generator resolves them via require(`<pkg>/package.json`).
!assets/test/fixtures/**/node_modules/
!assets/test/fixtures/**/node_modules/**

!playground/.env

# Composer (PHP bundle)
/vendor/
/composer.lock
```

- [ ] **Step 7: Rename `@kocal/unplugin-symfony` -> `@symfony/reprise` in the moved fixtures and the playground, and fix the playground plugin import paths**

```bash
# runtime import in the moved integration/e2e fixtures + the playground app code
grep -rl '@kocal/unplugin-symfony' assets/test playground | xargs sed -i '' 's#@kocal/unplugin-symfony#@symfony/reprise#g'
# playground bundler configs import the plugin straight from source, now under assets/
sed -i '' "s#'\.\./src/vite'#'../assets/src/vite'#" playground/vite.config.ts
sed -i '' "s#'\.\./src/rsbuild'#'../assets/src/rsbuild'#" playground/rsbuild.config.ts
```

Then verify no stale references remain:

```bash
grep -rn '@kocal/unplugin-symfony\|\.\./src/vite\|\.\./src/rsbuild' assets playground | grep -v node_modules
```
Expected: no output.

- [ ] **Step 8: Reinstall the workspace** (the root `package.json` changed shape, so the lockfile must be regenerated — do NOT use `--frozen-lockfile`)

Run: `pnpm install`
Expected: succeeds; `assets` and `playground` are linked as workspace packages.

- [ ] **Step 9: Verify the JS suite, lint and build are green from the new layout** (root scripts delegate to `assets`)

```bash
pnpm test
```
Expected: `Test Files 14 passed (14)`, `Tests 66 passed (66)`. (Root `test` -> `pnpm -C assets run test` -> `vitest run`.)

```bash
pnpm run lint
```
Expected: clean (exit 0).

```bash
pnpm build
```
Expected: succeeds; `assets/dist/` contains `index.mjs`, `vite.mjs`, `rsbuild.mjs`, `stimulus.mjs`, `types.mjs` and their `.d.mts`. (Root `build` -> `pnpm -C assets run build` -> `tsdown`.)

(These root scripts work once Step 8's `pnpm install` has synced the lockfile. If pnpm's workspace deps pre-check ever trips on a stale lockfile, re-run `pnpm install`, not `--frozen-lockfile`.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move the JS plugin into assets/ and make the root a pnpm workspace

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 2: Symfony bundle skeleton + Composer + boot smoke-test

**Files:**
- Create: `composer.json`, `.symfony.bundle.yaml`, `src/RepriseBundle.php`, `tests/RepriseBundleTest.php`, `phpunit.dist.xml`

**Interfaces:**
- Produces: `Symfony\Reprise\RepriseBundle` (extends `AbstractBundle`), autoloaded PSR-4 from `src/`; a PHPUnit suite over `tests/`.

- [ ] **Step 1: Create `composer.json`**

```json
{
    "name": "symfony/reprise",
    "type": "symfony-bundle",
    "description": "Integrate Vite and Rsbuild with Symfony, a reprise of Webpack Encore Bundle.",
    "license": "MIT",
    "keywords": ["symfony", "vite", "rsbuild", "assets", "encore"],
    "authors": [
        { "name": "Hugo Alliaume", "email": "hugo@alliau.me" }
    ],
    "require": {
        "php": ">=8.4"
    },
    "require-dev": {
        "symfony/framework-bundle": "^7.4|^8.0",
        "symfony/http-kernel": "^7.4|^8.0",
        "symfony/filesystem": "^7.4|^8.0",
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

- [ ] **Step 2: Create the bundle class** `src/RepriseBundle.php`

```php
<?php

namespace Symfony\Reprise;

use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

final class RepriseBundle extends AbstractBundle
{
}
```

- [ ] **Step 3: Create `.symfony.bundle.yaml`**

```yaml
branches: ['main']
maintained_branches: ['main']
doc_dir: 'doc'
```

- [ ] **Step 4: Create `phpunit.dist.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         failOnDeprecation="true"
         failOnWarning="true">
    <testsuites>
        <testsuite name="Reprise Test Suite">
            <directory>tests</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>src</directory>
        </include>
    </source>
</phpunit>
```

- [ ] **Step 5: Write the failing boot test** `tests/RepriseBundleTest.php`

```php
<?php

namespace Symfony\Reprise\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Loader\LoaderInterface;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Reprise\RepriseBundle;

final class RepriseBundleTest extends TestCase
{
    public function testBundleBootsInAKernel(): void
    {
        $kernel = new class('test', true) extends Kernel {
            public function registerBundles(): iterable
            {
                return [new RepriseBundle()];
            }

            public function registerContainerConfiguration(LoaderInterface $loader): void
            {
            }

            public function getProjectDir(): string
            {
                return sys_get_temp_dir().'/reprise-test';
            }
        };

        $kernel->boot();

        self::assertArrayHasKey('RepriseBundle', $kernel->getBundles());

        $kernel->shutdown();
        (new Filesystem())->remove($kernel->getProjectDir());
    }
}
```

- [ ] **Step 6: Install Composer deps and run the test to see it pass**

```bash
composer install
```
Expected: installs symfony/framework-bundle, phpunit, etc. into `vendor/`.

```bash
vendor/bin/phpunit
```
Expected: PASS — `OK (1 test, 1 assertion)`. (The test proves the PSR-4 autoload resolves `RepriseBundle` and the bundle boots in a real kernel. Before `composer install` + the bundle class exist, it errors with class-not-found — that is the RED state.)

- [ ] **Step 7: Commit**

```bash
git add composer.json .symfony.bundle.yaml src tests phpunit.dist.xml
git commit -m "feat: add the RepriseBundle skeleton (installable, boots in a kernel)

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 3: PHP quality tooling (PHPStan + PHP-CS-Fixer)

**Files:**
- Create: `phpstan.dist.neon`, `.php-cs-fixer.dist.php`

**Interfaces:**
- Consumes: `phpstan/phpstan` and `friendsofphp/php-cs-fixer` (already in `composer.json` `require-dev` from Task 2, installed in `vendor/`).

- [ ] **Step 1: Create `phpstan.dist.neon`** (analyse `src/` at the strictest level — the empty bundle passes trivially; `tests/` is excluded because the anonymous test kernel uses framework internals PHPStan can't fully model without the Symfony extension)

```neon
parameters:
    level: max
    paths:
        - src
```

- [ ] **Step 2: Run PHPStan to verify it passes**

Run: `vendor/bin/phpstan analyse`
Expected: `[OK] No errors`.

- [ ] **Step 3: Create `.php-cs-fixer.dist.php`** (the Symfony ruleset over `src/` and `tests/`)

```php
<?php

$finder = (new PhpCsFixer\Finder())
    ->in(__DIR__.'/src')
    ->in(__DIR__.'/tests');

return (new PhpCsFixer\Config())
    ->setRiskyAllowed(true)
    ->setRules([
        '@Symfony' => true,
        '@Symfony:risky' => true,
    ])
    ->setFinder($finder);
```

- [ ] **Step 4: Run PHP-CS-Fixer; apply any fixes it wants, then confirm it is clean**

```bash
vendor/bin/php-cs-fixer fix
vendor/bin/php-cs-fixer fix --dry-run --diff
```
Expected: the second command exits 0 with no diff (the `src/` + `tests/` files already follow, or now follow, the `@Symfony` ruleset).

- [ ] **Step 5: Re-run PHPUnit to confirm the fixer didn't break the test**

Run: `vendor/bin/phpunit`
Expected: PASS — `OK (1 test, 1 assertion)`.

- [ ] **Step 6: Commit**

```bash
git add phpstan.dist.neon .php-cs-fixer.dist.php src tests
git commit -m "chore: add PHPStan + PHP-CS-Fixer config for the bundle

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 4: CI — rescope the JS jobs to `assets`, add PHP jobs

**Files:**
- Rewrite: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `assets` workspace scripts (Task 1) and the Composer scripts/tools (Tasks 2-3).

- [ ] **Step 1: Rewrite `.github/workflows/ci.yml`** (keep the existing `concurrency` block; JS jobs now target `assets`; add a PHP group)

```yaml
name: CI

on:
  push:
    branches:
      - main

  pull_request:
    branches:
      - main

# Cancel any in-progress run for the same ref (branch/PR) when a new commit is pushed.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - name: Setup
        run: npm i -g @antfu/ni
      - name: Install
        run: nci
      - name: Lint
        run: nr lint

  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        node: [lts/*]
        os: [ubuntu-latest, windows-latest, macos-latest]
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - name: Set node ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Setup
        run: npm i -g @antfu/ni
      - name: Install
        run: nci
      - name: Build
        run: pnpm build
      - name: Test
        run: pnpm test

  php:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        symfony: ['7.4.*', '8.0.*']
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          tools: composer:v2
      - name: Validate composer.json
        run: composer validate --strict
      - name: Restrict Symfony version
        run: composer require --no-update --dev "symfony/framework-bundle:${{ matrix.symfony }}" "symfony/http-kernel:${{ matrix.symfony }}"
      - name: Install
        run: composer update --prefer-dist --no-progress
      - name: PHPUnit
        run: vendor/bin/phpunit

  php-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          tools: composer:v2
      - name: Install
        run: composer install --prefer-dist --no-progress
      - name: PHPStan
        run: vendor/bin/phpstan analyse
      - name: PHP-CS-Fixer
        run: vendor/bin/php-cs-fixer fix --dry-run --diff
```

- [ ] **Step 2: Validate the workflow YAML locally**

```bash
node -e "const s=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); for (const k of ['cancel-in-progress','fail-fast: false','vendor/bin/phpunit','vendor/bin/phpstan','php-cs-fixer','pnpm build','pnpm test']) if(!s.includes(k)) throw new Error('missing '+k); console.log('ci.yml OK')"
```
Expected: `ci.yml OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: rescope JS jobs to assets/, add PHP jobs (phpunit matrix, phpstan, cs-fixer)

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 5: Rebrand the developer docs (AGENTS.md + path references)

**Files:**
- Modify: `AGENTS.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `AGENTS.md`** to reflect the new layout and name. Apply these edits:
  - Every `src/` path that refers to the JS plugin becomes `assets/src/` (e.g. `src/core/`, `src/collectors/`, `src/index.ts`, `src/vite.ts`, `src/rsbuild.ts`, `src/types.ts`) — the "Architecture" section and any inline references.
  - Every `test/` path referring to the JS tests becomes `assets/test/`.
  - Rename the project from `@kocal/unplugin-symfony` to `Reprise` / `@symfony/reprise` in the "What this is" heading and prose, framing it as the Symfony bundle (`symfony/reprise`) whose JS package lives in `assets/`.
  - The `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` command descriptions: note they now run from the root workspace and delegate to `assets` (build/dev/test) while `lint` runs at root over `assets/**`.
  - Add a short note that the repo is now a Composer bundle (`symfony/reprise`, PHP `src/`/`tests/`) plus the `assets/` npm package, tied by the pnpm workspace.

- [ ] **Step 2: Confirm no stale JS-at-root path references remain in AGENTS.md**

```bash
grep -nE '(^|[^a-z])src/(core|collectors|index|vite|rsbuild|types|stimulus)|(^|[^a-z])test/(core|collectors|integration)|@kocal/unplugin-symfony' AGENTS.md || echo "clean"
```
Expected: `clean` (all such references now carry the `assets/` prefix or the new name).

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for the monorepo layout and Reprise name

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

## Notes for the executor

- **Atomicity of Task 1:** do not commit between the `git mv` and the config rewrites — the repo does not build in between. Task 1 is green only once all of steps 1-9 are done.
- **pnpm frozen-lockfile:** the workspace pre-check can fail after `package.json` changes; Task 1 Step 8 uses plain `pnpm install` (regenerates the lockfile), after which the root `pnpm build`/`pnpm test`/`pnpm run lint` scripts work. If the pre-check still trips, re-run `pnpm install` (never `--frozen-lockfile`) rather than reaching for `exec`.
- **`sed -i ''`** is the BSD/macOS form (empty backup suffix). On Linux CI/agents use `sed -i` (no `''`). Adjust per platform.
- **PHP availability:** Tasks 2-4 need PHP 8.4 + Composer on the machine running them. If unavailable, implement the files and note that `composer install`/`phpunit`/`phpstan`/`php-cs-fixer` must be run where PHP 8.4 exists; do not fake green output.
- After the last task, the full gate is: `pnpm install` + `pnpm test` + `pnpm run lint` + `pnpm build` (JS) and `composer install` + `vendor/bin/phpunit` + `vendor/bin/phpstan analyse` + `vendor/bin/php-cs-fixer fix --dry-run` (PHP), all green.
