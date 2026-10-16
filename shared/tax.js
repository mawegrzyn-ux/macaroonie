// shared/tax.js
//
// Tax rates (migration 170). ONE implementation of "what rate does this dish
// pay here", used by the till, online ordering, the Deliveroo file, the
// admin (Menus > Tax rates check, the Tax boxes) and the AI menu tools.
//
// A tax rate: { id, name, rate, values: { [venueId]: rate }, is_default, is_active }
//   rate is the % everywhere, values the locations that charge another %.
//
// A tax setting, on a menu (menus.tax), a section (menu_sections.tax) and a
// dish (menu_items.tax):
//   { rate: <rate id> | null,
//     rules: [{ venues: [id], streams: [id], types: [id], rate: <rate id> }] }
//   A rule's empty lists mean any. A revenue stream belongs to one location,
//   so a rule names locations or streams, never both.
//
// A sale's context: { venue_id, order_type_id, revenue_stream_id }
//
// How a dish's rate is found:
//   1. the dish's setting, then its section's, then its menu's: the first
//      that gives a rate for the context wins (a dish setting overrides its
//      section, a section its menu)
//   2. within one setting, the rule matching the context most closely wins:
//      a revenue stream counts 4, an order type 2, a location 1, so
//      "Take out at the Bar stream" (6) beats "Bar stream" (4) beats
//      "Take out" (2) beats "London" (1); the setting's own rate counts 0
//   3. nothing set anywhere: the tenant's default rate
// Two rules of one setting that name the same kinds and could both match a
// sale (different rates) aren't allowed (taxProblems()), so there is never
// a tie to break.
//
// Pure: no I/O.

export const RULE_KINDS = ['streams', 'types', 'venues']
export const RULE_WEIGHTS = { streams: 4, types: 2, venues: 1 }

// Used only when a tenant has no tax rates at all (they are seeded for every
// tenant, so in practice never): the UK standard rate, as before migration 170.
export const FALLBACK_PERCENT = 20

const ids = list => [...new Set((Array.isArray(list) ? list : []).filter(v => typeof v === 'string' && v))]

/** A setting in its full shape, whatever was stored (null, {}, missing keys). */
export function normTax(tax) {
  const t = tax && typeof tax === 'object' ? tax : {}
  return {
    rate: typeof t.rate === 'string' && t.rate ? t.rate : null,
    rules: (Array.isArray(t.rules) ? t.rules : [])
      .filter(r => r && typeof r === 'object')
      .map(r => ({ venues: ids(r.venues), streams: ids(r.streams), types: ids(r.types), rate: typeof r.rate === 'string' && r.rate ? r.rate : null })),
  }
}

/** True when the setting sets nothing (inherit everything). */
export function isEmptyTax(tax) {
  const t = normTax(tax)
  return !t.rate && !t.rules.length
}

export function ruleWeight(rule) {
  let w = 0
  for (const k of RULE_KINDS) if ((rule[k] || []).length) w += RULE_WEIGHTS[k]
  return w
}

export function ruleMatches(rule, ctx = {}) {
  if (rule.streams?.length && !rule.streams.includes(ctx.revenue_stream_id)) return false
  if (rule.types?.length && !rule.types.includes(ctx.order_type_id)) return false
  if (rule.venues?.length && !rule.venues.includes(ctx.venue_id)) return false
  return true
}

/**
 * What one setting gives in a context: { rate, rule } (rule null = the
 * setting's own rate), or null when it gives nothing. known(id) says whether
 * a rate id still exists; unknown ids are passed over.
 */
export function settingRate(tax, ctx, known = () => true) {
  const t = normTax(tax)
  let best = null
  let bestW = -1
  for (const r of t.rules) {
    if (!r.rate || !known(r.rate) || !ruleWeight(r) || !ruleMatches(r, ctx)) continue
    const w = ruleWeight(r)
    if (w > bestW) { best = r; bestW = w }
  }
  if (best) return { rate: best.rate, rule: best }
  if (t.rate && known(t.rate)) return { rate: t.rate, rule: null }
  return null
}

export const LEVELS = ['dish', 'section', 'menu']

/**
 * levels: [dishTax, sectionTax, menuTax] (any may be missing).
 * Returns { rate_id, from: 'dish' | 'section' | 'menu' | 'default', rule }.
 */
export function resolveTaxRateId(levels, ctx, { rates = [], defaultRateId = null } = {}) {
  const byId = rateMap(rates)
  const known = id => !rates.length || byId.has(id)
  const list = Array.isArray(levels) ? levels : []
  for (let i = 0; i < LEVELS.length; i++) {
    const hit = settingRate(list[i], ctx, known)
    if (hit) return { rate_id: hit.rate, from: LEVELS[i], rule: hit.rule }
  }
  return { rate_id: defaultRateId || defaultRate(rates)?.id || null, from: 'default', rule: null }
}

const mapCache = new WeakMap()
function rateMap(rates) {
  let m = mapCache.get(rates)
  if (!m) { m = new Map(rates.map(r => [r.id, r])); mapCache.set(rates, m) }
  return m
}

/** The tenant's default rate: the one marked default, else the first active one. */
export function defaultRate(rates = []) {
  return rates.find(r => r.is_default && r.is_active !== false) || rates.find(r => r.is_active !== false) || null
}

/** A rate's % at a location. */
export function ratePercent(rate, venueId) {
  if (!rate) return FALLBACK_PERCENT
  const v = venueId && rate.values ? rate.values[venueId] : undefined
  return Number(v ?? rate.rate) || 0
}

/**
 * The tax for a dish in a context: { tax_rate_id, vat_rate, name, from }.
 * levels as resolveTaxRateId(); rates the tenant's rates (inactive ones too,
 * so old settings still resolve).
 */
export function taxFor(levels, ctx, rates = []) {
  const r = resolveTaxRateId(levels, ctx, { rates })
  const rate = r.rate_id ? rateMap(rates).get(r.rate_id) : null
  return {
    tax_rate_id: rate ? rate.id : null,
    vat_rate: ratePercent(rate, ctx?.venue_id),
    name: rate ? rate.name : null,
    from: r.from,
    rule: r.rule,
  }
}

/** The tax for an item not on any menu (an open item): the default rate. */
export function defaultTaxFor(ctx, rates = []) {
  return taxFor([], ctx, rates)
}

// ── Checking a setting ───────────────────────────────────────────

const overlaps = (a, b) => !a.length || !b.length || a.some(x => b.includes(x))

/**
 * What's wrong with a setting, as sentences (empty = fine). lookups (all
 * optional): { rates: [rate], types: [{ id }], streams: [{ id, venue_id }],
 * venues: [{ id }] } — when given, ids not in them are problems.
 */
export function taxProblems(tax, lookups = {}) {
  const t = normTax(tax)
  const out = []
  const has = (list, id) => !list || list.some(x => x.id === id)
  if (t.rate && !has(lookups.rates, t.rate)) out.push('The tax rate wasn\'t found')
  t.rules.forEach((r, i) => {
    const n = 'Exception ' + (i + 1)
    if (!r.rate) out.push(n + ' has no tax rate')
    else if (!has(lookups.rates, r.rate)) out.push(n + ': the tax rate wasn\'t found')
    if (!ruleWeight(r)) out.push(n + ' needs an order type, a location or a revenue stream')
    if (r.venues.length && r.streams.length) out.push(n + ' names locations and revenue streams: pick one or the other')
    if (r.types.some(id => !has(lookups.types, id))) out.push(n + ': an order type wasn\'t found')
    if (r.streams.some(id => !has(lookups.streams, id))) out.push(n + ': a revenue stream wasn\'t found')
    if (r.venues.some(id => !has(lookups.venues, id))) out.push(n + ': a location wasn\'t found')
  })
  // Same kinds named and every named kind shares a value: both could match
  // one sale with the same weight. Fine only when they give the same rate.
  for (let i = 0; i < t.rules.length; i++) {
    for (let j = i + 1; j < t.rules.length; j++) {
      const a = t.rules[i], b = t.rules[j]
      if (!ruleWeight(a) || ruleWeight(a) !== ruleWeight(b) || a.rate === b.rate) continue
      if (RULE_KINDS.every(k => !a[k].length || overlaps(a[k], b[k]))) {
        out.push('Exceptions ' + (i + 1) + ' and ' + (j + 1) + ' can both apply to the same sale with different rates')
      }
    }
  }
  return out
}

/** A setting cleaned for saving: blank rules dropped, lists deduplicated. */
export function cleanTax(tax) {
  const t = normTax(tax)
  return { rate: t.rate, rules: t.rules.filter(r => r.rate || ruleWeight(r)) }
}

/** Words for a rule's condition, e.g. "Take out, Delivery at Bar". names: { types, streams, venues } id -> name. */
export function ruleText(rule, names = {}) {
  const list = (key, k) => (rule[k] || []).map(id => names[key]?.[id] || 'Removed').join(', ')
  const parts = []
  if (rule.types?.length) parts.push(list('types', 'types'))
  if (rule.streams?.length) parts.push((parts.length ? 'at ' : '') + list('streams', 'streams'))
  if (rule.venues?.length) parts.push((parts.length ? 'at ' : '') + list('venues', 'venues'))
  return parts.join(' ') || 'Any sale'
}
