import type { ControllerConstructor } from '@hotwired/stimulus';

export interface Options {
    /**
     * The directory where your files should be output.
     *
     * If relative (e.g. public/build), it will be set relative
     * to the directory where your package.json lives.
     */
    outputPath?: string;

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
    publicPath?: string;

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
    manifestKeyPrefix?: string;

    /**
     * Explicit dev-server origin used in `entrypoints.json` (serve mode),
     * e.g. `http://localhost:5173`. Overrides the auto-detected origin.
     * Useful behind a proxy or when the server binds to `0.0.0.0` (Docker).
     */
    devServerOrigin?: string;

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
    stimulus?: string | StimulusOptions;

    /**
     * Emit Subresource Integrity (SRI) hashes for the built assets.
     *
     * When enabled, `entrypoints.json` gains an `integrity` map (asset URL -> hash),
     * which Reprise's Symfony bundle renders as `integrity="..."` on the script/link tags.
     * Only applies to build mode; the dev server serves changing in-memory assets, so
     * no hashes are emitted there.
     *
     * ```js
     * // enable only for the production build (Vite exposes `command`)
     * Symfony({ integrity: { enabled: command === 'build', algorithms: ['sha384'] } })
     * ```
     */
    integrity?: IntegrityOptions;

    /**
     * Copy static files (images, fonts…) into the build output and register them
     * in manifest.json, so Twig's `asset('<to>/<path>')` resolves to the file URL.
     * Works in both build (content-hashed names) and dev (verbatim names). Files are
     * written under `outputPath` and served by the Symfony web server from `public/`.
     *
     * ```js
     * Symfony({ copy: [{ from: 'assets/images', to: 'images' }] })
     * ```
     */
    copy?: CopyEntry[];
}

/** Hash algorithm used for Subresource Integrity. */
export type IntegrityAlgorithm = 'sha256' | 'sha384' | 'sha512';

export interface IntegrityOptions {
    /** Turn SRI on or off. Off by default. */
    enabled: boolean;
    /** Algorithms to hash each asset with. Default: `['sha384']`. */
    algorithms?: IntegrityAlgorithm[];
}

export interface StimulusOptions {
    /** Path to `controllers.json`, e.g. `assets/controllers.json`. */
    controllersJson: string;
    /** Local controllers dir. Default: `<dir of controllersJson>/controllers`. */
    controllersDir?: string;
}

export interface ResolvedStimulusOptions {
    /** Absolute path to controllers.json. */
    controllersJson: string;
    /** Absolute path to the local controllers directory. */
    controllersDir: string;
}

export interface CopyEntry {
    /** Source directory, relative to the project root (cwd) or absolute. */
    from: string;
    /** Logical destination prefix used for the manifest key (e.g. `images`). */
    to: string;
    /** Only files whose path relative to `from` matches this regex are copied. Default: every file. */
    pattern?: RegExp;
    /** Recurse into subdirectories of `from`. Default: true. */
    includeSubdirectories?: boolean;
}

export interface ResolvedCopyEntry {
    from: string;
    to: string;
    pattern: RegExp;
    includeSubdirectories: boolean;
}

/** Map of Stimulus identifier -> controller class (registered eagerly). */
export type EagerControllersCollection = Record<string, ControllerConstructor>;
/** Map of Stimulus identifier -> dynamic-import factory (registered lazily). */
export type LazyControllersCollection = Record<string, () => Promise<{ default: ControllerConstructor }>>;

export interface ResolvedOptions {
    outputPath: string;
    publicPath: string;
    manifestKeyPrefix: string;
    devServerOrigin?: string;
    stimulus?: ResolvedStimulusOptions;
    /** Present (with a non-empty algorithm list) only when SRI is enabled. */
    integrity?: { algorithms: string[] };
    copy: ResolvedCopyEntry[];
}

export interface EntryFiles {
    js: string[];
    css: string[];
    preload: string[];
    dynamic: string[];
}

export interface DevServer {
    origin: string;
    /**
     * URL of the HMR client script to inject (Vite serves it under `base`, e.g.
     * `http://127.0.0.1:5173/build/@vite/client`), or `null` when the bundler compiles its client
     * into the entry (Rsbuild) so nothing extra needs to be rendered.
     */
    client: string | null;
    /**
     * URL of Vite's React Fast Refresh runtime (`@react-refresh`) to inject as a preamble before
     * the entry in dev, set when `@vitejs/plugin-react` is used. `@vitejs/plugin-react` cannot inject
     * this itself when Symfony renders the HTML (backend integration). `null`/absent otherwise, and
     * always under Rsbuild, which wires React refresh into the bundle itself.
     */
    reactRefresh?: string | null;
}

export interface AssetEntry {
    logicalName: string;
    fileName: string;
}

export interface NormalizedGraph {
    entryPoints: Record<string, EntryFiles>;
    assets: AssetEntry[];
    /** SRI hash per emitted file name; set by the collectors only when SRI is enabled. */
    integrity?: Record<string, string>;
}

export interface BuildContext {
    isProd: boolean;
    devServer: DevServer | null;
    /** Prefix for entry/asset URLs. Equals publicPath in build; origin+publicPath in dev. */
    urlPrefix: string;
    /** The configured publicPath, emitted as the top-level `publicPath` field. */
    publicPath: string;
    /** Logical key prefix for manifest.json keys. */
    manifestKeyPrefix: string;
}

export interface EntrypointsJson {
    isProd: boolean;
    devServer: DevServer | null;
    publicPath: string;
    entryPoints: Record<string, EntryFiles>;
    /** SRI hash per asset URL; present only in build mode with SRI enabled. */
    integrity?: Record<string, string>;
}

export type ManifestJson = Record<string, string>;
