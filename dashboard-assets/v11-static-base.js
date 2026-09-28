// The site root, worked out from this module's own URL.
//
// The Experiments worker imports this before the static API shim, so the shim
// resolves "/api/..." against the site rather than against the worker's own
// directory.  Written by scripts/build_v11_site.py.
globalThis.__V11_STATIC_SITE_BASE__ = new URL("../", import.meta.url).href;
