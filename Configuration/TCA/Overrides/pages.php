<?php

declare(strict_types=1);

defined('TYPO3') or die();

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;

// "Contains plugin: Hero Builder templates" on a folder makes it the storage of saved templates
// (TemplateStorage) — no page uid has to be configured per environment. Page TSconfig
// tx_herobuilder.templatePid still wins when set.
ExtensionManagementUtility::addTcaSelectItem('pages', 'module', [
    'label' => 'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:pages.module.herobuilder',
    'value' => 'herobuilder',
    'icon' => 'content-herobuilder',
]);
$GLOBALS['TCA']['pages']['ctrl']['typeicon_classes']['contains-herobuilder'] = 'content-herobuilder';
