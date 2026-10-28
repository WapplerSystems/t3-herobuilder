<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\DataProcessing;

use Doctrine\DBAL\Exception as DbalException;
use Psr\Log\LoggerInterface;
use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Database\Connection;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Database\Query\Restriction\DeletedRestriction;
use TYPO3\CMS\Core\Domain\Repository\PageRepository;
use TYPO3\CMS\Core\Imaging\ImageManipulation\CropVariantCollection;
use TYPO3\CMS\Core\Resource\File;
use TYPO3\CMS\Core\Resource\ResourceFactory;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use TYPO3\CMS\Extbase\Service\ImageService;
use TYPO3\CMS\Frontend\ContentObject\ContentObjectRenderer;
use TYPO3\CMS\Frontend\ContentObject\DataProcessorInterface;
use WapplerSystems\Herobuilder\Domain\Composition;

/**
 * Expands one collage row's `composition` JSON into resolved layers (with FAL File objects),
 * a scoped CSS string (per-breakpoint stage aspect-ratio + layer geometry) and the stage settings.
 *
 * Runs as a nested processor inside DatabaseQueryProcessor (one invocation per collage/slide).
 */
final class CompositionProcessor implements DataProcessorInterface
{
    /**
     * Candidate widths (px) for an image layer's srcset, capped at the (cropped) source width.
     * Reaches 3200 so a full-bleed background stays sharp on a 1600px-wide 2x screen.
     */
    private const SRCSET_WIDTHS = [480, 800, 1200, 1600, 2000, 2560, 3200];

    /**
     * HTML elements a text layer may be rendered as (whitelist; anything else becomes a div).
     * Purely semantic — hero.css resets the element's own styles, the look comes from classes.
     */
    private const TEXT_TAGS = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

    /** Output format of the image derivatives unless page TSconfig `tx_herobuilder.imageFormat` says otherwise. */
    private const DEFAULT_IMAGE_FORMAT = 'webp';

    /**
     * Source formats that are never converted: SVG is vector (rasterising only loses), GIF may be
     * animated (a WebP derivative would keep just the first frame).
     */
    private const KEEP_FORMAT = ['svg', 'gif'];

    /** Width the plain `src` fallback is rendered at (what the layer used before srcset). */
    private const FALLBACK_WIDTH = 1600;

    /** @var array<int, string> Stage mode per content element uid (one lookup per carousel). */
    private array $stageModes = [];

    public function __construct(
        private readonly ResourceFactory $resourceFactory,
        private readonly ConnectionPool $connectionPool,
        private readonly ImageService $imageService,
        private readonly LoggerInterface $logger,
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
     * @param array<string, mixed> $row       Collage record (needs uid, pid, composition, title)
     * @param array<string, mixed> $stagesOverride TypoScript settings.stages override
     * @param string|null $stageMode Composition::STAGE_MODE_*; null = the content element's
     *                               `stage_mode` (looked up via the row's content_uid)
     * @return array{uid:int,title:string,scope:string,css:string,layers:array,stages:array}
     */
    public function expand(array $row, array $stagesOverride = [], ?string $stageMode = null): array
    {
        $uid = (int)($row['uid'] ?? 0);
        $composition = Composition::fromJson((string)($row['composition'] ?? ''));
        // Page TSconfig (tx_herobuilder.stages.<bp>.ratio) wins over the TypoScript-setup default,
        // so a site can flatten the hero and the backend editor (which reads the same TSconfig)
        // stays in sync.
        $pid = (int)($row['pid'] ?? 0);
        $tsConfigStages = $pid > 0
            ? Composition::parseTsConfigStages((array)(BackendUtility::getPagesTSconfig($pid)['tx_herobuilder.']['stages.'] ?? []))
            : [];
        $override = array_replace_recursive(is_array($stagesOverride) ? $stagesOverride : [], $tsConfigStages);
        $stages = Composition::stageConfig(
            $override,
            Composition::normalizeStageMode($stageMode ?? $this->stageModeOf((int)($row['content_uid'] ?? 0)))
        );
        $scope = 'hb-' . $uid;

        $layers = [];
        $css = $this->stageCss($scope, $stages);
        $allowedClasses = $this->allowedClasses((int)($row['pid'] ?? 0));
        $imageFormat = $this->imageFormat($pid);

        foreach ($composition->layers as $index => $layer) {
            $type = $layer['type'] ?? 'image';
            $isText = $type === 'text' || $type === 'button';
            $file = $isText ? null : $this->resolveFile((int)($layer['fileUid'] ?? 0));
            if (!$isText && $file === null) {
                continue;
            }
            $cssClass = $scope . '-l' . $index;
            $css .= $this->layerCss('.' . $cssClass, (array)($layer['placements'] ?? []));
            $crop = '';
            $image = null;
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
                // Flip is a pure display transform (no reprocessing, no extra bytes).
                $flipH = !empty($layer['flipH']);
                $flipV = !empty($layer['flipV']);
                if ($flipH || $flipV) {
                    $imgDecl .= 'transform:scale(' . ($flipH ? '-1' : '1') . ',' . ($flipV ? '-1' : '1') . ');';
                }
                if ($imgDecl !== '') {
                    $css .= '.' . $cssClass . ' .hb-layer-img{' . $imgDecl . '}';
                }
                $placements = (array)($layer['placements'] ?? []);
                $framing = $this->framingPerBreakpoint($layer, $placements);
                // Art direction: once any breakpoint has its own focus, every breakpoint states its
                // effective one — media rules overlap (xxl also matches xxxl), so leaving one out
                // would let it inherit a neighbour's focus instead of the layer's.
                if ($this->hasArtDirection($placements)) {
                    foreach (Composition::BREAKPOINTS as $bp) {
                        [$fx, $fy] = $framing[$bp]['focus'];
                        $css .= '@media ' . Composition::BREAKPOINT_MEDIA[$bp] . '{.' . $cssClass . ' .hb-layer-img{object-position:'
                            . $this->pct($fx) . ' ' . $this->pct($fy) . ';}}';
                    }
                }
                // Crop → CropVariants JSON; the derivatives are physically cropped (smaller files).
                $crop = $this->cropString($layer['crop'] ?? null);
                $image = $this->responsiveImage($file, $crop, $placements, $fit, $stages, $imageFormat);
                if ($image !== null) {
                    $image['sources'] = $this->artSources($file, $crop, $framing, $placements, $fit, $stages, $imageFormat);
                }
            } else {
                // Darkening scrim behind text for readability over busy backgrounds.
                $overlay = $this->clampPercent($layer['overlay'] ?? 0);
                if ($overlay > 0) {
                    $alpha = rtrim(rtrim(number_format($overlay / 100, 3, '.', ''), '0'), '.');
                    // Scoped (0,2,0) so it outweighs hero.css's box reset for heading/paragraph layers.
                    $css .= '.' . $scope . ' .' . $cssClass . '{background-color:rgba(0,0,0,' . $alpha . ');padding:.35em .6em;}';
                }
            }
            $layers[] = [
                'id' => (string)($layer['id'] ?? $cssClass),
                'z' => $this->primaryZ((array)($layer['placements'] ?? [])),
                'type' => $isText ? $type : 'image',
                'cssClass' => $cssClass,
                'userClass' => $this->filterClasses((string)($layer['cssClass'] ?? ''), $allowedClasses[$isText ? $type : 'image'] ?? []),
                'text' => $isText ? (string)($layer['text'] ?? '') : '',
                'tag' => $type === 'text' && in_array($layer['tag'] ?? null, self::TEXT_TAGS, true) ? $layer['tag'] : 'div',
                'file' => $file,
                // An empty alt on the layer means "not set": the file's metadata applies, as the
                // editor shows it (placeholder). Only a text entered on the layer overrides it.
                'alt' => $isText ? '' : (trim((string)($layer['alt'] ?? '')) !== ''
                    ? trim((string)$layer['alt'])
                    : (string)($file?->getProperty('alternative') ?? '')),
                'link' => (string)($layer['link'] ?? ''),
                'crop' => $crop,
                'image' => $image,
                'anim' => $layer['anim'] ?? [],
            ];
        }

        // Depth ranking by z-index: the rearmost layer is the slide's background image and is
        // exempt from per-layer transitions (it cross-fades with the slide itself, so the stage
        // is never empty). --hb-depth / --hb-depth-rev let a transition stagger its layers in
        // either direction without the stylesheet knowing how many layers a slide has.
        $order = array_keys($layers);
        usort($order, static fn(int $a, int $b): int => [$layers[$a]['z'], $a] <=> [$layers[$b]['z'], $b]);
        $rearmost = count($order) - 1;
        foreach ($order as $rank => $i) {
            $layers[$i]['depth'] = $rank;
            $layers[$i]['stateClass'] = $rank === 0 ? 'hb-layer-bg' : '';
            $css .= '.' . $layers[$i]['cssClass'] . '{--hb-depth:' . $rank . ';--hb-depth-rev:' . ($rearmost - $rank) . ';}';
        }

        return [
            'uid' => $uid,
            'title' => (string)($row['title'] ?? ''),
            'scope' => $scope,
            'css' => $css,
            'layers' => $layers,
            'stages' => $stages,
        ];
    }

    /**
     * Processed derivatives of an image layer as `src` / `srcset` / `sizes`, so a phone does not
     * load the desktop file and a wide screen does not get an upscaled 1600px one.
     *
     * `sizes` states the width the image is actually painted at per breakpoint. The stage spans
     * the viewport, so a layer box is `w` vw wide; with `cover` the image overflows the box
     * whenever the box is flatter than the image, and is then as wide as box height × aspect.
     * With a fixed stage height that height is a px value, hence `max(…vw, …px)`.
     *
     * The derivatives are written in $imageFormat (WebP by default) — for the PNG cut-outs that
     * hero compositions are made of this is several times smaller, and WebP keeps their alpha.
     *
     * @param array<string, array<string, mixed>> $placements
     * @param array<string, array{ratio: string, ratioCss: string, width: int, height?: string}> $stages
     * @param string $imageFormat Target file extension, '' = keep the source format
     * @return array{src: string, srcset: string, sizes: string, width: int, height: int}|null
     */
    private function responsiveImage(File $file, string $crop, array $placements, ?string $fit, array $stages, string $imageFormat = ''): ?array
    {
        $fileExtension = $imageFormat !== '' && !in_array(strtolower($file->getExtension()), self::KEEP_FORMAT, true)
            ? $imageFormat
            : '';
        $cropArea = CropVariantCollection::create($crop)->getCropArea('default');
        $cropArea = $cropArea->isEmpty() ? null : $cropArea->makeAbsoluteBasedOnFile($file);
        $sourceWidth = (int)round($cropArea?->getWidth() ?? (float)$file->getProperty('width'));
        $sourceHeight = (int)round($cropArea?->getHeight() ?? (float)$file->getProperty('height'));
        if ($sourceWidth <= 0 || $sourceHeight <= 0) {
            return null;
        }

        try {
            $candidates = [];
            foreach (self::SRCSET_WIDTHS as $width) {
                if ($width >= $sourceWidth) {
                    break;
                }
                $candidates[] = $width;
            }
            // The full source width closes the list, so the largest screens get every pixel there is.
            $candidates[] = $sourceWidth;

            $srcset = [];
            $fallback = null;
            $failed = [];
            foreach ($candidates as $width) {
                $instructions = ['width' => $width, 'crop' => $cropArea];
                if ($fileExtension !== '') {
                    $instructions['fileExtension'] = $fileExtension;
                }
                $processed = $this->imageService->applyProcessingInstructions($file, $instructions);
                // A failed processing run silently hands back the original file — uncropped and
                // full size. Retry in the source format first (the processor may not write the
                // target format), then drop the width rather than list the original under it.
                if ($fileExtension !== '' && $processed->usesOriginalFile()) {
                    unset($instructions['fileExtension']);
                    $processed = $this->imageService->applyProcessingInstructions($file, $instructions);
                    $failed['format ' . $fileExtension] = true;
                }
                $originalIsFine = $cropArea === null && $width >= $sourceWidth && !isset($instructions['fileExtension']);
                if ($processed->usesOriginalFile() && !$originalIsFine) {
                    $failed['width ' . $width] = true;
                    continue;
                }
                $uri = $this->imageService->getImageUri($processed);
                if ($uri === '') {
                    return null;
                }
                $srcset[] = $uri . ' ' . (int)$processed->getProperty('width') . 'w';
                if ($fallback === null || $width <= self::FALLBACK_WIDTH) {
                    $fallback = ['uri' => $uri, 'width' => (int)$processed->getProperty('width'), 'height' => (int)$processed->getProperty('height')];
                }
            }
        } catch (\Throwable) {
            return null;
        }
        if ($failed !== []) {
            $this->logger->warning('EXT:herobuilder: image processing failed for "' . $file->getIdentifier() . '" ('
                . implode(', ', array_keys($failed)) . '). Check the GFX processor settings.');
        }
        if ($fallback === null) {
            return null;
        }

        return [
            'src' => $fallback['uri'],
            'srcset' => implode(', ', $srcset),
            'sizes' => $this->sizes($placements, $fit, $sourceWidth / $sourceHeight, $stages),
            'width' => $fallback['width'],
            'height' => $fallback['height'],
        ];
    }

    /**
     * @param array<string, array<string, mixed>> $placements
     * @param array<string, array{ratio: string, width: int, height?: string}> $stages
     */
    private function sizes(array $placements, ?string $fit, float $aspect, array $stages): string
    {
        if ($placements === []) {
            return '100vw';
        }
        // Same cascade as layerCss(): a breakpoint without its own placement uses the primary one.
        $primaryBp = isset($placements['lg']) ? 'lg' : (string)array_key_first($placements);
        $entries = [];
        foreach (array_reverse(Composition::BREAKPOINTS) as $bp) {
            $p = $placements[$bp] ?? $placements[$primaryBp];
            $size = $this->paintedWidth($p, $fit, $aspect, $stages[$bp] ?? null);
            if (preg_match('/min-width:\s*([\d.]+px)/', Composition::BREAKPOINT_MEDIA[$bp], $m)) {
                $entries[] = '(min-width: ' . $m[1] . ') ' . $size;
            } else {
                $entries[] = $size;
            }
        }
        return implode(', ', $entries);
    }

    /**
     * @param array<string, mixed> $p
     * @param array{ratio: string, height?: string}|null $stage
     */
    private function paintedWidth(array $p, ?string $fit, float $aspect, ?array $stage): string
    {
        if (($p['visible'] ?? true) === false) {
            return '1px';
        }
        $w = max(0.0, (float)($p['w'] ?? 40));
        $h = max(0.0, (float)($p['h'] ?? 0));
        $vw = $this->num($w);
        if ($fit !== 'cover' || $h <= 0 || $stage === null) {
            return $vw . 'vw';
        }
        if (isset($stage['height'])) {
            $px = (float)Composition::lengthToPx($stage['height']) * $h / 100 * $aspect;
            return 'max(' . $vw . 'vw, ' . (int)ceil($px) . 'px)';
        }
        // Stage height in vw = 100 × H / W of the ratio.
        $parts = array_map('floatval', explode(':', $stage['ratio']));
        if (($parts[0] ?? 0) <= 0 || ($parts[1] ?? 0) <= 0) {
            return $vw . 'vw';
        }
        $coverVw = $h / 100 * (100 * $parts[1] / $parts[0]) * $aspect;
        return $this->num(max($w, $coverVw)) . 'vw';
    }

    private function num(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }

    /**
     * Effective framing per breakpoint: crop string + focus. A breakpoint takes its placement's
     * own `image` ({crop, focusX, focusY}) when set, otherwise the layer's. A breakpoint without a
     * placement shows the primary placement (same cascade as layerCss()), so it frames like that one.
     *
     * @param array<string, mixed> $layer
     * @param array<string, array<string, mixed>> $placements
     * @return array<string, array{crop: string, focus: array{0: float, 1: float}}>
     */
    private function framingPerBreakpoint(array $layer, array $placements): array
    {
        $primaryBp = isset($placements['lg']) ? 'lg' : (string)array_key_first($placements);
        $out = [];
        foreach (Composition::BREAKPOINTS as $bp) {
            $p = $placements[$bp] ?? ($placements[$primaryBp] ?? []);
            $src = is_array($p['image'] ?? null) ? $p['image'] : $layer;
            $out[$bp] = [
                'crop' => $this->cropString($src['crop'] ?? null),
                'focus' => [$this->clampPercent($src['focusX'] ?? 50), $this->clampPercent($src['focusY'] ?? 50)],
            ];
        }
        return $out;
    }

    /** @param array<string, array<string, mixed>> $placements */
    private function hasArtDirection(array $placements): bool
    {
        foreach ($placements as $p) {
            if (is_array($p['image'] ?? null)) {
                return true;
            }
        }
        return false;
    }

    /**
     * <source> entries for breakpoints whose crop differs from the layer's: each gets its own
     * physically cropped srcset, so a phone downloads the phone framing only — not the desktop
     * image it would mostly crop away. Ordered large → small with exclusive media ranges (the
     * first matching <source> wins); breakpoints framed like the layer fall through to the <img>.
     *
     * @param array<string, array{crop: string, focus: array{0: float, 1: float}}> $framing
     * @param array<string, array<string, mixed>> $placements
     * @param array<string, array{ratio: string, ratioCss: string, width: int, height?: string}> $stages
     * @return list<array{media: string, srcset: string, sizes: string, width: int, height: int}>
     */
    private function artSources(File $file, string $baseCrop, array $framing, array $placements, ?string $fit, array $stages, string $imageFormat): array
    {
        $sources = [];
        $cache = [];
        foreach (array_reverse(Composition::BREAKPOINTS) as $bp) {
            $crop = $framing[$bp]['crop'];
            if ($crop === $baseCrop) {
                continue;
            }
            if (!array_key_exists($crop, $cache)) {
                // array_key_exists, not ??=: a failed crop (null) must not be processed again per breakpoint.
                $cache[$crop] = $this->responsiveImage($file, $crop, $placements, $fit, $stages, $imageFormat);
            }
            if ($cache[$crop] === null) {
                continue;
            }
            $sources[] = [
                'media' => Composition::BREAKPOINT_MEDIA_EXCLUSIVE[$bp],
                'srcset' => $cache[$crop]['srcset'],
                'sizes' => $cache[$crop]['sizes'],
                'width' => $cache[$crop]['width'],
                'height' => $cache[$crop]['height'],
            ];
        }
        return $sources;
    }

    /**
     * The content element's stage mode. Collages are expanded one by one, so the lookup is cached
     * per content element.
     */
    private function stageModeOf(int $contentUid): string
    {
        if ($contentUid <= 0) {
            return Composition::STAGE_MODE_RATIO;
        }
        if (!isset($this->stageModes[$contentUid])) {
            try {
                $mode = $this->readStageMode($contentUid);
            } catch (DbalException $e) {
                // Code deployed, schema not yet (tt_content.stage_mode missing): render the stage
                // as before the column existed instead of failing the whole page.
                $this->logger->warning(Composition::STAGE_MODE_SCHEMA_HINT, ['exception' => $e]);
                $mode = null;
            }
            $this->stageModes[$contentUid] = Composition::normalizeStageMode($mode);
        }
        return $this->stageModes[$contentUid];
    }

    /**
     * stage_mode of the content element as the current context sees it: only deleted records are
     * excluded (a hidden element is still rendered in preview and must not fall back to "ratio"),
     * and the workspace version of the current context is overlaid (frontend preview and the
     * backend live preview alike).
     */
    private function readStageMode(int $contentUid): ?string
    {
        $queryBuilder = $this->connectionPool->getQueryBuilderForTable('tt_content');
        $queryBuilder->getRestrictions()->removeAll()->add(GeneralUtility::makeInstance(DeletedRestriction::class));
        $row = $queryBuilder
            ->select('uid', 'pid', 't3ver_oid', 't3ver_wsid', 't3ver_state', 'stage_mode')
            ->from('tt_content')
            ->where($queryBuilder->expr()->eq('uid', $queryBuilder->createNamedParameter($contentUid, Connection::PARAM_INT)))
            ->executeQuery()
            ->fetchAssociative();
        if (!is_array($row)) {
            return null;
        }
        GeneralUtility::makeInstance(PageRepository::class)->versionOL('tt_content', $row, false, true);
        return is_array($row) ? ($row['stage_mode'] ?? null) : null;
    }

    /**
     * @param array<string, array{ratio: string, ratioCss: string, height?: string}> $stages
     */
    private function stageCss(string $scope, array $stages): string
    {
        $sel = '.' . $scope . ' .hb-stage';
        $css = $sel . '{position:relative;' . $this->stageBox($stages[Composition::BREAKPOINTS[0]] ?? null) . '}';
        foreach (Composition::BREAKPOINTS as $bp) {
            if (!isset($stages[$bp])) {
                continue;
            }
            $css .= '@media ' . Composition::BREAKPOINT_MEDIA[$bp] . '{' . $sel . '{' . $this->stageBox($stages[$bp]) . '}}';
        }
        return $css;
    }

    /**
     * Fixed height or aspect ratio. Both are always declared, so a breakpoint never inherits the
     * other mode's value from a smaller one.
     *
     * @param array{ratioCss: string, height?: string}|null $stage
     */
    private function stageBox(?array $stage): string
    {
        if (isset($stage['height'])) {
            return 'aspect-ratio:auto;height:' . $stage['height'] . ';';
        }
        return 'aspect-ratio:' . ($stage['ratioCss'] ?? '16 / 9') . ';height:auto;';
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
     * z-index of the layer's primary placement (lg, else the first defined) — the single value the
     * depth ranking is built from. Per-breakpoint z overrides are ignored on purpose: the ranking
     * feeds CSS custom properties, which cannot be re-ordered per media query without emitting a
     * full second rule set for every breakpoint.
     *
     * @param array<string, array<string, mixed>> $placements
     */
    private function primaryZ(array $placements): int
    {
        if ($placements === []) {
            return 0;
        }
        $primaryBp = isset($placements['lg']) ? 'lg' : (string)array_key_first($placements);
        return (int)($placements[$primaryBp]['z'] ?? 1);
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
     * Derivative format from page TSconfig `tx_herobuilder.imageFormat`: `webp` (default), another
     * extension the image processor can write, or `original` to keep the source format. A value
     * missing from $GLOBALS['TYPO3_CONF_VARS']['GFX']['imagefile_ext'] falls back to the source
     * format — TYPO3 would refuse to process it.
     */
    private function imageFormat(int $pid): string
    {
        $format = strtolower(trim((string)(BackendUtility::getPagesTSconfig($pid)['tx_herobuilder.']['imageFormat'] ?? self::DEFAULT_IMAGE_FORMAT)));
        if ($format === '' || $format === 'original') {
            return '';
        }
        $allowed = array_map('trim', explode(',', strtolower((string)($GLOBALS['TYPO3_CONF_VARS']['GFX']['imagefile_ext'] ?? ''))));
        return in_array($format, $allowed, true) ? $format : '';
    }

    /**
     * Allowed layer classes from page TSconfig `tx_herobuilder.layerClasses` (same source the
     * backend offers for selection). Used to whitelist per-layer classes against injection.
     *
     * @return array<string, true>
     */
    /**
     * Allowed layer classes per layer type (page TSconfig `tx_herobuilder.layerClasses`, see
     * Composition::layerClassesFromTsConfig()) — a class only renders on a layer of its type.
     *
     * @return array<string, array<string, true>> type => [class => true]
     */
    private function allowedClasses(int $pid): array
    {
        $conf = BackendUtility::getPagesTSconfig($pid)['tx_herobuilder.']['layerClasses.'] ?? [];
        return array_map(
            static fn(array $classes): array => array_fill_keys(array_keys($classes), true),
            Composition::layerClassesFromTsConfig(is_array($conf) ? $conf : [])
        );
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

    private function clamp01(mixed $value): float
    {
        return max(0.0, min(1.0, (float)$value));
    }

    /**
     * Build a CropVariants JSON (fractions 0..1) that f:image consumes to render a physically
     * cropped — and therefore smaller — image derivative. Empty string = no crop (full image).
     */
    private function cropString(mixed $crop): string
    {
        if (!is_array($crop)) {
            return '';
        }
        $x = $this->clamp01($crop['x'] ?? 0);
        $y = $this->clamp01($crop['y'] ?? 0);
        $w = $this->clamp01($crop['width'] ?? 1);
        $h = $this->clamp01($crop['height'] ?? 1);
        // A missing/degenerate or full-frame crop is the same as no crop.
        if ($w <= 0.0 || $h <= 0.0 || ($x === 0.0 && $y === 0.0 && $w >= 1.0 && $h >= 1.0)) {
            return '';
        }
        try {
            return json_encode([
                'default' => [
                    'cropArea' => ['x' => $x, 'y' => $y, 'width' => $w, 'height' => $h],
                    'selectedRatio' => 'NaN',
                    'focusArea' => null,
                ],
            ], JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return '';
        }
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
