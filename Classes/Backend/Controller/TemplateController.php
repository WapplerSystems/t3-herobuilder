<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\DataHandling\DataHandler;
use TYPO3\CMS\Core\Http\JsonResponse;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use WapplerSystems\Herobuilder\Service\CompositeImageService;

/**
 * Backend AJAX endpoints for composition templates:
 *  - list: shipped presets (read-only JSON) + user templates from tx_herobuilder_template
 *  - save: create a tx_herobuilder_template record (via DataHandler) from a composition
 */
final class TemplateController
{
    private const PRESET_DIR = 'EXT:herobuilder/Resources/Private/Templates/Presets/';

    public function list(ServerRequestInterface $request): ResponseInterface
    {
        $templates = [];
        $imageService = GeneralUtility::makeInstance(CompositeImageService::class);

        // Shipped presets (read-only).
        $dir = GeneralUtility::getFileAbsFileName(self::PRESET_DIR);
        foreach (glob(rtrim($dir, '/') . '/*.json') ?: [] as $file) {
            $data = json_decode((string)file_get_contents($file), true);
            if (!is_array($data)) {
                continue;
            }
            $composition = isset($data['composition'])
                ? (is_string($data['composition']) ? $data['composition'] : json_encode($data['composition']))
                : json_encode(['layers' => $data['layers'] ?? []]);
            $templates[] = [
                'key' => 'preset:' . pathinfo($file, PATHINFO_FILENAME),
                'title' => (string)($data['title'] ?? pathinfo($file, PATHINFO_FILENAME)),
                'color' => (string)($data['color'] ?? '#dddddd'),
                'composition' => (string)$composition,
                'thumbUrl' => $imageService->render((string)$composition),
                'readonly' => true,
            ];
        }

        // User templates from the DB.
        $qb = GeneralUtility::makeInstance(ConnectionPool::class)->getQueryBuilderForTable('tx_herobuilder_template');
        $rows = $qb->select('uid', 'title', 'color', 'composition')
            ->from('tx_herobuilder_template')
            ->orderBy('title')
            ->executeQuery()
            ->fetchAllAssociative();
        foreach ($rows as $row) {
            $templates[] = [
                'key' => 'db:' . (int)$row['uid'],
                'uid' => (int)$row['uid'],
                'title' => (string)$row['title'],
                'color' => (string)($row['color'] ?: '#dddddd'),
                'composition' => (string)($row['composition'] ?? ''),
                'thumbUrl' => $imageService->render((string)($row['composition'] ?? '')),
                'readonly' => false,
            ];
        }

        return new JsonResponse(['templates' => $templates]);
    }

    public function save(ServerRequestInterface $request): ResponseInterface
    {
        $params = $request->getParsedBody();
        $title = trim((string)($params['title'] ?? ''));
        $composition = (string)($params['composition'] ?? '');
        $color = (string)($params['color'] ?? '');
        $pid = (int)($params['pid'] ?? 0);

        if ($title === '' || $composition === '') {
            return new JsonResponse(['success' => false, 'error' => 'missing title or composition'], 400);
        }

        $newId = 'NEW' . substr(md5($title . microtime()), 0, 10);
        $dataMap = [
            'tx_herobuilder_template' => [
                $newId => [
                    'pid' => $pid,
                    'title' => $title,
                    'color' => $color,
                    'composition' => $composition,
                ],
            ],
        ];

        $dataHandler = GeneralUtility::makeInstance(DataHandler::class);
        $dataHandler->start($dataMap, []);
        $dataHandler->process_datamap();

        $uid = (int)($dataHandler->substNEWwithIDs[$newId] ?? 0);
        if ($uid <= 0) {
            return new JsonResponse(['success' => false, 'error' => 'could not create template'], 500);
        }

        return new JsonResponse(['success' => true, 'uid' => $uid]);
    }
}
