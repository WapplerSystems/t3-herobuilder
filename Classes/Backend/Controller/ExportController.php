<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Http\JsonResponse;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use WapplerSystems\Herobuilder\Service\CompositeImageService;

/**
 * Backend AJAX endpoint: renders the current composition into a social/OG image format
 * (via CompositeImageService) and returns its public URL for download.
 */
final class ExportController
{
    public function image(ServerRequestInterface $request): ResponseInterface
    {
        $params = $request->getParsedBody();
        $composition = (string)($params['composition'] ?? '');
        $format = (string)($params['format'] ?? 'og');

        if ($composition === '' || !isset(CompositeImageService::FORMATS[$format])) {
            return new JsonResponse(['success' => false, 'error' => 'invalid request'], 400);
        }

        $url = GeneralUtility::makeInstance(CompositeImageService::class)->renderFormat($composition, $format);
        if ($url === null) {
            return new JsonResponse(['success' => false, 'error' => 'render failed'], 500);
        }

        return new JsonResponse([
            'success' => true,
            'url' => $url,
            'filename' => 'hero-' . $format . '.png',
        ]);
    }
}
