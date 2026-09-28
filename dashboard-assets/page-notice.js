// What a page says when a data file does not arrive.
//
// Every page already catches a failed load and prints the error's own message,
// which is right when the message is a sentence this site wrote ("V11 rankings
// are not in this site build"). It is wrong when the browser wrote it: a
// dropped connection or a blocked request surfaces as "Failed to fetch", "Load
// failed" or "NetworkError", and a reader is left looking at jargon — or, if
// the failure happened inside a panel, at a "Loading…" that never finishes.
//
// This turns those, and only those, into a plain sentence a reader can act on.
// A message the site wrote is passed through untouched.
//
// Written in the same UMD shape as team-directory.js, so the same file is a
// classic script in a page, a side-effect `import` in a module, and a
// `require()`-able core under node.
(function pageNoticeModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ValueContributedPageNotice = api;
})(typeof globalThis === "undefined" ? this : globalThis, function buildPageNotice() {
  "use strict";

  const OFFLINE = "This page could not reach its data. Check your connection and reload the page.";
  // What a browser says when a request never completed. Chrome, Firefox and
  // Safari each word it differently, and none of them is a sentence.
  const BROWSER_WORDING = /^(failed to fetch|load failed|networkerror|network request failed|fetch failed|the internet connection appears to be offline)/i;

  /** A sentence a reader can act on, for anything that failed to load. */
  function readableError(error, fallback = OFFLINE) {
    if (error && error.name === "AbortError") return "";
    const message = String(error?.message ?? error ?? "").trim();
    if (!message) return fallback;
    if (error instanceof TypeError || BROWSER_WORDING.test(message)) return fallback;
    return message;
  }

  return Object.freeze({ readableError, OFFLINE });
});
