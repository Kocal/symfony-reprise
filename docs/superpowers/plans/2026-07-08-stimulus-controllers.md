# Symfony UX / Stimulus controllers (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a `virtual:symfony/controllers` module (third-party controllers from `controllers.json` + local `assets/controllers/`, lazy via the `/* stimulusFetch: 'lazy' */` comment) and ship a `startStimulusApp()` helper, working in both Vite and Rsbuild.

**Architecture:** A pure code generator in `src/core/stimulus.ts` produces the virtual-module source string. Each bundler provisions that string differently — Vite via unplugin `resolveId`/`load`, Rsbuild via `rspack.experiments.VirtualModulesPlugin` — while the shipped runtime helper `src/stimulus.ts` (a faithful port of `@symfony/stimulus-bundle`'s loader) imports the virtual module and registers controllers on a Stimulus `Application`.

**Tech Stack:** TypeScript (ESM, ES2017), unplugin (Vite), a native `RsbuildPlugin` (Rsbuild), `@rsbuild/core`'s `rspack.experiments.VirtualModulesPlugin`, `@hotwired/stimulus` (peer dep), vitest (+ jsdom for the helper).

## Global Constraints

- ESM only, strict TypeScript, ES2017 target. Use the `node:` prefix for Node builtins.
- Package manager is **pnpm**. Commands: `pnpm build` (tsdown), `pnpm lint` (eslint), `pnpm test` / `pnpm vitest run <file>`.
- Tests live under `test/` (vitest include is `test/**/*.{test,spec}.ts`).
- New public options go in `src/types.ts` with JSDoc.
- The `stimulus` feature is **off by default**; every code path is guarded by `resolved.stimulus` being set. Existing entrypoints/manifest behaviour must stay unchanged.
- Virtual module id is exactly `virtual:symfony/controllers`.
- Generated identifiers use the Symfony snake-case convention: third-party `@scope/pkg` + `ctrl` → strip a leading `@`, `_`→`-`, `/`→`--`; local `foo_bar_controller.js` → `foo-bar`.
- Commit after every task with a `feat(stimulus):` / `test(stimulus):` / `docs:` prefix and end the message with `Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc`.

---

### Task 1: `stimulus` option — types + normalization

**Files:**
- Modify: `src/types.ts`
- Modify: `src/core/options.ts:4-27` (`normalizeOptions`)
- Test: `test/core/options.test.ts`

**Interfaces:**
- Consumes: existing `normalizeOptions(options, cwd)`.
- Produces: `Options.stimulus?: string | StimulusOptions`; `ResolvedOptions.stimulus?: ResolvedStimulusOptions` where `ResolvedStimulusOptions = { controllersJson: string /*abs*/, controllersDir: string /*abs*/ }`; exported types `EagerControllersCollection`, `LazyControllersCollection` (used by later tasks).

- [ ] **Step 1: Add the option + resolved types to `src/types.ts`**

Add near the existing `devServerOrigin` option (remove the stale `// stimulusBridge?: object` comment line if present), and extend `ResolvedOptions`:

```ts
import type { ControllerConstructor } from '@hotwired/stimulus'

// inside interface Options, after devServerOrigin:
  /**
   * Enable Symfony UX / Stimulus controller registration.
   *
   * Pass the path to your `controllers.json` (relative to the package.json dir)
   * to enable the feature, or an object to also override the local controllers
   * directory.
   *
   * ```js
   * Symfony({ stimulus: 'assets/controllers.json' })
   * ```
   */
  stimulus?: string | StimulusOptions
```

```ts
export interface StimulusOptions {
  /** Path to `controllers.json`, e.g. `assets/controllers.json`. */
  controllersJson: string
  /** Local controllers dir. Default: `<dir of controllersJson>/controllers`. */
  controllersDir?: string
}

export interface ResolvedStimulusOptions {
  /** Absolute path to controllers.json. */
  controllersJson: string
  /** Absolute path to the local controllers directory. */
  controllersDir: string
}

/** Map of Stimulus identifier -> controller class (registered eagerly). */
export type EagerControllersCollection = Record<string, ControllerConstructor>
/** Map of Stimulus identifier -> dynamic-import factory (registered lazily). */
export type LazyControllersCollection = Record<string, () => Promise<{ default: ControllerConstructor }>>
```

And add to `ResolvedOptions`:

```ts
  stimulus?: ResolvedStimulusOptions
```

- [ ] **Step 2: Write the failing test** in `test/core/options.test.ts` (append inside the `normalizeOptions` describe)

```ts
  it('leaves stimulus undefined when not configured', () => {
    const r = normalizeOptions(undefined, '/app')
    expect(r.stimulus).toBeUndefined()
  })

  it('resolves the string shorthand to abs controllersJson + sibling controllers dir', () => {
    const r = normalizeOptions({ stimulus: 'assets/controllers.json' }, '/app')
    expect(r.stimulus).toEqual({
      controllersJson: join('/app', 'assets/controllers.json'),
      controllersDir: join('/app', 'assets/controllers'),
    })
  })

  it('resolves the object form and honors an explicit controllersDir', () => {
    const r = normalizeOptions({ stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/stimulus' } }, '/app')
    expect(r.stimulus).toEqual({
      controllersJson: join('/app', 'assets/controllers.json'),
      controllersDir: join('/app', 'assets/stimulus'),
    })
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/options.test.ts`
Expected: FAIL (`r.stimulus` is `undefined` / not equal).

- [ ] **Step 4: Implement normalization** in `src/core/options.ts`

Add a helper and wire it into the returned object:

```ts
import type { Options, ResolvedOptions, ResolvedStimulusOptions } from '../types'

function normalizeStimulus(stimulus: Options['stimulus'], cwd: string): ResolvedStimulusOptions | undefined {
  if (!stimulus)
    return undefined
  const raw = typeof stimulus === 'string' ? { controllersJson: stimulus } : stimulus
  const controllersJson = path.isAbsolute(raw.controllersJson) ? raw.controllersJson : path.join(cwd, raw.controllersJson)
  const controllersDir = raw.controllersDir
    ? (path.isAbsolute(raw.controllersDir) ? raw.controllersDir : path.join(cwd, raw.controllersDir))
    : path.join(path.dirname(controllersJson), 'controllers')
  return { controllersJson, controllersDir }
}
```

Then in the `return { ... }` of `normalizeOptions`, add:

```ts
    stimulus: normalizeStimulus(options?.stimulus, cwd),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/core/options.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Lint + commit**

```bash
pnpm lint
git add src/types.ts src/core/options.ts test/core/options.test.ts
git commit -m "feat(stimulus): add and normalize the stimulus option

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

Note: `@hotwired/stimulus` is imported for types only here; it is added to devDeps in Task 4. If `pnpm lint`/typecheck complains about the missing module before then, run `pnpm add -D @hotwired/stimulus` now (it is needed regardless).

---

### Task 2: Generator — third-party controllers

**Files:**
- Create: `src/core/stimulus.ts`
- Create fixtures: `test/fixtures/stimulus/controllers.json`, `test/fixtures/stimulus/node_modules/@acme/ux-hello/package.json`, `test/fixtures/stimulus/node_modules/@acme/ux-hello/dist/hello_controller.js`, `test/fixtures/stimulus/node_modules/@acme/ux-map/package.json`, `test/fixtures/stimulus/node_modules/@acme/ux-map/dist/map_controller.js`
- Test: `test/core/stimulus.test.ts`

**Interfaces:**
- Produces: `generateControllersModule(opts: ResolvedStimulusOptions, root: string, isDev: boolean): string`. Reads `opts.controllersJson`, resolves each package's `package.json` from `root`, and returns ESM source exporting `eagerControllers`, `lazyControllers`, `isApplicationDebug`.

- [ ] **Step 1: Create the third-party fixtures**

`test/fixtures/stimulus/controllers.json`:

```json
{
  "controllers": {
    "@acme/ux-hello": {
      "hello": { "enabled": true, "fetch": "eager", "autoimport": { "@acme/ux-hello/dist/hello.css": true } }
    },
    "@acme/ux-map": {
      "map": { "enabled": true },
      "mini-map": { "enabled": false }
    }
  },
  "entrypoints": []
}
```

`test/fixtures/stimulus/node_modules/@acme/ux-hello/package.json`:

```json
{
  "name": "@acme/ux-hello",
  "version": "1.0.0",
  "main": "dist/hello_controller.js",
  "symfony": { "controllers": { "hello": { "main": "dist/hello_controller.js", "fetch": "eager" } } }
}
```

`test/fixtures/stimulus/node_modules/@acme/ux-hello/dist/hello_controller.js`:

```js
export default class {}
```

`test/fixtures/stimulus/node_modules/@acme/ux-map/package.json`:

```json
{
  "name": "@acme/ux-map",
  "version": "1.0.0",
  "main": "dist/map_controller.js",
  "symfony": { "controllers": {
    "map": { "main": "dist/map_controller.js", "fetch": "lazy" },
    "mini-map": { "main": "dist/map_controller.js", "fetch": "lazy" }
  } }
}
```

`test/fixtures/stimulus/node_modules/@acme/ux-map/dist/map_controller.js`:

```js
export default class {}
```

- [ ] **Step 2: Write the failing test** `test/core/stimulus.test.ts`

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateControllersModule } from '../../src/core/stimulus'

const root = join(import.meta.dirname, '../fixtures/stimulus')
const opts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'does-not-exist') }

describe('generateControllersModule — third-party', () => {
  it('emits an eager third-party controller with a static import and autoimport', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).toContain(`import controller_0 from "@acme/ux-hello/dist/hello_controller.js"`)
    expect(src).toContain(`import "@acme/ux-hello/dist/hello.css"`)
    expect(src).toContain(`"acme--ux-hello--hello": controller_0`)
  })

  it('emits a lazy third-party controller as a dynamic import factory', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).toContain(`"acme--ux-map--map": () => import("@acme/ux-map/dist/map_controller.js")`)
  })

  it('skips disabled controllers', () => {
    const src = generateControllersModule(opts, root, false)
    expect(src).not.toContain('mini-map')
  })

  it('sets isApplicationDebug from the isDev flag', () => {
    expect(generateControllersModule(opts, root, true)).toContain('export const isApplicationDebug = true')
    expect(generateControllersModule(opts, root, false)).toContain('export const isApplicationDebug = false')
  })

  it('throws a helpful error when a declared package is not installed', () => {
    const bad = { controllersJson: join(root, 'controllers.json'), controllersDir: opts.controllersDir }
    expect(() => generateControllersModule(bad, '/nonexistent-root', false)).toThrow(/npm install|could not/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/stimulus.test.ts`
Expected: FAIL with "Failed to resolve import" / module not found for `../../src/core/stimulus`.

- [ ] **Step 4: Implement `src/core/stimulus.ts`** (third-party only for now; the local loop is added in Task 3)

```ts
import type { ResolvedStimulusOptions } from '../types'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

interface UserControllerConfig {
  enabled?: boolean
  fetch?: 'eager' | 'lazy'
  name?: string
  autoimport?: Record<string, boolean>
}
interface PackageControllerConfig {
  main: string
  name?: string
  fetch?: 'eager' | 'lazy'
  autoimport?: Record<string, boolean>
}
interface ControllersJson {
  controllers?: Record<string, Record<string, UserControllerConfig>>
}

export function generateControllersModule(opts: ResolvedStimulusOptions, root: string, isDev: boolean): string {
  const imports: string[] = []
  const eager: string[] = []
  const lazy: string[] = []
  let index = 0

  const require = createRequire(path.join(root, 'noop.js'))
  const json = JSON.parse(readFileSync(opts.controllersJson, 'utf8')) as ControllersJson

  for (const packageName of Object.keys(json.controllers ?? {})) {
    let pkg: { symfony?: { controllers?: Record<string, PackageControllerConfig> } }
    try {
      pkg = require(`${packageName}/package.json`)
    }
    catch {
      throw new Error(`unplugin-symfony: cannot find "${packageName}/package.json". Install the package (e.g. "npm install ${packageName}").`)
    }
    const pkgControllers = pkg.symfony?.controllers ?? {}

    for (const controllerName of Object.keys(json.controllers![packageName])) {
      const user = json.controllers![packageName][controllerName]
      if (user.enabled === false)
        continue
      const pkgCfg = pkgControllers[controllerName]
      if (!pkgCfg)
        throw new Error(`unplugin-symfony: controller "${packageName}/${controllerName}" is not declared in ${packageName}'s package.json "symfony.controllers".`)

      const main = `${packageName}/${pkgCfg.main}`
      const fetch = user.fetch ?? pkgCfg.fetch ?? 'eager'
      const identifier = thirdPartyIdentifier(packageName, controllerName, pkgCfg.name, user.name)
      const autoimports = Object.entries(user.autoimport ?? pkgCfg.autoimport ?? {}).filter(([, v]) => v).map(([k]) => k)

      if (fetch === 'lazy') {
        if (autoimports.length) {
          const all = [main, ...autoimports].map(m => `import(${JSON.stringify(m)})`).join(', ')
          lazy.push(`  ${JSON.stringify(identifier)}: () => Promise.all([${all}]).then(r => r[0]),`)
        }
        else {
          lazy.push(`  ${JSON.stringify(identifier)}: () => import(${JSON.stringify(main)}),`)
        }
      }
      else {
        const varName = `controller_${index++}`
        imports.push(`import ${varName} from ${JSON.stringify(main)}`)
        for (const a of autoimports)
          imports.push(`import ${JSON.stringify(a)}`)
        eager.push(`  ${JSON.stringify(identifier)}: ${varName},`)
      }
    }
  }

  return render(imports, eager, lazy, isDev)
}

function thirdPartyIdentifier(packageName: string, controllerName: string, pkgName?: string, userName?: string): string {
  if (userName)
    return userName.replace(/\//g, '--')
  if (pkgName)
    return pkgName.replace(/\//g, '--')
  let id = `${packageName}/${controllerName}`
  if (id.startsWith('@'))
    id = id.slice(1)
  return id.replace(/_/g, '-').replace(/\//g, '--')
}

function render(imports: string[], eager: string[], lazy: string[], isDev: boolean): string {
  const lines = [...imports, '']
  lines.push(`export const eagerControllers = {${eager.length ? `\n${eager.join('\n')}\n` : ''}}`)
  lines.push(`export const lazyControllers = {${lazy.length ? `\n${lazy.join('\n')}\n` : ''}}`)
  lines.push(`export const isApplicationDebug = ${isDev ? 'true' : 'false'}`)
  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/core/stimulus.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 6: Lint + commit**

```bash
pnpm lint
git add src/core/stimulus.ts test/core/stimulus.test.ts test/fixtures/stimulus
git commit -m "feat(stimulus): generate third-party controllers from controllers.json

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 3: Generator — local controllers glob

**Files:**
- Modify: `src/core/stimulus.ts` (add the local loop + helpers)
- Create fixtures: `test/fixtures/stimulus/controllers/greet_controller.js`, `test/fixtures/stimulus/controllers/heavy_controller.js`, `test/fixtures/stimulus/controllers/admin/user_controller.js`
- Test: `test/core/stimulus.test.ts` (append)

**Interfaces:**
- Consumes/Produces: same `generateControllersModule` signature; now also globs `opts.controllersDir` and merges local controllers into the eager/lazy maps.

- [ ] **Step 1: Create the local-controller fixtures**

`test/fixtures/stimulus/controllers/greet_controller.js`:

```js
export default class {}
```

`test/fixtures/stimulus/controllers/heavy_controller.js`:

```js
/* stimulusFetch: 'lazy' */
export default class {}
```

`test/fixtures/stimulus/controllers/admin/user_controller.js`:

```js
export default class {}
```

- [ ] **Step 2: Write the failing test** (append to `test/core/stimulus.test.ts`)

```ts
describe('generateControllersModule — local', () => {
  const localOpts = { controllersJson: join(root, 'controllers.json'), controllersDir: join(root, 'controllers') }

  it('emits an eager local controller by absolute path', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toContain(join(root, 'controllers/greet_controller.js'))
    expect(src).toMatch(/"greet": controller_\d+/)
  })

  it('emits a lazy local controller when the stimulusFetch comment is present', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toContain(`"heavy": () => import(`)
    expect(src).toContain(join(root, 'controllers/heavy_controller.js'))
  })

  it('maps nested controllers with a double-dash identifier', () => {
    const src = generateControllersModule(localOpts, root, false)
    expect(src).toMatch(/"admin--user": controller_\d+/)
  })

  it('returns valid empty maps when there are no controllers at all', () => {
    const empty = { controllersJson: join(root, 'empty-controllers.json'), controllersDir: join(root, 'nope') }
    const src = generateControllersModule(empty, root, false)
    expect(src).toContain('export const eagerControllers = {}')
    expect(src).toContain('export const lazyControllers = {}')
  })
})
```

Also create `test/fixtures/stimulus/empty-controllers.json`:

```json
{ "controllers": {}, "entrypoints": [] }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/stimulus.test.ts`
Expected: FAIL (local controllers not emitted yet).

- [ ] **Step 4: Add the local loop + helpers** to `src/core/stimulus.ts`

Re-add the imports/constants if you removed them in Task 2: ensure `readdirSync` is imported from `node:fs` and add these constants near `LAZY_COMMENT_RE`:

```ts
const LAZY_COMMENT_RE = /\/\*\s*stimulusFetch:\s*'lazy'\s*\*\//i
const LOCAL_CONTROLLER_RE = /[-_]controller\.[jt]s$/
```

Insert this block in `generateControllersModule` right before `return render(...)`:

```ts
  for (const rel of listLocalControllers(opts.controllersDir)) {
    const abs = path.join(opts.controllersDir, rel)
    const identifier = localIdentifier(rel)
    if (LAZY_COMMENT_RE.test(readFileSync(abs, 'utf8'))) {
      lazy.push(`  ${JSON.stringify(identifier)}: () => import(${JSON.stringify(abs)}),`)
    }
    else {
      const varName = `controller_${index++}`
      imports.push(`import ${varName} from ${JSON.stringify(abs)}`)
      eager.push(`  ${JSON.stringify(identifier)}: ${varName},`)
    }
  }
```

Add these helpers at the bottom of the file:

```ts
function listLocalControllers(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir, { recursive: true }) as unknown as string[]
  }
  catch {
    return [] // dir absent -> no local controllers
  }
  return entries
    .map(e => String(e).replace(/\\/g, '/'))
    .filter(e => LOCAL_CONTROLLER_RE.test(e))
    .sort()
}

function localIdentifier(rel: string): string {
  const base = rel.replace(/\\/g, '/').replace(/[-_]controller\.[jt]s$/, '')
  return base.replace(/_/g, '-').replace(/\//g, '--')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/core/stimulus.test.ts`
Expected: PASS (all third-party + local cases).

- [ ] **Step 6: Lint + commit**

```bash
pnpm lint
git add src/core/stimulus.ts test/core/stimulus.test.ts test/fixtures/stimulus
git commit -m "feat(stimulus): glob local assets/controllers into the virtual module

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 4: Runtime helper + package wiring

**Files:**
- Create: `src/stimulus.ts`
- Create: `src/virtual-modules.d.ts`
- Create: `tsdown.config.ts`
- Modify: `package.json` (exports, peerDeps, devDeps)
- Test: `test/stimulus.test.ts`

**Interfaces:**
- Consumes: `EagerControllersCollection`, `LazyControllersCollection` from `src/types.ts`; `virtual:symfony/controllers`.
- Produces: `startStimulusApp(): Application` and `loadControllers(application, eager, lazy): void`, exported from `@kocal/unplugin-symfony/stimulus`.

- [ ] **Step 1: Install runtime + test deps**

```bash
pnpm add -D @hotwired/stimulus jsdom
```

- [ ] **Step 2: Create the virtual-module declaration** `src/virtual-modules.d.ts`

```ts
declare module 'virtual:symfony/controllers' {
  import type { EagerControllersCollection, LazyControllersCollection } from './types'

  export const eagerControllers: EagerControllersCollection
  export const lazyControllers: LazyControllersCollection
  export const isApplicationDebug: boolean
}
```

- [ ] **Step 3: Write the failing test** `test/stimulus.test.ts`

```ts
// @vitest-environment jsdom
import { Application, Controller } from '@hotwired/stimulus'
import { describe, expect, it, vi } from 'vitest'
import { loadControllers } from '../src/stimulus'

class Eager extends Controller {}
class Lazy extends Controller {}

describe('loadControllers', () => {
  it('registers eager controllers immediately', () => {
    const app = Application.start()
    const spy = vi.spyOn(app, 'register')
    loadControllers(app, { greet: Eager }, {})
    expect(spy).toHaveBeenCalledWith('greet', Eager)
    app.stop()
  })

  it('loads a lazy controller only when a matching element exists', async () => {
    document.body.innerHTML = `<div data-controller="heavy"></div>`
    const app = Application.start()
    const spy = vi.spyOn(app, 'register')
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { heavy: loader })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('heavy', Lazy))
    app.stop()
  })

  it('does not load a lazy controller that is absent from the DOM', () => {
    document.body.innerHTML = `<div></div>`
    const app = Application.start()
    const loader = vi.fn(() => Promise.resolve({ default: Lazy }))
    loadControllers(app, {}, { absent: loader })
    expect(loader).not.toHaveBeenCalled()
    app.stop()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run test/stimulus.test.ts`
Expected: FAIL — cannot resolve `../src/stimulus`.

- [ ] **Step 5: Implement the helper** `src/stimulus.ts` (faithful port of `@symfony/stimulus-bundle`'s loader)

```ts
import type { EagerControllersCollection, LazyControllersCollection } from './types'
import type { Application, ControllerConstructor } from '@hotwired/stimulus'
import { Application as StimulusApplication } from '@hotwired/stimulus'
import { eagerControllers, isApplicationDebug, lazyControllers } from 'virtual:symfony/controllers'

const CONTROLLER_ATTRIBUTE = 'data-controller'

export function startStimulusApp(): Application {
  const application = StimulusApplication.start()
  application.debug = isApplicationDebug
  loadControllers(application, eagerControllers, lazyControllers)
  return application
}

export function loadControllers(
  application: Application,
  eager: EagerControllersCollection,
  lazy: LazyControllersCollection,
): void {
  for (const identifier in eager)
    registerController(identifier, eager[identifier], application)
  new StimulusLazyControllerHandler(application, { ...lazy }).start()
}

class StimulusLazyControllerHandler {
  constructor(private application: Application, private lazyControllers: LazyControllersCollection) {}

  start(): void {
    this.lazyLoadExistingControllers(document.documentElement)
    this.lazyLoadNewControllers(document.documentElement)
  }

  private lazyLoadExistingControllers(element: Element): void {
    Array.from(element.querySelectorAll(`[${CONTROLLER_ATTRIBUTE}]`))
      .flatMap(extractControllerNamesFrom)
      .forEach(name => this.loadLazyController(name))
  }

  private loadLazyController(name: string): void {
    const loader = this.lazyControllers[name]
    if (!loader)
      return
    delete this.lazyControllers[name]
    if (!canRegisterController(name, this.application))
      return
    loader()
      .then(module => registerController(name, module.default, this.application))
      .catch(error => console.error(`Error loading controller "${name}":`, error))
  }

  private lazyLoadNewControllers(element: Element): void {
    if (Object.keys(this.lazyControllers).length === 0)
      return
    new MutationObserver((mutations) => {
      for (const { attributeName, target, type } of mutations) {
        if (type === 'attributes' && attributeName === CONTROLLER_ATTRIBUTE && (target as Element).getAttribute(CONTROLLER_ATTRIBUTE))
          extractControllerNamesFrom(target as Element).forEach(name => this.loadLazyController(name))
        else if (type === 'childList')
          this.lazyLoadExistingControllers(target as Element)
      }
    }).observe(element, { attributeFilter: [CONTROLLER_ATTRIBUTE], subtree: true, childList: true })
  }
}

function registerController(identifier: string, controller: ControllerConstructor, application: Application): void {
  if (canRegisterController(identifier, application))
    application.register(identifier, controller)
}

function extractControllerNamesFrom(element: Element): string[] {
  const value = element.getAttribute(CONTROLLER_ATTRIBUTE)
  return value ? value.split(/\s+/).filter(n => n.length > 0) : []
}

function canRegisterController(identifier: string, application: Application): boolean {
  // `router` is internal to Stimulus but stable; it's what @symfony/stimulus-bundle uses.
  return !(application as unknown as { router: { modulesByIdentifier: Map<string, unknown> } }).router.modulesByIdentifier.has(identifier)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run test/stimulus.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 7: Create `tsdown.config.ts`** so the build treats the virtual module as external

The helper statically imports `virtual:symfony/controllers`, which the bundler (tsdown/rolldown) cannot resolve at library-build time. Mark anything under the `virtual:` scheme external:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  external: [/^virtual:/],
})
```

- [ ] **Step 8: Wire `package.json`** — add the export, peer dep, and confirm the build emits `dist/stimulus.mjs`

In `exports`, add the `./stimulus` entry (keep alphabetical with the others):

```jsonc
    "./stimulus": "./dist/stimulus.mjs",
```

In `peerDependencies` add `"@hotwired/stimulus": ">=3"`, and in `peerDependenciesMeta` add `"@hotwired/stimulus": { "optional": true }`.

- [ ] **Step 9: Build + verify the helper entry is emitted**

Run: `pnpm build`
Expected: succeeds; `dist/stimulus.mjs` and `dist/stimulus.d.mts` exist, and `dist/stimulus.mjs` keeps `from "virtual:symfony/controllers"` (not inlined).

Run: `node -e "const fs=require('node:fs'); const s=fs.readFileSync('dist/stimulus.mjs','utf8'); if(!s.includes('virtual:symfony/controllers')) throw new Error('virtual import was bundled away'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 10: Commit**

```bash
pnpm lint
git add src/stimulus.ts src/virtual-modules.d.ts tsdown.config.ts package.json test/stimulus.test.ts pnpm-lock.yaml
git commit -m "feat(stimulus): ship the startStimulusApp() runtime helper

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 5: Vite provisioning — resolveId/load

**Files:**
- Modify: `src/index.ts` (add `configResolved`, `resolveId`, `load` inside the `vite` block; add the virtual-id constants + generator import)
- Create fixtures: `test/fixtures/stimulus-app/controllers.json`, `test/fixtures/stimulus-app/controllers/greet_controller.js`, `test/fixtures/stimulus-app/controllers/heavy_controller.js`, `test/fixtures/stimulus-app/app.js`
- Test: `test/integration/vite-stimulus.test.ts`

**Interfaces:**
- Consumes: `generateControllersModule` (Task 3), `resolved.stimulus` (Task 1).
- Produces: `virtual:symfony/controllers` resolvable in a Vite build/serve when `stimulus` is set.

- [ ] **Step 1: Create the integration fixture** (local-only so no external npm packages are needed; local controllers `import` from `@hotwired/stimulus`, which is installed as a devDep)

`test/fixtures/stimulus-app/controllers.json`:

```json
{ "controllers": {}, "entrypoints": [] }
```

`test/fixtures/stimulus-app/controllers/greet_controller.js`:

```js
import { Controller } from '@hotwired/stimulus'
export default class extends Controller {}
```

`test/fixtures/stimulus-app/controllers/heavy_controller.js`:

```js
/* stimulusFetch: 'lazy' */
import { Controller } from '@hotwired/stimulus'
export default class extends Controller {}
```

`test/fixtures/stimulus-app/app.js`:

```js
import { eagerControllers, lazyControllers } from 'virtual:symfony/controllers'
globalThis.__controllers = { eager: Object.keys(eagerControllers), lazy: Object.keys(lazyControllers) }
```

- [ ] **Step 2: Write the failing test** `test/integration/vite-stimulus.test.ts`

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/vite'

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app')

describe('vite build resolves virtual:symfony/controllers', () => {
  it('bundles local controllers, eager inlined and lazy code-split', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-stim-'))
    await build({
      root: fixture,
      logLevel: 'silent',
      build: { emptyOutDir: true, rollupOptions: { input: { app: join(fixture, 'app.js') } } },
      // stimulus paths are resolved against process.cwd() (the repo root under vitest),
      // so pass an absolute controllers.json path.
      plugins: [Symfony({ outputPath: out, publicPath: '/build/', stimulus: join(fixture, 'controllers.json') })],
    })
    const files = readdirSync(out, { recursive: true }).map(String)
    const appJs = files.find(f => f.startsWith('app') && f.endsWith('.js'))!
    const code = readFileSync(join(out, appJs), 'utf8')
    // eager identifier + lazy identifier both present in the entry
    expect(code).toContain('greet')
    expect(code).toContain('heavy')
    // the lazy controller is code-split into its own chunk
    expect(files.some(f => f.endsWith('.js') && f !== appJs)).toBe(true)
  }, 30_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/integration/vite-stimulus.test.ts`
Expected: FAIL — Rollup error "Could not resolve 'virtual:symfony/controllers'".

- [ ] **Step 4: Implement the Vite hooks** in `src/index.ts`

At the top, add the import and constants:

```ts
import { generateControllersModule } from './core/stimulus'

const VIRTUAL_ID = 'virtual:symfony/controllers'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`
```

Inside `unpluginFactory`, add a mode flag before the `return`:

```ts
  let isDev = false
```

Then, inside the `vite: { ... }` object, add three hooks (alongside `config`, `generateBundle`, `configureServer`):

```ts
      configResolved(config) {
        isDev = config.command === 'serve'
      },

      resolveId(id) {
        if (resolved.stimulus && id === VIRTUAL_ID)
          return RESOLVED_VIRTUAL_ID
      },

      load(id) {
        if (resolved.stimulus && id === RESOLVED_VIRTUAL_ID)
          return generateControllersModule(resolved.stimulus, process.cwd(), isDev)
      },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/integration/vite-stimulus.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + lint + commit**

```bash
pnpm vitest run
pnpm lint
git add src/index.ts test/integration/vite-stimulus.test.ts test/fixtures/stimulus-app
git commit -m "feat(stimulus): serve virtual:symfony/controllers in the Vite adapter

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 6: Rsbuild provisioning — VirtualModulesPlugin

**Files:**
- Modify: `src/rsbuild.ts` (import `rspack` + generator + constants; register the plugin in `modifyRsbuildConfig`; `writeModule` in `onAfterCreateCompiler`)
- Test: `test/integration/rsbuild-stimulus.test.ts`

**Interfaces:**
- Consumes: `generateControllersModule` (Task 3), `resolved.stimulus` (Task 1), `rspack.experiments.VirtualModulesPlugin` (from `@rsbuild/core`).
- Produces: `virtual:symfony/controllers` resolvable in an Rsbuild build/dev when `stimulus` is set.

- [ ] **Step 1: Write the failing test** `test/integration/rsbuild-stimulus.test.ts`

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from 'vitest'
import Symfony from '../../src/rsbuild'

const fixture = join(import.meta.dirname, '../fixtures/stimulus-app')

describe('rsbuild build resolves virtual:symfony/controllers', () => {
  it('bundles local controllers via VirtualModulesPlugin', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ups-rstim-'))
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        source: { entry: { app: join(fixture, 'app.js') } },
        plugins: [Symfony({ outputPath: out, publicPath: '/build/', stimulus: join(fixture, 'controllers.json') })],
      },
    })
    await rsbuild.build()
    const files = readdirSync(out, { recursive: true }).map(String)
    const code = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf8')).join('\n')
    expect(code).toContain('greet')
    expect(code).toContain('heavy')
  }, 60_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/rsbuild-stimulus.test.ts`
Expected: FAIL — module not found for `virtual:symfony/controllers`.

- [ ] **Step 3: Implement the Rsbuild wiring** in `src/rsbuild.ts`

Add imports + constants at the top:

```ts
import { rspack } from '@rsbuild/core'
import { generateControllersModule } from './core/stimulus'

const VIRTUAL_ID = 'virtual:symfony/controllers'
```

Inside `symfony(options)`, after `const resolved = normalizeOptions(options, process.cwd())`, prepare the virtual-module machinery (only when stimulus is configured):

```ts
  const stimulus = resolved.stimulus
  const virtualPath = path.join(process.cwd(), 'node_modules/.unplugin-symfony/controllers.mjs')
  const vmPlugin = stimulus
    ? new rspack.experiments.VirtualModulesPlugin({
        [virtualPath]: 'export const eagerControllers = {}\nexport const lazyControllers = {}\nexport const isApplicationDebug = false\n',
      })
    : null
```

Add `import * as path from 'node:path'` if not already present (the file already imports `node:process`; add `node:path`).

In `api.modifyRsbuildConfig((config) => { ... })`, at the end of the callback add:

```ts
        if (vmPlugin) {
          config.tools ??= {}
          const prev = config.tools.rspack
          const prevList = Array.isArray(prev) ? prev : prev ? [prev] : []
          config.tools.rspack = [
            ...prevList,
            (rspackConfig, { appendPlugins }) => {
              rspackConfig.resolve ??= {}
              rspackConfig.resolve.alias ??= {}
              ;(rspackConfig.resolve.alias as Record<string, string>)[VIRTUAL_ID] = virtualPath
              appendPlugins(vmPlugin)
            },
          ]
        }
```

In `api.onAfterCreateCompiler(({ compiler }) => { ... })`, inside the `for (const c of compilers)` loop, before the existing `c.hooks.done.tap(...)`, add:

```ts
          if (vmPlugin && stimulus)
            vmPlugin.writeModule(virtualPath, generateControllersModule(stimulus, process.cwd(), c.watchMode))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/rsbuild-stimulus.test.ts`
Expected: PASS.

If resolution still fails, the fallback is to alias via `config.source.alias` instead of `resolve.alias`; verify by logging `rspackConfig.resolve.alias` — but the `resolve.alias` route above is the expected one.

- [ ] **Step 5: Full suite + lint + commit**

```bash
pnpm vitest run
pnpm lint
git add src/rsbuild.ts test/integration/rsbuild-stimulus.test.ts
git commit -m "feat(stimulus): serve virtual:symfony/controllers in the Rsbuild adapter

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

### Task 7: User documentation (README)

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Tick the feature in the checklist**

In `README.md`, change:

```md
- [ ] Symfony UX / Stimulus controllers (`controllers.json` + local `assets/controllers/`)
```

to:

```md
- [x] Symfony UX / Stimulus controllers (`controllers.json` + local `assets/controllers/`)
```

- [ ] **Step 2: Add a `## Symfony UX / Stimulus controllers` section** after the install/bundler `<details>` blocks

```md
## Symfony UX / Stimulus controllers

Enable it by pointing the plugin at your `controllers.json` (this is what turns the feature on):

\```ts
Symfony({ stimulus: 'assets/controllers.json' })
// or, to override the local controllers dir:
Symfony({ stimulus: { controllersJson: 'assets/controllers.json', controllersDir: 'assets/controllers' } })
\```

In your entry, swap the AssetMapper import for this plugin's — everything else stays the same:

\```diff
- import { startStimulusApp } from '@symfony/stimulus-bundle'
+ import { startStimulusApp } from '@kocal/unplugin-symfony/stimulus'
  const app = startStimulusApp()
\```

**Local controllers.** Any `assets/controllers/*_controller.{js,ts}` is registered automatically. The filename becomes the identifier (`hello_controller.js` -> `hello`, `admin/user_controller.js` -> `admin--user`). Add `/* stimulusFetch: 'lazy' */` above the class to load it on demand:

\```js
/* stimulusFetch: 'lazy' */
import { Controller } from '@hotwired/stimulus'
export default class extends Controller {}
\```

**Third-party UX packages.** Controllers declared in `controllers.json` work too, but unlike AssetMapper (which vendors them via importmap) a bundler resolves them from `node_modules` — install them with your package manager, exactly like Webpack Encore did:

\```bash
npm install @hotwired/stimulus @symfony/ux-turbo @symfony/ux-leaflet-map
\```
```

(Remove the backslashes before the triple backticks — they are only here to keep this plan's own fences intact.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the Stimulus controllers feature

Claude-Session: https://claude.ai/code/session_0158bmAzeS25EouwusjkLMAc"
```

---

## Notes for the executor

- **Windows paths:** the generator emits absolute local paths inside `import(...)`. `readdirSync(recursive)` yields backslashes on Windows; `listLocalControllers`/`localIdentifier` normalize to `/` for identifiers, but the emitted import path stays native — that is fine for the bundler on Windows. The integration assertions compare against `join(...)` output, so they stay platform-correct.
- **`tsdown.config.ts` reintroduction:** it was removed earlier deliberately; it comes back in Task 4 solely to mark `virtual:` external. Keep it minimal (no `fixedExtension`/format tweaks) so the `.mjs`/`.d.mts` output is unchanged.
- **Internal `application.router`:** the helper reads `application.router.modulesByIdentifier`, which is not in Stimulus's public types — hence the cast in `canRegisterController`. This mirrors `@symfony/stimulus-bundle`'s own loader and is stable across Stimulus 3.x.
- After the last task, run the full gate once more: `pnpm vitest run && pnpm lint && pnpm build`.
