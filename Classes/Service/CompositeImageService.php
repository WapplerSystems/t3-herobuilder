<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Service;

use TYPO3\CMS\Core\Core\Environment;
use TYPO3\CMS\Core\Resource\ResourceFactory;
use TYPO3\CMS\Core\Utility\CommandUtility;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use WapplerSystems\Herobuilder\Domain\Composition;

/**
 * Flattens a collage composition (for a chosen breakpoint) into a single raster image
 * via ImageMagick. Used for template thumbnails; the same pipeline can later back
 * social/OG image export. Output is cached in typo3temp by a hash of the inputs.
 *
 * Image layers are composited with cover/contain/fill; text/button layers are drawn as
 * an approximation (caption text, filled box for buttons) — good enough for thumbnails,
 * since CSS-styled text can't be reproduced exactly by ImageMagick.
 */
final class CompositeImageService
{
    private const OUT_DIR = 'typo3temp/assets/herobuilder/';

    public function __construct(
        private readonly ResourceFactory $resourceFactory,
    ) {}

    /**
     * Social / OG export formats: key => [width, height] in px.
     */
    public const FORMATS = [
        'og' => [1200, 630],        // Open Graph / Facebook / LinkedIn share
        'wide' => [1200, 675],      // 16:9 (Twitter/X, YouTube)
        'square' => [1080, 1080],   // Instagram square
        'portrait' => [1080, 1350], // Instagram 4:5
        'story' => [1080, 1920],    // Story / Reel 9:16
    ];

    /**
     * Render a composition JSON to a PNG thumbnail and return its public web path (or null).
     */
    public function render(string $compositionJson, string $breakpoint = 'lg', int $width = 480): ?string
    {
        [$rw, $rh] = $this->ratio($breakpoint);
        return $this->compose($compositionJson, $breakpoint, $width, (int)round($width * $rh / $rw));
    }

    /**
     * Render a composition in a named social/OG format (picks the breakpoint whose design
     * ratio is closest to the target). Returns the public web path (or null).
     */
    public function renderFormat(string $compositionJson, string $format): ?string
    {
        $size = self::FORMATS[$format] ?? null;
        if ($size === null) {
            return null;
        }
        $breakpoint = $this->closestBreakpoint($size[0] / $size[1]);
        return $this->compose($compositionJson, $breakpoint, $size[0], $size[1]);
    }

    private function compose(string $compositionJson, string $breakpoint, int $width, int $height): ?string
    {
        $magick = $this->magickBinary();
        if ($magick === null) {
            return null;
        }

        $hash = substr(sha1($compositionJson . '|' . $breakpoint . '|' . $width . 'x' . $height), 0, 24);
        $relFile = self::OUT_DIR . 'tpl_' . $hash . '.png';
        $absFile = Environment::getPublicPath() . '/' . $relFile;
        if (is_file($absFile)) {
            return '/' . $relFile;
        }
        GeneralUtility::mkdir_deep(Environment::getPublicPath() . '/' . self::OUT_DIR);

        $composition = Composition::fromJson($compositionJson);
        $layers = $this->orderedLayers($composition->layers, $breakpoint);

        $args = ['-size', $width . 'x' . $height, 'xc:none'];
        foreach ($layers as $layer) {
            $p = $layer['_p'];
            $lx = (int)round(($p['x'] ?? 0) / 100 * $width);
            $ly = (int)round(($p['y'] ?? 0) / 100 * $height);
            $lw = max(1, (int)round(($p['w'] ?? 0) / 100 * $width));
            $lh = max(1, (int)round(($p['h'] ?? 0) / 100 * $height));
            $type = $layer['type'] ?? 'image';

            if ($type === 'text' || $type === 'button') {
                $this->appendTextLayer($args, $layer, $lx, $ly, $lw, $lh, $width);
            } else {
                $this->appendImageLayer($args, $layer, $lx, $ly, $lw, $lh);
            }
        }
        $args[] = $absFile;

        $cmd = escapeshellcmd($magick) . ' ' . implode(' ', array_map('escapeshellarg', $args));
        CommandUtility::exec($cmd);

        return is_file($absFile) ? '/' . $relFile : null;
    }

    /**
     * Layers with a placement for the breakpoint (fallback: first placement), sorted by z.
     *
     * @param array<int, array<string, mixed>> $layers
     * @return array<int, array<string, mixed>>
     */
    private function orderedLayers(array $layers, string $breakpoint): array
    {
        $out = [];
        foreach ($layers as $layer) {
            $placements = (array)($layer['placements'] ?? []);
            $p = $placements[$breakpoint] ?? (reset($placements) ?: null);
            if (!is_array($p) || ($p['visible'] ?? true) === false) {
                continue;
            }
            $layer['_p'] = $p;
            $out[] = $layer;
        }
        usort($out, static fn($a, $b) => (int)($a['_p']['z'] ?? 0) <=> (int)($b['_p']['z'] ?? 0));
        return $out;
    }

    /**
     * @param array<int, string> $args
     * @param array<string, mixed> $layer
     */
    private function appendImageLayer(array &$args, array $layer, int $lx, int $ly, int $lw, int $lh): void
    {
        $file = $this->resolveFilePath((int)($layer['fileUid'] ?? 0));
        if ($file === null) {
            return;
        }
        $box = $lw . 'x' . $lh;
        $fit = (string)($layer['fit'] ?? 'fill');
        $args[] = '(';
        $args[] = $file;
        if ($fit === 'cover') {
            array_push($args, '-resize', $box . '^', '-gravity', 'center', '-extent', $box);
        } elseif ($fit === 'contain') {
            array_push($args, '-resize', $box, '-background', 'none', '-gravity', 'center', '-extent', $box);
        } else {
            $args[] = '-resize';
            $args[] = $box . '!';
        }
        $args[] = ')';
        // Reset gravity so the offset is measured from the top-left, not a leaked -gravity.
        array_push($args, '-gravity', 'NorthWest', '-geometry', '+' . $lx . '+' . $ly, '-composite');
    }

    /**
     * @param array<int, string> $args
     * @param array<string, mixed> $layer
     */
    private function appendTextLayer(array &$args, array $layer, int $lx, int $ly, int $lw, int $lh, int $canvasWidth): void
    {
        $text = trim((string)($layer['text'] ?? ''));
        if ($text === '') {
            $text = ($layer['type'] ?? '') === 'button' ? 'Button' : 'Text';
        }
        $classes = (string)($layer['cssClass'] ?? '');
        $isButton = ($layer['type'] ?? '') === 'button';
        $color = $this->textColor($classes, $isButton);
        // Font size follows the CSS class relative to canvas width (like rem), capped so a
        // single line still fits the box height — independent of the target aspect ratio.
        $pointsize = max(8, min($this->classFontSize($classes, $canvasWidth, $isButton), (int)round($lh * 0.85)));
        $gravity = str_contains($classes, 'text-start') ? 'West'
            : (str_contains($classes, 'text-end') ? 'East' : 'Center');

        $args[] = '(';
        $args[] = '-size';
        $args[] = $lw . 'x' . $lh;
        $args[] = '-background';
        $args[] = $isButton ? $this->buttonBg($classes) : 'none';
        $args[] = '-fill';
        $args[] = $color;
        $args[] = '-gravity';
        $args[] = $gravity;
        $args[] = '-pointsize';
        $args[] = (string)$pointsize;
        $args[] = 'caption:' . $text;
        $args[] = ')';
        array_push($args, '-gravity', 'NorthWest', '-geometry', '+' . $lx . '+' . $ly, '-composite');
    }

    /**
     * Approximate font size (px) from the CSS class, as a fraction of the canvas width
     * (mimics fixed rem-based CSS sizes so text scales consistently across export formats).
     */
    private function classFontSize(string $classes, int $canvasWidth, bool $isButton): int
    {
        $map = [
            'display-1' => 0.075, 'display-2' => 0.063, 'display-3' => 0.052, 'display-4' => 0.044,
            'display-5' => 0.037, 'display-6' => 0.031,
            'fs-1' => 0.042, 'fs-2' => 0.036, 'fs-3' => 0.031, 'fs-4' => 0.026, 'fs-5' => 0.022, 'fs-6' => 0.019,
        ];
        $fraction = $isButton ? 0.024 : 0.028;
        foreach ($map as $class => $frac) {
            if (preg_match('/(^|\s)' . preg_quote($class, '/') . '(\s|$)/', $classes)) {
                $fraction = $frac;
                break;
            }
        }
        return max(8, (int)round($fraction * $canvasWidth));
    }

    private function textColor(string $classes, bool $isButton): string
    {
        if ($isButton) {
            return str_contains($classes, 'btn-light') ? '#111111' : '#ffffff';
        }
        if (str_contains($classes, 'text-white')) {
            return '#ffffff';
        }
        if (str_contains($classes, 'text-dark')) {
            return '#111111';
        }
        if (str_contains($classes, 'text-primary')) {
            return '#0b64c6';
        }
        return '#ffffff';
    }

    private function buttonBg(string $classes): string
    {
        if (str_contains($classes, 'btn-secondary')) {
            return '#6c757d';
        }
        if (str_contains($classes, 'btn-light')) {
            return '#f8f9fa';
        }
        return '#0b64c6';
    }

    private function resolveFilePath(int $uid): ?string
    {
        if ($uid <= 0) {
            return null;
        }
        try {
            $file = $this->resourceFactory->getFileObject($uid);
            $path = $file->getForLocalProcessing(false);
            return is_file($path) ? $path : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The breakpoint whose design ratio (W/H) is closest to the target ratio.
     */
    private function closestBreakpoint(float $targetRatio): string
    {
        $best = 'lg';
        $bestDiff = INF;
        foreach (Composition::DEFAULT_STAGE_RATIOS as $bp => $ratio) {
            $parts = explode(':', $ratio);
            $r = ((float)($parts[1] ?? 0)) > 0 ? (float)$parts[0] / (float)$parts[1] : 1.0;
            $diff = abs($r - $targetRatio);
            if ($diff < $bestDiff) {
                $bestDiff = $diff;
                $best = (string)$bp;
            }
        }
        return $best;
    }

    /**
     * @return array{int, int} width:height parts of the breakpoint stage ratio
     */
    private function ratio(string $breakpoint): array
    {
        $ratio = Composition::DEFAULT_STAGE_RATIOS[$breakpoint] ?? '21:9';
        $parts = explode(':', $ratio);
        $w = (float)($parts[0] ?? 21);
        $h = (float)($parts[1] ?? 9);
        return [(int)max(1, round($w)), (int)max(1, round($h))];
    }

    private function magickBinary(): ?string
    {
        $path = rtrim((string)($GLOBALS['TYPO3_CONF_VARS']['GFX']['processor_path'] ?? ''), '/');
        foreach ([$path . '/magick', $path . '/convert', 'magick', 'convert'] as $bin) {
            if ($bin !== '/magick' && $bin !== '/convert' && (@is_executable($bin) || !str_contains($bin, '/'))) {
                return $bin;
            }
        }
        return null;
    }
}
