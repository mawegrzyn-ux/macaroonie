// Purchasing: suppliers and their prices, the inventory, order lists,
// restaurant orders (approval and splitting), purchase orders, receiving.
export const order = 80

export const kinds = { itemId: ['inv_items'] }

export async function fill(ctx) {
  const { V, mark, slug, step, post, put, get } = ctx
  const supplier = await step('supplier', () => post('/api/suppliers', { name: mark + ' Fresh Co', email: 'orders@' + slug + '.test', send_method: 'email' }))
  const item = await step('inventory item', () => post('/api/inventory/items', { name: mark + ' Rice', base_unit: 'g', storage: 'ambient' }))
  const withQuote = item && supplier ? await step('quote', () => post(`/api/inventory/items/${item.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Bag', pack_qty: 10, pack_unit: 'kg', price: 12 })) : null
  const quote = withQuote?.quotes?.[0]
  if (quote) {
    await step('venue price', () => put(`/api/inventory/quotes/${quote.id}/venue-prices`, { prices: [{ venue_id: V, price: 11 }] }))
    await step('preferred quote', () => put(`/api/inventory/items/${item.id}/preferred`, { venue_id: V, quote_id: quote.id }))
  }
  // Catalogue tidying (1 Nov 2026): a price update by code and switching
  // items, both dry runs, so the sweep sends them again as the other group.
  if (supplier) await step('price update by code', () => post('/api/inventory/price-update', { supplier_id: supplier.id, rows: [{ code: mark + '-NONE', price: 1 }], dry_run: true }))
  if (item) await step('switch items (dry run)', () => post('/api/inventory/items/bulk', { ids: [item.id], is_active: false, dry_run: true }))
  // The venue's delivery details (migration 233): lead days as the
  // supplier's own (1), so no delivery day moves.
  if (supplier) await step('supplier venue', () => put(`/api/suppliers/${supplier.id}/venues`, { venues: [{
    venue_id: V, account_ref: mark + '-123', lead_days: 1, delivery_phone: '07700 900' + slug.length,
    driver_instructions: mark + ' back door', slot_from: '07:00', slot_to: '11:00',
  }] }))
  // A second product from the supplier, added to a purchase order below.
  const oil = supplier ? await step('second inventory item', () => post('/api/inventory/items', { name: mark + ' Oil', base_unit: 'ml', storage: 'ambient' })) : null
  const oilQuote = oil ? (await step('second quote', () => post(`/api/inventory/items/${oil.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Tin', pack_qty: 5, pack_unit: 'l', price: 9 })))?.quotes?.[0] : null
  // Out of stock until a month from now (migration 234), so the sweep sends it again as the other group.
  if (oilQuote) {
    const back = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    await step('out of stock', () => put(`/api/purchasing/quotes/${oilQuote.id}/stock`, { until: back, note: mark + ' depot short' }))
  }
  const list = await step('order list', () => post('/api/purchasing/lists', { name: mark + ' Dry goods', venue_ids: [V], item_ids: item ? [item.id] : [] }))
  if (list && item) await step('list pars', () => put(`/api/purchasing/lists/${list.id}/pars`, { pars: [{ item_id: item.id, venue_id: V, par_base: 5000 }] }))
  if (list) {
    const order = await step('restaurant order', () => post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
    if (order && item) {
      await step('order lines', () => put(`/api/purchasing/orders/${order.id}/lines`, { lines: [{ item_id: item.id, qty: 2 }] }))
      await step('order submit', () => post(`/api/purchasing/orders/${order.id}/submit`, {}))
      // Approval and splitting (migration 180): a request split into a
      // second one for another day, that one sent back; the purchase order
      // split too. Days far enough out not to be anyone's next delivery.
      const later = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
      const asked = await step('order for approval', () => post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
      if (asked && supplier) {
        await step('approval lines', () => put(`/api/purchasing/orders/${asked.id}/lines`, { lines: [{ item_id: item.id, qty: 3 }] }))
        await step('order request', () => post(`/api/purchasing/orders/${asked.id}/request`, { suppliers: { [supplier.id]: { delivery_date: later(20) } }, note: mark + ' please' }))
        const split = await step('order request split', () => post(`/api/purchasing/orders/${asked.id}/split`, { lines: [{ item_id: item.id, qty: 1 }], suppliers: { [supplier.id]: { delivery_date: later(22) } } }))
        if (split) await step('order request return', () => post(`/api/purchasing/orders/${split.new_order_id}/return`, { note: mark + ' not yet' }))
      }
      const pos = await step('purchase orders', () => get(`/api/purchasing/pos?venue_id=${V}`))
      const po = pos?.[0]
      if (po) {
        const d = await step('purchase order', () => get(`/api/purchasing/pos/${po.id}`))
        const split = d?.lines?.[0] ? await step('purchase order split', () => post(`/api/purchasing/pos/${po.id}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: later(21) })) : null
        // The split-off order hasn't been sent: another of the supplier's products goes on it.
        if (split?.new_po && oilQuote) {
          await step('purchase order add item', () => put(`/api/purchasing/pos/${split.new_po.id}/lines`, { add: [{ quote_id: oilQuote.id, qty: 2 }] }))
        }
        // Booked in with a line that wasn't ordered (migration 197), whose
        // invoice price then goes into the price list as a new supplier price.
        const got = d && await step('purchase order receive', () => post(`/api/purchasing/pos/${po.id}/receive`, {
          lines: [], add: [{ item_id: item.id, pack: { name: 'Bag', qty: 5, unit: 'kg' }, received_qty: 1, invoice_price: 6.5, note: mark + ' extra' }],
          check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
        }))
        const extra = got?.lines?.find(l => l.added_on_receipt)
        if (extra) await step('price list from invoice', () => post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: extra.id, action: 'add', product_name: mark + ' Rice 5kg' }] }))
      }
      // A delivery booked in without an order (migration 238), once the
      // setting allows it.
      await step('purchasing settings', () => put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
      if (oilQuote) {
        await step('delivery without an order', () => post(`/api/purchasing/venues/${V}/deliveries`, {
          supplier_id: supplier.id, supplier_ref: mark + '-DN1', notes: mark + ' no order',
          lines: [{ item_id: oil.id, quote_id: oilQuote.id, received_qty: 1 }],
          check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
        }))
      }
    }
  }
}
