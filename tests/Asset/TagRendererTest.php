<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Asset;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\UrlPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
use Symfony\Reprise\Asset\DevServer;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;

final class TagRendererTest extends TestCase
{
    private function renderer(
        array $js = [],
        array $css = [],
        array $preload = [],
        array $integrity = [],
        ?DevServer $devServer = null,
        string|false $crossorigin = false,
        array $scriptAttributes = [],
        array $linkAttributes = [],
        ?RequestStack $requestStack = null,
        bool $preloadEnabled = true,
        ?Packages $packages = null,
    ): TagRenderer {
        $lookup = new class($js, $css, $preload, $integrity, $devServer) implements EntrypointsLookupInterface {
            public function __construct(
                private array $js,
                private array $css,
                private array $preload,
                private array $integrity,
                private ?DevServer $devServer,
            ) {
            }

            public function getJavaScriptFiles(string $entryName): array
            {
                return $this->js;
            }

            public function getCssFiles(string $entryName): array
            {
                return $this->css;
            }

            public function getPreloadFiles(string $entryName): array
            {
                return $this->preload;
            }

            public function getDynamicFiles(string $entryName): array
            {
                return [];
            }

            public function entryExists(string $entryName): bool
            {
                return true;
            }

            public function getIntegrityData(): array
            {
                return $this->integrity;
            }

            public function isProd(): bool
            {
                return null === $this->devServer;
            }

            public function getDevServer(): ?DevServer
            {
                return $this->devServer;
            }

            public function reset(): void
            {
            }
        };

        $packages ??= new Packages(new PathPackage('/', new EmptyVersionStrategy()));

        return new TagRenderer(
            $lookup,
            $packages,
            $requestStack,
            null,
            $crossorigin,
            $preloadEnabled,
            $scriptAttributes,
            $linkAttributes,
        );
    }

    public function testRendersModuleScriptTagsWithPackagesResolvedSrc()
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertSame('<script src="/build/app-a1b2.js" type="module"></script>', $html);
    }

    public function testRendersStylesheetLinkTags()
    {
        $html = $this->renderer(css: ['build/app-c3.css'])->renderLinkTags('app');
        $this->assertSame('<link rel="stylesheet" href="/build/app-c3.css">', $html);
    }

    public function testAddsIntegrityAndCrossoriginWhenPresent()
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            integrity: ['build/app-a1b2.js' => 'sha384-XYZ'],
        )->renderScriptTags('app');
        $this->assertStringContainsString('integrity="sha384-XYZ"', $html);
        $this->assertStringContainsString('crossorigin="anonymous"', $html);
    }

    public function testNoCrossoriginWithoutIntegrity()
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertStringNotContainsString('crossorigin', $html);
    }

    public function testGetJsFilesReturnsResolvedUrlsWithoutTags()
    {
        $urls = $this->renderer(js: ['build/app-a1b2.js', 'build/vendor-e5.js'])->getJsFiles('app');
        $this->assertSame(['/build/app-a1b2.js', '/build/vendor-e5.js'], $urls);
    }

    public function testScriptAndLinkDefaultAttributesAreApplied()
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true])->renderScriptTags('app');
        $this->assertStringContainsString(' defer', $html);
    }

    public function testInjectsViteHmrClientOncePerRequestInDev()
    {
        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        );

        $first = $renderer->renderScriptTags('app');
        $this->assertSame(
            '<script type="module" src="http://127.0.0.1:5173/build/@vite/client"></script>'
            .'<script src="http://127.0.0.1:5173/build/app.js" type="module"></script>',
            $first,
        );

        // Same request, second call (e.g. a second entry): the client is not injected again.
        $second = $renderer->renderScriptTags('app');
        $this->assertStringNotContainsString('@vite/client', $second);

        // A new request resets the flag and the client is injected again.
        $renderer->reset();
        $this->assertStringContainsString('@vite/client', $renderer->renderScriptTags('app'));
    }

    public function testDoesNotInjectHmrClientWhenDevServerClientIsNull()
    {
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', null),
        )->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function testDoesNotInjectHmrClientInProd()
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function testInjectsReactRefreshPreambleAfterTheClientAndBeforeTheEntryInDev()
    {
        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer(
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5173/build/@vite/client',
                'http://127.0.0.1:5173/build/@react-refresh',
            ),
        );

        $html = $renderer->renderScriptTags('app');

        $this->assertStringContainsString('import RefreshRuntime from "http://127.0.0.1:5173/build/@react-refresh"', $html);
        $this->assertStringContainsString('window.__vite_plugin_react_preamble_installed__ = true', $html);

        // Order matters: the HMR client, then the preamble, then the entry that imports the components.
        $clientPos = strpos($html, '@vite/client');
        $preamblePos = strpos($html, '@react-refresh');
        $entryPos = strpos($html, 'build/app.js');
        $this->assertLessThan($preamblePos, $clientPos);
        $this->assertLessThan($entryPos, $preamblePos);
    }

    public function testDoesNotInjectReactRefreshPreambleWhenNotAReactApp()
    {
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        )->renderScriptTags('app');

        $this->assertStringNotContainsString('@react-refresh', $html);
        $this->assertStringNotContainsString('__vite_plugin_react_preamble_installed__', $html);
    }

    public function testRendersModulepreloadLinksWithIntegrityBeforeScripts()
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            preload: ['build/shared-e5.js'],
            integrity: ['build/shared-e5.js' => 'sha384-shared'],
        )->renderScriptTags('app');

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared-e5.js" integrity="sha384-shared" crossorigin="anonymous">'
            .'<script src="/build/app-a1b2.js" type="module"></script>',
            $html,
        );
    }

    public function testRegistersPreloadLinksOnTheRequestWhenWebLinkIsAvailable()
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $renderer = $this->renderer(
            js: ['build/app-a1b2.js'],
            css: ['build/app-c3.css'],
            preload: ['build/shared-e5.js'],
            requestStack: $stack,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $links = $request->attributes->get('_links');
        $this->assertInstanceOf(GenericLinkProvider::class, $links);

        $byHref = [];
        foreach ($links->getLinks() as $link) {
            $byHref[$link->getHref()] = ['rels' => $link->getRels(), 'as' => $link->getAttributes()['as'] ?? null];
        }

        $this->assertSame(['modulepreload'], $byHref['/build/shared-e5.js']['rels']);
        $this->assertSame(['preload'], $byHref['/build/app-a1b2.js']['rels']);
        $this->assertSame('script', $byHref['/build/app-a1b2.js']['as']);
        $this->assertSame(['preload'], $byHref['/build/app-c3.css']['rels']);
        $this->assertSame('style', $byHref['/build/app-c3.css']['as']);
    }

    public function testDoesNotRegisterLinksWithoutACurrentRequest()
    {
        $renderer = $this->renderer(js: ['build/app-a1b2.js'], requestStack: new RequestStack());

        // No current request pushed: rendering must not throw and returns the tags as usual.
        $this->assertStringContainsString('<script', $renderer->renderScriptTags('app'));
    }

    public function testPreloadToggleDisablesLinkRegistration()
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(js: ['build/app-a1b2.js'], requestStack: $stack, preloadEnabled: false)
            ->renderScriptTags('app');

        $this->assertNull($request->attributes->get('_links'));
    }

    public function testConfiguredCrossoriginOverridesTheAnonymousDefault()
    {
        $html = $this->renderer(
            js: ['build/app.js'],
            integrity: ['build/app.js' => 'sha384-XYZ'],
            crossorigin: 'use-credentials',
        )->renderScriptTags('app');

        $this->assertSame(
            '<script src="/build/app.js" type="module" integrity="sha384-XYZ" crossorigin="use-credentials"></script>',
            $html,
        );
    }

    public function testLinkTagsGetIntegrityAndCrossoriginWhenPresent()
    {
        $html = $this->renderer(
            css: ['build/app.css'],
            integrity: ['build/app.css' => 'sha384-CSS'],
        )->renderLinkTags('app');

        $this->assertSame(
            '<link rel="stylesheet" href="/build/app.css" integrity="sha384-CSS" crossorigin="anonymous">',
            $html,
        );
    }

    public function testResolvesReferencesThroughAnExplicitPackage()
    {
        $packages = new Packages(
            new PathPackage('/', new EmptyVersionStrategy()),
            ['cdn' => new UrlPackage('https://cdn.example.com/', new EmptyVersionStrategy())],
        );

        $html = $this->renderer(js: ['build/app.js'], packages: $packages)->renderScriptTags('app', 'cdn');

        $this->assertSame('<script src="https://cdn.example.com/build/app.js" type="module"></script>', $html);
    }

    public function testGetCssFilesReturnsResolvedUrlsWithoutTags()
    {
        $urls = $this->renderer(css: ['build/a.css', 'build/b.css'])->getCssFiles('app');

        $this->assertSame(['/build/a.css', '/build/b.css'], $urls);
    }

    public function testLinkAttributesAreApplied()
    {
        $html = $this->renderer(css: ['build/app.css'], linkAttributes: ['media' => 'print'])->renderLinkTags('app');

        $this->assertSame('<link rel="stylesheet" href="/build/app.css" media="print">', $html);
    }

    public function testFalseValuedAttributeIsDropped()
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['nomodule' => false])->renderScriptTags('app');

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testAttributeValuesAreHtmlEscaped()
    {
        $html = $this->renderer(
            js: ['build/app.js'],
            scriptAttributes: ['data-payload' => '"><script>alert(1)</script>'],
        )->renderScriptTags('app');

        // Exact match: the raw payload is fully escaped (no attribute-injection XSS) and nothing else
        // leaks into the tag.
        $this->assertSame(
            '<script src="/build/app.js" type="module" data-payload="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"></script>',
            $html,
        );
    }

    public function testAnEntryWithNoFilesRendersAnEmptyString()
    {
        $renderer = $this->renderer();

        $this->assertSame('', $renderer->renderScriptTags('app'));
        $this->assertSame('', $renderer->renderLinkTags('app'));
    }

    public function testRendersEveryScriptInFileOrder()
    {
        // Load order is the whole point of entrypoints.json: the runtime chunk must precede the app
        // chunk, in the exact order the file lists them.
        $html = $this->renderer(js: ['build/runtime.js', 'build/app.js'])->renderScriptTags('app');

        $this->assertSame(
            '<script src="/build/runtime.js" type="module"></script>'
            .'<script src="/build/app.js" type="module"></script>',
            $html,
        );
    }

    public function testRendersEveryStylesheetInFileOrder()
    {
        $html = $this->renderer(css: ['build/a.css', 'build/b.css'])->renderLinkTags('app');

        $this->assertSame(
            '<link rel="stylesheet" href="/build/a.css">'
            .'<link rel="stylesheet" href="/build/b.css">',
            $html,
        );
    }

    public function testModulepreloadHasNoIntegrityWhenTheChunkIsNotHashed()
    {
        // A preload chunk without an SRI entry (e.g. in dev) gets a bare modulepreload link.
        $html = $this->renderer(js: ['build/app.js'], preload: ['build/shared.js'])->renderScriptTags('app');

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared.js">'
            .'<script src="/build/app.js" type="module"></script>',
            $html,
        );
    }
}
