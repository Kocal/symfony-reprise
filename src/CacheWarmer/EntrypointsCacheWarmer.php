<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\CacheWarmer;

use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;
use Symfony\Reprise\Asset\Entrypoints;

/**
 * Parses entrypoints.json once at cache:warmup and compiles the built Entrypoints object into the
 * PhpArrayAdapter file, so the runtime never re-decodes the JSON.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class EntrypointsCacheWarmer implements CacheWarmerInterface
{
    /**
     * @param array<string, string> $entrypointsPaths build name => entrypoints.json path
     */
    public function __construct(
        private readonly array $entrypointsPaths,
        private readonly PhpArrayAdapter $cache,
    ) {
    }

    public function isOptional(): bool
    {
        return true;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        $values = [];
        foreach ($this->entrypointsPaths as $build => $path) {
            if (!is_file($path)) {
                continue;
            }

            try {
                $decoded = json_decode((string) file_get_contents($path), true, flags: \JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $values['reprise.entrypoints.'.$build] = Entrypoints::fromArray($decoded);
                }
            } catch (\Throwable) {
                // A malformed entrypoints.json at deploy time must not break cache:warmup.
            }
        }

        if ($values) {
            $this->cache->warmUp($values);
        }

        return [];
    }
}
