import AjaxRequest from "@typo3/core/ajax/ajax-request.js";
import Modal from "@typo3/backend/modal.js";

const AOS_EFFECTS = [
  "", "fade-up", "fade-down", "fade-left", "fade-right",
  "zoom-in", "zoom-out", "flip-left", "flip-up", "slide-up",
];

// Per-layer image scaling (CSS object-fit). "fill" stretches (legacy default); "cover"/"contain"
// keep the aspect ratio — cover for full-bleed backgrounds, contain for logos/text.
// Labels are resolved via i18n (this.t("fit.<value>")) at render time.
const FIT_MODES = ["fill", "cover", "contain"];

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
};

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
    this.classes = Array.isArray(init.classes) ? init.classes : [];
    this.labels = init.labels || {};
    this.uid = init.uid || 0;
    this.pid = init.pid || 0;
    this.previewUrl = window.TYPO3?.settings?.ajaxUrls?.herobuilder_preview || null;
    this.previewOpen = false;
    this.zoom = 1;
    this._spaceDown = false;
    this.linkWizardUrl = init.linkWizardUrl || null;
    this.linkProxy = init.linkProxyName ? this.root.querySelector('[data-formengine-input-name="' + init.linkProxyName + '"]') : null;
    this.moveableUrl = init.moveableUrl || null;
    this.name = init.name || "";
    this.activeBp = this.breakpoints.includes("lg") ? "lg" : this.breakpoints[0];

    this.stageEl = this.root.querySelector(".t3js-herobuilder-stage");
    this.input = this.root.querySelector(".t3js-herobuilder-input");
    this.panel = null;
    this.selected = null;
    this.moveable = null;
    this.fileInfo = {};

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

    // Undo/redo history (JSON snapshots of the serialized layers).
    this._history = [];
    this._histIndex = -1;
    this._restoring = false;

    this.stageEl.tabIndex = 0; // focusable so keyboard shortcuts scope to the editor

    this.buildZoomBadge();
    this.buildLayerList();
    this.buildPreview();
    this.buildPanel();
    this.bindToolbar();
    this.bindProps();
    this.bindStageNav();
    this.bindKeyboard();
    this.listenForAssetInserts();
    this.init();
  }

  async init() {
    await this.ensureMoveable();
    await this.loadFileInfo();
    this.render();
    // Seed the history with the initial state.
    this._history = [JSON.stringify({ layers: this.cleanLayers() })];
    this._histIndex = 0;
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
    this.root.querySelectorAll(".t3js-herobuilder-tab").forEach((btn) => {
      btn.addEventListener("click", () => this.setBreakpoint(btn.dataset.breakpoint));
    });
    this.root.querySelector(".t3js-herobuilder-add")?.addEventListener("click", () => this.addImage());
    this.root.querySelector(".t3js-herobuilder-add-text")?.addEventListener("click", () => this.addTextLayer());
    this.root.querySelector(".t3js-herobuilder-add-button")?.addEventListener("click", () => this.addButtonLayer());
    this.root.querySelector(".t3js-herobuilder-copy")?.addEventListener("click", () => this.copyToAll());
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

  setBreakpoint(bp) {
    if (!this.breakpoints.includes(bp)) {
      return;
    }
    this.activeBp = bp;
    this.deselect();
    this.render();
    this.updatePreviewWidth();
  }

  highlightActiveTab() {
    this.root.querySelectorAll(".t3js-herobuilder-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.breakpoint === this.activeBp);
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

  buildZoomBadge() {
    // The zoom level lives as a badge inside the stage (bottom-right); click toggles
    // fit-to-width ↔ 100%. Ctrl+wheel and Ctrl +/-/0 still change zoom.
    this.zoomBadge = this.root.querySelector(".herobuilder-zoom-badge");
    if (this.zoomBadge) {
      this.zoomBadge.title = this.t("zoom.fit", "Fit to width") + " / " + this.t("zoom.reset", "100%");
      this.zoomBadge.addEventListener("click", () => {
        this.setZoom(Math.abs(this.zoom - 1) < 0.01 ? this.fitZoomValue() : 1);
      });
    }
  }

  scaledStageWidth() {
    const w = this.stageWidth(this.activeBp);
    return w ? w * this.zoom : 0;
  }

  applyStageSize() {
    const w = this.scaledStageWidth();
    this.stageEl.style.width = w ? w + "px" : "100%";
    if (this.zoomBadge) {
      this.zoomBadge.textContent = Math.round(this.zoom * 100) + "%";
    }
  }

  setZoom(z) {
    this.zoom = Math.min(6, Math.max(0.1, z));
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
    return wrap && w ? (wrap.clientWidth - 8) / w : 1;
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
      const any = Object.values(layer.placements)[0];
      layer.placements[this.activeBp] = any
        ? { ...any }
        : { x: 20, y: 20, w: 40, h: 25, rot: 0, z: 1, visible: true };
    }
    return layer.placements[this.activeBp];
  }

  withSelectedPlacement(fn) {
    if (!this.selected) {
      return;
    }
    fn(this.ensurePlacement(this.selected), this.selected);
    this.save();
    this.render();
    this.select(this.selected);
  }

  align(mode) {
    this.withSelectedPlacement((p) => {
      const w = p.w ?? 0;
      const h = p.h ?? 0;
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
    return layer.placements[this.activeBp] || null;
  }

  render() {
    this.highlightActiveTab();
    this.stageEl.style.aspectRatio = this.stageRatioCss(this.activeBp);
    // Render the stage at the breakpoint's real device width × zoom. Because layers are
    // %-based, zooming just resizes the stage box — geometry (offset/clientWidth → %) and
    // Moveable stay correct without any CSS transform.
    this.applyStageSize();
    this.stageEl.querySelectorAll(".herobuilder-layer").forEach((el) => el.remove());

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

    this.updatePanel();
  }

  createLayerEl(layer, p) {
    const isText = layer.type === "text" || layer.type === "button";
    const info = isText ? null : this.fileInfo[layer.fileUid];
    const el = document.createElement(info && info.url ? "img" : "div");
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
    if (info && info.url) {
      el.src = info.url;
      el.alt = layer.alt || info.alt || "";
      el.draggable = false;
      el.style.objectFit = layer.fit || "fill";
      el.style.objectPosition = (layer.focusX ?? 50) + "% " + (layer.focusY ?? 50) + "%";
    } else if (isText) {
      // Text layer: show the text; apply the chosen classes so backend Bootstrap gives a
      // close-to-frontend preview (unknown/FE-only classes are simply inert here).
      el.textContent = layer.text || (layer.type === "button" ? "Button" : "Text");
      const typeClass = layer.type === "button" ? "herobuilder-layer-button" : "herobuilder-layer-text";
      el.className = "herobuilder-layer " + typeClass + (layer.cssClass ? " " + layer.cssClass : "");
      el.style.height = (p.h ?? 15) + "%";
      el.style.boxSizing = "border-box";
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.justifyContent = "center";
      el.style.overflow = "hidden";
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
    this.moveable = new window.Moveable(this.stageEl, {
      target: layer._el,
      draggable: true,
      resizable: true,
      rotatable: true,
      keepRatio: true,
      origin: false,
      // Snapping to stage edges/center and to other layers, with visible guide lines.
      snappable: true,
      snapThreshold: 6,
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
      })
      .on("resize", ({ target, width, height, drag }) => {
        target.style.width = width + "px";
        target.style.height = height + "px";
        target.style.left = drag.left + "px";
        target.style.top = drag.top + "px";
      })
      .on("rotate", ({ target, transform }) => {
        target.style.transform = transform;
      })
      .on("renderEnd", () => this.commitGeometry(layer));
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
    const p = this.placementFor(layer) || {};
    p.x = round((el.offsetLeft / sw) * 100);
    p.y = round((el.offsetTop / sh) * 100);
    p.w = round((el.offsetWidth / sw) * 100);
    p.h = round((el.offsetHeight / sh) * 100);
    p.rot = round(this.readRotation(el));
    p.z = p.z || 1;
    p.visible = p.visible !== false;
    layer.placements[this.activeBp] = p;
    el.style.left = p.x + "%";
    el.style.top = p.y + "%";
    el.style.width = p.w + "%";
    el.style.height = p.h + "%";
    if (this.moveable) {
      this.moveable.updateRect();
    }
    this.updateGeomFields(p);
    this.save();
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
    layer.placements[this.activeBp] = { x: 20, y: 40, w: 60, h: 15, rot: 0, z: maxZ + 1, visible: true };
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
    layer.placements[this.activeBp] = { x: 20, y: 55, w: 20, h: 8, rot: 0, z: maxZ + 1, visible: true };
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
            layer.placements[bp] = { ...src };
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

    const frame = document.createElement("iframe");
    frame.className = "herobuilder-preview-frame";
    frame.setAttribute("title", this.t("button.preview", "Live preview"));
    wrap.appendChild(frame);

    // Mount below the stage in the center canvas column.
    (this.root.querySelector(".herobuilder-canvas") || this.layerList).appendChild(wrap);
    this.previewWrap = wrap;
    this.previewFrame = frame;
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
    this.previewFrame.style.width = w ? w + "px" : "100%";
  }

  schedulePreviewRefresh() {
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
      });
      const html = await response.raw().text();
      this.previewFrame.srcdoc = html;
    } catch (e) {
      // Leave the last successful preview in place on transient errors.
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
    if (layer.type === "text") {
      const t = (layer.text || "").trim();
      return t ? (t.length > 30 ? t.slice(0, 30) + "…" : t) : "Text";
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
          '<button type="button" class="hb-ll-sel" data-act="select">' +
          this.layerChip(layer) +
          '<span class="hb-ll-name">' + escapeHtml(this.layerLabel(layer)) + "</span></button>" +
          '<button type="button" class="hb-ll-btn hb-ll-vis" data-act="vis" title="' +
          escapeAttr(this.t("list.toggleVisible", "Toggle visibility")) +
          '">' + (hidden ? ICON.eyeOff : ICON.eye) + "</button>" +
          '<button type="button" class="hb-ll-btn hb-ll-lock" data-act="lock" title="' +
          escapeAttr(this.t("list.toggleLock", "Lock / unlock")) +
          '">' + (locked ? ICON.lock : ICON.unlock) + "</button>" +
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

    const classControl = this.classes.length
      ? '<div class="hb-class-chips">' +
        this.classes
          .map((c) => '<button type="button" class="hb-class-chip" data-value="' + escapeAttr(c.value) + '">' + escapeHtml(c.label) + "</button>")
          .join("") +
        "</div>"
      : '<em class="text-body-secondary">' +
        escapeHtml(this.t("panel.noClasses", "No classes configured (page TSconfig tx_herobuilder.layerClasses)")) +
        "</em>";
    const animNone = escapeHtml(this.t("panel.animNone", "— none —"));
    const alignBtn = (mode, icon, label) =>
      '<button type="button" class="hb-align btn btn-sm btn-default" data-align="' + mode + '" title="' + escapeAttr(label) + '">' + icon + "</button>";

    panel.innerHTML =
      // ---- Transform tab ----
      '<div class="herobuilder-tabpane active" data-tab="transform">' +
      '<div class="herobuilder-panel-row hb-row-geom"><label>' + escapeHtml(this.t("panel.geometry", "Position / size (%)")) + "</label>" +
      '<div class="hb-geom">' +
      '<label>X<input type="number" class="hb-geom-x form-control form-control-sm" step="0.5"></label>' +
      '<label>Y<input type="number" class="hb-geom-y form-control form-control-sm" step="0.5"></label>' +
      '<label>W<input type="number" class="hb-geom-w form-control form-control-sm" step="0.5"></label>' +
      '<label>H<input type="number" class="hb-geom-h form-control form-control-sm" step="0.5"></label>' +
      '<label>°<input type="number" class="hb-geom-rot form-control form-control-sm" step="1"></label>' +
      "</div></div>" +
      '<div class="herobuilder-panel-row"><label>' + escapeHtml(this.t("panel.align", "Align")) + "</label>" +
      '<div class="hb-align-row">' +
      alignBtn("left", ICON.alignLeft, this.t("ctx.alignLeft", "Left")) +
      alignBtn("centerH", ICON.alignCenterH, this.t("ctx.alignCenterH", "Center horizontally")) +
      alignBtn("right", ICON.alignRight, this.t("ctx.alignRight", "Right")) +
      alignBtn("middle", ICON.alignV, this.t("panel.alignV", "Center vertically")) +
      "</div></div>" +
      '<div class="herobuilder-panel-row"><button type="button" class="t3js-herobuilder-copy btn btn-sm btn-default hb-copyall">' +
      escapeHtml(this.t("button.copyToAll", "Copy position to all breakpoints")) + "</button></div>" +
      '<div class="herobuilder-panel-row"><button type="button" class="hb-delete btn btn-sm btn-danger">' +
      escapeHtml(this.t("panel.deleteLayer", "Delete layer")) + "</button></div>" +
      "</div>" +
      // ---- Style tab ----
      '<div class="herobuilder-tabpane" data-tab="style">' +
      '<div class="herobuilder-panel-row hb-row-text"><label>' + escapeHtml(this.t("panel.text", "Text")) + "</label>" +
      '<textarea class="hb-text form-control form-control-sm" rows="2"></textarea></div>' +
      '<div class="herobuilder-panel-row hb-row-link"><label>' + escapeHtml(this.t("panel.link", "Link")) + "</label>" +
      '<div class="hb-link"><code class="hb-link-value">—</code>' +
      '<div class="hb-link-btns">' +
      '<button type="button" class="hb-link-choose btn btn-sm btn-default">' + escapeHtml(this.t("link.choose", "Choose link")) + "</button>" +
      '<button type="button" class="hb-link-clear btn btn-sm btn-default" hidden>' + escapeHtml(this.t("link.remove", "Remove")) + "</button>" +
      "</div></div></div>" +
      '<div class="herobuilder-panel-row hb-row-classes"><label>' + escapeHtml(this.t("panel.classes", "Classes")) + "</label>" +
      classControl + "</div>" +
      '<div class="herobuilder-panel-row hb-row-fit"><label>' + escapeHtml(this.t("panel.fit", "Fit (scaling)")) + "</label>" +
      '<select class="hb-fit form-select form-select-sm">' +
      FIT_MODES.map((f) => '<option value="' + f + '">' + escapeHtml(this.t("fit." + f, f)) + "</option>").join("") +
      "</select></div>" +
      '<div class="herobuilder-panel-row hb-row-focus"><label>' + escapeHtml(this.t("panel.focus", "Focus point (cover/contain)")) + "</label>" +
      '<div class="hb-focus"><img class="hb-focus-img" alt=""><span class="hb-focus-dot"></span></div></div>' +
      '<div class="herobuilder-panel-row hb-row-overlay"><label>' + escapeHtml(this.t("panel.overlay", "Darkening behind text (%)")) + "</label>" +
      '<div class="hb-overlay-ctl"><input type="range" class="hb-overlay" min="0" max="100" step="5"><span class="hb-overlay-val">0%</span></div></div>' +
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
    panel.querySelector(".hb-overlay").addEventListener("input", (e) => this.setOverlay(e.target.value));
    panel.querySelectorAll(".hb-class-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        chip.classList.toggle("active");
        this.setClasses();
      })
    );
    this.bindFocusPicker(panel.querySelector(".hb-focus"));
    [
      ["x", ".hb-geom-x"], ["y", ".hb-geom-y"], ["w", ".hb-geom-w"],
      ["h", ".hb-geom-h"], ["rot", ".hb-geom-rot"],
    ].forEach(([field, sel]) => {
      panel.querySelector(sel).addEventListener("input", (e) => this.setGeom(field, e.target.value));
    });
    panel.querySelectorAll(".hb-align").forEach((b) => b.addEventListener("click", () => this.align(b.dataset.align)));
    panel.querySelector(".hb-anim-replay").addEventListener("click", () => this.replayPreview());
    panel.querySelector(".hb-link-choose").addEventListener("click", () => this.openLinkBrowser());
    panel.querySelector(".hb-link-clear").addEventListener("click", () => this.setLink(""));
    panel.querySelector(".hb-delete").addEventListener("click", () => this.deleteSelected());
    // .t3js-herobuilder-copy is wired in bindToolbar().
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
    this.panel.querySelector(".hb-row-fit").hidden = isText;
    this.panel.querySelector(".hb-text").value = this.selected.text || "";
    // Link row: shown for all layer types (any layer may carry a TYPO3 link).
    this.panel.querySelector(".hb-link-value").textContent = this.selected.link || "—";
    this.panel.querySelector(".hb-link-clear").hidden = !this.selected.link;
    const ov = this.selected.overlay || 0;
    this.panel.querySelector(".hb-overlay").value = ov;
    this.panel.querySelector(".hb-overlay-val").textContent = ov + "%";
    const selected = (this.selected.cssClass || "").split(/\s+/).filter(Boolean);
    this.panel.querySelectorAll(".hb-class-chip").forEach((chip) => {
      chip.classList.toggle("active", selected.includes(chip.dataset.value));
    });
    this.panel.querySelector(".hb-anim-effect").value = anim.effect || "";
    this.panel.querySelector(".hb-anim-delay").value = anim.delay || "";
    this.panel.querySelector(".hb-anim-duration").value = anim.duration || "";
    this.panel.querySelector(".hb-fit").value = this.selected.fit || "fill";
    this.updateGeomFields(p);

    // Focus point picker — only for image layers with a resolvable file.
    const info = isText ? null : this.fileInfo[this.selected.fileUid];
    const focusRow = this.panel.querySelector(".hb-row-focus");
    if (info && info.url) {
      focusRow.hidden = false;
      this.panel.querySelector(".hb-focus-img").src = info.url;
      this.updateFocusDot();
    } else {
      focusRow.hidden = true;
    }
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
        el.value = p[field] ?? (field === "rot" ? 0 : "");
      }
    });
  }

  setGeom(field, value) {
    if (!this.selected) {
      return;
    }
    const p = this.ensurePlacement(this.selected);
    p[field] = round(parseFloat(value) || 0);
    if (this.selected._el) {
      this.applyGeomToEl(this.selected._el, p);
    }
    if (this.moveable) {
      this.moveable.updateRect();
    }
    this.renderLayerList();
    this.save();
  }

  applyGeomToEl(el, p) {
    el.style.left = (p.x ?? 0) + "%";
    el.style.top = (p.y ?? 0) + "%";
    el.style.width = (p.w ?? 0) + "%";
    if (p.h != null) {
      el.style.height = p.h + "%";
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
    this.renderLayerList();
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
    this.selected.focusX = round(x);
    this.selected.focusY = round(y);
    if (this.selected._el && this.selected.type !== "text") {
      this.selected._el.style.objectPosition = this.selected.focusX + "% " + this.selected.focusY + "%";
    }
    this.updateFocusDot();
    this.save();
  }

  updateFocusDot() {
    const dot = this.panel && this.panel.querySelector(".hb-focus-dot");
    if (dot && this.selected) {
      dot.style.left = (this.selected.focusX ?? 50) + "%";
      dot.style.top = (this.selected.focusY ?? 50) + "%";
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
    const p = this.placementFor(this.selected) || {};
    p.visible = visible;
    this.selected.placements[this.activeBp] = p;
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
    const p = this.placementFor(this.selected) || {};
    p.z = Math.max(1, (p.z || 1) + dir);
    this.selected.placements[this.activeBp] = p;
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
      locked: !!l.locked,
      anim: l.anim || {},
      placements: l.placements || {},
    };
  }

  cleanLayers() {
    return this.layers.map((l) => this.cleanLayer(l));
  }

  writeInput() {
    this.input.value = JSON.stringify({ layers: this.cleanLayers() });
    this.input.dispatchEvent(new Event("change", { bubbles: true }));
    this.schedulePreviewRefresh();
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
  }

  undo() {
    if (this._histIndex > 0) {
      this._histIndex--;
      this.restore(this._history[this._histIndex]);
    }
  }

  redo() {
    if (this._histIndex < this._history.length - 1) {
      this._histIndex++;
      this.restore(this._history[this._histIndex]);
    }
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
