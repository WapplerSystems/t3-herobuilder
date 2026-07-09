<?php

declare(strict_types=1);

defined('TYPO3') or die();

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;

// Allow composition templates to be created on any page (not just sysfolders),
// so "Save as template" can store them next to the content / on a configured pid.
ExtensionManagementUtility::allowTableOnStandardPages('tx_herobuilder_template');
