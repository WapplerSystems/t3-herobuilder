<?php

$EM_CONF['herobuilder'] = [
    'title' => 'Hero Builder',
    'description' => 'Graphical per-breakpoint hero composition builder: drag & drop FAL layers onto a stage, position them per breakpoint, and manage multiple collages as a carousel.',
    'category' => 'fe',
    'author' => 'WapplerSystems',
    'author_email' => 'typo3@wappler.systems',
    'author_company' => 'WapplerSystems',
    'state' => 'beta',
    'version' => '0.1.0',
    'constraints' => [
        'depends' => [
            'typo3' => '12.4.0-12.4.99',
            'fluid_styled_content' => '',
        ],
        'conflicts' => [],
        'suggests' => [],
    ],
];
