# Docs migration + release pipeline + CI hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the user docs to `doc/index.rst`, mark the bundle experimental, harden the GitHub Actions surface (SHA-pin + scoped permissions + Zizmor), and add a lean tag-triggered npm release workflow.

**Architecture:** Documentation-and-CI only — no PHP/JS product code changes. `README.md` shrinks to a Symfony-style teaser; the full usage doc moves to `doc/index.rst` (RST, the format `.symfony.bundle.yaml`'s `doc_dir: doc` expects). Existing `ci.yml` is rewritten in place with the same jobs but pinned actions and least-privilege permissions. Two new workflows are added: `zizmor.yaml` (security scanning, mirrors Symfony UX) and `release-on-npm.yaml` (install/build/publish via OIDC provenance, mirrors Symfony UX minus the branch/clean-tree checks).

**Tech Stack:** reStructuredText (Symfony docs), GitHub Actions, Zizmor, pnpm workspaces, npm OIDC trusted publishing.

## Global Constraints

- **Commit style (verbatim convention):** Symfony style `[<Scope>] <Short description>` — PascalCase scope, imperative mood, capitalized first word, no trailing period. NOT Conventional Commits. E.g. `[Docs] Move usage documentation to doc/index.rst`.
- **Experimental notice (verbatim text):** `**EXPERIMENTAL** This bundle is experimental and is likely to change, or even change drastically.`
- **Action pinning:** every `uses:` is a 40-hex commit SHA with a trailing `# vX.Y.Z` version comment. Pinned versions (resolved 2026-07-10):

  | Action | Version | SHA |
  |---|---|---|
  | `actions/checkout` | v7.0.0 | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
  | `pnpm/action-setup` | v6.0.9 | `0ebf47130e4866e96fce0953f49152a61190b271` |
  | `actions/setup-node` | v6.4.0 | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
  | `shivammathur/setup-php` | 2.37.2 | `f3e473d116dcccaddc5834248c87452386958240` |
  | `ramsey/composer-install` | 4.0.0 | `65e4f84970763564f46a70b8a54b90d033b3bdda` |
  | `zizmorcore/zizmor-action` | v0.5.7 | `192e21d79ab29983730a13d1382995c2307fbcaa` |

- **Least privilege:** every workflow sets top-level `permissions: {}` and grants each job only what it needs. Every `actions/checkout` sets `persist-credentials: false`.
- **`assets/dist/` stays git-ignored** — no clean-tree check in the release workflow (would be a no-op; see spec).
- **Release auth:** OIDC trusted publishing + provenance (no `NPM_TOKEN`). Requires an npm trusted publisher configured out-of-band (see "Manual follow-ups").

---

### Task 1: Migrate the documentation to `doc/index.rst` and slim `README.md`

Docs only. Deliverable: `doc/index.rst` holds the full usage documentation with the experimental notice; `README.md` is a teaser pointing at it.

**Files:**
- Create: `doc/index.rst`
- Rewrite: `README.md`

- [ ] **Step 1: Create `doc/index.rst`** with the migrated content

```rst
Symfony Reprise
===============

**EXPERIMENTAL** This bundle is experimental and is likely to change,
or even change drastically.

Webpack Encore gave Symfony first-class asset integration for Webpack.
Symfony Reprise gives you the same integration for `Vite`_ and `Rsbuild`_.

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**,
**JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**,
**minification** and **HMR** on their own, so Symfony Reprise does not
reimplement any of that. It only covers the Symfony-side integration that
bundlers do not provide out of the box:

- Multiple entries
- ``entrypoints.json`` generation (build and dev-server modes)
- ``manifest.json`` generation
- Asset versioning wired into the manifest
- CDN support (absolute ``publicPath``) *(planned)*
- Dev server and HMR integration
- Subresource Integrity (SRI) hashes *(planned)*
- Shared runtime chunk across entries *(planned)*
- Symfony UX / Stimulus controllers (``controllers.json`` and local
  ``assets/controllers/``)

Installation
------------

Install the bundle with Composer and Symfony Flex:

.. code-block:: terminal

    $ composer require symfony/reprise

Then install the npm package that ships the Vite and Rsbuild plugin:

.. code-block:: terminal

    $ npm install @symfony/reprise --save-dev

Vite
----

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      plugins: [
        Symfony({ /* options */ }),
      ],
    })

Rsbuild
-------

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      plugins: [Symfony({ /* options */ })],
    })

Symfony UX / Stimulus controllers
---------------------------------

This is the Vite/Rsbuild counterpart of what `@symfony/stimulus-bridge`_ did
for Webpack Encore: it turns your ``controllers.json`` into a Stimulus
application, with the same enable step, same helper, same local-controllers
convention.

Enable it by pointing the plugin at your ``controllers.json`` (this is what
turns the feature on):

.. code-block:: javascript

    Symfony({ stimulus: 'assets/controllers.json' })
    // or, to override the local controllers dir:
    Symfony({ stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/controllers' } })

Then start the app from your entry:

.. code-block:: javascript

    import { startStimulusApp } from '@symfony/reprise/stimulus'

    const app = startStimulusApp()

**Local controllers.** Any ``assets/controllers/*_controller.{js,ts}`` is
registered automatically. The filename becomes the identifier
(``hello_controller.js`` becomes ``hello``, ``admin/user_controller.js``
becomes ``admin--user``). To load a controller on demand, put a
``stimulusFetch: 'lazy'`` comment directly above the class (after the
imports) — a block or a single-line comment both work:

.. code-block:: javascript

    import { Controller } from '@hotwired/stimulus'

    /* stimulusFetch: 'lazy' */
    export default class extends Controller {}

(``// stimulusFetch: 'lazy'`` on the line above the class works too. The
marker only counts directly above the class, not above the imports.)

**Third-party UX packages.** Controllers declared in ``controllers.json`` are
resolved from ``node_modules``, so install them with your package manager, the
same as you would with Webpack Encore (AssetMapper instead vendors them via
importmap):

.. code-block:: terminal

    $ npm install @hotwired/stimulus @symfony/ux-turbo @symfony/ux-leaflet-map

Some packages need a bit of bundler-specific setup on top, the same way they
did under Webpack Encore. UX Leaflet Map, for instance, ships a CSS file meant
for Webpack's loader and needs an alias to the plain CSS build:

.. code-block:: javascript

    // vite.config.ts
    export default defineConfig({
      resolve: {
        alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
        },
      },
    })

Check each package's own docs for this kind of tweak.

.. _Vite: https://vite.dev/
.. _Rsbuild: https://rsbuild.dev/
.. _`@symfony/stimulus-bridge`: https://github.com/symfony/stimulus-bridge
```

- [ ] **Step 2: Rewrite `README.md`** as a teaser pointing at the doc

```markdown
# Symfony Reprise

[![npm version](https://img.shields.io/npm/v/@symfony%2Freprise?color=crimson&label=)](https://www.npmjs.com/package/@symfony/reprise)
[![npm downloads](https://img.shields.io/npm/dm/@symfony%2Freprise?color=crimson&label=)](https://www.npmjs.com/package/@symfony/reprise)
[![license](https://img.shields.io/npm/l/@symfony%2Freprise?color=crimson&label=)](https://www.npmjs.com/package/@symfony/reprise)

**EXPERIMENTAL** This bundle is experimental and is likely to change, or even change drastically.

Webpack Encore gave Symfony first-class asset integration for Webpack. Symfony Reprise gives you the same integration for **Vite** and **Rsbuild**.

[Read the documentation](doc/index.rst)
```

- [ ] **Step 3: Verify the docs**

```bash
test -f doc/index.rst || { echo "doc/index.rst missing"; exit 1; }
grep -q '^\*\*EXPERIMENTAL\*\*' doc/index.rst || { echo "notice missing in doc"; exit 1; }
grep -q '^\*\*EXPERIMENTAL\*\*' README.md || { echo "notice missing in README"; exit 1; }
for needle in "@symfony/reprise/vite" "@symfony/reprise/rsbuild" "@symfony/reprise/stimulus" "composer require symfony/reprise" "stimulusFetch: 'lazy'" "leaflet/dist/leaflet.css"; do
  grep -qF "$needle" doc/index.rst || { echo "missing in doc: $needle"; exit 1; }
done
grep -qF "Read the documentation](doc/index.rst)" README.md || { echo "doc link missing in README"; exit 1; }
echo "docs OK"
```
Expected: `docs OK`. (Optional, if `python3` + `docutils` are available: `python3 -m docutils doc/index.rst /dev/null` renders with no errors.)

- [ ] **Step 4: Commit**

```bash
git add doc/index.rst README.md
git commit -m "[Docs] Move usage documentation to doc/index.rst"
```

---

### Task 2: Harden `ci.yml` (pin actions, scope permissions, drop credential persistence)

Same jobs, matrices and commands as today. Security-only rewrite. Deliverable: every `uses:` is SHA-pinned with a version comment, every checkout has `persist-credentials: false`, top-level and per-job permissions are least-privilege.

**Files:**
- Rewrite: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace `.github/workflows/ci.yml`** with

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

permissions: {}

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
      - name: Set node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm run lint

  test:
    runs-on: ${{ matrix.os }}
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
      - name: Set node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm build
      - name: Test
        run: pnpm test

  php:
    name: PHP ${{ matrix.php-version }} + Symfony ${{ matrix.symfony-version }}${{ matrix.dependency-version == 'lowest' && ' lowest' || '' }} on ${{ matrix.os || 'ubuntu-latest' }}
    runs-on: ${{ matrix.os || 'ubuntu-latest' }}
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        include:
          # Symfony 7.4 LTS on the lowest supported PHP, resolving the lowest allowed dependencies.
          - php-version: '8.4'
            symfony-version: 7.4.*
            dependency-version: lowest
          - php-version: '8.4'
            symfony-version: 8.0.*
          - php-version: '8.5'
            symfony-version: 7.4.*
          - php-version: '8.5'
            symfony-version: 8.0.*

          # Windows
          - php-version: '8.4'
            symfony-version: 7.4.*
            os: windows-latest
          - php-version: '8.5'
            symfony-version: 8.1.*
            os: windows-latest
    env:
      # symfony/flex (installed as a global tool below) reads SYMFONY_REQUIRE and forces every
      # symfony/* package to this version during the Composer resolution.
      SYMFONY_REQUIRE: ${{ matrix.symfony-version }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Setup PHP
        uses: shivammathur/setup-php@f3e473d116dcccaddc5834248c87452386958240 # 2.37.2
        with:
          php-version: ${{ matrix.php-version }}
          tools: flex
      - name: Install dependencies
        uses: ramsey/composer-install@65e4f84970763564f46a70b8a54b90d033b3bdda # 4.0.0
        with:
          dependency-versions: ${{ matrix.dependency-version == 'lowest' && 'lowest' || 'highest' }}
          composer-options: --prefer-dist
          custom-cache-suffix: ${{ matrix.symfony-version }}
      - name: PHPUnit
        run: vendor/bin/phpunit

  php-qa:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Setup PHP
        uses: shivammathur/setup-php@f3e473d116dcccaddc5834248c87452386958240 # 2.37.2
        with:
          php-version: '8.4'
          tools: composer:v2
      - name: Validate composer.json
        run: composer validate --strict
      - name: Install dependencies
        uses: ramsey/composer-install@65e4f84970763564f46a70b8a54b90d033b3bdda # 4.0.0
        with:
          dependency-versions: highest
          composer-options: --prefer-dist
      - name: PHPStan
        run: vendor/bin/phpstan analyse
      - name: PHP-CS-Fixer
        run: vendor/bin/php-cs-fixer fix --dry-run --diff
```

- [ ] **Step 2: Verify YAML validity and the hardening invariants**

```bash
# Valid YAML (yq exits non-zero on parse error). Falls back to python3 if yq is absent.
(command -v yq >/dev/null && yq '.' .github/workflows/ci.yml >/dev/null) \
  || python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" \
  || { echo "ci.yml is not valid YAML"; exit 1; }

# Every `uses:` is pinned to a 40-hex SHA.
if grep -nE '^\s*(- )?uses:' .github/workflows/ci.yml | grep -vE '@[0-9a-f]{40} '; then
  echo "unpinned action above"; exit 1
fi

# One persist-credentials:false per checkout (4 jobs, 4 checkouts).
checkouts=$(grep -c 'actions/checkout@' .github/workflows/ci.yml)
pcfalse=$(grep -c 'persist-credentials: false' .github/workflows/ci.yml)
[ "$checkouts" = "$pcfalse" ] || { echo "checkout/persist-credentials mismatch: $checkouts vs $pcfalse"; exit 1; }

# Top-level empty permissions + one per job.
grep -q '^permissions: {}' .github/workflows/ci.yml || { echo "missing top-level permissions"; exit 1; }
echo "ci.yml hardening OK"
```
Expected: `ci.yml hardening OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "[CI] Pin actions to commit SHAs and scope workflow permissions"
```

---

### Task 3: Add the Zizmor security-scanning workflow

Deliverable: a standalone workflow that runs Zizmor on `main` pushes and every PR, mirroring Symfony UX.

**Files:**
- Create: `.github/workflows/zizmor.yaml`

- [ ] **Step 1: Create `.github/workflows/zizmor.yaml`**

```yaml
name: Zizmor GitHub Actions security analysis

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - '**'

permissions: {}

jobs:
  zizmor:
    name: Run Zizmor
    runs-on: ubuntu-latest
    permissions:
      security-events: write # Required for zizmor-action to upload the SARIF report.
      contents: read # Needed to clone the repo (private repos).
      actions: read # Needed for upload-sarif to read workflow run info (private repos).
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Run Zizmor
        uses: zizmorcore/zizmor-action@192e21d79ab29983730a13d1382995c2307fbcaa # v0.5.7
```

- [ ] **Step 2: Verify**

```bash
(command -v yq >/dev/null && yq '.' .github/workflows/zizmor.yaml >/dev/null) \
  || python3 -c "import yaml;yaml.safe_load(open('.github/workflows/zizmor.yaml'))" \
  || { echo "zizmor.yaml is not valid YAML"; exit 1; }
grep -qE 'zizmorcore/zizmor-action@[0-9a-f]{40} ' .github/workflows/zizmor.yaml || { echo "zizmor action unpinned"; exit 1; }
echo "zizmor.yaml OK"
```
Expected: `zizmor.yaml OK`. (If Zizmor is installed locally, `zizmor .github/workflows` should report no findings above its default threshold — the Task 2 hardening is what makes it clean.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/zizmor.yaml
git commit -m "[CI] Add Zizmor GitHub Actions security scanning"
```

---

### Task 4: Add the `release-on-npm` workflow

Deliverable: a tag-triggered workflow that installs, builds and publishes `@symfony/reprise` to npm with OIDC provenance. Three steps only (install / build / publish); no branch-ancestor or clean-tree checks.

**Files:**
- Create: `.github/workflows/release-on-npm.yaml`

- [ ] **Step 1: Create `.github/workflows/release-on-npm.yaml`**

```yaml
name: Release on npm

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  id-token: write # OIDC token for npm trusted publishing.
  contents: read

concurrency:
  group: release-on-npm-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          ref: ${{ github.ref }}
          persist-credentials: false
          fetch-depth: 0

      - run: npm i -g corepack && corepack enable

      # actions/setup-node v6.4.0. No `cache:` input is set, so the cache-poisoning
      # audit does not apply here; the annotation keeps Zizmor quiet on release runs.
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # zizmor: ignore[cache-poisoning]
        with:
          registry-url: 'https://registry.npmjs.org'
          node-version-file: .nvmrc

      # npm >= 11.5.1 is required for OIDC trusted publishing. Pinned explicitly to
      # avoid pulling a compromised "latest" at release time; bump via a dedicated PR.
      - run: npm install -g npm@11.16.0

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Publish on npm
        run: pnpm publish --recursive --access public --no-git-checks --provenance
```

- [ ] **Step 2: Verify**

```bash
(command -v yq >/dev/null && yq '.' .github/workflows/release-on-npm.yaml >/dev/null) \
  || python3 -c "import yaml;yaml.safe_load(open('.github/workflows/release-on-npm.yaml'))" \
  || { echo "release-on-npm.yaml is not valid YAML"; exit 1; }
# Triggers only on version tags, not push/PR branches.
grep -q "tags:" .github/workflows/release-on-npm.yaml || { echo "missing tag trigger"; exit 1; }
grep -q "id-token: write" .github/workflows/release-on-npm.yaml || { echo "missing OIDC permission"; exit 1; }
grep -q -- "--provenance" .github/workflows/release-on-npm.yaml || { echo "missing provenance"; exit 1; }
# No clean-tree check (intentionally dropped).
grep -q "git diff --quiet" .github/workflows/release-on-npm.yaml && { echo "unexpected clean-tree check"; exit 1; }
echo "release-on-npm.yaml OK"
```
Expected: `release-on-npm.yaml OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-on-npm.yaml
git commit -m "[CI] Add release-on-npm workflow"
```

---

## Manual follow-ups (NOT automated — maintainer action, outside the repo)

These are required for the pipeline and repo protection to work but cannot be committed. The executor must surface them to the maintainer at the end (also captured as a Claude memory):

- [ ] **npm trusted publisher** — on npmjs.com, add a trusted publisher for `@symfony/reprise` pointing at the `release-on-npm.yaml` workflow in `symfony/reprise`. **Blocks the first release** — the OIDC publish step cannot authenticate without it.
- [ ] **GitHub branch ruleset** — protect `main` (require PR + passing CI, block force-push/deletion).
- [ ] **GitHub tag ruleset** — protect `v*` tags (restrict creation/deletion, block force-push).
- [ ] **GitHub immutable releases** — enable the immutable-releases setting so published releases/tags cannot be silently rewritten.

## Notes for the executor

- **No PHP/JS runtime is required.** Tasks 1-4 only create/rewrite docs and YAML. Verification steps are self-contained shell (grep/yq); no `pnpm`/`composer` install needed to land the files. The workflows are exercised for real only once pushed to GitHub.
- **`yq` vs `python3`** — the verify steps try `yq` first, fall back to `python3 -c 'import yaml'`. If neither is installed, eyeball the YAML; do not fake a green check.
- **Major action bumps** (`setup-node` v4→v6, `pnpm/action-setup` v4→v6, `composer-install` v3→v4) — the inputs used here are unchanged across those majors, but the real proof is a green CI run on the PR. If a bump breaks a job, re-pin that action to the latest SHA of its previous major and keep the rest.
- **Commit messages** use Symfony style (`[Scope] ...`), not Conventional Commits — see Global Constraints.
- After all tasks: open a PR from `feat/docs-release-ci-hardening`; a green CI run (with the new pinned actions) plus a clean Zizmor job is the gate. The `release-on-npm` workflow will not run until a `v*.*.*` tag is pushed.
