<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Event;

/**
 * Dispatched each time a <script> or <link> tag is rendered, so listeners can add, change or
 * remove attributes (e.g. a CSP nonce) before the tag is written. Covers the entry files, the
 * CSS, and the dev-server tags Reprise injects itself (the HMR client and React preamble).
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class RenderAssetTagEvent
{
    public const TYPE_SCRIPT = 'script';
    public const TYPE_LINK = 'link';

    /**
     * @param array<string, bool|string> $attributes mutable; add/change/remove entries directly
     */
    public function __construct(
        private readonly string $type,
        public array $attributes,
    ) {
    }

    public function isScript(): bool
    {
        return self::TYPE_SCRIPT === $this->type;
    }

    public function isLink(): bool
    {
        return self::TYPE_LINK === $this->type;
    }
}
