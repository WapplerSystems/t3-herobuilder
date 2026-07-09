<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Http\JsonResponse;
use TYPO3\CMS\Core\Resource\ResourceFactory;
use TYPO3\CMS\Core\Utility\GeneralUtility;

/**
 * Backend AJAX endpoint: resolves FAL file uids to public URLs + dimensions,
 * so the canvas editor can preview layers that only store `fileUid` in JSON.
 */
final class FileInfoController
{
    public function info(ServerRequestInterface $request): ResponseInterface
    {
        $resourceFactory = GeneralUtility::makeInstance(ResourceFactory::class);
        $uids = GeneralUtility::intExplode(
            ',',
            (string)($request->getQueryParams()['uids'] ?? ''),
            true
        );

        $files = [];
        foreach ($uids as $uid) {
            if ($uid <= 0) {
                continue;
            }
            try {
                $file = $resourceFactory->getFileObject($uid);
                $url = $file->getPublicUrl() ?? '';
                if ($url !== '' && !preg_match('#^https?://#', $url) && $url[0] !== '/') {
                    $url = '/' . $url;
                }
                $files[$uid] = [
                    'uid' => $uid,
                    'url' => $url,
                    'name' => $file->getName(),
                    'width' => (int)$file->getProperty('width'),
                    'height' => (int)$file->getProperty('height'),
                    'alt' => (string)($file->getProperty('alternative') ?? ''),
                    'title' => (string)($file->getProperty('title') ?? ''),
                ];
            } catch (\Throwable) {
                continue;
            }
        }

        return new JsonResponse(['files' => $files]);
    }
}
