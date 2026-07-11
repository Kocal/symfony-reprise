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
 * The parsed contents of an entrypoints.json file emitted by the @symfony/reprise plugin.
 *
 * Unlike Webpack Encore's format, the file is self-describing: it carries the build mode
 * (`isProd`/`devServer`), the `publicPath`, per-entry `preload`/`dynamic` chunks and, when
 * SRI is enabled, an `integrity` map keyed by asset URL.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class Entrypoints
{
    /**
     * @param array<string, Entry>  $entryPoints
     * @param array<string, string> $integrity
     */
    public function __construct(
        public readonly bool $isProd,
        public readonly ?DevServer $devServer,
        public readonly string $publicPath,
        public readonly array $entryPoints,
        public readonly array $integrity,
    ) {
    }

    /**
     * Validate and hydrate the raw decoded contents of an entrypoints.json file.
     *
     * The input is untrusted (whatever `json_decode()` produced), so it is deliberately typed
     * loosely -- checking its shape is this method's job. Precision instead lives on the value
     * object's properties and on the file-format documented on the class.
     *
     * @param array<mixed, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $isProd = $data['isProd'] ?? null;
        if (!\is_bool($isProd)) {
            throw new InvalidEntrypointsException('The "isProd" key must be a boolean.');
        }

        $publicPath = $data['publicPath'] ?? null;
        if (!\is_string($publicPath)) {
            throw new InvalidEntrypointsException('The "publicPath" key must be a string.');
        }

        $rawEntries = $data['entryPoints'] ?? null;
        if (!\is_array($rawEntries)) {
            throw new InvalidEntrypointsException('The "entryPoints" key must be an object.');
        }

        $entryPoints = [];
        foreach ($rawEntries as $name => $files) {
            if (!\is_array($files)) {
                throw new InvalidEntrypointsException(\sprintf('Entry "%s" must be an object.', (string) $name));
            }
            $entryPoints[(string) $name] = Entry::fromArray($files, (string) $name);
        }

        $devServer = $data['devServer'] ?? null;
        if (null !== $devServer && !\is_array($devServer)) {
            throw new InvalidEntrypointsException('The "devServer" key must be an object or null.');
        }

        $rawIntegrity = $data['integrity'] ?? [];
        if (!\is_array($rawIntegrity)) {
            throw new InvalidEntrypointsException('The "integrity" key must be an object.');
        }
        $integrity = [];
        foreach ($rawIntegrity as $url => $hash) {
            if (!\is_string($url) || !\is_string($hash)) {
                throw new InvalidEntrypointsException('The "integrity" map must map asset URLs to hash strings.');
            }
            $integrity[$url] = $hash;
        }

        return new self(
            $isProd,
            null !== $devServer ? DevServer::fromArray($devServer) : null,
            $publicPath,
            $entryPoints,
            $integrity,
        );
    }
}
