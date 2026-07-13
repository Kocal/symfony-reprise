# manifest.json -> asset() versioning

- Status: Accepted
- Date: 2026-07-13

## Context

The `@symfony/reprise` plugin already writes `manifest.json` on every build, keyed by logical
name and pointing at the content-hashed URL:

```json
{ "build/images/logo.png": "/build/logo-77.png" }
```

`buildManifest` (`assets/src/core/format.ts`) fills it from `graph.assets` — the images Vite/Rollup
emit, plus the static files the `copy` option copies into the build. The `File copy` section of the
docs already tells users to reference those files by their stable logical path:

```twig
{{ asset('build/images/logo.svg') }}
```

and promises the `asset()` helper "resolves it to the hashed URL". **That promise is currently
unfulfilled.** `RepriseBundle` consumes only `entrypoints.json` (through `EntrypointsLookup` and
`TagRenderer`); nothing on the PHP side reads `manifest.json`, and neither `RepriseBundle` nor the
playground configures `framework.assets.json_manifest_path`. With no manifest-backed version
strategy, `asset('build/images/logo.png')` returns the logical path unchanged instead of the hashed
URL. Asset versioning is wired on the JS half only.

Entry tags are unaffected: per [ADR 0001](../../adr/0001-packages-driven-asset-urls.md), entry
references are relative hashed paths (`build/app-<hash>.js`) resolved through `Packages::getUrl()`,
and they never appear in `manifest.json`.

## Key finding

Symfony's native `JsonManifestVersionStrategy` is **non-strict by default**
(`framework.assets.strict_mode` defaults to `false`), and its lookup is:

```php
public function applyVersion(string $path)
{
    return $this->getManifestPath($path) ?: $path; // unknown path -> returned unchanged
}
```

A path absent from the manifest passes through untouched. Entry references are not manifest keys, so
putting `json_manifest_path` on the **default** package resolves the loose/copied assets *and* leaves
entry-tag resolution alone. The entry-vs-loose conflict only appears under `strict_mode: true`.

## Decision

Adopt Webpack Encore's model verbatim: **wire the manifest through
`framework.assets.json_manifest_path`, configured by the user.** No `RepriseBundle` source change.

This is the same one line Encore users already know:

```yaml
# config/packages/framework.yaml
framework:
    assets:
        json_manifest_path: '%kernel.project_dir%/public/build/manifest.json'
```

Rejected alternatives:

- **Auto-wire in `RepriseBundle`** (`prependExtension` injecting `json_manifest_path` on the default
  package). Zero-config, but invasive — `FrameworkBundle` owns `framework.assets`, so it can clobber
  a user's own version strategy; it forces the manifest strategy on apps that reference no loose
  assets; it is fragile in dev/serve; and it diverges from Encore, which does not auto-wire.
- **A Reprise-managed named package** (`asset('build/logo.png', 'reprise')`). Avoids touching the
  default package, but forces a package argument at every `asset()` call — worse ergonomics, not the
  Encore feel.

## Design

### Data flow

- **Build** (`vite build`, `rsbuild build`): the plugin writes `manifest.json` mapping each logical
  name to its hashed public URL. Symfony's `JsonManifestVersionStrategy` reads that file; `asset('build/images/logo.png')`
  returns `/build/logo-77.png`.
- **Serve/dev** (`vite`, `rsbuild dev`): `writeSymfonyFiles` still writes a `manifest.json`, so the
  strategy finds the file and does not throw. Loose assets absent from it pass through unchanged.
- **Entry tags**: unchanged. `TagRenderer` resolves the relative hashed entry references through
  `Packages::getUrl()`; those references are not manifest keys, so a non-strict manifest strategy
  leaves them untouched.

### Strict-mode caveat

With `framework.assets.strict_mode: true`, an entry reference resolved through a package that has the
manifest strategy throws `AssetNotFoundException` (entries are not in the manifest). The escape is the
existing `reprise.asset_package` option: point entries at a dedicated `version: false` package, and
keep `json_manifest_path` on the default package for loose assets. The default (`strict_mode: false`)
needs none of this. The docs must spell this out.

### Deliverables

1. **Docs — `File copy` section.** Add the `framework.assets.json_manifest_path` YAML block so the
   `{{ asset('build/images/logo.svg') }}` promise actually holds. This is a single, bundler-agnostic
   YAML block (the section already carries the Vite and Rsbuild JS examples for the `copy` option
   itself; the PHP config is identical for both bundlers).
2. **Docs — `Configuration` section.** Document the manifest wiring and the strict-mode caveat with
   its `asset_package` -> `version: false` escape.
3. **Playground.** Add `framework.assets.json_manifest_path: '%kernel.project_dir%/public/build/manifest.json'`
   to `playground/config/packages/` so the whole chain works end-to-end and is manually verifiable
   with `vite:build` and `rsbuild:build`.
4. **Test.** One PHP functional test (below).

### Testing

A single PHP functional test: boot a kernel configured with `framework.assets.json_manifest_path`
pointing at a fixture `manifest.json`, fetch the container's `assets.packages` service, and assert
`Packages::getUrl('build/images/logo.png')` returns the hashed URL from the fixture (this is exactly
what the `asset()` Twig function calls). Also assert an entry-style reference absent from the manifest
passes through unchanged, proving entry tags are undisturbed. Reuse `tests/Kernel/FunctionalAppKernel.php`,
as `EntrypointsCacheTest` does.

This test is deliberately **not** mirrored across Vite and Rsbuild. The manifest-consumption path is
pure PHP with no bundler branch, and both bundlers emit an identical `manifest.json` shape (already
covered by the JS-side integration tests). The bundler-symmetry rule targets bundler-specific
behavior; there is none here. The test file carries a short comment stating this.

## Out of scope

- **`base_path`/CDN for loose assets.** `manifest.json` values are absolute
  (`/build/logo-77.png`), so `Packages` does not apply `base_path`/`base_urls` to loose assets — unlike
  entry references, which are relative per ADR 0001. This is the existing manifest format and is
  identical to Encore's. Making loose-asset URLs honor `base_path`/CDN means changing the JS manifest
  to relative values — a separate feature touching the shipped JS contract. Noted as a follow-up.
- **A Flex recipe** shipping the `json_manifest_path` line automatically (the true zero-config Encore
  delivery). Recipes live in `symfony/recipes`, out of this repo. Noted as a follow-up.

## Consequences

- Fulfills the existing `File copy` docs promise; completes "asset versioning" end-to-end.
- No new PHP source in `RepriseBundle`; the feature is configuration + docs + one functional test.
- Loose-asset URLs stay public-root-absolute (no `base_path`/CDN) until the follow-up lands.
