Symfony Reprise
===============

**EXPERIMENTAL** This bundle is experimental and is likely to change,
or even change drastically.

Webpack Encore gave Symfony first-class asset integration for Webpack. Symfony Reprise brings the same to `Vite`_
and `Rsbuild`_.

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**, **JSX/Vue/Svelte**, **code splitting**,
**content hashing**, **source maps**, **minification** and **HMR** on their own, so Symfony Reprise does not
reimplement any of that. It covers only the Symfony-side glue the bundlers leave out:

- **Multiple entries**: build several independent entry points from one config
- ``entrypoints.json``: generated in both build and dev-server modes
- ``manifest.json``: maps each logical filename to its hashed URL
- **Asset versioning**: content-hash cache busting, wired into the manifest
- **File copy**: copy static files into the build, keyed in the manifest
- **Dev server and HMR**: points Twig at the running Vite/Rsbuild server
- **Twig tag rendering**: ``reprise_entry_script_tags``/``reprise_entry_link_tags`` render straight from
  ``entrypoints.json``
- **Symfony UX / Stimulus**: registers ``controllers.json`` and local controllers, eager or lazy
- **CDN support**: serve built assets from an absolute ``publicPath``
- **Subresource Integrity**: SRI hashes in ``entrypoints.json``

It generates the Encore-compatible ``entrypoints.json`` and ``manifest.json`` that ``RepriseBundle`` reads to render
the ``<script>`` and ``<link>`` tags, wires up the native dev server, and turns your Stimulus controllers into a
running application.

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
        Symfony({
          // options
        }),
      ],
    })

Rsbuild
-------

.. code-block:: javascript

    // rsbuild.config.ts
    import { defineConfig } from '@rsbuild/core'
    import Symfony from '@symfony/reprise/rsbuild'

    export default defineConfig({
      plugins: [
        Symfony({
          // options
        }),
      ],
    })

Rendering asset tags
--------------------

This is where Reprise pays off: once ``entrypoints.json`` exists, ``RepriseBundle`` reads it and renders the
``<script>`` and ``<link>`` tags for an entry directly in Twig, the same experience `WebpackEncoreBundle`_ gives you
with ``encore_entry_script_tags`` and ``encore_entry_link_tags``.

Four Twig functions come with it:

.. code-block:: twig

    {# templates/base.html.twig #}
    <!DOCTYPE html>
    <html>
        <head>
            <meta charset="UTF-8">
            <title>{% block title %}Welcome!{% endblock %}</title>
            <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22><text y=%221.2em%22 font-size=%2296%22>⚫️</text><text y=%221.3em%22 x=%220.2em%22 font-size=%2276%22 fill=%22%23fff%22>sf</text></svg>">
            {% block stylesheets %}
                {{ reprise_entry_link_tags('app') }}
            {% endblock %}

            {% block javascripts %}
                {# reprise_entry_script_tags renders <script type="module"> (ESM output from both Vite and Rsbuild) #}
                {{ reprise_entry_script_tags('app') }}
            {% endblock %}
        </head>
        <body>
            {% block body %}{% endblock %}
        </body>
    </html>

``reprise_entry_js_files('app')`` and ``reprise_entry_css_files('app')`` are the same lookup, minus the HTML: they
return the raw URL lists, for the rare case where you need the paths rather than the tags.

If you're migrating from Webpack Encore, it's a tag-for-tag swap (Reprise is Encore's heritage, so the template
shape hasn't changed):

.. list-table::
   :header-rows: 1

   * - Webpack Encore
     - Symfony Reprise
     - Output
   * - ``encore_entry_link_tags('app')``
     - ``reprise_entry_link_tags('app')``
     - ``<link rel="stylesheet">`` tags
   * - ``encore_entry_script_tags('app')``
     - ``reprise_entry_script_tags('app')``
     - ``<script type="module">`` tags
   * - ``encore_entry_css_files('app')``
     - ``reprise_entry_css_files('app')``
     - CSS URL list
   * - ``encore_entry_js_files('app')``
     - ``reprise_entry_js_files('app')``
     - JS URL list

**Nothing to set up for the common case.** The tags resolve against Symfony's default asset package, so a standard
project needs nothing beyond installing the bundle (see `Configuration`_ below for the options). The snippet is the
same whether Vite or Rsbuild produced ``entrypoints.json``, and there's nothing to configure for dev either: in dev
``reprise_entry_script_tags`` injects the Vite HMR client automatically, while under Rsbuild the client is compiled
into the bundle.

Configuration
-------------

Reprise exposes a few optional settings under its own configuration, all shown here at their default value:

.. code-block:: yaml

    # config/packages/reprise.yaml
    reprise:
        # Directory the @symfony/reprise plugin writes entrypoints.json and manifest.json into.
        output_path: '%kernel.project_dir%/public/build'

        # Throw when entrypoints.json or a requested entry is missing, instead of rendering nothing.
        strict_mode: true

        # A framework.assets package name used to resolve entry URLs. null uses the default package.
        asset_package: null

        # crossorigin attribute set alongside SRI integrity: false, 'anonymous' or 'use-credentials'.
        crossorigin: false

        # Register rendered assets as WebLink HTTP/2 Link: preload headers (needs symfony/web-link).
        preload: true

        # Default attributes added to every rendered <script> / <link> tag.
        script_attributes: []
        link_attributes: []

- ``output_path``: filesystem directory holding ``entrypoints.json`` and ``manifest.json``. Must match the plugin's
  own ``outputPath``.
- ``strict_mode``: when ``true`` (the default), throws a clear exception on a missing file or an unknown entry; when
  ``false``, renders nothing instead.
- ``asset_package``: resolve entry URLs through a specific ``framework.assets`` package instead of the default one.
  You only need this if your default package applies a version strategy, which would re-hash files Reprise already
  content-hashed and break the URLs. Point it at a package with ``version: false`` (see below).
- ``crossorigin``: ``false``, ``'anonymous'`` or ``'use-credentials'`` (any other value is a configuration error),
  applied together with SRI integrity (see `Subresource Integrity`_).
- ``preload``: emit WebLink HTTP/2 ``Link:`` preload headers when `symfony/web-link`_ is installed; ``false`` to
  disable.
- ``script_attributes`` / ``link_attributes``: maps of default attributes added to every generated tag, e.g.
  ``defer: true`` or ``data-turbo-track: reload``.

If you set ``asset_package``, define that package with ``version: false``:

.. code-block:: yaml

    reprise:
        asset_package: reprise

    framework:
        assets:
            packages:
                reprise:
                    version: false

Symfony UX / Stimulus controllers
---------------------------------

This is the Vite/Rsbuild counterpart of what `@symfony/stimulus-bridge`_ did for Webpack Encore: it turns your
``controllers.json`` into a Stimulus application, with the same enable step, same helper, same local-controllers
convention.

Enable it by pointing the plugin at your ``controllers.json`` (this is what turns the feature on):

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

**Local controllers.** Any ``assets/controllers/*_controller.{js,ts}`` is registered automatically. The filename
becomes the identifier (``hello_controller.js`` becomes ``hello``, ``admin/user_controller.js`` becomes
``admin--user``). To load a controller on demand, put a ``stimulusFetch: 'lazy'`` comment directly above the
class; a block or a single-line comment both work.

.. code-block:: javascript

    import { Controller } from '@hotwired/stimulus'

    /* stimulusFetch: 'lazy' */
    export default class extends Controller {}

(``// stimulusFetch: 'lazy'`` on the line above the class works too, as does a preserved
``/*! stimulusFetch: 'lazy' */`` comment: the form tsc and esbuild keep through minification.)

**Third-party UX packages.** Controllers declared in ``controllers.json`` are resolved from ``node_modules``, so
install them with your package manager, the same as you would with Webpack Encore. For example, with Stimulus and
UX Leaflet Map:

.. code-block:: terminal

    $ npm install @hotwired/stimulus @symfony/ux-leaflet-map

Some packages need a bit of bundler-specific setup on top, the same way they did under Webpack Encore. UX Leaflet
Map, for instance, ships a CSS file meant for Webpack's loader and needs an alias to the plain CSS build:

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

Some assets are referenced by a stable path straight from your templates, like
``{{ asset('build/images/logo.svg') }}``, rather than imported from JavaScript or CSS. Point ``copy`` at the
directories that hold them and Reprise copies each file into the build and records it in ``manifest.json``, so the
``asset()`` helper resolves it to the hashed URL:

.. code-block:: javascript

    // vite.config.ts
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig({
      plugins: [
        Symfony({
          copy: [
            {
              from: 'assets/images',
              to: 'images',
            },
          ],
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
          copy: [
            {
              from: 'assets/images',
              to: 'images',
            },
          ],
        }),
      ],
    })

``from`` and ``to`` are both required: ``from`` is the source directory (relative to your project root), ``to`` is
the destination prefix used for the manifest key. Restrict which files are copied with ``pattern``, a regular
expression tested against each file's path relative to ``from`` (by default every file is copied).
``includeSubdirectories`` defaults to ``true``; set it to ``false`` to turn off recursion.

How copied files are handled depends on the mode:

- **Build**: each file gets a content hash in its filename for cache busting.
- **Dev**: files are copied verbatim, no hash.

Either way they land in ``public/build`` and are served by the Symfony web server, not the Vite/Rsbuild dev server,
so they're available whether or not the dev server is running.

Using a CDN
-----------

To serve your built assets from a CDN, set ``publicPath`` to the absolute CDN URL, for the production build only. In
dev, the dev server serves assets directly, so keep the local ``/build/`` path there. Both bundlers expose the mode
through the function form of their config, so switch on ``command === 'build'``:

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

With an absolute ``publicPath``, ``manifestKeyPrefix`` is **required**: Reprise has no way to guess the right prefix
for the ``manifest.json`` keys, and throws a clear error if it's missing. Keys stay logical, values point at the
CDN:

.. code-block:: json

    {
      "build/app.js": "https://my-cool-app.com.global.prod.fastly.net/build/app-1a2b3c.js"
    }

``entrypoints.json`` is rewritten the same way, so the ``<script>`` and ``<link>`` tags render with CDN URLs. You
still have to upload the built files to the CDN yourself, or set up origin pull. For a CDN subdirectory, include it
in the URL (``https://my-cool-app.com.global.prod.fastly.net/awesome-website/build/``).

Subresource Integrity
---------------------

When enabled, Reprise adds an ``integrity`` map to ``entrypoints.json`` (asset URL -> SRI hash). ``RepriseBundle``
reads that map and renders ``integrity="..."`` on the generated ``<script>`` and ``<link>`` tags, so the browser
refuses any asset whose bytes were tampered with.

The ``integrity`` option takes an object ``{ enabled, algorithms? }``. It only makes sense for the production build:
the dev server serves changing in-memory assets, so no hashes are emitted in dev. As with the CDN example, toggle it
with ``command === 'build'``:

.. code-block:: javascript

    // vite.config.ts  (command is 'serve' or 'build')
    import { defineConfig } from 'vite'
    import Symfony from '@symfony/reprise/vite'

    export default defineConfig(({ command }) => ({
      plugins: [
        Symfony({
          integrity: {
            enabled: command === 'build',
            algorithms: ['sha384'],
          },
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
          integrity: {
            enabled: command === 'build',
            algorithms: ['sha384'],
          },
        }),
      ],
    }))

``algorithms`` is optional and defaults to ``['sha384']``. Accepted values are ``'sha256'``, ``'sha384'`` and
``'sha512'``. Passing several (e.g. ``['sha256', 'sha512']``) writes multiple space-separated hashes per file, which
the browser treats as "any one of these must match".

The resulting ``entrypoints.json`` gets an extra ``integrity`` section:

.. code-block:: json

    {
      "integrity": {
        "/build/app-1a2b3c.js": "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K...",
        "/build/app-4d5e6f.css": "sha384-9ehJ4G8v3aQ2p1o0..."
      }
    }

Hashes cover every referenced file in each entry (js, css, and preloaded/dynamic chunks), and since they're computed
from the files actually written to disk, they stay correct through minification and hashing.

.. _Vite: https://vite.dev/
.. _Rsbuild: https://rsbuild.dev/
.. _`@symfony/stimulus-bridge`: https://github.com/symfony/stimulus-bridge
.. _WebpackEncoreBundle: https://github.com/symfony/webpack-encore-bundle
.. _`symfony/web-link`: https://symfony.com/doc/current/web_link.html
