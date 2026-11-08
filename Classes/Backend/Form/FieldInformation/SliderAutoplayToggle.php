<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Form\FieldInformation;

use TYPO3\CMS\Backend\Form\AbstractNode;
use TYPO3\CMS\Core\Page\JavaScriptModuleInstruction;

/**
 * Attached to tt_content.slider_autoplay: shows/hides the fields that only matter with autoplay
 * (interval, pause on hover) in the browser while the toggle changes.
 *
 * Replaces `onChange => reload` + `displayCond`: the reload asked "Refresh required" and then
 * SUBMITTED (= saved) the record just to reveal two fields. Renders no visible output, only a
 * marker carrying the toggle's form name and the JS module.
 */
final class SliderAutoplayToggle extends AbstractNode
{
    /** Fields of the same record that are only relevant with autoplay on. */
    private const DEPENDENT_FIELDS = ['slider_interval', 'slider_pause_hover'];

    public function render(): array
    {
        $resultArray = $this->initializeResultArray();
        $toggleName = (string)($this->data['parameterArray']['itemFormElName'] ?? '');
        if ($toggleName === '') {
            return $resultArray;
        }
        $resultArray['html'] = '<span hidden class="t3js-herobuilder-autoplay-toggle"'
            . ' data-toggle-name="' . htmlspecialchars($toggleName) . '"'
            . ' data-dependent-fields="' . htmlspecialchars(implode(',', self::DEPENDENT_FIELDS)) . '"></span>';
        $resultArray['javaScriptModules'][] = JavaScriptModuleInstruction::create(
            '@wapplersystems/herobuilder/Backend/slider-autoplay-toggle.js'
        );
        return $resultArray;
    }
}
