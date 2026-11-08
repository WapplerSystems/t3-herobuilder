/**
 * Hero Builder record form: show the autoplay-only fields (interval, pause on hover) only while
 * the "Autoplay" toggle is on — switched in the browser, without a form reload.
 *
 * Replaces TCA `onChange => reload` + `displayCond`, whose "Refresh required" dialog submitted
 * (= saved) the record just to reveal two fields. Hidden fields keep their value and are still
 * submitted; the frontend ignores them while autoplay is off.
 *
 * Markers are rendered by the PHP node SliderAutoplayToggle (fieldInformation of slider_autoplay),
 * one per record in the form.
 */
const MARKER = ".t3js-herobuilder-autoplay-toggle";

const fieldGroup = (name) => {
  const input = document.querySelector(`[data-formengine-input-name="${CSS.escape(name)}"]`)
    ?? document.querySelector(`[name="${CSS.escape(name)}"]`);
  const group = input?.closest(".form-group") ?? null;
  // A field outside a palette sits alone in its own fieldset.form-section (with a separator
  // line) — hide that whole section, otherwise an empty band stays behind.
  const section = group?.parentElement;
  if (section?.matches("fieldset.form-section") && section.children.length === 1) {
    return section;
  }
  return group;
};

const initMarker = (marker) => {
  if (marker.dataset.initialized) {
    return;
  }
  const toggleName = marker.dataset.toggleName ?? "";
  const toggle = document.querySelector(
    `input[type="checkbox"][data-formengine-input-name="${CSS.escape(toggleName)}"]`,
  );
  if (!toggle || !toggleName.endsWith("[slider_autoplay]")) {
    return;
  }
  marker.dataset.initialized = "1";
  const prefix = toggleName.slice(0, -"[slider_autoplay]".length);
  const groups = (marker.dataset.dependentFields ?? "")
    .split(",")
    .filter(Boolean)
    .map((field) => fieldGroup(`${prefix}[${field}]`))
    .filter(Boolean);

  const sync = () => {
    groups.forEach((group) => {
      group.hidden = !toggle.checked;
    });
  };
  toggle.addEventListener("change", sync);
  sync();
};

const initAll = () => document.querySelectorAll(MARKER).forEach(initMarker);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAll, { once: true });
} else {
  initAll();
}
