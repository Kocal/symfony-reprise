<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\EventListener;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\FinishRequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;

/**
 * Clears the lookup's per-request deduplication state once the main request finishes,
 * so a long-running worker (FrankenPHP, RoadRunner, ...) starts each request afresh.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class ResetAssetsEventListener implements EventSubscriberInterface
{
    public function __construct(
        private readonly EntrypointsLookupInterface $entrypointsLookup,
    ) {
    }

    public function onFinishRequest(FinishRequestEvent $event): void
    {
        if ($event->isMainRequest()) {
            $this->entrypointsLookup->reset();
        }
    }

    /**
     * @return array<string, string>
     */
    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::FINISH_REQUEST => 'onFinishRequest'];
    }
}
