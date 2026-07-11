# Design: `copy` option — static file copy wired into the manifest

Date: 2026-07-11
Scope: `@symfony/reprise` (JS plugin). Vite + Rsbuild. Build **and** dev modes.
Commit scope: `[Copy]`

## Problem

Webpack Encore's `copyFiles()` copies static files (images, fonts) that templates
reference by a stable logical path — e.g. Twig `asset('build/images/default/cat.jpg')`.
The key property: **copied files appear in `manifest.json`**, mapping the logical path
to a URL, so `JsonManifestVersionStrategy` resolves (and, in build, cache-busts) them.
Encore routes each file through a webpack loader that `emitFile`s it into the asset
graph; its manifest plugin then keeps it.

Reprise has no equivalent today. Native bundler copy mechanisms
(`vite-plugin-static-copy`, Rsbuild `output.copy` / `CopyRspackPlugin`) copy files
**outside** the bundler's asset graph, so the files never reach Reprise's
`manifest.json`. That breaks the Encore contract.

This design adds a first-class `copy` option to Reprise that puts copied files on disk
under `outputPath` and registers them in `manifest.json`, in both build and dev.

### Why dev matters

Encore had three commands: `dev` (a cheap development build **to disk**), `dev-server`
(webpack-dev-server, in-memory HMR) and `production`. `copyFiles` wrote to disk on
`dev`/`production`; you ran `dev` once to get files on disk, then `dev-server` for
JS/CSS HMR.

Vite and Rsbuild collapse this to two modes: `dev` (serve, in-memory) and `build`.
There is no cheap on-disk dev build anymore. So if `copy` were build-only, the copied
files would not exist at all during day-to-day `dev`, and every template reference
would 404. Dev must be covered.

## Serving model (the core decision)

Copied files are **static** (images, fonts): no HMR, no transform, no hashing needed
in dev. They are served differently from JS/CSS:

- **JS/CSS**: served by the Vite/Rsbuild dev server at its origin
  (`http://127.0.0.1:5173/build/app.js`), driven by `entrypoints.json` — needs HMR.
- **Copied files**: written to disk under `outputPath` (`public/build/…`) and served
  by the **Symfony web server** from `public/`, via a **relative** URL
  (`/build/images/cat.jpg`) in the manifest. The dev server is not involved.

This mixed model is intentional. It mirrors Encore's `dev` command (files on disk in
`public/build`, served by Symfony), needs no dev-server middleware, and aligns with
ADR 0001 (relative asset paths, resolved PHP-side).

## Goals

- `copy` option with Encore-parity surface: `from`, `to`, `pattern`, `includeSubdirectories`.
- Copied files land in `manifest.json` in **both** build and dev, keyed by their logical
  path.
- Build: content-hashed file names for cache busting. Dev: verbatim (unhashed) names.
- Manifest values use `publicPath` (relative in dev, absolute/CDN in build).
- Symmetric Vite and Rsbuild behaviour; shared, bundler-agnostic core.

## Non-goals

- **`to` as a filename template.** Encore's `to` took placeholders because
  `configureFilenames()` existed. Reprise does not re-expose bundler file-naming, so
  `to` is a plain logical destination prefix; hashing is Reprise's own, applied in build.
- **Encore's `context` option.** It only served `to`'s `[path]` placeholder, which we
  don't have. Logical paths are always relative to `from`.
- **Serving copied files through the dev server.** Rejected in favour of the Symfony /
  relative-URL model above.

## API (`assets/src/types.ts`)

```ts
/**
 * Copy static files (images, fonts…) into the build output and register them in
 * manifest.json so Twig's asset('<to>/<path>') resolves to the file URL. Works in
 * both build (hashed) and dev (verbatim).
 */
copy?: Array<{
  /** Source directory, relative to the project root (cwd) or absolute. Required. */
  from: string;
  /** Logical destination prefix used for the manifest key. Required. */
  to: string;
  /** Only files whose path relative to `from` matches this regex are copied. Default: every file. */
  pattern?: RegExp;
  /** Recurse into subdirectories of `from`. Default: true */
  includeSubdirectories?: boolean;
}>;
```

`from` and `to` are **both required**. `pattern` and `includeSubdirectories` mirror
Encore's `copyFiles` defaults.

### Resolved shape (`ResolvedOptions`)

```ts
copy: Array<{ from: string; to: string; pattern: RegExp; includeSubdirectories: boolean }>;
```

`normalizeOptions` resolves each entry:
- `from` -> absolute (`path.join(cwd, from)` if relative, like `outputPath`).
- `to` -> logical string with any leading/trailing `/` stripped (`images`), so it
  concatenates cleanly after `manifestKeyPrefix` (which ends in `/`).
- `pattern` -> defaults to a match-everything regex (`/.*/`).
- `includeSubdirectories` -> defaults to `true`.
- Absent `copy` -> `[]`.

## Shared core (`assets/src/core/copy.ts`)

Bundler-agnostic. No bundler imports.

- `enumerateCopyFiles(entries)` -> `Array<{ absPath, logicalName }>`:
  walk each `from` (recursively iff `includeSubdirectories`), for each file compute
  `rel` (path relative to `from`, forward slashes), keep it iff `pattern.test(rel)`,
  set `logicalName = `${to}/${rel}``.
- `contentHash(source: Buffer)` -> short hex (`node:crypto`), for build names.
- `hashedName(logicalName, hash)` -> inject the hash before the extension, preserving
  subdirs: `images/default/cat.jpg` -> `images/default/cat.<hash>.jpg`.
- `copyManifest(files, { publicPath, manifestKeyPrefix, hashed })` -> a manifest
  fragment `{ manifestKeyPrefix + logicalName : joinUrl(publicPath, physicalName) }`
  where `physicalName` is `hashedName(...)` in build and `logicalName` in dev.

The **manifest URL prefix for copied files is always `publicPath`**, never the dev
origin — copied files are Symfony-served in dev (see Serving model).

## Mechanism per bundler

Logical name is always `<to>/<rel>` (e.g. `images/default/cat.jpg`). What differs is
where the bytes get written and where the manifest fragment is merged.

### Vite (`assets/src/index.ts`)

- **Build** — in `generateBundle`: for each enumerated file, `this.emitFile({ type:
  'asset', fileName: hashedName(logical, contentHash(bytes)), source: bytes })` so
  Rollup writes it verbatim (explicit `fileName`, no re-hashing) to `outDir`; then
  merge `copyManifest(..., { hashed: true })` into the object emitted as `manifest.json`.
- **Dev** — in `configureServer` (where the dev files are already written): `fs`-copy
  each file verbatim to `join(outputPath, logicalName)`, and pass
  `copyManifest(..., { hashed: false })` to `writeSymfonyFiles` in place of today's `{}`.

### Rsbuild (`assets/src/rsbuild.ts`)

Everything happens in the existing `compiler.hooks.done` tap, which already writes the
Symfony files for both modes:

- Enumerate + `fs`-write each file to `join(outputPath, physicalName)` —
  `hashedName(...)` when `!isDev`, `logicalName` when `isDev`.
- Manifest: `isDev ? copyFragment : { ...buildManifest(graph, ctx), ...copyFragment }`,
  where `copyFragment = copyManifest(..., { hashed: !isDev })`. Replaces today's
  `isDev ? {} : buildManifest(...)`.

`fs`-writing (rather than `emitAsset`) is deliberate for dev: an `emitAsset`'d file
would be served in-memory by the dev server at its origin, contradicting the relative
Symfony URL in the manifest. Writing to disk lets Symfony serve it. Build uses the same
`fs` path for symmetry; the collectors are untouched (copied files never enter the
graph, so no double-counting).

## Manifest examples

Build (`publicPath: '/build/'`, `manifestKeyPrefix: 'build/'`):
```json
{ "build/images/default/cat.jpg": "/build/images/default/cat.a1b2c3d4.jpg" }
```

Dev (same options; verbatim, Symfony-served):
```json
{ "build/images/default/cat.jpg": "/build/images/default/cat.jpg" }
```

Build behind a CDN (`publicPath: 'https://cdn.example/build/'`): the value is the CDN
URL, like every other asset.

## Edge cases

- **Missing/empty `from`**: log a warning, copy nothing, do not throw.
- **Basename collision across subdirs**: distinct logical names -> distinct manifest
  keys; in build, distinct hashes -> distinct physical names. No collision.
- **`includeSubdirectories: false`**: only direct children of `from`, no recursion.
- **Binary files**: read/write as `Buffer`, never UTF-8, to avoid corruption (Encore's
  loader sets `raw = true` for the same reason).
- **Dev disk writes**: copied files are written under `outputPath` (conventionally
  git-ignored `public/build`), consistent with Reprise already writing
  `entrypoints.json`/`manifest.json` there in dev. A later `build` empties/replaces them.

## Testing (project symmetry rule — Vite AND Rsbuild, build AND dev)

Integration tests, mirrored across both bundlers:
- Fixture `from` with a nested file (`images/default/cat.jpg`) and a top-level file.
- **Build**: manifest key `<prefix><to>/<rel>` -> a **hashed** URL; the hashed file
  exists on disk under `outputPath`.
- **Dev**: manifest key `<prefix><to>/<rel>` -> the **verbatim** relative URL; the
  file exists on disk under `outputPath` unhashed.
- `pattern` excludes non-matching files; `includeSubdirectories: false` skips nested files.
- Off case: no `copy` -> no extra manifest entries, dev manifest stays `{}` (both bundlers).

## Documentation & feature lists

- `README.md` feature list — add near the manifest/versioning bullets:
  `- 📁 **File copy**: copy static files (images, fonts…) into the build, keyed in the manifest`
- `doc/index.rst` feature list — add:
  `- **File copy**: copy static files into the build, keyed in the manifest`
- `doc/index.rst` — a dedicated **File copy** section with a Vite **and** an Rsbuild
  example (both required), noting the dev serving model (written to `public/build`,
  served by Symfony). Prose drafted/polished with the `natural-writing-editor` agent.
