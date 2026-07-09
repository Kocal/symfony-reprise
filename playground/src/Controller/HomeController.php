<?php

declare(strict_types=1);

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Map\Map;
use Symfony\UX\Map\Point;

class HomeController extends AbstractController
{
    #[Route('/')]
    public function index(): Response
    {
        $map = new Map(
            center: new Point(45.7534031, 4.8295061),
            zoom: 6
        );

        return $this->render('home/index.html.twig', [
            'map' => $map,
        ]);
    }
}
