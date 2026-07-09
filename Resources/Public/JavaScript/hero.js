/**
 * Frontend runtime for the Hero Builder content element.
 * Initialises AOS entrance animations. Bootstrap 5 carousels self-initialise
 * via the data API (data-bs-ride / control buttons).
 */
(function () {
  "use strict";

  function init() {
    if (window.AOS && typeof window.AOS.init === "function") {
      window.AOS.init({ once: true, duration: 600, easing: "ease-out-cubic" });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
