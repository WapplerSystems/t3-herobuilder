<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\DataHandling\DataHandler;
use TYPO3\CMS\Core\Http\JsonResponse;
use TYPO3\CMS\Core\Localization\LanguageService;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use WapplerSystems\Herobuilder\Service\CompositeImageService;
use WapplerSystems\Herobuilder\Service\TemplateStorage;

/**
 * Backend AJAX endpoints for composition templates:
 *  - list: shipped presets (read-only JSON, can be switched off per page via TSconfig
 *    tx_herobuilder.presets.disable = <name>, <name> | *) + user templates (tx_herobuilder_template)
 *  - save: create a user template from a composition
 *  - duplicate: a user template (DataHandler copy, "… (copy 1)") or a preset (becomes a user template)
 *  - rename / delete: user templates only (delete = soft delete, restorable from the recycler)
 *
 * Every write goes through DataHandler, so the editor's table and page permissions apply; a
 * refused action answers with the DataHandler message instead of silently doing nothing.
 */
final class TemplateController
{
    private const PRESET_DIR = 'EXT:herobuilder/Resources/Private/Templates/Presets/';
    private const TABLE = 'tx_herobuilder_template';

    public function list(ServerRequestInterface $request): ResponseInterface
    {
        $templates = [];
        $imageService = GeneralUtility::makeInstance(CompositeImageService::class);
        $pageId = (int)($request->getQueryParams()['pid'] ?? 0);
        $disabled = $this->disabledPresets($pageId);

        foreach ($this->presets() as $name => $preset) {
            if ($disabled === ['*'] || in_array($name, $disabled, true)) {
                continue;
            }
            $templates[] = [
                'key' => 'preset:' . $name,
                'title' => $preset['title'],
                'color' => $preset['color'],
                'composition' => $preset['composition'],
                'thumbUrl' => $imageService->render($preset['composition']),
                'readonly' => true,
            ];
        }

        // User templates from the DB (every page — the storage folder only decides where new ones go).
        $qb = GeneralUtility::makeInstance(ConnectionPool::class)->getQueryBuilderForTable(self::TABLE);
        $rows = $qb->select('uid', 'title', 'color', 'composition')
            ->from(self::TABLE)
            ->orderBy('title')
            ->executeQuery()
            ->fetchAllAssociative();
        foreach ($rows as $row) {
            $templates[] = [
                'key' => 'db:' . (int)$row['uid'],
                'uid' => (int)$row['uid'],
                'title' => (string)$row['title'],
                // Raw value: the gallery falls back to grey for the card itself, but an empty colour
                // must not become the slide background when the template is applied.
                'color' => (string)$row['color'],
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
        return $this->create($pid, $title, $color, $composition);
    }

    /** Copy of a user template (`db:<uid>`) or of a preset (`preset:<name>`) as a new user template. */
    public function duplicate(ServerRequestInterface $request): ResponseInterface
    {
        $params = $request->getParsedBody();
        $key = (string)($params['key'] ?? '');
        $pageId = (int)($params['pid'] ?? 0);

        if (str_starts_with($key, 'db:')) {
            $uid = (int)substr($key, 3);
            $dataHandler = $this->dataHandler([], [self::TABLE => [$uid => ['copy' => -$uid]]]);
            $dataHandler->process_cmdmap();
            $newUid = (int)($dataHandler->copyMappingArray_merged[self::TABLE][$uid] ?? 0);
            return $this->result($dataHandler, $newUid);
        }
        if (str_starts_with($key, 'preset:')) {
            $preset = $this->presets()[substr($key, 7)] ?? null;
            if ($preset === null) {
                return new JsonResponse(['success' => false, 'error' => 'unknown preset'], 404);
            }
            $title = $preset['title'] . rtrim(' ' . sprintf($this->copyLabel(), 1));
            $storagePid = GeneralUtility::makeInstance(TemplateStorage::class)->pidFor($pageId);
            return $this->create($storagePid, $title, $preset['color'], $preset['composition']);
        }
        return new JsonResponse(['success' => false, 'error' => 'invalid key'], 400);
    }

    public function rename(ServerRequestInterface $request): ResponseInterface
    {
        $params = $request->getParsedBody();
        $uid = (int)($params['uid'] ?? 0);
        $title = trim((string)($params['title'] ?? ''));
        if ($uid <= 0 || $title === '') {
            return new JsonResponse(['success' => false, 'error' => 'missing uid or title'], 400);
        }
        $dataHandler = $this->dataHandler([self::TABLE => [$uid => ['title' => $title]]], []);
        $dataHandler->process_datamap();
        return $this->result($dataHandler, $uid);
    }

    public function delete(ServerRequestInterface $request): ResponseInterface
    {
        $uid = (int)($request->getParsedBody()['uid'] ?? 0);
        if ($uid <= 0) {
            return new JsonResponse(['success' => false, 'error' => 'missing uid'], 400);
        }
        $dataHandler = $this->dataHandler([], [self::TABLE => [$uid => ['delete' => 1]]]);
        $dataHandler->process_cmdmap();
        return $this->result($dataHandler, $uid);
    }

    private function create(int $pid, string $title, string $color, string $composition): ResponseInterface
    {
        $newId = 'NEW' . substr(md5($title . microtime()), 0, 10);
        $dataHandler = $this->dataHandler([
            self::TABLE => [
                $newId => [
                    'pid' => $pid,
                    'title' => $title,
                    'color' => $color,
                    'composition' => $composition,
                ],
            ],
        ], []);
        $dataHandler->process_datamap();
        return $this->result($dataHandler, (int)($dataHandler->substNEWwithIDs[$newId] ?? 0));
    }

    private function dataHandler(array $dataMap, array $cmdMap): DataHandler
    {
        $dataHandler = GeneralUtility::makeInstance(DataHandler::class);
        $dataHandler->start($dataMap, $cmdMap);
        return $dataHandler;
    }

    /** Success with the record uid, or the DataHandler error (e.g. missing permission). */
    private function result(DataHandler $dataHandler, int $uid): ResponseInterface
    {
        if ($dataHandler->errorLog !== [] || $uid <= 0) {
            $error = $dataHandler->errorLog !== [] ? implode(' ', $dataHandler->errorLog) : 'nothing was changed';
            return new JsonResponse(['success' => false, 'error' => $error], 403);
        }
        return new JsonResponse(['success' => true, 'uid' => $uid]);
    }

    /**
     * Shipped presets by file name. Re-encoded from OBJECTS, not associative arrays: an empty `{}`
     * (e.g. "anim":{}) would come back as `[]`, and an effect set on such a layer in the editor
     * was then lost on save (JSON.stringify drops named properties of arrays).
     *
     * @return array<string, array{title: string, color: string, composition: string}>
     */
    private function presets(): array
    {
        $presets = [];
        $dir = GeneralUtility::getFileAbsFileName(self::PRESET_DIR);
        foreach (glob(rtrim($dir, '/') . '/*.json') ?: [] as $file) {
            $objects = json_decode((string)file_get_contents($file), false);
            if (!is_object($objects)) {
                continue;
            }
            $name = pathinfo($file, PATHINFO_FILENAME);
            $composition = isset($objects->composition)
                ? (is_string($objects->composition) ? $objects->composition : json_encode($objects->composition))
                : json_encode(['layers' => $objects->layers ?? []]);
            $presets[$name] = [
                'title' => (string)($objects->title ?? $name),
                'color' => (string)($objects->color ?? '#dddddd'),
                'composition' => (string)$composition,
            ];
        }
        return $presets;
    }

    /**
     * Presets switched off for the page: TSconfig tx_herobuilder.presets.disable, a comma list of
     * preset names (file names without .json) or `*` for all.
     *
     * @return list<string>
     */
    private function disabledPresets(int $pageId): array
    {
        if ($pageId <= 0) {
            return [];
        }
        $value = (string)(BackendUtility::getPagesTSconfig($pageId)['tx_herobuilder.']['presets.']['disable'] ?? '');
        $names = GeneralUtility::trimExplode(',', $value, true);
        return in_array('*', $names, true) ? ['*'] : $names;
    }

    /** "(copy %s)" in the editor's language — the same suffix DataHandler gives copied templates (TCA prependAtCopy). */
    private function copyLabel(): string
    {
        return $this->getLanguageService()->sL('LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:copySuffix') ?: '(copy %s)';
    }

    private function getLanguageService(): LanguageService
    {
        return $GLOBALS['LANG'];
    }
}
