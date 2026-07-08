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

// A controller opts into lazy loading with a `stimulusFetch: 'lazy'` comment above its class,
// as either a block comment (`/* stimulusFetch: 'lazy' */`) or a single-line one
// (`// stimulusFetch: 'lazy'`). Symfony's own bridge accepts both (it parses every comment),
// so we match either marker; quotes may be single or double.
const LAZY_COMMENT_RE = /(?:\/\*|\/\/)\s*stimulusFetch:\s*['"]lazy['"]/i
const LOCAL_CONTROLLER_RE = /[-_]controller\.[jt]s$/

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
