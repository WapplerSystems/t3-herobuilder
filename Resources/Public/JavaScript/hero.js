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

  /**
   * Replay the entrance animations of a slide each time it is shown.
   *
   * AOS decides "in view" once at page load. The hidden slides count as in view too, so all their
   * layers get `aos-animate` at t=0 and finish invisibly — slide 2+ never animated, slide 1 only
   * on the first load. On `slide` the incoming layers go back to their start state (without a
   * transition, so nothing visibly fades out), on `slid` — once the slide is in place — they get
   * `aos-animate` again and run with their own delay/duration.
   */
  function initEntranceReplay(el) {
    var selector = '[data-aos]:not([data-aos=""])';

    el.addEventListener("slide.bs.carousel", function (e) {
      var slide = e.relatedTarget;
      if (!slide) {
        return;
      }
      var layers = slide.querySelectorAll(selector);
      if (!layers.length) {
        return;
      }
      layers.forEach(function (layer) {
        layer.style.transition = "none";
        layer.classList.remove("aos-animate");
      });
      void slide.offsetWidth; // commit the start state before transitions come back
      layers.forEach(function (layer) {
        layer.style.transition = "";
      });
    });

    el.addEventListener("slid.bs.carousel", function (e) {
      var slide = e.relatedTarget;
      if (!slide) {
        return;
      }
      slide.querySelectorAll(selector).forEach(function (layer) {
        layer.classList.add("aos-animate");
      });
    });
  }

  function init() {
    var aos = !!(window.AOS && typeof window.AOS.init === "function");
    if (aos) {
      // disable: no entrance animations for visitors who asked for reduced motion.
      window.AOS.init({ once: true, duration: 600, easing: "ease-out-cubic", disable: reducedMotion });
    }
    document.querySelectorAll(".herobuilder-carousel").forEach(function (el) {
      if (aos && !reducedMotion) {
        initEntranceReplay(el);
      }
      initCarousel(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
