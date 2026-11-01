// shared/procurement.js
//
// Purchasing maths, one implementation for the API and the admin (same idea
// as orderPricing.js). Dependency-free ESM.
//
// Units: every inventory item has a BASE unit (g, ml or each). A supplier
// quote sells it in a pack: pack_count x pack_qty pack_unit (e.g. 6 x 2 kg),
// stored as pack_base_qty = how many base units one pack holds (12000 g).
// Price is per pack, ex VAT, in the tenant's currency (no exchange rates).
// So price per base unit = price / pack_base_qty, and nothing stores a cost
// on the item: what an item costs comes from its quotes.
//
// Which quote a venue orders on (chooseQuote): the venue's preferred quote,
// else the company default, else the cheapest per base unit at that venue
// (a quote's venue price wins over its company price).

export const UNITS = {
  g:    { kind: 'mass',   factor: 1,    label: 'g' },
  kg:   { kind: 'mass',   factor: 1000, label: 'kg' },
  ml:   { kind: 'volume', factor: 1,    label: 'ml' },
  cl:   { kind: 'volume', factor: 10,   label: 'cl' },
  l:    { kind: 'volume', factor: 1000, label: 'l' },
  each: { kind: 'count',  factor: 1,    label: 'each' },
}

export const BASE_UNITS = [
  { key: 'g',    label: 'Weight (g, kg)' },
  { key: 'ml',   label: 'Volume (ml, l)' },
  { key: 'each', label: 'Count (each)' },
]

export const STORAGE = [
  { key: 'ambient', label: 'Ambient' },
  { key: 'chilled', label: 'Chilled' },
  { key: 'frozen',  label: 'Frozen' },
]

// What an option group (Menus > Variant groups, menu_variant_groups.
// variation_type, migration 206) does to a dish's recipe, for stock: changes
// the dish (things taken off or swapped), adds a side with its own recipe,
// or adds to the dish's own recipe. NULL = not set yet.
export const VARIATION_TYPES = [
  { key: 'modification', label: 'Product modification', hint: 'Changes the dish a lot: things go on and off its recipe (Make it vegan, No bun).' },
  { key: 'side',         label: 'Side addition',        hint: 'A separate item with its own recipe (a dip pot, fries, a drink).' },
  { key: 'addition',     label: 'Adds to the recipe',   hint: 'Something added to the dish\'s own recipe (extra cheese, a sauce on the wings).' },
]
export const VARIATION_TYPE_KEYS = VARIATION_TYPES.map(t => t.key)

export const SEND_METHODS = [
  { key: 'email', label: 'Email' },
  { key: 'print', label: 'Print' },
  { key: 'excel', label: 'Excel file' },
  { key: 'pdf',   label: 'PDF file' },
]

export const PO_STATUSES = {
  to_send:   'To send',
  sent:      'Sent',
  received:  'Received',
  cancelled: 'Cancelled',
}

export const RECEIVE_STATUSES = [
  { key: 'ok',          label: 'OK' },
  { key: 'short',       label: 'Short' },
  { key: 'damaged',     label: 'Damaged' },
  { key: 'substituted', label: 'Substituted' },
  { key: 'missing',     label: 'Not delivered' },
]

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Delivery temperatures (°C, at or below) for the H&S delivery check.
export const DELIVERY_TEMP_MAX = { chilled: 8, frozen: -15 }

/** Is a delivery probe reading fine for this storage? (null reading = not taken.) */
export function deliveryTempOk(storage, temp) {
  const max = DELIVERY_TEMP_MAX[storage]
  if (max == null || temp == null || temp === '') return true
  return Number(temp) <= max
}

/** A received line's status when the person didn't pick one. */
export function receiveStatusFor(ordered, received) {
  const o = num(ordered), r = num(received)
  if (r <= 0) return 'missing'
  return r + 1e-9 < o ? 'short' : 'ok'
}

const num = v => (v == null || v === '' ? 0 : Number(v))
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round4 = n => Math.round(Number(n) * 10000) / 10000

/** Units a pack can be given in for an item with this base unit. */
export function unitsForBase(baseUnit) {
  const kind = UNITS[baseUnit]?.kind
  return Object.keys(UNITS).filter(k => UNITS[k].kind === kind)
}

/** Base units in one pack, or null when the pack unit doesn't fit the item. */
export function packBaseQty({ pack_count = 1, pack_qty, pack_unit }, baseUnit) {
  const u = UNITS[pack_unit], b = UNITS[baseUnit]
  if (!u || !b || u.kind !== b.kind) return null
  const qty = num(pack_count || 1) * num(pack_qty) * u.factor / b.factor
  return qty > 0 ? round4(qty) : null
}

/** A number without trailing zeros: 2, 2.5, 0.75. */
export function fmtNum(n, dp = 3) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return String(Math.round(v * 10 ** dp) / 10 ** dp)
}

function cap(s) {
  const t = String(s || '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Pack'
}

/** "Case · 6 × 2 kg", "Bag · 25 kg", "Tray · 30 each". */
export function packLabel(q) {
  if (!q) return ''
  const { name, size } = packParts(q)
  return `${name} · ${size}`
}

/** A pack's name and size apart: { name: "Case", size: "6 × 2.95 kg" }. */
export function packParts(q) {
  if (!q) return { name: '', size: '' }
  const one = `${fmtNum(q.pack_qty)} ${UNITS[q.pack_unit]?.label ?? q.pack_unit}`
  const count = num(q.pack_count || 1)
  return { name: cap(q.pack_name), size: count !== 1 ? `${fmtNum(count)} × ${one}` : one }
}

/** A base quantity in a readable unit: 12000 g -> "12 kg". */
export function formatBase(qty, baseUnit) {
  const v = num(qty)
  if (baseUnit === 'g')  return v >= 1000 ? `${fmtNum(v / 1000)} kg` : `${fmtNum(v)} g`
  if (baseUnit === 'ml') return v >= 1000 ? `${fmtNum(v / 1000)} l`  : `${fmtNum(v)} ml`
  return `${fmtNum(v)} each`
}

/** The unit prices are compared in: per kg, per litre, or each. */
export function perUnitLabel(baseUnit) {
  return baseUnit === 'g' ? 'kg' : baseUnit === 'ml' ? 'l' : 'each'
}

/** Price per kg / litre / each for a pack price. */
export function unitPrice(price, packBase, baseUnit) {
  const per = num(price) / num(packBase)
  if (!Number.isFinite(per)) return null
  return baseUnit === 'g' || baseUnit === 'ml' ? per * 1000 : per
}

/** A quote's price at a venue: the venue's own price, else the company price. */
export function quotePrice(quote, venueId) {
  const v = venueId != null ? quote?.venue_prices?.[venueId] : undefined
  return v != null ? num(v) : num(quote?.price)
}

/**
 * The quote a venue orders an item on, from that item's active quotes.
 * preferred = { default: quoteId|null, venues: { [venueId]: quoteId } }.
 * Returns { quote, how: 'venue' | 'default' | 'cheapest' } or null.
 */
export function chooseQuote(quotes, venueId, preferred = {}) {
  const live = (quotes || []).filter(q => q.is_active !== false)
  if (!live.length) return null
  const byId = id => live.find(q => q.id === id)
  const venuePick = venueId != null ? byId(preferred.venues?.[venueId]) : null
  if (venuePick) return { quote: venuePick, how: 'venue' }
  const defPick = byId(preferred.default)
  if (defPick) return { quote: defPick, how: 'default' }
  let best = null, bestPer = Infinity
  for (const q of live) {
    const per = quotePrice(q, venueId) / num(q.pack_base_qty)
    if (per < bestPer) { best = q; bestPer = per }
  }
  return best ? { quote: best, how: 'cheapest' } : null
}

/** Round a quantity up to the quote's minimum and multiple (0 stays 0). */
export function fitQty(qty, quote) {
  let q = num(qty)
  if (q <= 0) return 0
  const min = num(quote?.min_qty), mult = num(quote?.order_multiple)
  if (min > 0 && q < min) q = min
  if (mult > 0) q = Math.ceil(q / mult - 1e-9) * mult
  return round4(q)
}

/** What stops a quantity on this quote: { kind: 'min' | 'step', value }, or null. */
function qtyIssue(qty, quote) {
  const q = num(qty)
  if (q <= 0) return null
  const min = num(quote?.min_qty), mult = num(quote?.order_multiple)
  if (min > 0 && q < min - 1e-9) return { kind: 'min', value: min }
  if (mult > 0 && Math.abs(q / mult - Math.round(q / mult)) > 1e-6) return { kind: 'step', value: mult }
  return null
}

/** Why a quantity can't be ordered on this quote, or null. */
export function qtyProblem(qty, quote) {
  const i = qtyIssue(qty, quote)
  if (!i) return null
  return i.kind === 'min' ? `Minimum ${fmtNum(i.value)}` : `In steps of ${fmtNum(i.value)}`
}

// "would be below the minimum of 20" / "wouldn't be in steps of 2"; both:
// "would both be below the minimum of 20".
const issueWords = (i, both) => (i.kind === 'min'
  ? `would ${both ? 'both ' : ''}be below the minimum of ${fmtNum(i.value)}`
  : `wouldn't be in steps of ${fmtNum(i.value)}`)

/**
 * Why moving `moved` of a line of `total` packs to another order leaves
 * either part below the quote's minimum or off its steps, or null (moving
 * none or all of it is always fine): splitting a minimum of 20 into 10 + 10
 * leaves both orders below it.
 */
export function splitProblem(total, moved, quote) {
  const t = num(total), m = num(moved)
  if (m <= 0 || m >= t - 1e-9) return null
  const keep = round4(t - m)
  const a = qtyIssue(m, quote), b = qtyIssue(keep, quote)
  if (!a && !b) return null
  if (a && b) {
    return a.kind === b.kind && a.value === b.value
      ? `${fmtNum(keep)} left and ${fmtNum(m)} moved ${issueWords(a, true)}`
      : `${fmtNum(keep)} left ${issueWords(b)} and ${fmtNum(m)} moved ${issueWords(a)}`
  }
  return b ? `${fmtNum(keep)} left ${issueWords(b)}` : `${fmtNum(m)} moved ${issueWords(a)}`
}

/**
 * The packs of `to` holding at least what `qty` packs of `from` held
 * (3 x 5 kg is 15 kg: 2 x 10 kg), then up to to's minimum and steps:
 * changing supplier or pack never changes the amount by surprise. Without
 * both pack sizes, the same count fitted to `to`.
 */
export function convertQty(qty, from, to) {
  const q = num(qty)
  if (q <= 0) return 0
  const a = num(from?.pack_base_qty), b = num(to?.pack_base_qty)
  if (!(a > 0) || !(b > 0) || Math.abs(a - b) < 1e-9) return fitQty(q, to)
  const raw = q * a / b
  const step = num(to?.order_multiple)
  // Whole packs, unless the quote is ordered in steps under one pack.
  return fitQty(step > 0 && step < 1 ? raw : Math.ceil(raw - 1e-9), to)
}

/** Packs a par (in base units) comes to on a quote, e.g. 1.5. */
export function parPacks(parBase, quote) {
  const pb = num(quote?.pack_base_qty)
  return pb > 0 && parBase != null ? round4(num(parBase) / pb) : null
}

/** Packs to order to reach a par from nothing: whole packs, then min/multiple. */
export function packsToPar(parBase, quote) {
  const p = parPacks(parBase, quote)
  return p ? fitQty(Math.ceil(p - 1e-9), quote) : 0
}

/** Net and VAT per line ({ price, qty, vat_rate }), rounded to pennies. */
export function lineAmounts(line) {
  const net = round2(num(line.price) * num(line.qty))
  const vat = round2(net * num(line.vat_rate) / 100)
  return { net, vat }
}

/** Purchase order totals: lines ex VAT, VAT, delivery charge (no VAT added), total. */
export function orderTotals(lines, deliveryCharge = 0) {
  let subtotal = 0, vat = 0
  for (const l of lines || []) {
    const a = lineAmounts(l)
    subtotal += a.net
    vat += a.vat
  }
  subtotal = round2(subtotal); vat = round2(vat)
  const delivery = round2(num(deliveryCharge))
  return { subtotal, vat, delivery_charge: delivery, total: round2(subtotal + vat + delivery) }
}

// ── Delivery dates ──────────────────────────────────────────────

export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const hhmmOf = t => (t ? String(t).slice(0, 5) : null)

/**
 * A supplier's ordering settings for one venue (venue rows override): the
 * delivery days, cutoff, days' notice (lead_days, migration 233) and account
 * number fall back to the supplier's; the delivery phone, driver
 * instructions and delivery slot exist only per venue.
 */
export function supplierForVenue(supplier, venueRow) {
  return {
    delivery_days: venueRow?.delivery_days ?? supplier?.delivery_days ?? [],
    cutoff_time:   venueRow?.cutoff_time ?? supplier?.cutoff_time ?? null,
    lead_days:     num(venueRow?.lead_days ?? supplier?.lead_days ?? 1),
    account_ref:   venueRow?.account_ref || supplier?.account_ref || null,
    delivery_phone:      venueRow?.delivery_phone || null,
    driver_instructions: venueRow?.driver_instructions || null,
    slot_from:     hhmmOf(venueRow?.slot_from),
    slot_to:       hhmmOf(venueRow?.slot_to),
  }
}

/** "07:00-10:00", "from 07:00", "by 10:00", or null: a delivery slot in words. */
export function slotText({ slot_from: from, slot_to: to } = {}) {
  const a = hhmmOf(from), b = hhmmOf(to)
  if (a && b) return `${a}-${b}`
  if (a) return `from ${a}`
  if (b) return `by ${b}`
  return null
}

/**
 * The delivery details for a supplier's checkout (their website or app),
 * one per line, for "Copy for checkout": account, where and when, the
 * phone, the instructions (the order's note, else the venue's driver
 * instructions) and our order number as a reference.
 * po: { number, delivery_date, notes, account_ref, delivery_phone,
 * driver_instructions, slot_from, slot_to }; venue: { name, address_line1,
 * address_line2, city, postcode, phone }.
 */
export function checkoutText(po, venue) {
  const where = [venue?.name, venue?.address_line1, venue?.address_line2, venue?.city, venue?.postcode].filter(Boolean).join(', ')
  const slot = slotText(po || {})
  const say = po?.notes || po?.driver_instructions || null
  return [
    po?.account_ref && `Account: ${po.account_ref}`,
    where && `Deliver to: ${where}`,
    po?.delivery_date && `Delivery: ${dayText(po.delivery_date)}${slot ? ', ' + slot : ''}`,
    (po?.delivery_phone || venue?.phone) && `Phone: ${po?.delivery_phone || venue.phone}`,
    say && `Instructions: ${say}`,
    po?.number != null && `Our order: ${poNumberLabel(po.number)}`,
  ].filter(Boolean).join('\n')
}

/**
 * A supplier's quick order, for typing or pasting into their website or
 * app: each product code with the quantity in their packs, "MEA161:20"
 * entries joined by `sep` (a comma, or "\n" for one a line). The same code
 * twice is one entry with the sum. Lines without a supplier code can't be
 * entered by code: they come back in noCode to type in by hand.
 * lines: [{ code, name, qty }] (qty in packs; 0 or less left out).
 * Returns { text, coded: [{ code, name, qty }], noCode: [{ name, qty }] }.
 */
export function quickOrder(lines, { sep = ',' } = {}) {
  const byCode = new Map()
  const noCode = []
  for (const l of lines || []) {
    const qty = num(l.qty)
    if (!(qty > 0)) continue
    const code = String(l.code ?? '').trim()
    if (!code) { noCode.push({ name: l.name, qty }); continue }
    const key = code.toLowerCase()
    const had = byCode.get(key)
    if (had) had.qty = round4(had.qty + qty)
    else byCode.set(key, { code, name: l.name, qty })
  }
  const coded = [...byCode.values()]
  return { text: coded.map(l => `${l.code}:${fmtNum(l.qty)}`).join(sep), coded, noCode }
}

/** One CSV cell: quoted when needed; a leading = + - @ made harmless for spreadsheets. */
export function csvCell(v) {
  let t = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
}

/**
 * The quick order as a CSV of code, name, qty (a heading row, then one row
 * per code; lines without a code left out, as in quickOrder()).
 */
export function quickOrderCsv(lines) {
  const { coded } = quickOrder(lines)
  return [['code', 'name', 'qty'], ...coded.map(l => [l.code, l.name, fmtNum(l.qty)])]
    .map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ── A supplier's basket, back into an order (1 Nov 2026) ───────
//
// What someone ordered on a supplier's website, pasted or as a file, read
// as rows of a product code and a quantity in packs, then compared with an
// order's lines for that supplier. basketFromText() reads the quick
// order's own form (MEA161:20,POR106:7), one a line ("MEA161, 20",
// "MEA161 20", "MEA161 x 20", "20 x MEA161") or a pasted table with
// headings; basketFromSheet() a spreadsheet's rows (a heading row naming the
// code and quantity columns, else a code then a quantity).

const BASKET_HEADINGS = {
  code: ['code', 'suppliercode', 'productcode', 'itemcode', 'sku', 'ref', 'reference', 'productref', 'stockcode',
    'articlecode', 'articlenumber', 'artno', 'partnumber', 'productid', 'prodcode', 'catalogueno', 'catno', 'codes'],
  qty: ['qty', 'quantity', 'amount', 'orderqty', 'orderquantity', 'quantityordered', 'qtyordered', 'cases', 'packs',
    'units', 'noofunits', 'count', 'number', 'quantities'],
  name: ['name', 'description', 'product', 'productname', 'productdescription', 'item', 'itemname', 'itemdescription',
    'desc', 'title'],
}
const basketHeading = h => {
  const k = String(h ?? '').toLowerCase().replace(/[^a-z]/g, '')
  for (const [col, names] of Object.entries(BASKET_HEADINGS)) if (names.includes(k)) return col
  return null
}
const cleanCode = c => String(c ?? '').trim().replace(/^["']+|["']+$/g, '').trim()
const basketQty = v => {
  const t = String(v ?? '').trim()
  return /^\d+(?:\.\d+)?$/.test(t) ? round4(Number(t)) : null
}
export const BASKET_MAX_ROWS = 2000

/** One line of a CSV (quotes allowed) split on its delimiter. */
function splitCsvLine(line, delim) {
  const out = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"' && !cur.trim()) quoted = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(c => c.trim())
}

/**
 * A spreadsheet's rows (arrays of cells) as basket rows: { rows: [{ row,
 * code, qty, name? } | { row, code?, error }] } with the file's row numbers,
 * or { error } when it has headings but no code or quantity column.
 */
export function basketFromSheet(sheet) {
  const cells = (sheet || []).map(r => (Array.isArray(r) ? r : [r]).map(c => String(c ?? '').trim()))
  const first = cells.findIndex(r => r.some(Boolean))
  if (first < 0) return { rows: [] }
  const keys = cells[first].map(basketHeading)
  let codeCol = keys.indexOf('code'), qtyCol = keys.indexOf('qty'), nameCol = keys.indexOf('name'), start = first + 1
  if (codeCol < 0 || qtyCol < 0) {
    // Headings that name neither column mean a file in another layout.
    if (keys.some(Boolean) || basketQty(cells[first][1]) == null) {
      return { error: 'No code and quantity columns found. Use the headings Code and Qty, or a code then a quantity on each row.' }
    }
    codeCol = 0; qtyCol = 1; nameCol = -1; start = first
  }
  const rows = []
  for (let i = start; i < cells.length; i++) {
    const r = cells[i]
    if (!r.some(Boolean)) continue
    const code = cleanCode(r[codeCol])
    const qty = basketQty(r[qtyCol])
    const name = nameCol >= 0 ? (r[nameCol] || null) : null
    const text = r.filter(Boolean).join(', ').slice(0, 80)
    if (!code) rows.push({ row: i + 1, text, error: 'No code' })
    else if (qty == null) rows.push({ row: i + 1, code, text, error: 'Quantity missing or not a number' })
    else rows.push({ row: i + 1, code, qty, ...(name ? { name } : {}) })
  }
  return { rows }
}

/** Pasted text as basket rows (see above); row = the line number. */
export function basketFromText(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const firstIdx = lines.findIndex(l => l.trim())
  if (firstIdx < 0) return { rows: [] }
  const head = lines[firstIdx]
  const delim = head.includes('\t') ? '\t' : head.includes(';') && !head.includes(',') ? ';' : ','
  const cells = splitCsvLine(head, delim)
  const heads = cells.map(basketHeading)
  // A CSV with headings (a first line of words), or three columns or more
  // without them: a sheet, with the code then the quantity first when it
  // has no headings for them (anything else is said once).
  const words = cells.length >= 2 && cells.every(c => c && basketQty(c) == null)
  if ((heads.includes('code') && heads.includes('qty')) || (!head.includes(':') && (words || cells.length >= 3))) {
    return basketFromSheet(lines.map(l => splitCsvLine(l, delim)))
  }
  const rows = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    // The quick order's form: pairs of code:qty separated by commas.
    const pieces = t.includes(':') ? t.split(/[,;]/) : [t]
    for (const piece of pieces) {
      const s = piece.trim()
      if (!s) continue
      const r = basketPiece(s)
      rows.push({ row: i + 1, ...r, ...(r.error ? { text: s.slice(0, 80) } : {}) })
    }
  })
  return { rows }
}

// One "code and quantity" written by hand: MEA161:20, MEA161 20, MEA161 x 20,
// MEA161, 20 (a code then its quantity), or 20 x MEA161. Two numbers either
// side of an x could be either way round, so they are refused.
const QTY_FIRST = /^(\d+(?:\.\d+)?)\s*[x\u00d7*]\s*(\S.*)$/i
function basketPiece(s) {
  if (/^\d+(?:\.\d+)?\s*[x\u00d7*]\s*\d+(?:\.\d+)?$/i.test(s)) {
    return { error: 'Is that a code then a quantity, or a quantity then a code? Write it as code:quantity' }
  }
  let m = s.match(/^(\S(?:.*?\S)?)\s*(?:[:=,;\t]|\s[x\u00d7*]\s*|\s)\s*(\d+(?:\.\d+)?)$/i)
  // "4 x XYZ 9" is 4 of XYZ 9, not 9 of "4 x XYZ".
  if (m && !/^\d+(?:\.\d+)?\s*[x\u00d7*]\s/i.test(m[1])) return { code: cleanCode(m[1]), qty: round4(Number(m[2])) }
  m = s.match(QTY_FIRST)
  if (m) return { code: cleanCode(m[2]), qty: round4(Number(m[1])) }
  return { code: cleanCode(s.split(/[\s,;:]/)[0]), error: "Couldn't read a code and a quantity" }
}

/**
 * Basket rows merged by code (any case; the first spelling kept, the
 * quantities added up): { lines: [{ code, qty, rows, name }], errors }.
 */
export function mergeBasket(rows) {
  const by = new Map()
  const errors = []
  for (const r of rows || []) {
    if (r.error) { errors.push(r); continue }
    const key = r.code.toLowerCase()
    const had = by.get(key)
    if (had) { had.qty = round4(had.qty + r.qty); had.rows.push(r.row) }
    else by.set(key, { code: r.code, qty: r.qty, rows: [r.row], name: r.name || null })
  }
  return { lines: [...by.values()], errors }
}

/**
 * What a supplier's basket changes on an order.
 *   basket: mergeBasket()'s lines;
 *   quotes: the supplier's prices with a code [{ id, item_id, item_name, supplier_code, live, product_name,
 *           pack_name, pack_count, pack_qty, pack_unit, min_qty, order_multiple }] (live = the price and its
 *           item switched on);
 *   lines:  the order's lines with a quantity [{ item_id, item_name, qty, quote }] (quote: the price the line
 *           is on, with supplier_id, supplier_name, supplier_code and its pack, or null);
 *   removeMissing: lines of this supplier the basket doesn't have are taken off.
 * Returns { added, changed, removed, unchanged, unknown, switched_off, ambiguous, errors }. qty is what will
 * be ordered: the basket's quantity up to the price's minimum and steps (basket_qty and qty_problem when that
 * changed it). A changed line on another price (another supplier, or another pack) says where it was (from).
 * An order has one line per item, so a second code in the basket for the same item is an error.
 */
export function basketDiff({ basket, quotes, lines, supplierId, removeMissing = true }) {
  const byCode = new Map()
  for (const q of quotes || []) {
    const k = String(q.supplier_code ?? '').trim().toLowerCase()
    if (!k) continue
    if (!byCode.has(k)) byCode.set(k, [])
    byCode.get(k).push(q)
  }
  const lineBy = new Map((lines || []).filter(l => num(l.qty) > 0).map(l => [l.item_id, l]))
  const out = { added: [], changed: [], removed: [], unchanged: 0, unknown: [], switched_off: [], ambiguous: [], errors: [] }
  const seen = new Map()   // item_id -> the basket code that has it
  const label = q => [q.product_name, packLabel(q)].filter(Boolean).join(' \u00b7 ')
  for (const b of basket || []) {
    const all = byCode.get(b.code.toLowerCase()) || []
    const live = all.filter(q => q.live)
    const at = { rows: b.rows, code: b.code }
    if (!all.length) { out.unknown.push({ ...at, qty: b.qty, ...(b.name ? { name: b.name } : {}) }); continue }
    if (!live.length) { out.switched_off.push({ ...at, item_name: all[0].item_name }); continue }
    if (live.length > 1) { out.ambiguous.push({ ...at, items: [...new Set(live.map(q => q.item_name))] }); continue }
    const q = live[0]
    if (seen.has(q.item_id)) {
      out.errors.push({ ...at, error: `${seen.get(q.item_id)} is ${q.item_name} too: an order has one line for each item` })
      continue
    }
    seen.set(q.item_id, q.supplier_code)
    const line = lineBy.get(q.item_id)
    // What will be ordered: the basket's quantity, up to the minimum and
    // steps here (as placing the order does), saying so when it changes.
    const problem = b.qty > 0 ? qtyProblem(b.qty, q) : null
    const entry = { ...at, code: q.supplier_code, item_id: q.item_id, item_name: q.item_name, quote_id: q.id, pack: label(q),
      qty: b.qty > 0 ? fitQty(b.qty, q) : 0, ...(problem ? { basket_qty: b.qty, qty_problem: problem } : {}) }
    if (!line) {
      if (b.qty > 0) out.added.push(entry)
      else out.unchanged++
      continue
    }
    if (!(b.qty > 0)) { out.removed.push({ ...entry, qty: num(line.qty) }); continue }
    if (line.quote?.id === q.id) {
      if (Math.abs(num(line.qty) - entry.qty) < 1e-9) out.unchanged++
      else out.changed.push({ ...entry, from_qty: num(line.qty) })
    } else {
      out.changed.push({
        ...entry, from_qty: num(line.qty),
        from: line.quote ? { supplier_name: line.quote.supplier_name, code: line.quote.supplier_code || null, pack: label(line.quote) } : null,
      })
    }
  }
  if (removeMissing) {
    for (const l of lineBy.values()) {
      if (seen.has(l.item_id) || !l.quote || l.quote.supplier_id !== supplierId) continue
      out.removed.push({ item_id: l.item_id, item_name: l.item_name, quote_id: l.quote.id, code: l.quote.supplier_code || null,
        pack: label(l.quote), qty: num(l.qty) })
    }
  }
  return out
}

/**
 * The first delivery date an order placed now can make.
 * now = { date: 'YYYY-MM-DD', time: 'HH:MM' } at the venue.
 * Past the cutoff counts as ordering tomorrow; then lead_days; then the next
 * delivery day (any day when the supplier lists none).
 */
export function nextDeliveryDate({ delivery_days, cutoff_time, lead_days = 1 }, now) {
  let orderDay = now.date
  const cut = cutoff_time ? String(cutoff_time).slice(0, 5) : null
  if (cut && now.time >= cut) orderDay = addDays(orderDay, 1)   // at the cutoff it has passed (minutesToCutoff() <= 0)
  let d = addDays(orderDay, num(lead_days))
  const days = (delivery_days || []).map(Number)
  if (!days.length) return d
  for (let i = 0; i < 14; i++) {
    if (days.includes(weekdayOf(d))) return d
    d = addDays(d, 1)
  }
  return d
}

/**
 * The supplier's next few delivery dates, starting from its next possible
 * one (`next_delivery`, already past today's cutoff when that has gone):
 * the quick choices when placing an order. Every day counts when the
 * supplier has no delivery days set.
 */
export function deliveryDateChoices({ delivery_days, next_delivery }, count = 4) {
  if (!next_delivery) return []
  const days = (delivery_days || []).map(Number)
  const out = []
  let d = next_delivery
  for (let i = 0; i < 28 && out.length < count; i++) {
    if (!days.length || days.includes(weekdayOf(d))) out.push(d)
    d = addDays(d, 1)
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_PLURALS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/** "Tue 4 Nov" for a YYYY-MM-DD date. */
export function dayText(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number)
  if (!y || !m || !d) return String(dateStr || '')
  return `${DAY_LABELS[weekdayOf(dateStr)]} ${d} ${MONTHS[m - 1]}`
}

/**
 * The last moment an order can go in for delivery on `date`, with a
 * supplier's settings for the venue ({ cutoff_time, lead_days },
 * supplierForVenue()): lead_days before, by the cutoff time; time null =
 * any time that day (no cutoff). The rule nextDeliveryDate() follows.
 */
export function orderDeadline({ cutoff_time, lead_days = 1 } = {}, date) {
  return { date: addDays(date, -num(lead_days)), time: cutoff_time ? String(cutoff_time).slice(0, 5) : null }
}

/**
 * Whether the order deadline for a delivery date has passed at `now`
 * ({ date, time } at the venue): after the deadline day, or on it from the
 * cutoff minute. Without a cutoff the whole deadline day counts.
 */
export function deadlinePassed(settings, date, now) {
  if (!date || !now?.date) return false
  const dl = orderDeadline(settings, date)
  return dl.date < now.date || (dl.date === now.date && !!dl.time && String(now.time) >= dl.time)
}

// "today" / "tomorrow" / "yesterday" next to `now` (when given), else "Mon 3 Nov".
function nearDay(date, now) {
  if (now?.date) {
    if (date === now.date) return 'today'
    if (date === addDays(now.date, 1)) return 'tomorrow'
    if (date === addDays(now.date, -1)) return 'yesterday'
  }
  return dayText(date)
}

function deadlineWords(d, now) {
  const day = nearDay(d.date, now)
  if (!d.time) return `the end of ${day}`
  return day.includes(' ') ? `${day} ${d.time}` : `${d.time} ${day}`
}

/**
 * "order by Mon 3 Nov 18:00", "order by 18:00 tomorrow", "order by the end
 * of today" (no cutoff). now ({ date } at the venue) gives today and
 * tomorrow their names.
 */
export function deadlineText(settings, date, now) {
  return 'order by ' + deadlineWords(orderDeadline(settings, date), now)
}

/**
 * Whether an order can still be delivered on `date` (now = { date, time }
 * at the venue): null when it can, else { code, message }:
 *   past              before today: never
 *   not_delivery_day  the supplier lists delivery days and this isn't one
 *   late              its order deadline (orderDeadline()) has passed
 * Placing for a not_delivery_day or late day needs the person to say it was
 * agreed with the supplier (the API takes `agreed`); a past day never goes.
 */
export function deliveryDayProblem(settings = {}, date, now, name = 'The supplier') {
  if (!date) return null
  if (now?.date && date < now.date) return { code: 'past', message: `${dayText(date)} is in the past` }
  const days = (settings.delivery_days || []).map(Number)
  if (days.length && !days.includes(weekdayOf(date))) {
    const list = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => DAY_LABELS[d]).join(', ')
    return { code: 'not_delivery_day', message: `${name} doesn't deliver on ${DAY_PLURALS[weekdayOf(date)]} (they deliver ${list})` }
  }
  if (now?.date && deadlinePassed(settings, date, now)) {
    const dl = orderDeadline(settings, date)
    return {
      code: 'late',
      message: dl.time
        ? `Too late for ${dayText(date)}: ${name}'s cutoff for it was ${deadlineWords(dl, now)}`
        : `Too late for ${dayText(date)}: it had to be ordered by ${deadlineWords(dl, now)}`,
    }
  }
  return null
}

// ── Out of stock (migration 234) ─────────────────────────────────

/**
 * Whether a supplier price can't be delivered on `date` (YYYY-MM-DD)
 * because the supplier said it's out of stock: null when it can (nothing
 * set, no date to judge, or the date is on or after out_of_stock_until,
 * the first day it can be delivered again), else { until, note }. A date
 * that has passed simply means it is back: nothing has to clear it.
 */
export function outOfStock(quote, date) {
  const until = quote?.out_of_stock_until ? String(quote.out_of_stock_until).slice(0, 10) : null
  if (!until || !date || String(date).slice(0, 10) >= until) return null
  return { until, note: quote.out_of_stock_note || null }
}

/**
 * "Out of stock at Brakes until Mon 10 Nov" for a price that can't be
 * delivered on `date` (outOfStock()), else null. The supplier's name is
 * left out when not given.
 */
export function outOfStockText(quote, date, supplierName) {
  const o = outOfStock(quote, date)
  if (!o) return null
  return `Out of stock${supplierName ? ` at ${supplierName}` : ''} until ${dayText(o.until)}`
}

/** The date and time now in a time zone: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function nowAt(tz, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${m.hour}:${m.minute}` }
}

/** Is it still before today's cutoff? (null when the supplier has no cutoff.) */
export function minutesToCutoff(cutoffTime, now) {
  if (!cutoffTime) return null
  const [h, m] = String(cutoffTime).slice(0, 5).split(':').map(Number)
  const [nh, nm] = String(now.time).split(':').map(Number)
  return h * 60 + m - (nh * 60 + nm)
}

export function poNumberLabel(n) {
  return 'PO-' + String(n ?? 0).padStart(5, '0')
}
