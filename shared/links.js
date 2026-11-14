// shared/links.js — which links may be opened (14 Nov 2026).
//
// One rule for every address someone typed or a capture or a browser client
// found (Local info items, the page a review was recorded from), used on the
// way in (the API refuses anything else) and on the way out (the admin draws
// a stored link only when it passes, links stored before the rule included).
// Zod's url() alone isn't enough: it takes javascript: and data: addresses.

/** A link that may be opened: an http or https address, else null (never a
 * javascript: or data: link, typed or captured). */
export function webLink(url) {
  const u = String(url ?? '').trim()
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : null
}
