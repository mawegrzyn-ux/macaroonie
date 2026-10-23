// shared/pos/ticketLayout.js
//
// Printed kitchen tickets and receipts as designs (migration 190): an
// ordered list of blocks, each with its options. A design is company wide
// (print_designs); each location picks which design prints where
// (print_design_uses) and can change a design's words or hide its blocks
// (print_design_variations). shared/pos/tickets.js draws a ticket from the
// layout this file normalises; with no design the built-in layouts below
// draw exactly what tickets looked like before designs.
//
// A layout: { blocks: [{ id, type, opts }] }

export const LAYOUT_KINDS = ['kitchen', 'receipt']

// Where a design prints. kiosk_receipt falls back to receipt.
export const PRINT_USES = [
  { key: 'kitchen', kind: 'kitchen', label: 'Kitchen tickets' },
  { key: 'receipt', kind: 'receipt', label: 'Till receipts and bills' },
  { key: 'kiosk_receipt', kind: 'receipt', label: 'Kiosk receipts' },
]
export const USE_KEYS = PRINT_USES.map(u => u.key)
export const kindOfUse = use => PRINT_USES.find(u => u.key === use)?.kind || null

// What a ticket's title can show (shared/orderInfo.js); auto = the table, or
// the counter order's number with its name under it, as before designs.
export const TITLE_MAINS = ['auto', 'number', 'tent', 'table', 'name']
export const SIZES = ['normal', 'tall', 'big']
export const ALIGNS = ['left', 'center', 'right']

// Details a kitchen ticket or receipt can list, in this order.
export const KITCHEN_FIELDS = [
  { key: 'type', label: 'Order type' },
  { key: 'tent', label: 'Tent number' },
  { key: 'table', label: 'Table' },
  { key: 'name', label: 'Customer name' },
  { key: 'number', label: 'Order number' },
  { key: 'covers', label: 'Covers' },
  { key: 'server', label: 'Server' },
  { key: 'check', label: 'Check number' },
  { key: 'time', label: 'Time sent' },
]
export const RECEIPT_FIELDS = [
  { key: 'where', label: 'Table or tab' },
  { key: 'check', label: 'Check number' },
  { key: 'server', label: 'Served by' },
  { key: 'covers', label: 'Covers' },
  { key: 'type', label: 'Order type and name' },
  { key: 'tent', label: 'Tent number' },
  { key: 'date', label: 'Date and time' },
]

// Block types per kind: label, what it is for, and its options' defaults.
export const BLOCK_TYPES = {
  kitchen: {
    station: { label: 'Station name', hint: 'The printer or station the ticket is for, e.g. GRILL.', opts: { size: 'normal' } },
    title: { label: 'Order title', hint: 'What shows big: the table or order number, or the tent, table or name.', opts: { main: 'auto', size: 'big', invert: false } },
    details: { label: 'Details', hint: 'Order type, tent, covers, server and more, on one line.', opts: { fields: ['covers', 'server', 'check'], style: 'plain', size: 'normal' } },
    items: { label: 'Dishes', hint: 'The dishes by course, with their options, notes and allergies.', opts: { size: 'tall', seats: true } },
    text: { label: 'Text', hint: 'Your own words.', opts: { text: '', align: 'center', size: 'normal', bold: false } },
    rule: { label: 'Line', hint: 'A line across the ticket.', opts: { char: '-' } },
    space: { label: 'Space', hint: 'Blank lines.', opts: { lines: 1 } },
  },
  receipt: {
    venue: { label: 'Location name and address', hint: 'From Store tech > Receipts and payments: receipt name, address and VAT number.', opts: { name: true, address: true, vat: true, size: 'big' } },
    heading: { label: 'Receipt or bill heading', hint: 'Words over the details, different on a bill and a receipt.', opts: { receipt_text: '', bill_text: 'BILL - NOT A RECEIPT', size: 'normal' } },
    title: { label: 'Order title', hint: 'A big order number, tent or table, for counter and kiosk orders.', opts: { main: 'auto', size: 'big', invert: false } },
    details: { label: 'Details', hint: 'Table, check, server, covers, order type, tent, date and time.', opts: { fields: ['where', 'check', 'server', 'covers', 'type', 'tent', 'date'] } },
    items: { label: 'Dishes', hint: 'The dishes with their prices, and priced extras under them.', opts: { extras: true } },
    totals: { label: 'Totals', hint: 'Subtotal, discounts, service charge and the total.', opts: { subtotal: true, size: 'tall' } },
    vat: { label: 'VAT', hint: 'VAT by rate.', opts: {} },
    payments: { label: 'Payments', hint: 'How it was paid, and change. Not on a bill.', opts: {} },
    footer: { label: 'Footer', hint: 'Words at the bottom, different on a bill and a receipt.', opts: { receipt_text: 'Thank you', bill_text: '' } },
    text: { label: 'Text', hint: 'Your own words.', opts: { text: '', align: 'center', size: 'normal', bold: false } },
    rule: { label: 'Line', hint: 'A line across the receipt.', opts: { char: '-' } },
    space: { label: 'Space', hint: 'Blank lines.', opts: { lines: 1 } },
  },
}

// Words a location can change, per block type (variations' texts).
export const TEXT_KEYS = { text: ['text'], heading: ['receipt_text', 'bill_text'], footer: ['receipt_text', 'bill_text'] }

export const MAX_BLOCKS = 40
const MAX_TEXT = 300

/** The layouts tickets had before designs. */
export function defaultLayout(kind) {
  if (kind === 'kitchen') {
    return {
      blocks: [
        { id: 'k1', type: 'station', opts: { size: 'normal' } },
        { id: 'k2', type: 'title', opts: { main: 'auto', size: 'big', invert: false } },
        { id: 'k3', type: 'details', opts: { fields: ['type', 'tent'], style: 'band', size: 'tall' } },
        { id: 'k4', type: 'details', opts: { fields: ['covers', 'server', 'check'], style: 'plain', size: 'normal' } },
        { id: 'k5', type: 'details', opts: { fields: ['time'], style: 'plain', size: 'normal' } },
        { id: 'k6', type: 'items', opts: { size: 'tall', seats: true } },
      ],
    }
  }
  return {
    blocks: [
      { id: 'r1', type: 'venue', opts: { name: true, address: true, vat: true, size: 'big' } },
      { id: 'r2', type: 'space', opts: { lines: 1 } },
      { id: 'r3', type: 'heading', opts: { receipt_text: '', bill_text: 'BILL - NOT A RECEIPT', size: 'normal' } },
      { id: 'r4', type: 'details', opts: { fields: ['where', 'check', 'server', 'covers', 'type', 'tent', 'date'] } },
      { id: 'r5', type: 'rule', opts: { char: '-' } },
      { id: 'r6', type: 'items', opts: { extras: true } },
      { id: 'r7', type: 'rule', opts: { char: '-' } },
      { id: 'r8', type: 'totals', opts: { subtotal: true, size: 'tall' } },
      { id: 'r9', type: 'vat', opts: {} },
      { id: 'r10', type: 'payments', opts: {} },
      { id: 'r11', type: 'space', opts: { lines: 1 } },
      { id: 'r12', type: 'footer', opts: { receipt_text: 'Thank you', bill_text: '' } },
    ],
  }
}

const oneOf = (v, list, d) => (list.includes(v) ? v : d)
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '')
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const cleanId = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null)

function cleanOpts(kind, type, raw = {}) {
  const d = BLOCK_TYPES[kind][type].opts
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const fieldKeys = (kind === 'kitchen' ? KITCHEN_FIELDS : RECEIPT_FIELDS).map(f => f.key)
  switch (type) {
    case 'station': return { size: oneOf(o.size, SIZES, d.size) }
    case 'title': return { main: oneOf(o.main, TITLE_MAINS, d.main), size: oneOf(o.size, SIZES, d.size), invert: bool(o.invert, d.invert) }
    case 'details': {
      const fields = Array.isArray(o.fields) ? fieldKeys.filter(k => o.fields.includes(k)) : d.fields
      return kind === 'kitchen'
        ? { fields, style: oneOf(o.style, ['plain', 'band'], d.style), size: oneOf(o.size, SIZES, d.size) }
        : { fields }
    }
    case 'items': return kind === 'kitchen'
      ? { size: oneOf(o.size, ['normal', 'tall'], d.size), seats: bool(o.seats, d.seats) }
      : { extras: bool(o.extras, d.extras) }
    case 'text': return { text: str(o.text), align: oneOf(o.align, ALIGNS, d.align), size: oneOf(o.size, SIZES, d.size), bold: bool(o.bold, d.bold) }
    case 'rule': return { char: oneOf(o.char, ['-', '='], d.char) }
    case 'space': return { lines: Math.max(1, Math.min(5, Math.round(Number(o.lines) || d.lines))) }
    case 'venue': return { name: bool(o.name, d.name), address: bool(o.address, d.address), vat: bool(o.vat, d.vat), size: oneOf(o.size, SIZES, d.size) }
    case 'heading': return { receipt_text: typeof o.receipt_text === 'string' ? str(o.receipt_text) : d.receipt_text, bill_text: typeof o.bill_text === 'string' ? str(o.bill_text) : d.bill_text, size: oneOf(o.size, SIZES, d.size) }
    case 'footer': return { receipt_text: typeof o.receipt_text === 'string' ? str(o.receipt_text) : d.receipt_text, bill_text: typeof o.bill_text === 'string' ? str(o.bill_text) : d.bill_text }
    case 'totals': return { subtotal: bool(o.subtotal, d.subtotal), size: oneOf(o.size, ['normal', 'tall'], d.size) }
    default: return {}
  }
}

// Blocks a design can't do without: a kitchen ticket's dishes, a receipt's
// dishes and total. Added at the end when missing; a location can't hide them.
export const REQUIRED_BLOCKS = { kitchen: ['items'], receipt: ['items', 'totals'] }

/** A layout tidied: known block types for the kind, options checked, unique ids. Nothing usable = the built-in layout. */
export function normaliseLayout(kind, raw) {
  if (!LAYOUT_KINDS.includes(kind)) throw new Error('Unknown print design kind: ' + kind)
  const list = Array.isArray(raw?.blocks) ? raw.blocks : null
  if (!list) return defaultLayout(kind)
  const seen = new Set()
  const blocks = []
  for (const b of list.slice(0, MAX_BLOCKS)) {
    if (!b || !BLOCK_TYPES[kind][b.type]) continue
    let id = cleanId(b.id)
    if (!id || seen.has(id)) {
      let n = blocks.length + 1
      while (seen.has('b' + n)) n++
      id = 'b' + n
    }
    seen.add(id)
    blocks.push({ id, type: b.type, opts: cleanOpts(kind, b.type, b.opts) })
  }
  for (const type of REQUIRED_BLOCKS[kind]) {
    if (blocks.some(b => b.type === type)) continue
    let n = blocks.length + 1
    while (seen.has('b' + n)) n++
    seen.add('b' + n)
    blocks.push({ id: 'b' + n, type, opts: cleanOpts(kind, type, {}) })
  }
  return { blocks }
}

/** Whether a block can be taken out of a design or hidden at a location. */
export const canRemove = (kind, b) => !REQUIRED_BLOCKS[kind]?.includes(b.type)

/** What a location changes in a design, tidied: { texts: { [blockId]: { key: text } }, hidden: [blockId] }. */
export function normaliseVariation(layout, raw) {
  const ids = new Map((layout?.blocks || []).map(b => [b.id, b]))
  const texts = {}
  for (const [id, t] of Object.entries(raw?.texts && typeof raw.texts === 'object' ? raw.texts : {})) {
    const b = ids.get(id)
    if (!b || !TEXT_KEYS[b.type] || !t || typeof t !== 'object') continue
    const keep = {}
    for (const k of TEXT_KEYS[b.type]) if (typeof t[k] === 'string') keep[k] = str(t[k])
    if (Object.keys(keep).length) texts[id] = keep
  }
  const hidden = [...new Set((Array.isArray(raw?.hidden) ? raw.hidden : []).filter(id => ids.has(id) && !REQUIRED_BLOCKS.kitchen.concat(REQUIRED_BLOCKS.receipt).includes(ids.get(id).type)))]
  return { texts, hidden }
}

/** A design's layout as one location prints it: its words, its hidden blocks left out. */
export function applyVariation(layout, variation) {
  if (!variation) return layout
  const hidden = new Set(variation.hidden || [])
  return {
    blocks: (layout.blocks || []).filter(b => !hidden.has(b.id)).map(b => (
      variation.texts?.[b.id] ? { ...b, opts: { ...b.opts, ...variation.texts[b.id] } } : b
    )),
  }
}

/** A short line saying what a block shows, for lists in the designer. */
export function blockSummary(kind, b) {
  const o = b.opts || {}
  const fieldLabel = k => ((kind === 'kitchen' ? KITCHEN_FIELDS : RECEIPT_FIELDS).find(f => f.key === k)?.label || k)
  switch (b.type) {
    case 'title': return o.main === 'auto' ? 'Table, or order number and name' : ({ number: 'Order number', tent: 'Tent number', table: 'Table', name: 'Customer name' })[o.main]
    case 'details': return (o.fields || []).map(fieldLabel).join(', ') || 'Nothing picked'
    case 'text': return o.text || 'No words yet'
    case 'heading': case 'footer': return [o.receipt_text && 'Receipt: ' + o.receipt_text, o.bill_text && 'Bill: ' + o.bill_text].filter(Boolean).join(' · ') || 'Nothing'
    case 'rule': return o.char === '=' ? 'Double line' : 'Single line'
    case 'space': return o.lines + (o.lines === 1 ? ' line' : ' lines')
    case 'venue': return ['name', 'address', 'vat'].filter(k => o[k]).map(k => ({ name: 'Name', address: 'Address', vat: 'VAT number' })[k]).join(', ')
    default: return BLOCK_TYPES[kind][b.type]?.hint || ''
  }
}

// Made-up orders for the designer's preview.
export const SAMPLES = {
  kitchen: [
    { key: 'table', label: 'Table order' },
    { key: 'counter', label: 'Counter order with a tent' },
    { key: 'void', label: 'A dish voided' },
  ],
  receipt: [
    { key: 'receipt', label: 'Table receipt' },
    { key: 'bill', label: 'Table bill' },
    { key: 'counter', label: 'Counter receipt with a tent' },
  ],
}

/** A sample send (kitchen) or bill (receipt) for shared/pos/tickets.js. venue: { name, address, vatNumber }. */
export function sampleTicket(kind, key, venue = {}, at = new Date()) {
  if (kind === 'kitchen') {
    const base = { station: 'Grill', checkNo: '23', sentAt: at }
    if (key === 'counter') {
      return { ...base, tab: 'ORDER 57', number: 57, name: 'Sam', tabName: 'Sam', type: 'Take out', tent: '12', server: 'Jo',
        courses: [{ name: '', lines: [{ qty: 2, name: 'Smash burger', modifiers: [{ kind: 'remove', text: 'No onion' }, { kind: 'add', text: 'Extra cheese' }] }, { qty: 1, name: 'Burger meal', modifiers: [{ kind: 'part', text: 'Cheeseburger' }, { kind: 'part', text: 'Fries' }] }] }] }
    }
    if (key === 'void') {
      return { ...base, void: true, table: '4', covers: 2, server: 'Jo', type: 'Eat in', courses: [{ name: 'Mains', lines: [{ qty: 1, name: 'Ribeye steak' }] }] }
    }
    return { ...base, table: '4', covers: 2, server: 'Jo', type: 'Eat in',
      courses: [
        { name: 'Starters', lines: [{ qty: 1, name: 'Chicken wings', seat: 1, modifiers: [{ kind: 'add', text: 'Hot sauce' }] }, { qty: 1, name: 'Soup of the day', seat: 2, note: 'Bread on the side' }] },
        { name: 'Mains', hold: true, lines: [{ qty: 1, name: 'Ribeye steak', seat: 1, modifiers: [{ kind: 'add', text: 'Medium rare' }], allergies: ['milk'] }, { qty: 1, name: 'Pad Thai', seat: 2, modifiers: [{ kind: 'remove', text: 'No peanuts' }], allergies: ['peanuts'] }] },
      ] }
  }
  const v = { name: venue.name || 'Your restaurant', address: venue.address?.length ? venue.address : ['1 High Street', 'Town AB1 2CD'], vatNumber: venue.vatNumber ?? 'GB 123 4567 89' }
  if (key === 'counter') {
    return { venue: v, tab: 'ORDER 57', number: 57, name: 'Sam', tabName: 'Sam', type: 'Take out', tent: '12', checkNo: '57', server: 'Jo', at,
      lines: [{ qty: 2, name: 'Smash burger', total: 1900, modifiers: [{ text: 'Extra cheese', price: 200 }] }, { qty: 1, name: 'Cola', total: 300, modifiers: [] }],
      discounts: [], serviceCharge: null, total: 2400, vat: [{ rate: 20, net: 2000, vat: 400 }], payments: [{ tender: 'Card', amount: 2400 }], change: 0 }
  }
  const bill = key === 'bill'
  return { venue: v, table: '4', checkNo: '23', server: 'Jo', covers: 2, at, preBill: bill,
    lines: [{ qty: 1, name: 'Chicken wings', total: 750, modifiers: [{ text: 'Hot sauce', price: 50 }] }, { qty: 1, name: 'Ribeye steak', total: 2400, modifiers: [] }, { qty: 2, name: 'House red (glass)', total: 1300, modifiers: [] }],
    discounts: [{ name: 'Locals 10%', amount: 450 }], serviceCharge: { label: 'Service charge 12.5%', amount: 506 }, total: 4556,
    vat: [{ rate: 20, net: 3797, vat: 759 }], payments: bill ? [] : [{ tender: 'Card', amount: 4556 }, { tender: 'Cash', amount: 500 }], change: bill ? 0 : 500 }
}
