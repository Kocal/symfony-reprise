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
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Exception\EntrypointNotFoundException;
use Symfony\Reprise\Exception\EntrypointsFileNotFoundException;
use Symfony\Reprise\Exception\InvalidEntrypointsException;

final class EntrypointsLookupTest extends TestCase
{
    private function lookup(bool $strictMode = true, string $file = 'build/entrypoints.json'): EntrypointsLookup
    {
        return new EntrypointsLookup(__DIR__.'/../fixtures/'.$file, $strictMode);
    }

    public function testResolvesAnEntrysFilesByType()
    {
        $lookup = $this->lookup();

        $this->assertSame(['/build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
        $this->assertSame(['/build/app-c3d4.css'], $lookup->getCssFiles('app'));
        $this->assertSame(['/build/shared-e5f6.js'], $lookup->getPreloadFiles('app'));
        $this->assertSame(['/build/lazy-x.js'], $lookup->getDynamicFiles('app'));
    }

    public function testDeduplicatesSharedFilesAcrossCalls()
    {
        $lookup = $this->lookup();

        // app pulls the shared preload chunk...
        $this->assertSame(['/build/shared-e5f6.js'], $lookup->getPreloadFiles('app'));
        // ...admin references the same chunk, but it must not be emitted twice on one page.
        $this->assertSame([], $lookup->getPreloadFiles('admin'));
        $this->assertSame(['/build/admin-99.js'], $lookup->getJavaScriptFiles('admin'));
    }

    public function testResetClearsDeduplicationState()
    {
        $lookup = $this->lookup();

        $lookup->getPreloadFiles('app');
        $lookup->reset();

        $this->assertSame(['/build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testEntryExists()
    {
        $lookup = $this->lookup();

        $this->assertTrue($lookup->entryExists('app'));
        $this->assertFalse($lookup->entryExists('nope'));
    }

    public function testExposesModeAndIntegrity()
    {
        $lookup = $this->lookup();

        $this->assertTrue($lookup->isProd());
        $this->assertNull($lookup->getDevServer());
        $this->assertSame('sha384-app', $lookup->getIntegrityData()['/build/app-a1b2.js']);
    }

    public function testExposesTheDevServerAndDevModeForAServeFlavouredFile()
    {
        $lookup = $this->lookup(file: 'dev/entrypoints.json');

        $this->assertFalse($lookup->isProd());
        $this->assertSame([], $lookup->getIntegrityData());
        $this->assertSame(['http://127.0.0.1:5173/build/app.js'], $lookup->getJavaScriptFiles('app'));

        $devServer = $lookup->getDevServer();
        $this->assertNotNull($devServer);
        $this->assertSame('http://127.0.0.1:5173', $devServer->origin);
        $this->assertSame('vite', $devServer->client);
    }

    public function testThrowsWhenTheFileIsNotAJsonObject()
    {
        $this->expectException(InvalidEntrypointsException::class);

        $this->lookup(file: 'malformed/entrypoints.json')->getJavaScriptFiles('app');
    }

    public function testStrictModeThrowsOnUnknownEntry()
    {
        $this->expectException(EntrypointNotFoundException::class);

        $this->lookup()->getJavaScriptFiles('nope');
    }

    public function testNonStrictModeReturnsEmptyForUnknownEntry()
    {
        $this->assertSame([], $this->lookup(strictMode: false)->getJavaScriptFiles('nope'));
    }

    public function testStrictModeThrowsOnMissingFile()
    {
        $this->expectException(EntrypointsFileNotFoundException::class);

        $this->lookup(file: 'does-not-exist/entrypoints.json')->getJavaScriptFiles('app');
    }

    public function testNonStrictModeIsQuietOnMissingFile()
    {
        $lookup = $this->lookup(strictMode: false, file: 'does-not-exist/entrypoints.json');

        $this->assertSame([], $lookup->getJavaScriptFiles('app'));
        $this->assertFalse($lookup->entryExists('app'));
    }
}
