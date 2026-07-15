<?php

declare(strict_types=1);

$ll = 'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:';
$llCore = 'LLL:EXT:core/Resources/Private/Language/locallang_general.xlf:';

return [
    'ctrl' => [
        'title' => $ll . 'template',
        'label' => 'title',
        'tstamp' => 'tstamp',
        'crdate' => 'crdate',
        'delete' => 'deleted',
        'default_sortby' => 'title ASC',
        'enablecolumns' => ['disabled' => 'hidden'],
        'typeicon_classes' => ['default' => 'content-herobuilder'],
        'searchFields' => 'title',
        // Allow "Save as template" to store templates on any page doktype
        // (replaces the removed ExtensionManagementUtility::allowTableOnStandardPages()).
        'security' => ['ignorePageTypeRestriction' => true],
    ],
    'columns' => [
        'hidden' => [
            'exclude' => 1,
            'label' => $llCore . 'LGL.hidden',
            'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 0],
        ],
        'title' => [
            'exclude' => 0,
            'label' => $ll . 'template.title',
            'config' => ['type' => 'input', 'size' => 40, 'eval' => 'trim,required'],
        ],
        'color' => [
            'exclude' => 0,
            'label' => $ll . 'template.color',
            'config' => ['type' => 'color', 'size' => 10, 'nullable' => false],
        ],
        'composition' => [
            'exclude' => 0,
            'label' => $ll . 'collage.composition',
            'config' => [
                'type' => 'user',
                'renderType' => 'herobuilderCanvas',
                'default' => '',
                'parameters' => [],
            ],
        ],
    ],
    'types' => [
        '0' => [
            'showitem' => '
                title, color, composition,
                --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:access,
                    hidden,
            ',
        ],
    ],
    'palettes' => [],
];
