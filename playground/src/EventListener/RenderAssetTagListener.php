<?php

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Reprise\Event\RenderAssetTagEvent;

/**
 * Demonstrates RenderAssetTagEvent by stamping a marker attribute onto every rendered
 * <script>/<link>, including the tags Reprise injects itself.
 */
#[AsEventListener]
final class RenderAssetTagListener
{
    public function __invoke(RenderAssetTagEvent $event): void
    {
        $event->attributes['data-rendered-by'] = 'reprise';
    }
}
