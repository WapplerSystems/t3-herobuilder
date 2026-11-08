/**
 * Page module: open Hero Builder content elements in the full edit form instead of
 * TYPO3 v14's contextual side panel ("contextual record edit").
 *
 * The panel is far too narrow for the canvas editor, so editors always had to click its
 * "fullscreen" button first. Core has no per-CType switch (only the global user setting
 * "contextualRecordEdit"), so this module intercepts the edit triggers of Hero Builder
 * elements only — every other content element keeps the panel.
 *
 * The trigger already carries the full edit URL (`edit-url`, incl. returnUrl back to the
 * element) — the same target as the panel's fullscreen button.
 */
const TRIGGER = "typo3-backend-contextual-record-edit-trigger";
const ELEMENT = ".t3-page-ce";
const MARKER = ".herobuilder-be-preview";

const heroTrigger = (event) => {
  const trigger = event.target instanceof Element ? event.target.closest(TRIGGER) : null;
  if (!trigger || trigger.hasAttribute("disabled")) {
    return null;
  }
  const editUrl = trigger.getAttribute("edit-url");
  const element = trigger.closest(ELEMENT);
  // The marker must belong to this element itself, not to a Hero Builder nested in a container
  // (b13/container children are .t3-page-ce elements inside the container's .t3-page-ce).
  const ownMarker = element
    ? [...element.querySelectorAll(MARKER)].some((marker) => marker.closest(ELEMENT) === element)
    : false;
  if (!editUrl || !ownMarker) {
    return null;
  }
  return editUrl;
};

const openFullEdit = (event, editUrl) => {
  // Capture phase on document runs before the trigger's own listeners.
  event.preventDefault();
  event.stopImmediatePropagation();
  const container = top.TYPO3?.Backend?.ContentContainer;
  if (container) {
    container.setUrl(editUrl);
  } else {
    window.location.href = editUrl;
  }
};

if (!window.__herobuilderFullEdit) {
  window.__herobuilderFullEdit = true;

  document.addEventListener("click", (event) => {
    const editUrl = heroTrigger(event);
    if (editUrl) {
      openFullEdit(event, editUrl);
    }
  }, true);

  // Keyboard: the pseudo button activates on Enter (keydown) and Space (keyup).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const editUrl = heroTrigger(event);
    if (!editUrl) {
      return;
    }
    if (event.key === "Enter") {
      openFullEdit(event, editUrl);
    } else {
      // Space: suppress page scroll, activation follows on keyup.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key !== " ") {
      return;
    }
    const editUrl = heroTrigger(event);
    if (editUrl) {
      openFullEdit(event, editUrl);
    }
  }, true);
}
