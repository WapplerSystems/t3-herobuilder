<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;
use WapplerSystems\Herobuilder\Backend\Preview\HeroBuilderPreviewRenderer;

defined('TYPO3') or die();

$ctype = 'herobuilder';
$ll = 'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:';

// Register the content element in the CType selector.
ExtensionManagementUtility::addTcaSelectItem(
    'tt_content',
    'CType',
    [
        'label' => $ll . 'ctype.title',
        'description' => $ll . 'ctype.description',
        'value' => $ctype,
        'icon' => 'content-herobuilder',
        'group' => 'default',
    ],
    'textmedia',
    'after'
);

$GLOBALS['TCA']['tt_content']['ctrl']['typeicon_classes'][$ctype] = 'content-herobuilder';

// Extra columns on tt_content.
$newColumns = [
    'collages' => [
        'exclude' => 0,
        'label' => $ll . 'tt_content.collages',
        'config' => [
            'type' => 'inline',
            'foreign_table' => 'tx_herobuilder_collage',
            'foreign_field' => 'content_uid',
            'foreign_sortby' => 'sorting',
            'maxitems' => 50,
            'appearance' => [
                'collapseAll' => true,
                'expandSingle' => true,
                'useSortable' => true,
                'levelLinksPosition' => 'top',
                'showSynchronizationLink' => false,
                'showAllLocalizationLink' => true,
                'showPossibleLocalizationRecords' => true,
                'newRecordLinkAddTitle' => true,
            ],
        ],
    ],
    'slider_autoplay' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_autoplay',
        'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 0],
    ],
    'slider_interval' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_interval',
        'config' => ['type' => 'number', 'default' => 5000, 'range' => ['lower' => 1000, 'upper' => 60000], 'size' => 8],
    ],
    'slider_loop' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_loop',
        'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 1],
    ],
    'slider_controls' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_controls',
        'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 1],
    ],
    'slider_indicators' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_indicators',
        'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 1],
    ],
    'slider_pause_hover' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_pause_hover',
        'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 1],
    ],
    'slider_effect' => [
        'exclude' => 1,
        'label' => $ll . 'tt_content.slider_effect',
        'config' => [
            'type' => 'select',
            'renderType' => 'selectSingle',
            'default' => 'slide',
            'items' => [
                ['label' => $ll . 'tt_content.slider_effect.slide', 'value' => 'slide'],
                ['label' => $ll . 'tt_content.slider_effect.fade', 'value' => 'fade'],
                ['label' => $ll . 'tt_content.slider_effect.layers', 'value' => 'layers'],
                ['label' => $ll . 'tt_content.slider_effect.parallax', 'value' => 'parallax'],
            ],
        ],
    ],
];

ExtensionManagementUtility::addTCAcolumns('tt_content', $newColumns);

$GLOBALS['TCA']['tt_content']['types'][$ctype] = [
    'previewRenderer' => HeroBuilderPreviewRenderer::class,
    'showitem' => '
        --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:general,
            --palette--;;general,
            --palette--;;headers,
        --div--;' . $ll . 'tab.collages,
            collages,
        --div--;' . $ll . 'tab.slider,
            slider_autoplay, slider_interval, slider_loop,
            slider_controls, slider_indicators, slider_pause_hover, slider_effect,
        --div--;LLL:EXT:frontend/Resources/Private/Language/locallang_ttc.xlf:tabs.appearance,
            --palette--;;frames,
            --palette--;;appearanceLinks,
        --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:access,
            --palette--;;hidden,
            --palette--;;access,
    ',
    'columnsOverrides' => [
        'bodytext' => [
            'config' => ['type' => 'text', 'enableRichtext' => false],
        ],
    ],
];
