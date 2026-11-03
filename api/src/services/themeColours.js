// The group's brand colours (Brand & theme, tenant_site.theme.colors), with
// the defaults the website and the admin fall back to. A location with its
// own Brand & theme (website_config.use_brand_override) has its own.
//
// Used by /api/me (site_theme: the admin's card headers and colour pickers)
// and by the till's config (theme_colors: the theme an order flow's prompt
// picks its colours from on the till, shared/pos/orderFlows.js promptStyle()).
// Read from the saved settings (what the admin shows), not the website's
// published copy.

export const BRAND_DEFAULTS = Object.freeze({
  primary: '#630812', accent: '#f4a7b9', background: '#ffffff',
  surface: '#f9f6f1', text: '#1a1a1a', muted: '#666666', border: '#e5e7eb',
})

/** A colour code as six lower-case digits (#fff → #ffffff), or null. The website theme takes both lengths. */
function hexOf(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  return /^#[0-9a-f]{3}$/.test(s) ? '#' + [...s.slice(1)].map(ch => ch + ch).join('') : null
}

/** A theme's colours (theme jsonb plus the old primary / secondary columns) over the defaults. */
export function themeColours(theme, primaryColour = null, secondaryColour = null) {
  const c = theme?.colors || {}
  const pick = (...values) => values.map(hexOf).find(Boolean) || null
  return {
    primary: pick(c.primary, primaryColour) || BRAND_DEFAULTS.primary,
    accent: pick(c.accent, secondaryColour) || BRAND_DEFAULTS.accent,
    background: pick(c.background) || BRAND_DEFAULTS.background,
    surface: pick(c.surface) || BRAND_DEFAULTS.surface,
    text: pick(c.text) || BRAND_DEFAULTS.text,
    muted: pick(c.muted) || BRAND_DEFAULTS.muted,
    border: pick(c.border) || BRAND_DEFAULTS.border,
  }
}

/** The brand colours at a location (its own Brand & theme when it has one), or the group's (venueId null). */
export async function brandColours(tx, tenantId, venueId = null) {
  if (venueId) {
    const [own] = await tx`
      SELECT theme, primary_colour, secondary_colour FROM website_config
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND use_brand_override`
    if (own) return themeColours(own.theme, own.primary_colour, own.secondary_colour)
  }
  const [ts] = await tx`SELECT theme, primary_colour, secondary_colour FROM tenant_site WHERE tenant_id = ${tenantId}`
  return ts ? themeColours(ts.theme, ts.primary_colour, ts.secondary_colour) : { ...BRAND_DEFAULTS }
}
