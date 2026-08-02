<?php

declare(strict_types=1);

namespace App\Controller;

use App\Demo\DemoCatalog;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class DashboardController extends AbstractController
{
    #[Route('/', name: 'dashboard')]
    public function index(DemoCatalog $catalog): Response
    {
        return $this->render('dashboard.html.twig', [
            'features' => $catalog->features(),
            'ux' => $catalog->ux(),
        ]);
    }
}
