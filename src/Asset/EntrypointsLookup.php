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

use Psr\Cache\CacheItemPoolInterface;
use Symfony\Reprise\Exception\EntrypointNotFoundException;
use Symfony\Reprise\Exception\EntrypointsFileNotFoundException;
use Symfony\Reprise\Exception\InvalidEntrypointsException;

/**
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class EntrypointsLookup implements EntrypointsLookupInterface
{
    private bool $loaded = false;
    private ?Entrypoints $entrypoints = null;

    /**
     * Files already returned this request, kept as a set (name => true) so a chunk shared by
     * several entries (e.g. a preloaded vendor chunk) is emitted only once per page.
     *
     * @var array<string, true>
     */
    private array $returnedFiles = [];

    public function __construct(
        private readonly string $entrypointsPath,
        private readonly bool $strictMode = true,
        private readonly ?CacheItemPoolInterface $cache = null,
        private readonly string $cacheKey = 'reprise.entrypoints',
    ) {
    }

    public function getJavaScriptFiles(string $entryName): array
    {
        return $this->getEntryFiles($entryName, 'js');
    }

    public function getCssFiles(string $entryName): array
    {
        return $this->getEntryFiles($entryName, 'css');
    }

    public function getPreloadFiles(string $entryName): array
    {
        return $this->getEntryFiles($entryName, 'preload');
    }

    public function getDynamicFiles(string $entryName): array
    {
        return $this->getEntryFiles($entryName, 'dynamic');
    }

    public function entryExists(string $entryName): bool
    {
        $entrypoints = $this->getEntrypoints();

        return null !== $entrypoints && isset($entrypoints->entryPoints[$entryName]);
    }

    public function getIntegrityData(): array
    {
        $entrypoints = $this->getEntrypoints();

        return null === $entrypoints ? [] : $entrypoints->integrity;
    }

    public function isProd(): bool
    {
        $entrypoints = $this->getEntrypoints();

        return null !== $entrypoints && $entrypoints->isProd;
    }

    public function getDevServer(): ?DevServer
    {
        $entrypoints = $this->getEntrypoints();

        return null === $entrypoints ? null : $entrypoints->devServer;
    }

    public function reset(): void
    {
        $this->returnedFiles = [];
    }

    /**
     * @param 'js'|'css'|'preload'|'dynamic' $key
     *
     * @return list<string>
     */
    private function getEntryFiles(string $entryName, string $key): array
    {
        $entrypoints = $this->getEntrypoints();
        if (null === $entrypoints) {
            return [];
        }

        $entry = $entrypoints->entryPoints[$entryName] ?? null;
        if (null === $entry) {
            if ($this->strictMode) {
                throw new EntrypointNotFoundException(\sprintf('Could not find the entry "%s" in "%s". Is the entry name correct?', $entryName, $this->entrypointsPath));
            }

            return [];
        }

        $files = match ($key) {
            'js' => $entry->js,
            'css' => $entry->css,
            'preload' => $entry->preload,
            'dynamic' => $entry->dynamic,
        };

        $newFiles = [];
        foreach ($files as $file) {
            if (!isset($this->returnedFiles[$file])) {
                $newFiles[] = $file;
            }
        }
        foreach ($newFiles as $file) {
            $this->returnedFiles[$file] = true;
        }

        return $newFiles;
    }

    private function getEntrypoints(): ?Entrypoints
    {
        if ($this->loaded) {
            return $this->entrypoints;
        }
        $this->loaded = true;

        if (null === $this->cache) {
            return $this->entrypoints = $this->load();
        }

        $item = $this->cache->getItem($this->cacheKey);
        if ($item->isHit()) {
            $entrypoints = $item->get();

            return $this->entrypoints = $entrypoints instanceof Entrypoints ? $entrypoints : null;
        }

        $entrypoints = $this->load();
        $this->cache->save($item->set($entrypoints));

        return $this->entrypoints = $entrypoints;
    }

    private function load(): ?Entrypoints
    {
        if (!is_file($this->entrypointsPath)) {
            if ($this->strictMode) {
                throw new EntrypointsFileNotFoundException(\sprintf('Could not find the entrypoints file "%s". Did the assets get built?', $this->entrypointsPath));
            }

            return null;
        }

        $decoded = json_decode((string) file_get_contents($this->entrypointsPath), true, flags: \JSON_THROW_ON_ERROR);
        if (!\is_array($decoded)) {
            throw new InvalidEntrypointsException(\sprintf('The entrypoints file "%s" must contain a JSON object.', $this->entrypointsPath));
        }

        return Entrypoints::fromArray($decoded);
    }
}
