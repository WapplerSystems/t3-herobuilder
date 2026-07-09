<?php

declare(strict_types=1);

$ll = 'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:';
$llCore = 'LLL:EXT:core/Resources/Private/Language/locallang_general.xlf:';

return [
    'ctrl' => [
        'title' => $ll . 'collage',
        'label' => 'title',
        'sortby' => 'sorting',
        'tstamp' => 'tstamp',
        'crdate' => 'crdate',
        'delete' => 'deleted',
        'hideTable' => true,
        'default_sortby' => 'sorting ASC',
        'enablecolumns' => [
            'disabled' => 'hidden',
            'starttime' => 'starttime',
            'endtime' => 'endtime',
        ],
        'languageField' => 'sys_language_uid',
        'transOrigPointerField' => 'l10n_parent',
        'transOrigDiffSourceField' => 'l10n_diffsource',
        'translationSource' => 'l10n_source',
        'typeicon_classes' => ['default' => 'content-herobuilder'],
        'security' => ['ignorePageTypeRestriction' => true],
    ],
    'columns' => [
        'hidden' => [
            'exclude' => 1,
            'label' => $llCore . 'LGL.hidden',
            'config' => ['type' => 'check', 'renderType' => 'checkboxToggle', 'default' => 0],
        ],
        'starttime' => [
            'exclude' => 1,
            'label' => $llCore . 'LGL.starttime',
            'config' => ['type' => 'datetime', 'default' => 0],
        ],
        'endtime' => [
            'exclude' => 1,
            'label' => $llCore . 'LGL.endtime',
            'config' => ['type' => 'datetime', 'default' => 0, 'range' => ['upper' => mktime(0, 0, 0, 1, 1, 2038)]],
        ],
        'sys_language_uid' => [
            'exclude' => 1,
            'label' => $llCore . 'LGL.language',
            'config' => ['type' => 'language'],
        ],
        'l10n_parent' => [
            'displayCond' => 'FIELD:sys_language_uid:>:0',
            'label' => $llCore . 'LGL.l18n_parent',
            'config' => [
                'type' => 'select',
                'renderType' => 'selectSingle',
                'items' => [['label' => '', 'value' => 0]],
                'foreign_table' => 'tx_herobuilder_collage',
                'foreign_table_where' => 'AND tx_herobuilder_collage.pid=###CURRENT_PID### AND tx_herobuilder_collage.sys_language_uid IN (-1,0)',
                'default' => 0,
            ],
        ],
        'l10n_source' => ['config' => ['type' => 'passthrough']],
        'l10n_diffsource' => ['config' => ['type' => 'passthrough']],
        'content_uid' => ['config' => ['type' => 'passthrough']],

        'title' => [
            'exclude' => 0,
            'label' => $ll . 'collage.title',
            'config' => ['type' => 'input', 'size' => 40, 'eval' => 'trim'],
        ],
        'link' => [
            'exclude' => 1,
            'label' => $ll . 'collage.link',
            'config' => ['type' => 'link', 'size' => 40],
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
        'assets' => [
            'exclude' => 1,
            'label' => $ll . 'collage.assets',
            'config' => [
                'type' => 'file',
                'allowed' => 'common-image-types',
                'maxitems' => 50,
            ],
        ],
    ],
    'types' => [
        '0' => [
            'showitem' => '
                title, composition, link, assets,
                --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:language,
                    sys_language_uid, l10n_parent,
                --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:access,
                    hidden, starttime, endtime,
            ',
        ],
    ],
    'palettes' => [],
];
