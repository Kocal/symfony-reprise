Symfony Reprise
===============

**EXPERIMENTAL** This bundle is experimental and is likely to change,
or even change drastically.

Webpack Encore gave Symfony first-class asset integration for Webpack.
Symfony Reprise brings the same to `Vite`_ and `Rsbuild`_.

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**,
**JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**,
**minification** and **HMR** on their own, so Symfony Reprise does not
reimplement any of that. It covers only the Symfony-side glue the bundlers
leave out:

- **Multiple entries**: build several independent entry points from one
  config
- ``entrypoints.json``: generated in both build and dev-server modes
- ``manifest.json``: maps each logical filename to its hashed URL
- **Asset versioning**: content-hash cache busting, wired into the manifest
- **File copy**: copy static files into the build, keyed in the manifest
- **Dev server and HMR**: points Twig at the running Vite/Rsbuild server
- **Symfony UX / Stimulus**: registers ``controllers.json`` and local
  controllers, eager or lazy
- **CDN support**: serve built assets from an absolute ``publicPath``
- **Subresource Integrity**: SRI hashes in ``entrypoints.json``

It generates the Encore-compatible ``entrypoints.json`` and ``manifest.json``
that Reprise's own Symfony bundle (``RepriseBundle``, still a stub) reads to
render the ``<script>`` and ``<link>`` tags, wires up the native dev server,
and turns your Stimulus controllers into a running application.

Installation
------------

Install the bundle with Composer and Symfony Flex:

.. code-block:: terminal

    $ composer require symfony/reprise

Then install the npm package:

.. code-block:: terminal

    $ npm install @symfony/reprise --save-dev

Vite
----

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      plugins: [
        Symfony({ /* options */ }),
      ],
    })

Rsbuild
-------

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      plugins: [Symfony({ /* options */ })],
    })

Symfony UX / Stimulus controllers
---------------------------------

This is the Vite/Rsbuild counterpart of what `@symfony/stimulus-bridge`_ did
for Webpack Encore: it turns your ``controllers.json`` into a Stimulus
application, with the same enable step, same helper, same local-controllers
convention.

Enable it by pointing the plugin at your ``controllers.json`` (this is what
turns the feature on):

.. code-block:: javascript

    Symfony({
      stimulus: 'assets/controllers.json',
    })
    // or, to override the local controllers dir:
    Symfony({
      stimulus: {
        controllersJson: 'assets/controllers.json',
        controllersDir: 'assets/controllers',
      },
    })

Then start the app from your entry:

.. code-block:: javascript

    import { startStimulusApp } from '@symfony/reprise/stimulus'

    const app = startStimulusApp()

**Local controllers.** Any ``assets/controllers/*_controller.{js,ts}`` is
registered automatically. The filename becomes the identifier
(``hello_controller.js`` becomes ``hello``, ``admin/user_controller.js``
becomes ``admin--user``). To load a controller on demand, put a
``stimulusFetch: 'lazy'`` comment directly above the class (after the
imports) — a block or a single-line comment both work:

.. code-block:: javascript

    import { Controller } from '@hotwired/stimulus'

    /* stimulusFetch: 'lazy' */
    export default class extends Controller {}

(``// stimulusFetch: 'lazy'`` on the line above the class works too, as does a
preserved ``/*! stimulusFetch: 'lazy' */`` comment — the form tsc and esbuild keep
through minification.)

**Third-party UX packages.** Controllers declared in ``controllers.json`` are
resolved from ``node_modules``, so install them with your package manager, the
same as you would with Webpack Encore:

.. code-block:: terminal

    $ npm install @hotwired/stimulus @symfony/ux-turbo @symfony/ux-leaflet-map

Some packages need a bit of bundler-specific setup on top, the same way they
did under Webpack Encore. UX Leaflet Map, for instance, ships a CSS file meant
for Webpack's loader and needs an alias to the plain CSS build:

.. code-block:: javascript

    // vite.config.ts
    export default defineConfig({
      resolve: {
        alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
        },
      },
    })

Check each package's own docs for this kind of tweak.

File copy
---------

Some assets are referenced by a stable path straight from your templates,
like ``{{ asset('build/images/logo.svg') }}``, rather than imported from
JavaScript or CSS. Point ``copy`` at the directories that hold them and
Reprise copies each file into the build and records it in ``manifest.json``,
so the ``asset()`` helper resolves it to the hashed URL:

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      plugins: [
        Symfony({
          copy: [{ from: 'assets/images', to: 'images' }],
        }),
      ],
    })

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      plugins: [
        Symfony({
          copy: [{ from: 'assets/images', to: 'images' }],
        }),
      ],
    })

``from`` and ``to`` are both required: ``from`` is the source directory (relative
to your project root), ``to`` is the destination prefix used for the manifest key.
Restrict which files are copied with ``pattern``, a regular expression tested
against each file's path relative to ``from`` (by default every file is copied).
``includeSubdirectories`` defaults to ``true``; set it to ``false`` to turn off
recursion.

In build mode, copied files get a content hash in their filename for cache
busting. In dev mode, they're copied verbatim, no hash. Either way, they land in
``public/build`` and are served by the Symfony web server, not by the Vite/Rsbuild
dev server, so they're available whether or not the dev server is running.

Using a CDN
-----------

To serve your built assets from a CDN, set ``publicPath`` to the absolute CDN
URL, for the production build only. In dev, the dev server serves assets
directly, so keep the local ``/build/`` path there. Both bundlers expose the
mode through the function form of their config, so switch on
``command === 'build'``:

.. code-block:: javascript

    // vite.config.ts  (command is 'serve' or 'build')
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig(({ command }) => ({
      plugins: [
        Symfony({
          publicPath:
            command === 'build'
              ? 'https://my-cool-app.com.global.prod.fastly.net/build/'
              : '/build/',
          manifestKeyPrefix: 'build/',
        }),
      ],
    }))

.. code-block:: javascript

    // rsbuild.config.ts  (command is 'dev' or 'build')
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig(({ command }) => ({
      plugins: [
        Symfony({
          publicPath:
            command === 'build'
              ? 'https://my-cool-app.com.global.prod.fastly.net/build/'
              : '/build/',
          manifestKeyPrefix: 'build/',
        }),
      ],
    }))

With an absolute ``publicPath``, ``manifestKeyPrefix`` is **required**: Reprise
has no way to guess the right prefix for the ``manifest.json`` keys, and
throws a clear error if it's missing. Keys stay logical, values point at the
CDN:

.. code-block:: json

    {
      "build/app.js": "https://my-cool-app.com.global.prod.fastly.net/build/app-1a2b3c.js"
    }

``entrypoints.json`` is rewritten the same way, so the ``<script>`` and
``<link>`` tags render with CDN URLs. You still have to upload the built files
to the CDN yourself, or set up origin pull. For a CDN subdirectory, include it
in the URL (``https://my-cool-app.com.global.prod.fastly.net/awesome-website/build/``).

Subresource Integrity
---------------------

When enabled, Reprise adds an ``integrity`` map to ``entrypoints.json`` (asset
URL -> SRI hash). Reprise's Symfony bundle reads that map and renders
``integrity="..."`` on the generated ``<script>`` and ``<link>`` tags, so the
browser refuses any asset whose bytes were tampered with.

The ``integrity`` option takes an object ``{ enabled, algorithms? }``. It only
makes sense for the production build: the dev server serves changing
in-memory assets, so no hashes are emitted in dev. As with the CDN example,
toggle it with ``command === 'build'``:

.. code-block:: javascript

    // vite.config.ts  (command is 'serve' or 'build')
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig(({ command }) => ({
      plugins: [
        Symfony({
          integrity: { enabled: command === 'build', algorithms: ['sha384'] },
        }),
      ],
    }))

.. code-block:: javascript

    // rsbuild.config.ts  (command is 'dev' or 'build')
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig(({ command }) => ({
      plugins: [
        Symfony({
          integrity: { enabled: command === 'build', algorithms: ['sha384'] },
        }),
      ],
    }))

``algorithms`` is optional and defaults to ``['sha384']``. Accepted values are
``'sha256'``, ``'sha384'`` and ``'sha512'``. Passing several (e.g.
``['sha256', 'sha512']``) writes multiple space-separated hashes per file,
which the browser treats as "any one of these must match".

The resulting ``entrypoints.json`` gets an extra ``integrity`` section:

.. code-block:: json

    {
      "integrity": {
        "/build/app-1a2b3c.js": "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K...",
        "/build/app-4d5e6f.css": "sha384-9ehJ4G8v3aQ2p1o0..."
      }
    }

Hashes cover every referenced file in each entry (js, css, and
preloaded/dynamic chunks), and since they're computed from the files actually
written to disk, they stay correct through minification and hashing.

.. _Vite: https://vite.dev/
.. _Rsbuild: https://rsbuild.dev/
.. _`@symfony/stimulus-bridge`: https://github.com/symfony/stimulus-bridge
