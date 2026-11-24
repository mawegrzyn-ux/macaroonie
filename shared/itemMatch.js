// shared/itemMatch.js
//
// Matching someone else's names and codes to our dishes: the one
// implementation, used by the Deliveroo file (shared/deliveroo.js, a
// Deliveroo row to a dish) and by the item mapping's suggestions (sales from
// other tills, docs/SALES_IMPORT.md 4.3: another till's item, variant or
// modifier option to our dish, dish + options, or option). Plain ESM, no
// dependencies.
//
//   normName(s)                 lower case, accents and punctuation gone
//   nameScore(a, b)             0..1, how well two names match
//   rankDishes(name, dishes)    dishes by nameScore, best first (> 0.3)
//   AUTO_MATCH                  a score at or above this is taken as a match
//   normCode(s)                 a product code or barcode compared as one
//   matchThing(thing, ours)     the best targets for one thing on the other
//                               till: codes first (our dishes' SKUs and
//                               barcodes, and their per-option codes), then
//                               names, with price and category breaking ties
//
// A match never decides anything: the caller shows it and the person
// accepts it (a rule is saved only then).

export const normName = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const norm = normName

const SMALL = new Set(['the', 'with', 'and', 'of', 'a', 'in', 'on'])
// Pack words other systems' names often carry and menus don't: "Coke Can", "Still Water 330ml".
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

/** Dishes ranked for a name: [{ dish, score }], best first, score > 0.3. */
export function rankDishes(name, dishes) {
  return dishes
    .map(d => ({ dish: d, score: Math.max(...[d.name, d.native_name, d.kitchen_name].filter(Boolean).map(n => nameScore(name, n)), 0) }))
    .filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name))
}

export const AUTO_MATCH = 0.9

/** A code as compared: trimmed, upper case, inner spaces gone ('' for none). */
export const normCode = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')

const pct = s => Math.round(s * 100) + '%'
const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2)

/**
 * Our side for matchThing(), built once per page:
 *   dishes:  [{ id, name, native_name?, kitchen_name?, kind, price_pence,
 *              sku, barcode, section, group_ids: [], option_codes:
 *              [{ option_id, sku, barcode }], option_prices: { option_id: pence } }]
 *   options: [{ id, group_id, group_name, label, price_pence }]
 */
export function matchIndex({ dishes = [], options = [] } = {}) {
  const codes = new Map()   // code -> [{ dish, option_id }]
  const add = (code, hit) => {
    const c = normCode(code)
    if (!c) return
    if (!codes.has(c)) codes.set(c, [])
    codes.get(c).push(hit)
  }
  for (const d of dishes) {
    add(d.sku, { dish: d, option_id: null })
    add(d.barcode, { dish: d, option_id: null })
    for (const oc of d.option_codes || []) {
      add(oc.sku, { dish: d, option_id: oc.option_id })
      add(oc.barcode, { dish: d, option_id: oc.option_id })
    }
  }
  const optionById = Object.fromEntries(options.map(o => [o.id, o]))
  return { dishes, options, optionById, codes }
}

/** A dish's price with these options: its own price for an option where it has one. */
function priceWith(dish, optionIds, idx) {
  let p = Number(dish.price_pence) || 0
  for (const id of optionIds) p += dish.option_prices?.[id] ?? (Number(idx.optionById[id]?.price_pence) || 0)
  return p
}

/** Our options (on the dish's own groups) for a variant's values: Large -> Size: Large. */
function optionsFor(dish, values, idx) {
  const picked = [], taken = new Set(), named = []
  for (const value of values) {
    let best = null
    for (const gid of dish.group_ids || []) {
      if (taken.has(gid)) continue
      for (const o of idx.options) {
        if (o.group_id !== gid) continue
        const s = nameScore(value, o.label)
        if (s >= AUTO_MATCH && (!best || s > best.s)) best = { s, o }
      }
    }
    if (!best) return null
    taken.add(best.o.group_id)
    picked.push(best.o.id)
    named.push(value + ' → ' + best.o.group_name + ': ' + best.o.label)
  }
  return { ids: picked, words: named }
}

/**
 * The best targets for one thing on the other till.
 *   thing: { kind: 'item' | 'variant' | 'option', name (the item's or the
 *            modifier option's), values: [variant option values], sku,
 *            barcode, price_pence, category }
 *   idx:   matchIndex()
 * Returns { candidates: [{ target: { item_id, combo_id, option_ids }, label,
 * score, by: 'code' | 'name', reason }] (best first, at most 3), best, auto }.
 * auto: the best scores AUTO_MATCH or more and nothing else ties it (a tie
 * broken by price or category counts as broken).
 */
export function matchThing(thing, idx) {
  const out = []
  const values = (thing.values || []).filter(v => v != null && v !== '')
  const isOption = thing.kind === 'option'
  const seen = new Set()
  const push = c => {
    const key = (c.target.item_id || c.target.combo_id || '') + '|' + (c.target.option_ids || []).join(',')
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }
  const dishTarget = (dish, optionIds = []) => dish.kind === 'combo'
    ? { item_id: null, combo_id: dish.id, option_ids: [] }
    : { item_id: dish.id, combo_id: null, option_ids: optionIds }
  const labelOf = (dish, optionIds = []) => [dish.name, ...optionIds.map(id => {
    const o = idx.optionById[id]
    return o ? o.group_name + ': ' + o.label : '?'
  })].join(' + ')

  // 1. Codes: the same SKU or barcode on our dish (or on one of its options).
  for (const code of [thing.sku, thing.barcode]) {
    for (const hit of idx.codes.get(normCode(code)) || []) {
      if (isOption && !hit.option_id) {
        // A modifier sold as a side: the dish itself.
        push({ target: dishTarget(hit.dish), label: labelOf(hit.dish), score: 1, by: 'code', reason: 'Same code as ' + hit.dish.name + ' (' + normCode(code) + ')' })
        continue
      }
      if (isOption) continue
      const ids = hit.option_id ? [hit.option_id] : []
      push({ target: dishTarget(hit.dish, ids), label: labelOf(hit.dish, ids), score: 1, by: 'code',
        reason: 'Same code as ' + labelOf(hit.dish, ids) + ' (' + normCode(code) + ')' })
    }
  }

  // 2. Names.
  if (isOption) {
    for (const o of idx.options) {
      const s = Math.max(nameScore(thing.name, o.label), nameScore(thing.name, o.group_name + ' ' + o.label))
      if (s > 0.3) push({ target: { item_id: null, combo_id: null, option_ids: [o.id] }, label: o.group_name + ': ' + o.label, score: s, by: 'name',
        reason: 'Name like ' + o.group_name + ': ' + o.label + ' (' + pct(s) + ')', price: o.price_pence })
    }
    for (const r of rankDishes(thing.name, idx.dishes)) {
      push({ target: dishTarget(r.dish), label: labelOf(r.dish), score: r.score, by: 'name',
        reason: 'Name like the dish ' + r.dish.name + ' (' + pct(r.score) + ')', price: r.dish.price_pence, section: r.dish.section })
    }
  } else {
    for (const r of rankDishes(thing.name, idx.dishes)) {
      if (!values.length || r.dish.kind === 'combo') {
        push({ target: dishTarget(r.dish), label: labelOf(r.dish), score: r.score, by: 'name',
          reason: 'Name like ' + r.dish.name + ' (' + pct(r.score) + ')', price: r.dish.price_pence, section: r.dish.section })
        continue
      }
      // A variant: the dish, with our options for its values when every value finds one.
      const opts = optionsFor(r.dish, values, idx)
      if (opts) {
        push({ target: dishTarget(r.dish, opts.ids), label: labelOf(r.dish, opts.ids), score: r.score, by: 'name',
          reason: 'Name like ' + r.dish.name + ' (' + pct(r.score) + '); ' + opts.words.join(', '),
          price: priceWith(r.dish, opts.ids, idx), section: r.dish.section })
      } else {
        // The values found no options: a weaker match on the dish alone.
        const s = Math.round(r.score * 0.85 * 100) / 100
        push({ target: dishTarget(r.dish), label: labelOf(r.dish), score: s, by: 'name',
          reason: 'Name like ' + r.dish.name + ' (' + pct(r.score) + '), but ' + values.join(' / ') + ' found no option on it',
          price: r.dish.price_pence, section: r.dish.section })
      }
    }
  }

  // 3. Price and category break ties between equal scores.
  const tieKey = c => [
    c.price != null && thing.price_pence != null && Number(c.price) === Number(thing.price_pence) ? 0 : 1,
    c.section && thing.category ? -nameScore(c.section, thing.category) : 0,
  ]
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.by !== b.by) return a.by === 'code' ? -1 : 1
    const ka = tieKey(a), kb = tieKey(b)
    return ka[0] - kb[0] || ka[1] - kb[1] || a.label.localeCompare(b.label)
  })
  const [best, second] = out
  let auto = !!best && best.score >= AUTO_MATCH
  if (auto && second && second.score === best.score) {
    const kb = tieKey(best), ks = tieKey(second)
    auto = best.by !== second.by || kb[0] < ks[0] || (kb[0] === ks[0] && kb[1] < ks[1])
  }
  for (const c of out) {
    if (c.price != null && thing.price_pence != null && Number(c.price) === Number(thing.price_pence)) c.reason += '; same price ' + money(c.price)
    delete c.price
    delete c.section
  }
  return { candidates: out.slice(0, 3), best: best || null, auto }
}
