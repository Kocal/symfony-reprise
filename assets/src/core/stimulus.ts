import type { ResolvedStimulusOptions } from '../types'
import { readdirSync, readFileSync } from 'node:fs'
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

/** The virtual module the runtime helper imports; provided by each bundler adapter. */
export const VIRTUAL_CONTROLLERS_ID = 'virtual:symfony/controllers'

/**
 * Shown when `virtual:symfony/controllers` is imported (typically via `startStimulusApp()`)
 * while the `stimulus` option is unset — instead of the bundler's cryptic
 * "failed to resolve" / "Unhandled scheme" error.
 */
export const STIMULUS_NOT_ENABLED_MESSAGE
  = `[unplugin-symfony] "${VIRTUAL_CONTROLLERS_ID}" was imported (this is what startStimulusApp() `
    + `from "@symfony/reprise/stimulus" pulls in), but the Stimulus integration is not enabled. `
    + `Add \`stimulus: './assets/controllers.json'\` (or your own controllers.json path) to the `
    + `unplugin-symfony plugin options.`

interface ResolvedController {
  identifier: string
  fetch: 'eager' | 'lazy'
  /** Import specifier: a bare package path (third-party) or an absolute file path (local). */
  main: string
  /** Extra modules to import alongside the controller (third-party only). */
  autoimports: string[]
}

// A controller opts into lazy loading with a `stimulusFetch: 'lazy'` comment placed *directly
// above the class declaration* — after the imports, like a decorator:
//
//   import { Controller } from '@hotwired/stimulus'
//
//   /* stimulusFetch: 'lazy' */
//   export default class extends Controller {}
//
// The marker is recognised only when the very next code is the class (`[export [default]] class`),
// which is why a stray `stimulusFetch: 'lazy'` sitting above the imports (or anywhere else) does
// NOT flip the controller to lazy. It may be a block comment or a single-line one, single or
// double quotes; a block comment may sit on the class's own line, a line comment must precede it.
const LAZY_COMMENT_RE = /(?:\/\*\s*stimulusFetch:\s*['"]lazy['"]\s*\*\/|\/\/\s*stimulusFetch:\s*['"]lazy['"])\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\b/i
const LOCAL_CONTROLLER_RE = /[-_]controller\.[jt]s$/

export function generateControllersModule(opts: ResolvedStimulusOptions, root: string, isDev: boolean): string {
  // Collect controllers keyed by identifier. Third-party controllers are added first, local
  // ones second, so a local controller sharing an identifier with a third-party one overrides
  // it (last write wins) and each identifier ends up in exactly one of the two maps — never
  // emitted twice, never registered twice.
  const controllers = new Map<string, ResolvedController>()

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

      const identifier = thirdPartyIdentifier(packageName, controllerName, pkgCfg.name, user.name)
      controllers.set(identifier, {
        identifier,
        fetch: user.fetch ?? pkgCfg.fetch ?? 'eager',
        main: `${packageName}/${pkgCfg.main}`,
        autoimports: Object.entries(user.autoimport ?? pkgCfg.autoimport ?? {}).filter(([, v]) => v).map(([k]) => k),
      })
    }
  }

  for (const rel of listLocalControllers(opts.controllersDir)) {
    const abs = path.join(opts.controllersDir, rel)
    const identifier = localIdentifier(rel)
    controllers.set(identifier, {
      identifier,
      fetch: LAZY_COMMENT_RE.test(readFileSync(abs, 'utf8')) ? 'lazy' : 'eager',
      // Emit a forward-slash path: a valid ESM import specifier on every OS (a Windows
      // backslash path would be escaped in the generated string and is not a portable specifier).
      main: abs.replace(/\\/g, '/'),
      autoimports: [],
    })
  }

  return render([...controllers.values()], isDev)
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

function render(controllers: ResolvedController[], isDev: boolean): string {
  const imports: string[] = []
  const seenAutoimports = new Set<string>()
  const eager: string[] = []
  const lazy: string[] = []
  let index = 0

  for (const c of controllers) {
    if (c.fetch === 'lazy') {
      if (c.autoimports.length) {
        const all = [c.main, ...c.autoimports].map(m => `import(${JSON.stringify(m)})`).join(', ')
        lazy.push(`  ${JSON.stringify(c.identifier)}: () => Promise.all([${all}]).then(r => r[0]),`)
      }
      else {
        lazy.push(`  ${JSON.stringify(c.identifier)}: () => import(${JSON.stringify(c.main)}),`)
      }
    }
    else {
      const varName = `controller_${index++}`
      imports.push(`import ${varName} from ${JSON.stringify(c.main)}`)
      for (const a of c.autoimports) {
        // Two eager controllers can declare the same autoimport; emit each import only once.
        if (!seenAutoimports.has(a)) {
          seenAutoimports.add(a)
          imports.push(`import ${JSON.stringify(a)}`)
        }
      }
      eager.push(`  ${JSON.stringify(c.identifier)}: ${varName},`)
    }
  }

  const lines = [...imports, '']
  lines.push(`export const eagerControllers = {${eager.length ? `\n${eager.join('\n')}\n` : ''}}`)
  lines.push(`export const lazyControllers = {${lazy.length ? `\n${lazy.join('\n')}\n` : ''}}`)
  lines.push(`export const isApplicationDebug = ${isDev ? 'true' : 'false'}`)
  lines.push('')
  return lines.join('\n')
}

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
