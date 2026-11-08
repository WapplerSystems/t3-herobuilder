/**
 * Runs INSIDE the Hero Builder live-preview iframe (loaded as an external, same-origin
 * script so a strict backend CSP `script-src 'self'` does not block it — no inline JS).
 *
 * - Initialises AOS so entrance animations play on load.
 * - Replays them when the editor posts `hb-replay` — all layers, or a single layer by its index
 *   among the rendered layers (see replay()).
 */
(function () {
  "use strict";

  // Inject the scoped composition CSS from the JSON data island via a constructable
  // stylesheet. CSSOM-inserted styles are NOT governed by CSP style-src, so this works
  // even under a strict backend CSP without 'unsafe-inline'.
  try {
    var node = document.getElementById("hb-preview-css");
    var css = node ? JSON.parse(node.textContent || '""') : "";
    if (css) {
      if ("adoptedStyleSheets" in document && typeof CSSStyleSheet === "function") {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
      } else {
        var styleEl = document.createElement("style");
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
      }
    }
  } catch (err) {
    /* preview keeps working with the linked stylesheets even if injection fails */
  }

  if (window.AOS && typeof window.AOS.init === "function") {
    window.AOS.init({ once: false, duration: 600, easing: "ease-out-cubic" });
  }

  /** Set elements to a state without animating there (transition off, commit, transition back). */
  function jump(nodes, animated) {
    nodes.forEach(function (el) {
      el.style.transition = "none";
      el.classList.toggle("aos-animate", animated);
    });
    void document.body.offsetWidth;
    nodes.forEach(function (el) {
      el.style.transition = "";
    });
  }

  /**
   * Replay entrance animations. `layer` = index of the layer among the rendered layers (its
   * element carries the class `<scope>-l<index>`, see CompositionProcessor; canvas.js
   * renderedLayerIndex()) — then only that layer
   * plays and the others are shown at rest; -1 / missing = all layers.
   *
   * The class is re-added two frames later by us — not via AOS's scroll handler, which re-added
   * it in the same tick so the transition reversed before anything was visible.
   */
  function replay(layer) {
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-aos]:not([data-aos=""])'));
    var targets = all;
    if (typeof layer === "number" && layer >= 0) {
      var slide = document.querySelector(".herobuilder-slide");
      var scope = slide && Array.prototype.find.call(slide.classList, function (c) {
        return /^hb-\d+$/.test(c);
      });
      var own = scope ? document.querySelector("." + scope + "-l" + layer) : null;
      targets = own && all.indexOf(own) !== -1 ? [own] : [];
      jump(all.filter(function (el) { return targets.indexOf(el) === -1; }), true);
    }
    if (!targets.length) {
      return;
    }
    jump(targets, false);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        targets.forEach(function (el) {
          el.classList.add("aos-animate");
        });
      });
    });
  }

  window.addEventListener("message", function (e) {
    // Same-origin editor only (the preview is a srcdoc frame of the backend page).
    if (e.source !== window.parent) {
      return;
    }
    if (e.data === "hb-replay") {
      replay(-1);
    } else if (e.data && e.data.type === "hb-replay") {
      replay(e.data.layer);
    }
  });
})();
