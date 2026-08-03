<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Preview;

use TYPO3\CMS\Backend\Preview\StandardContentPreviewRenderer;
use TYPO3\CMS\Backend\View\BackendLayout\Grid\GridColumnItem;
use TYPO3\CMS\Core\Database\Connection;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Database\Query\Restriction\DeletedRestriction;
use TYPO3\CMS\Core\Database\Query\Restriction\HiddenRestriction;
use TYPO3\CMS\Core\Resource\ResourceFactory;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use WapplerSystems\Herobuilder\Domain\Composition;

/**
 * Page-module preview for the Hero Builder content element:
 * lists the collages (slides) and the image layers of each as small thumbnails.
 */
final class HeroBuilderPreviewRenderer extends StandardContentPreviewRenderer
{
    public function renderPageModulePreviewContent(GridColumnItem $item): string
    {
        // TYPO3 v14: GridColumnItem::getRecord() returns a RecordInterface object,
        // not an array — use getUid() instead of array access.
        $collages = $this->fetchCollages($item->getRecord()->getUid());

        if ($collages === []) {
            return '<div class="herobuilder-be-preview"><em>Hero Builder — no collages yet.</em></div>';
        }

        $resourceFactory = GeneralUtility::makeInstance(ResourceFactory::class);
        $out = [];
        $out[] = '<div class="herobuilder-be-preview">';
        $out[] = '<strong>Hero Builder</strong> · ' . count($collages) . ' slide(s)';

        foreach ($collages as $i => $collage) {
            $composition = Composition::fromJson((string)($collage['composition'] ?? ''));
            $thumbs = [];
            foreach ($composition->layers as $layer) {
                if (($layer['type'] ?? 'image') === 'text') {
                    $text = trim((string)($layer['text'] ?? ''));
                    $text = $text !== '' ? mb_strimwidth($text, 0, 24, '…') : 'Text';
                    $thumbs[] = '<span style="display:inline-block;height:34px;line-height:34px;padding:0 8px;'
                        . 'margin:2px;border:1px solid #ccc;border-radius:2px;background:#f5f5f5;'
                        . 'font-size:.85em;vertical-align:top;">T: ' . htmlspecialchars($text) . '</span>';
                    continue;
                }
                try {
                    $file = $resourceFactory->getFileObject((int)($layer['fileUid'] ?? 0));
                    $url = $file->getPublicUrl() ?? '';
                    if ($url !== '' && !preg_match('#^https?://#', $url) && $url[0] !== '/') {
                        $url = '/' . $url;
                    }
                    $thumbs[] = '<img src="' . htmlspecialchars($url) . '" alt="" '
                        . 'style="height:34px;width:auto;margin:2px;border:1px solid #ccc;border-radius:2px;">';
                } catch (\Throwable) {
                    // skip missing files
                }
            }
            $title = trim((string)($collage['title'] ?? '')) ?: ('Slide ' . ($i + 1));
            $out[] = '<div style="margin-top:4px;">'
                . '<span style="font-size:.85em;color:#666;">' . htmlspecialchars($title)
                . ' (' . count($composition->layers) . ' layer(s))</span><br>'
                . implode('', $thumbs) . '</div>';
        }
        $out[] = '</div>';

        return implode('', $out);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchCollages(int $contentUid): array
    {
        $qb = GeneralUtility::makeInstance(ConnectionPool::class)
            ->getQueryBuilderForTable('tx_herobuilder_collage');
        $qb->getRestrictions()->removeAll()
            ->add(GeneralUtility::makeInstance(DeletedRestriction::class))
            ->add(GeneralUtility::makeInstance(HiddenRestriction::class));

        return $qb->select('uid', 'title', 'composition')
            ->from('tx_herobuilder_collage')
            ->where($qb->expr()->eq('content_uid', $qb->createNamedParameter($contentUid, Connection::PARAM_INT)))
            ->orderBy('sorting')
            ->executeQuery()
            ->fetchAllAssociative();
    }
}
