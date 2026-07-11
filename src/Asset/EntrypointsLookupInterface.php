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

/**
 * Reads a single entrypoints.json file and resolves each entry's asset URLs.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 */
interface EntrypointsLookupInterface
{
    /**
     * @return list<string>
     */
    public function getJavaScriptFiles(string $entryName): array;

    /**
     * @return list<string>
     */
    public function getCssFiles(string $entryName): array;

    /**
     * @return list<string>
     */
    public function getPreloadFiles(string $entryName): array;

    /**
     * @return list<string>
     */
    public function getDynamicFiles(string $entryName): array;

    public function entryExists(string $entryName): bool;

    /**
     * @return array<string, string>
     */
    public function getIntegrityData(): array;

    public function isProd(): bool;

    public function getDevServer(): ?DevServer;

    /**
     * Clears the per-request deduplication state.
     */
    public function reset(): void;
}
