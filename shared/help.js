// shared/help.js
//
// The Help page's subsection anchors, made the same way by the page
// (admin/src/pages/Help.jsx gives each H3 this id) and by Pepper's help
// search (api/src/ai/helpIndex.js links answers to it).

/** "Fill from GloriaFood" -> "fill-from-gloriafood". */
export function helpSlug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
