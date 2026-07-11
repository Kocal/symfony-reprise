# 1. Packages-driven asset URL resolution

- Status: Accepted
- Date: 2026-07-11

## Context

The `@symfony/reprise` plugin currently writes `entrypoints.json` with **final** URLs
(content-hashed filenames, prefixed with `publicPath`), and `RepriseBundle` would render the
`<script>`/`<link>` tags from those URLs as-is.

Emitting final URLs and skipping Symfony's asset component loses, at render time:

- **`base_path`** — a build cannot be served under an arbitrary sub-directory
  (`https://host/myapp/`); baked `/build/...` URLs 404 under `/myapp`.
- **`base_urls`** — no runtime CDN selection or domain sharding.
- **named packages** — `asset(path, 'package')`-style routing.
- **consistency** — entry tags do not share the URL treatment `asset()` gives the app's other
  assets (images, etc.).
- **version not in the filename** — Webpack Encore lets the hash live in a query string
  (`app.js?v=hash`, see symfony/webpack-encore#1266 and #1340), where only the manifest carries
  the version. The general lesson: a URL is opaque, not a filesystem path, and the PHP side must
  not assume where the version lives.

## Decision

Adopt Webpack Encore's model: **`Packages` (symfony/asset) drives final URL generation at render
time.** The bundler is responsible only for producing the files (already content-hashed) and the
manifest; `RepriseBundle` turns a reference into a URL via `Packages::getUrl()`
(`base_path` + `base_urls` [+ named package]).

Concretely — the "relative hashed paths" variant, chosen over the pure-Encore "logical keys +
`JsonManifestVersionStrategy`" one because Vite/Rollup shared & dynamic chunks are anonymous
(hashed names only, no natural logical key):

- **`entrypoints.json` (build)** carries **relative, hashed** paths — `build/app-<hash>.js`, no
  leading slash and no origin — instead of final URLs.
- **`RepriseBundle`** resolves each reference through a Reprise asset package configured with the
  app's `base_path`/`base_urls` but an **empty version strategy** (the filename is already
  hashed).
- **Dev / serve mode** keeps **absolute** dev-server-origin URLs
  (`http://127.0.0.1:5173/build/app.js`); `Packages` returns absolute URLs unchanged, so
  `base_path`/CDN correctly do not apply (the browser hits the dev server directly).
- **SRI**: the `integrity` map must be keyed so the tag renderer can find each hash for the
  reference it renders. SRI computation (hashing files on disk) is unaffected; only the map's key
  changes.

## Consequences

This is cross-cutting, not a PHP-only addition:

- **JS plugin** (`assets/src/core/format.ts`, collectors, the `cdn`/`build` integration tests):
  build `entrypoints.json` changes from final URLs to relative hashed paths; SRI integrity keying
  updates; the shipped tests that assert final URLs change.
- **RepriseBundle**: the tag renderer (slice 2) resolves via `Packages`; config points at the
  package(s); the integrity lookup is keyed to match. `EntrypointsLookup` (slice 1) is unaffected —
  it returns whatever references the file holds.
- **Docs**: the "Using a CDN" section reframes around `framework.assets`
  (`base_path`/`base_urls`) instead of an absolute build-time `publicPath`.

## Considered and rejected

- **Keep self-describing final URLs.** Simplest, but loses everything under _Context_.
- **Pure Encore (logical keys + `JsonManifestVersionStrategy`).** Most faithful and would support
  query-string versioning, but requires inventing stable manifest keys for Vite's anonymous
  shared/dynamic chunks, and query-string versioning is not expressible in Rollup output names
  anyway.
