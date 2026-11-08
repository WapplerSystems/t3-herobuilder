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

    /**
     * Part of the cache key: raise it whenever the drawing changes, so images rendered by an older
     * version are not served again (files are cached by composition only). 2 = auto-height text,
     * 3 = mobile-first placement cascade, 4 = single-line buttons at frontend scale,
     * 5/6 = slide background (colour / gradient; 6: radial as the CSS ellipse).
     */
    private const RENDER_VERSION = 6;

    /** Frontend .btn metrics (CSS px): 1rem font, line-height 1.5, padding .375rem .75rem. */
    private const BUTTON_FONT = 16;
    private const BUTTON_LINE = 24;
    private const BUTTON_PAD_X = 12;
    private const BUTTON_PAD_Y = 6;

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

        $hash = substr(sha1(self::RENDER_VERSION . '|' . $compositionJson . '|' . $breakpoint . '|' . $width . 'x' . $height), 0, 24);
        $relFile = self::OUT_DIR . 'tpl_' . $hash . '.png';
        $absFile = Environment::getPublicPath() . '/' . $relFile;
        if (is_file($absFile)) {
            return '/' . $relFile;
        }
        GeneralUtility::mkdir_deep(Environment::getPublicPath() . '/' . self::OUT_DIR);

        $composition = Composition::fromJson($compositionJson);
        $layers = $this->orderedLayers($composition->layers, $breakpoint);

        // Frontend CSS px → image px: the image stands for the breakpoint's stage width.
        $scale = $width / (float)(Composition::DEFAULT_STAGE_WIDTHS[$breakpoint] ?? $width);
        $args = $this->backgroundArgs($composition->background, $width, $height);
        foreach ($layers as $layer) {
            $p = $layer['_p'];
            $lx = (int)round(($p['x'] ?? 0) / 100 * $width);
            $ly = (int)round(($p['y'] ?? 0) / 100 * $height);
            $lw = max(1, (int)round(($p['w'] ?? 0) / 100 * $width));
            $lh = max(1, (int)round(($p['h'] ?? 0) / 100 * $height));
            $type = $layer['type'] ?? 'image';

            if ($type === 'button') {
                $autoHeight = (float)($p['h'] ?? 0) <= 0;
                $this->appendButtonLayer($args, $layer, $lx, $ly, $lw, $autoHeight ? 0 : $lh, $scale, $magick);
            } elseif ($type === 'text') {
                // h = 0 means "auto" (the frontend box grows with its text) — not a 1px box.
                $autoHeight = (float)($p['h'] ?? 0) <= 0;
                $this->appendTextLayer($args, $layer, $lx, $ly, $lw, $autoHeight ? 0 : $lh, $width);
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
     * Layers with a placement for the breakpoint (fallback: lg, else the first one), sorted by z.
     *
     * @param array<int, array<string, mixed>> $layers
     * @return array<int, array<string, mixed>>
     */
    private function orderedLayers(array $layers, string $breakpoint): array
    {
        $out = [];
        foreach ($layers as $layer) {
            $placements = (array)($layer['placements'] ?? []);
            // Same cascade as the frontend (mobile first, Composition::effectivePlacement()).
            $p = Composition::effectivePlacement($placements, $breakpoint)
                ?? (Composition::effectivePlacement($placements, 'lg'));
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
    /**
     * Canvas the layers are drawn on: the slide background (Composition::normalizeBackground()),
     * transparent without one. ImageMagick's gradient:angle follows the CSS convention (0 = from
     * bottom to top, 90 = left to right); a radial gradient is the ellipse from the centre to the
     * corners that CSS radial-gradient draws by default.
     *
     * @return list<string>
     */
    private function backgroundArgs(?array $background, int $width, int $height): array
    {
        $size = ['-size', $width . 'x' . $height];
        return match ($background['type'] ?? '') {
            'color' => [...$size, 'xc:' . $background['color']],
            'linear' => ['-define', 'gradient:angle=' . (int)$background['angle'], ...$size,
                'gradient:' . $background['from'] . '-' . $background['to']],
            // CSS radial-gradient's default is an ellipse reaching the corners: radii = half the
            // width / height × √2 (ImageMagick's own extents draw a circle).
            'radial' => ['-define', sprintf('gradient:radii=%.1f,%.1f', $width / 2 * M_SQRT2, $height / 2 * M_SQRT2), ...$size,
                'radial-gradient:' . $background['from'] . '-' . $background['to']],
            default => [...$size, 'xc:none'],
        };
    }

    /**
     * A button as the frontend draws it: one line (.btn is white-space:nowrap), fixed px font and
     * padding scaled to the image, at least as wide as its box and centred on it — a label longer
     * than the box widens the button instead of breaking mid-word ("TiltSt|ation").
     */
    private function appendButtonLayer(array &$args, array $layer, int $lx, int $ly, int $lw, int $lh, float $scale, string $magick): void
    {
        $text = trim((string)($layer['text'] ?? '')) ?: 'Button';
        $classes = (string)($layer['cssClass'] ?? '');
        $pointsize = max(6.0, round(self::BUTTON_FONT * $scale, 1));
        $padX = self::BUTTON_PAD_X * $scale;
        $padY = self::BUTTON_PAD_Y * $scale;
        $textWidth = $this->textWidth($magick, $text, $pointsize);
        $btnW = max($lw, (int)ceil($textWidth + 2 * $padX));
        $btnH = $lh > 0 ? $lh : (int)ceil(self::BUTTON_LINE * $scale + 2 * $padY);
        $x = $lx + (int)round(($lw - $btnW) / 2);

        $args[] = '(';
        array_push($args, '-size', $btnW . 'x' . $btnH, 'xc:' . $this->buttonBg($classes));
        array_push($args, '-fill', $this->textColor($classes, true), '-pointsize', (string)$pointsize);
        array_push($args, '-gravity', 'Center', '-annotate', '+0+0', $this->magickText($text));
        $args[] = ')';
        array_push($args, '-gravity', 'NorthWest', '-geometry', '+' . $x . '+' . $ly, '-composite');
    }

    /** Width (px) ImageMagick needs for one line of $text at $pointsize (default font, as drawn). */
    private function textWidth(string $magick, string $text, float $pointsize): float
    {
        $cmd = escapeshellcmd($magick) . ' ' . implode(' ', array_map('escapeshellarg', [
            '-pointsize', (string)$pointsize, 'label:' . $this->magickText($text), '-format', '%w', 'info:',
        ]));
        $output = [];
        CommandUtility::exec($cmd, $output);
        $width = (float)trim((string)($output[0] ?? ''));
        // Fallback when measuring fails: an average glyph is about 0.55 em wide.
        return $width > 0 ? $width : mb_strlen($text) * $pointsize * 0.55;
    }

    /**
     * Text for ImageMagick label:/caption:/-annotate: a leading "@" would read a file, "%"
     * starts a format escape and "\" an escape sequence — editor text is shown literally.
     */
    private function magickText(string $text): string
    {
        $text = str_replace(['\\', '%'], ['\\\\', '%%'], $text);
        return str_starts_with($text, '@') ? '\\' . $text : $text;
    }

    private function appendTextLayer(array &$args, array $layer, int $lx, int $ly, int $lw, int $lh, int $canvasWidth): void
    {
        $text = trim((string)($layer['text'] ?? ''));
        if ($text === '') {
            $text = ($layer['type'] ?? '') === 'button' ? 'Button' : 'Text';
        }
        $classes = (string)($layer['cssClass'] ?? '');
        $isButton = ($layer['type'] ?? '') === 'button';
        $color = $this->textColor($classes, $isButton);
        // Font size follows the CSS class relative to canvas width (like rem). A fixed box caps it
        // so a single line still fits the box height; an auto-height box ($lh = 0) lets ImageMagick
        // size the caption from the text instead (-size Wx), as the frontend box grows with it.
        $fontSize = $this->classFontSize($classes, $canvasWidth, $isButton);
        $pointsize = $lh > 0 ? max(8, min($fontSize, (int)round($lh * 0.85))) : $fontSize;
        $gravity = str_contains($classes, 'text-start') ? 'West'
            : (str_contains($classes, 'text-end') ? 'East' : 'Center');
        $background = $isButton ? $this->buttonBg($classes) : 'none';
        // An auto-height button gets padding around its caption, like a .btn.
        $padX = $lh > 0 || !$isButton ? 0 : (int)round($pointsize * 0.75);
        $padY = $lh > 0 || !$isButton ? 0 : (int)round($pointsize * 0.4);

        $args[] = '(';
        $args[] = '-size';
        $args[] = max(1, $lw - 2 * $padX) . 'x' . ($lh > 0 ? $lh : '');
        $args[] = '-background';
        $args[] = $background;
        $args[] = '-fill';
        $args[] = $color;
        $args[] = '-gravity';
        $args[] = $gravity;
        $args[] = '-pointsize';
        $args[] = (string)$pointsize;
        $args[] = 'caption:' . $this->magickText($text);
        if ($padX > 0) {
            array_push($args, '-bordercolor', $background, '-border', $padX . 'x' . $padY);
        }
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
