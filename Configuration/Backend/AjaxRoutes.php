<?php

declare(strict_types=1);

use WapplerSystems\Herobuilder\Backend\Controller\ExportController;
use WapplerSystems\Herobuilder\Backend\Controller\FileInfoController;
use WapplerSystems\Herobuilder\Backend\Controller\PreviewController;
use WapplerSystems\Herobuilder\Backend\Controller\TemplateController;

return [
    'herobuilder_export' => [
        'path' => '/herobuilder/export',
        'target' => ExportController::class . '::image',
    ],
    'herobuilder_fileinfo' => [
        'path' => '/herobuilder/fileinfo',
        'target' => FileInfoController::class . '::info',
    ],
    'herobuilder_preview' => [
        'path' => '/herobuilder/preview',
        'target' => PreviewController::class . '::render',
    ],
    'herobuilder_template_list' => [
        'path' => '/herobuilder/template/list',
        'target' => TemplateController::class . '::list',
    ],
    'herobuilder_template_save' => [
        'path' => '/herobuilder/template/save',
        'target' => TemplateController::class . '::save',
    ],
];
