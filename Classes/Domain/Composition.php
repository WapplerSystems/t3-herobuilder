<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Domain;

/**
 * Immutable value object for a single collage's `composition` JSON.
 *
 * JSON shape:
 * {
 *   "layers": [
 *     { "id": "l1", "fileUid": 1234, "alt": "…", "link": "t3://page?uid=42",
 *       "anim": { "effect": "fade-up", "delay": 200, "duration": 600 },
 *       "placements": { "lg": {"x":8,"y":55,"w":84,"h":30,"rot":0,"z":2,"visible":true}, … } }
 *   ]
 * }
 */
final readonly class Composition
{
    /** Breakpoint keys, ordered small → large (aligned with ws_t3bootstrap + a wide-viewport tier). */
    public const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'];

    /**
     * Media queries per breakpoint (mirror ws_t3bootstrap). xxl stays open-ended (≥1400) so xxxl
     * inherits it when undefined; xxxl (≥1920) is emitted after xxl and therefore wins for wide
     * viewports — the hero/carousel is full-viewport width, well beyond the 1400px xxl reference.
     */
    public const BREAKPOINT_MEDIA = [
        'xs' => '(max-width: 575.98px)',
        'sm' => '(min-width: 576px) and (max-width: 767.98px)',
        'md' => '(min-width: 768px) and (max-width: 991.98px)',
        'lg' => '(min-width: 992px) and (max-width: 1199.98px)',
        'xl' => '(min-width: 1200px) and (max-width: 1399.98px)',
        'xxl' => '(min-width: 1400px)',
        'xxxl' => '(min-width: 1920px)',
    ];

    /** Default stage aspect ratios per breakpoint (overridable via TypoScript settings.stages). */
    public const DEFAULT_STAGE_RATIOS = [
        'xs' => '9:16',
        'sm' => '3:4',
        'md' => '16:9',
        'lg' => '21:9',
        'xl' => '21:9',
        'xxl' => '21:9',
        'xxxl' => '21:9',
    ];

    /**
     * Reference device width (CSS px) per breakpoint. Used by the backend canvas to render the
     * stage at a realistic width so editors position layers WYSIWYG — a phone-sized (xs/sm) stage
     * is no longer stretched to the full editor width. Overridable via TypoScript settings.stages.
     * The frontend ignores this (its stage is fluid at 100% of the real viewport).
     */
    public const DEFAULT_STAGE_WIDTHS = [
        'xs' => 390,
        'sm' => 576,
        'md' => 768,
        'lg' => 992,
        'xl' => 1200,
        'xxl' => 1400,
        'xxxl' => 1920,
    ];

    /**
     * Smallest height (CSS px) a stage may be rendered at in the backend editor. Ultra-wide
     * ratios (e.g. 2500:480) would otherwise leave a sliver of well under 200px to work in.
     * The stage is scaled UP to reach it — the aspect ratio, and with it the WYSIWYG match to
     * the frontend, is never touched; the editor just starts at a zoom above 100%.
     * Frontend rendering is unaffected.
     */
    public const MIN_STAGE_HEIGHT = 300;

    /** @param array<int, array<string, mixed>> $layers */
    public function __construct(
        public array $layers = [],
    ) {}

    public static function fromJson(string $json): self
    {
        if (trim($json) === '') {
            return new self();
        }
        try {
            $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return new self();
        }
        $layers = [];
        foreach ((array)($data['layers'] ?? []) as $layer) {
            if (!is_array($layer)) {
                continue;
            }
            // Keep text/button layers (styled via classes) and image layers with a real file.
            $type = $layer['type'] ?? 'image';
            if ($type === 'text' || $type === 'button' || (int)($layer['fileUid'] ?? 0) > 0) {
                $layers[] = $layer;
            }
        }
        return new self($layers);
    }

    /**
     * Merge configured stage ratios over the defaults and normalise to a
     * per-breakpoint array of ['ratio' => '21:9', 'ratioCss' => '21 / 9'].
     *
     * @param array<string, mixed> $override TypoScript settings.stages (e.g. ['lg' => ['ratio' => '21:9']])
     * @return array<string, array{ratio: string, ratioCss: string, width: int}>
     */
    /**
     * Normalise page-TSconfig `tx_herobuilder.stages` (keys carry the TSconfig trailing dot,
     * e.g. ['lg.' => ['ratio' => '2500:480']]) into the override shape stageConfig() expects.
     *
     * @param array<string, mixed> $tsStages
     * @return array<string, array{ratio?: string, width?: int}>
     */
    public static function parseTsConfigStages(array $tsStages): array
    {
        $out = [];
        foreach ($tsStages as $key => $val) {
            if (!is_array($val)) {
                continue;
            }
            $bp = rtrim((string)$key, '.');
            if (isset($val['ratio']) && (string)$val['ratio'] !== '') {
                $out[$bp]['ratio'] = (string)$val['ratio'];
            }
            if (isset($val['width']) && (string)$val['width'] !== '') {
                $out[$bp]['width'] = (int)$val['width'];
            }
        }
        return $out;
    }

    public static function stageConfig(array $override): array
    {
        $stages = [];
        foreach (self::BREAKPOINTS as $bp) {
            $ratio = (string)($override[$bp]['ratio'] ?? self::DEFAULT_STAGE_RATIOS[$bp]);
            $width = (int)($override[$bp]['width'] ?? self::DEFAULT_STAGE_WIDTHS[$bp]);
            $stages[$bp] = [
                'ratio' => $ratio,
                'ratioCss' => str_replace(':', ' / ', $ratio),
                'width' => $width,
            ];
        }
        return $stages;
    }
}
