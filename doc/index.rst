Symfony Reprise
===============

**EXPERIMENTAL** This bundle is experimental and is likely to change,
or even change drastically.

Webpack Encore gave Symfony first-class asset integration for Webpack.
Symfony Reprise gives you the same integration for `Vite`_ and `Rsbuild`_.

Vite and Rsbuild already handle **Sass/Less/PostCSS**, **TypeScript**,
**JSX/Vue/Svelte**, **code splitting**, **content hashing**, **source maps**,
**minification** and **HMR** on their own, so Symfony Reprise does not
reimplement any of that. It only covers the Symfony-side integration that
bundlers do not provide out of the box:

- Multiple entries
- ``entrypoints.json`` generation (build and dev-server modes)
- ``manifest.json`` generation
- Asset versioning wired into the manifest
- CDN support (absolute ``publicPath``) *(planned)*
- Dev server and HMR integration
- Subresource Integrity (SRI) hashes *(planned)*
- Shared runtime chunk across entries *(planned)*
- Symfony UX / Stimulus controllers (``controllers.json`` and local
  ``assets/controllers/``)

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

(``// stimulusFetch: 'lazy'`` on the line above the class works too.)

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

.. _Vite: https://vite.dev/
.. _Rsbuild: https://rsbuild.dev/
.. _`@symfony/stimulus-bridge`: https://github.com/symfony/stimulus-bridge
