<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Form\Element;

use TYPO3\CMS\Backend\Form\Element\AbstractFormElement;
use TYPO3\CMS\Backend\Routing\UriBuilder;
use TYPO3\CMS\Core\Crypto\HashService;
use TYPO3\CMS\Core\Imaging\IconFactory;
use TYPO3\CMS\Core\Imaging\IconSize;
use TYPO3\CMS\Core\Page\JavaScriptModuleInstruction;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use TYPO3\CMS\Core\Utility\PathUtility;
use TYPO3\CMS\Core\Utility\StringUtility;
use WapplerSystems\Herobuilder\Domain\Composition;

/**
 * Custom FormEngine node: renders the drag & drop hero canvas for one collage's `composition` field.
 *
 * The visible <input> is a hidden field carrying the composition JSON; the ES module
 * `@wapplersystems/herobuilder/canvas.js` turns the stage into an interactive editor and
 * writes the JSON back on every change. JS is registered ONLY via the result array so the
 * node also works when loaded through IRRE/AJAX.
 */
class CanvasElement extends AbstractFormElement
{
    /**
     * Device glyphs for the breakpoint buttons (16px, currentColor) — the phone/tablet/screen
     * shape makes the target device readable at a glance, label + width only confirm it.
     */
    private const DEVICE_ICONS = [
        'phone' => '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.6h2"/>',
        'tablet' => '<rect x="3" y="1.5" width="10" height="13" rx="1.5"/><path d="M7 12.6h2"/>',
        'laptop' => '<rect x="2.5" y="2.5" width="11" height="8" rx="1"/><path d="M1 12.8h14"/>',
        'desktop' => '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>',
        'wide' => '<rect x="0.8" y="3.5" width="14.4" height="7.5" rx="1"/><path d="M5.5 13.5h5"/>',
    ];

    /** Which glyph represents which breakpoint. */
    private const BREAKPOINT_DEVICES = [
        'xs' => 'phone',
        'sm' => 'phone',
        'md' => 'tablet',
        'lg' => 'laptop',
        'xl' => 'desktop',
        'xxl' => 'desktop',
        'xxxl' => 'wide',
    ];

    public function __construct(
        private readonly HashService $hashService,
        private readonly IconFactory $iconFactory,
    ) {}

    public function render(): array
    {
        $resultArray = $this->initializeResultArray();
        $parameterArray = $this->data['parameterArray'];
        $config = $parameterArray['fieldConf']['config'] ?? [];

        $itemName = (string)$parameterArray['itemFormElName'];
        $itemValue = (string)($parameterArray['itemFormElValue'] ?? '');
        $fieldId = StringUtility::getUniqueId('herobuilder-');

        // Stage aspect ratios come from page TSconfig (tx_herobuilder.stages.<bp>.ratio) so the
        // editor matches the frontend per site — e.g. a flatter hero for a given site.
        $tsStages = $this->data['pageTsConfig']['tx_herobuilder.']['stages.'] ?? [];
        $stages = Composition::stageConfig(Composition::parseTsConfigStages((array)$tsStages));
        $classes = $this->layerClasses();

        // TYPO3 Link Browser wiring: a proxy input the browser writes into (change event),
        // plus the wizard_link URL (same params the core link field uses).
        $linkProxyName = 'herobuilder_link_' . substr(md5($itemName), 0, 12);
        $linkWizardUrl = (string)GeneralUtility::makeInstance(UriBuilder::class)->buildUriFromRoute('wizard_link', [
            'P' => [
                'params' => ['allowedTypes' => 'page,url,file,folder,mail,telephone,record'],
                'table' => 'tx_herobuilder_collage',
                'uid' => (int)($this->data['databaseRow']['uid'] ?? 0),
                'pid' => (int)($this->data['databaseRow']['pid'] ?? 0),
                'field' => 'composition',
                'formName' => 'editform',
                'itemName' => $linkProxyName,
                'hmac' => $this->hashService->hmac('editform' . $linkProxyName, 'wizard_js'),
            ],
        ]);

        // Field information / wizards (labels, help).
        $fieldInformationResult = $this->renderFieldInformation();
        $resultArray = $this->mergeChildReturnIntoExistingResult(
            $resultArray,
            $fieldInformationResult,
            false
        );

        // The editor opens on the primary breakpoint (the one layers inherit from) — same
        // choice canvas.js makes, so the markup below already matches the first render.
        $activeBp = in_array('lg', Composition::BREAKPOINTS, true)
            ? 'lg'
            : Composition::BREAKPOINTS[0];

        // Breakpoint switcher: plain toggle buttons, NOT tabs — canvas.js animates the stage
        // and every layer over to the geometry stored for the picked breakpoint.
        $bpButtons = [];
        foreach (Composition::BREAKPOINTS as $bp) {
            $active = $bp === $activeBp;
            $bpButtons[] = sprintf(
                '<button type="button" class="btn btn-sm btn-default herobuilder-bp t3js-herobuilder-bp%s"'
                . ' data-breakpoint="%s" aria-pressed="%s" title="%s · %dpx · %s">'
                . '%s<span class="herobuilder-bp-label">%s</span><span class="herobuilder-bp-meta">%d</span>'
                . '</button>',
                $active ? ' active' : '',
                htmlspecialchars($bp),
                $active ? 'true' : 'false',
                htmlspecialchars(strtoupper($bp)),
                (int)$stages[$bp]['width'],
                htmlspecialchars($stages[$bp]['ratio']),
                $this->deviceIcon($bp),
                htmlspecialchars(strtoupper($bp)),
                (int)$stages[$bp]['width']
            );
        }

        $initData = [
            'fieldId' => $fieldId,
            'name' => $itemName,
            'breakpoints' => Composition::BREAKPOINTS,
            'activeBp' => $activeBp,
            'minStageHeight' => Composition::MIN_STAGE_HEIGHT,
            'stages' => $stages,
            'classes' => $classes,
            'labels' => $this->jsLabels(),
            'uid' => (int)($this->data['databaseRow']['uid'] ?? 0),
            'pid' => (int)($this->data['databaseRow']['pid'] ?? ($this->data['effectivePid'] ?? 0)),
            'linkWizardUrl' => $linkWizardUrl,
            'linkProxyName' => $linkProxyName,
            'templatePid' => (int)($this->data['pageTsConfig']['tx_herobuilder.']['templatePid'] ?? ($this->data['databaseRow']['pid'] ?? 0)),
            'value' => $itemValue,
            'moveableUrl' => PathUtility::getPublicResourceWebPath(
                'EXT:herobuilder/Resources/Public/JavaScript/Vendor/moveable.min.js'
            ),
        ];

        $html = [];
        $html[] = '<div class="formengine-field-item t3js-formengine-field-item">';
        $html[] = $fieldInformationResult['html'];
        $html[] = '<div class="form-wizards-wrap"><div class="form-wizards-element">';
        $html[] = '<div class="herobuilder" id="' . htmlspecialchars($fieldId) . '"';
        $html[] = ' data-herobuilder="' . htmlspecialchars(json_encode($initData, JSON_HEX_QUOT | JSON_HEX_APOS | JSON_THROW_ON_ERROR)) . '">';

        // ---- Toolbar: title | actions --------------------------------------
        $html[] = '<div class="herobuilder-toolbar">';
        $html[] = '<div class="herobuilder-title">' . htmlspecialchars($this->getLabel('editor.title', 'Composition')) . '</div>';
        $html[] = '<div class="herobuilder-actions">';
        // Undo / redo drive the in-memory history stack in canvas.js (disabled state is toggled there).
        $html[] = $this->iconButton('t3js-herobuilder-undo', 'actions-undo', 'button.undo', 'Undo');
        $html[] = $this->iconButton('t3js-herobuilder-redo', 'actions-redo', 'button.redo', 'Redo');
        $html[] = $this->iconButton('t3js-herobuilder-add', 'actions-image', 'button.addImage', 'Add image');
        $html[] = $this->iconButton('t3js-herobuilder-add-text', 'content-text', 'button.addText', 'Add text');
        $html[] = $this->iconButton('t3js-herobuilder-add-button', 'actions-link', 'button.addButton', 'Add button');
        $html[] = '<button type="button" class="btn btn-sm btn-default t3js-herobuilder-templates">' . htmlspecialchars($this->getLabel('button.templates', 'Templates')) . '</button>';
        $html[] = '<button type="button" class="btn btn-sm btn-default t3js-herobuilder-save-template">' . htmlspecialchars($this->getLabel('button.saveTemplate', 'Save as template')) . '</button>';
        $html[] = '<button type="button" class="btn btn-sm btn-default t3js-herobuilder-export">' . htmlspecialchars($this->getLabel('button.export', 'Export image')) . '</button>';
        $html[] = '<button type="button" class="btn btn-sm btn-default t3js-herobuilder-preview">' . htmlspecialchars($this->getLabel('button.preview', 'Live preview')) . '</button>';
        $html[] = '</div>';
        $html[] = '</div>';

        // ---- Breakpoint bar (its own row below the toolbar) -----------------
        $html[] = '<div class="herobuilder-breakpoints">';
        $html[] = '<div class="herobuilder-bpbar" role="group" aria-label="'
            . htmlspecialchars($this->getLabel('breakpoints.label', 'Breakpoint')) . '">'
            . implode('', $bpButtons) . '</div>';
        $html[] = '</div>';

        // ---- 3-column grid --------------------------------------------------
        $html[] = '<div class="herobuilder-grid">';

        // Left sidebar: layer panel (populated by JS into .herobuilder-layerlist)
        $html[] = '<div class="herobuilder-sidebar herobuilder-sidebar-left">';
        $html[] = '<div class="herobuilder-sidebar-head">' . htmlspecialchars($this->getLabel('list.title', 'Layers')) . '</div>';
        $html[] = '<div class="herobuilder-layerlist"></div>';
        $html[] = '</div>';

        // Center: canvas with stage + zoom badge (preview iframe mounts here via JS).
        // Width AND height are explicit px rather than aspect-ratio, because canvas.js
        // transitions both when morphing the stage to another breakpoint.
        [$stageW, $stageH] = $this->stageBox($stages[$activeBp]);
        $html[] = '<div class="herobuilder-canvas">';
        // Zoom picker, floating over the top-right of the stage area (options filled by JS,
        // because the available steps depend on the breakpoint's minimum zoom).
        $html[] = '<div class="herobuilder-zoom"><select class="form-select form-select-sm t3js-herobuilder-zoom" aria-label="'
            . htmlspecialchars($this->getLabel('zoom.label', 'Zoom')) . '"></select></div>';
        $html[] = '<div class="herobuilder-stage-wrap">';
        $html[] = '<div class="herobuilder-stage t3js-herobuilder-stage" style="position:relative;width:' . $stageW . 'px;height:' . $stageH . 'px;background:#0b0f14 repeating-conic-gradient(#1b2733 0% 25%,transparent 0% 50%) 50% / 24px 24px;overflow:hidden;border:1px solid var(--typo3-component-border-color,#ccc);border-radius:4px;"></div>';
        $html[] = '</div>'; // .herobuilder-stage-wrap
        $html[] = '</div>'; // .herobuilder-canvas

        // Right sidebar: property tabs + panel body (populated by JS)
        $html[] = '<div class="herobuilder-sidebar herobuilder-sidebar-right">';
        $html[] = '<div class="herobuilder-proptabs">';
        $html[] = '<button type="button" class="herobuilder-proptab active" data-tab="transform">' . htmlspecialchars($this->getLabel('panel.tabTransform', 'Transform')) . '</button>';
        $html[] = '<button type="button" class="herobuilder-proptab" data-tab="style">' . htmlspecialchars($this->getLabel('panel.tabStyle', 'Style')) . '</button>';
        $html[] = '<button type="button" class="herobuilder-proptab" data-tab="anim">' . htmlspecialchars($this->getLabel('panel.tabAnimation', 'Animation')) . '</button>';
        $html[] = '</div>';
        $html[] = '<div class="herobuilder-panel"></div>';
        $html[] = '</div>';

        $html[] = '</div>'; // .herobuilder-grid

        // Persisted value — kept INSIDE .herobuilder so the JS root query finds it.
        $html[] = sprintf(
            '<input type="hidden" name="%s" value="%s" class="t3js-herobuilder-input" data-formengine-input-name="%s" />',
            htmlspecialchars($itemName),
            htmlspecialchars($itemValue, ENT_QUOTES),
            htmlspecialchars($itemName)
        );

        // Proxy input the TYPO3 Link Browser writes into (not part of the record — no data[] name).
        $html[] = sprintf(
            '<input type="hidden" name="%1$s" value="" data-formengine-input-name="%1$s" class="t3js-herobuilder-linkproxy" />',
            htmlspecialchars($linkProxyName)
        );

        $html[] = '</div>'; // .herobuilder
        $html[] = '</div></div></div>';

        $resultArray['html'] = implode(LF, $html);

        $resultArray['javaScriptModules'][] = JavaScriptModuleInstruction::create(
            '@wapplersystems/herobuilder/Backend/canvas.js'
        )->instance($fieldId);

        $resultArray['stylesheetFiles'][] = 'EXT:herobuilder/Resources/Public/Css/backend.css';

        return $resultArray;
    }

    /**
     * A toolbar button prefixed with a core TYPO3 icon (rendered inline by the IconFactory).
     */
    private function iconButton(string $cssClass, string $iconIdentifier, string $labelKey, string $default): string
    {
        return sprintf(
            '<button type="button" class="btn btn-sm btn-default %s">%s <span>%s</span></button>',
            htmlspecialchars($cssClass),
            $this->iconFactory->getIcon($iconIdentifier, IconSize::SMALL)->render(),
            htmlspecialchars($this->getLabel($labelKey, $default))
        );
    }

    /**
     * Inline device glyph for a breakpoint button (falls back to the desktop shape for
     * breakpoints without an explicit mapping).
     */
    private function deviceIcon(string $bp): string
    {
        $device = self::BREAKPOINT_DEVICES[$bp] ?? 'desktop';
        return '<svg class="herobuilder-bp-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"'
            . ' fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">'
            . self::DEVICE_ICONS[$device]
            . '</svg>';
    }

    /**
     * Rendered stage box [width, height] in px for a stage config, so the initial markup already
     * carries the exact box canvas.js animates between (no jump on the first render).
     *
     * Height follows from width ÷ ratio; a box flatter than Composition::MIN_STAGE_HEIGHT is
     * scaled up as a whole (ratio preserved) — same floor canvas.js applies as a zoom minimum.
     *
     * @param array{ratio: string, ratioCss: string, width: int} $stage
     * @return array{0: int, 1: int}
     */
    private function stageBox(array $stage): array
    {
        $parts = array_map('floatval', explode(':', $stage['ratio']));
        $w = (float)$stage['width'];
        if (($parts[0] ?? 0) <= 0 || ($parts[1] ?? 0) <= 0 || $w <= 0) {
            return [(int)$w, 0];
        }
        $h = $w * $parts[1] / $parts[0];
        if ($h < Composition::MIN_STAGE_HEIGHT) {
            $w *= Composition::MIN_STAGE_HEIGHT / $h;
            $h = Composition::MIN_STAGE_HEIGHT;
        }
        return [(int)round($w), (int)round($h)];
    }

    private function getLabel(string $key, string $default): string
    {
        $label = $this->getLanguageService()->sL(
            'LLL:EXT:herobuilder/Resources/Private/Language/locallang_db.xlf:' . $key
        );
        return $label !== '' ? $label : $default;
    }

    /**
     * Localized UI strings handed to the canvas JS (so the editor is fully translatable).
     *
     * @return array<string, string>
     */
    private function jsLabels(): array
    {
        $keys = [
            'panel.text', 'panel.classes', 'panel.animation', 'panel.delay', 'panel.duration',
            'panel.fit', 'panel.visible', 'panel.deleteLayer', 'panel.noClasses', 'panel.animNone',
            'fit.fill', 'fit.cover', 'fit.contain', 'list.empty', 'list.hidden', 'prompt.fileUid',
            'ctx.align', 'ctx.alignLeft', 'ctx.alignCenterH', 'ctx.alignRight', 'ctx.alignTop',
            'ctx.alignMiddle', 'ctx.alignBottom', 'ctx.fillStage', 'ctx.fillStagePlain',
            'ctx.copyToAll', 'ctx.toFront', 'ctx.toBack',
            'panel.geometry', 'panel.focus', 'panel.overlay', 'panel.align', 'panel.alignV', 'ctx.alignLeft', 'ctx.alignCenterH',
            'ctx.alignRight', 'list.reorder', 'list.toggleVisible', 'list.toggleLock',
            'list.duplicate', 'zoom.in', 'zoom.out', 'zoom.reset', 'zoom.fit', 'zoom.label',
            'zoom.min', 'preview.replay',
            'button.copyToAll', 'button.preview', 'panel.link', 'link.choose', 'link.remove',
            'template.title', 'template.apply', 'template.applyBtn', 'template.savePrompt', 'template.saved',
            'template.applyHint', 'template.empty', 'template.saveError',
            'button.export', 'export.title', 'export.hint', 'export.rendering', 'export.error',
            'draft.available', 'draft.restore', 'draft.discard',
            'panel.imageEdit', 'panel.flipH', 'panel.flipV', 'panel.crop', 'panel.cropReset',
            'panel.autoTrim', 'trim.none', 'trim.already',
            'crop.hint', 'crop.cancel', 'crop.reset', 'crop.apply',
            'sidebar.collapse', 'sidebar.expand',
        ];
        $labels = [];
        foreach ($keys as $key) {
            $labels[$key] = $this->getLabel($key, $key);
        }
        return $labels;
    }

    /**
     * Predefined layer CSS classes from page TSconfig `tx_herobuilder.layerClasses`
     * (key = CSS class, value = editor label). Same source the frontend validates against.
     *
     * @return array<int, array{value: string, label: string}>
     */
    private function layerClasses(): array
    {
        $conf = $this->data['pageTsConfig']['tx_herobuilder.']['layerClasses.'] ?? [];
        $classes = [];
        foreach ((array)$conf as $value => $label) {
            $value = trim((string)$value);
            if ($value === '' || !is_string($label)) {
                continue;
            }
            $classes[] = ['value' => $value, 'label' => trim($label) !== '' ? trim($label) : $value];
        }
        return $classes;
    }
}
