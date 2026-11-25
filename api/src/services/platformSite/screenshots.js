// src/services/platformSite/screenshots.js
//
// The platform site's screenshots, in api/platform-site/img/: each a WebP at
// two widths (<name>-800.webp, <name>-1600.webp) and a JPEG fallback
// (<name>-1200.jpg), taken from a local copy filled with invented demo data
// (docs/claude/areas/shell.md, "Retaking the screenshots").
//
//   w, h      the shot's shape (for width and height, so the page doesn't jump)
//   alt       what it shows, for people who can't see it
//   caption   one line under it

export const SHOTS = {}

/** The order of the Screenshots page. */
export const GALLERY = Object.keys(SHOTS)
