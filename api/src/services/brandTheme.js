// src/services/brandTheme.js
// Tenant Brand & theme owns colours + typography. Venue website_config
// used to deep-merge stale fonts/bg over the tenant and strip Fraunces/cream
// from the live site while the admin form still looked correct.

export function deepMerge(base, layer) {
  if (!layer || typeof layer !== 'object') return base
  const out = { ...base }
  for (const [k, v] of Object.entries(layer)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v)
    } else if (v !== undefined && v !== null) {
      out[k] = v
    }
  }
  return out
}

/** Merge venue theme under tenant; tenant colors + typography always win. */
export function mergeThemes(tenantTheme, venueTheme) {
  const t = tenantTheme || {}
  const v = venueTheme || {}
  const merged = deepMerge(t, v)
  if (t.colors && typeof t.colors === 'object') {
    merged.colors = deepMerge(v.colors || {}, t.colors)
  }
  if (t.typography && typeof t.typography === 'object') {
    merged.typography = deepMerge(v.typography || {}, t.typography)
  }
  return merged
}
