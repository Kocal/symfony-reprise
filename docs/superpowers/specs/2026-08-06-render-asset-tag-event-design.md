# RenderAssetTagEvent for RepriseBundle

Date: 2026-08-06. Status: approved (design validated in brainstorm; spec pending user review). Target release: 0.7.0.

## Context

Issue [#71](https://github.com/symfony/reprise/issues/71) asks for a way to put a per-request `nonce` (CSP) on every rendered tag. Today `TagRenderer::renderScriptTags()` applies the configured `script_attributes` and the per-call `attributes` **only** to the app `<script>` tags. Three tags Reprise emits itself slip through:

- the injected HMR dev client (`<script type="module" src="@vite/client">`) — hardcoded, no attributes;
- the inline React Refresh preamble (`<script type="module">…</script>`) — no attributes;
- (the `<link rel="modulepreload">` hints — but nonce does not apply to preloads, see below).

Under a strict CSP (`script-src` with a nonce, no `unsafe-inline`), an inline script without a nonce is blocked outright, so the React preamble is exactly the case where a nonce matters most.

This is a deferred item from the `2026-07-25-encore-parity-batch` spec, which already noted the HMR client / preamble / modulepreload tags "belong to the deferred `RenderAssetTagEvent` feature". WebpackEncoreBundle ships the same [`RenderAssetTagEvent`](https://github.com/symfony/webpack-encore-bundle/blob/2.x/src/Event/RenderAssetTagEvent.php); mirroring it also unblocks [nelmio/NelmioSecurityBundle#314](https://github.com/nelmio/NelmioSecurityBundle/issues/314) — one event, two use cases (the reported nonce need + a future automatic NelmioSecurityBundle integration listener).

Encore never had this problem: webpack-dev-server injects its own client, so Encore's event fires only on real files. Reprise injects the client + preamble itself (backend integration), so to actually close #71 the event must also cover those.

## Decisions (from brainstorm)

1. **Event scope**: every tag Reprise emits goes through the event — app JS/CSS files, the injected HMR client, and the inline React preamble. The preamble has no `src` URL; rather than carry a nullable `url` (the inline case would make Encore's `getUrl()` return `?string`), the event carries **no dedicated url** at all — a listener that needs it derives it from `attributes['src']`/`['href']`.
2. **Unified attribute path**: the configured `script_attributes`/`link_attributes` and the per-call `attributes` seed **all** script tags (files, client, preamble), then the event is dispatched. So `reprise_entry_script_tags('app', {nonce: csp_nonce('script')})` covers the client without a listener, and the event covers the global/automatic (Nelmio) case. Consequence to document: a global `script_attributes` such as `defer`/`async` now also lands on the injected client.
3. **modulepreload excluded**: `<link rel="modulepreload">` tags are not routed through the event and do not receive `link_attributes`. They are an internal performance hint mirroring the HTTP `Link:` preload header, not a user asset tag, and CSP nonces do not apply to preloads.
4. **Docs**: this is a backend, bundler-agnostic feature (no JS side), so it ships a single PHP listener example — not the usual Vite+Rsbuild pair, and no JS/functional bundler test symmetry.

## The event class

`src/Event/RenderAssetTagEvent.php` — **public API** (not `@internal`; it is the extension point). PHP 8.4 native shape, no getter/setter ceremony:

```php
namespace Symfony\Reprise\Event;

/**
 * Dispatched each time a <script> or <link> tag is rendered, so listeners can add, change
 * or remove attributes (e.g. a CSP nonce) before the tag is written.
 */
final class RenderAssetTagEvent
{
    public const TYPE_SCRIPT = 'script';
    public const TYPE_LINK = 'link';

    /**
     * @param array<string, bool|string> $attributes mutable; add/change/remove entries directly
     */
    public function __construct(
        private readonly string $type,
        public array $attributes,
    ) {
    }

    public function isScript(): bool { return self::TYPE_SCRIPT === $this->type; }
    public function isLink(): bool { return self::TYPE_LINK === $this->type; }
}
```

Shape rationale:

- **`attributes` is a public mutable array**, not getter/setter — a listener writes `$event->attributes['nonce'] = $nonce` / `unset(...)`. Property hooks are the wrong tool here: `type` is an immutable scalar (a plain `readonly` promoted prop, matching the rest of `src/`), and `attributes` is mutated *by key*, which a `set` hook does not intercept — so a hook would collapse to exactly this public array anyway.
- **`type` stays private**, exposed through the semantic `isScript()`/`isLink()` methods (same encapsulation as Encore, just shorter names). The `TYPE_*` consts stay public so `TagRenderer` names them at the call site.
- **No `url`**: it lives in `attributes` (`src`/`href`), so a listener reads `$event->attributes['src'] ?? $event->attributes['href'] ?? null`. Avoids the nullable-url wart the inline preamble would otherwise create.
- No render veto/skip capability (Encore has none; #71 does not need it).

Migration note: this diverges from Encore's method API (`getAttributes()`/`setAttribute()`). Adapting a migrated Encore listener is a one-line change; Reprise is pre-1.0 with no BC promise.

## TagRenderer refactor

Introduce one private helper every user-facing tag flows through:

```php
private function tag(string $type, array $attributes, ?string $inlineBody = null): string
{
    if (null !== $this->eventDispatcher) {
        $event = $this->eventDispatcher->dispatch(new RenderAssetTagEvent($type, $attributes));
        $attributes = $event->attributes;
    }

    if (RenderAssetTagEvent::TYPE_LINK === $type) {
        return \sprintf('<link %s>', $this->attributes($attributes));
    }

    return \sprintf('<script %s>%s</script>', $this->attributes($attributes), $inlineBody ?? '');
}
```

Call sites, all through `tag()`:

- **Injected HMR client** (currently `TagRenderer.php:66`): build `['type' => 'module', 'src' => $client] + $attributes + $this->scriptAttributes`, then `tag(TYPE_SCRIPT, …)`. Now inherits config/per-call attributes + the event. No integrity (the dev URL is not in the integrity map).
- **React preamble** (currently `:68`/`renderReactRefreshPreamble` at `:145`): `renderReactRefreshPreamble()` is reduced to return the **inner JS body only** (no `<script>` wrapper); the block builds `['type' => 'module'] + $attributes + $this->scriptAttributes` and calls `tag(TYPE_SCRIPT, $attrs, inlineBody: $body)`.
- **App JS files** (`:81`): unchanged merge + `applyIntegrity()`, then `tag(TYPE_SCRIPT, $tagAttributes)` instead of the inline `sprintf`.
- **CSS `<link rel="stylesheet">`** (`:103`): unchanged merge + `applyIntegrity()`, then `tag(TYPE_LINK, $tagAttributes)`.

Unchanged: the `<link rel="modulepreload">` loop (`:73`) keeps its direct `attributes()` rendering (no event); `applyIntegrity()`/`integrityFor()`; the WebLink `preload()` `Link:` headers; the `injectedClients` dedup set; merge precedence (base `src`/`type`/`rel`/`href` > per-call > config, integrity applied last so a listener still sees it and, per Encore, may override it).

## DI wiring

`TagRenderer::__construct` gains a nullable last parameter:

```php
private readonly ?EventDispatcherInterface $eventDispatcher = null,   // Symfony\Contracts\EventDispatcher
```

Appended **last** so existing positional args do not shift. In `RepriseBundle::loadExtension`, add `service('event_dispatcher')->nullOnInvalid()` as the final argument of `reprise.tag_renderer`.

**Dependency — declare `symfony/event-dispatcher-contracts` (`^3`) in `require`.** It provides the `EventDispatcherInterface` the constructor type-hints, and declaring it is honest: `symfony/event-dispatcher` is already used unconditionally by `ResetAssetsEventListener` (`EventSubscriberInterface`), so the contracts are effectively required already. Distinguish the *interface* from the *service*: the contracts package guarantees the **interface**; the concrete `event_dispatcher` **service** is registered by the app (framework-bundle), not by the contracts — so it is wired with `service('event_dispatcher')->nullOnInvalid()` and guarded by the nullable ctor arg + `if (null !== $this->eventDispatcher)` in `tag()`. **No `composer suggest` block** (not a Symfony practice). Nullable also keeps `TagRenderer` unit-testable without a dispatcher. (The bundle's broader missing runtime `require`s — http-kernel, config, dependency-injection, http-foundation, event-dispatcher, service-contracts — are a separate composer audit, out of scope here.)

## Tests

`tests/Asset/TagRendererTest.php` (PHP unit; backend-only, no bundler test pair):

- a stub `EventDispatcherInterface` recording each event and mutating it (adds `nonce`);
- the nonce lands on app `<script>` tags, the injected HMR client, the React preamble, and CSS `<link>` tags;
- `isScript()`/`isLink()` return the right value per dispatched event; the preamble event carries no `src` in `attributes`;
- a listener that `unset($event->attributes[...])` drops the attribute from the output;
- `modulepreload` links are **not** dispatched and carry no listener attribute;
- **no dispatcher → output byte-identical to today** (regression guard).

Functional (`tests/Functional/DevAssetTagsTest.php`, dev fixtures already wired there): register a real listener in the functional kernel that sets `nonce="test"`; assert it appears on the injected `@vite/client` script, the React preamble, and the app scripts. A build-mode assertion (`AssetTagsTest`) confirms the nonce on file tags.

## Docs

`doc/index.rst`: a new section ("Customizing rendered tags / CSP nonce") after the Twig attributes section, with one PHP listener example:

```php
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Reprise\Event\RenderAssetTagEvent;

#[AsEventListener]
final class CspNonceListener
{
    public function __construct(private NonceGenerator $nonceGenerator) {}

    public function __invoke(RenderAssetTagEvent $event): void
    {
        $event->attributes['nonce'] = $this->nonceGenerator->getNonce();
    }
}
```

Note that it also covers the injected dev client and the React preamble, and mention that this is the hook a NelmioSecurityBundle integration uses. README feature list += the event.

## CHANGELOG

New `## 0.7.0` section, one bullet: add the `RenderAssetTagEvent`, dispatched before each rendered `<script>`/`<link>` (including the injected dev client and React preamble), letting listeners add/change/remove attributes such as a CSP nonce.

## Commit / branch

Branch `render-asset-tag-event` off `main`. Single feature commit, scope `[TagRenderer]`, squash-merged.
