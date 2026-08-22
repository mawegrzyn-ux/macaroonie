// BIMI logo: SVG Tiny 1.2 portable/secure. Mail clients (Yahoo, Fastmail,
// some Apple/Gmail) fetch this over HTTPS from the From-domain's BIMI TXT
// record. Gmail and Apple Mail also require a Verified Mark Certificate
// (VMC) — we host the SVG; the operator buys the VMC separately.

const MAX_BYTES = 64 * 1024

export function normalizeBimiSvg(raw) {
  if (raw == null) return null
  const svg = String(raw).trim()
  if (!svg) return null
  if (svg.length > MAX_BYTES) {
    const err = new Error('BIMI SVG must be 64 KB or smaller')
    err.statusCode = 422
    throw err
  }
  if (!/<svg[\s>]/i.test(svg)) {
    const err = new Error('File is not an SVG')
    err.statusCode = 422
    throw err
  }
  if (/<script[\s>]|onload\s*=|onerror\s*=|<foreignObject|<iframe[\s>]|javascript:/i.test(svg)) {
    const err = new Error('SVG contains disallowed content (scripts, event handlers, or embeds)')
    err.statusCode = 422
    throw err
  }
  let out = svg
  if (!/baseProfile\s*=/i.test(out)) {
    out = out.replace(/<svg\b/i, '<svg version="1.2" baseProfile="tiny-ps"')
  }
  if (!/<title[\s>]/i.test(out)) {
    out = out.replace(/<svg([^>]*)>/i, '<svg$1><title>Brand</title>')
  }
  return out
}
