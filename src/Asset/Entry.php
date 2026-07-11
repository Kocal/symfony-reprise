<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Asset;

use Symfony\Reprise\Exception\InvalidEntrypointsException;

/**
 * One entry's asset URLs, grouped by type, in load order.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class Entry
{
    /**
     * @param list<string> $js
     * @param list<string> $css
     * @param list<string> $preload
     * @param list<string> $dynamic
     */
    public function __construct(
        public readonly array $js,
        public readonly array $css,
        public readonly array $preload,
        public readonly array $dynamic,
    ) {
    }

    /**
     * @param array<mixed, mixed> $data the raw, untrusted decoded entry section
     */
    public static function fromArray(array $data, string $entryName): self
    {
        return new self(
            self::stringList($data['js'] ?? [], $entryName, 'js'),
            self::stringList($data['css'] ?? [], $entryName, 'css'),
            self::stringList($data['preload'] ?? [], $entryName, 'preload'),
            self::stringList($data['dynamic'] ?? [], $entryName, 'dynamic'),
        );
    }

    /**
     * @return list<string>
     */
    private static function stringList(mixed $value, string $entryName, string $key): array
    {
        if (!\is_array($value) || !array_is_list($value)) {
            throw new InvalidEntrypointsException(\sprintf('The "%s" key of entry "%s" must be a list of strings.', $key, $entryName));
        }

        $strings = [];
        foreach ($value as $item) {
            if (!\is_string($item)) {
                throw new InvalidEntrypointsException(\sprintf('The "%s" key of entry "%s" must contain only strings.', $key, $entryName));
            }
            $strings[] = $item;
        }

        return $strings;
    }
}
