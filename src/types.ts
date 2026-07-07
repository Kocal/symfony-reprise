export interface Options {
  /**
   * The directory where your files should be output.
   *
   * If relative (e.g. public/build), it will be set relative
   * to the directory where your package.json lives.
   */
  outputPath?: string

  /**
   * The public version of "outputPath": the public path to "outputPath".
   *
   * For example, if "public" is your document root, then:
   *
   * ```js
   * Symfony({
   *     outputPath: 'public/build',
   *     publicPath: '/build'
   * })
   * ```
   *
   * This can also be set to an absolute URL if you're using
   * a CDN: publicPath is used as the prefix to all asset paths
   * in the manifest.json file and internally in webpack:
   *
   * ```js
   * Symfony({
   *   outputPath: 'public/build',
   *   publicPath: 'https://coolcdn.com'
   *   // needed when public path is absolute
   *   manifestKeyPrefix: '/build'
   * })
   * ```
   */
  publicPath?: string

  /**
   * Used as a prefix to the *keys* in manifest.json. Not usually needed.
   *
   * You don't normally need to set this. When you *do* need to set
   * it, an error will notify you.
   *
   * Typically, "publicPath" is used in the keys inside manifest.json.
   * But if "publicPath" is absolute, then we require you to set this.
   * For example:
   *
   * ```js
   * Symfony({
   *   outputPath: 'public/build',
   *   publicPath: 'https://coolcdn.com/FOO'
   *   manifestKeyPrefix: 'build/'
   * })
   * ```
   *
   * The manifest.json file would look something like this:
   *
   * ```json
   * {
   *     "build/main.js": "https://coolcdn.com/FOO/main.a54f3ccd2.js"
   * }
   * ```
   */
  manifestKeyPrefix?: string

  /**
   * Explicit dev-server origin used in `entrypoints.json` (serve mode),
   * e.g. `http://localhost:5173`. Overrides the auto-detected origin.
   * Useful behind a proxy or when the server binds to `0.0.0.0` (Docker).
   */
  devServerOrigin?: string

  // singleRuntimeChunk?: boolean
  // stimulusBridge?: object
}

export interface ResolvedOptions {
  outputPath: string
  publicPath: string
  manifestKeyPrefix: string
  devServerOrigin?: string
}

export interface EntryFiles {
  js: string[]
  css: string[]
  preload: string[]
  dynamic: string[]
}

export interface DevServer {
  origin: string
  client: 'vite' | null
}

export interface AssetEntry {
  logicalName: string
  fileName: string
}

export interface NormalizedGraph {
  entryPoints: Record<string, EntryFiles>
  assets: AssetEntry[]
}

export interface BuildContext {
  isProd: boolean
  devServer: DevServer | null
  /** Prefix for entry/asset URLs. Equals publicPath in build; origin+publicPath in dev. */
  urlPrefix: string
  /** The configured publicPath, emitted as the top-level `publicPath` field. */
  publicPath: string
  /** Logical key prefix for manifest.json keys. */
  manifestKeyPrefix: string
}

export interface EntrypointsJson {
  isProd: boolean
  devServer: DevServer | null
  publicPath: string
  entryPoints: Record<string, EntryFiles>
}

export type ManifestJson = Record<string, string>
