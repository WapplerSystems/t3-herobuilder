<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\EventListener;

use TYPO3\CMS\Backend\Form\Event\ModifyInlineElementControlsEvent;
use TYPO3\CMS\Core\Attribute\AsEventListener;
use TYPO3\CMS\Core\Imaging\IconFactory;
use TYPO3\CMS\Core\Imaging\IconSize;
use TYPO3\CMS\Core\Localization\LanguageService;
use TYPO3\CMS\Core\Page\PageRenderer;

/**
 * "Duplicate slide" button in the header of every saved collage (tx_herobuilder_collage inline
 * record), next to the core "create new" button.
 *
 * The click (Resources/Public/JavaScript/Backend/duplicate-slide.js) adds the DataHandler command
 * `cmd[tx_herobuilder_collage][<uid>][copy] = -<uid>` to the form and saves it: one request stores
 * pending edits first (datamap before cmdmap) and then copies the collage — its composition, file
 * references and translations — right behind the original. TCA ctrl hideAtCopy/prependAtCopy make
 * the copy start hidden and named "… (copy 1)"; both only apply to the record copied itself, not
 * to collages copied along with their content element.
 *
 * Not shown for unsaved collages (nothing to copy yet) nor for translations (they follow their
 * default-language record).
 */
#[AsEventListener('herobuilder/add-duplicate-slide-control')]
final readonly class AddDuplicateSlideControl
{
    private const TABLE = 'tx_herobuilder_collage';

    public function __construct(
        private IconFactory $iconFactory,
        private PageRenderer $pageRenderer,
    ) {}

    public function __invoke(ModifyInlineElementControlsEvent $event): void
    {
        if ($event->getForeignTable() !== self::TABLE) {
            return;
        }
        $record = $event->getRecord();
        $uid = $record['uid'] ?? '';
        if (!is_numeric($uid) || (int)$uid <= 0) {
            return;
        }
        $language = $record['sys_language_uid'] ?? 0;
        if ((int)(is_array($language) ? reset($language) : $language) > 0) {
            return;
        }

        $this->pageRenderer->loadJavaScriptModule('@wapplersystems/herobuilder/Backend/duplicate-slide.js');
        $title = $this->getLanguageService()->sL(
            'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:collage.duplicate'
        ) ?: 'Duplicate slide (saves the form)';
        $button = '<button type="button" class="btn btn-default t3js-herobuilder-duplicate-slide"'
            . ' data-table="' . self::TABLE . '" data-uid="' . (int)$uid . '"'
            . ' title="' . htmlspecialchars($title) . '" aria-label="' . htmlspecialchars($title) . '">'
            . $this->iconFactory->getIcon('actions-duplicate', IconSize::SMALL)->render()
            . '</button>';
        // Next to "create new" when the core renders it, else in a group of its own.
        if ($event->hasControl('new') && $event->getControl('new') !== '') {
            $event->setControl('new', $event->getControl('new') . $button);
        } else {
            $event->setControl('herobuilder.duplicate', $button);
        }
    }

    private function getLanguageService(): LanguageService
    {
        return $GLOBALS['LANG'];
    }
}
