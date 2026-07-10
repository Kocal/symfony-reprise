# Design — Docs migration + release pipeline + CI hardening

Status: draft (2026-07-10)
Scope: user-facing documentation, GitHub Actions security hardening, and the npm release pipeline. No PHP/JS product code changes.

## Goal

Get `symfony/reprise` ready for public consumption and a first npm release, aligned with Symfony ecosystem conventions:

- Move the user documentation out of `README.md` into `doc/index.rst` (Symfony docs format, consumed by `doc_dir: doc` in `.symfony.bundle.yaml`), following the shape used by WebpackEncoreBundle and Symfony UX packages.
- Mark the package **experimental**, the way Symfony UX packages do.
- Harden the GitHub Actions surface: pin every action to a commit SHA, drop implicit credential persistence, scope permissions, and add a Zizmor security-scanning workflow.
- Add a lean "release on npm" workflow that mirrors Symfony UX (install / build / publish), triggered by a git tag the maintainer pushes manually.

## Non-goals (deferred / out of scope)

- **`.symfony.bundle.yaml`** — reviewed, already correct once `doc/` exists (`branches`/`maintained_branches: [main]`, `doc_dir: doc`). Left untouched.
- **PHP consumer docs** — the bundle is still an empty `AbstractBundle` skeleton (no `reprise_entry_*` Twig helpers, no `reprise` DI config yet). `doc/index.rst` documents current reality (the JS plugin) only; the WebpackEncoreBundle-style "Configuration" / Twig-tags section is a forward-looking TODO, not written now.
- **Publishing on symfony.com/doc** — the docs live in-repo (`doc/index.rst`, GitHub renders RST); no symfony.com wiring yet.
- **Version bumping automation** — the maintainer bumps `assets/package.json` and tags locally; the workflow only publishes what the tag points at.
- **Actually configuring GitHub / npm settings** — rulesets, immutable releases, and the npm trusted publisher are manual follow-ups (see below), not code this repo can carry.

## Manual follow-ups (outside the codebase — maintainer action required)

These are required for the release pipeline and repo protection to function, but cannot be committed to the repo. Tracked here and surfaced to the maintainer:

1. **npm trusted publisher** — configure a trusted publisher on npmjs.com for `@symfony/reprise`, pointing at the `release-on-npm.yaml` workflow in `symfony/reprise`. Without it the OIDC publish step cannot authenticate. (Required before the first release.)
2. **GitHub branch/tag rulesets** — protect `main` (require PRs / status checks) and protect `v*` tags (restrict who can create/delete, block force-push).
3. **GitHub immutable releases** — enable the immutable-releases setting so published releases/tags cannot be silently rewritten.

## Component 1 — `doc/index.rst` (docs migration + experimental notice)

Create `doc/` at the repo root with a single `index.rst`, migrating the current `README.md` content into reStructuredText.

**RST conventions** (from WebpackEncoreBundle `doc/index.rst` + Symfony UX):
- Title `Symfony Reprise` underlined with `=` (top and bottom optional; Symfony uses bottom only).
- Section headings underlined with `-`.
- Code blocks via `.. code-block:: terminal` / `ts` / `twig` / `yaml`.
- Inline code in double backticks; external links as ``` `text`_ ``` with definitions at the file end.
- The README's `<details>`/`<summary>` collapsibles become plain RST subsections (`Vite`, `Rsbuild`).

**Experimental notice** — Symfony UX style, bold inline text immediately after the title (NOT a `.. caution::` admonition):

```
**EXPERIMENTAL** This bundle is experimental and is likely to change,
or even change drastically.
```

**Section outline** (content migrated verbatim in meaning from `README.md`):

1. Title + experimental notice.
2. Intro — "Webpack Encore gave Symfony first-class asset integration for Webpack. Symfony Reprise gives you the same for Vite and Rsbuild."
3. **Features** — the current checklist (built vs planned), phrased as prose + a bullet list. Keep the "the bundlers already handle Sass/TS/HMR/… so Reprise does not reimplement them" framing.
4. **Installation** — two `.. code-block:: terminal` blocks: `composer require symfony/reprise` (the bundle) and `npm install @symfony/reprise --save-dev` (the plugin). Mention Symfony Flex.
5. **Vite** — the `vite.config.ts` example.
6. **Rsbuild** — the `rsbuild.config.ts` example.
7. **Symfony UX / Stimulus controllers** — migrate the whole README section: enabling via `stimulus:` option, `startStimulusApp()`, local controllers convention + `stimulusFetch: 'lazy'`, third-party UX packages + the Leaflet CSS-alias caveat.
8. Link targets block at the end (`Webpack Encore`, `Symfony UX`, `StimulusBundle`, `symfony/stimulus-bundle`).

## Component 2 — `README.md` slim-down

Reduce `README.md` to the Symfony teaser convention (cf. WebpackEncoreBundle's ~480-byte README):
- Title `# Symfony Reprise` + the three npm badges (kept).
- The `**EXPERIMENTAL**` notice (one line).
- One-paragraph pitch (the Encore -> Vite/Rsbuild intro).
- A "Read the documentation" link pointing at `doc/index.rst` (in-repo, since not on symfony.com yet).

All the detailed usage (Vite/Rsbuild/Stimulus examples) now lives only in `doc/index.rst`.

## Component 3 — CI hardening + Zizmor

### `.github/workflows/ci.yml` (rewrite in place, behaviour preserved)

Same jobs (`lint`, `test`, `php`, `php-qa`), same matrices, same commands. Security changes only:

- **Pin every action to a commit SHA** with a trailing `# vX.Y.Z` comment. Bump to the latest stable major (the maintainer asked to "update the actions"). Resolved SHAs:

  | Action | Version | SHA |
  |---|---|---|
  | `actions/checkout` | v7.0.0 | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
  | `pnpm/action-setup` | v6.0.9 | `0ebf47130e4866e96fce0953f49152a61190b271` |
  | `actions/setup-node` | v6.4.0 | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
  | `shivammathur/setup-php` | 2.37.2 | `f3e473d116dcccaddc5834248c87452386958240` |
  | `ramsey/composer-install` | 4.0.0 | `65e4f84970763564f46a70b8a54b90d033b3bdda` |

- **`persist-credentials: false`** on every `actions/checkout` step (fixes Zizmor `artipacked`; CI jobs don't push).
- **Scoped permissions**: top-level `permissions: {}` and `permissions: { contents: read }` on each job (fixes Zizmor `excessive-permissions`).
- The `cache: pnpm` inputs on `setup-node` stay — the `cache-poisoning` audit targets release/publish workflows, not push/PR CI, so no change or annotation needed here.

### `.github/workflows/fabbot.yaml`

Already SHA-pinned (`symfony-tools/fabbot/...@ad55ed5…`) with `permissions: {}` + job `contents: read`. **Unchanged.**

### `.github/workflows/zizmor.yaml` (new)

Mirror the Symfony UX Zizmor workflow:
- Triggers: `push` on `main`, `pull_request` on `**`.
- Top-level `permissions: {}`.
- One job `zizmor` on `ubuntu-latest` with `permissions: { security-events: write, contents: read, actions: read }`.
- Steps: `actions/checkout` (pinned, `persist-credentials: false`) then `zizmorcore/zizmor-action@192e21d79ab29983730a13d1382995c2307fbcaa # v0.5.7`.

## Component 4 — `release-on-npm.yaml` (new)

Adapted from Symfony UX's `release-on-npm.yaml`, **simplified** to three steps (install / build / publish). Two UX steps are dropped: the branch-ancestor verification (single `main` branch here) and the clean-tree `git diff --quiet` check (see below).

- **Trigger**: `push.tags: ['v*.*.*']`.
- **Permissions**: `id-token: write` (OIDC) + `contents: read`.
- **Concurrency**: `group: release-on-npm-${{ github.ref_name }}`, `cancel-in-progress: false`.
- **Steps** (single `ubuntu-latest` job):
  1. `actions/checkout` (pinned, `persist-credentials: false`, `fetch-depth: 0`, `ref: ${{ github.ref }}`).
  2. `npm i -g corepack && corepack enable` (picks up `packageManager: pnpm@…` from the root `package.json`).
  3. `actions/setup-node` (pinned, `registry-url: https://registry.npmjs.org`, `node-version-file: .nvmrc`). Carries `# zizmor: ignore[cache-poisoning]` since no `cache:` input is set (matches UX).
  4. `npm install -g npm@11.16.0` — npm ≥ 11.5.1 is required for OIDC trusted publishing; pinned explicitly to avoid a compromised `latest` at release time.
  5. `pnpm install --frozen-lockfile`.
  6. `pnpm run build`.
  7. `pnpm publish --recursive --access public --no-git-checks --provenance` — publishes only `@symfony/reprise` (`assets/`); the root package is `private`.

**Why no clean-tree check:** UX runs `git diff --quiet` after build to prove committed `dist` == built `dist`. Reprise git-ignores `assets/dist/`, so that check would only ever catch tracked-file drift (lockfile, stray generated files) — near-zero value for real added noise. It is intentionally omitted rather than kept as cargo-cult. (Committing `dist` to restore the check is a possible future decision, out of scope now.)

**Version/tag responsibility:** the maintainer bumps `assets/package.json` `version` and pushes the matching `vX.Y.Z` tag locally; the workflow publishes whatever version is in `assets/package.json`. No `tag == version` guard (kept lean). If the version already exists on npm, `pnpm publish` fails — an acceptable, visible failure.

## Verification (the batch is "done" when)

- **Docs**: `doc/index.rst` renders on GitHub with no RST errors; every README usage example is present in `doc/index.rst`; the experimental notice is at the top of both `doc/index.rst` and `README.md`; `README.md` is slimmed to the teaser + doc link.
- **CI hardening**: `ci.yml` and `zizmor.yaml` parse as valid YAML; every `uses:` is a 40-hex SHA with a version comment; every `checkout` has `persist-credentials: false`; top-level and per-job `permissions` are present. Running Zizmor locally (`zizmor .github/workflows`) reports no findings above its default threshold (or only intentionally-annotated ones).
- **Release**: `release-on-npm.yaml` parses; the steps read install -> build -> publish; the workflow does not run on push/PR, only on `v*.*.*` tags.
- **No behaviour regression**: existing CI jobs still run the same commands (`pnpm build`/`pnpm test`, `phpunit`, `phpstan`, `php-cs-fixer`).

## Open edge cases (decide during implementation)

- **`ramsey/composer-install` v3 -> v4** and **`actions/setup-node` v4 -> v6** / **`pnpm/action-setup` v4 -> v6** are major bumps; inputs used here (`dependency-versions`, `node-version-file`, `cache`) are unchanged across those majors, but CI is the real check. If a bump breaks, pin the latest SHA of the *current* major instead.
- **`.gitignore`** — no new entries needed; `doc/` is source (tracked), there is no RST build output to ignore.
- **README badges** — kept as-is (npm version/downloads/license). They already point at the published package name.
- **`corepack enable` vs `pnpm/action-setup`** — the release workflow uses corepack (mirrors UX) while `ci.yml` keeps `pnpm/action-setup`; both are valid, minor inconsistency accepted for UX-parity.
