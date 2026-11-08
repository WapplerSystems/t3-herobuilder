<?php

return [
    'dependencies' => [
        'core',
        'backend',
        'form',
    ],
    'tags' => [
        'backend.form',
        'backend.module',
    ],
    'imports' => [
        '@wapplersystems/herobuilder/' => 'EXT:herobuilder/Resources/Public/JavaScript/',
    ],
];
