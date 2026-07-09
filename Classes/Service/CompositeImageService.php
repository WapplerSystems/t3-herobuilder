<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Service;

/**
 * Phase 3: flattens a collage (for a chosen breakpoint) into a single social/OG image
 * via ImageMagick composite. Placeholder — implemented in Phase 3.
 */
final class CompositeImageService
{
    /**
     * @param array<int, array<string, mixed>> $layers Resolved layers with placements for the target breakpoint.
     * @return string|null Public path to the generated image, or null if generation is unavailable.
     */
    public function flatten(array $layers, int $width, int $height, string $breakpoint = 'lg'): ?string
    {
        // Implemented in Phase 3 (see plan): builds a `magick … -composite` pipeline
        // into fileadmin, cached by a hash of the composition JSON.
        return null;
    }
}
