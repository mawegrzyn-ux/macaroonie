// shared/deliveroo.js
//
// Updating a Deliveroo menu bulk-management file (Hub, Menu Manager, Bulk
// management: the CSV with item_id, item_name, item_description,
// delivery_price, tax_rate, allergens, calories, ...) from our own menus.
// Used by the admin page (live review) and the API (export). Pure, no DB.
//
//   matchDish(name, dishes)        best dish for a Deliveroo item name, with a score
//   dishValues(dish, ctx)          the Deliveroo values our menu gives for a dish
//   buildRow(row, opts)            one file row with our values filled in,
//                                  what changed and what's wrong
//   priceRule(pence, pct, to, mode) uplift + rounding
//   toCsv(columns, rows, eol)      the file again, same columns and order
//
// Values are kept as the strings Deliveroo uses: prices in pounds without
// trailing zeros ("13.5"), tax rate "20", allergens "eggs,milk".

export const FILL_FIELDS = [
  { key: 'delivery_price',      label: 'Delivery price', def: true },
  { key: 'tax_rate',            label: 'VAT rate',       def: true },
  { key: 'item_description',    label: 'Description',    def: true },
  { key: 'allergens',           label: 'Allergens',      def: true },
  { key: 'calories',            label: 'Calories',       def: true },
  { key: 'item_name',           label: 'Name',           def: false },
  { key: 'instore_price',       label: 'In-store price', def: false, hint: 'The dish\'s menu price, without the uplift.' },
  { key: 'dietary_information', label: 'Dietary',        def: false },
  { key: 'energy_kcal',         label: 'Energy (kcal)',  def: false, hint: 'Deliveroo\'s nutrition field; filled with the same calories.' },
]
export const FIELD_KEYS = FILL_FIELDS.map(f => f.key)
export const defaultFill = () => Object.fromEntries(FILL_FIELDS.map(f => [f.key, f.def]))

export const TAX_RATES = ['0', '5', '12.5', '20']
export const BOOLEAN_COLUMNS = ['hfss', 'age_restricted', 'returnable']
export const REQUIRED_COLUMNS = ['item_id', 'item_name', 'delivery_price']

// Deliveroo's allergen codes for the UK (Menu API guide). Offered as
// suggestions; anything else typed is kept but flagged.
export const DELIVEROO_ALLERGENS = [
  'celery', 'crustaceans', 'eggs', 'fish',
  'gluten_wheat', 'gluten_rye', 'gluten_barley', 'gluten_oats',
  'lupin', 'milk', 'molluscs', 'mustard',
  'nuts_almond', 'nuts_hazelnut', 'nuts_walnut', 'nuts_cashew', 'nuts_pecan', 'nuts_brazil', 'nuts_pistachio', 'nuts_macadamia',
  'peanuts', 'sesame_seeds', 'soybeans', 'sulphur_dioxide_sulphites', 'no_allergens',
]
export const DELIVEROO_DIETARY = ['vegetarian', 'vegan', 'plant_based', 'gluten_free', 'dairy_free', 'halal', 'keto', 'paleo']

/** Our standard allergen (menu_dietary_tags.standard_key) -> Deliveroo codes. Nuts: Deliveroo wants the nut, so none by default. */
export const DEFAULT_ALLERGEN_CODES = {
  celery: ['celery'], gluten: ['gluten_wheat'], crustaceans: ['crustaceans'], eggs: ['eggs'], fish: ['fish'],
  lupin: ['lupin'], milk: ['milk'], molluscs: ['molluscs'], mustard: ['mustard'], nuts: [],
  peanuts: ['peanuts'], sesame: ['sesame_seeds'], soya: ['soybeans'], sulphites: ['sulphur_dioxide_sulphites'],
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

/** Default allergen and dietary maps for a tenant's tags (keyed by tag code). */
export function defaultMaps(tags = []) {
  const allergen = {}, dietary = {}
  for (const t of tags) {
    if (t.kind === 'allergen') {
      allergen[t.code] = t.standard_key ? [...(DEFAULT_ALLERGEN_CODES[t.standard_key] || [])] : []
    } else {
      const n = norm(t.label).replace(/ /g, '_')
      const hit = DELIVEROO_DIETARY.find(d => d === n || d.replace(/_/g, '') === n.replace(/_/g, ''))
      dietary[t.code] = hit ? [hit] : []
    }
  }
  return { allergen, dietary }
}

// ── Values ─────────────────────────────────────────────────────

/** Pence -> Deliveroo price text: 1350 -> "13.5", 1400 -> "14". */
export function priceText(pence) {
  if (pence == null || !Number.isFinite(Number(pence))) return ''
  return String(Math.round(Number(pence)) / 100)
}

/** Deliveroo price text -> pence, or null. */
export function pricePence(text) {
  const t = String(text ?? '').replace(/[£,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** Uplift by pct, then round to `to` pence (1, 5, 10, 50, 100), up or to the nearest. */
export function priceRule(pence, pct = 0, to = 1, mode = 'up') {
  if (pence == null) return null
  const raw = Math.round(pence * (1 + (Number(pct) || 0) / 100) * 10000) / 10000
  const step = Math.max(1, Number(to) || 1)
  return (mode === 'nearest' ? Math.round(raw / step) : Math.ceil(raw / step)) * step
}

/** The price a dish sells from: its own price, else its cheapest base option. */
export function dishPrice(dish) {
  if (dish?.price_pence != null) return { pence: Number(dish.price_pence), from: null }
  let best = null
  for (const g of dish?.variant_groups || []) {
    if ((g.price_mode || 'base') !== 'base') continue
    for (const o of g.options || []) {
      const p = o.price_pence ?? o.default_pence
      if (p != null && Number(p) > 0 && (best == null || Number(p) < best.pence)) best = { pence: Number(p), from: (g.name || 'option') + ': ' + o.label }
    }
  }
  for (const v of dish?.variants || []) {
    if (v.price_pence != null && Number(v.price_pence) > 0 && (best == null || Number(v.price_pence) < best.pence)) best = { pence: Number(v.price_pence), from: v.label }
  }
  return best || { pence: null, from: null }
}

const listText = codes => [...new Set(codes.map(c => String(c).trim()).filter(Boolean))].sort().join(',')
const listSet = text => listText(String(text ?? '').split(/[,;|]/))

/**
 * Our values for a dish, as Deliveroo text. ctx:
 *   settings { price_uplift_pct, price_round_pence, price_round_mode, include_may_contain, include_removable,
 *              allergen_map, dietary_map, default_vat_takeaway }
 *   tags     the tenant's tags (code, kind)
 * Returns { values: { field: text | null }, notes: { field: text }, problems: [] }. null = we have nothing for it.
 */
export function dishValues(dish, { settings = {}, tags = [] } = {}) {
  const values = {}, notes = {}, problems = []
  const price = dishPrice(dish)
  if (price.pence != null) {
    const out = priceRule(price.pence, settings.price_uplift_pct, settings.price_round_pence, settings.price_round_mode)
    values.delivery_price = priceText(out)
    values.instore_price = priceText(price.pence)
    notes.delivery_price = 'Menu ' + priceText(price.pence) + (price.from ? ' (' + price.from + ')' : '')
      + (Number(settings.price_uplift_pct) ? ' + ' + Number(settings.price_uplift_pct) + '%' : '')
  } else {
    values.delivery_price = null
    values.instore_price = null
  }
  const vat = dish?.vat_takeaway ?? settings.default_vat_takeaway
  values.tax_rate = vat == null ? null : String(Number(vat))
  values.item_description = (dish?.description || '').trim() || null
  values.item_name = (dish?.name || '').trim() || null
  values.calories = dish?.calories != null ? String(Math.round(Number(dish.calories))) : null
  values.energy_kcal = values.calories

  const byCode = Object.fromEntries(tags.map(t => [t.code, t]))
  const allergens = [], dietary = []
  const unmapped = []
  for (const code of dish?.dietary || []) {
    const tag = byCode[code]
    if (!tag) continue
    if (tag.kind === 'allergen') {
      const level = (dish.allergen_levels || {})[code] || 'contains'
      if (level === 'may_contain' && settings.include_may_contain === false) continue
      if (level === 'removable' && settings.include_removable === false) continue
      const mapped = (settings.allergen_map || {})[code] || []
      if (!mapped.length) unmapped.push(tag.label || code)
      allergens.push(...mapped)
    } else {
      dietary.push(...((settings.dietary_map || {})[code] || []))
    }
  }
  values.allergens = allergens.length ? listText(allergens) : null
  values.dietary_information = dietary.length ? listText(dietary) : null
  if (unmapped.length) problems.push({ level: 'error', field: 'allergens', text: unmapped.join(', ') + ' has no Deliveroo code: set it under Allergen codes' })
  return { values, notes, problems }
}

// ── Matching ───────────────────────────────────────────────────

const SMALL = new Set(['the', 'with', 'and', 'of', 'a', 'in', 'on'])
// Pack words Deliveroo names often carry and menus don't: "Coke Can", "Still Water 330ml".
const PACK = /^(can|cans|bottle|bottles|btl|glass|tin|pint|\d+(\.\d+)?\s?(ml|cl|l|ltr|litre|g|kg|oz))$/
const words = s => norm(s).split(' ').filter(w => w && !SMALL.has(w))
const unpacked = s => norm(s).replace(/\b(\d+(\.\d+)?) (ml|cl|l|ltr|litre|g|kg|oz)\b/g, '$1$3').split(' ').filter(w => !PACK.test(w)).join(' ')
const forms = s => {
  const out = [norm(s)]
  const add = v => { if (v && !out.includes(v)) out.push(v) }
  add(norm(String(s ?? '').replace(/\([^)]*\)/g, ' ')))
  for (const m of String(s ?? '').matchAll(/\(([^)]*)\)/g)) add(norm(m[1]))
  add(unpacked(s))
  return out
}

/** 0..1: how well two names match. */
export function nameScore(a, b) {
  const fa = forms(a), fb = forms(b)
  if (!fa[0] || !fb[0]) return 0
  if (fa[0] === fb[0]) return 1
  const squash = list => list.map(x => x.replace(/ /g, ''))
  if (fa.some(x => fb.includes(x)) || squash(fa).some(x => squash(fb).includes(x))) return 0.95
  const wa = new Set(words(a)), wb = new Set(words(b))
  if (!wa.size || !wb.size) return 0
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  const jaccard = common / (wa.size + wb.size - common)
  const contains = fa[0].includes(fb[0]) || fb[0].includes(fa[0])
  return Math.round(Math.min(0.89, contains ? Math.max(0.75, jaccard) : jaccard) * 100) / 100
}

/** Dishes ranked for a Deliveroo name: [{ dish, score }], best first, score > 0.3. */
export function rankDishes(name, dishes) {
  return dishes
    .map(d => ({ dish: d, score: Math.max(...[d.name, d.native_name, d.kitchen_name].filter(Boolean).map(n => nameScore(name, n)), 0) }))
    .filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name))
}

export const AUTO_MATCH = 0.9

/**
 * How a row is matched: a saved link wins (dish or skip); else the best dish
 * when it scores AUTO_MATCH or more and no other dish ties it.
 * Returns { state: 'linked' | 'skipped' | 'auto' | 'suggested' | 'none' | 'missing', dish, suggestions }.
 */
export function matchRow(row, link, dishes, dishById = null) {
  const byId = dishById || Object.fromEntries(dishes.map(d => [d.id, d]))
  if (link?.skip) return { state: 'skipped', dish: null, suggestions: [] }
  if (link?.menu_item_id) {
    const dish = byId[link.menu_item_id]
    return dish ? { state: 'linked', dish, suggestions: [] } : { state: 'missing', dish: null, suggestions: rankDishes(row.item_name, dishes).slice(0, 3) }
  }
  const ranked = rankDishes(row.item_name, dishes)
  const [best, second] = ranked
  if (best && best.score >= AUTO_MATCH && !(second && second.score === best.score)) return { state: 'auto', dish: best.dish, suggestions: ranked.slice(0, 3) }
  return { state: ranked.length ? 'suggested' : 'none', dish: null, suggestions: ranked.slice(0, 3) }
}

// ── Rows ───────────────────────────────────────────────────────

const same = (field, a, b) => {
  if (field === 'allergens' || field === 'dietary_information') return listSet(a) === listSet(b)
  if (field === 'delivery_price' || field === 'instore_price') return pricePence(a) === pricePence(b)
  if (field === 'tax_rate' || field === 'calories' || field === 'energy_kcal') {
    const na = String(a ?? '').trim(), nb = String(b ?? '').trim()
    return na === nb || (na !== '' && nb !== '' && Number(na) === Number(nb))
  }
  return String(a ?? '').trim() === String(b ?? '').trim()
}

/** Problems in a finished row (what Deliveroo would refuse, plus things worth a look). */
export function rowProblems(row, columns, original = null) {
  const out = []
  const has = c => columns.includes(c)
  const id = String(row.item_id ?? '').trim()
  if (!id) out.push({ level: 'error', field: 'item_id', text: 'No item_id: Deliveroo needs it to update the item' })
  else if (/^\d+(\.\d+)?e\+\d+$/i.test(id)) out.push({ level: 'error', field: 'item_id', text: 'Excel has turned this item_id into a number: use the file Deliveroo gave you' })
  if (has('delivery_price')) {
    const t = String(row.delivery_price ?? '').trim()
    if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0) out.push({ level: 'error', field: 'delivery_price', text: 'Delivery price must be a positive amount like 12.5' })
    else if (original && pricePence(original.delivery_price)) {
      const before = pricePence(original.delivery_price), after = pricePence(t)
      if (Math.abs(after - before) / before > 0.3) out.push({ level: 'warning', field: 'delivery_price', text: 'Price changes by more than 30%' })
    }
  }
  if (has('instore_price')) {
    const t = String(row.instore_price ?? '').trim()
    if (t !== '' && !/^\d+(\.\d{1,2})?$/.test(t)) out.push({ level: 'error', field: 'instore_price', text: 'In-store price must be an amount like 12.5' })
  }
  if (has('tax_rate') && !TAX_RATES.includes(String(Number(row.tax_rate)))) out.push({ level: 'error', field: 'tax_rate', text: 'VAT rate must be 0, 5, 12.5 or 20' })
  for (const f of ['calories', 'energy_kcal']) {
    const t = String(row[f] ?? '').trim()
    if (has(f) && t !== '' && !/^\d+$/.test(t)) out.push({ level: 'error', field: f, text: 'Calories must be a whole number' })
  }
  if (has('allergens')) {
    const codes = String(row.allergens ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const unknown = codes.filter(c => !DELIVEROO_ALLERGENS.includes(c))
    if (unknown.length) out.push({ level: 'warning', field: 'allergens', text: 'Not a known Deliveroo allergen code: ' + unknown.join(', ') })
    if (codes.includes('no_allergens') && codes.length > 1) out.push({ level: 'error', field: 'allergens', text: 'no_allergens can\'t go with other allergens' })
  }
  if (has('dietary_information')) {
    const codes = String(row.dietary_information ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const unknown = codes.filter(c => !DELIVEROO_DIETARY.includes(c))
    if (unknown.length) out.push({ level: 'warning', field: 'dietary_information', text: 'Not a known Deliveroo dietary value: ' + unknown.join(', ') })
  }
  for (const f of BOOLEAN_COLUMNS) {
    const t = String(row[f] ?? '').trim()
    if (has(f) && t !== '' && t !== 'true' && t !== 'false') out.push({ level: 'error', field: f, text: f + ' must be true or false' })
  }
  return out
}

/**
 * One file row with our values. opts:
 *   columns   the file's columns
 *   match     from matchRow()
 *   link      { keep: [field], overrides: { field: text } } (saved or being edited)
 *   fill      { field: bool } which columns we fill
 *   ctx       for dishValues()
 * Returns { values (whole row), changes: [{ field, from, to, source, note }], problems }.
 * An empty value from our menu never blanks a Deliveroo value; an edit can.
 */
export function buildRow(row, { columns, match, link = {}, fill = defaultFill(), ctx = {} }) {
  const values = { ...row }
  const changes = []
  const keep = new Set(link.keep || [])
  const overrides = link.overrides || {}
  let ours = null
  let problems = []
  if (match?.dish) {
    ours = dishValues(match.dish, ctx)
    problems = ours.problems.filter(p => fill[p.field] && columns.includes(p.field) && !keep.has(p.field) && !(p.field in overrides))
  }
  for (const field of FIELD_KEYS) {
    if (!columns.includes(field)) continue
    const from = row[field] ?? ''
    let to = from, source = null, note = null
    if (field in overrides) { to = overrides[field] ?? ''; source = 'edit' }
    else if (keep.has(field)) { source = 'keep' }
    else if (ours && fill[field] && ours.values[field] != null) { to = ours.values[field]; source = 'menu'; note = ours.notes[field] || null }
    if (source === 'keep' || (source && !same(field, from, to))) {
      values[field] = to
      changes.push({ field, from, to, source, note, changed: source !== 'keep' && !same(field, from, to) })
    }
  }
  problems = [...problems, ...rowProblems(values, columns, row)]
  return { values, changes: changes.filter(c => c.changed || c.source === 'keep'), problems }
}

// ── Files ──────────────────────────────────────────────────────

/**
 * CSV text -> { cells: [[text]], eol, trailing }. Quoted cells may hold
 * commas, quotes ("") and line breaks; every value stays text exactly as
 * written. eol and trailing say how the file ended its lines, so the export
 * can match.
 */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '')
  const cells = []
  let row = [], cell = '', quoted = false, i = 0
  const firstBreak = s.search(/\r?\n/)
  const eol = firstBreak >= 0 && s[firstBreak] === '\r' ? '\r\n' : '\n'
  const trailing = /\r?\n$/.test(s)
  while (i < s.length) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cell += ch; i++; continue
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r' && s[i + 1] === '\n') { i++; continue }
    if (ch === '\n' || ch === '\r') { row.push(cell); cells.push(row); row = []; cell = ''; i++; continue }
    cell += ch; i++
  }
  if (cell !== '' || row.length) { row.push(cell); cells.push(row) }
  return { cells, eol, trailing }
}

const PRICE_COLUMNS = ['delivery_price', 'instore_price']

/** Clean parsed rows: strings, booleans lower-case, trimmed ids, "£2.20" -> "2.2". */
export function tidyRows(columns, rawRows) {
  return rawRows.map(r => {
    const o = {}
    columns.forEach((c, i) => {
      let v = r[i] ?? ''
      v = typeof v === 'string' ? v : String(v)
      if (BOOLEAN_COLUMNS.includes(c) && /^(true|false)$/i.test(v.trim())) v = v.trim().toLowerCase()
      if (c === 'item_id') v = v.trim()
      if (PRICE_COLUMNS.includes(c) && v.trim() !== '' && !/^\d+(\.\d+)?$/.test(v)) {
        const p = pricePence(v)
        if (p != null && p >= 0) v = priceText(p)
      }
      o[c] = v
    })
    return o
  }).filter(o => Object.values(o).some(v => String(v).trim() !== ''))
}

/** Header check: { ok, missing }. */
export function checkColumns(columns) {
  const missing = REQUIRED_COLUMNS.filter(c => !columns.includes(c))
  return { ok: !missing.length, missing }
}

/** Header row + data rows (arrays of text) -> { columns, rows, problems }. */
export function readSheet(cells) {
  const header = (cells[0] || []).map(c => String(c ?? '').trim())
  let width = header.length
  while (width && !header[width - 1]) width--
  const columns = header.slice(0, width)
  const problems = []
  const dupes = columns.filter((c, i) => c && columns.indexOf(c) !== i)
  if (dupes.length) problems.push('The column ' + dupes[0] + ' is in the file twice')
  if (columns.some(c => !c)) problems.push('A column has no name in the first row')
  const { missing } = checkColumns(columns)
  if (missing.length) problems.push('This doesn\'t look like a Deliveroo menu file: no ' + missing.join(', ') + ' column')
  const rows = tidyRows(columns, cells.slice(1))
  const seen = new Set()
  for (const r of rows) {
    if (!r.item_id) continue
    if (seen.has(r.item_id)) { problems.push('item_id ' + r.item_id + ' is in the file twice'); break }
    seen.add(r.item_id)
  }
  return { columns, rows, problems }
}

const csvCell = v => {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The file as CSV, columns in their original order. */
export function toCsv(columns, rows, { eol = '\r\n', trailing = true } = {}) {
  const lines = [columns.map(csvCell).join(','), ...rows.map(r => columns.map(c => csvCell(r[c])).join(','))]
  return lines.join(eol) + (trailing ? eol : '')
}
