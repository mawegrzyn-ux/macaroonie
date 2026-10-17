// src/ai/tools/purchasing.js
//
// Purchasing tools for staff (migration 153): the admin assistant panel and
// the staff MCP connector, next to the booking and H&S tools. What they
// cover, and the permission each needs (the same modules as the pages):
//
//   find_inventory_items    items with their supplier prices           purchasing_setup, view
//   list_suppliers          suppliers, or one supplier in full         purchasing_setup, view
//   order_lists             order lists, or one list's items and pars  either module, view (a list's
//                                                                       items: purchasing_setup, view)
//   order_form              a venue's draft order for a list           either module, view
//   purchase_orders         purchase orders, or one in full            either module, view
//
//   add_inventory_item      new item, optionally with prices           purchasing_setup, manage
//   update_inventory_item   rename, category, storage, switch off ...  purchasing_setup, manage
//   add_supplier_price      new supplier price (pack + price)          purchasing_setup, manage
//   update_supplier_price   change a price, pack, venue price ...      purchasing_setup, manage
//   set_preferred_supplier  which price an item is ordered on          purchasing_setup, manage
//   add_supplier / update_supplier                                     purchasing_setup, manage
//   create_order_list / update_order_list / set_pars                   purchasing_setup, manage
//   import_price_list       CSV attached in the chat, or rows read
//                           from a PDF / photo; dry run on the card    purchasing_setup, manage
//
//   update_order            quantities on the draft (not sent)         purchasing, manage
//   place_order             one purchase order per supplier, emailed
//                           to suppliers that take email               purchasing, manage
//   send_purchase_order     email it, or mark it sent another way      purchasing, manage
//   change_purchase_order   delivery date, notes, quantities           purchasing, manage
//   cancel_purchase_order                                              purchasing, manage
//   receive_delivery        what arrived, checks, temperatures; also
//                           writes the H&S delivery check              purchasing, manage
//
// Every read and change goes through the admin routes in-process (callApi)
// with the caller's own login, so the routes' permission checks, tenant
// filters and price hiding are the admin's: a person without Purchasing
// setup view never sees a price. The few direct reads (venues, a purchase
// order number, supplier delivery settings, chat attachments) filter
// tenant_id themselves. Change tools are `confirm` tools: in a chat the
// person sees a card built from the same plan run() uses, and nothing is
// written until they press Confirm. Every change is audited.
//
// Items, suppliers, lists, prices and order lines are named the way staff
// say them (pickByName in util.js). Quantities on orders are packs of the
// supplier's pack (cases, bags), the same as the Purchasing page.

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import {
  ToolError, callApi, audit, requireStaffPermission, staffPermissionLevel, levelAtLeast,
} from '../context.js'
import {
  UNITS, PO_STATUSES, RECEIVE_STATUSES, DAY_LABELS, DELIVERY_TEMP_MAX,
  packBaseQty, packLabel, fmtNum, formatBase, perUnitLabel, unitPrice, quotePrice, chooseQuote,
  fitQty, qtyProblem, packsToPar, lineAmounts, orderTotals, supplierForVenue, nextDeliveryDate,
  minutesToCutoff, deliveryTempOk, receiveStatusFor, poNumberLabel, weekdayOf,
} from '../../../../shared/procurement.js'
import { DateStr, TimeStr, localParts, longDate, pickByName } from './util.js'

const Id = z.string().uuid()
const PackUnit = z.enum(Object.keys(UNITS))
const BaseUnitIn = z.enum(['g', 'kg', 'ml', 'cl', 'l', 'each'])
const Storage = z.enum(['ambient', 'chilled', 'frozen'])
const SendBy = z.enum(['email', 'print', 'excel', 'pdf'])
const DayNames = z.array(z.string().max(10)).max(7)
const Qty = z.number().min(0).max(100000)

const BASE_FOR = { g: 'g', kg: 'g', ml: 'ml', cl: 'ml', l: 'ml', each: 'each' }
const COUNTED = { g: 'by weight (g / kg)', ml: 'by volume (ml / l)', each: 'by count (each)' }
const HOW = { venue: 'the venue\'s choice', default: 'the company choice', cheapest: 'cheapest per unit' }
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const hhmm = t => (t ? String(t).slice(0, 5) : null)
const round4 = n => Math.round(Number(n) * 10000) / 10000
const show = v => (v === null || v === undefined || v === '' ? 'none' : String(v))
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)

function money(n, cur) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP' }).format(Number(n))
  } catch {
    return Number(n).toFixed(2)
  }
}

/** "£12.50 ex VAT (£2.08 per kg)" */
function priceText(q, price, baseUnit, cur) {
  const per = unitPrice(price, q.pack_base_qty, baseUnit)
  return money(price, cur) + ' ex VAT' + (per != null && Number.isFinite(per) ? ' (' + money(per, cur) + ' per ' + perUnitLabel(baseUnit) + ')' : '')
}

const quoteLabel = q => q.pack_label || packLabel(q)
const quoteName = q => q.supplier_name + ', ' + quoteLabel(q) + (q.supplier_code ? ' [' + q.supplier_code + ']' : '')

function parseDays(names) {
  if (names === null || names === undefined) return names
  const days = names.map(n => {
    const i = DAY_KEYS.indexOf(String(n).trim().toLowerCase().slice(0, 3))
    if (i < 0) throw new ToolError('Unknown day "' + n + '". Use Mon, Tue, Wed, Thu, Fri, Sat or Sun.', 422)
    return i
  })
  return [...new Set(days)].sort((a, b) => a - b)
}
const daysText = days => (days && days.length ? days.map(d => DAY_LABELS[d]).join(', ') : 'any day')

function sendText(s) {
  if (s.send_method === 'email') {
    return 'email' + (s.email ? ' to ' + s.email : ' (no email address yet)') +
      (s.email_attachment === 'pdf' ? ' with a PDF' : s.email_attachment === 'excel' ? ' with an Excel file' : '')
  }
  return ({ print: 'printed', excel: 'Excel file', pdf: 'PDF file' })[s.send_method] + ', sent by staff'
}

/** A par in packs of the list's company-choice price, else in the base unit. */
function parText(base, quote, baseUnit) {
  if (base === null || base === undefined) return 'none'
  const pb = Number(quote?.pack_base_qty)
  return pb > 0 ? fmtNum(base / pb) + ' packs (' + formatBase(base, baseUnit) + ')' : formatBase(base, baseUnit)
}

// ── Access ─────────────────────────────────────────────────

/** Read access to purchasing: either module. Says whether prices show. */
async function requireRead(ctx) {
  const [order, setup] = await Promise.all([
    staffPermissionLevel(ctx, 'purchasing'), staffPermissionLevel(ctx, 'purchasing_setup'),
  ])
  if (!levelAtLeast(order, 'view') && !levelAtLeast(setup, 'view')) {
    throw new ToolError('You don\'t have permission to see purchasing. Ask an owner or admin.', 403)
  }
  return { prices: levelAtLeast(setup, 'view'), canOrder: order === 'manage' }
}

const requireSetup = ctx => requireStaffPermission(ctx, 'purchasing_setup', 'manage')
const requireOrder = ctx => requireStaffPermission(ctx, 'purchasing', 'manage')

/** Runs a change and writes the audit row either way. */
async function audited(ctx, tool, input, fn) {
  try {
    const result = await fn()
    await audit(ctx, { tool, input, ok: true, result })
    return result
  } catch (err) {
    await audit(ctx, { tool, input, ok: false, result: { error: err.message } })
    throw err
  }
}

// ── Venues ─────────────────────────────────────────────────

async function tenantVenues(ctx) {
  return withTenant(ctx.tenantId, tx => tx`
    SELECT id, name, timezone, currency FROM venues
     WHERE tenant_id = ${ctx.tenantId} AND is_active = true ORDER BY name
  `)
}

async function venueOf(ctx, id) {
  const [v] = await withTenant(ctx.tenantId, tx => tx`
    SELECT id, name, timezone, currency FROM venues
     WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND is_active = true
  `)
  if (!v) throw new ToolError('Venue not found. Use list_venues.', 404)
  return v
}

const venueToday = venue => localParts(new Date(), venue.timezone).date

// ── Catalogue ──────────────────────────────────────────────

const loadItems = ctx => callApi(ctx, 'GET', '/api/inventory/items')
const loadSuppliers = ctx => callApi(ctx, 'GET', '/api/suppliers')
const loadCategories = ctx => callApi(ctx, 'GET', '/api/inventory/categories')
const loadLists = (ctx, venueId) => callApi(ctx, 'GET', '/api/purchasing/lists' + (venueId ? '?venue_id=' + venueId : ''))

/** An item by its code, id or name. */
function pickItem(items, text, what = 'inventory item') {
  const raw = String(text ?? '').trim()
  const byCode = items.filter(i => i.code && i.code.toLowerCase() === raw.toLowerCase())
  if (byCode.length === 1) return byCode[0]
  return pickByName(items, raw, i => i.name, what,
    'The inventory is empty. Add items with add_inventory_item or import_price_list.')
}

const pickSupplier = (suppliers, text) =>
  pickByName(suppliers, text, s => s.name, 'supplier', 'No suppliers yet. Add one with add_supplier.')

/**
 * One of an item's prices: by supplier name, then `which` (supplier code or
 * words of the pack, "6 x 2 kg", "box"). Asks when it is still ambiguous.
 */
function pickQuote(itemName, quotes, supplierText, which) {
  if (!quotes.length) throw new ToolError(itemName + ' has no supplier prices yet. Add one with add_supplier_price.', 404)
  let pool = quotes
  if (supplierText) {
    const sups = [...new Map(quotes.map(q => [q.supplier_id, { id: q.supplier_id, name: q.supplier_name }])).values()]
    const s = pickByName(sups, supplierText, x => x.name, 'supplier of ' + itemName)
    pool = quotes.filter(q => q.supplier_id === s.id)
  }
  if (which) {
    const w = String(which).trim().toLowerCase()
    const words = w.split(/[^a-z0-9.]+/).filter(Boolean)
    const hits = pool.filter(q => q.id === which || (q.supplier_code || '').toLowerCase() === w ||
      words.every(x => quoteLabel(q).toLowerCase().replace(/×/g, 'x').includes(x)))
    if (!hits.length) throw new ToolError('No price for ' + itemName + ' matches "' + which + '". Its prices: ' + pool.map(quoteName).join('; ') + '.', 404)
    pool = hits
  }
  if (pool.length === 1) return pool[0]
  throw new ToolError(itemName + ' has several prices' + (supplierText ? ' from ' + pool[0].supplier_name : '') + ': ' +
    pool.map(quoteName).join('; ') + '. Say which one (supplier, supplier code or pack).', 409)
}

function itemView(it, { venue, venueName, cur }) {
  const pref = it.preferred || { default: null, venues: {} }
  const live = it.quotes.filter(q => q.supplier_active !== false)
  const ordered = venue ? chooseQuote(live, venue.id, pref) : null
  return {
    item_id: it.id,
    name: it.name,
    ...(it.code ? { code: it.code } : {}),
    category: it.category_name ?? null,
    counted: COUNTED[it.base_unit],
    storage: it.storage,
    ...(it.is_active ? {} : { active: false }),
    on_order_lists: it.list_count,
    ...(it.notes ? { notes: it.notes } : {}),
    prices: it.quotes.map(q => {
      const chosenAt = Object.entries(pref.venues || {}).filter(([, qid]) => qid === q.id).map(([vid]) => venueName.get(vid) || 'a venue')
      const vp = Object.entries(q.venue_prices || {})
      return {
        quote_id: q.id,
        supplier: q.supplier_name + (q.supplier_active === false ? ' (supplier switched off)' : ''),
        ...(q.supplier_code ? { supplier_code: q.supplier_code } : {}),
        pack: packLabel(q),
        price: priceText(q, venue ? quotePrice(q, venue.id) : q.price, it.base_unit, cur),
        vat: fmtNum(q.vat_rate) + '%',
        ...(q.min_qty ? { minimum_packs: fmtNum(q.min_qty) } : {}),
        ...(q.order_multiple ? { in_steps_of: fmtNum(q.order_multiple) } : {}),
        ...(q.is_active ? {} : { active: false }),
        ...(vp.length ? { venue_prices: vp.map(([vid, p]) => (venueName.get(vid) || 'a venue') + ': ' + money(p, cur)) } : {}),
        ...(pref.default === q.id ? { company_choice: true } : {}),
        ...(chosenAt.length ? { chosen_at: chosenAt } : {}),
      }
    }),
    ...(venue ? {
      ordered_at_venue: ordered
        ? ordered.quote.supplier_name + ', ' + packLabel(ordered.quote) + ' (' + HOW[ordered.how] + ')'
        : 'no active supplier price',
    } : {}),
  }
}

function supplierSummary(s, cur) {
  return {
    supplier_id: s.id,
    name: s.name,
    ...(s.is_active ? {} : { active: false }),
    contact: [s.contact_name, s.phone, s.email].filter(Boolean).join(', ') || null,
    orders_go_by: sendText(s),
    order_cutoff: hhmm(s.cutoff_time) || 'none',
    lead_days: s.lead_days,
    delivery_days: daysText(s.delivery_days),
    ...(s.min_order != null ? { minimum_order: money(s.min_order, cur) } : {}),
    ...(s.delivery_charge ? { delivery_charge: money(s.delivery_charge, cur) } : {}),
    ...(s.quote_count != null ? { products: s.quote_count } : {}),
    ...(s.po_count != null ? { purchase_orders: s.po_count } : {}),
  }
}

/** Supplier settings the request maps onto the route's field names. */
const SupplierFields = {
  contact_name:     z.string().max(200).nullable().optional(),
  phone:            z.string().max(60).nullable().optional(),
  email:            z.string().max(200).nullable().optional().describe('Where purchase orders are emailed'),
  cc_emails:        z.string().max(1000).nullable().optional().describe('Other addresses copied on order emails, comma separated'),
  website:          z.string().max(500).nullable().optional(),
  account_ref:      z.string().max(100).nullable().optional().describe('Our account number with them'),
  send_by:          SendBy.optional().describe('How orders reach them: email (sent by the system), or print / excel / pdf (staff send it)'),
  email_attachment: z.enum(['none', 'pdf', 'excel']).optional(),
  order_cutoff:     TimeStr.nullable().optional().describe('Latest time to order for their next delivery, HH:MM'),
  lead_days:        z.number().int().min(0).max(30).optional().describe('Days from ordering to delivery'),
  delivery_days:    DayNames.optional().describe('Days they deliver, e.g. ["Mon", "Thu"]; [] = any day'),
  minimum_order:    z.number().min(0).max(1000000).nullable().optional(),
  delivery_charge:  z.number().min(0).max(1000000).nullable().optional(),
  notes:            z.string().max(4000).nullable().optional(),
}

function supplierBody(input) {
  const map = {
    contact_name: 'contact_name', phone: 'phone', email: 'email', cc_emails: 'cc_emails', website: 'website',
    account_ref: 'account_ref', send_by: 'send_method', email_attachment: 'email_attachment',
    order_cutoff: 'cutoff_time', lead_days: 'lead_days', minimum_order: 'min_order',
    delivery_charge: 'delivery_charge', notes: 'notes', name: 'name', active: 'is_active',
  }
  const body = {}
  for (const [k, f] of Object.entries(map)) if (input[k] !== undefined) body[f] = input[k]
  if (input.delivery_days !== undefined) body.delivery_days = parseDays(input.delivery_days)
  return body
}

const SUPPLIER_LABELS = {
  name: 'Name', contact_name: 'Contact', phone: 'Phone', email: 'Order email', cc_emails: 'Copy to',
  website: 'Website', account_ref: 'Account number', send_method: 'Orders go by', email_attachment: 'Email attachment',
  cutoff_time: 'Order cutoff', lead_days: 'Lead days', delivery_days: 'Delivery days', min_order: 'Minimum order',
  delivery_charge: 'Delivery charge', notes: 'Notes', is_active: 'Active',
}

function supplierValue(field, v, cur) {
  if (v === null || v === undefined || v === '') return 'none'
  if (field === 'delivery_days') return daysText(v)
  if (field === 'cutoff_time') return hhmm(v)
  if (field === 'min_order' || field === 'delivery_charge') return money(v, cur)
  if (field === 'is_active') return v ? 'yes' : 'no'
  return String(v)
}

/** Price fields as given by the person (pack_size = the route's pack_qty). */
const PriceFields = {
  pack_name:      z.string().max(60).optional().describe('Case, Box, Bag, Tub ...'),
  pack_count:     z.number().positive().max(100000).optional().describe('Units in the pack: 6 for "6 x 2 kg"; leave out for 1'),
  pack_size:      z.number().positive().max(10000000).describe('Size of one unit: 2 for "6 x 2 kg"'),
  pack_unit:      PackUnit,
  price:          z.number().min(0).max(10000000).describe('Price per pack, ex VAT'),
  vat_rate:       z.number().min(0).max(100).optional().describe('VAT %, default 0'),
  supplier_code:  z.string().max(100).optional().describe('The supplier\'s product code'),
  min_qty:        z.number().positive().max(100000).optional().describe('Fewest packs per order'),
  order_multiple: z.number().positive().max(100000).optional().describe('Packs are ordered in steps of this'),
}
const PriceInput = z.object({ supplier: z.string().min(1).max(200), ...PriceFields })

function quoteBody(p, supplierId) {
  return {
    supplier_id: supplierId,
    ...(p.supplier_code ? { supplier_code: p.supplier_code } : {}),
    ...(p.pack_name ? { pack_name: p.pack_name } : {}),
    pack_count: p.pack_count ?? 1,
    pack_qty: p.pack_size,
    pack_unit: p.pack_unit,
    price: p.price,
    ...(p.vat_rate !== undefined ? { vat_rate: p.vat_rate } : {}),
    ...(p.min_qty !== undefined ? { min_qty: p.min_qty } : {}),
    ...(p.order_multiple !== undefined ? { order_multiple: p.order_multiple } : {}),
  }
}

const specOf = p => ({ pack_name: p.pack_name || 'pack', pack_count: p.pack_count ?? 1, pack_qty: p.pack_size, pack_unit: p.pack_unit })

function checkFits(spec, baseUnit, itemName) {
  const pb = packBaseQty(spec, baseUnit)
  if (!pb) {
    throw new ToolError('A pack in ' + spec.pack_unit + ' doesn\'t fit ' + itemName + ', which is counted ' + COUNTED[baseUnit] + '.', 422)
  }
  return pb
}

function priceLines(p, supplierName, baseUnit, cur) {
  const spec = specOf(p)
  const pb = packBaseQty(spec, baseUnit)
  return [
    supplierName + ': ' + packLabel(spec) + ' at ' + priceText({ pack_base_qty: pb }, p.price, baseUnit, cur) +
      ', VAT ' + fmtNum(p.vat_rate ?? 0) + '%' + (p.supplier_code ? ', code ' + p.supplier_code : ''),
    ...(p.min_qty || p.order_multiple
      ? ['  ' + [p.min_qty ? 'minimum ' + fmtNum(p.min_qty) + ' packs' : null, p.order_multiple ? 'in steps of ' + fmtNum(p.order_multiple) : null].filter(Boolean).join(', ')]
      : []),
  ]
}

async function tenantCurrency(ctx) {
  const venues = await tenantVenues(ctx)
  return venues[0]?.currency || 'GBP'
}

// ── Import ─────────────────────────────────────────────────

const IMPORT_HEADINGS = ['Item', 'Category', 'Base unit', 'Storage', 'Item code', 'Supplier', 'Supplier code',
  'Pack', 'Pack count', 'Pack size', 'Pack unit', 'Price', 'VAT %']
const IMPORT_KEYS = ['item', 'category', 'counted_in', 'storage', 'item_code', 'supplier', 'supplier_code',
  'pack', 'pack_count', 'pack_size', 'pack_unit', 'price', 'vat']

const ImportRow = z.object({
  item:          z.string().min(1).max(200),
  category:      z.string().max(100).optional(),
  counted_in:    z.string().max(20).optional().describe('g, kg, ml, l or each; for new items'),
  storage:       Storage.optional(),
  item_code:     z.string().max(60).optional(),
  supplier:      z.string().max(200).optional().describe('Leave out to add the item with no price'),
  supplier_code: z.string().max(100).optional(),
  pack:          z.string().max(60).optional().describe('Case, Box, Bag ...'),
  pack_count:    z.number().positive().max(100000).optional(),
  pack_size:     z.number().positive().max(10000000).optional(),
  pack_unit:     z.string().max(20).optional().describe('g, kg, ml, cl, l or each'),
  price:         z.number().min(0).max(10000000).optional().describe('Per pack, ex VAT'),
  vat:           z.number().min(0).max(100).optional(),
})

const csvCell = v => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const toCsv = rows => [IMPORT_HEADINGS.join(','), ...rows.map(r => IMPORT_KEYS.map(k => csvCell(r[k])).join(','))].join('\n')

/** The file to import, base64: rows from the conversation, or a CSV / text file attached in this chat. */
async function importFile(ctx, input) {
  if (!!input.attached_file === !!input.rows?.length) {
    throw new ToolError('Give either attached_file (a CSV attached in this chat) or rows.', 422)
  }
  if (input.rows?.length) {
    return { file: Buffer.from(toCsv(input.rows), 'utf8').toString('base64'), source: 'the conversation' }
  }
  if (ctx.channel !== 'staff_chat' || !ctx.conversationId) {
    throw new ToolError('Attached files can only be imported in the chat. Send the products as rows instead.', 422)
  }
  const files = await withTenant(ctx.tenantId, tx => tx`
    SELECT id, filename, kind, data FROM ai_attachments
     WHERE tenant_id = ${ctx.tenantId} AND conversation_id = ${ctx.conversationId}
       AND user_sub = ${ctx.principal?.sub ?? ''}
     ORDER BY created_at
  `)
  const f = pickByName(files, input.attached_file, x => x.filename, 'attached file', 'No files are attached in this chat.')
  if (f.kind !== 'text') {
    throw new ToolError(f.filename + ' is ' + (f.kind === 'pdf' ? 'a PDF' : 'an image') +
      ', which can\'t be imported as it is. Read the products from it and pass them as rows.', 422)
  }
  return { file: Buffer.from(f.data).toString('base64'), source: f.filename }
}

// ── Orders ─────────────────────────────────────────────────

/** The order list an order is for: named, the venue's only list, or none. */
async function pickVenueList(ctx, venue, input) {
  if (input.without_list) return null
  const lists = await loadLists(ctx, venue.id)
  if (input.list) {
    return pickByName(lists, input.list, l => l.name, 'order list at ' + venue.name,
      'No order lists are set up for ' + venue.name + '. Set without_list to order items one by one.')
  }
  if (lists.length === 1) return lists[0]
  if (!lists.length) return null
  throw new ToolError('Which order list? ' + venue.name + ' has: ' + lists.map(l => l.name).join(', ') +
    '. Or set without_list to order items that are on no list.', 422)
}

/**
 * The venue's draft order for a list: the one already open, else (with
 * `create`) a new empty draft, the same as opening the list on the
 * Purchasing page. Items get `id` = item_id for pickByName.
 */
async function openOrder(ctx, venue, input, { create }) {
  const list = await pickVenueList(ctx, venue, input)
  const drafts = await callApi(ctx, 'GET', '/api/purchasing/orders?venue_id=' + venue.id + '&status=draft')
  const draft = drafts.find(o => (o.list_id ?? null) === (list?.id ?? null))
  let order = null
  if (draft) order = await callApi(ctx, 'GET', '/api/purchasing/orders/' + draft.id)
  else if (create) order = await callApi(ctx, 'POST', '/api/purchasing/orders', { body: { venue_id: venue.id, list_id: list?.id ?? null } })
  if (!order) return null
  order.items = order.items.map(i => ({ ...i, id: i.item_id }))
  return order
}

/** A line's item: on the order (by code or name), else from the catalogue. */
async function findOrderItem(ctx, venue, order, text) {
  const raw = String(text ?? '').trim()
  const byCode = order.items.filter(i => i.code && i.code.toLowerCase() === raw.toLowerCase())
  if (byCode.length === 1) return byCode[0]
  try {
    return pickByName(order.items, raw, i => i.name, 'item on this order')
  } catch (err) {
    if (err.status !== 404) throw err
  }
  const search = async q => callApi(ctx, 'GET', '/api/purchasing/venues/' + venue.id + '/catalog?search=' + encodeURIComponent(q))
  let hits = await search(raw)
  if (!hits.length) {
    const longest = raw.split(/[^A-Za-z0-9]+/).sort((a, b) => b.length - a.length)[0]
    if (longest && longest.length >= 3 && longest.toLowerCase() !== raw.toLowerCase()) hits = await search(longest)
  }
  if (!hits.length) throw new ToolError('No product called "' + raw + '" with an active supplier price.', 404)
  const h = pickByName(hits, raw, x => x.name, 'product')
  return {
    id: h.id, item_id: h.id, name: h.name, code: h.code, base_unit: h.base_unit, storage: h.storage,
    category_name: h.category_name ?? null, on_list: false, par_base: null, quote: h.quote, quotes: h.quotes, qty: 0,
  }
}

/** Suppliers' ordering settings at a venue, with the next delivery date. */
async function supplierInfo(ctx, venue, ids) {
  if (!ids.length) return {}
  const rows = await withTenant(ctx.tenantId, tx => tx`
    SELECT s.id, s.name, s.email, s.cc_emails, s.send_method, s.email_attachment,
           s.min_order::float8 AS min_order, s.cutoff_time::text AS cutoff_time, s.lead_days, s.delivery_days,
           s.account_ref, sv.account_ref AS v_account, sv.delivery_days AS v_days, sv.cutoff_time::text AS v_cutoff
      FROM suppliers s
      LEFT JOIN supplier_venues sv ON sv.supplier_id = s.id AND sv.venue_id = ${venue.id} AND sv.tenant_id = ${ctx.tenantId}
     WHERE s.tenant_id = ${ctx.tenantId} AND s.id = ANY(${ids}::uuid[])
  `)
  const now = localParts(new Date(), venue.timezone)
  return Object.fromEntries(rows.map(s => {
    const eff = supplierForVenue(s, { account_ref: s.v_account, delivery_days: s.v_days, cutoff_time: s.v_cutoff })
    return [s.id, { ...s, ...eff, next_delivery: nextDeliveryDate(eff, now), minutes_to_cutoff: minutesToCutoff(eff.cutoff_time, now) }]
  }))
}

function cutoffText(s) {
  if (!s.cutoff_time) return null
  return s.minutes_to_cutoff > 0
    ? 'order by ' + hhmm(s.cutoff_time) + ' today'
    : 'today\'s ' + hhmm(s.cutoff_time) + ' cutoff has passed'
}

function orderView(order, venue, sup, onlyQty) {
  const cur = venue.currency
  const items = order.items.filter(i => !onlyQty || i.qty > 0)
  return {
    order_id: order.id,
    venue: order.venue_name,
    list: order.list_name ?? 'no list (items added one by one)',
    status: 'draft, not sent to suppliers',
    today: longDate(order.today),
    ...(order.notes ? { notes: order.notes } : {}),
    lines_with_quantity: order.items.filter(i => i.qty > 0).length,
    items: items.map(i => ({
      item: i.name,
      ...(i.category_name ? { category: i.category_name } : {}),
      ...(i.on_list ? {} : { not_on_list: true }),
      ...(i.is_active === false ? { switched_off: true } : {}),
      supplier: i.quote ? i.quote.supplier_name : 'no supplier price',
      ...(i.quote ? { pack: i.quote.pack_label } : {}),
      quantity: i.qty,
      ...(i.par_packs != null ? { par: i.par_packs } : {}),
      ...(i.last ? { last_ordered: fmtNum(i.last.qty) + ' for ' + longDate(i.last.delivery_date) } : {}),
      ...(order.show_prices && i.quote ? { price: money(i.quote.price, cur) + ' ex VAT' } : {}),
      ...(i.quotes.length > 1 ? {
        other_choices: i.quotes.filter(q => q.id !== i.quote?.id)
          .map(q => q.supplier_name + ', ' + q.pack_label + (order.show_prices ? ' ' + money(q.price, cur) : '')),
      } : {}),
    })),
    suppliers: Object.values(sup).map(s => ({
      supplier: s.name,
      next_delivery: longDate(s.next_delivery),
      ...(s.cutoff_time ? { cutoff: cutoffText(s) } : {}),
      orders_go_by: sendText(s),
      ...(order.show_prices && s.min_order ? { minimum_order: money(s.min_order, cur) } : {}),
    })),
  }
}

const OrderTarget = {
  venue_id:     Id,
  list:         z.string().max(200).optional().describe('The order list\'s name; leave out when the venue has one list'),
  without_list: z.boolean().optional().describe('The order for items that are on no list'),
}

const OrderLine = z.object({
  item:     z.string().min(1).max(200),
  quantity: Qty.describe('Packs (cases, bags ...) of the supplier\'s pack; 0 takes it off'),
  supplier: z.string().max(200).optional().describe('Order it from this supplier instead'),
  pack:     z.string().max(100).optional().describe('Which pack, when the supplier has several'),
})

/**
 * What a draft order becomes: the venue's draft with `lines`, fill to par
 * and clear all applied. `changes` are the line writes; `lines` every line
 * with a quantity after them. Used by describe() and run() alike.
 */
async function planOrder(ctx, input) {
  const venue = await venueOf(ctx, input.venue_id)
  const order = await openOrder(ctx, venue, input, { create: true })
  const eff = new Map(order.items.map(i => [i.item_id, { item: i, quote: i.quote, qty: i.qty, was: i.qty, switched: false }]))
  if (input.clear_all) for (const e of eff.values()) e.qty = 0
  if (input.fill_to_par) {
    for (const e of eff.values()) {
      if (e.qty > 0 || !e.quote || e.item.par_base == null || e.item.is_active === false) continue
      const p = packsToPar(e.item.par_base, e.quote)
      if (p > 0) e.qty = p
    }
  }
  for (const l of input.lines || []) {
    const it = await findOrderItem(ctx, venue, order, l.item)
    let e = eff.get(it.item_id)
    if (!e) {
      e = { item: it, quote: it.quote, qty: 0, was: 0, switched: false, added: true }
      eff.set(it.item_id, e)
      order.items.push(it)
    }
    if (l.supplier || l.pack) {
      const q = pickQuote(e.item.name, e.item.quotes || [], l.supplier, l.pack)
      if (q.id !== e.quote?.id) { e.quote = q; e.switched = true }
    }
    e.qty = l.quantity
  }
  const all = [...eff.values()]
  const changes = all.filter(e => e.qty !== e.was || e.switched || (e.added && e.qty > 0))
    .map(e => ({ item_id: e.item.item_id, qty: e.qty, ...(e.switched ? { quote_id: e.quote.id } : {}) }))
  const lines = all.filter(e => e.qty > 0)
  const noSupplier = lines.filter(e => !e.quote).map(e => e.item.name)
  const sup = await supplierInfo(ctx, venue, [...new Set(lines.filter(e => e.quote).map(e => e.quote.supplier_id))])
  return { venue, order, all, changes, lines, noSupplier, sup }
}

function changeLine(e, prices, cur) {
  const what = e.quote ? ' (' + e.quote.supplier_name + ', ' + e.quote.pack_label + ')' : ''
  if (e.added || e.was === 0) return e.item.name + ': ' + fmtNum(e.qty) + what + (e.item.on_list ? '' : ', not on the list')
  if (e.qty === 0) return e.item.name + ': ' + fmtNum(e.was) + ' to 0 (off the order)'
  const price = prices && e.quote ? ' ' + money(lineAmounts({ price: e.quote.price, qty: e.qty }).net, cur) : ''
  return e.item.name + ': ' + (e.qty !== e.was ? fmtNum(e.was) + ' to ' : '') + fmtNum(e.qty) + what + (e.switched ? ', new supplier' : '') + price
}

/** The order split per supplier, as place_order will submit it. */
function orderGroups(plan, deliveries = []) {
  const { lines, sup, order, venue } = plan
  const ids = [...new Set(lines.filter(e => e.quote).map(e => e.quote.supplier_id))]
  const given = new Map()
  for (const d of deliveries) {
    const s = pickByName(ids.map(id => ({ id, name: sup[id]?.name || '' })), d.supplier, x => x.name, 'supplier on this order')
    given.set(s.id, d)
  }
  return ids.map(id => {
    const s = sup[id]
    const d = given.get(id)
    const date = d?.date || s.next_delivery
    if (date < order.today) throw new ToolError('The delivery date for ' + s.name + ' (' + longDate(date) + ') is in the past.', 422)
    const gl = lines.filter(e => e.quote?.supplier_id === id).map(e => ({ ...e, fitted: fitQty(e.qty, e.quote) }))
    const totals = order.show_prices
      ? orderTotals(gl.map(e => ({ price: e.quote.price, qty: e.fitted, vat_rate: e.quote.vat_rate })))
      : null
    return { id, s, date, override: !!d?.date, notes: d?.notes ?? null, lines: gl, totals, cur: venue.currency }
  })
}

const sentHow = s => s.send_method === 'email'
  ? (s.email ? 'emailed to ' + s.email + ' straight away' : 'by email, but there\'s no email address: it waits in To send')
  : 'waits in To send (' + ({ print: 'print it', excel: 'send the Excel file', pdf: 'send the PDF' })[s.send_method] + ')'

// ── Purchase orders ────────────────────────────────────────

/** A purchase order by number ("PO-00012", "12") or id, in full. */
async function findPo(ctx, text) {
  const raw = String(text ?? '').trim()
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  const n = isId ? null : Number(raw.replace(/^po[\s#-]*/i, '').replace(/^#/, ''))
  if (!isId && !(Number.isInteger(n) && n > 0)) throw new ToolError('Give the purchase order number, e.g. PO-00012.', 422)
  const [row] = await withTenant(ctx.tenantId, tx => tx`
    SELECT id FROM purchase_orders
     WHERE tenant_id = ${ctx.tenantId} AND ${isId ? tx`id = ${raw}::uuid` : tx`number = ${n}`}
  `)
  if (!row) throw new ToolError('There is no purchase order ' + raw + '. Use purchase_orders to find it.', 404)
  return callApi(ctx, 'GET', '/api/purchasing/pos/' + row.id)
}

function poRow(p, cur) {
  return {
    po: poNumberLabel(p.number),
    po_id: p.id,
    venue: p.venue_name,
    supplier: p.supplier_name,
    status: PO_STATUSES[p.status] || p.status,
    delivery: longDate(p.delivery_date),
    ...(p.line_count != null ? { lines: p.line_count } : {}),
    ...(p.total !== undefined ? { total: money(p.total, cur) } : {}),
    ...(p.status === 'to_send' ? { to_send: p.send_method === 'email' ? (p.has_email === false ? 'by email, but the supplier has no email address' : 'by email') : p.send_method } : {}),
    ...(p.send_error ? { send_error: p.send_error } : {}),
    ...(p.sent_at ? { sent: (p.sent_via || 'sent') + (p.sent_to ? ' to ' + p.sent_to : '') } : {}),
    ...(p.received_at ? { delivery_check: p.delivery_accepted === false ? 'rejected' : 'accepted' } : {}),
  }
}

function poDetailView(d, cur) {
  const prices = d.show_prices
  return {
    ...poRow(d, cur),
    ...(d.supplier_email ? { supplier_email: d.supplier_email } : {}),
    ...(d.supplier_phone ? { supplier_phone: d.supplier_phone } : {}),
    ...(d.account_ref ? { account: d.account_ref } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ...(d.created_by ? { ordered_by: d.created_by } : {}),
    lines: d.lines.map(l => ({
      item: l.item_name,
      pack: l.pack_label,
      quantity: l.qty,
      storage: l.storage,
      ...(prices && l.price !== undefined ? { price: money(l.price, cur), line_total: money(lineAmounts(l).net, cur) } : {}),
      ...(l.received_qty != null ? {
        received: l.received_qty,
        received_status: RECEIVE_STATUSES.find(s => s.key === l.receive_status)?.label ?? l.receive_status,
        ...(l.receive_note ? { received_note: l.receive_note } : {}),
      } : {}),
    })),
    ...(prices && d.subtotal !== undefined ? {
      subtotal: money(d.subtotal, cur), vat: money(d.vat, cur),
      ...(d.delivery_charge ? { delivery_charge: money(d.delivery_charge, cur) } : {}),
    } : {}),
    ...(d.delivery_check ? {
      delivery_check: {
        accepted: d.delivery_check.accepted,
        ...(d.delivery_check.product_temp_c != null ? { temperature: Number(d.delivery_check.product_temp_c).toFixed(1) + '°C' } : {}),
        ...(d.delivery_check.corrective_action ? { corrective_action: d.delivery_check.corrective_action } : {}),
        recorded_by: d.delivery_check.recorded_by,
      },
    } : {}),
  }
}

const poTitle = d => poNumberLabel(d.number) + ' to ' + d.supplier_name + ', ' + d.venue_name

async function poCurrency(ctx, d) {
  const [v] = await withTenant(ctx.tenantId, tx => tx`
    SELECT currency FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${ctx.tenantId}
  `)
  return v?.currency || 'GBP'
}

// ── Tools ──────────────────────────────────────────────────

export const purchasingTools = [
  // ── Reads ──
  {
    name: 'find_inventory_items',
    title: 'Find inventory items',
    description:
      'Searches the purchasing inventory (the products the company buys) by name or code, category or supplier. ' +
      'Each item comes with its supplier prices: pack, price ex VAT, price per kg / litre / each, VAT, venue prices and ' +
      'which price is the company or a venue\'s choice. Give venue_id to see which supplier that venue orders it from. ' +
      'history: true adds the recent price changes when up to 5 items match. Needs Purchasing setup.',
    input: z.object({
      search:      z.string().max(200).optional().describe('Name, code, or words in the name'),
      category:    z.string().max(100).optional(),
      supplier:    z.string().max(200).optional().describe('Only items this supplier has a price for'),
      venue_id:    Id.optional(),
      include_off: z.boolean().optional().describe('Include items that are switched off'),
      history:     z.boolean().optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'purchasing_setup', 'view')
      const [items, venues] = await Promise.all([loadItems(ctx), tenantVenues(ctx)])
      const venue = input.venue_id ? venues.find(v => v.id === input.venue_id) : null
      if (input.venue_id && !venue) throw new ToolError('Venue not found. Use list_venues.', 404)
      const cur = (venue || venues[0])?.currency || 'GBP'
      const tz = (venue || venues[0])?.timezone
      const has = (text, q) => {
        const t = String(text || '').toLowerCase()
        return String(q).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every(w => t.includes(w))
      }
      let hits = items.filter(i => input.include_off || i.is_active)
      if (input.search) {
        const s = input.search.trim().toLowerCase()
        hits = hits.filter(i => (i.code || '').toLowerCase() === s || has(i.name + ' ' + (i.code || ''), input.search))
      }
      if (input.category) hits = hits.filter(i => has(i.category_name, input.category))
      if (input.supplier) hits = hits.filter(i => i.quotes.some(q => has(q.supplier_name, input.supplier)))
      const shown = hits.slice(0, 40)
      const venueName = new Map(venues.map(v => [v.id, v.name]))
      const out = []
      for (const it of shown) {
        const view = itemView(it, { venue, venueName, cur })
        if (input.history && shown.length <= 5) {
          for (const p of view.prices) {
            const h = await callApi(ctx, 'GET', '/api/inventory/quotes/' + p.quote_id + '/history')
            p.price_history = h.slice(0, 10).map(r => ({
              date: localParts(r.changed_at, tz).date,
              price: r.price == null ? 'back to the company price' : money(r.price, cur),
              for: r.venue_name ?? 'company price',
              ...(r.changed_by ? { by: r.changed_by } : {}),
              ...(r.source && r.source !== 'manual' ? { source: r.source } : {}),
            }))
          }
        }
        out.push(view)
      }
      return {
        matched: hits.length,
        ...(hits.length > shown.length ? { showing: shown.length, note: 'Narrow the search to see the rest.' } : {}),
        items: out,
      }
    },
  },

  {
    name: 'list_suppliers',
    title: 'List suppliers',
    description:
      'Suppliers with how orders reach them, order cutoff, delivery days, minimum order and charges. Name one ' +
      '(supplier) for everything about it: copy addresses, account numbers, per-venue settings and its products ' +
      'with prices. Needs Purchasing setup.',
    input: z.object({
      supplier:    z.string().max(200).optional(),
      include_off: z.boolean().optional().describe('Include suppliers that are switched off'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'purchasing_setup', 'view')
      const [sups, cur] = await Promise.all([loadSuppliers(ctx), tenantCurrency(ctx)])
      if (!input.supplier) {
        return { suppliers: sups.filter(s => input.include_off || s.is_active).map(s => supplierSummary(s, cur)) }
      }
      const s = pickSupplier(sups, input.supplier)
      const d = await callApi(ctx, 'GET', '/api/suppliers/' + s.id)
      return {
        ...supplierSummary({ ...d, quote_count: d.quotes.length }, cur),
        ...(d.cc_emails ? { copy_order_emails_to: d.cc_emails } : {}),
        ...(d.website ? { website: d.website } : {}),
        ...(d.account_ref ? { account: d.account_ref } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        venue_settings: d.venues.map(v => ({
          venue: v.venue_name,
          ...(v.account_ref ? { account: v.account_ref } : {}),
          delivery_days: v.delivery_days == null ? 'as the supplier' : daysText(v.delivery_days),
          ...(v.cutoff_time ? { order_cutoff: hhmm(v.cutoff_time) } : {}),
        })),
        products: d.quotes.slice(0, 150).map(q => ({
          item: q.item_name,
          pack: packLabel(q),
          price: priceText(q, q.price, q.base_unit, cur),
          ...(q.supplier_code ? { supplier_code: q.supplier_code } : {}),
          ...(q.is_active && q.item_active ? {} : { active: false }),
        })),
        ...(d.quotes.length > 150 ? { more_products: d.quotes.length - 150 } : {}),
      }
    },
  },

  {
    name: 'order_lists',
    title: 'Order lists',
    description:
      'The order lists (the products a venue usually orders, from any mix of suppliers). Give venue_id for the lists ' +
      'that venue uses. Name one (list) for its items, the supplier and pack each is ordered on, and the par (usual ' +
      'quantity) at each venue; that part needs Purchasing setup.',
    input: z.object({
      venue_id: Id.optional(),
      list:     z.string().max(200).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      const access = await requireRead(ctx)
      const [lists, venues] = await Promise.all([loadLists(ctx, input.venue_id), tenantVenues(ctx)])
      const venueName = new Map(venues.map(v => [v.id, v.name]))
      if (!input.list) {
        return {
          lists: lists.map(l => ({
            list_id: l.id, name: l.name, ...(l.is_active ? {} : { active: false }),
            venues: l.venue_ids.map(id => venueName.get(id)).filter(Boolean), items: l.item_count,
            ...(l.notes ? { notes: l.notes } : {}),
          })),
        }
      }
      const l = pickByName(lists, input.list, x => x.name, 'order list', 'No order lists yet.')
      if (!access.prices) {
        throw new ToolError('Seeing a list\'s items needs Purchasing setup. To see what a venue orders on it, use order_form.', 403)
      }
      const d = await callApi(ctx, 'GET', '/api/purchasing/lists/' + l.id)
      const onList = d.venue_ids.map(id => ({ id, name: venueName.get(id) })).filter(v => v.name)
      return {
        list_id: d.id, name: d.name, ...(d.is_active ? {} : { active: false }), ...(d.notes ? { notes: d.notes } : {}),
        venues: onList.map(v => v.name),
        items: d.items.map(i => ({
          item: i.name,
          ...(i.category_name ? { category: i.category_name } : {}),
          ...(i.is_active ? {} : { switched_off: true }),
          ordered_on: i.quote ? i.quote.supplier_name + ', ' + i.quote.pack_label : 'no supplier price',
          pars: Object.fromEntries(onList.map(v => [v.name, parText(i.pars?.[v.id], i.quote, i.base_unit)])),
        })),
      }
    },
  },

  {
    name: 'order_form',
    title: 'Open an order',
    description:
      'A venue\'s draft order for an order list, as on the Purchasing page: every item with its supplier and pack, ' +
      'the quantity entered so far, the par, when it was last ordered and other suppliers it can come from, plus each ' +
      'supplier\'s next delivery date and cutoff. Opening it makes an empty draft if none is open (nothing is ordered). ' +
      'only_with_quantity: true lists just the lines being ordered. Prices show only with Purchasing setup.',
    input: z.object({ ...OrderTarget, only_with_quantity: z.boolean().optional() }),
    async run(ctx, input) {
      const access = await requireRead(ctx)
      const venue = await venueOf(ctx, input.venue_id)
      const order = await openOrder(ctx, venue, input, { create: access.canOrder })
      if (!order) return { venue: venue.name, message: 'No draft order is open for that list, and starting one needs Purchasing (manage).' }
      const ids = [...new Set(order.items.map(i => i.quote?.supplier_id).filter(Boolean))]
      return orderView(order, venue, await supplierInfo(ctx, venue, ids), input.only_with_quantity)
    },
  },

  {
    name: 'purchase_orders',
    title: 'Purchase orders',
    description:
      'Purchase orders (one per supplier per order placed): status To send / Sent / Received / Cancelled, delivery ' +
      'date, totals (with Purchasing setup), send errors and the delivery check. Filter by venue, status ("open" = ' +
      'to send or sent), supplier or delivery dates. Give po (e.g. PO-00012) for one in full with its lines.',
    input: z.object({
      po:       z.string().max(60).optional(),
      venue_id: Id.optional(),
      status:   z.enum(['open', 'to_send', 'sent', 'received', 'cancelled']).optional(),
      supplier: z.string().max(200).optional(),
      from:     DateStr.optional().describe('Delivery date from'),
      to:       DateStr.optional().describe('Delivery date to'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireRead(ctx)
      if (input.po) {
        const d = await findPo(ctx, input.po)
        return poDetailView(d, await poCurrency(ctx, d))
      }
      const q = new URLSearchParams({ limit: '60' })
      if (input.venue_id) q.set('venue_id', (await venueOf(ctx, input.venue_id)).id)
      if (input.status) q.set('status', input.status === 'open' ? 'to_send,sent' : input.status)
      if (input.from) q.set('from', input.from)
      if (input.to) q.set('to', input.to)
      if (input.supplier) {
        const sups = await withTenant(ctx.tenantId, tx => tx`SELECT id, name FROM suppliers WHERE tenant_id = ${ctx.tenantId} ORDER BY name`)
        q.set('supplier_id', pickSupplier(sups, input.supplier).id)
      }
      const [rows, venues] = await Promise.all([callApi(ctx, 'GET', '/api/purchasing/pos?' + q), tenantVenues(ctx)])
      const curOf = new Map(venues.map(v => [v.id, v.currency]))
      return { purchase_orders: rows.map(p => poRow(p, curOf.get(p.venue_id))) }
    },
  },

  // ── Catalogue changes ──
  {
    name: 'add_inventory_item',
    title: 'Add an inventory item',
    description:
      'Adds a product to the inventory, optionally with up to 5 supplier prices. counted_in is how stock and pars ' +
      'are counted (weight, volume or each); it defaults from the first price\'s pack unit. A category that doesn\'t ' +
      'exist is made. Suppliers must exist (add_supplier). For many products use import_price_list.',
    input: z.object({
      name:       z.string().trim().min(1).max(200),
      counted_in: BaseUnitIn.optional(),
      storage:    Storage.optional().describe('Default ambient'),
      category:   z.string().max(100).optional(),
      code:       z.string().max(60).optional().describe('Your own item code'),
      notes:      z.string().max(2000).optional(),
      prices:     z.array(PriceInput).max(5).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await newItemPlan(ctx, input)
      return {
        title: 'Add ' + input.name + ' to the inventory?',
        lines: [
          input.name + ': counted ' + COUNTED[p.base] + ', ' + (input.storage || 'ambient'),
          ...(p.cat ? ['Category: ' + p.cat.name + (p.cat.isNew ? ' (new category)' : '')] : []),
          ...(input.code ? ['Code: ' + input.code] : []),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
          ...(p.prices.length ? p.prices.flatMap(x => priceLines(x, x.sup.name, p.base, p.cur)) : ['No supplier prices yet (it can\'t be ordered until it has one)']),
        ],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Add item',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await newItemPlan(ctx, input)
      return audited(ctx, 'add_inventory_item', input, async () => {
        let categoryId = p.cat?.id ?? null
        if (p.cat?.isNew) categoryId = (await callApi(ctx, 'POST', '/api/inventory/categories', { body: { name: p.cat.name } })).id
        const item = await callApi(ctx, 'POST', '/api/inventory/items', {
          body: {
            name: input.name, base_unit: p.base, storage: input.storage || 'ambient', category_id: categoryId,
            ...(input.code ? { code: input.code } : {}), ...(input.notes ? { notes: input.notes } : {}),
          },
        })
        const failed = []
        for (const x of p.prices) {
          try {
            await callApi(ctx, 'POST', '/api/inventory/items/' + item.id + '/quotes', { body: quoteBody(x, x.sup.id) })
          } catch (err) {
            failed.push(x.sup.name + ': ' + err.message)
          }
        }
        return {
          item_id: item.id, name: item.name, prices_added: p.prices.length - failed.length,
          ...(failed.length ? { prices_failed: failed } : {}),
          message: 'Added.' + (failed.length ? ' Some prices failed; add them with add_supplier_price.' : ''),
        }
      })
    },
  },

  {
    name: 'update_inventory_item',
    title: 'Change an inventory item',
    description:
      'Changes an inventory item: name, category (null = none; a new name makes the category), storage, code, notes, ' +
      'or switches it off (active: false; it then isn\'t offered on orders) or back on. counted_in can only change ' +
      'while the item has no supplier prices or pars. Prices: update_supplier_price.',
    input: z.object({
      item:       z.string().min(1).max(200).describe('Name, code or item_id'),
      name:       z.string().trim().min(1).max(200).optional(),
      counted_in: BaseUnitIn.optional(),
      storage:    Storage.optional(),
      category:   z.string().max(100).nullable().optional(),
      code:       z.string().max(60).nullable().optional(),
      notes:      z.string().max(2000).nullable().optional(),
      active:     z.boolean().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await itemChangePlan(ctx, input)
      return {
        title: 'Change ' + p.item.name + '?',
        lines: p.lines,
        ...(input.active === false ? { warningTitle: 'Switching off', warnings: ['It won\'t be offered on orders any more. Its prices and history are kept.'] } : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await itemChangePlan(ctx, input)
      return audited(ctx, 'update_inventory_item', input, async () => {
        const body = { ...p.body }
        if (p.newCategory) body.category_id = (await callApi(ctx, 'POST', '/api/inventory/categories', { body: { name: p.newCategory } })).id
        const item = await callApi(ctx, 'PATCH', '/api/inventory/items/' + p.item.id, { body })
        return { item_id: item.id, name: item.name, message: 'Saved.' }
      })
    },
  },

  {
    name: 'add_supplier_price',
    title: 'Add a supplier price',
    description:
      'Adds a supplier\'s price for an inventory item: pack (e.g. Case of 6 x 2 kg: pack_name Case, pack_count 6, ' +
      'pack_size 2, pack_unit kg), price per pack ex VAT, VAT, the supplier\'s code, minimum packs and steps. ' +
      'venue_prices sets a different price at some venues. To change an existing price use update_supplier_price.',
    input: z.object({
      item:         z.string().min(1).max(200).describe('Name, code or item_id'),
      ...PriceInput.shape,
      venue_prices: z.array(z.object({ venue_id: Id, price: z.number().min(0).max(10000000) })).max(50).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await newPricePlan(ctx, input)
      return {
        title: 'Add this price for ' + p.item.name + '?',
        lines: [
          ...priceLines(input, p.sup.name, p.item.base_unit, p.cur),
          ...p.venuePrices.map(v => v.name + ' pays ' + money(v.price, p.cur)),
          ...(p.cheapest ? ['It becomes the cheapest price per ' + perUnitLabel(p.item.base_unit) + ' for ' + p.item.name] : []),
        ],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Add price',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await newPricePlan(ctx, input)
      return audited(ctx, 'add_supplier_price', input, async () => {
        const before = new Set(p.item.quotes.map(q => q.id))
        const item = await callApi(ctx, 'POST', '/api/inventory/items/' + p.item.id + '/quotes', { body: quoteBody(input, p.sup.id) })
        const q = item.quotes.find(x => !before.has(x.id))
        if (q && p.venuePrices.length) {
          await callApi(ctx, 'PUT', '/api/inventory/quotes/' + q.id + '/venue-prices', {
            body: { prices: p.venuePrices.map(v => ({ venue_id: v.id, price: v.price })) },
          })
        }
        return { quote_id: q?.id ?? null, item: item.name, supplier: p.sup.name, message: 'Price added.' }
      })
    },
  },

  {
    name: 'update_supplier_price',
    title: 'Change a supplier price',
    description:
      'Changes one of an item\'s supplier prices: the price per pack, VAT, pack, supplier code, minimum packs, steps, ' +
      'or switches it off (active: false). Name the supplier, and which (supplier code or pack) when it has several ' +
      'prices for the item. venue_prices sets a venue\'s own price (null = back to the company price). Old prices ' +
      'are kept in the price history.',
    input: z.object({
      item:           z.string().min(1).max(200),
      supplier:       z.string().max(200).optional(),
      which:          z.string().max(100).optional().describe('Supplier code or pack, when there are several'),
      price:          z.number().min(0).max(10000000).optional().describe('New price per pack, ex VAT'),
      vat_rate:       z.number().min(0).max(100).optional(),
      pack_name:      z.string().max(60).optional(),
      pack_count:     z.number().positive().max(100000).optional(),
      pack_size:      z.number().positive().max(10000000).optional(),
      pack_unit:      PackUnit.optional(),
      supplier_code:  z.string().max(100).nullable().optional(),
      min_qty:        z.number().positive().max(100000).nullable().optional(),
      order_multiple: z.number().positive().max(100000).nullable().optional(),
      active:         z.boolean().optional(),
      venue_prices:   z.array(z.object({ venue_id: Id, price: z.number().min(0).max(10000000).nullable() })).max(50).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await priceChangePlan(ctx, input)
      return {
        title: 'Change ' + p.item.name + ' from ' + p.quote.supplier_name + '?',
        lines: [p.quote.supplier_name + ', ' + packLabel(p.quote), ...p.lines],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Save price',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await priceChangePlan(ctx, input)
      return audited(ctx, 'update_supplier_price', input, async () => {
        if (Object.keys(p.body).length) await callApi(ctx, 'PATCH', '/api/inventory/quotes/' + p.quote.id, { body: p.body })
        if (p.venuePrices.length) {
          await callApi(ctx, 'PUT', '/api/inventory/quotes/' + p.quote.id + '/venue-prices', {
            body: { prices: p.venuePrices.map(v => ({ venue_id: v.id, price: v.price })) },
          })
        }
        return { quote_id: p.quote.id, item: p.item.name, supplier: p.quote.supplier_name, message: 'Saved.' }
      })
    },
  },

  {
    name: 'set_preferred_supplier',
    title: 'Choose the supplier an item is ordered from',
    description:
      'Sets which supplier price an item is ordered on: for every venue (company choice) or one venue (venue_id). ' +
      'clear: true removes the choice, so it falls back to the company choice, then the cheapest per unit.',
    input: z.object({
      item:     z.string().min(1).max(200),
      supplier: z.string().max(200).optional(),
      which:    z.string().max(100).optional().describe('Supplier code or pack, when the supplier has several'),
      venue_id: Id.optional(),
      clear:    z.boolean().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await preferredPlan(ctx, input)
      return {
        title: input.clear ? 'Clear the supplier choice for ' + p.item.name + '?' : 'Order ' + p.item.name + ' from ' + p.quote.supplier_name + '?',
        lines: [
          p.venue ? 'At ' + p.venue.name : 'Company choice (venues without their own choice)',
          ...(p.quote ? [p.quote.supplier_name + ', ' + packLabel(p.quote) + ' at ' + priceText(p.quote, p.venue ? quotePrice(p.quote, p.venue.id) : p.quote.price, p.item.base_unit, p.cur)] : []),
          'Now: ' + (p.current ? p.current.supplier_name + ', ' + packLabel(p.current) : 'no choice set'),
        ],
        confirmLabel: input.clear ? 'Clear choice' : 'Save choice',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await preferredPlan(ctx, input)
      return audited(ctx, 'set_preferred_supplier', input, async () => {
        await callApi(ctx, 'PUT', '/api/inventory/items/' + p.item.id + '/preferred', {
          body: { venue_id: p.venue?.id ?? null, quote_id: p.quote?.id ?? null },
        })
        return { item: p.item.name, supplier: p.quote?.supplier_name ?? null, venue: p.venue?.name ?? 'company', message: 'Saved.' }
      })
    },
  },

  {
    name: 'add_supplier',
    title: 'Add a supplier',
    description:
      'Adds a supplier: contact details, how orders reach them (email sent by the system, or print / Excel / PDF ' +
      'sent by staff), order cutoff, lead days, delivery days, minimum order and delivery charge.',
    input: z.object({ name: z.string().trim().min(1).max(200), ...SupplierFields }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await newSupplierPlan(ctx, input)
      return {
        title: 'Add ' + input.name + ' as a supplier?',
        lines: Object.entries(p.body).filter(([k]) => k !== 'name')
          .map(([k, v]) => SUPPLIER_LABELS[k] + ': ' + supplierValue(k, v, p.cur)),
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Add supplier',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await newSupplierPlan(ctx, input)
      return audited(ctx, 'add_supplier', input, async () => {
        const s = await callApi(ctx, 'POST', '/api/suppliers', { body: p.body })
        return { supplier_id: s.id, name: s.name, message: 'Supplier added.' }
      })
    },
  },

  {
    name: 'update_supplier',
    title: 'Change a supplier',
    description:
      'Changes a supplier\'s details or ordering settings, or switches it off (active: false). null clears a field. ' +
      'venue sets one venue\'s own account number, delivery days or cutoff; use_supplier_settings: true removes them.',
    input: z.object({
      supplier: z.string().min(1).max(200),
      name:     z.string().trim().min(1).max(200).optional(),
      ...SupplierFields,
      active:   z.boolean().optional(),
      venue:    z.object({
        venue_id:              Id,
        account_ref:           z.string().max(100).nullable().optional(),
        delivery_days:         DayNames.nullable().optional().describe('null = the supplier\'s usual days'),
        order_cutoff:          TimeStr.nullable().optional(),
        use_supplier_settings: z.boolean().optional(),
      }).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await supplierChangePlan(ctx, input)
      return {
        title: 'Change ' + p.sup.name + '?',
        lines: p.lines,
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await supplierChangePlan(ctx, input)
      return audited(ctx, 'update_supplier', input, async () => {
        if (Object.keys(p.body).length) await callApi(ctx, 'PATCH', '/api/suppliers/' + p.sup.id, { body: p.body })
        if (p.venues) await callApi(ctx, 'PUT', '/api/suppliers/' + p.sup.id + '/venues', { body: { venues: p.venues } })
        return { supplier_id: p.sup.id, name: input.name || p.sup.name, message: 'Saved.' }
      })
    },
  },

  {
    name: 'create_order_list',
    title: 'Create an order list',
    description:
      'Makes an order list: a name, the venues that use it and its items (names or codes, any mix of suppliers). ' +
      'Set the usual quantities afterwards with set_pars.',
    input: z.object({
      name:      z.string().trim().min(1).max(200),
      venue_ids: z.array(Id).min(1).max(50),
      items:     z.array(z.string().min(1).max(200)).max(300).optional(),
      notes:     z.string().max(2000).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await newListPlan(ctx, input)
      return {
        title: 'Create the order list ' + input.name + '?',
        lines: [
          'Venues: ' + p.venues.map(v => v.name).join(', '),
          plural(p.items.length, 'item') + (p.items.length ? ': ' + p.items.slice(0, 30).map(i => i.name).join(', ') + (p.items.length > 30 ? ' and ' + (p.items.length - 30) + ' more' : '') : ''),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
        ],
        ...(p.noPrice.length ? { warningTitle: 'No supplier price', warnings: [p.noPrice.join(', ') + ' can\'t be ordered until they have a supplier price.'] } : {}),
        confirmLabel: 'Create list',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await newListPlan(ctx, input)
      return audited(ctx, 'create_order_list', input, async () => {
        const l = await callApi(ctx, 'POST', '/api/purchasing/lists', {
          body: { name: input.name, notes: input.notes ?? null, venue_ids: p.venues.map(v => v.id), item_ids: p.items.map(i => i.id) },
        })
        return { list_id: l.id, name: l.name, items: l.items.length, message: 'List created.' }
      })
    },
  },

  {
    name: 'update_order_list',
    title: 'Change an order list',
    description:
      'Changes an order list: rename, notes, switch off (active: false), add or remove venues, add or remove items ' +
      '(new items go at the end; removing an item removes its pars). Pars: set_pars.',
    input: z.object({
      list:          z.string().min(1).max(200),
      name:          z.string().trim().min(1).max(200).optional(),
      notes:         z.string().max(2000).nullable().optional(),
      active:        z.boolean().optional(),
      add_venues:    z.array(Id).max(50).optional(),
      remove_venues: z.array(Id).max(50).optional(),
      add_items:     z.array(z.string().min(1).max(200)).max(300).optional(),
      remove_items:  z.array(z.string().min(1).max(200)).max(300).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await listChangePlan(ctx, input)
      return {
        title: 'Change the order list ' + p.list.name + '?',
        lines: p.lines,
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Save list',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await listChangePlan(ctx, input)
      return audited(ctx, 'update_order_list', input, async () => {
        const id = p.list.id
        if (Object.keys(p.body).length) await callApi(ctx, 'PATCH', '/api/purchasing/lists/' + id, { body: p.body })
        if (p.venueIds) await callApi(ctx, 'PUT', '/api/purchasing/lists/' + id + '/venues', { body: { venue_ids: p.venueIds } })
        if (p.itemIds) await callApi(ctx, 'PUT', '/api/purchasing/lists/' + id + '/items', { body: { item_ids: p.itemIds } })
        return { list_id: id, name: input.name || p.list.name, message: 'Saved.' }
      })
    },
  },

  {
    name: 'set_pars',
    title: 'Set pars on an order list',
    description:
      'Sets the par (usual quantity) of items on an order list at one venue. par is in packs of the item\'s ' +
      'company-choice price unless unit says otherwise (g, kg, ml, cl, l, each); null removes the par. Staff fill ' +
      'an order to its pars in one go.',
    input: z.object({
      list:     z.string().min(1).max(200),
      venue_id: Id,
      pars:     z.array(z.object({
        item: z.string().min(1).max(200),
        par:  z.number().min(0).max(100000000).nullable(),
        unit: z.enum(['packs', ...Object.keys(UNITS)]).optional(),
      })).min(1).max(300),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const p = await parsPlan(ctx, input)
      return {
        title: 'Set pars on ' + p.list.name + ' at ' + p.venue.name + '?',
        lines: p.rows.map(r => r.item.name + ': ' + parText(r.before, r.item.quote, r.item.base_unit) + ' to ' + parText(r.par_base, r.item.quote, r.item.base_unit)),
        confirmLabel: 'Save pars',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const p = await parsPlan(ctx, input)
      return audited(ctx, 'set_pars', input, async () => {
        await callApi(ctx, 'PUT', '/api/purchasing/lists/' + p.list.id + '/pars', {
          body: { pars: p.rows.map(r => ({ item_id: r.item.item_id, venue_id: p.venue.id, par_base: r.par_base })) },
        })
        return { list: p.list.name, venue: p.venue.name, pars_set: p.rows.length, message: 'Pars saved.' }
      })
    },
  },

  {
    name: 'import_price_list',
    title: 'Import a price list',
    description:
      'Adds or updates many products and supplier prices at once, the same as the Inventory page\'s import. Either ' +
      'attached_file: a CSV or text file attached in this chat with headings Item, Category, Base unit, Storage, ' +
      'Item code, Supplier, Supplier code, Pack, Pack count, Pack size, Pack unit, Price, VAT %; or rows: products ' +
      'you read from a PDF, photo or email (up to 100 per call: for a longer list, one call per 100, each its own ' +
      'card). Items match by code, then name; a supplier\'s price matches by its code, else pack. New categories and ' +
      'suppliers are made. The card shows a dry run first.',
    input: z.object({
      attached_file: z.string().max(200).optional().describe('File name of a CSV attached in this chat'),
      rows:          z.array(ImportRow).max(100).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireSetup(ctx)
      const { file, source } = await importFile(ctx, input)
      const r = await callApi(ctx, 'POST', '/api/inventory/import', { body: { file, dry_run: true } })
      if (r.rows > 0 && r.errors.length >= r.rows) {
        throw new ToolError('None of the rows can be imported: ' + r.errors.slice(0, 5).map(e => 'row ' + e.row + ' (' + e.item + '): ' + e.error).join('; '), 422)
      }
      const warnings = [
        ...r.errors.slice(0, 10).map(e => 'Row ' + e.row + ' (' + e.item + '): ' + e.error + '. Skipped.'),
        ...(r.errors.length > 10 ? [(r.errors.length - 10) + ' more rows have problems and are skipped.'] : []),
        ...(r.suppliers_created ? [plural(r.suppliers_created, 'new supplier') + ' will be made with just a name: add their email and delivery days with update_supplier.'] : []),
      ]
      return {
        title: 'Import this price list?',
        lines: [
          'From ' + source + ': ' + plural(r.rows, 'row'),
          'Items: ' + r.items_created + ' new, ' + r.items_matched + ' already in the inventory',
          'Supplier prices: ' + r.quotes_created + ' new, ' + r.quotes_updated + ' updated (' + plural(r.prices_changed, 'price change') + ')',
          ...(r.categories_created ? ['New categories: ' + r.categories_created] : []),
          ...(r.suppliers_created ? ['New suppliers: ' + r.suppliers_created] : []),
        ],
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Import',
      }
    },
    async run(ctx, input) {
      await requireSetup(ctx)
      const { file, source } = await importFile(ctx, input)
      return audited(ctx, 'import_price_list', input.attached_file ? input : { rows: input.rows?.length }, async () => {
        const r = await callApi(ctx, 'POST', '/api/inventory/import', { body: { file } })
        return {
          source, rows: r.rows, items_created: r.items_created, items_matched: r.items_matched,
          prices_created: r.quotes_created, prices_updated: r.quotes_updated, price_changes: r.prices_changed,
          categories_created: r.categories_created, suppliers_created: r.suppliers_created,
          ...(r.errors.length ? { skipped_rows: r.errors.slice(0, 20) } : {}),
          message: 'Imported.' + (r.errors.length ? ' ' + plural(r.errors.length, 'row was', 'rows were') + ' skipped.' : ''),
        }
      })
    },
  },

  // ── Ordering ──
  {
    name: 'update_order',
    title: 'Change the draft order',
    description:
      'Sets quantities on a venue\'s draft order for a list without sending anything: lines (packs; 0 takes a line ' +
      'off; an item not on the list is added; supplier switches where it comes from), fill_to_par (every empty line ' +
      'with a par gets its par), clear_all. Place it with place_order.',
    input: z.object({
      ...OrderTarget,
      lines:       z.array(OrderLine).max(300).optional(),
      fill_to_par: z.boolean().optional(),
      clear_all:   z.boolean().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const p = await planOrder(ctx, input)
      if (!p.changes.length) throw new ToolError('Nothing to change: the draft already has those quantities.', 422)
      const prices = p.order.show_prices
      const changed = new Set(p.changes.map(c => c.item_id))
      const subtotal = prices ? orderTotals(p.lines.filter(e => e.quote).map(e => ({ price: e.quote.price, qty: e.qty, vat_rate: e.quote.vat_rate }))).subtotal : null
      return {
        title: 'Update the draft order?',
        lines: [
          p.venue.name + ', ' + (p.order.list_name || 'items on no list') + ' (not sent to suppliers)',
          ...p.all.filter(e => changed.has(e.item.item_id)).map(e => changeLine(e, prices, p.venue.currency)),
          plural(p.lines.length, 'line') + ' with a quantity' + (prices ? ', ' + money(subtotal, p.venue.currency) + ' ex VAT' : ''),
        ],
        ...(p.noSupplier.length ? { warningTitle: 'No supplier price', warnings: [p.noSupplier.join(', ') + ' can\'t be ordered until they have a supplier price.'] } : {}),
        confirmLabel: 'Save draft',
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const p = await planOrder(ctx, input)
      return audited(ctx, 'update_order', input, async () => {
        if (p.changes.length) await callApi(ctx, 'PUT', '/api/purchasing/orders/' + p.order.id + '/lines', { body: { lines: p.changes } })
        return {
          order_id: p.order.id, venue: p.venue.name, list: p.order.list_name ?? 'no list', lines_with_quantity: p.lines.length,
          message: 'Draft saved. Nothing has gone to suppliers yet.',
        }
      })
    },
  },

  {
    name: 'place_order',
    title: 'Place an order',
    description:
      'Places a venue\'s draft order for a list (after applying any lines / fill_to_par, as update_order): it is split ' +
      'into one purchase order per supplier, each for that supplier\'s next delivery day unless deliveries gives a ' +
      'date. Suppliers that take email are emailed straight away; the rest wait in To send. Quantities are rounded ' +
      'up to each supplier\'s minimum and steps.',
    input: z.object({
      ...OrderTarget,
      lines:       z.array(OrderLine).max(300).optional(),
      fill_to_par: z.boolean().optional(),
      deliveries:  z.array(z.object({
        supplier: z.string().min(1).max(200),
        date:     DateStr.optional().describe('Delivery date for this supplier\'s order'),
        notes:    z.string().max(2000).optional().describe('Note printed on this supplier\'s order'),
      })).max(30).optional(),
      planned_delivery: z.record(z.string().uuid(), DateStr).optional().describe('Filled in by the confirm card: leave it out'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const p = await planOrder(ctx, input)
      const groups = placeChecks(p, input)
      // The first delivery day the card shows for each supplier (no date
      // given): if it has moved by Confirm (a cutoff passed), run() refuses.
      const planned = Object.fromEntries(groups.filter(g => !g.override).map(g => [g.id, g.date]))
      const cur = p.venue.currency
      const prices = p.order.show_prices
      const lines = [p.venue.name + ', ' + (p.order.list_name || 'items on no list')]
      const warnings = []
      for (const g of groups) {
        lines.push(g.s.name + ': delivery ' + longDate(g.date) + ', ' + sentHow(g.s) +
          (prices ? ', ' + money(g.totals.subtotal, cur) + ' ex VAT' : ''))
        for (const e of g.lines) lines.push('  ' + fmtNum(e.fitted) + ' x ' + e.item.name + ' (' + e.quote.pack_label + ')')
        if (g.notes) lines.push('  Note: ' + g.notes)
        for (const e of g.lines) {
          if (e.fitted !== e.qty) warnings.push(e.item.name + ': ' + fmtNum(e.qty) + ' becomes ' + fmtNum(e.fitted) + ' (' + qtyProblem(e.qty, e.quote) + ').')
        }
        if (prices && g.s.min_order && g.totals.subtotal < g.s.min_order) {
          warnings.push(g.s.name + '\'s minimum order is ' + money(g.s.min_order, cur) + '; this is ' + money(g.totals.subtotal, cur) + '.')
        }
        if (g.override && g.s.delivery_days?.length && !g.s.delivery_days.includes(weekdayOf(g.date))) {
          warnings.push(g.s.name + ' doesn\'t usually deliver on ' + DAY_LABELS[weekdayOf(g.date)] + 's (' + daysText(g.s.delivery_days) + ').')
        }
        if (!g.override && g.s.cutoff_time && g.s.minutes_to_cutoff != null && g.s.minutes_to_cutoff <= 0) {
          warnings.push('Today\'s ' + hhmm(g.s.cutoff_time) + ' cutoff for ' + g.s.name + ' has passed, so its first delivery is ' + longDate(g.date) + '.')
        }
        if (g.s.send_method === 'email' && !g.s.email) warnings.push(g.s.name + ' has no order email address: its order waits in To send.')
      }
      return {
        title: 'Place this order?',
        lines,
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Place order',
        ...(Object.keys(planned).length ? { pin: { planned_delivery: planned } } : {}),
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const p = await planOrder(ctx, input)
      const groups = placeChecks(p, input)
      for (const g of groups) {
        const was = input.planned_delivery?.[g.id]
        if (!g.override && was && was !== g.date) {
          throw new ToolError('The order cutoff for ' + g.s.name + ' passed after the card was shown, so its first delivery is now ' +
            longDate(g.date) + ', not ' + longDate(was) + '. Ask again to place it for the new day.', 409)
        }
      }
      return audited(ctx, 'place_order', input, async () => {
        if (p.changes.length) await callApi(ctx, 'PUT', '/api/purchasing/orders/' + p.order.id + '/lines', { body: { lines: p.changes } })
        const suppliers = {}
        for (const g of groups) {
          if (g.override || g.notes) suppliers[g.id] = { ...(g.override ? { delivery_date: g.date } : {}), ...(g.notes ? { notes: g.notes } : {}) }
        }
        const res = await callApi(ctx, 'POST', '/api/purchasing/orders/' + p.order.id + '/submit', { body: { suppliers } })
        const byId = new Map(res.results.map(r => [r.id, r]))
        return {
          order_id: res.order_id,
          purchase_orders: res.purchase_orders.map(po => {
            const r = byId.get(po.id) || {}
            return {
              po: poNumberLabel(po.number), po_id: po.id, supplier: po.supplier_name, delivery: longDate(po.delivery_date),
              ...(po.total !== undefined ? { total: money(po.total, p.venue.currency) } : {}),
              sent: r.emailed ? 'emailed' : r.error ? 'not sent: ' + r.error : 'waiting in To send (' + po.send_method + ')',
            }
          }),
          message: 'Order placed.',
        }
      })
    },
  },

  {
    name: 'send_purchase_order',
    title: 'Send a purchase order',
    description:
      'how: email sends the purchase order to the supplier now (again, if it was already sent); printed, pdf, excel, ' +
      'phone or other marks it as already sent that way (it must be waiting in To send).',
    input: z.object({
      po:  z.string().min(1).max(60).describe('Number, e.g. PO-00012'),
      how: z.enum(['email', 'printed', 'pdf', 'excel', 'phone', 'other']),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const d = await sendCheck(ctx, input)
      const cur = await poCurrency(ctx, d)
      return {
        title: input.how === 'email' ? 'Email ' + poNumberLabel(d.number) + ' to ' + d.supplier_name + '?' : 'Mark ' + poNumberLabel(d.number) + ' as sent?',
        lines: [
          poTitle(d) + ', delivery ' + longDate(d.delivery_date),
          plural(d.lines.length, 'line') + (d.total !== undefined ? ', ' + money(d.total, cur) : ''),
          input.how === 'email'
            ? 'To ' + d.supplier_email + (d.cc_emails ? ', copy to ' + d.cc_emails : '') +
              (d.email_attachment === 'pdf' ? ', PDF attached' : d.email_attachment === 'excel' ? ', Excel file attached' : '')
            : 'Sent ' + ({ printed: 'as a printout', pdf: 'as a PDF', excel: 'as an Excel file', phone: 'by phone', other: 'another way' })[input.how],
        ],
        ...(d.status === 'sent' ? { warningTitle: 'Already sent', warnings: ['It went ' + (d.sent_via || '') + ' already: the supplier gets it again.'] } : {}),
        confirmLabel: input.how === 'email' ? 'Send email' : 'Mark sent',
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const d = await sendCheck(ctx, input)
      return audited(ctx, 'send_purchase_order', input, async () => {
        const res = input.how === 'email'
          ? await callApi(ctx, 'POST', '/api/purchasing/pos/' + d.id + '/send')
          : await callApi(ctx, 'POST', '/api/purchasing/pos/' + d.id + '/mark-sent', { body: { via: input.how === 'printed' ? 'print' : input.how } })
        return { po: poNumberLabel(res.number), status: PO_STATUSES[res.status], message: input.how === 'email' ? 'Emailed to ' + d.supplier_email + '.' : 'Marked as sent.' }
      })
    },
  },

  {
    name: 'change_purchase_order',
    title: 'Change a purchase order',
    description:
      'Changes a purchase order: delivery_date and notes (until it is received), and while it is waiting in To send ' +
      'the quantities (lines; 0 takes a line off) or more products from the same supplier (add).',
    input: z.object({
      po:            z.string().min(1).max(60),
      delivery_date: DateStr.optional(),
      notes:         z.string().max(2000).nullable().optional(),
      lines:         z.array(z.object({ item: z.string().min(1).max(200), quantity: Qty })).max(300).optional(),
      add:           z.array(z.object({
        item:     z.string().min(1).max(200),
        quantity: z.number().positive().max(100000),
        pack:     z.string().max(100).optional(),
      })).max(100).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const p = await poChangePlan(ctx, input)
      return {
        title: 'Change ' + poNumberLabel(p.d.number) + '?',
        lines: [poTitle(p.d), ...p.lines],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Save order',
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const p = await poChangePlan(ctx, input)
      return audited(ctx, 'change_purchase_order', input, async () => {
        if (Object.keys(p.body).length) await callApi(ctx, 'PATCH', '/api/purchasing/pos/' + p.d.id, { body: p.body })
        if (p.lineChanges.length || p.adds.length) {
          await callApi(ctx, 'PUT', '/api/purchasing/pos/' + p.d.id + '/lines', { body: { lines: p.lineChanges, add: p.adds } })
        }
        return { po: poNumberLabel(p.d.number), message: 'Saved.' + (p.d.status === 'sent' ? ' Let the supplier know.' : '') }
      })
    },
  },

  {
    name: 'cancel_purchase_order',
    title: 'Cancel a purchase order',
    description: 'Cancels a purchase order that hasn\'t been received. If it was already sent, the supplier must be told.',
    input: z.object({ po: z.string().min(1).max(60) }),
    confirm: true,
    destructive: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const d = await findPo(ctx, input.po)
      if (!['to_send', 'sent'].includes(d.status)) throw new ToolError(poNumberLabel(d.number) + ' is ' + PO_STATUSES[d.status].toLowerCase() + ', so it can\'t be cancelled.', 409)
      const cur = await poCurrency(ctx, d)
      return {
        title: 'Cancel ' + poNumberLabel(d.number) + '?',
        lines: [poTitle(d) + ', delivery ' + longDate(d.delivery_date), plural(d.lines.length, 'line') + (d.total !== undefined ? ', ' + money(d.total, cur) : '')],
        ...(d.status === 'sent' ? {
          warningTitle: 'Already sent',
          warnings: [d.supplier_name + ' already has this order. Tell them it\'s cancelled' + (d.supplier_phone ? ' (' + d.supplier_phone + ')' : '') + '.'],
        } : {}),
        confirmLabel: 'Cancel order',
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const d = await findPo(ctx, input.po)
      return audited(ctx, 'cancel_purchase_order', input, async () => {
        await callApi(ctx, 'POST', '/api/purchasing/pos/' + d.id + '/cancel')
        return { po: poNumberLabel(d.number), message: 'Cancelled.' + (d.status === 'sent' ? ' Tell ' + d.supplier_name + '.' : '') }
      })
    },
  },

  {
    name: 'receive_delivery',
    title: 'Book in a delivery',
    description:
      'Books in a delivery against its purchase order: lines that differ from the order (packs received, and a ' +
      'status: short, damaged, substituted, missing), the checks (packaging, no damage, quality), the probe ' +
      'temperature of chilled and of frozen goods (needed when they arrived; at most 8°C chilled, -15°C frozen) and ' +
      'whether it was accepted. Also saves the delivery check in Food safety. Anything failed needs a corrective ' +
      'action. Booking in again corrects it.',
    input: z.object({
      po:                z.string().min(1).max(60),
      lines:             z.array(z.object({
        item:     z.string().min(1).max(200),
        received: Qty.describe('Packs that arrived'),
        status:   z.enum(['ok', 'short', 'damaged', 'substituted', 'missing']).optional(),
        note:     z.string().max(500).optional(),
      })).max(300).optional().describe('Only lines that differ; the rest arrived as ordered'),
      packaging_ok:      z.boolean().default(true),
      damage_ok:         z.boolean().default(true).describe('true when nothing was damaged'),
      quality_ok:        z.boolean().default(true),
      chilled_temp_c:    z.number().min(-40).max(40).optional(),
      frozen_temp_c:     z.number().min(-40).max(40).optional(),
      accepted:          z.boolean().default(true),
      corrective_action: z.string().max(2000).optional(),
      notes:             z.string().max(2000).optional(),
      date:              DateStr.optional().describe('Defaults to today at the venue'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireOrder(ctx)
      const p = await receivePlan(ctx, input)
      const { d } = p
      const differ = p.lines.filter(l => l.status !== 'ok' || l.note)
      return {
        title: 'Book in ' + poNumberLabel(d.number) + '?',
        lines: [
          poTitle(d) + ', ' + longDate(p.date),
          ...differ.map(l => l.line.item_name + ': ' + fmtNum(l.received) + ' of ' + fmtNum(l.line.qty) + ' (' +
            (RECEIVE_STATUSES.find(s => s.key === l.status)?.label ?? l.status) + ')' + (l.note ? ', ' + l.note : '')),
          ...(p.lines.length > differ.length
            ? [(differ.length ? 'Everything else' : 'Everything') + ' as ordered (' + plural(p.lines.length - differ.length, 'line') + ')']
            : []),
          ...(p.chilled != null ? ['Chilled goods: ' + p.chilled.toFixed(1) + '°C' + (deliveryTempOk('chilled', p.chilled) ? '' : ' (over ' + DELIVERY_TEMP_MAX.chilled + '°C)')] : []),
          ...(p.frozen != null ? ['Frozen goods: ' + p.frozen.toFixed(1) + '°C' + (deliveryTempOk('frozen', p.frozen) ? '' : ' (over ' + DELIVERY_TEMP_MAX.frozen + '°C)')] : []),
          p.failed.length ? 'Not OK: ' + p.failed.join(', ') : 'Packaging, damage and quality OK',
          input.accepted ? 'Accepted' : 'Rejected',
          ...(input.corrective_action ? ['Corrective action: ' + input.corrective_action] : []),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
          'Also saved as the delivery check in Food safety',
        ],
        ...(p.warnings.length ? { warningTitle: p.problem ? 'Failed check' : 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Book in',
      }
    },
    async run(ctx, input) {
      await requireOrder(ctx)
      const p = await receivePlan(ctx, input)
      return audited(ctx, 'receive_delivery', input, async () => {
        await callApi(ctx, 'POST', '/api/purchasing/pos/' + p.d.id + '/receive', {
          body: {
            received_date: p.date,
            notes: input.notes ?? null,
            lines: p.lines.map(l => ({ id: l.line.id, received_qty: l.received, status: l.status, note: l.note ?? null })),
            check: {
              packaging_ok: input.packaging_ok, damage_ok: input.damage_ok, quality_ok: input.quality_ok,
              chilled_temp_c: p.chilled, frozen_temp_c: p.frozen,
              accepted: input.accepted, corrective_action: input.corrective_action ?? null,
            },
          },
        })
        return {
          po: poNumberLabel(p.d.number),
          short_or_missing: p.lines.filter(l => l.status !== 'ok').map(l => l.line.item_name),
          message: 'Booked in, and the delivery check is saved.' + (p.problem && !input.corrective_action
            ? ' It failed a check with no corrective action: ask what was done about it.' : ''),
        }
      })
    },
  },
]

// ── Plans (shared by describe and run) ─────────────────────

async function newItemPlan(ctx, input) {
  const [items, cats, sups, cur] = await Promise.all([loadItems(ctx), loadCategories(ctx), loadSuppliers(ctx), tenantCurrency(ctx)])
  const same = items.find(i => i.name.toLowerCase() === input.name.trim().toLowerCase())
  if (same) {
    throw new ToolError('There is already an item called ' + same.name + '. Change it with update_inventory_item, or add a price with add_supplier_price.', 409)
  }
  if (input.code) {
    const dupe = items.find(i => i.code && i.code.toLowerCase() === input.code.trim().toLowerCase())
    if (dupe) throw new ToolError(dupe.name + ' already has the code ' + input.code + '.', 409)
  }
  const base = input.counted_in ? BASE_FOR[input.counted_in] : input.prices?.length ? BASE_FOR[input.prices[0].pack_unit] : 'each'
  const cat = input.category
    ? (cats.find(c => c.name.toLowerCase() === input.category.trim().toLowerCase()) || { name: input.category.trim(), isNew: true })
    : null
  const warnings = []
  const prices = (input.prices || []).map(x => {
    const sup = pickSupplier(sups, x.supplier)
    checkFits(specOf(x), base, input.name)
    if (!sup.is_active) warnings.push(sup.name + ' is switched off, so this price won\'t be ordered on until it is back on.')
    return { ...x, sup }
  })
  return { base, cat, prices, cur, warnings }
}

async function itemChangePlan(ctx, input) {
  const [items, cats] = await Promise.all([loadItems(ctx), loadCategories(ctx)])
  const item = pickItem(items, input.item)
  const body = {}
  const lines = []
  let newCategory = null
  if (input.name !== undefined && input.name !== item.name) {
    const other = items.find(i => i.id !== item.id && i.name.toLowerCase() === input.name.toLowerCase())
    if (other) throw new ToolError('There is already an item called ' + other.name + '.', 409)
    body.name = input.name
    lines.push('Name: ' + item.name + ' to ' + input.name)
  }
  if (input.counted_in !== undefined && BASE_FOR[input.counted_in] !== item.base_unit) {
    if (item.quotes.length) throw new ToolError(item.name + ' has supplier prices, so how it is counted can\'t change. Remove its prices first.', 422)
    body.base_unit = BASE_FOR[input.counted_in]
    lines.push('Counted: ' + COUNTED[item.base_unit] + ' to ' + COUNTED[body.base_unit])
  }
  if (input.storage !== undefined && input.storage !== item.storage) {
    body.storage = input.storage
    lines.push('Storage: ' + item.storage + ' to ' + input.storage)
  }
  if (input.category !== undefined) {
    const want = input.category?.trim() || null
    if (!want && item.category_id) {
      body.category_id = null
      lines.push('Category: ' + item.category_name + ' to none')
    } else if (want && want.toLowerCase() !== (item.category_name || '').toLowerCase()) {
      const c = cats.find(x => x.name.toLowerCase() === want.toLowerCase())
      if (c) body.category_id = c.id
      else newCategory = want
      lines.push('Category: ' + show(item.category_name) + ' to ' + (c ? c.name : want + ' (new category)'))
    }
  }
  for (const [k, label] of [['code', 'Code'], ['notes', 'Notes']]) {
    if (input[k] === undefined) continue
    const v = input[k]?.trim() || null
    if (v === (item[k] || null)) continue
    if (k === 'code' && v) {
      const dupe = items.find(i => i.id !== item.id && i.code && i.code.toLowerCase() === v.toLowerCase())
      if (dupe) throw new ToolError(dupe.name + ' already has the code ' + v + '.', 409)
    }
    body[k] = v
    lines.push(label + ': ' + show(item[k]) + ' to ' + show(v))
  }
  if (input.active !== undefined && input.active !== item.is_active) {
    body.is_active = input.active
    lines.push(input.active ? 'Switch back on' : 'Switch off')
  }
  if (!lines.length) throw new ToolError('Nothing to change: ' + item.name + ' already has those details.', 422)
  return { item, body, lines, newCategory }
}

async function newPricePlan(ctx, input) {
  const [items, sups, venues] = await Promise.all([loadItems(ctx), loadSuppliers(ctx), tenantVenues(ctx)])
  const item = pickItem(items, input.item)
  const sup = pickSupplier(sups, input.supplier)
  const pb = checkFits(specOf(input), item.base_unit, item.name)
  const same = item.quotes.find(q => q.supplier_id === sup.id && (input.supplier_code
    ? (q.supplier_code || '').toLowerCase() === input.supplier_code.toLowerCase()
    : !q.supplier_code && Math.abs(Number(q.pack_base_qty) - pb) < 1e-6))
  if (same) {
    throw new ToolError(item.name + ' already has this price from ' + sup.name + ' (' + quoteName(same) + ' at ' +
      money(same.price, venues[0]?.currency) + '). Change it with update_supplier_price.', 409)
  }
  const venuePrices = (input.venue_prices || []).map(v => {
    const venue = venues.find(x => x.id === v.venue_id)
    if (!venue) throw new ToolError('Venue not found. Use list_venues.', 404)
    return { id: venue.id, name: venue.name, price: v.price }
  })
  const cur = venues[0]?.currency || 'GBP'
  const per = input.price / pb
  const live = item.quotes.filter(q => q.is_active && q.supplier_active !== false)
  const cheapest = live.length > 0 && live.every(q => per < Number(q.price) / Number(q.pack_base_qty))
  const warnings = sup.is_active ? [] : [sup.name + ' is switched off, so this price won\'t be ordered on until it is back on.']
  return { item, sup, venuePrices, cur, cheapest, warnings }
}

async function priceChangePlan(ctx, input) {
  const [items, venues] = await Promise.all([loadItems(ctx), tenantVenues(ctx)])
  const item = pickItem(items, input.item)
  const quote = pickQuote(item.name, item.quotes, input.supplier, input.which)
  const cur = venues[0]?.currency || 'GBP'
  const body = {}
  const lines = []
  const warnings = []
  const packChange = ['pack_name', 'pack_count', 'pack_size', 'pack_unit'].some(k => input[k] !== undefined)
  const spec = {
    pack_name: input.pack_name ?? quote.pack_name, pack_count: input.pack_count ?? quote.pack_count,
    pack_qty: input.pack_size ?? quote.pack_qty, pack_unit: input.pack_unit ?? quote.pack_unit,
  }
  const pb = packChange ? checkFits(spec, item.base_unit, item.name) : quote.pack_base_qty
  if (packChange) {
    Object.assign(body, {
      ...(input.pack_name !== undefined ? { pack_name: input.pack_name } : {}),
      ...(input.pack_count !== undefined ? { pack_count: input.pack_count } : {}),
      ...(input.pack_size !== undefined ? { pack_qty: input.pack_size } : {}),
      ...(input.pack_unit !== undefined ? { pack_unit: input.pack_unit } : {}),
    })
    lines.push('Pack: ' + packLabel(quote) + ' to ' + packLabel(spec))
  }
  if (input.price !== undefined && Math.abs(input.price - quote.price) > 1e-9) {
    body.price = input.price
    lines.push('Price: ' + money(quote.price, cur) + ' to ' + priceText({ pack_base_qty: pb }, input.price, item.base_unit, cur))
    const change = quote.price > 0 ? (input.price - quote.price) / quote.price : 0
    if (Math.abs(change) >= 0.2) warnings.push('That is ' + (change > 0 ? 'up' : 'down') + ' ' + Math.round(Math.abs(change) * 100) + '% on the current price.')
  } else if (packChange) {
    lines.push('Price stays ' + priceText({ pack_base_qty: pb }, quote.price, item.base_unit, cur))
  }
  if (input.vat_rate !== undefined && input.vat_rate !== Number(quote.vat_rate)) {
    body.vat_rate = input.vat_rate
    lines.push('VAT: ' + fmtNum(quote.vat_rate) + '% to ' + fmtNum(input.vat_rate) + '%')
  }
  for (const [k, label] of [['supplier_code', 'Supplier code'], ['min_qty', 'Minimum packs'], ['order_multiple', 'Steps of']]) {
    if (input[k] === undefined) continue
    const v = input[k] === '' ? null : input[k]
    if ((v ?? null) === (quote[k] ?? null)) continue
    body[k] = v
    lines.push(label + ': ' + show(quote[k]) + ' to ' + show(v))
  }
  if (input.active !== undefined && input.active !== quote.is_active) {
    body.is_active = input.active
    lines.push(input.active ? 'Switch this price back on' : 'Switch this price off (it won\'t be ordered on)')
  }
  const venuePrices = (input.venue_prices || []).map(v => {
    const venue = venues.find(x => x.id === v.venue_id)
    if (!venue) throw new ToolError('Venue not found. Use list_venues.', 404)
    const before = quote.venue_prices?.[venue.id]
    lines.push(venue.name + ': ' + (before == null ? 'company price' : money(before, cur)) + ' to ' +
      (v.price == null ? 'company price' : money(v.price, cur)))
    return { id: venue.id, price: v.price }
  })
  if (!lines.length || (!Object.keys(body).length && !venuePrices.length)) throw new ToolError('Nothing to change on that price.', 422)
  return { item, quote, body, lines, venuePrices, warnings }
}

async function preferredPlan(ctx, input) {
  const [items, venues] = await Promise.all([loadItems(ctx), tenantVenues(ctx)])
  const item = pickItem(items, input.item)
  const venue = input.venue_id ? venues.find(v => v.id === input.venue_id) : null
  if (input.venue_id && !venue) throw new ToolError('Venue not found. Use list_venues.', 404)
  const currentId = venue ? item.preferred?.venues?.[venue.id] : item.preferred?.default
  const current = item.quotes.find(q => q.id === currentId) || null
  let quote = null
  if (!input.clear) {
    if (!input.supplier && !input.which && item.quotes.length > 1) throw new ToolError('Which supplier? ' + item.name + ' has: ' + item.quotes.map(quoteName).join('; ') + '.', 422)
    quote = pickQuote(item.name, item.quotes, input.supplier, input.which)
    if (!quote.is_active) throw new ToolError('That price is switched off. Switch it on with update_supplier_price first.', 422)
  } else if (!current) {
    throw new ToolError(item.name + ' has no supplier choice ' + (venue ? 'at ' + venue.name : 'for the company') + ' to clear.', 422)
  }
  return { item, venue, quote, current, cur: (venue || venues[0])?.currency || 'GBP' }
}

async function newSupplierPlan(ctx, input) {
  const [sups, cur] = await Promise.all([loadSuppliers(ctx), tenantCurrency(ctx)])
  const same = sups.find(s => s.name.toLowerCase() === input.name.trim().toLowerCase())
  if (same) throw new ToolError('There is already a supplier called ' + same.name + '. Change it with update_supplier.', 409)
  const body = supplierBody({ ...input, name: input.name.trim() })
  const warnings = []
  if ((body.send_method ?? 'email') === 'email' && !body.email) warnings.push('Orders go by email but there\'s no email address yet, so they will wait in To send.')
  return { body, cur, warnings }
}

async function supplierChangePlan(ctx, input) {
  const [sups, cur] = await Promise.all([loadSuppliers(ctx), tenantCurrency(ctx)])
  const sup = pickSupplier(sups, input.supplier)
  if (input.name && input.name.toLowerCase() !== sup.name.toLowerCase()) {
    const other = sups.find(s => s.id !== sup.id && s.name.toLowerCase() === input.name.toLowerCase())
    if (other) throw new ToolError('There is already a supplier called ' + other.name + '.', 409)
  }
  const wanted = supplierBody(input)
  const body = {}
  const lines = []
  for (const [k, v] of Object.entries(wanted)) {
    const before = k === 'cutoff_time' ? hhmm(sup[k]) : sup[k]
    const same = k === 'delivery_days' ? JSON.stringify(before || []) === JSON.stringify(v || []) : (before ?? null) === (v ?? null)
    if (same) continue
    body[k] = v
    lines.push(SUPPLIER_LABELS[k] + ': ' + supplierValue(k, before, cur) + ' to ' + supplierValue(k, v, cur))
  }
  let venues = null
  if (input.venue) {
    const v = input.venue
    const [venue] = (await tenantVenues(ctx)).filter(x => x.id === v.venue_id)
    if (!venue) throw new ToolError('Venue not found. Use list_venues.', 404)
    const detail = await callApi(ctx, 'GET', '/api/suppliers/' + sup.id)
    const cur0 = detail.venues.find(x => x.venue_id === venue.id) || { venue_id: venue.id, account_ref: null, delivery_days: null, cutoff_time: null }
    const others = detail.venues.filter(x => x.venue_id !== venue.id)
      .map(x => ({ venue_id: x.venue_id, account_ref: x.account_ref, delivery_days: x.delivery_days, cutoff_time: hhmm(x.cutoff_time) }))
    if (v.use_supplier_settings) {
      venues = others
      lines.push(venue.name + ': use the supplier\'s own settings')
    } else {
      const next = {
        venue_id: venue.id,
        account_ref: v.account_ref !== undefined ? v.account_ref : cur0.account_ref,
        delivery_days: v.delivery_days !== undefined ? parseDays(v.delivery_days) : cur0.delivery_days,
        cutoff_time: v.order_cutoff !== undefined ? v.order_cutoff : hhmm(cur0.cutoff_time),
      }
      venues = [...others, next]
      lines.push(venue.name + ': account ' + show(next.account_ref) + ', delivery days ' +
        (next.delivery_days == null ? 'as the supplier' : daysText(next.delivery_days)) +
        ', cutoff ' + (next.cutoff_time ? hhmm(next.cutoff_time) : 'as the supplier'))
    }
  }
  if (!lines.length) throw new ToolError('Nothing to change: ' + sup.name + ' already has those details.', 422)
  const sendMethod = body.send_method ?? sup.send_method
  const email = body.email !== undefined ? body.email : sup.email
  const warnings = sendMethod === 'email' && !email ? ['Orders go by email but there\'s no email address, so they will wait in To send.'] : []
  if (body.is_active === false) warnings.push('Switched off, its prices aren\'t ordered on; open orders keep it.')
  return { sup, body, venues, lines, warnings }
}

async function newListPlan(ctx, input) {
  const [lists, venues, items] = await Promise.all([loadLists(ctx), tenantVenues(ctx), input.items?.length ? loadItems(ctx) : []])
  const same = lists.find(l => l.name.toLowerCase() === input.name.trim().toLowerCase())
  if (same) throw new ToolError('There is already an order list called ' + same.name + '. Change it with update_order_list.', 409)
  const chosen = [...new Set(input.venue_ids)].map(id => {
    const v = venues.find(x => x.id === id)
    if (!v) throw new ToolError('Venue not found. Use list_venues.', 404)
    return v
  })
  const { picked, noPrice } = pickItems(items, input.items || [])
  return { venues: chosen, items: picked, noPrice }
}

/** Items by name or code; every problem in one message. */
function pickItems(items, texts) {
  const picked = []
  const problems = []
  for (const t of texts) {
    try {
      const it = pickItem(items, t)
      if (!picked.some(p => p.id === it.id)) picked.push(it)
    } catch (err) {
      problems.push(err.message)
    }
  }
  if (problems.length) throw new ToolError(problems.join(' '), 404)
  return { picked, noPrice: picked.filter(i => !i.quotes.some(q => q.is_active)).map(i => i.name) }
}

async function listChangePlan(ctx, input) {
  const [lists, venues] = await Promise.all([loadLists(ctx), tenantVenues(ctx)])
  const list = pickByName(lists, input.list, l => l.name, 'order list', 'No order lists yet.')
  const detail = await callApi(ctx, 'GET', '/api/purchasing/lists/' + list.id)
  const venueName = new Map(venues.map(v => [v.id, v.name]))
  const body = {}
  const lines = []
  const warnings = []
  if (input.name && input.name !== list.name) {
    const other = lists.find(l => l.id !== list.id && l.name.toLowerCase() === input.name.toLowerCase())
    if (other) throw new ToolError('There is already an order list called ' + other.name + '.', 409)
    body.name = input.name
    lines.push('Name: ' + list.name + ' to ' + input.name)
  }
  if (input.notes !== undefined && (input.notes || null) !== (detail.notes || null)) {
    body.notes = input.notes || null
    lines.push('Notes: ' + show(detail.notes) + ' to ' + show(input.notes))
  }
  if (input.active !== undefined && input.active !== detail.is_active) {
    body.is_active = input.active
    lines.push(input.active ? 'Switch back on' : 'Switch off (venues stop seeing it)')
  }
  let venueIds = null
  if (input.add_venues?.length || input.remove_venues?.length) {
    for (const id of [...(input.add_venues || []), ...(input.remove_venues || [])]) {
      if (!venueName.has(id)) throw new ToolError('Venue not found. Use list_venues.', 404)
    }
    const set = new Set(detail.venue_ids)
    for (const id of input.add_venues || []) if (!set.has(id)) { set.add(id); lines.push('Add venue ' + venueName.get(id)) }
    for (const id of input.remove_venues || []) if (set.delete(id)) lines.push('Remove venue ' + venueName.get(id))
    venueIds = [...set]
  }
  let itemIds = null
  if (input.add_items?.length || input.remove_items?.length) {
    const current = detail.items.map(i => ({ ...i, id: i.item_id }))
    const remove = new Set()
    for (const t of input.remove_items || []) {
      const it = pickByName(current, t, i => i.name, 'item on ' + list.name)
      remove.add(it.item_id)
      lines.push('Remove ' + it.name)
    }
    if (remove.size && current.some(i => remove.has(i.item_id) && Object.keys(i.pars || {}).length)) {
      warnings.push('Removing an item also removes its pars.')
    }
    const ids = current.map(i => i.item_id).filter(id => !remove.has(id))
    if (input.add_items?.length) {
      const { picked, noPrice } = pickItems(await loadItems(ctx), input.add_items)
      for (const it of picked) {
        if (ids.includes(it.id)) continue
        ids.push(it.id)
        lines.push('Add ' + it.name)
      }
      if (noPrice.length) warnings.push(noPrice.join(', ') + ' can\'t be ordered until they have a supplier price.')
    }
    itemIds = ids
  }
  if (!lines.length) throw new ToolError('Nothing to change on ' + list.name + '.', 422)
  return { list, body, venueIds, itemIds, lines, warnings }
}

async function parsPlan(ctx, input) {
  const [lists, venue] = await Promise.all([loadLists(ctx), venueOf(ctx, input.venue_id)])
  const list = pickByName(lists, input.list, l => l.name, 'order list', 'No order lists yet.')
  const detail = await callApi(ctx, 'GET', '/api/purchasing/lists/' + list.id)
  if (!detail.venue_ids.includes(venue.id)) {
    throw new ToolError(venue.name + ' doesn\'t use ' + list.name + '. Add it with update_order_list (add_venues) first.', 422)
  }
  const items = detail.items.map(i => ({ ...i, id: i.item_id }))
  const rows = input.pars.map(p => {
    const item = pickByName(items, p.item, i => i.name, 'item on ' + list.name)
    let parBase = null
    if (p.par !== null) {
      const unit = p.unit || 'packs'
      if (unit === 'packs') {
        const pb = Number(item.quote?.pack_base_qty)
        if (!(pb > 0)) throw new ToolError(item.name + ' has no supplier price, so give its par in ' + (item.base_unit === 'each' ? 'each' : item.base_unit === 'g' ? 'g or kg' : 'ml or l') + '.', 422)
        parBase = round4(p.par * pb)
      } else {
        const u = UNITS[unit], b = UNITS[item.base_unit]
        if (u.kind !== b.kind) throw new ToolError(item.name + ' is counted ' + COUNTED[item.base_unit] + ', not in ' + unit + '.', 422)
        parBase = round4(p.par * u.factor / b.factor)
      }
    }
    return { item, par_base: parBase, before: item.pars?.[venue.id] ?? null }
  })
  return { list, venue, rows }
}

/** The groups place_order submits, after the checks that stop it. */
function placeChecks(plan, input) {
  if (plan.noSupplier.length) {
    throw new ToolError('No active supplier price for: ' + plan.noSupplier.join(', ') + '. Take them off (quantity 0) or add a price first.', 422)
  }
  if (!plan.lines.length) throw new ToolError('Nothing to order yet: no line has a quantity.', 422)
  return orderGroups(plan, input.deliveries || [])
}

async function sendCheck(ctx, input) {
  const d = await findPo(ctx, input.po)
  if (input.how === 'email') {
    if (!['to_send', 'sent'].includes(d.status)) throw new ToolError(poNumberLabel(d.number) + ' is ' + PO_STATUSES[d.status].toLowerCase() + ', so it can\'t be sent.', 409)
    if (!d.supplier_email) {
      throw new ToolError(d.supplier_name + ' has no order email address. Add it with update_supplier, or send the order another way and mark it sent.', 422)
    }
  } else if (d.status !== 'to_send') {
    throw new ToolError(poNumberLabel(d.number) + ' isn\'t waiting to be sent (it is ' + PO_STATUSES[d.status].toLowerCase() + ').', 409)
  }
  return d
}

async function poChangePlan(ctx, input) {
  const d = await findPo(ctx, input.po)
  const body = {}
  const lines = []
  const warnings = []
  const lineChanges = []
  const adds = []
  if (!['to_send', 'sent'].includes(d.status)) throw new ToolError(poNumberLabel(d.number) + ' is ' + PO_STATUSES[d.status].toLowerCase() + ', so it can\'t be changed.', 409)
  const venue = await venueOf(ctx, d.venue_id)
  if (input.delivery_date !== undefined && input.delivery_date !== d.delivery_date) {
    if (input.delivery_date < venueToday(venue)) throw new ToolError('That delivery date has passed.', 422)
    body.delivery_date = input.delivery_date
    lines.push('Delivery: ' + longDate(d.delivery_date) + ' to ' + longDate(input.delivery_date))
  }
  if (input.notes !== undefined && (input.notes || null) !== (d.notes || null)) {
    body.notes = input.notes || null
    lines.push('Notes: ' + show(d.notes) + ' to ' + show(input.notes))
  }
  if (input.lines?.length || input.add?.length) {
    if (d.status !== 'to_send') {
      throw new ToolError(poNumberLabel(d.number) + ' has gone to the supplier, so its lines can\'t change. Cancel it and order again, or ask the supplier.', 409)
    }
    const poLines = d.lines.map(l => ({ ...l, name: l.item_name }))
    for (const l of input.lines || []) {
      const line = pickByName(poLines, l.item, x => x.name, 'line on ' + poNumberLabel(d.number))
      if (Math.abs(l.quantity - line.qty) < 1e-9) continue
      lineChanges.push({ id: line.id, qty: l.quantity })
      lines.push(line.item_name + ': ' + fmtNum(line.qty) + ' to ' + (l.quantity > 0 ? fmtNum(l.quantity) : '0 (off the order)'))
    }
    for (const a of input.add || []) {
      let hits = await callApi(ctx, 'GET', '/api/purchasing/venues/' + venue.id + '/catalog?search=' + encodeURIComponent(a.item))
      hits = hits.filter(h => h.quotes.some(q => q.supplier_id === d.supplier_id))
      if (!hits.length) throw new ToolError(d.supplier_name + ' has no price for "' + a.item + '".', 404)
      const it = pickByName(hits, a.item, h => h.name, 'product from ' + d.supplier_name)
      const q = pickQuote(it.name, it.quotes.filter(x => x.supplier_id === d.supplier_id), null, a.pack)
      const fitted = fitQty(a.quantity, q)
      adds.push({ quote_id: q.id, qty: a.quantity })
      lines.push('Add ' + fmtNum(fitted) + ' x ' + it.name + ' (' + q.pack_label + ')')
      if (fitted !== a.quantity) warnings.push(it.name + ': ' + fmtNum(a.quantity) + ' becomes ' + fmtNum(fitted) + ' (' + qtyProblem(a.quantity, q) + ').')
    }
    const left = d.lines.length - lineChanges.filter(c => c.qty <= 0).length + adds.length
    if (left <= 0) throw new ToolError('That would leave the order empty. Cancel it with cancel_purchase_order instead.', 422)
  }
  if (!lines.length) throw new ToolError('Nothing to change on ' + poNumberLabel(d.number) + '.', 422)
  if (d.status === 'sent') warnings.push(d.supplier_name + ' already has this order: tell them about the change.')
  return { d, body, lines, lineChanges, adds, warnings }
}

async function receivePlan(ctx, input) {
  const d = await findPo(ctx, input.po)
  if (!['to_send', 'sent', 'received'].includes(d.status)) throw new ToolError(poNumberLabel(d.number) + ' was cancelled, so it can\'t be booked in.', 409)
  const venue = await venueOf(ctx, d.venue_id)
  const poLines = d.lines.map(l => ({ ...l, name: l.item_name }))
  const given = new Map()
  for (const l of input.lines || []) {
    const line = pickByName(poLines, l.item, x => x.name, 'line on ' + poNumberLabel(d.number))
    given.set(line.id, l)
  }
  const lines = poLines.map(line => {
    const g = given.get(line.id)
    if (g) {
      return { line, received: g.received, status: g.status || receiveStatusFor(line.qty, g.received), note: g.note ?? null }
    }
    // A delivery booked in before keeps what was recorded for lines not mentioned.
    if (line.received_qty != null) return { line, received: line.received_qty, status: line.receive_status || 'ok', note: line.receive_note ?? null }
    return { line, received: line.qty, status: 'ok', note: null }
  })
  const arrived = lines.filter(l => l.received > 0)
  const hasChilled = arrived.some(l => l.line.storage === 'chilled')
  const hasFrozen = arrived.some(l => l.line.storage === 'frozen')
  if (hasChilled && input.chilled_temp_c === undefined) {
    throw new ToolError('Chilled goods arrived (' + arrived.filter(l => l.line.storage === 'chilled').map(l => l.line.item_name).join(', ') +
      '): what was their probe temperature? (chilled_temp_c)', 422)
  }
  if (hasFrozen && input.frozen_temp_c === undefined) {
    throw new ToolError('Frozen goods arrived (' + arrived.filter(l => l.line.storage === 'frozen').map(l => l.line.item_name).join(', ') +
      '): what was their probe temperature? (frozen_temp_c)', 422)
  }
  const chilled = hasChilled ? input.chilled_temp_c : null
  const frozen = hasFrozen ? input.frozen_temp_c : null
  const failed = [
    ...(input.packaging_ok ? [] : ['packaging']), ...(input.damage_ok ? [] : ['damage']), ...(input.quality_ok ? [] : ['quality']),
    ...(deliveryTempOk('chilled', chilled) ? [] : ['chilled temperature']), ...(deliveryTempOk('frozen', frozen) ? [] : ['frozen temperature']),
  ]
  const problem = failed.length > 0 || !input.accepted
  const warnings = [
    ...(d.status === 'received' ? ['Already booked in: this replaces what was recorded.'] : []),
    ...(problem && !input.corrective_action ? ['Add what was done about it (a corrective action).'] : []),
  ]
  const date = input.date || venueToday(venue)
  if (date > venueToday(venue)) throw new ToolError('That date is in the future.', 422)
  return { d, lines, chilled, frozen, failed, problem, warnings, date }
}
