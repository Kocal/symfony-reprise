# Maintainers guide

This document describes how the Reprise maintainers cut a release.

## Releasing

This repository ships two packages, released together from a single Git tag:

- the Composer bundle `symfony/reprise`, published to Packagist from the tag;
- the npm plugin `@symfony/reprise`, published to npm by the
  [`release-on-npm.yaml`](.github/workflows/release-on-npm.yaml) workflow.

### Prerequisites

- Push access to the `upstream` remote (`git@github.com:symfony/reprise.git`).
- The npm package's trusted publisher configured on npmjs.com to point at the `symfony/reprise` repository
  and the `release-on-npm.yaml` workflow. This is what lets the workflow publish without an `NPM_TOKEN`.

### Steps

1. Start from an up-to-date `main`:

    ```bash
    git checkout main
    git pull upstream main
    ```

2. Cut the release commit and tag with the helper script, passing the bump level:

    ```bash
    ./release.sh minor   # or patch / major / an explicit version such as 0.2.0
    ```

    It checks that you are on a clean `main` in sync with `upstream`, then runs `pnpm version` inside
    `assets/` (the publishable package) to bump `assets/package.json`, commit, and create the `v<version>`
    tag. Running `pnpm version` from the repo root would target the private root package, and `--filter`
    would skip the commit and tag -- that is why the script scopes it to `assets/`.

3. Push `main` and the new tag to upstream:

    ```bash
    git push upstream main --follow-tags
    ```

4. Pushing the `v<version>` tag triggers
   [`release-on-npm.yaml`](.github/workflows/release-on-npm.yaml), which publishes `@symfony/reprise` to
   npm through OIDC trusted publishing. The workflow refuses to publish a tag that isn't on `main`.
   Packagist picks up the same tag for the Composer package.

5. Write the release notes on GitHub (**Releases -> Draft a new release**), select the `v<version>` tag,
   and generate the changelog.
