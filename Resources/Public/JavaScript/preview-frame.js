/**
 * Runs INSIDE the Hero Builder live-preview iframe (loaded as an external, same-origin
 * script so a strict backend CSP `script-src 'self'` does not block it — no inline JS).
 *
 * - Initialises AOS so entrance animations play on load.
 * - Replays them when the editor posts `hb-replay` (once:false + clearing `.aos-animate`
 *   and re-firing the scroll handler so in-view elements animate again).
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

  window.addEventListener("message", function (e) {
    if (e.data !== "hb-replay") {
      return;
    }
    document.querySelectorAll("[data-aos]").forEach(function (el) {
      el.classList.remove("aos-animate");
    });
    // Force reflow, then re-fire AOS's scroll handler to re-trigger in-view elements.
    void document.body.offsetWidth;
    window.dispatchEvent(new Event("scroll"));
  });
})();
