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

/**
 * A link typed into an editor (the website's rich text, email templates),
 * as it is stored, or null when it isn't one: a web address (https:// is
 * put in front of a bare one such as example.com/menu), and as asked
 * mailto: / tel: links, a path on the site (/menu) and a template
 * placeholder ({{manage_link}}). Never javascript: or data:.
 */
export function typedLink(text, { mail = true, paths = true, tokens = false } = {}) {
  const u = String(text ?? '').trim()
  const token = tokens && /^\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}$/i.exec(u)
  if (token) return '{{' + token[1] + '}}'
  if (!u || /\s/.test(u)) return null
  if (webLink(u)) return u
  if (mail && /^(mailto|tel):[^\s:]+/i.test(u) && !/^(mailto|tel):\/\//i.test(u)) return u
  if (paths && /^\/(?!\/)[^\s]*$/.test(u)) return u
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#][^\s]*)?$/i.test(u)) return 'https://' + u
  return null
}
