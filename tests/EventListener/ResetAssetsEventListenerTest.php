<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\EventListener;

use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\FinishRequestEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;

final class ResetAssetsEventListenerTest extends TestCase
{
    private function lookup(): EntrypointsLookup
    {
        return new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json');
    }

    private function finishRequest(int $requestType): FinishRequestEvent
    {
        return new FinishRequestEvent($this->createStub(HttpKernelInterface::class), Request::create('/'), $requestType);
    }

    public function testResetsDeduplicationWhenTheMainRequestFinishes()
    {
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app'); // marks the shared chunk as already returned

        new ResetAssetsEventListener($lookup)->onFinishRequest($this->finishRequest(HttpKernelInterface::MAIN_REQUEST));

        // After the reset the shared chunk is offered again to the next request.
        $this->assertSame(['/build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testIgnoresSubRequests()
    {
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app');

        new ResetAssetsEventListener($lookup)->onFinishRequest($this->finishRequest(HttpKernelInterface::SUB_REQUEST));

        // A sub-request finishing must NOT reset -- the shared chunk stays deduplicated.
        $this->assertSame([], $lookup->getPreloadFiles('admin'));
    }
}
