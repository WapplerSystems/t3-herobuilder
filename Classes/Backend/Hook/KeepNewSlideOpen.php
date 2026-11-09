<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Hook;

use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Authentication\BackendUserAuthentication;
use TYPO3\CMS\Core\Core\Environment;
use TYPO3\CMS\Core\DataHandling\DataHandler;

/**
 * After saving, the slide the editor just created is the one that is open — and only that one,
 * matching the slides field's expandSingle.
 *
 * TYPO3 remembers open inline children per user (uc inlineView[topTable][topUid][childTable]).
 * For children created in this save it does so in EditDocumentController::updateInlineView(),
 * but keyed by the parent's uid as posted: for a content element that is new as well, that is its
 * "NEW…" placeholder, which is never looked up again — the new slide came back collapsed. For an
 * existing element the new slide was stored next to the slide open before, and the editor's
 * one-slide-open rule then kept the old one.
 *
 * So once DataHandler is done (all NEW ids resolved, content_uid set): per content element that
 * got new slides, the newest one becomes the only open slide. Core still adds every new slide of
 * an existing element afterwards; with several new slides the editor's one-slide-open rule then
 * keeps the newest (canvas.js keepSingleSlideOpen). Only this user's view state changes, never
 * content. Copies, translations and templates create slides by command, not as
 * NEW records, and are untouched.
 */
final class KeepNewSlideOpen
{
    private const PARENT_TABLE = 'tt_content';
    private const SLIDE_TABLE = 'tx_herobuilder_collage';

    public function processDatamap_afterAllOperations(DataHandler $dataHandler): void
    {
        if (Environment::isCli()) {
            return;
        }
        $user = $dataHandler->BE_USER;
        if (!$user instanceof BackendUserAuthentication || !is_array($user->user ?? null)) {
            return;
        }
        $newest = [];
        foreach ($dataHandler->substNEWwithIDs as $newId => $uid) {
            if (($dataHandler->substNEWwithIDs_table[$newId] ?? '') !== self::SLIDE_TABLE) {
                continue;
            }
            $parent = (int)(BackendUtility::getRecord(self::SLIDE_TABLE, (int)$uid, 'content_uid')['content_uid'] ?? 0);
            if ($parent > 0 && (int)$uid > ($newest[$parent] ?? 0)) {
                $newest[$parent] = (int)$uid;
            }
        }
        if ($newest === []) {
            return;
        }
        $inlineView = json_decode(is_string($user->uc['inlineView'] ?? null) ? $user->uc['inlineView'] : '', true);
        if (!is_array($inlineView)) {
            $inlineView = [];
        }
        foreach ($newest as $parent => $slide) {
            $inlineView[self::PARENT_TABLE][$parent][self::SLIDE_TABLE] = [(string)$slide];
        }
        $user->uc['inlineView'] = json_encode($inlineView);
        $user->writeUC();
    }
}
