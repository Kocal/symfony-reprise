<?php

declare(strict_types=1);

namespace App\Controller;

use App\Demo\DemoCatalog;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class FeatureController extends AbstractController
{
    public function __construct(private readonly DemoCatalog $catalog)
    {
    }

    #[Route('/admin', name: 'admin')]
    public function admin(): Response
    {
        return $this->render('feature/admin.html.twig', ['page' => $this->catalog->feature('multiple-entries')]);
    }

    #[Route('/feature/code-splitting', name: 'feature_code_splitting')]
    public function codeSplitting(): Response
    {
        return $this->render('feature/code-splitting.html.twig', ['page' => $this->catalog->feature('code-splitting')]);
    }

    #[Route('/feature/scss-typescript', name: 'feature_scss_ts')]
    public function scssTypescript(): Response
    {
        return $this->render('feature/scss-typescript.html.twig', ['page' => $this->catalog->feature('scss-typescript')]);
    }

    #[Route('/feature/copied-files', name: 'feature_copied_files')]
    public function copiedFiles(): Response
    {
        $manifest = $this->decode($this->getParameter('kernel.project_dir').'/public/build/manifest.json');
        $under = static fn (string $prefix): array => array_values(array_filter(
            array_keys($manifest),
            static fn ($key): bool => str_starts_with((string) $key, $prefix),
        ));

        return $this->render('feature/copied-files.html.twig', [
            'page' => $this->catalog->feature('copied-files'),
            'media' => $under('build/media/'),
            'tiles' => $under('build/tiles/'),
        ]);
    }

    #[Route('/feature/build-contract', name: 'feature_build_contract')]
    public function buildContract(): Response
    {
        $dir = $this->getParameter('kernel.project_dir').'/public/build';

        return $this->render('feature/build-contract.html.twig', [
            'page' => $this->catalog->feature('build-contract'),
            'entrypoints' => $this->readJson($dir.'/entrypoints.json'),
            'manifest' => $this->readJson($dir.'/manifest.json'),
        ]);
    }

    private function readJson(string $path): ?string
    {
        return is_file($path) ? json_encode($this->decode($path), \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES) : null;
    }

    /** @return array<mixed> */
    private function decode(string $path): array
    {
        return is_file($path) ? (array) json_decode((string) file_get_contents($path), true) : [];
    }
}
