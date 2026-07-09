<?php

declare(strict_types=1);

use WapplerSystems\Herobuilder\Backend\Controller\FileInfoController;
use WapplerSystems\Herobuilder\Backend\Controller\PreviewController;

return [
    'herobuilder_fileinfo' => [
        'path' => '/herobuilder/fileinfo',
        'target' => FileInfoController::class . '::info',
    ],
    'herobuilder_preview' => [
        'path' => '/herobuilder/preview',
        'target' => PreviewController::class . '::render',
    ],
];
