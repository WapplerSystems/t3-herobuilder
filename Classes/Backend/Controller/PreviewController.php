<?php

declare(strict_types=1);

namespace WapplerSystems\Herobuilder\Backend\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Http\HtmlResponse;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use TYPO3\CMS\Core\Utility\PathUtility;
use TYPO3\CMS\Fluid\View\StandaloneView;
use WapplerSystems\Herobuilder\DataProcessing\CompositionProcessor;

/**
 * Backend AJAX endpoint: renders a single (possibly unsaved) collage composition
 * with the SAME Fluid partial as the frontend, wrapped in a document that pulls in the
 * real frontend stylesheets (extension hero/aos CSS + the site's compiled theme CSS from
 * page TSconfig `tx_herobuilder.previewCss`). Loaded into an iframe for a true-to-frontend
 * live preview of text layers, predefined classes and layer geometry.
 */
final class PreviewController
{
    public function __construct(
        private readonly CompositionProcessor $processor,
    ) {}

    public function render(ServerRequestInterface $request): ResponseInterface
    {
        $params = $request->getParsedBody();
        $composition = (string)($params['composition'] ?? '{}');
        $uid = (int)($params['uid'] ?? 0);
        $pid = (int)($params['pid'] ?? 0);

        $slide = $this->processor->expand([
            'uid' => $uid > 0 ? $uid : 1,
            'pid' => $pid,
            'composition' => $composition,
        ]);

        $view = GeneralUtility::makeInstance(StandaloneView::class);
        $view->setPartialRootPaths(['EXT:herobuilder/Resources/Private/Partials/']);
        $view->setLayoutRootPaths(['EXT:herobuilder/Resources/Private/Layouts/']);
        // Preview.html renders the stage WITHOUT an inline <style> (CSP-safe).
        $view->setTemplatePathAndFilename('EXT:herobuilder/Resources/Private/Partials/Preview.html');
        $view->assign('slide', $slide);
        $body = $view->render();

        // Transparent mode (template thumbnails) lets the card's indicator color show through
        // behind compositions that have no background image layer.
        $bg = !empty($params['transparent']) ? 'transparent' : '#fff';
        // Base preview CSS + the scoped composition CSS — delivered as data, injected by JS.
        $css = 'html,body{margin:0;padding:0;background:' . $bg . ';}'
            . '.herobuilder-carousel .hb-stage{width:100%;}'
            . (string)($slide['css'] ?? '');

        return new HtmlResponse($this->document($body, $css, $pid));
    }

    /**
     * Wrap the rendered stage in a minimal HTML document. No inline <style> or <script>:
     * external same-origin stylesheets via <link>, the dynamic CSS as a non-executable JSON
     * data island (not governed by script-src) that preview-frame.js injects via a
     * constructable stylesheet (not governed by style-src). Robust under a strict backend CSP.
     */
    private function document(string $body, string $css, int $pid): string
    {
        $links = '';
        foreach ($this->cssFiles($pid) as $href) {
            $links .= '<link rel="stylesheet" href="' . htmlspecialchars($href) . '">';
        }
        $aos = htmlspecialchars($this->webPath('EXT:herobuilder/Resources/Public/JavaScript/Vendor/aos.js'));
        $frameJs = htmlspecialchars($this->webPath('EXT:herobuilder/Resources/Public/JavaScript/preview-frame.js'));
        // JSON_HEX_TAG prevents a "</script>" in the CSS from breaking out of the data island.
        $cssData = json_encode($css, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return '<!DOCTYPE html><html><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1">'
            . $links
            . '<script type="application/json" id="hb-preview-css">' . $cssData . '</script>'
            . '</head><body><div class="herobuilder-carousel">' . $body . '</div>'
            . '<script src="' . $aos . '"></script><script src="' . $frameJs . '"></script>'
            . '</body></html>';
    }

    /**
     * CSS to include: the extension's own hero/aos CSS (always) plus the site-specific
     * theme CSS configured via page TSconfig `tx_herobuilder.previewCss` (only existing files).
     *
     * @return list<string>
     */
    private function cssFiles(int $pid): array
    {
        $files = [
            $this->webPath('EXT:herobuilder/Resources/Public/Css/aos.css'),
            $this->webPath('EXT:herobuilder/Resources/Public/Css/hero.css'),
        ];

        $configured = BackendUtility::getPagesTSconfig($pid)['tx_herobuilder.']['previewCss.'] ?? [];
        foreach ((array)$configured as $entry) {
            $entry = trim((string)$entry);
            if ($entry === '') {
                continue;
            }
            // Accept absolute URLs as-is; resolve EXT:/relative paths and drop missing files.
            if (preg_match('#^https?://#', $entry)) {
                $files[] = $entry;
                continue;
            }
            $abs = str_starts_with($entry, 'EXT:')
                ? GeneralUtility::getFileAbsFileName($entry)
                : GeneralUtility::getFileAbsFileName(ltrim($entry, '/'));
            if ($abs !== '' && is_file($abs)) {
                $files[] = str_starts_with($entry, 'EXT:')
                    ? $this->webPath($entry)
                    : '/' . ltrim($entry, '/');
            }
        }

        return $files;
    }

    /**
     * Root-relative public web path for an EXT: resource. The srcdoc preview has no <base>,
     * so relative paths (which PathUtility may return) would resolve against the backend URL —
     * force a leading slash.
     */
    private function webPath(string $extPath): string
    {
        $path = PathUtility::getPublicResourceWebPath($extPath);
        return preg_match('#^https?://#', $path) === 1 || str_starts_with($path, '/') ? $path : '/' . $path;
    }
}
