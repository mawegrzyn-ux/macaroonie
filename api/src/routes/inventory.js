// src/routes/inventory.js
//
// The purchasing catalogue (migration 153), mounted at /api/inventory:
// categories, items, supplier quotes (product_name: the supplier's own name
// or brand for it, migration 197), per-venue prices, preferred quotes,
// price history and spreadsheet import. Reading needs purchasing_setup view
// (catalogue prices are setup data); restaurant staff see items through
// /api/purchasing. Every query filters tenant_id itself.

import { z }          from 'zod'
import * as XLSX      from 'xlsx'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { UNITS, packBaseQty } from '../../../shared/procurement.js'

const uuid = z.string().uuid()
const text = (max = 200) => z.string().trim().max(max)
// Blank becomes null; left out stays undefined (so a PATCH doesn't clear it).
const optText = (max = 500) => z.string().trim().max(max).nullable().optional().transform(v => (v === undefined ? undefined : v || null))

const CategoryBody = z.object({ name: text(100).min(1) })
const IdsBody = z.object({ ids: z.array(uuid).max(1000) })

const ItemBody = z.object({
  name:        text(200).min(1),
  category_id: uuid.nullable().optional(),
  base_unit:   z.enum(['g', 'ml', 'each']).optional(),
  storage:     z.enum(['ambient', 'chilled', 'frozen']).optional(),
  code:        optText(60),
  notes:       optText(2000),
  is_active:   z.boolean().optional(),
})

const QuoteBody = z.object({
  supplier_id:    uuid,
  supplier_code:  optText(100),
  product_name:   optText(200),
  pack_name:      text(60).optional(),
  pack_count:     z.number().positive().max(100000).optional(),
  pack_qty:       z.number().positive().max(10000000),
  pack_unit:      z.enum(Object.keys(UNITS)),
  price:          z.number().min(0).max(10000000),
  vat_rate:       z.number().min(0).max(100).optional(),
  min_qty:        z.number().positive().max(100000).nullable().optional(),
  order_multiple: z.number().positive().max(100000).nullable().optional(),
  is_active:      z.boolean().optional(),
  notes:          optText(2000),
})

const VenuePricesBody = z.object({
  prices: z.array(z.object({ venue_id: uuid, price: z.number().min(0).max(10000000).nullable() })).max(500),
})

const PreferredBody = z.object({
  venue_id: uuid.nullable(),
  quote_id: uuid.nullable(),
})

const ImportBody = z.object({
  file:    z.string().max(4_000_000),
  dry_run: z.boolean().optional(),
})

const canView   = requirePermission('purchasing_setup', 'view')
const canManage = requirePermission('purchasing_setup', 'manage')

const QUOTE_COLS = (tx, tenantId) => tx`
  q.id, q.item_id, q.supplier_id, q.supplier_code, q.product_name, q.pack_name, q.pack_unit, q.is_active, q.notes,
  q.pack_count::float8 AS pack_count, q.pack_qty::float8 AS pack_qty, q.pack_base_qty::float8 AS pack_base_qty,
  q.price::float8 AS price, q.vat_rate::float8 AS vat_rate,
  q.min_qty::float8 AS min_qty, q.order_multiple::float8 AS order_multiple, q.updated_at,
  s.name AS supplier_name, s.is_active AS supplier_active,
  COALESCE((SELECT jsonb_object_agg(vp.venue_id::text, vp.price::float8)
              FROM inv_quote_venue_prices vp
             WHERE vp.quote_id = q.id AND vp.tenant_id = ${tenantId}), '{}'::jsonb) AS venue_prices`

async function ownItem(tx, tenantId, id) {
  const [i] = await tx`SELECT * FROM inv_items WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!i) throw httpError(404, 'Item not found')
  return i
}

async function ownQuote(tx, tenantId, id) {
  const [q] = await tx`
    SELECT q.*, q.price::float8 AS price, i.base_unit
      FROM inv_quotes q JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = ${tenantId}
     WHERE q.id = ${id} AND q.tenant_id = ${tenantId}
  `
  if (!q) throw httpError(404, 'Quote not found')
  return q
}

async function checkCategory(tx, tenantId, id) {
  if (!id) return
  const [c] = await tx`SELECT id FROM inv_categories WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!c) throw httpError(404, 'Category not found')
}

async function checkSupplier(tx, tenantId, id) {
  const [s] = await tx`SELECT id FROM suppliers WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!s) throw httpError(404, 'Supplier not found')
}

async function checkVenues(tx, tenantId, ids) {
  if (!ids.length) return
  const rows = await tx`SELECT id FROM venues WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}`
  if (rows.length !== new Set(ids).size) throw httpError(404, 'Venue not found')
}

function recordPrice(tx, tenantId, quoteId, venueId, price, by, source = 'manual') {
  return tx`
    INSERT INTO inv_price_history (tenant_id, quote_id, venue_id, price, changed_by, source)
    VALUES (${tenantId}, ${quoteId}, ${venueId}, ${price}, ${by}, ${source})
  `
}

/** Items with their quotes, preferred picks and how many order lists use them. */
async function loadItems(tx, tenantId, itemIds = null) {
  const items = await tx`
    SELECT i.id, i.name, i.category_id, c.name AS category_name, i.base_unit, i.storage, i.code, i.notes,
           i.is_active, i.updated_at,
           (SELECT count(*)::int FROM order_list_items li WHERE li.item_id = i.id AND li.tenant_id = ${tenantId}) AS list_count
      FROM inv_items i
      LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${tenantId}
     WHERE i.tenant_id = ${tenantId}
       ${itemIds ? tx`AND i.id = ANY(${itemIds}::uuid[])` : tx``}
     ORDER BY lower(i.name)
  `
  const ids = items.map(i => i.id)
  if (!ids.length) return []
  const quotes = await tx`
    SELECT ${QUOTE_COLS(tx, tenantId)}
      FROM inv_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = ${tenantId}
     WHERE q.tenant_id = ${tenantId} AND q.item_id = ANY(${ids}::uuid[])
     ORDER BY s.name, q.pack_base_qty
  `
  const prefs = await tx`
    SELECT item_id, venue_id, quote_id FROM inv_preferred
     WHERE tenant_id = ${tenantId} AND item_id = ANY(${ids}::uuid[])
  `
  const byItem = new Map(items.map(i => [i.id, { ...i, quotes: [], preferred: { default: null, venues: {} } }]))
  for (const q of quotes) byItem.get(q.item_id)?.quotes.push(q)
  for (const p of prefs) {
    const it = byItem.get(p.item_id)
    if (!it) continue
    if (p.venue_id) it.preferred.venues[p.venue_id] = p.quote_id
    else it.preferred.default = p.quote_id
  }
  return [...byItem.values()]
}

function quoteValues(body, baseUnit) {
  const pbq = packBaseQty(body, baseUnit)
  if (!pbq) throw httpError(422, `A ${body.pack_unit} pack doesn't fit an item counted in ${baseUnit === 'each' ? 'each' : baseUnit}`)
  return {
    supplier_code:  body.supplier_code ?? null,
    product_name:   body.product_name ?? null,
    pack_name:      body.pack_name || 'pack',
    pack_count:     body.pack_count ?? 1,
    pack_qty:       body.pack_qty,
    pack_unit:      body.pack_unit,
    pack_base_qty:  pbq,
    price:          body.price,
    vat_rate:       body.vat_rate ?? 0,
    min_qty:        body.min_qty ?? null,
    order_multiple: body.order_multiple ?? null,
    is_active:      body.is_active ?? true,
    notes:          body.notes ?? null,
  }
}

// ── Spreadsheet import ──────────────────────────────────────────

const HEADERS = {
  item: 'item', product: 'item', name: 'item', itemname: 'item',
  category: 'category',
  baseunit: 'base_unit', unit: 'base_unit',
  storage: 'storage',
  itemcode: 'code',
  supplier: 'supplier', vendor: 'supplier',
  suppliercode: 'supplier_code', sku: 'supplier_code', productcode: 'supplier_code',
  productname: 'product_name', supplierproduct: 'product_name', brand: 'product_name',
  pack: 'pack_name', packname: 'pack_name',
  packcount: 'pack_count', count: 'pack_count',
  packsize: 'pack_qty', size: 'pack_qty',
  packunit: 'pack_unit',
  price: 'price', packprice: 'price',
  vat: 'vat_rate', vatrate: 'vat_rate',
}

const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', cl: 'cl', l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  each: 'each', ea: 'each', unit: 'each', units: 'each', pc: 'each', pcs: 'each', piece: 'each', pieces: 'each', x: 'each',
}
const BASE_FOR = { g: 'g', kg: 'g', ml: 'ml', cl: 'ml', l: 'ml', each: 'each' }

class DryRun extends Error {}

function parseSheet(base64) {
  let wb
  try { wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer', raw: false }) }
  catch { throw httpError(422, "That file couldn't be read. Save it as CSV or Excel (.xlsx).") }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw httpError(422, 'The file is empty')
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false })
  if (rows.length < 2) throw httpError(422, 'The file needs a heading row and at least one product')
  const keys = rows[0].map(h => HEADERS[String(h).toLowerCase().replace(/[^a-z]/g, '')] || null)
  if (!keys.includes('item')) throw httpError(422, 'No "Item" column found. Use the template headings.')
  return rows.slice(1).map((r, i) => {
    const o = { row: i + 2 }
    keys.forEach((k, c) => { if (k) o[k] = String(r[c] ?? '').trim() })
    return o
  }).filter(o => o.item)
}

const toNum = v => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[£$€,\s%]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

async function runImport(tx, tenantId, rows, by) {
  const out = { rows: rows.length, items_created: 0, items_matched: 0, categories_created: 0, suppliers_created: 0,
                quotes_created: 0, quotes_updated: 0, prices_changed: 0, errors: [] }
  const items = await tx`SELECT id, name, code, base_unit FROM inv_items WHERE tenant_id = ${tenantId}`
  const cats = await tx`SELECT id, name FROM inv_categories WHERE tenant_id = ${tenantId}`
  const sups = await tx`SELECT id, name FROM suppliers WHERE tenant_id = ${tenantId}`
  const quotes = await tx`
    SELECT id, item_id, supplier_id, supplier_code, product_name, lower(pack_name) AS pack_name,
           pack_base_qty::float8 AS pack_base_qty, price::float8 AS price
      FROM inv_quotes WHERE tenant_id = ${tenantId}
  `
  const itemByName = new Map(items.map(i => [i.name.toLowerCase(), i]))
  const itemByCode = new Map(items.filter(i => i.code).map(i => [i.code.toLowerCase(), i]))
  const catByName = new Map(cats.map(c => [c.name.toLowerCase(), c]))
  const supByName = new Map(sups.map(s => [s.name.toLowerCase(), s]))
  let catOrder = cats.length

  for (const r of rows) {
    const err = msg => out.errors.push({ row: r.row, item: r.item, error: msg })
    const packUnit = r.pack_unit ? UNIT_ALIASES[r.pack_unit.toLowerCase()] : null
    if (r.pack_unit && !packUnit) { err(`Unknown pack unit "${r.pack_unit}"`); continue }
    let base = r.base_unit ? BASE_FOR[UNIT_ALIASES[r.base_unit.toLowerCase()]] : null
    if (r.base_unit && !base) { err(`Unknown base unit "${r.base_unit}"`); continue }
    if (!base && packUnit) base = BASE_FOR[packUnit]
    const storage = r.storage ? r.storage.toLowerCase() : null
    if (storage && !['ambient', 'chilled', 'frozen'].includes(storage)) { err(`Storage must be ambient, chilled or frozen`); continue }

    // Check the whole row before writing anything, so a bad row adds nothing.
    let item = (r.code && itemByCode.get(r.code.toLowerCase())) || itemByName.get(r.item.toLowerCase())
    if (item && base && base !== item.base_unit) { err(`${item.name} is counted in ${item.base_unit}, not ${base}`); continue }
    const itemBase = item ? item.base_unit : (base || 'each')
    let quote = null
    if (r.supplier) {
      const price = toNum(r.price), packQty = toNum(r.pack_qty), packCount = toNum(r.pack_count), vat = toNum(r.vat_rate)
      if (price == null || Number.isNaN(price) || price < 0) { err('Price missing or not a number'); continue }
      if (!packUnit) { err('Pack unit missing'); continue }
      if (packQty == null || Number.isNaN(packQty) || packQty <= 0) { err('Pack size missing or not a number'); continue }
      if (Number.isNaN(packCount) || (packCount != null && packCount <= 0)) { err('Pack count not a number'); continue }
      if (Number.isNaN(vat) || (vat != null && (vat < 0 || vat > 100))) { err('VAT % not a number from 0 to 100'); continue }
      const fields = { pack_count: packCount ?? 1, pack_qty: packQty, pack_unit: packUnit }
      const pbq = packBaseQty(fields, itemBase)
      if (!pbq) { err(`A ${packUnit} pack doesn't fit ${r.item} (counted in ${itemBase})`); continue }
      quote = { ...fields, price, vat, pbq }
    }

    if (item) {
      out.items_matched++
    } else {
      let categoryId = null
      if (r.category) {
        let c = catByName.get(r.category.toLowerCase())
        if (!c) {
          ;[c] = await tx`INSERT INTO inv_categories (tenant_id, name, sort_order) VALUES (${tenantId}, ${r.category}, ${catOrder++}) RETURNING id, name`
          catByName.set(c.name.toLowerCase(), c)
          out.categories_created++
        }
        categoryId = c.id
      }
      ;[item] = await tx`
        INSERT INTO inv_items (tenant_id, name, category_id, base_unit, storage, code)
        VALUES (${tenantId}, ${r.item.slice(0, 200)}, ${categoryId}, ${itemBase}, ${storage || 'ambient'}, ${r.code || null})
        RETURNING id, name, code, base_unit
      `
      itemByName.set(item.name.toLowerCase(), item)
      if (item.code) itemByCode.set(item.code.toLowerCase(), item)
      out.items_created++
    }

    if (!quote) continue
    const { price, vat, pbq, pack_qty: packQty, pack_count: packCount } = quote
    let sup = supByName.get(r.supplier.toLowerCase())
    if (!sup) {
      ;[sup] = await tx`INSERT INTO suppliers (tenant_id, name) VALUES (${tenantId}, ${r.supplier.slice(0, 200)}) RETURNING id, name`
      supByName.set(sup.name.toLowerCase(), sup)
      out.suppliers_created++
    }
    const code = r.supplier_code || null
    const productName = r.product_name ? r.product_name.slice(0, 200) : null
    const packName = (r.pack_name || 'pack').slice(0, 60)
    const match = quotes.find(q => q.item_id === item.id && q.supplier_id === sup.id && (code
      ? (q.supplier_code || '').toLowerCase() === code.toLowerCase()
      : !q.supplier_code && q.pack_name === packName.toLowerCase() && Math.abs(q.pack_base_qty - pbq) < 1e-6
        && (!productName || !q.product_name || q.product_name.toLowerCase() === productName.toLowerCase())))
    if (match) {
      await tx`
        UPDATE inv_quotes SET pack_name = ${packName}, pack_count = ${packCount}, pack_qty = ${packQty},
               pack_unit = ${packUnit}, pack_base_qty = ${pbq}, price = ${price},
               vat_rate = ${vat ?? 0}, product_name = COALESCE(${productName}, product_name), updated_at = now()
         WHERE id = ${match.id} AND tenant_id = ${tenantId}
      `
      out.quotes_updated++
      if (productName) match.product_name = productName
      if (Math.abs(match.price - price) > 1e-9) {
        await recordPrice(tx, tenantId, match.id, null, price, by, 'import')
        out.prices_changed++
        match.price = price
      }
    } else {
      const [q] = await tx`
        INSERT INTO inv_quotes (tenant_id, item_id, supplier_id, supplier_code, product_name, pack_name, pack_count, pack_qty,
                                pack_unit, pack_base_qty, price, vat_rate)
        VALUES (${tenantId}, ${item.id}, ${sup.id}, ${code}, ${productName}, ${packName}, ${packCount}, ${packQty},
                ${packUnit}, ${pbq}, ${price}, ${vat ?? 0})
        RETURNING id
      `
      await recordPrice(tx, tenantId, q.id, null, price, by, 'import')
      quotes.push({ id: q.id, item_id: item.id, supplier_id: sup.id, supplier_code: code, product_name: productName, pack_name: packName.toLowerCase(), pack_base_qty: pbq, price })
      out.quotes_created++
    }
  }
  return out
}

export const IMPORT_TEMPLATE = [
  'Item,Category,Base unit,Storage,Item code,Supplier,Supplier code,Product name,Pack,Pack count,Pack size,Pack unit,Price,VAT %',
  'Tomatoes,Vegetables,g,chilled,,Fresh Direct,FD-1001,Vine tomatoes class 1,Box,1,6,kg,12.50,0',
  'Rapeseed oil,"Oils, Sauces & Condiments",ml,ambient,,Brakes,BR-220,Pure rapeseed oil,Case,2,5,l,18.40,0',
  'Takeaway boxes,Packaging,each,ambient,,Brakes,BR-901,,Case,1,250,each,21.00,20',
].join('\n')

// ── Plugin ──────────────────────────────────────────────────────

export default async function inventoryRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Categories ──
  app.get('/categories', { preHandler: canView }, async req => withTenant(req.tenantId, tx => tx`
    SELECT c.id, c.name, c.sort_order,
           (SELECT count(*)::int FROM inv_items i WHERE i.category_id = c.id AND i.tenant_id = ${req.tenantId}) AS item_count
      FROM inv_categories c WHERE c.tenant_id = ${req.tenantId}
     ORDER BY c.sort_order, c.name
  `))

  app.post('/categories', { preHandler: canManage }, async req => {
    const { name } = CategoryBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const [m] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM inv_categories WHERE tenant_id = ${req.tenantId}`
      const [c] = await tx`INSERT INTO inv_categories (tenant_id, name, sort_order) VALUES (${req.tenantId}, ${name}, ${m.n}) RETURNING *`
      return c
    })
  })

  app.patch('/categories/reorder', { preHandler: canManage }, async req => {
    const { ids } = IdsBody.parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE inv_categories SET sort_order = ${i} WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/categories/:id', { preHandler: canManage }, async req => {
    const { name } = CategoryBody.parse(req.body || {})
    const [c] = await withTenant(req.tenantId, tx => tx`
      UPDATE inv_categories SET name = ${name} WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING *
    `)
    if (!c) throw httpError(404, 'Category not found')
    return c
  })

  app.delete('/categories/:id', { preHandler: canManage }, async req => {
    await withTenant(req.tenantId, tx => tx`DELETE FROM inv_categories WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`)
    return { ok: true }
  })

  // ── Items ──
  app.get('/items', { preHandler: canView }, async req => withTenant(req.tenantId, tx => loadItems(tx, req.tenantId)))

  app.get('/items/:id', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    await ownItem(tx, req.tenantId, req.params.id)
    const [item] = await loadItems(tx, req.tenantId, [req.params.id])
    item.lists = await tx`
      SELECT l.id, l.name FROM order_list_items li JOIN order_lists l ON l.id = li.list_id AND l.tenant_id = ${req.tenantId}
       WHERE li.item_id = ${req.params.id} AND li.tenant_id = ${req.tenantId} ORDER BY l.name
    `
    return item
  }))

  app.post('/items', { preHandler: canManage }, async req => {
    const b = ItemBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await checkCategory(tx, req.tenantId, b.category_id)
      const [i] = await tx`
        INSERT INTO inv_items (tenant_id, name, category_id, base_unit, storage, code, notes, is_active)
        VALUES (${req.tenantId}, ${b.name}, ${b.category_id ?? null}, ${b.base_unit || 'each'}, ${b.storage || 'ambient'},
                ${b.code ?? null}, ${b.notes ?? null}, ${b.is_active ?? true})
        RETURNING id
      `
      return (await loadItems(tx, req.tenantId, [i.id]))[0]
    })
  })

  app.patch('/items/:id', { preHandler: canManage }, async req => {
    const b = ItemBody.partial().parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const item = await ownItem(tx, req.tenantId, req.params.id)
      if (b.category_id !== undefined) await checkCategory(tx, req.tenantId, b.category_id)
      if (b.base_unit && b.base_unit !== item.base_unit) {
        const [used] = await tx`
          SELECT (SELECT count(*) FROM inv_quotes WHERE item_id = ${item.id} AND tenant_id = ${req.tenantId})
               + (SELECT count(*) FROM order_list_pars p JOIN order_list_items li ON li.id = p.list_item_id
                   WHERE li.item_id = ${item.id} AND li.tenant_id = ${req.tenantId}) AS n
        `
        if (Number(used.n) > 0) throw httpError(422, 'Remove its supplier quotes and pars before changing how it is counted')
      }
      const fields = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
      if (Object.keys(fields).length) {
        await tx`UPDATE inv_items SET ${tx(fields)}, updated_at = now() WHERE id = ${item.id} AND tenant_id = ${req.tenantId}`
      }
      return (await loadItems(tx, req.tenantId, [item.id]))[0]
    })
  })

  // An item that has been ordered is switched off instead of deleted, so
  // order history keeps its link.
  app.delete('/items/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const item = await ownItem(tx, req.tenantId, req.params.id)
    const [used] = await tx`SELECT 1 FROM purchase_order_lines WHERE item_id = ${item.id} AND tenant_id = ${req.tenantId} LIMIT 1`
    if (used) {
      await tx`UPDATE inv_items SET is_active = false, updated_at = now() WHERE id = ${item.id} AND tenant_id = ${req.tenantId}`
      return { archived: true }
    }
    await tx`DELETE FROM inv_items WHERE id = ${item.id} AND tenant_id = ${req.tenantId}`
    return { deleted: true }
  }))

  app.post('/items/bulk', { preHandler: canManage }, async req => {
    const b = z.object({
      ids:         z.array(uuid).min(1).max(1000),
      category_id: uuid.nullable().optional(),
      is_active:   z.boolean().optional(),
      storage:     z.enum(['ambient', 'chilled', 'frozen']).optional(),
    }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      if (b.category_id !== undefined) await checkCategory(tx, req.tenantId, b.category_id)
      const fields = Object.fromEntries(Object.entries({ category_id: b.category_id, is_active: b.is_active, storage: b.storage })
        .filter(([, v]) => v !== undefined))
      if (!Object.keys(fields).length) return { updated: 0 }
      const rows = await tx`
        UPDATE inv_items SET ${tx(fields)}, updated_at = now()
         WHERE id = ANY(${b.ids}::uuid[]) AND tenant_id = ${req.tenantId} RETURNING id
      `
      return { updated: rows.length }
    })
  })

  // ── Quotes ──
  app.post('/items/:id/quotes', { preHandler: canManage }, async req => {
    const b = QuoteBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const item = await ownItem(tx, req.tenantId, req.params.id)
      await checkSupplier(tx, req.tenantId, b.supplier_id)
      const v = quoteValues(b, item.base_unit)
      const [q] = await tx`
        INSERT INTO inv_quotes ${tx({ ...v, tenant_id: req.tenantId, item_id: item.id, supplier_id: b.supplier_id })}
        RETURNING id
      `
      await recordPrice(tx, req.tenantId, q.id, null, v.price, req.user?.email ?? null)
      return (await loadItems(tx, req.tenantId, [item.id]))[0]
    })
  })

  app.patch('/quotes/:id', { preHandler: canManage }, async req => {
    const b = QuoteBody.partial().parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const q = await ownQuote(tx, req.tenantId, req.params.id)
      if (b.supplier_id) await checkSupplier(tx, req.tenantId, b.supplier_id)
      const merged = {
        supplier_code: q.supplier_code, product_name: q.product_name, pack_name: q.pack_name, pack_count: Number(q.pack_count),
        pack_qty: Number(q.pack_qty), pack_unit: q.pack_unit, price: q.price, vat_rate: Number(q.vat_rate),
        min_qty: q.min_qty == null ? null : Number(q.min_qty),
        order_multiple: q.order_multiple == null ? null : Number(q.order_multiple),
        is_active: q.is_active, notes: q.notes,
        ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)),
      }
      const v = quoteValues(merged, q.base_unit)
      await tx`
        UPDATE inv_quotes SET ${tx({ ...v, ...(b.supplier_id ? { supplier_id: b.supplier_id } : {}) })}, updated_at = now()
         WHERE id = ${q.id} AND tenant_id = ${req.tenantId}
      `
      if (Math.abs(v.price - q.price) > 1e-9) await recordPrice(tx, req.tenantId, q.id, null, v.price, req.user?.email ?? null)
      return (await loadItems(tx, req.tenantId, [q.item_id]))[0]
    })
  })

  app.delete('/quotes/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const q = await ownQuote(tx, req.tenantId, req.params.id)
    await tx`DELETE FROM inv_quotes WHERE id = ${q.id} AND tenant_id = ${req.tenantId}`
    return (await loadItems(tx, req.tenantId, [q.item_id]))[0]
  }))

  // Each listed venue's own price for the quote; null removes it (the venue
  // then pays the company price).
  app.put('/quotes/:id/venue-prices', { preHandler: canManage }, async req => {
    const { prices } = VenuePricesBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const q = await ownQuote(tx, req.tenantId, req.params.id)
      await checkVenues(tx, req.tenantId, prices.map(p => p.venue_id))
      const current = await tx`
        SELECT venue_id, price::float8 AS price FROM inv_quote_venue_prices WHERE quote_id = ${q.id} AND tenant_id = ${req.tenantId}
      `
      const was = new Map(current.map(r => [r.venue_id, r.price]))
      const by = req.user?.email ?? null
      for (const p of prices) {
        const before = was.get(p.venue_id)
        if (p.price == null) {
          if (before == null) continue
          await tx`DELETE FROM inv_quote_venue_prices WHERE quote_id = ${q.id} AND venue_id = ${p.venue_id} AND tenant_id = ${req.tenantId}`
          await recordPrice(tx, req.tenantId, q.id, p.venue_id, null, by)
        } else if (before == null || Math.abs(before - p.price) > 1e-9) {
          await tx`
            INSERT INTO inv_quote_venue_prices (quote_id, venue_id, tenant_id, price)
            VALUES (${q.id}, ${p.venue_id}, ${req.tenantId}, ${p.price})
            ON CONFLICT (quote_id, venue_id) DO UPDATE SET price = EXCLUDED.price
          `
          await recordPrice(tx, req.tenantId, q.id, p.venue_id, p.price, by)
        }
      }
      return (await loadItems(tx, req.tenantId, [q.item_id]))[0]
    })
  })

  app.get('/quotes/:id/history', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const q = await ownQuote(tx, req.tenantId, req.params.id)
    return tx`
      SELECT h.id, h.venue_id, v.name AS venue_name, h.price::float8 AS price, h.changed_at, h.changed_by, h.source
        FROM inv_price_history h
        LEFT JOIN venues v ON v.id = h.venue_id AND v.tenant_id = ${req.tenantId}
       WHERE h.quote_id = ${q.id} AND h.tenant_id = ${req.tenantId}
       ORDER BY h.changed_at DESC
       LIMIT 200
    `
  }))

  // Which quote an item is ordered on: venue_id null = company default.
  // quote_id null clears the choice (back to the default, then cheapest).
  app.put('/items/:id/preferred', { preHandler: canManage }, async req => {
    const b = PreferredBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const item = await ownItem(tx, req.tenantId, req.params.id)
      if (b.venue_id) await checkVenues(tx, req.tenantId, [b.venue_id])
      if (b.quote_id) {
        const [q] = await tx`SELECT id FROM inv_quotes WHERE id = ${b.quote_id} AND item_id = ${item.id} AND tenant_id = ${req.tenantId}`
        if (!q) throw httpError(404, 'Quote not found for this item')
      }
      await tx`
        DELETE FROM inv_preferred
         WHERE item_id = ${item.id} AND tenant_id = ${req.tenantId}
           AND venue_id IS NOT DISTINCT FROM ${b.venue_id}
      `
      if (b.quote_id) {
        await tx`
          INSERT INTO inv_preferred (tenant_id, item_id, venue_id, quote_id)
          VALUES (${req.tenantId}, ${item.id}, ${b.venue_id}, ${b.quote_id})
        `
      }
      return (await loadItems(tx, req.tenantId, [item.id]))[0]
    })
  })

  // ── Import ──
  app.get('/import-template', { preHandler: canView }, async (req, reply) => {
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', 'attachment; filename="inventory-import.csv"')
    return IMPORT_TEMPLATE + '\n'
  })

  // A CSV or Excel file (base64). dry_run reports what would change and
  // rolls everything back.
  app.post('/import', { preHandler: canManage, bodyLimit: 6 * 1024 * 1024 }, async req => {
    const b = ImportBody.parse(req.body || {})
    const rows = parseSheet(b.file)
    if (rows.length > 5000) throw httpError(422, 'Import up to 5000 rows at a time')
    let result
    try {
      await withTenant(req.tenantId, async tx => {
        result = await runImport(tx, req.tenantId, rows, req.user?.email ?? null)
        if (b.dry_run) throw new DryRun()
      })
    } catch (err) {
      if (!(err instanceof DryRun)) throw err
    }
    return { ...result, dry_run: !!b.dry_run }
  })
}
