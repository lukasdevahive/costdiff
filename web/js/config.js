// Site configuration. Edited by `node scripts/configure.mjs` (which also updates the Content-Security-Policy of
// every page), never by hand: an endpoint missing from the CSP would be blocked by the browser.

/** GoatCounter site code ("costdiff" -> https://costdiff.goatcounter.com/count). Empty = statistics off. */
export const GOATCOUNTER = "costdiff";

/** Public form for the Pro interest survey (https://tally.so/r/...). Empty = the survey button is hidden. */
export const PRO_FORM_URL = "";

/** Dedicated contact address shown on the pages (never a personal one). Empty = GitHub issues link. */
export const CONTACT_EMAIL = "lukas.cmpro@gmail.com";

/** Name published as data controller in privacy.html (chosen by the founder). Required before statistics or the survey. */
export const CONTROLLER = "Lukas";

/** Only these hosts send statistics: local development and previews are never counted. */
export const PROD_HOSTS = ["lukasdevahive.github.io"];

/** Public address of the site (canonical URLs, sitemap). Changed only with `configure.mjs --site`. */
export const SITE_URL = "https://lukasdevahive.github.io/costdiff/";
