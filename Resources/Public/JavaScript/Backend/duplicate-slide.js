/**
 * "Duplicate slide" in a collage header (see AddDuplicateSlideControl): saves the form together
 * with the DataHandler command to copy the collage right behind itself — one request, pending
 * edits stored first, then copied. The copy starts hidden (TCA hideAtCopy).
 *
 * The command input is removed right after the save call: FormEngine submits synchronously
 * (requestSubmit), so it is already in a sent request — or the submit was cancelled (validation
 * error), and a later plain save must not copy the slide unasked.
 */
import FormEngine from "@typo3/backend/form-engine.js";

if (!window.__herobuilderDuplicateSlide) {
  window.__herobuilderDuplicateSlide = true;

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".t3js-herobuilder-duplicate-slide") : null;
    if (!button) {
      return;
    }
    // The header toggles the record open/closed on click — not for this button.
    event.preventDefault();
    event.stopPropagation();
    const uid = parseInt(button.dataset.uid, 10);
    const table = button.dataset.table;
    const form = button.closest("form") || document.forms.editform;
    if (!uid || !table || !form) {
      return;
    }
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "cmd[" + table + "][" + uid + "][copy]";
    input.value = String(-uid);
    form.appendChild(input);
    try {
      FormEngine.saveDocument();
    } finally {
      input.remove();
    }
  }, true);
}
