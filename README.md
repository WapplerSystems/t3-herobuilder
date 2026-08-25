# EXT:herobuilder — Hero Builder

Graphical, per-breakpoint **hero composition builder** for TYPO3.

Editors drag & drop FAL image layers, text and linked button layers onto a **stage**,
position/scale/rotate them **per breakpoint**, and manage multiple **collages** that render as a
Bootstrap 5 **carousel**. Layers stay individual, CSS-positioned elements (`%`-based) — no
server-side flattening for the frontend — with optional **AOS** entrance animations.

A **3-column canvas editor** (toolbar · layer panel · stage · property tabs, based on Moveable)
provides a full WYSIWYG workflow, including reusable **templates**, one-click **social / OG image
export** (ImageMagick), and a **live preview rendered with the real frontend CSS**.

- **Extension key:** `herobuilder`
- **Content element (CType):** `herobuilder`
- **TYPO3:** 12.4 · **PHP:** ≥ 8.1
- **State:** beta (0.1.0)

---

## Table of contents

- [Concepts](#concepts)
- [Feature list](#feature-list)
- [Editor GUI](#editor-gui)
- [Templates](#templates)
- [Social / OG image export](#social--og-image-export)
- [Data model](#data-model)
- [Installation](#installation)
- [Configuration](#configuration)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)

---

## Concepts

- **Stage** — the hero canvas. Each breakpoint has a fixed **aspect ratio** (frontend) and a
  realistic **reference device width** (backend editor), so what you edit matches the device.
- **Breakpoints** — Bootstrap 5: `xs` (<576px), `sm` (576–767), `md` (768–991), `lg` (992–1199),
  `xl` (1200–1399), `xxl` (≥1400). Every layer is positioned independently per breakpoint.
- **Collage** — one slide. A content element holds *n* collages → rendered as a carousel.
- **Layer** — an **image** (FAL), a **text** block, or a **button** (text + TYPO3 link), freely
  placed within the stage.
- **Template** — a reusable composition (record in `tx_herobuilder_template` or a shipped preset)
  that can be applied to a collage or created from one.

---

## Feature list

### Content element & rendering
- Dedicated `herobuilder` content element with a New-Content-Element wizard entry.
- 1:n collages (`tx_herobuilder_collage`) rendered as a **Bootstrap 5 carousel**
  (autoplay, interval, loop, prev/next controls, indicators, pause-on-hover, slide/fade transition).
- Per-breakpoint **stage aspect ratios** (frontend) via scoped, media-query CSS.
- Backend page-module **preview renderer** (slide + layer thumbnails / text chips).

### Layers
- **Image layers** from FAL (native TYPO3 file browser via the sibling `assets` field → real
  `sys_file_reference`, clean reference index).
- **Text layers** — plain text, styled exclusively via predefined classes (safe, auto-escaped).
- **Button layers** — text + **TYPO3 link** (page/url/file/mail/…) via the native Link Browser,
  styled with `btn` classes; rendered as a `<a>` typolink on the frontend.
- **Per-breakpoint geometry** — x / y / width / height (%), rotation, z-index, visibility.
- **Image fit** — `fill` / `cover` / `contain` (no distortion for cover/contain).
- **Focus point** — `object-position` picker (which part stays visible when `cover` crops).
- **Predefined CSS classes** — multi-select (chips) per layer from a page-TSconfig list
  (Bootstrap 5 set); validated against the same whitelist on the frontend (injection-safe).
- **Darkening overlay behind text** — adjustable scrim (0–100 %) for readability over busy images.
- **Per-layer TYPO3 link** on any layer (native Link Browser).
- **AOS entrance animation** per layer (effect, delay, duration).

### Templates & export
- **Templates gallery** (“Templates” button) — apply a reusable composition to the current
  collage; shows rendered thumbnails of shipped **presets** + user templates.
- **Save as template** — store the current composition as a `tx_herobuilder_template` record.
- **Social / OG image export** — render the composition to a downloadable image in OG, 16:9,
  Instagram 1:1 / 4:5 and Story 9:16 formats (ImageMagick, cached).
- See [Templates](#templates) and [Social / OG image export](#social--og-image-export).

### Backend editor (3-column, Moveable-based WYSIWYG)
- **Toolbar**: title, breakpoint pills (active = accent border), and actions
  (Add image/text/button, Templates, Save as template, Export image, Live preview toggle).
- **Left — Layer panel**: rows with color/thumbnail chip, name, eye (visibility) and lock;
  **drag-reorder** the z-stack; right-click for actions (duplicate, align, front/back, delete).
- **Center — Stage**: drag / resize / rotate with **snapping & guide lines** (stage edges/center
  + other layers); **zoom badge** (Ctrl+wheel cursor-anchored, click = fit ↔ 100 %); pan via
  scrollbars, middle-mouse or Space+drag.
- **Right — Property tabs**: **Transform** (numeric X/Y/W/H/rotation + arrow-key nudging, align
  icons, copy-to-all-breakpoints, delete), **Style** (text, link, class chips, fit, focus picker,
  scrim), **Animation** (effect, delay, duration, replay). Fields adapt to the layer type.
- **Undo / redo** (100-step history) + keyboard shortcuts.

### Quality & i18n
- Fully **localized** UI (English source + German `de.` translation) — TCA, tabs, buttons,
  canvas panel, context menu, layer list, zoom, templates, export and preview.
- **CSP-safe live preview** — no inline `<script>` (external same-origin JS) and no inline
  `<style>` (dynamic CSS delivered as a JSON data island, injected via a constructable
  stylesheet). Works under a strict backend CSP (`script-src 'self'`, style-src without
  `'unsafe-inline'`).

---

## Editor GUI

A single field renders the whole editor in a 3-column grid under a toolbar:

```
[ Toolbar: title · breakpoint pills · Add image/text/button · Templates · Save as template · Export · Live preview ]
[ left ~230px: LAYERS | center: stage (zoom badge) | right ~340px: Transform · Style · Animation ]
```

- Selecting a layer (in the stage or the layer list) fills the right property panel.
- The Style tab shows only the controls relevant to the layer type (e.g. fit/focus for images,
  scrim for text, link for all).
- The live preview and the export both reuse the rendering paths described below.

## Templates

Reusable compositions applied to a collage or created from one.

- **Storage** — the `tx_herobuilder_template` table (records editable like any other TYPO3 record;
  put them in a sysfolder). Plus shipped, read-only **presets** as JSON under
  `Resources/Private/Templates/Presets/`.
- **Gallery** — the “Templates” toolbar button opens a modal with a card per template (rendered
  21:9 thumbnail + name). Select a card → “Apply template” replaces the current collage’s layers.
- **Save as template** — the “Save as template” button stores the current composition as a new
  `tx_herobuilder_template` record (via DataHandler) in the folder configured by
  `tx_herobuilder.templatePid` (page TSconfig; falls back to the record’s pid — a sysfolder is
  recommended, see [Configuration](#configuration)).
- Thumbnails are generated by `CompositeImageService` and cached in `typo3temp/assets/herobuilder/`.

## Social / OG image export

The “Export image” button renders the current composition into a downloadable raster image via
**ImageMagick** (`CompositeImageService`), cached by a hash of the inputs.

| Format | Size | Use |
|---|---|---|
| `og` | 1200×630 | Open Graph / Facebook / LinkedIn |
| `wide` | 1200×675 | 16:9 (Twitter/X, YouTube) |
| `square` | 1080×1080 | Instagram 1:1 |
| `portrait` | 1080×1350 | Instagram 4:5 |
| `story` | 1080×1920 | Story / Reel 9:16 |

For each format the breakpoint whose design ratio is closest is used, so the layout looks intended.
Image layers are composited with cover/contain/fill; text/button layers are approximated (font size
scales with canvas width, colors/alignment from classes, buttons as a filled box) — CSS-styled text
can’t be reproduced pixel-perfectly by ImageMagick, which is acceptable for share images/thumbnails.
Requires ImageMagick (`$GLOBALS['TYPO3_CONF_VARS']['GFX']['processor_path']`).

## Data model

`tt_content` (CType `herobuilder`, carousel settings) → 1:n `tx_herobuilder_collage` (one row per
slide). Each collage stores its layer geometry in `composition` (JSON):

```json
{
  "layers": [
    {
      "id": "bg",
      "type": "image",
      "fileUid": 71877,
      "alt": "",
      "link": "",
      "fit": "cover",
      "focusX": 50,
      "focusY": 50,
      "overlay": 0,
      "locked": false,
      "anim": { "effect": "fade-up", "delay": 200, "duration": 600 },
      "placements": {
        "xs": { "x": 0, "y": 0, "w": 100, "h": 100, "rot": 0, "z": 1, "visible": true }
      }
    },
    {
      "id": "t1",
      "type": "text",
      "text": "DEV LAND 2026",
      "cssClass": "display-3 text-white fw-bold text-center",
      "overlay": 55,
      "placements": { "lg": { "x": 20, "y": 60, "w": 60, "h": 12, "rot": 0, "z": 3, "visible": true } }
    },
    {
      "id": "b1",
      "type": "button",
      "text": "Register now",
      "cssClass": "btn btn-primary",
      "link": "t3://page?uid=42",
      "placements": { "lg": { "x": 40, "y": 75, "w": 20, "h": 8, "rot": 0, "z": 4, "visible": true } }
    }
  ]
}
```

Field notes:
- `type` — `"image"` (default), `"text"` or `"button"`.
- `text` — label (text/button layers). `link` — TYPO3 link (`t3://…`), works on any layer;
  a button is rendered as an `<a>` typolink.
- `fit` — `fill` | `cover` | `contain` (image layers).
- `focusX` / `focusY` — 0–100 %, → `object-position` (image layers).
- `cssClass` — space-separated, **whitelisted** predefined classes.
- `overlay` — 0–100 %, dark scrim behind text.
- `locked` — layer locked in the editor (not draggable).
- `placements[<bp>]` — `x,y,w,h` (%), `rot` (deg), `z`, `visible`.

`tx_herobuilder_template` holds the same `composition` JSON plus a `title` and an indicator
`color`; presets are shipped as JSON (`{title, color, layers}`).

---

## Installation

```bash
composer require wapplersystems/herobuilder
vendor/bin/typo3 extension:setup   # or activate in the Extension Manager
```

Then add a **Hero Builder** content element on any page and open its *Collages* tab.

---

## Configuration

### Stage aspect ratios (TypoScript constants)

Frontend stage ratio per breakpoint (`W:H`):

```typoscript
plugin.tx_herobuilder.settings.stages {
    xs.ratio  = 9:16
    sm.ratio  = 3:4
    md.ratio  = 16:9
    lg.ratio  = 21:9
    xl.ratio  = 21:9
    xxl.ratio = 21:9
}
```

The backend editor additionally renders each breakpoint at a realistic **reference device width**
(defaults: xs 390, sm 576, md 768, lg 992, xl 1200, xxl 1400 px).

### Predefined layer classes (page TSconfig)

Selectable per layer in the editor **and** used as the frontend whitelist. Override per site.

```tsconfig
tx_herobuilder.layerClasses {
    display-1       = Display 1 (XXL)
    fw-bold         = Bold
    text-white      = White
    text-bg-primary = Box: primary
    text-center     = Centered
    btn             = Button base
    btn-primary     = Button: primary
    # …
}
```

The shipped set includes `btn`/`btn-*` classes so button layers can be styled.

### Template storage folder (page TSconfig)

Where “Save as template” stores `tx_herobuilder_template` records. Templates are global (listed
regardless of pid); point this at a sysfolder. Falls back to the record’s pid if unset.

```tsconfig
tx_herobuilder.templatePid = 123
```

### Live-preview stylesheets (page TSconfig)

CSS pulled into the live-preview iframe so it looks like the frontend. The extension always adds
its own `hero.css`/`aos.css`; add the site's compiled theme CSS here (absolute URLs used as-is,
`EXT:`/site-relative paths resolved and skipped if missing).

```tsconfig
tx_herobuilder.previewCss {
    10 = /typo3temp/assets/css/mytheme.css
    20 = EXT:my_sitepackage/Resources/Public/Css/fonts.css
}
```

---

## Keyboard shortcuts

Active while the stage/editor is focused.

| Shortcut | Action |
|---|---|
| Arrow keys | Nudge selected layer 1 % (Shift = 5 %) |
| `Delete` / `Backspace` | Delete selected layer |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Y` / `Ctrl/⌘ + Shift + Z` | Redo |
| `Ctrl/⌘ + D` | Duplicate selected layer |
| `Ctrl/⌘ + +` / `−` / `0` | Zoom in / out / reset |
| `Ctrl/⌘ + wheel` | Zoom (anchored at cursor) |
| Middle-mouse drag · `Space` + drag | Pan the stage |
| Right-click | Context menu (align, fill stage, z-order, …) |

---

## Architecture

**Backend**
- `Backend/Form/Element/CanvasElement` — custom FormEngine node `herobuilderCanvas`
  (`renderType`), builds the toolbar/stage/panel and hands localized labels + config to the JS.
- `Resources/Public/JavaScript/Backend/canvas.js` — the Moveable-based editor (breakpoint tabs,
  layers, panel, layer list, snap, zoom/pan, undo/redo, context menu, live-preview driver).
- AJAX routes: `herobuilder_fileinfo` (FAL uids → URL/dimensions), `herobuilder_preview`
  (composition → HTML document for the iframe), `herobuilder_template_list` / `herobuilder_template_save`
  (templates), `herobuilder_export` (composition → social/OG image).
- `Backend/Controller/PreviewController` — renders the unsaved composition via the shared
  `CompositionProcessor::expand()` + the `Preview.html` partial, CSP-safe (see above).
- `Backend/Controller/TemplateController` — lists presets + `tx_herobuilder_template` records
  (with thumbnails) and saves new templates via `DataHandler`.
- `Backend/Controller/ExportController` — renders a chosen social/OG format via `CompositeImageService`.
- `Service/CompositeImageService` — flattens a composition to a cached PNG via ImageMagick
  (used for template thumbnails and export).
- `Backend/Preview/HeroBuilderPreviewRenderer` — page-module preview.
- Records/config: `tx_herobuilder_template` (table + TCA, allowed on standard pages),
  presets in `Resources/Private/Templates/Presets/*.json`.
- The templates gallery ships its styles inline (`GALLERY_CSS` in `canvas.js`) because the TYPO3
  modal renders in the top document, where the field stylesheet is not loaded.

**Frontend**
- `DataProcessing/CompositionProcessor` — resolves FAL layers and generates the scoped
  per-breakpoint CSS (geometry, `object-fit`, `object-position`, text scrim, class whitelist).
- `Domain/Composition` — the `composition` value object (breakpoints, default stage ratios/widths,
  JSON parsing incl. text layers).
- Templates: `Templates/Hero.html` (carousel) → `Partials/Slide.html` → `Partials/Layer.html`;
  `Partials/Preview.html` (style-less variant for the CSP-safe live preview).
- Assets: `Css/hero.css`, `Css/aos.css`, `JavaScript/hero.js` (AOS init),
  `JavaScript/preview-frame.js` (in-iframe CSS injection + AOS replay).

**Localization** — `Resources/Private/Language/locallang_db.xlf` (en, source) and
`de.locallang_db.xlf` (German). JS strings are localized via a `labels` payload from PHP.
