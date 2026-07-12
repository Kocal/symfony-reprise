<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Functional;

use PHPUnit\Framework\TestCase;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class DevAssetTagsTest extends TestCase
{
    private function renderer(string $fixture): TagRenderer
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/'.$fixture);
        $kernel->boot();

        return $kernel->getContainer()->get('reprise.tag_renderer');
    }

    public function testViteDevInjectsTheHmrClientAndServesFromTheOrigin()
    {
        // Vite dev emits the HMR client URL (served under `base`, so `/build/@vite/client`); it is
        // injected once, before the entry script, whose src is the dev-server origin URL passed
        // through by Packages unchanged.
        $expected = <<<'HTML'
            <script type="module" src="http://127.0.0.1:5173/build/@vite/client"></script><script src="http://127.0.0.1:5173/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev')->renderScriptTags('app'));
    }

    public function testRsbuildDevServesFromTheOriginWithNoClientInjection()
    {
        // Rsbuild dev emits `client: null` (its HMR client is compiled into the bundle), so nothing
        // is injected; the entry script still loads from the dev-server origin.
        $expected = <<<'HTML'
            <script src="http://127.0.0.1:3000/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev-rspack')->renderScriptTags('app'));
    }
}
