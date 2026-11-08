<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Service;

use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Database\Query\Restriction\DeletedRestriction;

/**
 * Where "Save as template" and "Duplicate" put tx_herobuilder_template records, seen from the
 * page an editor works on:
 *
 *  1. page TSconfig tx_herobuilder.templatePid, when set;
 *  2. else the first folder marked "Contains plugin: Hero Builder templates" (pages.module);
 *  3. else that page itself (the behaviour before a storage existed).
 *
 * The template gallery lists templates from every page, so the storage only decides where new
 * ones land (and keeps them out of content pages).
 */
final readonly class TemplateStorage
{
    public function __construct(private ConnectionPool $connectionPool) {}

    public function pidFor(int $pageId): int
    {
        $tsConfig = $pageId > 0 ? (BackendUtility::getPagesTSconfig($pageId)['tx_herobuilder.'] ?? []) : [];
        $configured = (int)($tsConfig['templatePid'] ?? 0);
        if ($configured > 0) {
            return $configured;
        }
        $qb = $this->connectionPool->getQueryBuilderForTable('pages');
        $qb->getRestrictions()->removeAll()->add(new DeletedRestriction());
        $folder = $qb->select('uid')
            ->from('pages')
            ->where(
                $qb->expr()->eq('module', $qb->createNamedParameter('herobuilder')),
                $qb->expr()->eq('sys_language_uid', 0)
            )
            ->orderBy('uid')
            ->setMaxResults(1)
            ->executeQuery()
            ->fetchOne();
        return $folder !== false ? (int)$folder : $pageId;
    }
}
