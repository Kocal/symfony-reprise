<?php

declare(strict_types=1);

namespace App\Controller;

use App\Demo\DemoCatalog;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Form\FormView;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Chartjs\Builder\ChartBuilderInterface;
use Symfony\UX\Chartjs\Model\Chart;
use Symfony\UX\Cropperjs\Factory\CropperInterface;
use Symfony\UX\Cropperjs\Form\CropperType;
use Symfony\UX\Dropzone\Form\DropzoneType;
use Symfony\UX\Map\Map;
use Symfony\UX\Map\Marker;
use Symfony\UX\Map\Point;

final class DemoController extends AbstractController
{
    public function __construct(private readonly DemoCatalog $catalog)
    {
    }

    #[Route('/demo/{slug}', name: 'demo', requirements: ['slug' => '[a-z-]+'], priority: -10)]
    public function demo(string $slug, ChartBuilderInterface $chartBuilder, CropperInterface $cropper, Packages $assets): Response
    {
        $page = $this->catalog->get($slug);
        if ($page === null) {
            throw $this->createNotFoundException();
        }

        $params = match ($slug) {
            'chartjs' => ['chart' => $this->buildChart($chartBuilder)],
            'map' => ['map' => $this->buildMap()],
            'dropzone' => ['form' => $this->dropzoneForm()],
            'cropperjs' => ['form' => $this->cropperForm($cropper, $assets)],
            'turbo' => ['tools' => array_keys(self::TOOLS)],
            'react', 'vue' => ['foreground' => '#6b7280', 'background' => '#ffffff'],
            default => [],
        };

        return $this->render("demo/{$slug}.html.twig", ['page' => $page, ...$params]);
    }

    private const TOOLS = [
        'Vite' => 'Rolldown-powered, native-ESM dev server with instant HMR.',
        'Rsbuild' => 'Rspack-powered, webpack-compatible, very fast production builds.',
        'Rollup' => 'The library bundler Vite builds on — excellent tree-shaking.',
        'esbuild' => 'Go-based, blazing-fast transforms and bundling.',
        'Webpack' => 'The original — mature and flexible, but slower.',
    ];

    #[Route('/demo/_turbo-frame/{tool}', name: 'demo_turbo_frame', requirements: ['tool' => '[A-Za-z.]+'])]
    public function turboFrame(string $tool): Response
    {
        return $this->render('demo/_turbo_frame.html.twig', [
            'tool' => $tool,
            'detail' => self::TOOLS[$tool] ?? 'Unknown tool.',
            'now' => new \DateTimeImmutable(),
        ]);
    }

    private function buildChart(ChartBuilderInterface $chartBuilder): Chart
    {
        $chart = $chartBuilder->createChart(Chart::TYPE_BAR);
        $chart->setData([
            'labels' => ['Vite', 'Rsbuild', 'Encore'],
            'datasets' => [[
                'label' => 'Cold build time (relative)',
                'backgroundColor' => ['#10b981', '#f59e0b', '#6b7280'],
                'data' => [12, 14, 40],
            ]],
        ]);
        $chart->setOptions(['scales' => ['y' => ['beginAtZero' => true]]]);

        return $chart;
    }

    private function buildMap(): Map
    {
        $lyon = new Point(45.7534031, 4.8295061);
        $map = new Map(center: $lyon, zoom: 6);
        $map->addMarker(new Marker(position: $lyon, title: 'Lyon'));

        return $map;
    }

    private function dropzoneForm(): FormView
    {
        return $this->createFormBuilder()
            ->add('photo', DropzoneType::class, ['required' => false])
            ->getForm()
            ->createView();
    }

    private function cropperForm(CropperInterface $cropper, Packages $assets): FormView
    {
        $crop = $cropper->createCrop($this->getParameter('kernel.project_dir').'/assets/to-copy/hero.jpg');
        $crop->setCroppedMaxSize(2000, 1500);

        return $this->createFormBuilder(['crop' => $crop])
            ->add('crop', CropperType::class, [
                'public_url' => $assets->getUrl('build/media/hero.jpg'),
                'cropper_options' => ['aspectRatio' => 16 / 9, 'viewMode' => 1],
            ])
            ->getForm()
            ->createView();
    }
}
