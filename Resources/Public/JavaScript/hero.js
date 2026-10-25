/**
 * Frontend runtime for the Hero Builder content element.
 * Initialises AOS entrance animations. Bootstrap 5 carousels self-initialise
 * via the data API (data-bs-ride / control buttons); this script adds the
 * accessibility layer around autoplay:
 *
 * - a pause/play button (WCAG 2.2.2), shown only when Bootstrap's Carousel API is
 *   available — without it the button could not do anything;
 * - no autoplay when the visitor asks for reduced motion (it can still be started);
 * - autoplay pauses while keyboard focus is inside the carousel.
 */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Stop or (re)start autoplay. Bootstrap restarts a paused carousel on its own (mouseleave with
   * pause: "hover", after a slide that started while cycling) as long as `ride` is set, so a
   * visitor's "pause" would not stick. Re-creating the instance with ride off/on is the public-API
   * way to make it stick; data attributes still supply interval, wrap and pause.
   */
  function setAutoplay(el, on) {
    var Carousel = window.bootstrap.Carousel;
    var instance = Carousel.getInstance(el);
    if (instance) {
      instance.pause();
      instance.dispose();
    }
    instance = new Carousel(el, { ride: on ? "carousel" : false });
    if (on) {
      instance.cycle();
    }
    return instance;
  }

  function initCarousel(el) {
    var toggle = el.querySelector(".hb-carousel-toggle");
    if (!toggle || !window.bootstrap || !window.bootstrap.Carousel) {
      return;
    }
    var label = toggle.querySelector(".visually-hidden");
    var playing = !reducedMotion;

    function render() {
      toggle.classList.toggle("is-paused", !playing);
      var text = playing ? toggle.dataset.labelPause : toggle.dataset.labelPlay;
      if (label) {
        label.textContent = text;
      }
      toggle.title = text;
      // Announce slide changes only while the visitor is in control of them.
      var inner = el.querySelector(".carousel-inner");
      if (inner) {
        inner.setAttribute("aria-live", playing ? "off" : "polite");
      }
    }

    setAutoplay(el, playing);
    render();
    toggle.hidden = false;

    toggle.addEventListener("click", function () {
      playing = !playing;
      setAutoplay(el, playing);
      render();
    });

    // Keyboard users: hold still while focus is inside, resume when it leaves (if playing).
    el.addEventListener("focusin", function () {
      var instance = window.bootstrap.Carousel.getInstance(el);
      if (playing && instance) {
        instance.pause();
      }
    });
    el.addEventListener("focusout", function (e) {
      if (playing && !el.contains(e.relatedTarget)) {
        var instance = window.bootstrap.Carousel.getInstance(el);
        if (instance) {
          instance.cycle();
        }
      }
    });
  }

  function init() {
    if (window.AOS && typeof window.AOS.init === "function") {
      // disable: no entrance animations for visitors who asked for reduced motion.
      window.AOS.init({ once: true, duration: 600, easing: "ease-out-cubic", disable: reducedMotion });
    }
    document.querySelectorAll(".herobuilder-carousel").forEach(initCarousel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
