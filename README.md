# EXT:herobuilder — Hero Builder

Graphical, per-breakpoint **hero composition builder** for TYPO3.

Editors drag & drop FAL image layers (and text layers) onto a **stage**, position/scale/rotate
them **per breakpoint**, and manage multiple **collages** that render as a Bootstrap 5 **carousel**.
Layers stay individual, CSS-positioned elements (`%`-based) — no server-side flattening — with
optional **AOS** entrance animations. A backend canvas editor (based on Moveable) provides a
full WYSIWYG workflow including a **live preview rendered with the real frontend CSS**.

- **Extension key:** `herobuilder`
- **Content element (CType):** `herobuilder`
- **TYPO3:** 12.4 · **PHP:** ≥ 8.1
- **State:** beta (0.1.0)

---

## Table of contents

- [Concepts](#concepts)
- [Feature list](#feature-list)
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
- **Layer** — an **image** (FAL) or a **text** block, freely placed within the stage.

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
- **Per-breakpoint geometry** — x / y / width / height (%), rotation, z-index, visibility.
- **Image fit** — `fill` / `cover` / `contain` (no distortion for cover/contain).
- **Focus point** — `object-position` picker (which part stays visible when `cover` crops).
- **Predefined CSS classes** — multi-select per layer from a page-TSconfig list (Bootstrap 5 set);
  validated against the same whitelist on the frontend (injection-safe).
- **Darkening overlay behind text** — adjustable scrim (0–100 %) for readability over busy images.
- **AOS entrance animation** per layer (effect, delay, duration).
- **Lock** layers, toggle **visibility** per breakpoint, **z-order**, **duplicate**, **link**.

### Backend canvas editor (Moveable-based WYSIWYG)
- Drag / resize / rotate with **snapping & guide lines** (stage edges/center + other layers).
- **Numeric fields** for X/Y/W/H/rotation + **arrow-key nudging** (1 %, Shift 5 %).
- **Context menu** (right-click): align (6 directions), **fill stage** (cover for backgrounds),
  copy position to all breakpoints, bring to front / send to back, delete.
- **Layer list** — find/select layers; per-row visibility, lock, duplicate, and **drag reorder**
  of the z-stack.
- **Undo / redo** (100-step history) + keyboard shortcuts.
- **Zoom & pan** — zoom via true stage pixel-scaling (Moveable & %-geometry stay exact),
  Ctrl+wheel (cursor-anchored), fit-to-width; pan via scrollbars, middle-mouse or Space+drag.
- **Live preview** in an iframe rendered with the **real frontend stylesheets** (theme/Bootstrap
  + hero/aos CSS) and **playable AOS animations** (auto on change + manual replay).
- **Copy position to all breakpoints** for quick responsive setup.

### Quality & i18n
- Fully **localized** UI (English source + German `de.` translation) — TCA, tabs, buttons,
  canvas panel, context menu, layer list, zoom and preview.
- **CSP-safe live preview** — no inline `<script>` (external same-origin JS) and no inline
  `<style>` (dynamic CSS delivered as a JSON data island, injected via a constructable
  stylesheet). Works under a strict backend CSP (`script-src 'self'`, style-src without
  `'unsafe-inline'`).

---

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
    }
  ]
}
```

Field notes:
- `type` — `"image"` (default) or `"text"`.
- `fit` — `fill` | `cover` | `contain` (image layers).
- `focusX` / `focusY` — 0–100 %, → `object-position` (image layers).
- `cssClass` — space-separated, **whitelisted** predefined classes.
- `overlay` — 0–100 %, dark scrim behind text.
- `placements[<bp>]` — `x,y,w,h` (%), `rot` (deg), `z`, `visible`.

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
    # …
}
```

### Live-preview stylesheets (page TSconfig)

CSS pulled into the live-preview iframe so it looks like the frontend. The extension always adds
its own `hero.css`/`aos.css`; add the site's compiled theme CSS here (absolute URLs used as-is,
`EXT:`/site-relative paths resolved and skipped if missing).

```tsconfig
tx_herobuilder.previewCss {
    10 = /typo3temp/assets/css/doag/event-devland.css
    20 = /typo3temp/assets/css/template/fonts.css
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
- AJAX routes: `herobuilder_fileinfo` (resolve FAL uids → URL/dimensions) and
  `herobuilder_preview` (render the current composition as an HTML document for the iframe).
- `Backend/Controller/PreviewController` — renders the unsaved composition via the shared
  `CompositionProcessor::expand()` + the `Preview.html` partial, CSP-safe (see above).
- `Backend/Preview/HeroBuilderPreviewRenderer` — page-module preview.

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
