// Script of the static pages (presentation, Pro, privacy): page view, tracked links, Pro survey link.
import { wirePage } from "./stats.js";
import { PRO_FORM_URL, CONTACT_EMAIL } from "./config.js";

// the survey button only appears once a form is configured; until then the fallback text is shown
for (const a of document.querySelectorAll("[data-pro-form]")) {
  if (PRO_FORM_URL) { a.href = PRO_FORM_URL; a.hidden = false; }
}
for (const n of document.querySelectorAll("[data-pro-fallback]")) n.hidden = Boolean(PRO_FORM_URL);
for (const n of document.querySelectorAll("[data-form-section]")) n.hidden = !PRO_FORM_URL;
// contact: the dedicated address when configured, otherwise the GitHub issues link stays
if (CONTACT_EMAIL) {
  for (const a of document.querySelectorAll("[data-contact]")) { a.href = `mailto:${CONTACT_EMAIL}`; a.textContent = CONTACT_EMAIL; a.hidden = false; }
  for (const n of document.querySelectorAll("[data-contact-fallback]")) n.hidden = true;
}
wirePage();
