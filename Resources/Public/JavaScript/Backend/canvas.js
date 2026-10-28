import AjaxRequest from "@typo3/core/ajax/ajax-request.js";
import Modal from "@typo3/backend/modal.js";
import Notification from "@typo3/backend/notification.js";

const AOS_EFFECTS = [
  "", "fade-up", "fade-down", "fade-left", "fade-right",
  "zoom-in", "zoom-out", "flip-left", "flip-up", "slide-up",
];

// Per-layer image scaling (CSS object-fit). "fill" stretches (legacy default); "cover"/"contain"
// keep the aspect ratio — cover for full-bleed backgrounds, contain for logos/text.
// Labels are resolved via i18n (this.t("fit.<value>")) at render time.
const FIT_MODES = ["fill", "cover", "contain"];

// HTML element of a text layer. Purely semantic: hero.css resets the heading/paragraph styles,
// the look still comes from the classes. Mirrors CompositionProcessor::TEXT_TAGS.
const TEXT_TAGS = ["div", "p", "h1", "h2", "h3", "h4", "h5", "h6"];

// A placement without the breakpoint-specific image framing (`image: {crop, focusX, focusY}`).
const geometryOf = (p) => {
  const { image, ...geometry } = p;
  return { ...geometry };
};

// Format version written into the composition JSON (Composition::VERSION in PHP).
const COMPOSITION_VERSION = 1;

// Height the live preview is fitted into until the editor resizes the panel.
const PREVIEW_MAX_HEIGHT = 420;

// Duration of the breakpoint morph (stage box + layer geometry). Must stay in sync with the
// `--hb-bp-anim` transition in backend.css — the reconciling render() runs once it is over.
const BP_ANIM_MS = 480;

// Snapping pull, in screen px. The old value was 6, which is about the width of a pointer
// jitter — it snapped, but you had to already be on the edge for it to trigger, so it never
// felt like a magnet. 12 grabs from a visible distance without fighting deliberate placement.
//
// Moveable 0.53 splits this across three options and only the latter two set the actual pull:
// `snapThreshold` decides which guidelines get built at all, while snapHorizontalThreshold /
// snapVerticalThreshold are the distances the target is drawn in from (both default 5, which is
// why raising snapThreshold alone changed nothing). Setting all three keeps it moot which axis
// Moveable maps to which name.
const SNAP_THRESHOLD = 12;

// Offered in the zoom picker; steps below a breakpoint's minimum zoom are dropped from the list.
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// Hard lower bound for the zoom. minStageHeight still decides what a breakpoint *opens* at, but
// it must not lock the editor out of 1:1 — on a very flat site ratio (e.g. 2500:480 on lg+) the
// height floor sits at 158%, which used to remove 100% from the picker and clamp it away when
// picked. 100% is the view that matches the frontend, so it has to stay reachable.
const MIN_ZOOM = 0.1;

// Styles for the templates gallery, injected into the modal (which lives in the TOP
// document, where the field's backend.css is not present).
const GALLERY_CSS = `
.herobuilder-tpl-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.6rem;padding:.25rem;}
.herobuilder-tpl-gallery .hb-tpl-card{display:flex;flex-direction:column;gap:.35rem;padding:.3rem;border:2px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;text-align:left;}
.herobuilder-tpl-gallery .hb-tpl-card:hover{border-color:#0b64c6;}
.herobuilder-tpl-gallery .hb-tpl-card.active{border-color:#0b64c6;box-shadow:0 0 0 3px rgba(11,100,198,.25);}
.herobuilder-tpl-gallery .hb-tpl-thumb{position:relative;display:block;width:100%;aspect-ratio:21/9;overflow:hidden;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}
.herobuilder-tpl-gallery .hb-tpl-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
.herobuilder-tpl-gallery .hb-tpl-name{font-size:.78rem;font-weight:600;line-height:1.2;}
.herobuilder-tpl-gallery .hb-tpl-empty{grid-column:1/-1;color:#6c757d;}
.herobuilder-tpl-gallery .hb-tpl-hint{grid-column:1/-1;margin:.5rem 0 0;font-size:.8rem;color:#6c757d;}
`;

// Crop editor styles, injected into the TYPO3 modal (top document, no field backend.css).
const CROP_CSS = `
.herobuilder-crop .hb-crop-hint{margin:0 0 .6rem;font-size:.85rem;color:#6c757d;}
.herobuilder-crop .hb-crop-stage{position:relative;display:flex;justify-content:center;align-items:center;padding:14px;border-radius:4px;background:#0b0f14 repeating-conic-gradient(#1b2733 0 25%,transparent 0 50%) 50%/24px 24px;}
.herobuilder-crop .hb-crop-frame{position:relative;max-width:100%;box-shadow:0 0 0 1px rgba(255,255,255,.3);}
.herobuilder-crop .hb-crop-frame img{display:block;width:100%;height:100%;user-select:none;-webkit-user-drag:none;}
.herobuilder-crop .hb-crop-rect{position:absolute;box-sizing:border-box;border:1px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move;}
.herobuilder-crop .hb-crop-dims{margin:.55rem 0 0;font-size:.8rem;color:#6c757d;text-align:center;}
`;

// Social / OG export formats (keys must match CompositeImageService::FORMATS).
const EXPORT_FORMATS = [
  { key: "og", label: "Open Graph · 1200×630" },
  { key: "wide", label: "16:9 · 1200×675" },
  { key: "square", label: "Instagram 1:1 · 1080×1080" },
  { key: "portrait", label: "Instagram 4:5 · 1080×1350" },
  { key: "story", label: "Story 9:16 · 1080×1920" },
];

// Inline SVG icons (currentColor, 16px) for the layer list and alignment buttons.
const S = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">';
const ICON = {
  eye: S + '<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="1.8"/></svg>',
  eyeOff: S + '<path d="M6.5 3.7A6.6 6.6 0 0 1 8 3.5c4.5 0 7 4.5 7 4.5a12 12 0 0 1-2 2.4M4 4.6A11.7 11.7 0 0 0 1 8s2.5 4.5 7 4.5a6.6 6.6 0 0 0 2.6-.5"/><path d="M2 2l12 12"/></svg>',
  lock: S + '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  unlock: S + '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.6"/></svg>',
  alignLeft: S + '<path d="M2 2v12"/><rect x="4" y="4" width="8" height="3" rx="1"/><rect x="4" y="9" width="5" height="3" rx="1"/></svg>',
  alignCenterH: S + '<path d="M8 2v12"/><rect x="4" y="4" width="8" height="3" rx="1"/><rect x="5.5" y="9" width="5" height="3" rx="1"/></svg>',
  alignRight: S + '<path d="M14 2v12"/><rect x="4" y="4" width="8" height="3" rx="1"/><rect x="7" y="9" width="5" height="3" rx="1"/></svg>',
  alignV: S + '<path d="M2 8h12"/><rect x="4" y="4" width="3" height="8" rx="1"/><rect x="9" y="5.5" width="3" height="5" rx="1"/></svg>',
  alignTop: S + '<path d="M2 2h12"/><rect x="4" y="4" width="3" height="8" rx="1"/><rect x="9" y="4" width="3" height="5" rx="1"/></svg>',
  alignBottom: S + '<path d="M2 14h12"/><rect x="4" y="4" width="3" height="8" rx="1"/><rect x="9" y="7" width="3" height="5" rx="1"/></svg>',
  flipH: S + '<path d="M8 1.5v13"/><path d="M6 5 3 8l3 3z"/><path d="M10 5l3 3-3 3z"/></svg>',
  flipV: S + '<path d="M1.5 8h13"/><path d="M5 6 8 3l3 3z"/><path d="M5 10l3 3 3-3z"/></svg>',
  crop: S + '<path d="M4.5 1v10.5H15"/><path d="M1 4.5h10.5V15"/></svg>',
  chevronLeft: S + '<path d="M10 3 5 8l5 5"/></svg>',
  chevronRight: S + '<path d="M6 3l5 5-5 5"/></svg>',
  trash: S + '<path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/><path d="M4 4l.7 9.5h6.6L12 4"/></svg>',
};

/**
 * Size and offset of a cropped image region (aspect `regionAspect`) fitted into a box like
 * CSS object-fit + object-position: "fill" stretches, "cover"/"contain" scale uniformly and the
 * leftover space is split by the focus point — (box − region) × focus %, exactly what the
 * frontend's object-position does with the cropped derivative.
 *
 * @returns {{w: number, h: number, left: number, top: number}}
 */
export function fitRegion(boxW, boxH, regionAspect, fit, focusX = 50, focusY = 50) {
  if (fit !== "cover" && fit !== "contain") {
    return { w: boxW, h: boxH, left: 0, top: 0 };
  }
  const wide = boxW / boxH > regionAspect;
  const [w, h] = (fit === "cover") === wide
    ? [boxW, boxW / regionAspect]
    : [boxH * regionAspect, boxH];
  return { w, h, left: (boxW - w) * focusX / 100, top: (boxH - h) * focusY / 100 };
}

/**
 * True for a text/button layer without a height of its own on this placement: its box follows
 * the text, as in the frontend (CompositionProcessor::declarations() omits the height).
 */
export function isAutoHeight(layer, p) {
  return !!layer && (layer.type === "text" || layer.type === "button") && !(p && p.h);
}

/** True when a placement covers the whole stage — a background that must keep filling it. */
export function isFullBleed(p) {
  return !!p && (p.x ?? 0) <= 0 && (p.y ?? 0) <= 0
    && (p.x ?? 0) + (p.w ?? 0) >= 100 && (p.y ?? 0) + (p.h ?? 0) >= 100;
}

/**
 * Hero Builder canvas editor (FormEngine node).
 *
 * - Drag/resize/rotate layers per breakpoint (Moveable).
 * - "Add image" opens the native TYPO3 file browser of the sibling `assets` field, so files
 *   land as real sys_file_references (reference index) and are mirrored as layers via the
 *   `typo3:foreignRelation:insert` postMessage.
 * - Per-layer panel: entrance animation (AOS), visibility per breakpoint, z-order, delete.
 */
export default class HerobuilderCanvas {
  constructor(fieldId) {
    this.root = document.getElementById(fieldId);
    if (!this.root || this.root.dataset.herobuilderInit === "1") {
      return;
    }
    this.root.dataset.herobuilderInit = "1";

    const init = JSON.parse(this.root.dataset.herobuilder || "{}");
    this.breakpoints = init.breakpoints || ["lg"];
    this.stages = init.stages || {};
    // Stage configs for both stage modes (aspect ratio / fixed height). The mode is a field of
    // the parent content element in the same form; its current — possibly unsaved — value wins
    // over the stored one, so the editor always shows what the frontend will render.
    this.stagesByMode = init.stagesByMode || null;
    this.stageMode = init.stageMode || "ratio";
    this.stageModeField = init.stageModeField || "";
    const modeField = this.stageModeField ? document.querySelector('[name="' + CSS.escape(this.stageModeField) + '"]') : null;
    if (modeField && this.stagesByMode && this.stagesByMode[modeField.value]) {
      this.stageMode = modeField.value;
      this.stages = this.stagesByMode[this.stageMode];
    }
    // Classes per layer type ({text: [...], button: [...], image: [...]}).
    this.classes = init.classes && typeof init.classes === "object" ? init.classes : {};
    // Optional grouping for the panel (headings, exclusive groups, background groups).
    this.classGroups = init.classGroups && typeof init.classGroups === "object" ? init.classGroups : {};
    this.labels = init.labels || {};
    this.uid = init.uid || 0;
    this.pid = init.pid || 0;
    this.previewUrl = window.TYPO3?.settings?.ajaxUrls?.herobuilder_preview || null;
    this.previewOpen = false;
    // Floor for the rendered stage height (Composition::MIN_STAGE_HEIGHT). Enforced as a zoom
    // minimum, so a flat ratio never leaves a sliver to work in — see minZoomValue().
    this.minStageHeight = parseInt(init.minStageHeight, 10) || 0;
    this.zoom = 1;
    this._spaceDown = false;
    this.linkWizardUrl = init.linkWizardUrl || null;
    this.linkProxy = init.linkProxyName ? this.root.querySelector('[data-formengine-input-name="' + init.linkProxyName + '"]') : null;
    this.templatePid = init.templatePid || 0;
    this.templateListUrl = window.TYPO3?.settings?.ajaxUrls?.herobuilder_template_list || null;
    this.templateSaveUrl = window.TYPO3?.settings?.ajaxUrls?.herobuilder_template_save || null;
    this.exportUrl = window.TYPO3?.settings?.ajaxUrls?.herobuilder_export || null;
    this.moveableUrl = init.moveableUrl || null;
    this.name = init.name || "";
    // PHP pre-renders the stage + pressed button for this breakpoint, so honour its choice —
    // otherwise the very first render would already have to jump to another stage size.
    this.activeBp = this.breakpoints.includes(init.activeBp)
      ? init.activeBp
      : (this.breakpoints.includes("lg") ? "lg" : this.breakpoints[0]);
    // Open at the breakpoint's base view (100%, or scaled up to clear minStageHeight).
    this.zoom = this.baseZoomValue();
    // Loaded <img> nodes are reused across re-renders (keyed by layer id) so rebuilding the
    // stage — e.g. the reconciling render after a breakpoint morph — never flashes.
    this._imgCache = new Map();

    this.stageEl = this.root.querySelector(".t3js-herobuilder-stage");
    this.input = this.root.querySelector(".t3js-herobuilder-input");
    this.panel = null;
    this.selected = null;
    this.moveable = null;
    this.fileInfo = {};
    // Snapping is a working preference, not document data: it belongs to the editor, not to the
    // collage, so it lives in localStorage and applies to every composition this user opens.
    this.magnet = this.loadMagnet();
    // Alt held down suspends snapping for as long as it is held (see bindKeyboard).
    this._altSnapOff = false;

    const m = this.name.match(/\[tx_herobuilder_collage\]\[([^\]]+)\]/);
    this.recordId = m ? m[1] : null;
    this.assetsSuffix = this.recordId ? "-" + this.recordId + "-assets-sys_file_reference" : null;

    let value = {};
    try {
      value = JSON.parse(init.value || this.input.value || "{}");
    } catch (e) {
      value = {};
    }
    this.layers = Array.isArray(value.layers) ? value.layers : [];

    // Raw JSON as persisted in the record (DB), used to decide whether a localStorage
    // draft is newer/unsaved and therefore worth offering for recovery.
    this._serverValue = (typeof init.value === "string" && init.value !== "")
      ? init.value
      : (this.input.value || "");

    // Undo/redo history (JSON snapshots of the serialized layers).
    this._history = [];
    this._histIndex = -1;
    this._restoring = false;
    this._draftTimer = null;

    this.stageEl.tabIndex = 0; // focusable so keyboard shortcuts scope to the editor

    this.buildZoomControl();
    this.buildLayerList();
    this.buildPreview();
    this.buildPanel();
    this.bindToolbar();
    this.bindProps();
    this.buildSidebarToggles();
    this.bindStageNav();
    this.bindKeyboard();
    this.listenForAssetInserts();
    this.listenForStageMode();
    this.init();
  }

  /** Follow the content element's stage mode field (delegated: inline forms load lazily). */
  listenForStageMode() {
    if (!this.stageModeField || !this.stagesByMode) {
      return;
    }
    this.updateBpTitles();
    document.addEventListener("change", (e) => {
      if (this.root.isConnected && e.target && e.target.name === this.stageModeField) {
        this.setStageMode(e.target.value);
      }
    });
  }

  setStageMode(mode) {
    if (!this.stagesByMode || !this.stagesByMode[mode] || mode === this.stageMode) {
      return;
    }
    const atBase = Math.abs(this.zoom - this.baseZoomValue()) < 0.01;
    this.stageMode = mode;
    this.stages = this.stagesByMode[mode];
    this.zoom = atBase ? this.baseZoomValue() : Math.max(this.zoom, this.minZoomValue());
    this.deselect();
    this.updateBpTitles();
    this.updatePreviewWidth();
    this.render();
    this.schedulePreviewRefresh();
  }

  /** Breakpoint button tooltips name the stage format: fixed height, else the ratio. */
  updateBpTitles() {
    this.root.querySelectorAll(".t3js-herobuilder-bp").forEach((b) => {
      const stage = this.stages[b.dataset.breakpoint];
      if (stage) {
        b.title = b.dataset.breakpoint.toUpperCase() + " · " + stage.width + "px · " + (stage.height || stage.ratio);
      }
    });
  }

  async init() {
    await this.ensureMoveable();
    await this.loadFileInfo();
    this.render();
    // Seed the history with the initial state.
    this._history = [this.serialize()];
    this._histIndex = 0;
    this.updateHistoryButtons();
    // No save() runs during load, so the localStorage draft is still intact here —
    // offer it before anything can overwrite it.
    this.maybeOfferDraft();
  }

  /**
   * Load the Moveable UMD as a classic same-origin script so it registers window.Moveable.
   * The TYPO3 backend ships a legacy AMD `define`, which would make the UMD register as an
   * anonymous AMD module instead of a global — so we neutralise `define` during load.
   */
  ensureMoveable() {
    if (window.Moveable || !this.moveableUrl) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const prevDefine = window.define;
      const restore = () => {
        if (prevDefine !== undefined) {
          window.define = prevDefine;
        }
      };
      try {
        window.define = undefined;
      } catch (e) {
        /* ignore */
      }
      const s = document.createElement("script");
      s.setAttribute("data-herobuilder-moveable", "1");
      s.onload = () => { restore(); resolve(); };
      s.onerror = () => { restore(); resolve(); };
      s.src = this.moveableUrl;
      document.head.appendChild(s);
    });
  }

  bindToolbar() {
    this.root.querySelectorAll(".t3js-herobuilder-bp").forEach((btn) => {
      btn.addEventListener("click", () => this.setBreakpoint(btn.dataset.breakpoint));
    });
    this.root.querySelector(".t3js-herobuilder-undo")?.addEventListener("click", () => this.undo());
    this.root.querySelector(".t3js-herobuilder-redo")?.addEventListener("click", () => this.redo());
    this.root.querySelector(".t3js-herobuilder-add")?.addEventListener("click", () => this.addImage());
    this.root.querySelector(".t3js-herobuilder-add-text")?.addEventListener("click", () => this.addTextLayer());
    this.root.querySelector(".t3js-herobuilder-add-button")?.addEventListener("click", () => this.addButtonLayer());
    const magnetBtn = this.root.querySelector(".t3js-herobuilder-magnet");
    if (magnetBtn) {
      magnetBtn.addEventListener("click", () => this.toggleMagnet());
      this.syncMagnetButton();
    }
    this.root.querySelector(".t3js-herobuilder-copy")?.addEventListener("click", () => this.copyToAll());
    this.root.querySelector(".t3js-herobuilder-templates")?.addEventListener("click", () => this.openTemplates());
    this.root.querySelector(".t3js-herobuilder-save-template")?.addEventListener("click", () => this.saveTemplate());
    this.root.querySelector(".t3js-herobuilder-export")?.addEventListener("click", () => this.openExport());
    this.root.querySelector(".t3js-herobuilder-preview")?.addEventListener("click", () => this.togglePreview());
    // The TYPO3 Link Browser writes the selected link into the proxy input (change event).
    if (this.linkProxy) {
      this.linkProxy.addEventListener("change", () => this.setLink(this.linkProxy.value));
    }
    this.stageEl.addEventListener("click", (e) => {
      this.stageEl.focus({ preventScroll: true });
      if (e.target === this.stageEl) {
        this.deselect();
      }
    });
    this.stageEl.addEventListener("contextmenu", (e) => this.onContextMenu(e));
  }

  onContextMenu(e) {
    const layerEl = e.target.closest ? e.target.closest(".herobuilder-layer") : null;
    let layer = layerEl ? this.layers.find((l) => l._el === layerEl) : null;
    // Moveable's control box may be the event target — fall back to the current selection.
    if (!layer) {
      layer = this.selected;
    }
    if (!layer) {
      return;
    }
    e.preventDefault();
    this.select(layer);
    this.openContextMenu(e.clientX, e.clientY);
  }

  /** Mirror files added to the sibling `assets` FAL field as new layers. */
  listenForAssetInserts() {
    if (!this.assetsSuffix) {
      return;
    }
    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || d.actionName !== "typo3:foreignRelation:insert" || d.table !== "sys_file") {
        return;
      }
      if (typeof d.objectGroup !== "string" || !d.objectGroup.endsWith(this.assetsSuffix)) {
        return;
      }
      const uid = parseInt(d.uid, 10);
      if (uid) {
        this.addLayerForFile(uid);
      }
    });
  }

  async loadFileInfo() {
    const uids = [...new Set(this.layers.map((l) => parseInt(l.fileUid, 10)).filter(Boolean))];
    if (uids.length) {
      await this.fetchFileInfo(uids);
    }
  }

  async fetchFileInfo(uids) {
    const url = window.TYPO3?.settings?.ajaxUrls?.herobuilder_fileinfo;
    if (!url) {
      return;
    }
    try {
      const response = await new AjaxRequest(url).withQueryArguments({ uids: uids.join(",") }).get();
      const data = await response.resolve();
      Object.assign(this.fileInfo, data.files || {});
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Switch to another breakpoint. Instead of swapping a tab pane, the stage box and every layer
   * *travel* to the geometry stored for that breakpoint: the transitions make the difference
   * between the breakpoints readable (what moves, what grows, what disappears).
   */
  setBreakpoint(bp) {
    if (!this.breakpoints.includes(bp) || bp === this.activeBp) {
      return;
    }
    // An untouched zoom re-bases to the new breakpoint (so xs shows its 390px device width
    // again after lg was scaled up to reach the height floor); a zoom the editor set by hand
    // is kept, only lifted if the new breakpoint's floor demands it.
    const atBase = Math.abs(this.zoom - this.baseZoomValue()) < 0.01;
    this.activeBp = bp;
    this.zoom = atBase ? this.baseZoomValue() : Math.max(this.zoom, this.minZoomValue());
    this.deselect();
    this.highlightActiveBp();
    this.updatePreviewWidth();
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.render();
      return;
    }
    this.morphToBreakpoint();
  }

  /**
   * Animate the current DOM towards the active breakpoint, then hand back to render().
   *
   * Layers already on the stage keep their element and only get new inline geometry, so the CSS
   * transition interpolates the move/resize. Layers that only exist in one of the two
   * breakpoints fade in/out. The reconciling render() afterwards rebuilds the stage the normal
   * way (crop boxes depend on the stage's px size) — at that point nothing moves any more.
   */
  morphToBreakpoint() {
    window.clearTimeout(this._bpTimer);
    this.root.classList.add("hb-bp-anim");
    this.applyStageSize();

    this.layers.forEach((layer) => {
      const p = this.placementFor(layer);
      const visible = !!p && p.visible !== false;
      const el = layer._el && layer._el.isConnected ? layer._el : null;
      if (el) {
        if (visible) {
          this.applyGeomToEl(el, p);
          el.style.opacity = "1";
        } else {
          el.style.opacity = "0";
        }
      } else if (visible) {
        // Only placed in the new breakpoint — mount it at its target box and fade it in.
        const fresh = this.createLayerEl(layer, p);
        fresh.style.opacity = "0";
        this.stageEl.appendChild(fresh);
        layer._el = fresh;
        window.requestAnimationFrame(() => {
          fresh.style.opacity = "1";
        });
      }
    });

    this._bpTimer = window.setTimeout(() => {
      this.root.classList.remove("hb-bp-anim");
      this.render();
    }, BP_ANIM_MS + 40);
  }

  highlightActiveBp() {
    this.root.querySelectorAll(".t3js-herobuilder-bp").forEach((b) => {
      const active = b.dataset.breakpoint === this.activeBp;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  stageRatioCss(bp) {
    return (this.stages[bp] && this.stages[bp].ratioCss) || "16 / 9";
  }

  stageWidth(bp) {
    return (this.stages[bp] && parseInt(this.stages[bp].width, 10)) || 0;
  }

  t(key, fallback) {
    return (this.labels && this.labels[key]) || fallback;
  }

  // ---- Zoom & pan --------------------------------------------------------

  /**
   * Zoom picker above the top-right corner of the stage. Ctrl+wheel and Ctrl +/-/0 keep working
   * and are mirrored back into the select by applyStageSize().
   */
  buildZoomControl() {
    this.zoomSelect = this.root.querySelector(".t3js-herobuilder-zoom");
    if (!this.zoomSelect) {
      return;
    }
    this.zoomSelect.title = this.t("zoom.label", "Zoom");
    this.zoomSelect.addEventListener("change", () => {
      const value = this.zoomSelect.value;
      if (value === "fit") {
        this.fitZoom();
      } else {
        this.setZoom(parseFloat(value));
      }
    });
    this.updateZoomControl();
  }

  /**
   * Keep the picker in sync. The step ladder is the same for every breakpoint: 100% means the
   * stage at its true device width, and the steps below it are what a stage too wide for the
   * canvas column is viewed at. Only the selection changes per breakpoint.
   */
  updateZoomControl() {
    const select = this.zoomSelect;
    if (!select) {
      return;
    }
    const pct = (z) => Math.round(z * 100) + "%";
    const signature = "steps";
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.textContent = "";
      const add = (value, label) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
        return option;
      };
      add("fit", this.t("zoom.fit", "Fit to width"));
      // The full ladder, unfiltered. A breakpoint's opening zoom is no longer offered as a named
      // entry: when it is not a round step (a flat ratio opens scaled up to clear the height
      // floor) the current-zoom entry below already shows it.
      ZOOM_STEPS.forEach((step) => add(step.toFixed(4), pct(step)));
    }

    // Zoom values reached by wheel/keyboard rarely hit a step — carry them in one extra entry.
    // The extra entry must be excluded from the lookup: it carries the current zoom as its value,
    // so it would match itself, get removed as redundant, and leave select.value pointing at an
    // option that no longer exists (empty picker).
    const match = [...select.options].find(
      (option) => option.value !== "fit"
        && !option.dataset.custom
        && Math.abs(parseFloat(option.value) - this.zoom) < 0.005
    );
    let custom = select.querySelector("option[data-custom]");
    if (match) {
      if (custom) {
        custom.remove();
      }
      select.value = match.value;
      return;
    }
    if (!custom) {
      custom = document.createElement("option");
      custom.dataset.custom = "1";
      select.insertBefore(custom, select.options[1] || null);
    }
    custom.value = this.zoom.toFixed(4);
    custom.textContent = pct(this.zoom);
    select.value = custom.value;
  }

  scaledStageWidth() {
    const w = this.stageWidth(this.activeBp);
    return w ? w * this.zoom : 0;
  }

  /**
   * Smallest zoom the active breakpoint may be shown at: the factor that lifts its natural
   * height (width ÷ ratio) to minStageHeight. Above 1 for flat ratios (the stage then opens
   * scaled up and is panned horizontally), below 1 for the tall phone stages.
   */
  minZoomValue() {
    const w = this.stageWidth(this.activeBp);
    const ratio = this.stageRatio(this.activeBp);
    if (!this.minStageHeight || !w || ratio <= 0) {
      return 0.1;
    }
    return Math.max(0.1, this.minStageHeight / (w / ratio));
  }

  /** The zoom a breakpoint opens at: 100%, or the floor when the stage would be flatter. */
  baseZoomValue() {
    return Math.max(1, this.minZoomValue());
  }

  applyStageSize() {
    const w = this.scaledStageWidth();
    const ratio = this.stageRatio(this.activeBp);
    this.stageEl.style.width = w ? w + "px" : "100%";
    // An explicit height (rather than aspect-ratio) is what makes the stage box animate when
    // switching breakpoints; without a configured width there is nothing to derive it from, so
    // fall back to the ratio and let the fluid box keep its shape.
    if (w && ratio > 0) {
      this.stageEl.style.aspectRatio = "auto";
      this.stageEl.style.height = Math.round(w / ratio) + "px";
      // The stylesheet's min-height is a floor for the fluid fallback below; here it would fight
      // the height we just derived and stretch the preview. A flat ratio at a small zoom lands
      // under it — 50% of a 2500:480 stage is 95px — and every layer would sit 26% too low.
      this.stageEl.style.minHeight = "0px";
    } else {
      this.stageEl.style.height = "";
      this.stageEl.style.minHeight = "";
      this.stageEl.style.aspectRatio = this.stageRatioCss(this.activeBp);
    }
    this.sizeCanvasFrame();
    this.updateZoomControl();
  }

  setZoom(z) {
    this.zoom = Math.min(6, Math.max(MIN_ZOOM, z));
    this.applyStageSize();
    if (this.moveable) {
      this.moveable.updateRect();
    }
  }

  zoomBy(factor) {
    this.setZoom(this.zoom * factor);
  }

  fitZoomValue() {
    const wrap = this.root.querySelector(".herobuilder-stage-wrap");
    const w = this.stageWidth(this.activeBp);
    if (!wrap || !w) {
      return 1;
    }
    // clientWidth includes the scroll box's padding — subtract it (plus the stage border), or
    // fitting would still leave a horizontal scrollbar.
    const cs = window.getComputedStyle(wrap);
    const inner = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
    return Math.max(0.1, inner / w);
  }

  fitZoom() {
    this.setZoom(this.fitZoomValue());
  }

  bindStageNav() {
    const wrap = this.root.querySelector(".herobuilder-stage-wrap");
    if (!wrap) {
      return;
    }
    // Ctrl/⌘ + wheel = zoom anchored at the cursor; plain wheel scrolls (pans).
    wrap.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) {
          return;
        }
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const px = e.clientX - rect.left + wrap.scrollLeft;
        const py = e.clientY - rect.top + wrap.scrollTop;
        const old = this.zoom;
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        const ratio = this.zoom / old;
        wrap.scrollLeft = px * ratio - (e.clientX - rect.left);
        wrap.scrollTop = py * ratio - (e.clientY - rect.top);
      },
      { passive: false }
    );

    // Pan with middle mouse button or Space + left drag.
    wrap.addEventListener("pointerdown", (e) => {
      const panBtn = e.button === 1 || (e.button === 0 && this._spaceDown);
      if (!panBtn) {
        return;
      }
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add("hb-panning");
      const startX = e.clientX;
      const startY = e.clientY;
      const startL = wrap.scrollLeft;
      const startT = wrap.scrollTop;
      const move = (ev) => {
        wrap.scrollLeft = startL - (ev.clientX - startX);
        wrap.scrollTop = startT - (ev.clientY - startY);
      };
      const up = (ev) => {
        wrap.releasePointerCapture(e.pointerId);
        wrap.classList.remove("hb-panning");
        wrap.removeEventListener("pointermove", move);
        wrap.removeEventListener("pointerup", up);
      };
      wrap.addEventListener("pointermove", move);
      wrap.addEventListener("pointerup", up);
    });
  }

  // ---- Context menu (align / fill / z-order) -----------------------------

  ensurePlacement(layer) {
    if (!layer.placements[this.activeBp]) {
      // Clone from the primary (lg, else first defined) placement so a new breakpoint override
      // starts from the inherited layout the editor is already showing — framing included, or
      // merely moving a layer would drop the crop the frontend inherited from the primary.
      const primaryBp = layer.placements.lg ? "lg" : Object.keys(layer.placements)[0];
      const src = primaryBp ? layer.placements[primaryBp] : null;
      const placement = src
        ? geometryOf(src)
        : { x: 20, y: 20, w: 40, h: 25, rot: 0, z: 1, visible: true };
      if (src && src.image) {
        placement.image = { ...src.image, crop: src.image.crop ? { ...src.image.crop } : null };
      }
      layer.placements[this.activeBp] = placement;
    }
    return layer.placements[this.activeBp];
  }

  withSelectedPlacement(fn) {
    if (!this.selected) {
      return;
    }
    const p = this.ensurePlacement(this.selected);
    fn(p, this.selected);
    this.patchCanvasGeometry(this.selected, p);
    this.save();
    this.render();
    this.select(this.selected);
  }

  align(mode) {
    this.withSelectedPlacement((p, layer) => {
      const w = p.w ?? 0;
      // Auto height: use the rendered height (in % of the stage), without storing it.
      const h = isAutoHeight(layer, p) && layer._el
        ? (layer._el.offsetHeight / (this.stageEl.clientHeight || 1)) * 100
        : p.h ?? 0;
      if (mode === "left") p.x = 0;
      else if (mode === "centerH") p.x = round((100 - w) / 2);
      else if (mode === "right") p.x = round(100 - w);
      else if (mode === "top") p.y = 0;
      else if (mode === "middle") p.y = round((100 - h) / 2);
      else if (mode === "bottom") p.y = round(100 - h);
    });
  }

  fillStage() {
    this.withSelectedPlacement((p, layer) => {
      p.x = 0;
      p.y = 0;
      p.w = 100;
      p.h = 100;
      // Backgrounds should cover the stage without distortion.
      if (layer.type !== "text") {
        layer.fit = "cover";
      }
    });
  }

  moveZ(dir) {
    const zs = this.layers.map((l) => (this.placementFor(l) || {}).z || 0);
    const target = dir === "front" ? Math.max(...zs, 0) + 1 : Math.min(...zs, 1) - 1;
    this.withSelectedPlacement((p) => {
      p.z = target;
    });
  }

  openContextMenu(x, y) {
    this.closeContextMenu();
    const isText = this.selected && this.selected.type === "text";
    const menu = document.createElement("div");
    menu.className = "herobuilder-ctxmenu";
    const item = (act, label) => '<button type="button" class="hb-ctx-item" data-act="' + act + '">' + escapeHtml(label) + "</button>";
    menu.innerHTML =
      '<div class="hb-ctx-label">' + escapeHtml(this.t("ctx.align", "Align")) + "</div>" +
      item("left", this.t("ctx.alignLeft", "Left")) +
      item("centerH", this.t("ctx.alignCenterH", "Center horizontally")) +
      item("right", this.t("ctx.alignRight", "Right")) +
      item("top", this.t("ctx.alignTop", "Top")) +
      item("middle", this.t("ctx.alignMiddle", "Center vertically")) +
      item("bottom", this.t("ctx.alignBottom", "Bottom")) +
      '<div class="hb-ctx-sep"></div>' +
      item("fill", isText ? this.t("ctx.fillStagePlain", "Fill stage") : this.t("ctx.fillStage", "Fill stage (cover)")) +
      item("copyAll", this.t("ctx.copyToAll", "Copy position to all breakpoints")) +
      '<div class="hb-ctx-sep"></div>' +
      item("front", this.t("ctx.toFront", "Bring to front")) +
      item("back", this.t("ctx.toBack", "Send to back")) +
      '<div class="hb-ctx-sep"></div>' +
      item("delete", this.t("panel.deleteLayer", "Delete layer"));
    document.body.appendChild(menu);
    this.ctxMenu = menu;

    // Keep the menu within the viewport.
    const rect = menu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    menu.style.left = Math.min(x, vw - rect.width - 4) + "px";
    menu.style.top = Math.min(y, vh - rect.height - 4) + "px";

    menu.addEventListener("click", (e) => {
      const btn = e.target.closest(".hb-ctx-item");
      if (!btn) {
        return;
      }
      this.runContextAction(btn.dataset.act);
      this.closeContextMenu();
    });
    this._ctxClose = (ev) => {
      if (!menu.contains(ev.target)) {
        this.closeContextMenu();
      }
    };
    this._ctxKey = (ev) => {
      if (ev.key === "Escape") {
        this.closeContextMenu();
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", this._ctxClose, true);
      document.addEventListener("keydown", this._ctxKey, true);
      window.addEventListener("scroll", this._ctxClose, true);
    }, 0);
  }

  closeContextMenu() {
    if (this._ctxClose) {
      document.removeEventListener("mousedown", this._ctxClose, true);
      window.removeEventListener("scroll", this._ctxClose, true);
      this._ctxClose = null;
    }
    if (this._ctxKey) {
      document.removeEventListener("keydown", this._ctxKey, true);
      this._ctxKey = null;
    }
    if (this.ctxMenu) {
      this.ctxMenu.remove();
      this.ctxMenu = null;
    }
  }

  runContextAction(act) {
    if (["left", "centerH", "right", "top", "middle", "bottom"].includes(act)) {
      this.align(act);
    } else if (act === "fill") {
      this.fillStage();
    } else if (act === "copyAll") {
      this.copyToAll();
    } else if (act === "front" || act === "back") {
      this.moveZ(act);
    } else if (act === "delete") {
      this.deleteSelected();
    }
  }

  placementFor(layer) {
    layer.placements = layer.placements || {};
    if (layer.placements[this.activeBp]) {
      return layer.placements[this.activeBp];
    }
    // Mirror the frontend cascade: a breakpoint without its own placement inherits the primary
    // (lg, else the first defined) one for display, so switching tabs is WYSIWYG. Returned
    // read-only — writers go through ensurePlacement(), which clones before editing.
    const primaryBp = layer.placements.lg ? "lg" : Object.keys(layer.placements)[0];
    return primaryBp ? layer.placements[primaryBp] : null;
  }

  render() {
    this.highlightActiveBp();
    this.ensureCanvasFrame();
    // Render the stage at the breakpoint's real device width × zoom. Because layers are
    // %-based, zooming just resizes the stage box — geometry (offset/clientWidth → %) and
    // Moveable stay correct without any CSS transform.
    this.applyStageSize();
    this.stageEl.querySelectorAll(".herobuilder-layer").forEach((el) => el.remove());

    // Drop cached <img> nodes of layers that are gone (deleted, template applied, undo).
    if (this._imgCache.size > this.layers.length) {
      const alive = new Set(this.layers.map((l) => l.id));
      this._imgCache.forEach((img, id) => {
        if (!alive.has(id)) {
          this._imgCache.delete(id);
        }
      });
    }

    const ordered = [...this.layers].sort((a, b) => {
      const za = (this.placementFor(a) || {}).z || 0;
      const zb = (this.placementFor(b) || {}).z || 0;
      return za - zb;
    });

    ordered.forEach((layer) => {
      const p = this.placementFor(layer);
      if (!p || p.visible === false) {
        return;
      }
      const el = this.createLayerEl(layer, p);
      this.stageEl.appendChild(el);
      layer._el = el;
    });

    this.syncHandlesToCanvas();
    this.updatePanel();
  }

  createLayerEl(layer, p) {
    const isText = layer.type === "text" || layer.type === "button";
    const info = isText ? null : this.fileInfo[layer.fileUid];
    // Image layers use a wrapper div (the Moveable/geometry target) with an inner <img>, so
    // flip (scale) and crop (overflow + offset) can be applied to the image without inverting
    // Moveable's handles or the layer box. Text/button/placeholder layers are the div itself.
    const el = document.createElement("div");
    el.className = "herobuilder-layer";
    el.style.position = "absolute";
    el.style.left = (p.x ?? 30) + "%";
    el.style.top = (p.y ?? 30) + "%";
    el.style.width = (p.w ?? 40) + "%";
    if (p.h) {
      el.style.height = p.h + "%";
    }
    el.style.transform = "rotate(" + (p.rot || 0) + "deg)";
    el.style.zIndex = String(p.z || 1);
    el.style.cursor = layer.locked ? "default" : "move";
    // A locked layer must not intercept pointer events — the click falls through to the
    // layer beneath it (Figma/Photoshop behaviour). It stays selectable via the layer list.
    el.style.pointerEvents = layer.locked ? "none" : "auto";
    if (info && info.url) {
      // Reuse the already decoded <img> of this layer (moved into the new box by appendChild)
      // so a re-render is flicker-free; all its styles are re-applied from scratch below.
      let img = this._imgCache.get(layer.id);
      if (!img || img.getAttribute("src") !== info.url) {
        img = document.createElement("img");
        img.className = "hb-layer-img-inner";
        img.src = info.url;
        img.draggable = false;
        this._imgCache.set(layer.id, img);
      }
      img.style.cssText = "";
      img.alt = layer.alt || info.alt || "";
      img.style.display = "block";
      // Flip is a pure CSS transform on the image (no reprocessing).
      const sx = layer.flipH ? -1 : 1;
      const sy = layer.flipV ? -1 : 1;
      img.style.transform = sx !== 1 || sy !== 1 ? "scale(" + sx + "," + sy + ")" : "";
      const crop = this.effCrop(layer);
      if (crop) {
        // Show only the crop region. The image is enlarged + offset so the region maps 1:1 to
        // its container, which is sized to the cropped aspect ratio and fitted into the layer
        // box per object-fit — so the preview matches the frontend and is never distorted.
        const iw = info.width || 1;
        const ih = info.height || 1;
        const cropAspect = (crop.width * iw) / (crop.height * ih);
        img.style.position = "absolute";
        img.style.width = 100 / crop.width + "%";
        img.style.height = 100 / crop.height + "%";
        img.style.left = -(crop.x / crop.width) * 100 + "%";
        img.style.top = -(crop.y / crop.height) * 100 + "%";
        el.style.overflow = "hidden";

        const stageW = this.stageEl.clientWidth || 0;
        const stageH = this.stageEl.clientHeight || 0;
        const boxW = (p.w ?? 40) / 100 * stageW;
        const boxH = p.h ? p.h / 100 * stageH : 0;
        if (!p.h || boxW <= 0 || boxH <= 0) {
          // No fixed height: the box follows the cropped aspect ratio, so the region fills it.
          el.style.aspectRatio = crop.width * iw + " / " + crop.height * ih;
          el.appendChild(img);
        } else {
          // Fixed box: fit the cropped region into it honouring the layer's object-fit.
          // Placed by the focus point like the frontend's object-position — not centred.
          const focus = this.effFocus(layer);
          const fitted = fitRegion(boxW, boxH, cropAspect, layer.fit || "fill", focus.x, focus.y);
          const cv = document.createElement("div");
          cv.style.position = "absolute";
          cv.style.overflow = "hidden";
          cv.style.left = fitted.left + "px";
          cv.style.top = fitted.top + "px";
          cv.style.width = fitted.w + "px";
          cv.style.height = fitted.h + "px";
          cv.appendChild(img);
          el.appendChild(cv);
        }
      } else {
        img.style.width = "100%";
        img.style.objectFit = layer.fit || "fill";
        const focus = this.effFocus(layer);
        img.style.objectPosition = focus.x + "% " + focus.y + "%";
        // With an explicit height the image fills the box (object-fit governs); without one the
        // box follows the image's natural aspect ratio (height auto).
        img.style.height = p.h ? "100%" : "auto";
        el.appendChild(img);
      }
      el._img = img;
    } else if (isText) {
      // Text layer: show the text; apply the chosen classes so backend Bootstrap gives a
      // close-to-frontend preview (unknown/FE-only classes are simply inert here).
      el.textContent = layer.text || (layer.type === "button" ? "Button" : "Text");
      const typeClass = layer.type === "button" ? "herobuilder-layer-button" : "herobuilder-layer-text";
      el.className = "herobuilder-layer " + typeClass + (layer.cssClass ? " " + layer.cssClass : "");
      // No height = the box follows the text (frontend omits it too); only a fixed height clips.
      el.style.height = p.h ? p.h + "%" : "auto";
      el.style.boxSizing = "border-box";
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.justifyContent = "center";
      el.style.overflow = p.h ? "hidden" : "visible";
      el.style.textAlign = "center";
      const overlay = layer.overlay || 0;
      if (overlay > 0) {
        el.style.backgroundColor = "rgba(0,0,0," + overlay / 100 + ")";
        el.style.padding = ".35em .6em";
      }
    } else {
      el.textContent = "#" + layer.fileUid;
      el.style.height = (p.h ?? 20) + "%";
      el.style.background = "rgba(47,128,237,.35)";
      el.style.border = "1px dashed #2f80ed";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.color = "#fff";
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.stageEl.focus({ preventScroll: true });
      this.select(layer);
    });
    if (this.selected === layer) {
      el.style.outline = "1px solid #2f80ed";
    }
    return el;
  }

  select(layer) {
    this.selected = layer;
    this.updatePanel();
    if (!window.Moveable || !layer._el || layer.locked) {
      if (this.moveable) {
        this.moveable.destroy();
        this.moveable = null;
      }
      return;
    }
    if (this.moveable) {
      this.moveable.destroy();
    }
    const sw = this.stageEl.clientWidth || 1;
    const sh = this.stageEl.clientHeight || 1;
    // An auto-height text/button only gets width handles: its height follows the text.
    const autoHeight = isAutoHeight(layer, this.placementFor(layer));
    this.moveable = new window.Moveable(this.stageEl, {
      target: layer._el,
      draggable: true,
      resizable: true,
      rotatable: true,
      keepRatio: !autoHeight,
      renderDirections: autoHeight ? ["w", "e"] : ["nw", "n", "ne", "w", "e", "sw", "s", "se"],
      origin: false,
      // Snapping to stage edges/center and to other layers, with visible guide lines.
      snappable: this.snapActive(),
      snapThreshold: SNAP_THRESHOLD,
      snapHorizontalThreshold: SNAP_THRESHOLD,
      snapVerticalThreshold: SNAP_THRESHOLD,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      snapGap: true,
      elementGuidelines: this.layers.filter((l) => l !== layer && l._el).map((l) => l._el),
      verticalGuidelines: [0, sw / 2, sw],
      horizontalGuidelines: [0, sh / 2, sh],
    });
    this.moveable
      .on("drag", ({ target, left, top }) => {
        target.style.left = left + "px";
        target.style.top = top + "px";
        this.patchCanvasGeometry(layer, this.handleGeometry(target));
      })
      .on("resize", ({ target, width, height, drag }) => {
        target.style.width = width + "px";
        target.style.height = height + "px";
        target.style.left = drag.left + "px";
        target.style.top = drag.top + "px";
        const g = this.handleGeometry(target);
        g.h = autoHeight ? 0 : (target.offsetHeight / (this.stageEl.clientHeight || 1)) * 100;
        this.patchCanvasGeometry(layer, g);
      })
      .on("rotate", ({ target, transform }) => {
        target.style.transform = transform;
        this.patchCanvasGeometry(layer, this.handleGeometry(target));
      })
      .on("renderEnd", () => this.commitGeometry(layer));
  }

  // ---- Snapping ("magnet") -----------------------------------------------

  loadMagnet() {
    try {
      // Default on: snapping was unconditional before the toggle existed, so an editor who
      // never touches the button keeps the behaviour they know.
      return localStorage.getItem("herobuilder:magnet") !== "0";
    } catch (e) {
      return true;
    }
  }

  /** Snapping in effect right now: the editor's preference, unless Alt is held. */
  snapActive() {
    return this.magnet && !this._altSnapOff;
  }

  /**
   * Suspend/resume snapping while Alt is held. Moveable's vanilla wrapper exposes every prop as
   * a setter that goes through setState, so `snappable` can be flipped mid-drag and the next
   * mouse move is already unsnapped — no need to rebuild the controller.
   */
  setAltSuspend(on) {
    if (this._altSnapOff === on) {
      return;
    }
    this._altSnapOff = on;
    if (this.moveable) {
      this.moveable.snappable = this.snapActive();
    }
    this.syncMagnetButton();
  }

  toggleMagnet() {
    this.magnet = !this.magnet;
    try {
      localStorage.setItem("herobuilder:magnet", this.magnet ? "1" : "0");
    } catch (e) {
      // Private mode / storage disabled: the toggle still works for this session.
    }
    this.syncMagnetButton();
    // Moveable takes snappable at construction time, so rebuild the controller for the
    // current selection instead of poking at its options.
    if (this.selected) {
      this.select(this.selected);
    }
  }

  syncMagnetButton() {
    const btn = this.root.querySelector(".t3js-herobuilder-magnet");
    if (!btn) {
      return;
    }
    // `active` shows the stored preference, the suspended class the momentary Alt override —
    // conflating them would read as if Alt had flipped the setting.
    btn.classList.toggle("active", this.magnet);
    btn.classList.toggle("hb-magnet-suspended", this.magnet && this._altSnapOff);
    btn.setAttribute("aria-pressed", this.snapActive() ? "true" : "false");
    btn.setAttribute(
      "title",
      (this._altSnapOff && this.magnet
        ? this.t("magnet.suspended", "Snapping paused (Alt)")
        : this.t(this.magnet ? "magnet.on" : "magnet.off", this.magnet ? "Snapping on" : "Snapping off"))
        + " — " + this.t("magnet.hint", "Snap layers to stage edges, centre and other layers while dragging")
        + " · " + this.t("magnet.altHint", "hold Alt to place freely")
    );
  }

  /**
   * Put a snapped layer exactly on the edge it snapped to.
   *
   * Moveable snaps in screen px, but geometry is stored as percentages rounded to two decimals,
   * so a layer dropped flush against the left edge persists as e.g. x=0.03% — visually a hair
   * off, and it drifts further every time the stage is rendered at another zoom. Anything that
   * lands within two px of an edge or the centre can only have got there by snapping, so it is
   * quantized onto the exact value.
   */
  snapEdges(p, sw, sh, h = p.h) {
    if (!this.snapActive()) {
      return;
    }
    const near = (a, b, px, size) => Math.abs(a - b) < (px / Math.max(size, 1)) * 100;
    if (near(p.x, 0, 2, sw)) {
      p.x = 0;
    } else if (near(p.x + p.w, 100, 2, sw)) {
      p.x = round(100 - p.w);
    } else if (near(p.x + p.w / 2, 50, 2, sw)) {
      p.x = round(50 - p.w / 2);
    }
    if (near(p.y, 0, 2, sh)) {
      p.y = 0;
    } else if (h && near(p.y + h, 100, 2, sh)) {
      p.y = round(100 - h);
    } else if (h && near(p.y + h / 2, 50, 2, sh)) {
      p.y = round(50 - h / 2);
    }
  }

  deselect() {
    this.selected = null;
    if (this.moveable) {
      this.moveable.destroy();
      this.moveable = null;
    }
    this.updatePanel();
  }

  commitGeometry(layer) {
    const el = layer._el;
    const sw = this.stageEl.clientWidth || 1;
    const sh = this.stageEl.clientHeight || 1;
    const p = this.ensurePlacement(layer);
    // Moving, rotating or widening must not turn "height follows the text" into a fixed height
    // measured with the editor's fonts.
    const autoHeight = isAutoHeight(layer, p);
    p.x = round((el.offsetLeft / sw) * 100);
    p.y = round((el.offsetTop / sh) * 100);
    p.w = round((el.offsetWidth / sw) * 100);
    if (autoHeight) {
      el.style.height = "auto";
    } else {
      p.h = round((el.offsetHeight / sh) * 100);
    }
    p.rot = round(this.readRotation(el));
    this.snapEdges(p, sw, sh, autoHeight ? (el.offsetHeight / sh) * 100 : p.h);
    p.z = p.z || 1;
    p.visible = p.visible !== false;
    layer.placements[this.activeBp] = p;
    el.style.left = p.x + "%";
    el.style.top = p.y + "%";
    el.style.width = p.w + "%";
    el.style.height = autoHeight ? "auto" : p.h + "%";
    this.patchCanvasGeometry(layer, p);
    this.syncHandlesToCanvas(layer);
    if (this.moveable) {
      this.moveable.updateRect();
    }
    this.updateGeomFields(p);
    this.save();
    // A cropped layer's preview fits the crop region into the box (object-fit), which depends
    // on the box aspect — re-render so it updates after a resize.
    if (this.effCrop(layer) && p.h) {
      this.render();
      this.select(layer);
    }
  }

  readRotation(el) {
    const m = (el.style.transform || "").match(/rotate\(([-0-9.]+)deg\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  addImage() {
    if (this.assetsSuffix) {
      const grp = document.querySelector('[data-object-group$="' + this.assetsSuffix + '"]');
      const btn = grp ? grp.querySelector(".t3js-element-browser, .t3js-create-new-button") : null;
      if (btn) {
        btn.click();
        return;
      }
    }
    this.addImageByUid();
  }

  async addImageByUid() {
    const uid = parseInt(window.prompt(this.t("prompt.fileUid", "sys_file uid:")), 10);
    if (uid) {
      this.addLayerForFile(uid);
    }
  }

  async addLayerForFile(uid) {
    await this.fetchFileInfo([uid]);
    const maxZ = this.layers.reduce((m, l) => Math.max(m, (this.placementFor(l) || {}).z || 0), 0);
    const layer = {
      id: "l" + this.layers.length + "_" + uid,
      type: "image",
      fileUid: uid,
      alt: "",
      link: "",
      anim: {},
      placements: {},
    };
    layer.placements[this.activeBp] = { x: 30, y: 30, w: 40, h: 25, rot: 0, z: maxZ + 1, visible: true };
    this.layers.push(layer);
    this.render();
    this.select(layer);
    this.save();
  }

  addTextLayer() {
    const maxZ = this.layers.reduce((m, l) => Math.max(m, (this.placementFor(l) || {}).z || 0), 0);
    const layer = {
      id: "t" + this.layers.length + "_" + Date.now(),
      type: "text",
      text: "Text",
      cssClass: "",
      link: "",
      anim: {},
      placements: {},
    };
    layer.placements[this.activeBp] = { x: 20, y: 40, w: 60, h: 0, rot: 0, z: maxZ + 1, visible: true };
    this.layers.push(layer);
    this.render();
    this.select(layer);
    this.save();
  }

  addButtonLayer() {
    const maxZ = this.layers.reduce((m, l) => Math.max(m, (this.placementFor(l) || {}).z || 0), 0);
    const layer = {
      id: "b" + this.layers.length + "_" + Date.now(),
      type: "button",
      text: "Button",
      cssClass: "btn btn-primary",
      link: "",
      anim: {},
      placements: {},
    };
    layer.placements[this.activeBp] = { x: 20, y: 55, w: 20, h: 0, rot: 0, z: maxZ + 1, visible: true };
    this.layers.push(layer);
    this.render();
    this.select(layer);
    this.save();
  }

  copyToAll() {
    const targets = this.selected ? [this.selected] : this.layers;
    targets.forEach((layer) => {
      const src = this.placementFor(layer);
      if (src) {
        this.breakpoints.forEach((bp) => {
          if (bp !== this.activeBp) {
            // Position only: a breakpoint keeps its own image framing (crop/focus).
            const own = layer.placements[bp] && layer.placements[bp].image;
            layer.placements[bp] = geometryOf(src);
            if (own) {
              layer.placements[bp].image = own;
            }
          }
        });
      }
    });
    this.save();
  }

  // ---- Layer list (find/select existing elements) ------------------------

  buildLayerList() {
    // Mount point is provided by the PHP skeleton (left sidebar).
    const list = this.root.querySelector(".herobuilder-layerlist");
    this.layerList = list;

    list.addEventListener("click", (e) => {
      const item = e.target.closest(".hb-ll-item");
      if (!item) {
        return;
      }
      const layer = this.layers.find((l) => l.id === item.dataset.id);
      if (!layer) {
        return;
      }
      const actEl = e.target.closest("[data-act]");
      const act = actEl ? actEl.dataset.act : "select";
      if (act === "vis") {
        this.toggleVisibility(layer);
      } else if (act === "lock") {
        this.toggleLock(layer);
      } else if (act === "delete") {
        this.selected = layer;
        this.deleteSelected();
      } else {
        this.select(layer);
        if (layer._el) {
          layer._el.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
    });

    // Right-click a row → select it and open the context menu (align, duplicate, …).
    list.addEventListener("contextmenu", (e) => {
      const item = e.target.closest(".hb-ll-item");
      if (!item) {
        return;
      }
      const layer = this.layers.find((l) => l.id === item.dataset.id);
      if (layer) {
        e.preventDefault();
        this.select(layer);
        this.openContextMenu(e.clientX, e.clientY);
      }
    });

    // Drag to reorder the z-stack.
    list.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".hb-ll-item");
      if (item) {
        this._dragId = item.dataset.id;
        e.dataTransfer.effectAllowed = "move";
      }
    });
    list.addEventListener("dragover", (e) => {
      if (this._dragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    });
    list.addEventListener("drop", (e) => {
      const item = e.target.closest(".hb-ll-item");
      if (item && this._dragId) {
        e.preventDefault();
        this.reorderZ(this._dragId, item.dataset.id);
      }
      this._dragId = null;
    });
  }

  toggleVisibility(layer) {
    const p = this.ensurePlacement(layer);
    p.visible = p.visible === false;
    this.save();
    this.render();
    if (this.selected) {
      this.select(this.selected);
    }
  }

  toggleLock(layer) {
    layer.locked = !layer.locked;
    this.save();
    this.render();
    if (this.selected) {
      this.select(this.selected);
    }
  }

  reorderZ(dragId, targetId) {
    if (dragId === targetId) {
      return;
    }
    const ordered = [...this.layers].sort(
      (a, b) => ((this.placementFor(b) || {}).z || 0) - ((this.placementFor(a) || {}).z || 0)
    );
    const from = ordered.findIndex((l) => l.id === dragId);
    const to = ordered.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0) {
      return;
    }
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    // Top of the list = highest z.
    const n = ordered.length;
    ordered.forEach((l, i) => {
      this.ensurePlacement(l).z = n - i;
    });
    this.save();
    this.render();
    if (this.selected) {
      this.select(this.selected);
    }
  }

  // ---- Live preview (real frontend CSS in an iframe) ---------------------

  buildPreview() {
    const wrap = document.createElement("div");
    wrap.className = "herobuilder-preview";
    wrap.hidden = true;

    const bar = document.createElement("div");
    bar.className = "herobuilder-preview-bar";
    bar.innerHTML =
      '<button type="button" class="btn btn-sm btn-default hb-preview-replay">▶ ' +
      escapeHtml(this.t("preview.replay", "Replay animation")) + "</button>";
    bar.querySelector(".hb-preview-replay").addEventListener("click", () => this.replayPreview());
    wrap.appendChild(bar);

    // The frame is laid out at the full stage size — the frontend's viewport width and stage
    // height — and scaled down into the box, so the preview neither scrolls nor loses width to
    // a scrollbar (which would shift every layer off its frontend position).
    const box = document.createElement("div");
    box.className = "herobuilder-preview-box";
    const frame = document.createElement("iframe");
    frame.className = "herobuilder-preview-frame";
    frame.setAttribute("title", this.t("button.preview", "Live preview"));
    frame.setAttribute("scrolling", "no");
    box.appendChild(frame);
    wrap.appendChild(box);

    // Mount below the stage in the center canvas column.
    (this.root.querySelector(".herobuilder-canvas") || this.layerList).appendChild(wrap);
    this.previewWrap = wrap;
    this.previewBar = bar;
    this.previewBox = box;
    this.previewFrame = frame;
    // Refit when the column changes width or the editor drags the preview taller (resize: vertical).
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.previewOpen && this.updatePreviewWidth()).observe(wrap);
    }
  }

  replayPreview() {
    if (this.previewOpen && this.previewFrame && this.previewFrame.contentWindow) {
      this.previewFrame.contentWindow.postMessage("hb-replay", "*");
    }
  }

  togglePreview() {
    if (!this.previewFrame) {
      return;
    }
    this.previewOpen = !this.previewOpen;
    this.previewWrap.hidden = !this.previewOpen;
    const btn = this.root.querySelector(".t3js-herobuilder-preview");
    if (btn) {
      btn.classList.toggle("active", this.previewOpen);
    }
    if (this.previewOpen) {
      this.updatePreviewWidth();
      this.refreshPreview();
    }
  }

  updatePreviewWidth() {
    if (!this.previewFrame) {
      return;
    }
    const w = this.stageWidth(this.activeBp);
    const ratio = this.stageRatio(this.activeBp);
    if (!w || ratio <= 0) {
      this.previewFrame.style.width = "100%";
      return;
    }
    const h = Math.round(w / ratio);
    // Room for the scaled frame: the column width, and the preview's height — 420px until the
    // editor resizes the panel (then its explicit height, minus the button bar).
    const availW = Math.max(50, this.previewWrap.clientWidth - 2);
    const availH = this.previewWrap.style.height
      ? Math.max(50, this.previewWrap.clientHeight - (this.previewBar ? this.previewBar.offsetHeight : 0) - 2)
      : PREVIEW_MAX_HEIGHT;
    const scale = Math.min(1, availW / w, availH / h);
    const frame = this.previewFrame;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
    this.previewBox.style.width = Math.floor(w * scale) + "px";
    this.previewBox.style.height = Math.floor(h * scale) + "px";
  }

  // ---- Rendered canvas -------------------------------------------------
  //
  // The stage shows the server-rendered slide (same renderer as the frontend and the live
  // preview) in an iframe at the breakpoint's real width, scaled by the zoom. Site CSS, media
  // queries, fonts, crop and focus are therefore exactly the frontend's. The layer elements on
  // top turn into transparent handles once a rendering is in place; until then — or when it
  // fails — they keep drawing the layers themselves.

  ensureCanvasFrame() {
    if (this.canvasFrame || !this.previewUrl || !this.stageEl) {
      return;
    }
    const frame = document.createElement("iframe");
    frame.className = "herobuilder-canvas-frame";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", this.t("button.preview", "Live preview"));
    // Set before inserting: an empty iframe fires "load" as soon as it is in the document.
    this.canvasFrame = frame;
    this._canvasIds = [];
    this._canvasSeq = 0;
    frame.addEventListener("load", () => this.onCanvasFrameLoad());
    this.stageEl.insertBefore(frame, this.stageEl.firstChild);
    this.sizeCanvasFrame();
    this.scheduleCanvasRefresh();
  }

  /** Lay the frame out at the breakpoint's device size and scale it down/up by the zoom. */
  sizeCanvasFrame() {
    if (!this.canvasFrame) {
      return;
    }
    const w = this.stageWidth(this.activeBp);
    const ratio = this.stageRatio(this.activeBp);
    if (!w || ratio <= 0) {
      // Fluid fallback stage without a device width: nothing to lay the frame out at.
      this.root.classList.remove("hb-canvas-live");
      this.canvasFrame.hidden = true;
      return;
    }
    this.canvasFrame.hidden = false;
    const h = Math.round(w / ratio);
    this.canvasFrame.style.width = w + "px";
    this.canvasFrame.style.height = h + "px";
    // Scale to the stage's inner box rather than the nominal zoom: the layers' % geometry refers
    // to that box, and its border takes the same px from width and height — a slightly different
    // factor per axis (< 0.5 %), applied separately so the bottom edge lines up as well.
    this._canvasScale = (this.stageEl.clientWidth || w * this.zoom) / w;
    this._canvasScaleY = (this.stageEl.clientHeight || h * this.zoom) / h;
    this.canvasFrame.style.transform = "scale(" + this._canvasScale + ", " + this._canvasScaleY + ")";
    // A zoom change resizes the stage without a re-render; text boxes scale with it.
    this.syncHandlesToCanvas();
  }

  scheduleCanvasRefresh() {
    if (!this.canvasFrame) {
      return;
    }
    window.clearTimeout(this._canvasTimer);
    // Signal at once: changes without an instant mirror (crop, fit, element …) show up with it.
    this.root.classList.add("hb-canvas-pending");
    this._canvasTimer = window.setTimeout(() => this.refreshCanvas(), 400);
  }

  async refreshCanvas() {
    if (!this.canvasFrame || !this.previewUrl) {
      return;
    }
    const seq = ++this._canvasSeq;
    // Layer index i renders as .<scope>-l<i>; remember the order this rendering was made from,
    // so handles still find their element after layers were added or removed meanwhile.
    const ids = this.layers.map((l) => l.id);
    this.root.classList.add("hb-canvas-pending");
    try {
      const response = await new AjaxRequest(this.previewUrl).post({
        composition: this.input.value || "{}",
        uid: String(this.uid),
        pid: String(this.pid),
        stageMode: this.stageMode,
        canvas: "1",
      });
      const html = await response.raw().text();
      if (seq !== this._canvasSeq) {
        return;
      }
      this._canvasPendingIds = ids;
      this.canvasFrame.srcdoc = html;
    } catch (e) {
      if (seq === this._canvasSeq) {
        // Keep editing possible: the handles draw the layers themselves again.
        this.root.classList.remove("hb-canvas-live", "hb-canvas-pending");
      }
    }
  }

  onCanvasFrameLoad() {
    const doc = this.canvasFrame && this.canvasFrame.contentDocument;
    if (!doc || !this.canvasFrame.srcdoc) {
      return;
    }
    this._canvasIds = this._canvasPendingIds || [];
    const slide = doc.querySelector(".herobuilder-slide");
    this._canvasScope = slide ? [...slide.classList].find((c) => /^hb-\d+$/.test(c)) || "" : "";
    this.root.classList.remove("hb-canvas-pending");
    this.root.classList.toggle("hb-canvas-live", !!this._canvasScope);
    this.syncHandlesToCanvas();
    // Web fonts arrive after load and change text heights once more.
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => this.syncHandlesToCanvas());
    }
  }

  /** The rendered element of a layer in the canvas frame, or null. */
  canvasElFor(layer) {
    const doc = this.canvasFrame && this.canvasFrame.contentDocument;
    const index = this._canvasIds ? this._canvasIds.indexOf(layer.id) : -1;
    if (!doc || index < 0 || !this._canvasScope) {
      return null;
    }
    return doc.querySelector("." + this._canvasScope + "-l" + index);
  }

  /**
   * Give handles without a height of their own the height of the rendered element (text in the
   * site's fonts), so the box around a text is the text's real box.
   */
  syncHandlesToCanvas(only = null) {
    if (!this.root.classList.contains("hb-canvas-live")) {
      return;
    }
    (only ? [only] : this.layers).forEach((layer) => {
      const p = this.placementFor(layer);
      const el = layer._el;
      if (!el || !el.isConnected || !p || p.h) {
        return;
      }
      const rendered = this.canvasElFor(layer);
      if (rendered && rendered.offsetHeight) {
        el.style.height = rendered.offsetHeight * (this._canvasScaleY || this.zoom) + "px";
      }
    });
    if (this.moveable) {
      this.moveable.updateRect();
    }
  }

  /**
   * Mirror a geometry change on the rendered element right away (the server rendering follows
   * ~0.5 s later). Values in % of the stage, as stored in the placement.
   */
  patchCanvasGeometry(layer, g) {
    const rendered = this.canvasElFor(layer);
    if (!rendered) {
      return;
    }
    rendered.style.left = g.x + "%";
    rendered.style.top = g.y + "%";
    rendered.style.width = g.w + "%";
    if (g.h) {
      rendered.style.height = g.h + "%";
    }
    rendered.style.transform = "rotate(" + (g.rot || 0) + "deg)";
  }

  /** Current geometry of a handle element in % of the stage (during a drag/resize/rotate). */
  handleGeometry(el) {
    const sw = this.stageEl.clientWidth || 1;
    const sh = this.stageEl.clientHeight || 1;
    return {
      x: (el.offsetLeft / sw) * 100,
      y: (el.offsetTop / sh) * 100,
      w: (el.offsetWidth / sw) * 100,
      h: el.style.height.endsWith("%") ? parseFloat(el.style.height) : 0,
      rot: this.readRotation(el),
    };
  }

  schedulePreviewRefresh() {
    this.scheduleCanvasRefresh();
    if (!this.previewOpen) {
      return;
    }
    window.clearTimeout(this._previewTimer);
    this._previewTimer = window.setTimeout(() => this.refreshPreview(), 400);
  }

  async refreshPreview() {
    if (!this.previewOpen || !this.previewFrame || !this.previewUrl) {
      return;
    }
    try {
      const response = await new AjaxRequest(this.previewUrl).post({
        composition: this.input.value || "{}",
        uid: String(this.uid),
        pid: String(this.pid),
        stageMode: this.stageMode,
      });
      const html = await response.raw().text();
      this.previewFrame.srcdoc = html;
    } catch (e) {
      // Leave the last successful preview in place on transient errors.
    }
  }

  // ---- Templates ---------------------------------------------------------

  async openTemplates() {
    if (!this.templateListUrl) {
      return;
    }
    let templates = [];
    try {
      const res = await new AjaxRequest(this.templateListUrl).get();
      templates = (await res.resolve()).templates || [];
    } catch (e) {
      Notification.error("Hero Builder", this.t("template.empty", "No templates available"));
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "herobuilder-tpl-gallery";
    // The TYPO3 modal renders in the TOP document, where the field's backend.css is not
    // loaded — ship the gallery styles with the content so the grid/thumbs render correctly.
    const style = document.createElement("style");
    style.textContent = GALLERY_CSS;
    wrap.appendChild(style);
    if (!templates.length) {
      const p = document.createElement("p");
      p.className = "hb-tpl-empty";
      p.textContent = this.t("template.empty", "No templates yet");
      wrap.appendChild(p);
    }

    let modal;
    let selected = null;
    const cards = [];
    const apply = () => {
      if (selected) {
        this.applyTemplate(selected.composition);
        modal.hideModal();
      }
    };
    templates.forEach((tpl) => {
      const card = document.createElement("div");
      card.className = "hb-tpl-card";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const thumb = document.createElement("span");
      thumb.className = "hb-tpl-thumb";
      thumb.style.background = tpl.color || "#dddddd";
      if (tpl.thumbUrl) {
        const img = document.createElement("img");
        img.className = "hb-tpl-img";
        img.src = tpl.thumbUrl;
        img.alt = "";
        img.loading = "lazy";
        thumb.appendChild(img);
      }
      const name = document.createElement("span");
      name.className = "hb-tpl-name";
      name.textContent = tpl.title || "";
      card.append(thumb, name);
      card._tpl = tpl;
      card.addEventListener("click", () => {
        selected = tpl;
        cards.forEach((c) => c.classList.toggle("active", c === card));
        const btn = modal && modal.querySelector(".modal-footer .btn-primary");
        if (btn) {
          btn.disabled = false;
        }
      });
      card.addEventListener("dblclick", () => {
        selected = tpl;
        apply();
      });
      wrap.appendChild(card);
      cards.push(card);
    });
    const hint = document.createElement("p");
    hint.className = "hb-tpl-hint";
    hint.textContent = this.t("template.applyHint", "Applying replaces the current collage's layers.");
    wrap.appendChild(hint);

    modal = Modal.advanced({
      title: this.t("button.templates", "Templates"),
      type: Modal.types.default,
      content: wrap,
      size: Modal.sizes.large,
      buttons: [
        { text: this.t("template.applyBtn", "Apply template"), btnClass: "btn-primary", trigger: apply },
      ],
    });
    modal.addEventListener("typo3-modal-shown", () => {
      const btn = modal.querySelector(".modal-footer .btn-primary");
      if (btn) {
        btn.disabled = true;
      }
    });
  }

  openExport() {
    if (!this.exportUrl) {
      return;
    }
    const box = document.createElement("div");
    box.className = "herobuilder-export-list";
    const hint = document.createElement("p");
    hint.className = "hb-tpl-hint";
    hint.textContent = this.t("export.hint", "Choose a format to render and download.");
    box.appendChild(hint);
    let modal;
    EXPORT_FORMATS.forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-default hb-export-fmt";
      b.textContent = f.label;
      b.addEventListener("click", () => {
        this.generateExport(f.key);
        modal.hideModal();
      });
      box.appendChild(b);
    });
    modal = Modal.advanced({
      title: this.t("export.title", "Export image"),
      type: Modal.types.default,
      content: box,
      size: Modal.sizes.small,
    });
  }

  async generateExport(format) {
    if (!this.exportUrl) {
      return;
    }
    Notification.info("Hero Builder", this.t("export.rendering", "Rendering…"));
    try {
      const res = await new AjaxRequest(this.exportUrl).post({
        composition: this.input.value || "{}",
        format: format,
      });
      const data = await res.resolve();
      if (data && data.success && data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.download = data.filename || "hero.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        Notification.error("Hero Builder", this.t("export.error", "Export failed"));
      }
    } catch (e) {
      Notification.error("Hero Builder", this.t("export.error", "Export failed"));
    }
  }

  applyTemplate(composition) {
    let parsed;
    try {
      parsed = JSON.parse(composition || "{}");
    } catch (e) {
      return;
    }
    this.layers = Array.isArray(parsed.layers) ? parsed.layers : [];
    this.deselect();
    this.render();
    this.save();
    Notification.success("Hero Builder", this.t("template.apply", "Template applied"));
  }

  saveTemplate() {
    if (!this.templateSaveUrl) {
      return;
    }
    const box = document.createElement("div");
    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = this.t("template.savePrompt", "Template name");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    box.append(label, input);
    let modal;
    modal = Modal.advanced({
      title: this.t("button.saveTemplate", "Save as template"),
      type: Modal.types.default,
      content: box,
      size: Modal.sizes.small,
      buttons: [
        {
          text: this.t("button.saveTemplate", "Save"),
          btnClass: "btn-primary",
          trigger: () => {
            this.doSaveTemplate(input.value);
            modal.hideModal();
          },
        },
      ],
    });
    modal.addEventListener("typo3-modal-shown", () => input.focus());
  }

  async doSaveTemplate(title) {
    title = (title || "").trim();
    if (!title) {
      return;
    }
    try {
      const res = await new AjaxRequest(this.templateSaveUrl).post({
        title: title,
        composition: this.input.value || "{}",
        pid: String(this.templatePid),
      });
      const data = await res.resolve();
      if (data && data.success) {
        Notification.success("Hero Builder", this.t("template.saved", "Template saved"));
      } else {
        Notification.error("Hero Builder", this.t("template.saveError", "Could not save template"));
      }
    } catch (e) {
      Notification.error("Hero Builder", this.t("template.saveError", "Could not save template"));
    }
  }

  layerChip(layer) {
    const info = layer.type === "text" ? null : this.fileInfo[layer.fileUid];
    if (info && info.url) {
      return '<span class="hb-ll-chip" style="background-image:url(' + escapeAttr(info.url) + ')"></span>';
    }
    return '<span class="hb-ll-chip" style="background:' + chipColor(layer.id || "") + '"></span>';
  }

  layerLabel(layer) {
    if (layer.type === "text" || layer.type === "button") {
      const t = (layer.text || "").trim();
      const fallback = layer.type === "button" ? "Button" : "Text";
      return t ? (t.length > 30 ? t.slice(0, 30) + "…" : t) : fallback;
    }
    const info = this.fileInfo[layer.fileUid];
    return (info && info.name) || "#" + layer.fileUid;
  }

  // Full, untruncated name for the layer-list tooltip (the visible label is clipped by CSS).
  layerFullName(layer) {
    if (layer.type === "text" || layer.type === "button") {
      return (layer.text || "").trim() || (layer.type === "button" ? "Button" : "Text");
    }
    const info = this.fileInfo[layer.fileUid];
    return (info && info.name) || "#" + layer.fileUid;
  }

  renderLayerList() {
    if (!this.layerList) {
      return;
    }
    const ordered = [...this.layers].sort(
      (a, b) => ((this.placementFor(b) || {}).z || 0) - ((this.placementFor(a) || {}).z || 0)
    );
    if (!ordered.length) {
      this.layerList.innerHTML =
        '<div class="hb-ll-empty">' + escapeHtml(this.t("list.empty", "No elements on this stage")) + "</div>";
      return;
    }
    this.layerList.innerHTML = ordered
      .map((layer) => {
        const p = this.placementFor(layer);
        const hidden = !p || p.visible === false;
        const active = this.selected === layer;
        const locked = !!layer.locked;
        return (
          '<div class="hb-ll-item' +
          (active ? " active" : "") +
          (hidden ? " hb-ll-hidden" : "") +
          '" draggable="true" data-id="' +
          escapeAttr(layer.id) +
          '"><span class="hb-ll-grip" title="' +
          escapeAttr(this.t("list.reorder", "Reorder")) +
          '">⠿</span>' +
          '<button type="button" class="hb-ll-sel" data-act="select" title="' +
          escapeAttr(this.layerFullName(layer)) + '">' +
          this.layerChip(layer) +
          '<span class="hb-ll-name">' + escapeHtml(this.layerLabel(layer)) + "</span></button>" +
          '<button type="button" class="hb-ll-btn hb-ll-vis" data-act="vis" title="' +
          escapeAttr(this.t("list.toggleVisible", "Show / hide on %s").replace("%s", this.activeBp.toUpperCase())) +
          '">' + (hidden ? ICON.eyeOff : ICON.eye) + "</button>" +
          '<button type="button" class="hb-ll-btn hb-ll-lock" data-act="lock" title="' +
          escapeAttr(this.t("list.toggleLock", "Lock / unlock")) +
          '">' + (locked ? ICON.lock : ICON.unlock) + "</button>" +
          '<button type="button" class="hb-ll-btn hb-ll-del" data-act="delete" title="' +
          escapeAttr(this.t("list.delete", "Delete layer")) + '">' + ICON.trash + "</button>" +
          "</div>"
        );
      })
      .join("");
  }

  // ---- Per-layer panel ---------------------------------------------------

  buildPanel() {
    // Mount into the right sidebar provided by the PHP skeleton.
    const panel = this.root.querySelector(".herobuilder-panel");
    panel.hidden = true;
    this.panel = panel;

    // Filled per selected layer (its type's classes) by renderClassChips().
    const classControl = '<div class="hb-class-chips"></div>';
    const animNone = escapeHtml(this.t("panel.animNone", "— none —"));
    const alignBtn = (mode, icon, label) =>
      '<button type="button" class="hb-align btn btn-sm btn-default" data-align="' + mode + '" title="' + escapeAttr(label) + '">' + icon + "</button>";

    panel.innerHTML =
      // ---- Content tab: what the layer shows and where it links to (per type, see updatePanel) ----
      '<div class="herobuilder-tabpane active" data-tab="content">' +
      '<div class="herobuilder-panel-row hb-row-text"><label>' + escapeHtml(this.t("panel.text", "Text")) + "</label>" +
      '<textarea class="hb-text form-control form-control-sm" rows="2"></textarea></div>' +
      '<div class="herobuilder-panel-row hb-row-tag"><label>' + escapeHtml(this.t("panel.tag", "HTML element")) + "</label>" +
      '<select class="hb-tag form-select form-select-sm">' +
      TEXT_TAGS.map((t) => '<option value="' + t + '">' + escapeHtml(this.t("tag." + t, t)) + "</option>").join("") +
      "</select></div>" +
      '<div class="herobuilder-panel-row hb-row-imgedit"><label>' + escapeHtml(this.t("panel.imageEdit", "Image")) + "</label>" +
      '<div class="hb-imgedit">' +
      '<button type="button" class="hb-flip-h btn btn-sm btn-default" title="' + escapeAttr(this.t("panel.flipH", "Flip horizontally")) + '">' + ICON.flipH + "</button>" +
      '<button type="button" class="hb-flip-v btn btn-sm btn-default" title="' + escapeAttr(this.t("panel.flipV", "Flip vertically")) + '">' + ICON.flipV + "</button>" +
      '<button type="button" class="hb-crop btn btn-sm btn-default">' + ICON.crop + " " + escapeHtml(this.t("panel.crop", "Crop")) + "</button>" +
      '<button type="button" class="hb-autotrim btn btn-sm btn-default">' + escapeHtml(this.t("panel.autoTrim", "Auto-trim")) + "</button>" +
      '<button type="button" class="hb-crop-reset btn btn-sm btn-default" hidden>' + escapeHtml(this.t("panel.cropReset", "Reset crop")) + "</button>" +
      "</div>" +
      '<label class="hb-art-bp-label"><input type="checkbox" class="hb-art-bp"> <span class="hb-art-bp-text"></span></label>' +
      "</div>" +
      '<div class="herobuilder-panel-row hb-row-fit"><label>' + escapeHtml(this.t("panel.fit", "Fit (scaling)")) + "</label>" +
      '<select class="hb-fit form-select form-select-sm">' +
      FIT_MODES.map((f) => '<option value="' + f + '">' + escapeHtml(this.t("fit." + f, f)) + "</option>").join("") +
      "</select></div>" +
      '<div class="herobuilder-panel-row hb-row-focus"><label>' + escapeHtml(this.t("panel.focus", "Focus point (cover/contain)")) + "</label>" +
      '<div class="hb-focus"><img class="hb-focus-img" alt=""><span class="hb-focus-dot"></span></div></div>' +
      '<div class="herobuilder-panel-row hb-row-alt"><label>' + escapeHtml(this.t("panel.alt", "Alternative text")) + "</label>" +
      '<input type="text" class="hb-alt form-control form-control-sm">' +
      '<div class="hb-hint hb-hint-noalt alert alert-warning" hidden>' +
      escapeHtml(this.t("hint.imageLinkNoAlt", "Enter an alternative text — otherwise the link has no name for screen readers.")) + "</div>" +
      "</div>" +
      '<div class="herobuilder-panel-row hb-row-link"><label>' + escapeHtml(this.t("panel.link", "Link")) + "</label>" +
      '<div class="hb-link"><code class="hb-link-value">—</code>' +
      '<div class="hb-link-btns">' +
      '<button type="button" class="hb-link-choose btn btn-sm btn-default">' + escapeHtml(this.t("link.choose", "Choose link")) + "</button>" +
      '<button type="button" class="hb-link-clear btn btn-sm btn-default" hidden>' + escapeHtml(this.t("link.remove", "Remove")) + "</button>" +
      "</div></div>" +
      '<div class="hb-hint hb-hint-nolink alert alert-warning" hidden>' +
      escapeHtml(this.t("hint.buttonNoLink", "This button has no link and is not clickable on the website.")) + "</div>" +
      "</div>" +
      "</div>" +
      // ---- Design tab: classes (grouped) and the text darkening ----
      '<div class="herobuilder-tabpane" data-tab="style">' +
      '<div class="herobuilder-panel-row hb-row-classes"><label>' + escapeHtml(this.t("panel.classes", "Classes")) + "</label>" +
      classControl + "</div>" +
      '<div class="herobuilder-panel-row hb-row-overlay"><label>' + escapeHtml(this.t("panel.overlay", "Darkening behind text (%)")) + "</label>" +
      '<div class="hb-overlay-ctl"><input type="range" class="hb-overlay" min="0" max="100" step="5"><span class="hb-overlay-val">0%</span></div>' +
      '<div class="hb-hint hb-overlay-locked alert alert-info" hidden>' +
      escapeHtml(this.t("panel.overlayLocked", "A box class sets the background — darkening is off while it is selected.")) + "</div></div>" +
      "</div>" +
      // ---- Position tab: geometry and visibility on the active breakpoint ----
      '<div class="herobuilder-tabpane" data-tab="position">' +
      '<div class="herobuilder-panel-row hb-row-geom"><label>' + escapeHtml(this.t("panel.geometry", "Position / size (%)")) + "</label>" +
      '<div class="hb-geom">' +
      '<label>X<input type="number" class="hb-geom-x form-control form-control-sm" step="0.01"></label>' +
      '<label>Y<input type="number" class="hb-geom-y form-control form-control-sm" step="0.01"></label>' +
      '<label>W<input type="number" class="hb-geom-w form-control form-control-sm" step="0.01"></label>' +
      '<label>H<input type="number" class="hb-geom-h form-control form-control-sm" step="0.01" placeholder="' +
      escapeAttr(this.t("panel.heightAuto", "auto")) + '"></label>' +
      '<label>°<input type="number" class="hb-geom-rot form-control form-control-sm" step="1"></label>' +
      "</div></div>" +
      '<div class="herobuilder-panel-row"><label>' + escapeHtml(this.t("panel.align", "Align")) + "</label>" +
      '<div class="hb-align-row">' +
      alignBtn("left", ICON.alignLeft, this.t("ctx.alignLeft", "Left")) +
      alignBtn("centerH", ICON.alignCenterH, this.t("ctx.alignCenterH", "Center horizontally")) +
      alignBtn("right", ICON.alignRight, this.t("ctx.alignRight", "Right")) +
      alignBtn("top", ICON.alignTop, this.t("ctx.alignTop", "Top")) +
      alignBtn("middle", ICON.alignV, this.t("panel.alignV", "Center vertically")) +
      alignBtn("bottom", ICON.alignBottom, this.t("ctx.alignBottom", "Bottom")) +
      "</div></div>" +
      '<div class="herobuilder-panel-row hb-row-visible"><label class="hb-visible-label">' +
      '<input type="checkbox" class="hb-visible"> <span class="hb-visible-text"></span></label></div>' +
      '<div class="herobuilder-panel-row"><button type="button" class="t3js-herobuilder-copy btn btn-sm btn-default hb-copyall">' +
      escapeHtml(this.t("button.copyToAll", "Copy position to all breakpoints")) + "</button></div>" +
      "</div>" +
      // ---- Animation tab ----
      '<div class="herobuilder-tabpane" data-tab="anim">' +
      '<div class="herobuilder-panel-row"><label>' + escapeHtml(this.t("panel.animation", "Animation")) + "</label>" +
      '<select class="hb-anim-effect form-select form-select-sm">' +
      AOS_EFFECTS.map((e) => '<option value="' + e + '">' + (e || animNone) + "</option>").join("") +
      "</select></div>" +
      '<div class="herobuilder-panel-row"><label>' + escapeHtml(this.t("panel.delay", "Delay (ms)")) +
      '</label><input type="number" class="hb-anim-delay form-control form-control-sm" min="0" step="50"></div>' +
      '<div class="herobuilder-panel-row"><label>' + escapeHtml(this.t("panel.duration", "Duration (ms)")) +
      '</label><input type="number" class="hb-anim-duration form-control form-control-sm" min="0" step="50"></div>' +
      '<div class="herobuilder-panel-row"><button type="button" class="hb-anim-replay btn btn-sm btn-default">▶ ' +
      escapeHtml(this.t("preview.replay", "Replay animation")) + "</button></div>" +
      "</div>";

    panel.querySelector(".hb-anim-effect").addEventListener("change", (e) => this.setAnim("effect", e.target.value));
    panel.querySelector(".hb-anim-delay").addEventListener("input", (e) => this.setAnim("delay", e.target.value));
    panel.querySelector(".hb-anim-duration").addEventListener("input", (e) => this.setAnim("duration", e.target.value));
    panel.querySelector(".hb-fit").addEventListener("change", (e) => this.setFit(e.target.value));
    panel.querySelector(".hb-text").addEventListener("input", (e) => this.setText(e.target.value));
    panel.querySelector(".hb-alt").addEventListener("input", (e) => this.setAlt(e.target.value));
    panel.querySelector(".hb-tag").addEventListener("change", (e) => this.setTag(e.target.value));
    panel.querySelector(".hb-overlay").addEventListener("input", (e) => this.setOverlay(e.target.value));
    panel.querySelector(".hb-class-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".hb-class-chip");
      if (!chip) {
        return;
      }
      if (chip.classList.contains("hb-class-chip-unavailable")) {
        // Stored but not offered for this layer type: a click removes it for good.
        chip.remove();
      } else {
        chip.classList.toggle("active");
        // One-of-a-kind group (size, alignment, …): selecting one deselects its siblings.
        if (chip.classList.contains("active") && chip.dataset.exclusive) {
          panel.querySelectorAll('.hb-class-chip[data-group="' + chip.dataset.group + '"]').forEach((other) => {
            if (other !== chip) {
              other.classList.remove("active");
            }
          });
        }
      }
      this.setClasses();
    });
    this.bindFocusPicker(panel.querySelector(".hb-focus"));
    [
      ["x", ".hb-geom-x"], ["y", ".hb-geom-y"], ["w", ".hb-geom-w"],
      ["h", ".hb-geom-h"], ["rot", ".hb-geom-rot"],
    ].forEach(([field, sel]) => {
      panel.querySelector(sel).addEventListener("input", (e) => this.setGeom(field, e.target.value));
    });
    panel.querySelectorAll(".hb-align").forEach((b) => b.addEventListener("click", () => this.align(b.dataset.align)));
    panel.querySelector(".hb-flip-h").addEventListener("click", () => this.toggleFlip("flipH"));
    panel.querySelector(".hb-flip-v").addEventListener("click", () => this.toggleFlip("flipV"));
    panel.querySelector(".hb-crop").addEventListener("click", () => this.openCrop());
    panel.querySelector(".hb-art-bp").addEventListener("change", (e) => this.setArtDirection(e.target.checked));
    panel.querySelector(".hb-autotrim").addEventListener("click", () => this.autoTrimSelected());
    panel.querySelector(".hb-crop-reset").addEventListener("click", () => this.resetCrop());
    panel.querySelector(".hb-anim-replay").addEventListener("click", () => this.replayPreview());
    panel.querySelector(".hb-link-choose").addEventListener("click", () => this.openLinkBrowser());
    panel.querySelector(".hb-link-clear").addEventListener("click", () => this.setLink(""));
    panel.querySelector(".hb-visible").addEventListener("change", () => this.selected && this.toggleVisibility(this.selected));
    // .t3js-herobuilder-copy is wired in bindToolbar().
  }

  // Collapsible left/right sidebars — the editor is cramped, so let editors reclaim the
  // canvas width by folding either panel to a thin strip with an expand toggle.
  buildSidebarToggles() {
    const grid = this.root.querySelector(".herobuilder-grid");
    if (!grid) {
      return;
    }
    const make = (sidebarSel, cls, side) => {
      const sb = this.root.querySelector(sidebarSel);
      if (!sb) {
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "herobuilder-sidebar-toggle";
      const sync = () => {
        const collapsed = grid.classList.contains(cls);
        const pointRight = collapsed ? side === "left" : side === "right";
        btn.innerHTML = pointRight ? ICON.chevronRight : ICON.chevronLeft;
        btn.title = collapsed ? this.t("sidebar.expand", "Expand") : this.t("sidebar.collapse", "Collapse");
      };
      btn.addEventListener("click", () => {
        grid.classList.toggle(cls);
        sync();
      });
      sb.insertBefore(btn, sb.firstChild);
      sync();
    };
    make(".herobuilder-sidebar-left", "hb-left-collapsed", "left");
    make(".herobuilder-sidebar-right", "hb-right-collapsed", "right");
  }

  bindProps() {
    const tabs = this.root.querySelectorAll(".herobuilder-proptab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        this.panel.querySelectorAll(".herobuilder-tabpane").forEach((pane) => {
          pane.classList.toggle("active", pane.dataset.tab === tab.dataset.tab);
        });
      });
    });
  }

  updatePanel() {
    this.renderLayerList();
    if (!this.panel) {
      return;
    }
    // Nothing selected: a hint instead of empty tabs.
    const tabs = this.root.querySelector(".herobuilder-proptabs");
    if (!this.panelEmpty) {
      this.panelEmpty = document.createElement("p");
      this.panelEmpty.className = "hb-panel-empty text-body-secondary";
      this.panelEmpty.textContent = this.t("panel.empty", "Select a layer on the stage or in the list.");
      this.panel.parentNode.insertBefore(this.panelEmpty, this.panel);
    }
    this.panelEmpty.hidden = !!this.selected;
    if (tabs) {
      tabs.hidden = !this.selected;
    }
    if (!this.selected) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    const type = this.selected.type;
    const isText = type === "text" || type === "button";
    const anim = this.selected.anim || {};
    const p = this.placementFor(this.selected) || {};
    this.panel.querySelector(".hb-row-text").hidden = !isText;
    this.panel.querySelector(".hb-row-overlay").hidden = type !== "text";
    this.panel.querySelector(".hb-row-tag").hidden = type !== "text";
    this.panel.querySelector(".hb-tag").value = TEXT_TAGS.includes(this.selected.tag) ? this.selected.tag : "div";
    this.panel.querySelector(".hb-row-fit").hidden = isText;
    this.panel.querySelector(".hb-text").value = this.selected.text || "";
    // Link row: shown for all layer types (any layer may carry a TYPO3 link).
    this.panel.querySelector(".hb-link-value").textContent = this.selected.link || "—";
    this.panel.querySelector(".hb-link-clear").hidden = !this.selected.link;
    this.updateAltAndHints();
    const ov = this.selected.overlay || 0;
    this.panel.querySelector(".hb-overlay").value = ov;
    this.panel.querySelector(".hb-overlay-val").textContent = ov + "%";
    this.renderClassChips(this.selected);
    this.panel.querySelector(".hb-anim-effect").value = anim.effect || "";
    this.panel.querySelector(".hb-anim-delay").value = anim.delay || "";
    this.panel.querySelector(".hb-anim-duration").value = anim.duration || "";
    this.panel.querySelector(".hb-fit").value = this.selected.fit || "fill";
    this.updateGeomFields(p);
    const bpName = this.activeBp.toUpperCase();
    this.panel.querySelector(".hb-visible").checked = p.visible !== false;
    this.panel.querySelector(".hb-visible-text").textContent =
      this.t("panel.visibleOn", "Visible on %s").replace("%s", bpName);
    this.updateOverlayLock();

    // Focus point picker — only for image layers with a resolvable file.
    const info = isText ? null : this.fileInfo[this.selected.fileUid];
    const focusRow = this.panel.querySelector(".hb-row-focus");
    // The focus point only decides something when the image is scaled with cover or contain.
    if (info && info.url && (this.selected.fit === "cover" || this.selected.fit === "contain")) {
      focusRow.hidden = false;
      this.panel.querySelector(".hb-focus-img").src = info.url;
      this.updateFocusDot();
    } else {
      focusRow.hidden = true;
    }

    // Image-edit row (flip / crop) — only for image layers with a resolvable file.
    const imgEditRow = this.panel.querySelector(".hb-row-imgedit");
    if (info && info.url) {
      imgEditRow.hidden = false;
      this.panel.querySelector(".hb-flip-h").classList.toggle("active", !!this.selected.flipH);
      this.panel.querySelector(".hb-flip-v").classList.toggle("active", !!this.selected.flipV);
      const crop = this.effCrop(this.selected);
      this.panel.querySelector(".hb-crop").classList.toggle("active", !!crop);
      this.panel.querySelector(".hb-crop-reset").hidden = !crop;
      this.panel.querySelector(".hb-art-bp").checked = !!this.imageOverride(this.selected);
      this.panel.querySelector(".hb-art-bp-text").textContent =
        this.t("panel.artDirection", "Crop & focus only for %s").replace("%s", this.activeBp.toUpperCase());
    } else {
      imgEditRow.hidden = true;
    }
  }

  /**
   * The class chips of a layer's type. Classes stored on the layer but not offered for its type
   * (config changed, or set before classes were per type) show as "not available": the frontend
   * drops them, so the editor must not hide them either.
   */
  renderClassChips(layer) {
    const box = this.panel.querySelector(".hb-class-chips");
    const type = layer.type === "text" || layer.type === "button" ? layer.type : "image";
    const offered = this.classes[type] || [];
    const groups = (this.classGroups && this.classGroups[type]) || [];
    const selected = (layer.cssClass || "").split(/\s+/).filter(Boolean);
    const label = new Map(offered.map((c) => [c.value, c.label]));
    const chip = (value, text, extra, attrs) =>
      '<button type="button" class="hb-class-chip' + (selected.includes(value) ? " active" : "") + extra + '" data-value="' +
      escapeAttr(value) + '"' + attrs + ">" + escapeHtml(text) + "</button>";
    let html = "";
    const placed = new Set();
    // Configured groups first (tx_herobuilder.layerClassGroups), in their order; a group lists
    // only classes that are offered for this type (layerClasses stays the whitelist).
    groups.forEach((g, i) => {
      const values = g.classes.filter((v) => label.has(v) && !placed.has(v));
      if (!values.length) {
        return;
      }
      values.forEach((v) => placed.add(v));
      const attrs = ' data-group="' + i + '"' + (g.exclusive ? ' data-exclusive="1"' : "") + (g.background ? ' data-background="1"' : "");
      html += '<div class="hb-class-group">' + (g.label ? '<div class="hb-class-group-label">' + escapeHtml(g.label) + "</div>" : "") +
        '<div class="hb-class-group-chips">' + values.map((v) => chip(v, label.get(v), "", attrs)).join("") + "</div></div>";
    });
    const rest = offered.filter((c) => !placed.has(c.value));
    if (rest.length) {
      const chips = rest.map((c) => chip(c.value, c.label, "", "")).join("");
      // Without any group configuration the list stays one plain block, as before.
      html += placed.size
        ? '<div class="hb-class-group"><div class="hb-class-group-label">' + escapeHtml(this.t("panel.classesOther", "More")) +
          '</div><div class="hb-class-group-chips">' + chips + "</div></div>"
        : chips;
    }
    // Stored on the layer but not offered for its type: the frontend drops them, so show them.
    const unavailable = this.t("panel.classUnavailable", "Not available for this layer type — click to remove");
    html += selected.filter((v) => !label.has(v))
      .map((v) => chip(v, v, " hb-class-chip-unavailable", ' title="' + escapeAttr(unavailable) + '"')).join("");
    box.innerHTML = html ||
      '<em class="text-body-secondary">' +
        escapeHtml(this.t("panel.noClasses", "No classes configured (page TSconfig tx_herobuilder.layerClasses)")) +
        "</em>";
  }

  /** The text darkening and a background class set the same property — the class wins. */
  updateOverlayLock() {
    if (!this.panel || !this.selected) {
      return;
    }
    const locked = !!this.panel.querySelector(".hb-class-chip.active[data-background]");
    this.panel.querySelector(".hb-overlay").disabled = locked;
    this.panel.querySelector(".hb-overlay-locked").hidden = !locked;
  }

  updateGeomFields(p) {
    if (!this.panel) {
      return;
    }
    const map = { x: ".hb-geom-x", y: ".hb-geom-y", w: ".hb-geom-w", h: ".hb-geom-h", rot: ".hb-geom-rot" };
    Object.entries(map).forEach(([field, sel]) => {
      const el = this.panel.querySelector(sel);
      // Don't clobber the field the user is currently typing in.
      if (el && el !== document.activeElement) {
        // Height 0 means "follows the content" — shown as the empty field's "auto" placeholder.
        el.value = field === "h" && !p.h ? "" : p[field] ?? (field === "rot" ? 0 : "");
      }
    });
  }

  setGeom(field, value) {
    if (!this.selected) {
      return;
    }
    const layer = this.selected;
    const p = this.ensurePlacement(layer);
    const wasAuto = isAutoHeight(layer, p);
    p[field] = round(parseFloat(value) || 0);
    if (field === "h" && wasAuto !== isAutoHeight(layer, p)) {
      // Switching between "auto" and a fixed height changes clipping and the resize handles.
      this.render();
      this.select(layer);
    } else {
      if (layer._el) {
        this.applyGeomToEl(layer._el, p);
      }
      this.patchCanvasGeometry(layer, p);
      this.syncHandlesToCanvas(layer);
      if (this.moveable) {
        this.moveable.updateRect();
      }
      this.renderLayerList();
    }
    this.save();
  }

  applyGeomToEl(el, p) {
    el.style.left = (p.x ?? 0) + "%";
    el.style.top = (p.y ?? 0) + "%";
    el.style.width = (p.w ?? 0) + "%";
    if (p.h) {
      el.style.height = p.h + "%";
    } else if (p.h != null) {
      el.style.height = "auto";
    }
    el.style.transform = "rotate(" + (p.rot || 0) + "deg)";
    el.style.zIndex = String(p.z || 1);
  }

  setText(value) {
    if (!this.selected) {
      return;
    }
    this.selected.text = value;
    if (this.selected._el) {
      this.selected._el.textContent = value || "Text";
    }
    const rendered = this.canvasElFor(this.selected);
    if (rendered) {
      (rendered.querySelector(".hb-layer-tag") || rendered).textContent = value;
      this.syncHandlesToCanvas(this.selected);
    }
    this.renderLayerList();
    this.save();
  }

  setTag(value) {
    if (!this.selected) {
      return;
    }
    this.selected.tag = TEXT_TAGS.includes(value) ? value : "div";
    this.save();
  }

  openLinkBrowser() {
    if (!this.selected || !this.linkWizardUrl || !this.linkProxy) {
      return;
    }
    // Prime the proxy with the current value, then open the TYPO3 Link Browser (like the
    // core link field does). On selection the browser writes back into the proxy (change).
    const current = this.selected.link || "";
    this.linkProxy.value = current;
    const url =
      this.linkWizardUrl +
      "&P[currentValue]=" + encodeURIComponent(current) +
      "&P[currentSelectedValues]=" + encodeURIComponent(current);
    Modal.advanced({ type: Modal.types.iframe, content: url, size: Modal.sizes.large });
  }

  /**
   * Alternative text of an image layer: the file's metadata shows as placeholder until the layer
   * gets its own text (as TYPO3's file references do). Plus the link hints for button and image.
   */
  updateAltAndHints() {
    const layer = this.selected;
    if (!layer || !this.panel) {
      return;
    }
    const isImage = layer.type !== "text" && layer.type !== "button";
    const info = isImage ? this.fileInfo[layer.fileUid] : null;
    const fileAlt = (info && info.alt) || "";
    const own = (layer.alt || "").trim();
    const altInput = this.panel.querySelector(".hb-alt");
    this.panel.querySelector(".hb-row-alt").hidden = !isImage;
    if (altInput !== document.activeElement) {
      altInput.value = layer.alt || "";
    }
    altInput.placeholder = fileAlt
      ? this.t("panel.altFromFile", "From the file: %s").replace("%s", fileAlt)
      : this.t("panel.altNone", "No alternative text set");
    this.panel.querySelector(".hb-hint-nolink").hidden = !(layer.type === "button" && !layer.link);
    this.panel.querySelector(".hb-hint-noalt").hidden = !(isImage && layer.link && !own && !fileAlt);
  }

  setAlt(value) {
    if (!this.selected) {
      return;
    }
    this.selected.alt = value;
    this.updateAltAndHints();
    this.save();
  }

  setLink(value) {
    if (!this.selected) {
      return;
    }
    this.selected.link = (value || "").trim();
    this.updatePanel();
    this.save();
  }

  setOverlay(value) {
    if (!this.selected) {
      return;
    }
    const v = Math.min(100, Math.max(0, parseInt(value, 10) || 0));
    this.selected.overlay = v;
    const valEl = this.panel && this.panel.querySelector(".hb-overlay-val");
    if (valEl) {
      valEl.textContent = v + "%";
    }
    const el = this.selected._el;
    if (el && this.selected.type === "text") {
      el.style.backgroundColor = v > 0 ? "rgba(0,0,0," + v / 100 + ")" : "";
      el.style.padding = v > 0 ? ".35em .6em" : "";
    }
    this.save();
  }

  setClasses() {
    if (!this.selected || !this.panel) {
      return;
    }
    const vals = [...this.panel.querySelectorAll(".hb-class-chip.active")].map((c) => c.dataset.value);
    const rendered = this.canvasElFor(this.selected);
    if (rendered) {
      (this.selected.cssClass || "").split(/\s+/).filter(Boolean).forEach((c) => rendered.classList.remove(c));
      vals.forEach((c) => rendered.classList.add(c));
    }
    this.selected.cssClass = vals.join(" ");
    this.save();
    this.render();
    this.select(this.selected);
  }

  setFit(value) {
    if (!this.selected) {
      return;
    }
    this.selected.fit = value || "fill";
    this.save();
    this.render();
    this.select(this.selected);
  }

  // ---- Flip / crop -------------------------------------------------------

  toggleFlip(field) {
    const l = this.selected;
    if (!l || l.type === "text" || l.type === "button") {
      return;
    }
    l[field] = !l[field];
    this.save();
    this.render();
    this.select(l);
  }

  resetCrop() {
    if (!this.selected) {
      return;
    }
    this.imageTarget(this.selected).crop = null;
    this.save();
    this.render();
    this.select(this.selected);
  }

  applyCrop(layer, fractions) {
    this.imageTarget(layer).crop = this.cleanCrop(fractions);
    this.adjustBoxToCrop(layer);
    this.save();
    this.render();
    this.select(layer);
  }

  // Numeric width/height ratio of a breakpoint's stage (e.g. "21:9" → 2.333).
  stageRatio(bp) {
    const r = String((this.stages[bp] && this.stages[bp].ratio) || "16:9").split(":").map(Number);
    return r[0] > 0 && r[1] > 0 ? r[0] / r[1] : 16 / 9;
  }

  /**
   * After a crop the visible content has a new aspect ratio. Update each defined placement's
   * height (keeping its width) so the layer box matches the cropped image, whatever the fit.
   * Full-bleed placements are left alone (see below).
   */
  adjustBoxToCrop(layer, onlyBp = null) {
    const info = this.fileInfo[layer.fileUid];
    if (!info) {
      return;
    }
    // Every fit gets a box shaped like the crop: "fill" would stretch, "contain" would letterbox
    // and "cover" would crop the chosen region a second time. Only a placement covering the whole
    // stage (a background) keeps its box — it must go on filling the stage after a crop.
    // A breakpoint with its own framing only follows its own crop; the others follow the
    // layer's. So a crop made "only for XS" never reshapes the desktop boxes.
    // `onlyBp` limits it to one breakpoint — the one whose framing just changed on its own.
    const own = this.imageOverride(layer);
    const bps = onlyBp
      ? [onlyBp]
      : own
        ? [this.activeBp]
        : Object.keys(layer.placements || {}).filter((bp) => !layer.placements[bp].image);
    bps.forEach((bp) => {
      const p = layer.placements[bp];
      const crop = this.effCrop(layer, bp);
      if (!p || !p.w || !crop || isFullBleed(p)) {
        return;
      }
      const cropAspect = (crop.width * (info.width || 1)) / (crop.height * (info.height || 1));
      if (isFinite(cropAspect) && cropAspect > 0) {
        // box aspect = (w/h) * stageRatio  →  h = w * stageRatio / cropAspect
        p.h = round((p.w * this.stageRatio(bp)) / cropAspect);
      }
    });
  }

  // ---- Art direction: crop & focus per breakpoint ------------------------

  /**
   * The breakpoint's placement framing ({crop, focusX, focusY}), or null when it uses the layer's.
   * A breakpoint without a placement of its own shows the primary one, framing included — the
   * same cascade as CompositionProcessor::framingPerBreakpoint() in the frontend.
   */
  imageOverride(layer, bp = this.activeBp) {
    const placements = (layer && layer.placements) || {};
    let p = placements[bp];
    if (!p) {
      const primaryBp = placements.lg ? "lg" : Object.keys(placements)[0];
      p = primaryBp ? placements[primaryBp] : null;
    }
    return p && p.image ? p.image : null;
  }

  /**
   * Where crop/focus edits go: the active breakpoint's framing if it has one, else the layer.
   * Framing inherited from the primary placement is copied to the breakpoint first, so editing
   * it here never changes the primary breakpoint behind the editor's back.
   */
  imageTarget(layer) {
    const own = layer.placements && layer.placements[this.activeBp];
    if (!own && this.imageOverride(layer)) {
      return this.ensurePlacement(layer).image;
    }
    return this.imageOverride(layer) || layer;
  }

  effCrop(layer, bp = this.activeBp) {
    const own = this.imageOverride(layer, bp);
    return (own ? own.crop : layer.crop) || null;
  }

  effFocus(layer, bp = this.activeBp) {
    const src = this.imageOverride(layer, bp) || layer;
    return { x: src.focusX ?? 50, y: src.focusY ?? 50 };
  }

  /** Give the active breakpoint its own crop/focus (starting from the inherited one), or drop it. */
  setArtDirection(on) {
    const layer = this.selected;
    if (!layer || layer.type === "text" || layer.type === "button") {
      return;
    }
    const p = this.ensurePlacement(layer);
    if (on) {
      const focus = this.effFocus(layer);
      const crop = this.effCrop(layer);
      p.image = { crop: crop ? { ...crop } : null, focusX: focus.x, focusY: focus.y };
    } else {
      delete p.image;
      // Only this breakpoint changed its framing; the other breakpoints keep their boxes.
      this.adjustBoxToCrop(layer, this.activeBp);
    }
    this.save();
    this.render();
    this.select(layer);
  }

  async openCrop() {
    const layer = this.selected;
    if (!layer || layer.type === "text" || layer.type === "button") {
      return;
    }
    const info = this.fileInfo[layer.fileUid];
    if (!info || !info.url) {
      return;
    }
    await this.ensureMoveable();

    const natW = info.width || 1;
    const natH = info.height || 1;

    const wrap = document.createElement("div");
    wrap.className = "herobuilder-crop";
    const style = document.createElement("style");
    style.textContent = CROP_CSS;
    wrap.appendChild(style);

    const hint = document.createElement("p");
    hint.className = "hb-crop-hint";
    hint.textContent = this.t("crop.hint", "Drag/resize the frame to keep only the visible part — the cropped image is rendered smaller on the website.");
    wrap.appendChild(hint);

    const stage = document.createElement("div");
    stage.className = "hb-crop-stage";
    const frame = document.createElement("div");
    frame.className = "hb-crop-frame";
    // Frame follows the image's natural aspect so crop fractions map 1:1 to pixels.
    frame.style.width = Math.min(720, natW) + "px";
    frame.style.aspectRatio = natW + " / " + natH;
    const img = document.createElement("img");
    img.src = info.url;
    img.alt = "";
    frame.appendChild(img);
    const rect = document.createElement("div");
    rect.className = "hb-crop-rect";
    frame.appendChild(rect);
    stage.appendChild(frame);
    wrap.appendChild(stage);

    const dims = document.createElement("p");
    dims.className = "hb-crop-dims";
    wrap.appendChild(dims);

    const setRect = (c) => {
      const fw = frame.clientWidth || 1;
      const fh = frame.clientHeight || 1;
      rect.style.left = c.x * fw + "px";
      rect.style.top = c.y * fh + "px";
      rect.style.width = c.width * fw + "px";
      rect.style.height = c.height * fh + "px";
    };
    const fractions = () => {
      const fw = frame.clientWidth || 1;
      const fh = frame.clientHeight || 1;
      return {
        x: rect.offsetLeft / fw,
        y: rect.offsetTop / fh,
        width: rect.offsetWidth / fw,
        height: rect.offsetHeight / fh,
      };
    };
    const updateDims = () => {
      const c = this.cleanCrop(fractions()) || { width: 1, height: 1 };
      dims.textContent = Math.round(c.width * natW) + " × " + Math.round(c.height * natH) + " px";
    };

    let mv = null;
    let modal = Modal.advanced({
      title: this.t("panel.crop", "Crop"),
      type: Modal.types.default,
      content: wrap,
      size: Modal.sizes.large,
      buttons: [
        { text: this.t("crop.cancel", "Cancel"), btnClass: "btn-default", trigger: () => modal.hideModal() },
        {
          text: this.t("crop.reset", "Reset"),
          btnClass: "btn-default",
          trigger: () => { setRect({ x: 0, y: 0, width: 1, height: 1 }); if (mv) { mv.updateRect(); } updateDims(); },
        },
        {
          text: this.t("panel.autoTrim", "Auto-trim"),
          btnClass: "btn-default",
          trigger: async () => {
            const box = await this.computeTrimBox(info.url);
            if (box && !box.full) {
              setRect(box);
              if (mv) { mv.updateRect(); }
              updateDims();
            } else if (box && box.full) {
              Notification.info("Hero Builder", this.t("trim.already", "Nothing to trim — no empty margins found"));
            } else {
              Notification.warning("Hero Builder", this.t("trim.none", "Could not detect content to trim"));
            }
          },
        },
        {
          text: this.t("crop.apply", "Apply"),
          btnClass: "btn-primary",
          trigger: () => { this.applyCrop(layer, fractions()); modal.hideModal(); },
        },
      ],
    });

    modal.addEventListener("typo3-modal-shown", () => {
      setRect(this.effCrop(layer) || { x: 0, y: 0, width: 1, height: 1 });
      updateDims();
      mv = new window.Moveable(stage, {
        target: rect,
        draggable: true,
        resizable: true,
        origin: false,
        keepRatio: false,
      });
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      mv
        .on("drag", ({ target, left, top }) => {
          target.style.left = clamp(left, 0, frame.clientWidth - target.offsetWidth) + "px";
          target.style.top = clamp(top, 0, frame.clientHeight - target.offsetHeight) + "px";
          updateDims();
        })
        .on("resize", ({ target, width, height, drag }) => {
          target.style.width = Math.min(width, frame.clientWidth) + "px";
          target.style.height = Math.min(height, frame.clientHeight) + "px";
          target.style.left = clamp(drag.left, 0, frame.clientWidth - target.offsetWidth) + "px";
          target.style.top = clamp(drag.top, 0, frame.clientHeight - target.offsetHeight) + "px";
          updateDims();
        });
    });
    modal.addEventListener("typo3-modal-hide", () => { if (mv) { mv.destroy(); mv = null; } });
  }

  // One-click: detect the content bounds (transparent margins, or a uniform border colour)
  // and set the crop to them.
  async autoTrimSelected() {
    const layer = this.selected;
    if (!layer || layer.type === "text" || layer.type === "button") {
      return;
    }
    const info = this.fileInfo[layer.fileUid];
    if (!info || !info.url) {
      return;
    }
    const box = await this.computeTrimBox(info.url);
    if (!box) {
      Notification.warning("Hero Builder", this.t("trim.none", "Could not detect content to trim"));
      return;
    }
    if (box.full) {
      Notification.info("Hero Builder", this.t("trim.already", "Nothing to trim — no empty margins found"));
      return;
    }
    this.imageTarget(layer).crop = this.cleanCrop(box);
    this.adjustBoxToCrop(layer);
    this.save();
    this.render();
    this.select(layer);
  }

  /**
   * Scan the image pixels for the content bounding box. Uses alpha when the image has any
   * transparency, otherwise trims a uniform border colour (sampled from the top-left corner).
   * Returns crop fractions {x,y,width,height}, {full:true} when nothing to trim, or null.
   */
  async computeTrimBox(url) {
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = url; // same-origin (fileadmin) — canvas stays readable
    });
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      return null;
    }
    // Downscale for a fast scan — the result is fractions, so precision is preserved.
    const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    let data;
    try {
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (e) {
      return null; // tainted canvas — bail out gracefully
    }

    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) { hasAlpha = true; break; }
    }
    const bg = [data[0], data[1], data[2]];
    const threshold = 14;
    const isContent = (idx) => {
      if (hasAlpha) {
        return data[idx + 3] > 16;
      }
      return Math.abs(data[idx] - bg[0]) > threshold
        || Math.abs(data[idx + 1] - bg[1]) > threshold
        || Math.abs(data[idx + 2] - bg[2]) > threshold;
    };

    let minX = cw;
    let minY = ch;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (isContent((y * cw + x) * 4)) {
          if (x < minX) { minX = x; }
          if (x > maxX) { maxX = x; }
          if (y < minY) { minY = y; }
          if (y > maxY) { maxY = y; }
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      return null; // blank image
    }
    const bx = minX / cw;
    const by = minY / ch;
    const bw = (maxX - minX + 1) / cw;
    const bh = (maxY - minY + 1) / ch;
    if (bx <= 0.005 && by <= 0.005 && bw >= 0.995 && bh >= 0.995) {
      return { full: true };
    }
    return { x: bx, y: by, width: bw, height: bh };
  }

  bindFocusPicker(box) {
    if (!box) {
      return;
    }
    const pick = (e) => {
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      this.setFocus(x, y);
    };
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      pick(e);
      const move = (ev) => pick(ev);
      const up = () => {
        box.releasePointerCapture(e.pointerId);
        box.removeEventListener("pointermove", move);
        box.removeEventListener("pointerup", up);
      };
      box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up);
    });
  }

  setFocus(x, y) {
    if (!this.selected) {
      return;
    }
    const target = this.imageTarget(this.selected);
    target.focusX = round(x);
    target.focusY = round(y);
    const img = this.selected._el && this.selected._el._img;
    if (img && this.selected.type !== "text") {
      img.style.objectPosition = target.focusX + "% " + target.focusY + "%";
    }
    this.updateFocusDot();
    this.save();
  }

  updateFocusDot() {
    const dot = this.panel && this.panel.querySelector(".hb-focus-dot");
    if (dot && this.selected) {
      const focus = this.effFocus(this.selected);
      dot.style.left = focus.x + "%";
      dot.style.top = focus.y + "%";
    }
  }

  setAnim(key, value) {
    if (!this.selected) {
      return;
    }
    this.selected.anim = this.selected.anim || {};
    if (value === "" || value === null) {
      delete this.selected.anim[key];
    } else {
      this.selected.anim[key] = key === "effect" ? value : parseInt(value, 10) || 0;
    }
    this.save();
  }

  setVisible(visible) {
    if (!this.selected) {
      return;
    }
    const p = this.ensurePlacement(this.selected);
    p.visible = visible;
    this.save();
    this.render();
    if (visible) {
      this.select(this.selected);
    }
  }

  bumpZ(dir) {
    if (!this.selected) {
      return;
    }
    const p = this.ensurePlacement(this.selected);
    p.z = Math.max(1, (p.z || 1) + dir);
    this.save();
    this.render();
    this.select(this.selected);
  }

  deleteSelected() {
    if (!this.selected) {
      return;
    }
    this.layers = this.layers.filter((l) => l !== this.selected);
    this.deselect();
    this.save();
    this.render();
  }

  cleanLayer(l) {
    return {
      id: l.id,
      type: l.type || "image",
      fileUid: l.fileUid || 0,
      text: l.text || "",
      cssClass: l.cssClass || "",
      alt: l.alt || "",
      link: l.link || "",
      fit: l.fit || "fill",
      focusX: l.focusX ?? 50,
      focusY: l.focusY ?? 50,
      overlay: l.overlay ?? 0,
      // Only text layers carry an element; undefined drops out of the JSON for the others.
      tag: l.type === "text" && TEXT_TAGS.includes(l.tag) && l.tag !== "div" ? l.tag : undefined,
      locked: !!l.locked,
      flipH: !!l.flipH,
      flipV: !!l.flipV,
      crop: this.cleanCrop(l.crop),
      anim: l.anim || {},
      placements: this.cleanPlacements(l.placements),
    };
  }

  cleanPlacements(placements) {
    const out = {};
    Object.keys(placements || {}).forEach((bp) => {
      const p = { ...placements[bp] };
      if (p.image) {
        p.image = {
          crop: this.cleanCrop(p.image.crop),
          focusX: round(p.image.focusX ?? 50),
          focusY: round(p.image.focusY ?? 50),
        };
      }
      out[bp] = p;
    });
    return out;
  }

  // Crop area as fractions (0..1) of the source image, or null when the whole image is used.
  cleanCrop(crop) {
    if (!crop || typeof crop !== "object") {
      return null;
    }
    const clamp01 = (v) => Math.max(0, Math.min(1, parseFloat(v) || 0));
    const x = clamp01(crop.x);
    const y = clamp01(crop.y);
    const width = Math.max(0.01, Math.min(1 - x, clamp01(crop.width)));
    const height = Math.max(0.01, Math.min(1 - y, clamp01(crop.height)));
    // A full-frame crop is the same as no crop — normalise it away.
    if (x === 0 && y === 0 && width >= 0.999 && height >= 0.999) {
      return null;
    }
    return { x, y, width, height };
  }

  /** The composition as stored: format version + cleaned layers. */
  serialize() {
    return JSON.stringify({ version: COMPOSITION_VERSION, layers: this.cleanLayers() });
  }

  cleanLayers() {
    return this.layers.map((l) => this.cleanLayer(l));
  }

  writeInput() {
    this.input.value = this.serialize();
    this.input.dispatchEvent(new Event("change", { bubbles: true }));
    this.schedulePreviewRefresh();
    this.scheduleDraftSave();
  }

  save() {
    this.writeInput();
    this.pushHistory();
  }

  // ---- Undo / redo -------------------------------------------------------

  pushHistory() {
    if (this._restoring) {
      return;
    }
    const snap = this.input.value;
    if (this._history[this._histIndex] === snap) {
      return;
    }
    this._history = this._history.slice(0, this._histIndex + 1);
    this._history.push(snap);
    this._histIndex++;
    if (this._history.length > 100) {
      this._history.shift();
      this._histIndex--;
    }
    this.updateHistoryButtons();
  }

  undo() {
    if (this._histIndex > 0) {
      this._histIndex--;
      this.restore(this._history[this._histIndex]);
    }
    this.updateHistoryButtons();
  }

  redo() {
    if (this._histIndex < this._history.length - 1) {
      this._histIndex++;
      this.restore(this._history[this._histIndex]);
    }
    this.updateHistoryButtons();
  }

  // Enable/disable the toolbar buttons to reflect where we are in the history stack.
  updateHistoryButtons() {
    const undoBtn = this.root.querySelector(".t3js-herobuilder-undo");
    const redoBtn = this.root.querySelector(".t3js-herobuilder-redo");
    if (undoBtn) {
      undoBtn.disabled = this._histIndex <= 0;
    }
    if (redoBtn) {
      redoBtn.disabled = this._histIndex >= this._history.length - 1;
    }
  }

  // ---- Crash-recovery draft (localStorage) -------------------------------
  //
  // A lot of editing happens before the TYPO3 form is saved to the DB. Until then
  // both the hidden input and the undo history live only in this browser tab, so a
  // reload/crash/navigation would lose everything. We mirror the *latest* composition
  // per collage into localStorage and offer to restore it on reopen when it is newer
  // than the persisted record. This is a single-snapshot draft, NOT the undo stack.

  draftKey() {
    return this.name ? "herobuilder:draft:" + this.name : null;
  }

  // Normalise for comparison so key-order differences don't cause false "unsaved" hits.
  normalizeJson(str) {
    try {
      return JSON.stringify(JSON.parse(str || "{}"));
    } catch (e) {
      return String(str || "");
    }
  }

  scheduleDraftSave() {
    const key = this.draftKey();
    if (!key) {
      return;
    }
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => this.saveDraft(), 400);
  }

  saveDraft() {
    const key = this.draftKey();
    if (!key) {
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), json: this.input.value }));
    } catch (e) {
      /* storage full or unavailable (private mode) — draft protection is best-effort */
    }
  }

  clearDraft() {
    const key = this.draftKey();
    if (!key) {
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  maybeOfferDraft() {
    const key = this.draftKey();
    if (!key) {
      return;
    }
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      return;
    }
    if (!raw) {
      return;
    }
    let draft;
    try {
      draft = JSON.parse(raw);
    } catch (e) {
      this.clearDraft();
      return;
    }
    if (!draft || typeof draft.json !== "string") {
      this.clearDraft();
      return;
    }
    // Draft already matches what is in the DB → it was persisted, drop it silently.
    if (this.normalizeJson(draft.json) === this.normalizeJson(this._serverValue)) {
      this.clearDraft();
      return;
    }
    this.showDraftBanner(draft);
  }

  showDraftBanner(draft) {
    this.root.querySelector(".herobuilder-draft-banner")?.remove();

    const bar = document.createElement("div");
    bar.className = "herobuilder-draft-banner";

    const when = (() => {
      try {
        return new Date(draft.ts).toLocaleString();
      } catch (e) {
        return "";
      }
    })();

    const msg = document.createElement("span");
    msg.className = "herobuilder-draft-text";
    msg.textContent = this.t("draft.available", "Unsaved changes from {0} were found.").replace("{0}", when);

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn btn-sm btn-primary";
    restore.textContent = this.t("draft.restore", "Restore");
    restore.addEventListener("click", () => {
      this.restore(draft.json);
      // The restored state is a new editable point — make it undoable.
      this.pushHistory();
      bar.remove();
      // Keep the draft: the restored content is still unsaved to the DB.
    });

    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "btn btn-sm btn-default";
    discard.textContent = this.t("draft.discard", "Discard");
    discard.addEventListener("click", () => {
      this.clearDraft();
      bar.remove();
    });

    bar.appendChild(msg);
    bar.appendChild(restore);
    bar.appendChild(discard);
    this.root.insertBefore(bar, this.root.firstChild);
  }

  restore(snap) {
    let parsed;
    try {
      parsed = JSON.parse(snap);
    } catch (e) {
      return;
    }
    this._restoring = true;
    this.layers = Array.isArray(parsed.layers) ? parsed.layers : [];
    this.selected = null;
    if (this.moveable) {
      this.moveable.destroy();
      this.moveable = null;
    }
    this.render();
    this.writeInput();
    this._restoring = false;
  }

  duplicateSelected() {
    if (this.selected) {
      this.duplicateLayer(this.selected);
    }
  }

  duplicateLayer(layer) {
    const clone = JSON.parse(JSON.stringify(this.cleanLayer(layer)));
    clone.id = (clone.type === "text" ? "t" : "l") + this.layers.length + "_" + Date.now();
    Object.values(clone.placements).forEach((p) => {
      p.x = round(Math.min(95, (p.x || 0) + 3));
      p.y = round(Math.min(95, (p.y || 0) + 3));
      p.z = (p.z || 1) + 1;
    });
    const idx = this.layers.indexOf(layer);
    this.layers.splice(idx + 1, 0, clone);
    this.render();
    this.select(clone);
    this.save();
  }

  nudge(key, big) {
    if (!this.selected) {
      return;
    }
    const step = big ? 5 : 1;
    const p = this.ensurePlacement(this.selected);
    if (key === "ArrowLeft") p.x = round((p.x || 0) - step);
    else if (key === "ArrowRight") p.x = round((p.x || 0) + step);
    else if (key === "ArrowUp") p.y = round((p.y || 0) - step);
    else if (key === "ArrowDown") p.y = round((p.y || 0) + step);
    if (this.selected._el) {
      this.applyGeomToEl(this.selected._el, p);
    }
    if (this.moveable) {
      this.moveable.updateRect();
    }
    this.updateGeomFields(p);
    this.save();
  }

  bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (!this.root.contains(document.activeElement)) {
        return;
      }
      const tag = (document.activeElement.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || tag === "select";
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      } else if (ctrl && key === "d") {
        e.preventDefault();
        this.duplicateSelected();
      } else if (ctrl && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        this.zoomBy(1.25);
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        this.zoomBy(1 / 1.25);
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        this.setZoom(1);
      } else if (!inField && e.key === " ") {
        this._spaceDown = true;
        this.root.querySelector(".herobuilder-stage-wrap")?.classList.add("hb-pan-ready");
        e.preventDefault();
      } else if (!inField && (e.key === "Delete" || e.key === "Backspace")) {
        if (this.selected) {
          e.preventDefault();
          this.deleteSelected();
        }
      } else if (!inField && this.selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        this.nudge(e.key, e.shiftKey);
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === " ") {
        this._spaceDown = false;
        this.root.querySelector(".herobuilder-stage-wrap")?.classList.remove("hb-pan-ready");
      }
    });

    // Alt = place freely. Deliberately outside the focus guard of the handler above: during a
    // drag the pointer owns the interaction and focus can sit anywhere. Nothing is
    // preventDefault()ed, so no existing Alt shortcut is swallowed — only an internal flag flips.
    const syncAlt = (e) => this.setAltSuspend(!!e.altKey);
    document.addEventListener("keydown", syncAlt);
    document.addEventListener("keyup", syncAlt);
    // Alt+drag is a window-move gesture on many Linux desktops, so the keydown can be eaten by
    // the window manager before the browser sees it. Mouse events carry the real modifier state
    // regardless — read it there too, in the capture phase so Moveable's own move handler
    // already sees the updated prop within the same event.
    document.addEventListener("mousemove", syncAlt, true);
    // Releasing Alt while the window is not focused never produces a keyup here, which would
    // leave snapping stuck off.
    window.addEventListener("blur", () => this.setAltSuspend(false));
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

// Stable-ish color from a layer id (for text/no-thumbnail chips).
function chipColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return "hsl(" + h + ",55%,55%)";
}
