# Contributing

Thank you for considering contributing to Symfony Reprise!

Symfony Reprise is an open source, community-driven project, and we are happy to receive contributions from the community.

> [!TIP]
> It's a good idea to read [Symfony's Contribution Guide](https://symfony.com/doc/current/contributing/index.html) first.

## Reporting an issue

If you find a bug, have a feature request, or need help, please [open an issue](https://github.com/symfony/reprise/issues).

Please provide as much information as possible, and remember to follow our [Code of Conduct](https://symfony.com/doc/current/contributing/code_of_conduct/index.html) to keep the project welcoming for everyone.

## Contributing to the code

### Forking the repository

To contribute to Symfony Reprise, you need to [fork the **symfony/reprise** repository](https://github.com/symfony/reprise/fork) on GitHub.

```shell
# With GitHub CLI https://cli.github.com/
$ gh repo clone <USERNAME>/reprise reprise

# Using SSH
$ git clone git@github.com:<USERNAME>/reprise.git reprise
$ cd reprise
$ git remote add upstream git@github.com:symfony/reprise.git
```

### Setting up the development environment

- **PHP 8.4 or higher**
- **Composer**
- **Node.js 22 or higher**
- **Corepack**
- **pnpm 11.10 or higher**

```shell
$ composer install
$ corepack enable && pnpm install
```

> [!IMPORTANT]
> This repository has a dual structure: a PHP Symfony bundle (`symfony/reprise`) at the root, and an npm package (`@symfony/reprise`) in `assets/`, managed together as a pnpm workspace. Most changes touch only one side, but some (like adding a new option) touch both.

### Working with the PHP bundle

The PHP source lives in `src/`, tests in `tests/`. The bundle follows Symfony's PHP coding standards and the Backward Compatibility promise.

```shell
# Run the test suite
$ vendor/bin/phpunit

# Run static analysis
$ vendor/bin/phpstan analyse

# Fix coding standards
$ vendor/bin/php-cs-fixer fix
```

### Working with the assets

The actual bundler plugin (the unplugin for Vite and Rsbuild) lives in `assets/`, written in TypeScript and built with [tsdown](https://tsdown.dev/). These commands run from the repository root:

```shell
# Build the plugin
$ pnpm build

# Watch and rebuild on change
$ pnpm dev

# Run the test suite
$ pnpm test

# Lint
$ pnpm lint

# Format (use `pnpm fmt:check` to only check, without writing)
$ pnpm fmt
```

For manual end-to-end verification against a real Symfony backend, use the `playground/` app (a full Symfony 7 project that imports the plugin directly from `assets/`):

```shell
$ npm -C playground run vite:dev
$ npm -C playground run vite:build

$ npm -C playground run rsbuild:dev
$ npm -C playground run rsbuild:build
```

### Commit messages

Commit messages follow the same `[<Scope>] <Short description>` convention used across Symfony UX and WebpackEncoreBundle, not Conventional Commits. The scope is PascalCase, the description is imperative mood with a capitalized first word and no trailing period. Combine scopes as `[A][B]` when a change spans several areas.

```
[Stimulus] Emit forward-slash local controller paths
[Docs] Frame Stimulus usage as the Encore experience
[CI] Cancel superseded runs with a concurrency group
```

## Keeping your fork up to date

To reset your local `main` to match upstream:

```shell
$ git checkout main && \
  git fetch upstream && \
  git reset --hard upstream/main && \
  git push origin main
```

To rebase a feature branch on top of `upstream/main`:

```shell
$ git checkout my-feature-branch && \
  git rebase upstream/main && \
  git push -u origin my-feature-branch
```
