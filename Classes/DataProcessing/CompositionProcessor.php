<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\DataProcessing;

use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Resource\File;
use TYPO3\CMS\Core\Resource\ResourceFactory;
use TYPO3\CMS\Frontend\ContentObject\ContentObjectRenderer;
use TYPO3\CMS\Frontend\ContentObject\DataProcessorInterface;
use WapplerSystems\Herobuilder\Domain\Composition;

/**
 * Expands one collage row's `composition` JSON into resolved layers (with FAL File objects),
 * a scoped CSS string (per-breakpoint stage aspect-ratio + layer geometry) and the stage settings.
 *
 * Runs as a nested processor inside DatabaseQueryProcessor (one invocation per collage/slide).
 */
final readonly class CompositionProcessor implements DataProcessorInterface
{
    public function __construct(
        private ResourceFactory $resourceFactory,
    ) {}

    public function process(
        ContentObjectRenderer $cObj,
        array $contentObjectConfiguration,
        array $processorConfiguration,
        array $processedData
    ): array {
        $targetVariableName = (string)($processorConfiguration['as'] ?? 'collage');
        $row = $processedData['data'] ?? $cObj->data ?? [];

        $processedData[$targetVariableName] = $this->expand($row, $processorConfiguration['stages'] ?? []);

        return $processedData;
    }

    /**
     * Expand one collage row's `composition` JSON into a render-ready structure
     * (resolved FAL files, scoped per-breakpoint CSS, stages). Shared by the frontend
     * DataProcessor and the backend live-preview controller.
     *
     * @param array<string, mixed> $row       Collage record (needs uid, pid, composition, title, link)
     * @param array<string, mixed> $stagesOverride TypoScript settings.stages override
     * @return array{uid:int,title:string,link:string,scope:string,css:string,layers:array,stages:array}
     */
    public function expand(array $row, array $stagesOverride = []): array
    {
        $uid = (int)($row['uid'] ?? 0);
        $composition = Composition::fromJson((string)($row['composition'] ?? ''));
        $stages = Composition::stageConfig(is_array($stagesOverride) ? $stagesOverride : []);
        $scope = 'hb-' . $uid;

        $layers = [];
        $css = $this->stageCss($scope, $stages);
        $allowedClasses = $this->allowedClasses((int)($row['pid'] ?? 0));

        foreach ($composition->layers as $index => $layer) {
            $type = $layer['type'] ?? 'image';
            $isText = $type === 'text' || $type === 'button';
            $file = $isText ? null : $this->resolveFile((int)($layer['fileUid'] ?? 0));
            if (!$isText && $file === null) {
                continue;
            }
            $cssClass = $scope . '-l' . $index;
            $css .= $this->layerCss('.' . $cssClass, (array)($layer['placements'] ?? []));
            if (!$isText) {
                $imgDecl = '';
                $fit = $this->normalizeFit($layer['fit'] ?? null);
                if ($fit !== null) {
                    $imgDecl .= 'object-fit:' . $fit . ';';
                }
                // Focus point → object-position (which part stays visible when cropped by cover).
                if (isset($layer['focusX']) || isset($layer['focusY'])) {
                    $fx = $this->clampPercent($layer['focusX'] ?? 50);
                    $fy = $this->clampPercent($layer['focusY'] ?? 50);
                    if ($fx !== 50.0 || $fy !== 50.0) {
                        $imgDecl .= 'object-position:' . $this->pct($fx) . ' ' . $this->pct($fy) . ';';
                    }
                }
                if ($imgDecl !== '') {
                    $css .= '.' . $cssClass . ' .hb-layer-img{' . $imgDecl . '}';
                }
            } else {
                // Darkening scrim behind text for readability over busy backgrounds.
                $overlay = $this->clampPercent($layer['overlay'] ?? 0);
                if ($overlay > 0) {
                    $alpha = rtrim(rtrim(number_format($overlay / 100, 3, '.', ''), '0'), '.');
                    $css .= '.' . $cssClass . '{background-color:rgba(0,0,0,' . $alpha . ');padding:.35em .6em;}';
                }
            }
            $layers[] = [
                'id' => (string)($layer['id'] ?? $cssClass),
                'type' => $isText ? $type : 'image',
                'cssClass' => $cssClass,
                'userClass' => $this->filterClasses((string)($layer['cssClass'] ?? ''), $allowedClasses),
                'text' => $isText ? (string)($layer['text'] ?? '') : '',
                'file' => $file,
                'alt' => $isText ? '' : (string)($layer['alt'] ?? ($file?->getProperty('alternative') ?? '')),
                'link' => (string)($layer['link'] ?? ''),
                'anim' => $layer['anim'] ?? [],
            ];
        }

        return [
            'uid' => $uid,
            'title' => (string)($row['title'] ?? ''),
            'link' => (string)($row['link'] ?? ''),
            'scope' => $scope,
            'css' => $css,
            'layers' => $layers,
            'stages' => $stages,
        ];
    }

    /**
     * @param array<string, array{ratio: string, ratioCss: string}> $stages
     */
    private function stageCss(string $scope, array $stages): string
    {
        $sel = '.' . $scope . ' .hb-stage';
        $first = $stages[Composition::BREAKPOINTS[0]]['ratioCss'] ?? '16 / 9';
        $css = $sel . '{position:relative;aspect-ratio:' . $first . ';}';
        foreach (Composition::BREAKPOINTS as $bp) {
            $ratio = $stages[$bp]['ratioCss'] ?? null;
            if ($ratio === null) {
                continue;
            }
            $css .= '@media ' . Composition::BREAKPOINT_MEDIA[$bp] . '{' . $sel . '{aspect-ratio:' . $ratio . ';}}';
        }
        return $css;
    }

    /**
     * Base rule from the primary placement (lg, else first defined), then per-breakpoint overrides.
     *
     * @param array<string, array<string, mixed>> $placements
     */
    private function layerCss(string $sel, array $placements): string
    {
        if ($placements === []) {
            return '';
        }
        $primaryBp = isset($placements['lg']) ? 'lg' : (string)array_key_first($placements);
        $css = $sel . '{position:absolute;' . $this->declarations($placements[$primaryBp]) . '}';

        foreach (Composition::BREAKPOINTS as $bp) {
            if (!isset($placements[$bp]) || $bp === $primaryBp) {
                continue;
            }
            $css .= '@media ' . Composition::BREAKPOINT_MEDIA[$bp] . '{' . $sel . '{' . $this->declarations($placements[$bp]) . '}}';
        }
        return $css;
    }

    /**
     * @param array<string, mixed> $p
     */
    private function declarations(array $p): string
    {
        if (($p['visible'] ?? true) === false) {
            return 'display:none;';
        }
        $x = (float)($p['x'] ?? 0);
        $y = (float)($p['y'] ?? 0);
        $w = (float)($p['w'] ?? 40);
        $h = (float)($p['h'] ?? 0);
        $rot = (float)($p['rot'] ?? 0);
        $z = (int)($p['z'] ?? 1);

        $d = 'display:block;left:' . $x . '%;top:' . $y . '%;width:' . $w . '%;';
        if ($h > 0) {
            $d .= 'height:' . $h . '%;';
        }
        $d .= 'transform:rotate(' . $rot . 'deg);z-index:' . $z . ';';
        return $d;
    }

    /**
     * Validate the per-layer object-fit against a CSS whitelist; null = keep stylesheet default (fill).
     */
    private function normalizeFit(mixed $fit): ?string
    {
        $fit = is_string($fit) ? strtolower(trim($fit)) : '';
        return in_array($fit, ['cover', 'contain', 'fill', 'none', 'scale-down'], true) ? $fit : null;
    }

    /**
     * Allowed layer classes from page TSconfig `tx_herobuilder.layerClasses` (same source the
     * backend offers for selection). Used to whitelist per-layer classes against injection.
     *
     * @return array<string, true>
     */
    private function allowedClasses(int $pid): array
    {
        $conf = BackendUtility::getPagesTSconfig($pid)['tx_herobuilder.']['layerClasses.'] ?? [];
        $allowed = [];
        foreach ((array)$conf as $class => $label) {
            $class = trim((string)$class);
            if ($class !== '') {
                $allowed[$class] = true;
            }
        }
        return $allowed;
    }

    /**
     * Keep only whitelisted, well-formed class tokens from a space-separated string.
     *
     * @param array<string, true> $allowed
     */
    private function filterClasses(string $classes, array $allowed): string
    {
        $tokens = preg_split('/\s+/', trim($classes)) ?: [];
        $valid = [];
        foreach ($tokens as $token) {
            if ($token !== '' && isset($allowed[$token])) {
                $valid[$token] = $token;
            }
        }
        return implode(' ', $valid);
    }

    private function clampPercent(mixed $value): float
    {
        return max(0.0, min(100.0, (float)$value));
    }

    private function pct(float $value): string
    {
        // Trim trailing zeros for clean CSS (e.g. 33.5% not 33.50%).
        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.') . '%';
    }

    private function resolveFile(int $uid): ?File
    {
        if ($uid <= 0) {
            return null;
        }
        try {
            return $this->resourceFactory->getFileObject($uid);
        } catch (\Throwable) {
            return null;
        }
    }
}
