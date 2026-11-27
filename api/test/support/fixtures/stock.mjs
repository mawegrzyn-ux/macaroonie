// Stock (migration 287; inventory phase 4a, migrations 305 to 307): an item
// with a unit of its own and a supplier pack, two storage areas (renamed,
// ordered, with their items), a key-item list, the stock settings and the
// venue's count day; a full count drafted, counted in two units in an
// area, the area done, submitted with zeros confirmed and approved; a quick
// count (Pepper's count_stock) and a key-item count from the list
// (cancelled); an adjustment and its reversal; the reads (on hand, an
// item's ledger, Today's tasks). Phase 4b (migrations 308 and 309): a waste
// reason (added, renamed, ordered) and an entry of the item, its preview,
// the day's list and the summary, a second entry undone; a transfer from the
// first venue to the second, received with a difference, and another sent
// and cancelled; the transfers lists. Phase 5 (migration 311), late, after the
// till's, kiosk's and online orders' sales: the venue's day of usage worked out
// by Recompute (stock_usage_days, dish_cost_days, the day's mark and the
// venue's run), the Usage tab and Menu margins' Sold tab read. Phase 6a
// (migration 312), late too: the variance band saved, a second full count
// approved (the period since the first: stock_periods), its variance, an
// item's evidence, key items and by venue read, the period closed, an item
// reviewed (stock_variance_reviews), reopened with a note and closed again;
// then a late sale on its last day (stock_usage_late and its items: written
// here, only the usage job makes them when a sale reaches a closed day late,
// as api/test/stock-variance.test.mjs does) read back through the current
// period's variance and the item's ledger. Phase 6b (migration 313), late:
// the week's food cost line, margin by menu, the newest period's variance,
// the dishes over target, Home's set-up gaps, the Overview tile, a stock widget, and the cost
// targets sweep with the targets low for a moment (cost_target_states).
import { sql, getApp } from '../app.mjs'

export const order = 87
// Phase 5: usage from sales is worked out after the till's and online orders' sales (fillLate).
export const lateOrder = 175

// The tenant sweep's id kinds for this area's named id parameters.
export const kinds = {
  areaId: ['stock_areas'],
  reasonId: ['waste_reasons'],
  wasteId: ['stock_waste'],
  transferId: ['stock_transfers'],
}

export async function fill(ctx) {
  const { V, mark, ids, step, post, put, patch, get } = ctx
  const item = await step('stock item', () => post('/api/inventory/items', { name: mark + ' Chicken thighs', base_unit: 'g', storage: 'chilled' }))
  if (!item) return
  await step('stock item unit', () => post(`/api/inventory/items/${item.id}/units`, { name: 'tray', base_qty: 2500 }))
  const supplier = await step('stock supplier', () => post('/api/suppliers', { name: mark + ' Poultry Co', send_method: 'print' }))
  if (supplier) await step('stock item price', () => post(`/api/inventory/items/${item.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', price: 38 }))

  // Storage areas, ordered, with their items (an item may be in two).
  const walkIn = await step('stock area', () => post(`/api/stock/venues/${V}/areas`, { name: mark + ' Walk-in' }))
  const dry = await step('stock second area', () => post(`/api/stock/venues/${V}/areas`, { name: mark + ' Dry store' }))
  if (!walkIn || !dry) return
  ids.stockArea = walkIn.id
  await step('stock area rename', () => patch('/api/stock/areas/' + walkIn.id, { name: mark + ' Walk-in fridge' }))
  await step('stock areas order', () => put(`/api/stock/venues/${V}/areas/order`, { ids: [dry.id, walkIn.id] }))
  await step('stock area items', () => put(`/api/stock/areas/${walkIn.id}/items`, { item_ids: [item.id] }))
  await step('stock second area items', () => put(`/api/stock/areas/${dry.id}/items`, { item_ids: [item.id] }))

  // A key-item list, the settings, the venue's count day.
  const list = await step('stock key list', () => post('/api/stock/key-lists', { name: mark + ' Proteins', item_ids: [item.id] }))
  if (list) {
    ids.stockKeyList = list.id
    await step('stock key list save', () => put('/api/stock/key-lists/' + list.id, { name: mark + ' Proteins', item_ids: [item.id] }))
  }
  await step('stock settings', () => put('/api/stock/settings', { second_person_approves: false, blind_count: false, refunds_return_stock: false }))
  await step('stock venue settings', () => put(`/api/stock/venues/${V}/settings`, { count_weekday: 1, count_kind: list ? 'key' : 'full', key_list_id: list?.id ?? null, par_mode: null }))

  // A full count: drafted, a line in two units in an area, the area done, submitted (zeros confirmed), approved.
  const count = await step('stock count start', () => post(`/api/stock/venues/${V}/counts`, { kind: 'full', note: mark + ' Monday count' }))
  if (count) {
    ids.stockCount = count.id
    await step('stock count note', () => patch('/api/stock/counts/' + count.id, { note: mark + ' Monday close' }))
    const line = await step('stock count line', () => put(`/api/stock/counts/${count.id}/lines`, {
      item_id: item.id, area_id: walkIn.id, entries: [{ qty: 2, unit: 'tray' }, { qty: 400, unit: 'g' }],
    }))
    if (line?.line) ids.stockCountLine = line.line.id
    await step('stock count area done', () => post(`/api/stock/counts/${count.id}/areas/${walkIn.id}`, { done: true }))
    await step('stock count read', () => get('/api/stock/counts/' + count.id))
    await step('stock count submit', () => post(`/api/stock/counts/${count.id}/submit`, { all_zero: true }))
    await step('stock count approve', () => post(`/api/stock/counts/${count.id}/approve`, {}))
  }
  // A quick count of one item (Pepper's count_stock, the old count sheet), approved at once by the owner.
  await step('stock quick count', () => post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: item.id, qty: 5.5, unit: 'kg' }], note: mark + ' spot check' }))
  // A key-item count from the list (the plain form's save), then cancelled.
  if (list) {
    const key = await step('stock key count', () => post(`/api/stock/venues/${V}/key-counts`, { key_list_id: list.id, note: mark + ' proteins' }))
    if (key) await step('stock key count cancel', () => post(`/api/stock/counts/${key.id}/cancel`, {}))
  }
  // An adjustment and its reversal.
  const adj = await step('stock adjustment', () => post(`/api/stock/venues/${V}/adjustments`, { item_id: item.id, qty: -500, unit: 'g', reason: mark + ' dropped tray', note: null }))
  if (adj) {
    ids.stockAdjustment = adj.id
    await step('stock adjustment reverse', () => post(`/api/stock/adjustments/${adj.id}/reverse`, {}))
  }
  // Waste (phase 4b): a reason of the group's, an entry of the item and its preview, one undone.
  const reason = await step('waste reason', () => post('/api/stock/waste-reasons', { name: mark + ' Fridge failed', kind: 'spoilage' }))
  if (reason) {
    ids.wasteReason = reason.id
    await step('waste reason save', () => put('/api/stock/waste-reasons/' + reason.id, { name: mark + ' Fridge failed', kind: 'spoilage', is_active: true }))
    const all = await step('waste reasons', () => get('/api/stock/waste-reasons'))
    if (all) await step('waste reasons order', () => put('/api/stock/waste-reasons/order', { ids: all.map(r => r.id).reverse() }))
    const body = { what: 'item', item_id: item.id, qty: 1, unit: 'tray', reason_id: reason.id, note: mark + ' fridge at 9C' }
    await step('waste preview', () => post(`/api/stock/venues/${V}/waste/preview`, body))
    const w = await step('waste entry', () => post(`/api/stock/venues/${V}/waste`, body))
    if (w) {
      ids.stockWaste = w.id
      ids.stockWasteItem = w.items?.[0]?.item_id
    }
    const undone = await step('waste entry to undo', () => post(`/api/stock/venues/${V}/waste`, { ...body, qty: 200, unit: 'g' }))
    if (undone) await step('waste undo', () => post(`/api/stock/waste/${undone.id}/undo`, {}))
  }
  await step('waste pickers', () => get(`/api/stock/venues/${V}/waste/pickers`))
  await step('waste day', () => get(`/api/stock/venues/${V}/waste`))
  await step('waste summary', () => get(`/api/stock/venues/${V}/waste/summary?by=item`))

  // Transfers (phase 4b): to the second venue, received a little short; another sent and cancelled.
  if (ids.venue2) {
    const t = await step('stock transfer', () => post(`/api/stock/venues/${V}/transfers`, { to_venue_id: ids.venue2, lines: [{ item_id: item.id, qty: 2, unit: 'tray' }], note: mark + ' for the weekend' }))
    if (t) {
      ids.stockTransfer = t.id
      await step('stock transfer read', () => get('/api/stock/transfers/' + t.id))
      await step('stock transfer receive', () => post(`/api/stock/transfers/${t.id}/receive`, { lines: [{ line_id: t.lines[0].id, qty: 4.5, unit: 'kg' }], note: mark + ' half a kilo short' }))
    }
    const c = await step('stock transfer to cancel', () => post(`/api/stock/venues/${V}/transfers`, { to_venue_id: ids.venue2, item_id: item.id, qty: 1, unit: 'kg' }))
    if (c) await step('stock transfer cancel', () => post(`/api/stock/transfers/${c.id}/cancel`, {}))
    await step('stock transfers', () => get(`/api/stock/venues/${V}/transfers`))
  }

  // The reads: on hand, the item's ledger, Today's tasks, the counts.
  await step('stock on hand', () => get('/api/stock/venues/' + V))
  await step('stock ledger', () => get(`/api/stock/venues/${V}/items/${item.id}/moves`))
  await step('stock today', () => get(`/api/stock/venues/${V}/today?date=2026-10-19`))
  await step('stock counts', () => get(`/api/stock/venues/${V}/counts`))
}

export async function fillLate(ctx) {
  await fillUsageAndVariance(ctx)
  await fillFoodCost(ctx)
}

async function fillUsageAndVariance(ctx) {
  const { V, step, post, get } = ctx
  // Usage from sales (phase 5): the venue's last days worked out now from what the fixtures sold, then read.
  const u = await step('stock usage', () => get(`/api/stock/venues/${V}/usage`))
  if (!u) return
  const from = new Date(Date.parse(u.today) - 6 * 86400000).toISOString().slice(0, 10)
  await step('stock usage recompute', () => post(`/api/stock/venues/${V}/usage/recompute`, { from, to: u.today }))
  await step('stock usage read', () => get(`/api/stock/venues/${V}/usage?from=${from}&to=${u.today}`))
  await step('menu margins sold', () => get(`/api/menu-margins/sold?venue_id=${V}&from=${from}&to=${u.today}`))

  // Variance (phase 6a, migration 312): a second full count approved makes the period since the first;
  // its variance, an item's evidence, key items, by venue; the band; closed, reviewed, reopened with a
  // note and closed again (so its figures are frozen for the reports).
  await step('stock variance band', () => ctx.put('/api/stock/variance-settings', { band_pct: 1, item_pct: 3, item_pounds: 50 }))
  const count = await step('stock closing count', () => post(`/api/stock/venues/${V}/counts`, { kind: 'full', note: ctx.mark + ' month end' }))
  if (!count) return
  const sheet = await step('stock closing count read', () => get('/api/stock/counts/' + count.id))
  const itemId = sheet && Object.keys(sheet.items || {})[0]
  if (itemId) await step('stock closing count line', () => ctx.put(`/api/stock/counts/${count.id}/lines`, { item_id: itemId, area_id: null, entries: [{ qty: 4, unit: 'kg' }] }))
  await step('stock closing count submit', () => post(`/api/stock/counts/${count.id}/submit`, { all_zero: true }))
  const approved = await step('stock closing count approve', () => post(`/api/stock/counts/${count.id}/approve`, {}))
  const periodId = approved?.periods_made?.[0]
  await step('stock periods', () => get(`/api/stock/venues/${V}/periods`))
  await step('stock variance current', () => get(`/api/stock/venues/${V}/variance?period=current`))
  await step('stock variance key', () => get(`/api/stock/venues/${V}/variance/key`))
  if (!periodId) return
  ctx.ids.stockPeriod = periodId
  await step('stock variance', () => get(`/api/stock/venues/${V}/variance?period=${periodId}`))
  if (itemId) {
    await step('stock variance item', () => get(`/api/stock/venues/${V}/variance/items/${itemId}?period=${periodId}`))
    await step('stock variance by venue', () => get(`/api/stock/variance/by-venue?item=${itemId}`))
  }
  await step('stock period close', () => post(`/api/stock/periods/${periodId}/close`, {}))
  if (itemId) await step('stock variance review', () => post(`/api/stock/periods/${periodId}/items/${itemId}/review`, { reviewed: true, note: ctx.mark + ' checked the shelf' }))
  await step('stock period reopen', () => post(`/api/stock/periods/${periodId}/reopen`, { note: ctx.mark + ' a delivery was booked in late' }))
  await step('stock period close again', () => post(`/api/stock/periods/${periodId}/close`, {}))
  // A late sale on the closed period's last day, landing in the period running since the latest full count.
  if (itemId) {
    const late = await step('stock late sale', async () => {
      const [p] = await sql`SELECT COALESCE(days_to, to_at::date)::text AS day, to_at FROM stock_periods WHERE id = ${periodId} AND tenant_id = ${ctx.tenantId}`
      const [l] = await sql`
        INSERT INTO stock_usage_late (tenant_id, venue_id, day, closed_period_id, period_id, at, lines, net_pence, net_food_pence, cost)
        VALUES (${ctx.tenantId}, ${V}, ${p.day}::date, ${periodId}, NULL, ${p.to_at}, 1, 900, 900, 1.2)
        RETURNING id`
      await sql`
        INSERT INTO stock_usage_late_items (tenant_id, late_id, item_id, qty_base, cost_per_base)
        VALUES (${ctx.tenantId}, ${l.id}, ${itemId}, 200, 0.006)`
      return l
    })
    if (late) {
      ctx.ids.stockUsageLate = late.id
      await step('stock variance late sales', () => get(`/api/stock/venues/${V}/variance?period=current`))
      await step('stock ledger late sales', () => get(`/api/stock/venues/${V}/items/${itemId}/moves`))
    }
  }
}

// Food cost beyond the period (phase 6b, migration 313): Cash Recon's week line, the widgets' reads
// (margin by menu, the newest period's variance), Today's dishes over target, the Overview tile, a
// stock widget on a dashboard; the cost targets sweep run with the targets set low for a moment, so
// cost_target_states has a row (only the sweep writes it), then the targets put back as they were.
async function fillFoodCost(ctx) {
  const { V, step, get, post, put } = ctx
  await step('stock food cost week', () => get(`/api/stock/venues/${V}/food-cost/week`))
  await step('stock margins by menu', () => get(`/api/stock/venues/${V}/margins-by-menu`))
  await step('stock variance latest', () => get(`/api/stock/venues/${V}/variance?period=latest`))
  await step('stock cost targets', () => get(`/api/stock/venues/${V}/cost-targets`))
  await step('stock setup gaps', () => get(`/api/stock/venues/${V}/setup-gaps`))
  await step('stock overview', () => get('/api/stock/overview'))
  const dash = await step('stock widget dashboard', () => post('/api/custom-dashboards/dashboards', { venue_id: V, name: ctx.mark + ' Food cost' }))
  if (dash) await step('stock widget', () => post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: 'stock_food_cost' }))
  const was = await step('costing targets read', () => get('/api/menu-margins/settings'))
  if (!was) return
  await step('costing targets low', () => put('/api/menu-margins/settings', { target_pct: 1, limit_pct: 2, sections: [] }))
  await step('stock cost targets sweep', async () => {
    const { sweepCostTargets } = await import('../../../src/services/stockFoodCostSvc.js')
    return sweepCostTargets(await getApp(), null, { tenantIds: [ctx.tenantId] })
  })
  await step('costing targets back', () => put('/api/menu-margins/settings', {
    target_pct: was.target_pct, limit_pct: was.limit_pct,
    sections: (was.sections || []).map(x => ({ section_id: x.section_id, target_pct: x.target_pct, limit_pct: x.limit_pct })),
  }))
}
