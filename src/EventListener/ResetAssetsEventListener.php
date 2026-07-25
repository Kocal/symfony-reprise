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
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\FinishRequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Contracts\Service\ResetInterface;

/**
 * Resets the per-request asset state (every build's lookup dedup set and the renderer's injected clients)
 * once the main request finishes, so a long-running worker (FrankenPHP, RoadRunner, ...) starts afresh,
 * and on an exception before ErrorListener renders the error page, so that page still gets the full tag set.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class ResetAssetsEventListener implements EventSubscriberInterface
{
    /**
     * @param iterable<ResetInterface> $resettables
     */
    public function __construct(
        private readonly iterable $resettables,
    ) {
    }

    public function onFinishRequest(FinishRequestEvent $event): void
    {
        if ($event->isMainRequest()) {
            $this->reset();
        }
    }

    public function onException(ExceptionEvent $event): void
    {
        $this->reset();
    }

    /**
     * @return array<string, string>
     */
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::FINISH_REQUEST => 'onFinishRequest',
            KernelEvents::EXCEPTION => 'onException',
        ];
    }

    private function reset(): void
    {
        foreach ($this->resettables as $resettable) {
            $resettable->reset();
        }
    }
}
