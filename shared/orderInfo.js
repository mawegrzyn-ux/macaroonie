// shared/orderInfo.js
//
// What an order ready board tile or a kitchen ticket says about an order:
// one big value and a few small lines, picked from the same fields. Used by
// the menu screens' Order status block (shared/screenLayout.js, also run by
// the player) and the kitchen screens (pos/src/kitchen).
//
// An order here is a kitchen order (shared/pos/kitchen.js) or a number on an
// order ready board (boardNumbers()): number, tent, table, name (the guest's
// first name online, the name typed on a till or kiosk), type (the order
// type's name), source ('till' | 'online' | 'gloriafood').

export const ORDER_FIELDS = [
  { key: 'number', label: 'Order number' },
  { key: 'tent', label: 'Tent number' },
  { key: 'table', label: 'Table' },
  { key: 'name', label: 'Customer name' },
  { key: 'type', label: 'Order type' },
  { key: 'source', label: 'Where from' },
]
const FIELD_KEYS = new Set(ORDER_FIELDS.map(f => f.key))
// What can be the big value (an order type or where from isn't a way to find your order).
export const MAIN_FIELDS = ['number', 'tent', 'table', 'name']
const SOURCE_NAMES = { online: 'Online', gloriafood: 'GloriaFood' }
// When the chosen big value is missing on an order, the first of these it has.
const FALLBACK = ['number', 'tent', 'table', 'name']

const clean = v => (v == null ? '' : String(v).trim())

/** A field's bare value on an order ('' when it has none). */
export function orderValue(o, key) {
  if (!o) return ''
  switch (key) {
    case 'number': return clean(o.number)
    case 'tent': return clean(o.tent)
    case 'table': return clean(o.table)
    case 'name': return clean(o.name ?? o.guest ?? (o.table ? null : o.tab))
    case 'type': return clean(o.type_name ?? o.type)
    case 'source': return SOURCE_NAMES[o.source] || ''
    default: return ''
  }
}

/** A field as a small line: 'Tent 12', 'Table 4', 'Order 57', the name as it is. */
export function orderText(o, key) {
  const v = orderValue(o, key)
  if (!v) return ''
  if (key === 'tent') return 'Tent ' + v
  if (key === 'table') return 'Table ' + v
  if (key === 'number') return 'Order ' + v
  return v
}

/** The word over a big value that isn't the order number ('Tent', 'Table'). */
export function mainCaption(key) {
  return key === 'tent' ? 'Tent' : key === 'table' ? 'Table' : ''
}

/** A saved choice tidied: { main, lines } with known fields only, lines without the main one. */
export function normaliseOrderInfo(main, lines) {
  const m = MAIN_FIELDS.includes(main) ? main : 'number'
  const seen = new Set([m])
  const out = []
  for (const k of Array.isArray(lines) ? lines : []) {
    if (!FIELD_KEYS.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return { main: m, lines: out }
}

/**
 * What to show for an order: the big value (the chosen field, else the first
 * of number / tent / table / name the order has) with its key and caption,
 * then the small lines that have something to say (never the big one again).
 *   -> { key, value, caption, lines: [{ key, text }] }
 */
export function orderInfo(o, info = {}) {
  const { main, lines } = normaliseOrderInfo(info.main, info.lines)
  let key = main
  let value = orderValue(o, main)
  if (!value) {
    for (const k of FALLBACK) {
      const v = orderValue(o, k)
      if (v) { key = k; value = v; break }
    }
  }
  return {
    key, value, caption: mainCaption(key),
    lines: lines.filter(k => k !== key).map(k => ({ key: k, text: orderText(o, k) })).filter(l => l.text),
  }
}
