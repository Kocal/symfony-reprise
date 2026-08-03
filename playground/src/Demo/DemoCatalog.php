<?php

declare(strict_types=1);

namespace App\Demo;

final class DemoCatalog
{
    /** @return list<array<string, mixed>> */
    public function features(): array
    {
        return [
            ['slug' => 'multiple-entries', 'icon' => '🧩', 'title' => 'Multiple entries', 'description' => 'A second Reprise entrypoint ("admin") loaded only on its own page.', 'route' => 'admin', 'params' => []],
            ['slug' => 'code-splitting', 'icon' => '✂️', 'title' => 'Code splitting', 'description' => 'A dynamic import() ships as its own chunk, listed in entrypoints.json → dynamic.', 'route' => 'feature_code_splitting', 'params' => []],
            ['slug' => 'scss-typescript', 'icon' => '🎨', 'title' => 'Tailwind · SCSS · TS', 'description' => 'Tailwind, SCSS and TypeScript — all compiled by the bundler, not by Reprise.', 'route' => 'feature_scss_ts', 'params' => []],
            ['slug' => 'copied-files', 'icon' => '🗂️', 'title' => 'Copied files', 'description' => 'Static files copied into the build and served through asset() + manifest.json.', 'route' => 'feature_copied_files', 'params' => []],
            ['slug' => 'build-contract', 'icon' => '📄', 'title' => 'Build contract', 'description' => 'The live entrypoints.json and manifest.json that Reprise generates.', 'route' => 'feature_build_contract', 'params' => []],
        ];
    }

    /** @return list<array<string, mixed>> */
    public function ux(): array
    {
        return array_map(
            static fn (array $demo): array => $demo + ['route' => 'demo', 'params' => ['slug' => $demo['slug']]],
            [
                ['slug' => 'react', 'icon' => '⚛️', 'title' => 'UX React', 'description' => 'Render an interactive React component from Twig.'],
                ['slug' => 'vue', 'icon' => '💚', 'title' => 'UX Vue', 'description' => 'Render an interactive Vue component from Twig.'],
                ['slug' => 'chartjs', 'icon' => '📊', 'title' => 'UX Chart.js', 'description' => 'A Chart.js chart built in PHP, rendered on the client.'],
                ['slug' => 'autocomplete', 'icon' => '🔎', 'title' => 'UX Autocomplete', 'description' => 'A searchable select powered by Tom Select.'],
                ['slug' => 'dropzone', 'icon' => '📤', 'title' => 'UX Dropzone', 'description' => 'A styled drag-and-drop file input.'],
                ['slug' => 'cropperjs', 'icon' => '🖼️', 'title' => 'UX Cropper.js', 'description' => 'Crop an image right in the browser.'],
                ['slug' => 'map', 'icon' => '🗺️', 'title' => 'UX Map', 'description' => 'An interactive Leaflet map with a marker.'],
                ['slug' => 'icons', 'icon' => '✨', 'title' => 'UX Icons', 'description' => 'Inline SVG icons pulled from several icon sets.'],
                ['slug' => 'translator', 'icon' => '🌍', 'title' => 'UX Translator', 'description' => 'Use Symfony translation messages from JavaScript.'],
                ['slug' => 'live-component', 'icon' => '⚡', 'title' => 'UX Live Component', 'description' => 'A server-rendered component that re-renders on interaction.'],
                ['slug' => 'turbo', 'icon' => '🚀', 'title' => 'UX Turbo', 'description' => 'Master–detail navigation with a Turbo Frame — no full reload.'],
            ],
        );
    }

    /** @return array<string, mixed>|null */
    public function get(string $slug): ?array
    {
        foreach ([...$this->features(), ...$this->ux()] as $item) {
            if ($item['slug'] === $slug) {
                return $item;
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    public function feature(string $slug): array
    {
        return $this->get($slug) ?? throw new \InvalidArgumentException(sprintf('Unknown demo "%s".', $slug));
    }
}
