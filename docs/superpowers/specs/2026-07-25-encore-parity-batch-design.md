# Encore-parity batch: four RepriseBundle features

Date: 2026-07-25. Status: approved (design validated in brainstorm; spec pending user review).

Numbering note: the gap analysis numbered these 1 (reset on exception), 2 (per-call attributes), 4 (`reprise_entry_exists()`), 5 (multiple builds). This spec uses branch names instead.

## Context

A full diff against `../webpack-encore` and `../webpack-encore-bundle` (2026-07-25, see memory `reprise-encore-gap-analysis`) showed Reprise already covers almost all of the Encore contract. The remaining pertinent gaps are all in RepriseBundle (PHP). Four were approved for implementation, each on its own branch. `RenderAssetTagEvent` and the rest of the backlog are deferred.

Decisions made during brainstorm:

1. **Twig signature**: Encore positional order, parameter renamed `build`: `(entryName, packageName = null, build = null, attributes = [])`. Positional compatibility with migrated Encore templates; Twig named args (`build='admin'`, `attributes={defer: true}`) cover the common case.
2. **Builds config**: full Encore parity — `builds` map of name -> build directory, `_default` reserved, `output_path: false` allowed when at least one named build exists, autowiring alias to the default build, `UndefinedBuildException`.
3. **Sequencing**: `reset-on-exception`, `twig-entry-exists`, `twig-attributes` in parallel from `main` (near-zero conflict surface between them); `multiple-builds` starts after they merge.

## Branch `reset-on-exception` (bug fix)

**Problem.** `ResetAssetsEventListener` resets only on `FINISH_REQUEST` (main request). When an exception is thrown, `ErrorListener` renders the error page in a sub-request *during* `kernel.exception`, i.e. before that reset. An exception after a partial render leaks two pieces of state into the error page: the lookup's dedup set (`returnedFiles`) — tags already rendered are silently dropped — and `TagRenderer::$clientInjected` — the HMR client is not re-injected in dev.

**Change.** Extend the existing `src/EventListener/ResetAssetsEventListener.php` (no separate listener class, unlike Encore):

- Inject `reprise.tag_renderer` alongside the lookup (wire in `RepriseBundle::loadExtension`).
- Subscribe additionally to `KernelEvents::EXCEPTION`; the handler resets lookup + renderer **unconditionally** (no `isMainRequest` check — Encore parity: an exception anywhere abandons the pending render).
- `onFinishRequest` keeps its `isMainRequest` guard (sub-request FINISH_REQUEST during fragments/ESI must not clear dedup mid-page) and now also resets the renderer, for symmetry. Safe: FINISH_REQUEST fires after the response is built, nothing renders afterwards within the request.

**Tests.** Unit: dispatching an `ExceptionEvent` resets both services; existing finish-request tests extended for the renderer. Functional: controller renders entry tags then throws; the error template renders the same entry; assert the error response contains the full tags (and the dev-server client with a dev-flavoured fixture).

## Branch `twig-attributes`

**Change.** `reprise_entry_script_tags` / `reprise_entry_link_tags` (and the underlying `AssetRuntime` / `TagRenderer` methods) get the *final* signature in one step:

```php
renderScriptTags(string $entryName, ?string $packageName = null, ?string $build = null, array $attributes = []): string
```

- `$build !== null` throws `\InvalidArgumentException` ("no build named X is configured") until `multiple-builds` lands; that branch narrows it to `UndefinedBuildException extends \InvalidArgumentException` (BC-safe). Introducing the full signature now avoids a positional shift between releases (`attributes` must sit 4th, after `build`).
- **Merge precedence**: base attrs (`src`/`type`, `rel`/`href`) > globals (`script_attributes`/`link_attributes`, current `+=` behavior unchanged); per-call attributes merged last via `array_merge` and win over everything; a `false` value drops the attribute (already handled by `TagRenderer::attributes()`); `integrity`/`crossorigin` applied after the merge, so per-call values cannot spoof them (Encore parity).
- **Scope**: per-call attributes apply to the `<script>` tags (script_tags) and stylesheet `<link>` tags (link_tags) only — not to `modulepreload` links, the HMR client tag, or the React Refresh preamble. Those belong to the deferred `RenderAssetTagEvent` feature.
- `reprise_entry_js_files`/`css_files` untouched (no attributes concept, matching Encore).

**Docs.** Extend the Twig functions section in `doc/index.rst`: named-args example, `{defer: true}`, `{'data-turbo-track': 'reload'}`.

**Tests.** `TagRendererTest`: precedence order, `false` removal, HTML escaping, integrity-wins. Twig functional render with attributes. `build` guard throws.

## Branch `twig-entry-exists`

**Change.** New Twig function `reprise_entry_exists(entryName): bool` -> `AssetRuntime::entryExists` -> `EntrypointsLookupInterface::entryExists` (already exists). No `build` placeholder here: the final signature is `(entryName, build = null)` and the trailing param is appended BC-safely by `multiple-builds`. Existing lookup semantics preserved (strict-mode behavior on a missing entrypoints.json stays whatever `entryExists` does today).

**Docs.** Short paragraph + conditional-rendering example in `doc/index.rst`.

**Tests.** Unit + Twig functional (existing entry -> true, unknown -> false).

## Branch `multiple-builds` (after the three merge)

**Config** (`RepriseBundle::configure`):

- `output_path` accepts `string|false`; `false` requires at least one entry in `builds` (fail at container compile with a `LogicException` — improvement over Encore, which fails at first use).
- New `builds` array node: name -> build directory (`/entrypoints.json` appended, like `output_path`), `_default` forbidden as a name.

**New code** (`src/`):

- `Asset/EntrypointsLookupCollectionInterface.php` — public, wirable: `getEntrypointsLookup(?string $build = null): EntrypointsLookupInterface`, throws `UndefinedBuildException`.
- `Asset/EntrypointsLookupCollection.php` — `@internal`, backed by a service locator + nullable default build name.
- `Exception/UndefinedBuildException.php` — extends `\InvalidArgumentException`, implements the existing `ExceptionInterface` marker.

**Wiring** (`RepriseBundle::loadExtension`):

- One `EntrypointsLookup` per build; the default build keeps service id `reprise.entrypoints_lookup` (BC), named builds get `reprise.entrypoints_lookup.<name>`.
- Collection service `reprise.entrypoints_lookup_collection` + interface alias. `EntrypointsLookupInterface` alias points to the default lookup only when `output_path !== false`.
- Cache: parameter becomes a map build -> entrypoints path; `EntrypointsCacheWarmer` iterates all builds with per-build cache keys (`reprise.entrypoints.<build>`, the `_default` build included — the old unsuffixed key is not kept, the build-dir cache is regenerated anyway); each lookup receives its matching key.
- `ResetAssetsEventListener` resets every build's lookup + the renderer.

**TagRenderer**: constructor takes the collection (+ default resolution); all public methods gain a functional `?string $build = null` (`js_files`/`css_files`/`entryExists` append it trailing). `$clientInjected` becomes a set keyed by client URL so two simultaneous dev servers (Vite app + Rsbuild admin) each get their client injected exactly once. Dedup state stays per-lookup, i.e. per build (Encore parity).

**JS side: zero changes** — one bundler config already writes one `entrypoints.json` per build directory.

**Docs.** New "Multiple builds" section in `doc/index.rst`, showcasing a Vite `app` build + Rsbuild `admin` build in one Symfony app (two plugin configs, `builds:` yaml, `build='admin'` in Twig, both dev servers running simultaneously). Add to the README feature list. Follow doc conventions (multi-line `Symfony({...})`, ~120-char soft wrap).

**Tests.** Unit: collection resolution + `UndefinedBuildException`, per-build dedup, dual dev-server client injection, multi-build cache warmer. Functional: kernel with two build fixtures — one Vite-flavoured, one Rsbuild-flavoured entrypoints.json (nod to the bundler-symmetry rule; no JS tests since no JS changes).

## Cross-cutting

- Branches from `main`; the three small ones developed in parallel (worktrees), TDD throughout, squashed to 1 commit each before PR.
- Commit subjects (scopes match git-log precedent — `[Asset]`, `[Twig]`, `[Cache]` already in use): `[Asset] Reset asset state when an exception is handled`, `[Twig] Add per-call attributes to the entry tag functions`, `[Twig] Add reprise_entry_exists()`, `[Builds] Add support for multiple named builds`.
- PRs opened from the fork (`gh pr create --repo symfony/reprise --head Kocal:<branch>`), body starting with the Q/A template table. No CHANGELOG edits in feature PRs (filled at release).

## Verification

- PHP: `vendor/bin/phpunit` (config in `phpunit.xml.dist`) green per branch, plus the new unit/functional tests above.
- `reset-on-exception`: functional test proves the error page renders complete tags.
- `multiple-builds`: manual E2E in `playground/` — run `vite:dev` and `rsbuild:dev` together against two configured builds and load a page rendering both.
- JS: `pnpm test` untouched/green (no JS changes in any branch).

## Out of scope

`RenderAssetTagEvent` equivalent (deferred by user), and the backlog recorded in memory `reprise-encore-gap-analysis` (migration guide, outputPath cleanup, remote entrypoints.json, advanced copyFiles).
