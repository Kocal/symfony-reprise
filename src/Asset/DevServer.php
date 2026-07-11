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
 * The dev-server section of a serve-mode entrypoints.json.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
final class DevServer
{
    public function __construct(
        public readonly string $origin,
        public readonly ?string $client,
    ) {
    }

    /**
     * @param array<mixed, mixed> $data the raw, untrusted decoded "devServer" section
     */
    public static function fromArray(array $data): self
    {
        $origin = $data['origin'] ?? null;
        if (!\is_string($origin)) {
            throw new InvalidEntrypointsException('The dev-server "origin" must be a string.');
        }

        $client = $data['client'] ?? null;
        if (null !== $client && !\is_string($client)) {
            throw new InvalidEntrypointsException('The dev-server "client" must be a string or null.');
        }

        return new self($origin, $client);
    }
}
