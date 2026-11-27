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
// venue's run), the Usage tab and Menu margins' Sold tab read.
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
  const { V, step, post, get } = ctx
  // Usage from sales (phase 5): the venue's last days worked out now from what the fixtures sold, then read.
  const u = await step('stock usage', () => get(`/api/stock/venues/${V}/usage`))
  if (!u) return
  const from = new Date(Date.parse(u.today) - 6 * 86400000).toISOString().slice(0, 10)
  await step('stock usage recompute', () => post(`/api/stock/venues/${V}/usage/recompute`, { from, to: u.today }))
  await step('stock usage read', () => get(`/api/stock/venues/${V}/usage?from=${from}&to=${u.today}`))
  await step('menu margins sold', () => get(`/api/menu-margins/sold?venue_id=${V}&from=${from}&to=${u.today}`))
}
