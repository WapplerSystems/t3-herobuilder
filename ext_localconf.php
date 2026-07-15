<?php

declare(strict_types=1);

defined('TYPO3') or die();

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;
use WapplerSystems\Herobuilder\Backend\Form\Element\CanvasElement;

// Register the custom FormEngine node that renders the drag & drop hero canvas.
$GLOBALS['TYPO3_CONF_VARS']['SYS']['formEngine']['nodeRegistry'][1720100001] = [
    'nodeName' => 'herobuilderCanvas',
    'priority' => 40,
    'class' => CanvasElement::class,
];

// New content element wizard entry: page TSconfig is auto-loaded from
// EXT:herobuilder/Configuration/page.tsconfig (TYPO3 v12+), no registration needed.

// Load the content element rendering TypoScript globally (prototype convenience).
ExtensionManagementUtility::addTypoScriptConstants(
    '@import "EXT:herobuilder/Configuration/TypoScript/constants.typoscript"'
);
ExtensionManagementUtility::addTypoScriptSetup(
    '@import "EXT:herobuilder/Configuration/TypoScript/setup.typoscript"'
);
