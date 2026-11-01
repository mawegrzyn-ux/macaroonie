// A tenant's data in every area, made through the API as its owner (so the
// rows are what the pages would make). The cross-tenant sweep calls every
// route with these ids as another tenant. Each step that fails is listed in
// the result instead of stopping the rest; the sweep reports them.
import { randomUUID } from 'node:crypto'
import { as, ok, sql } from './app.mjs'
import { menuSaveBody } from '../../src/routes/menus.js'

export const MARK = 'Zqx'   // in names and notes, so a leak is easy to spot

const MONDAY = '2026-10-19'

// A hold must be for a time still ahead (the booking cutoff refuses one in
// the past): 19:00 UTC three days from now, past the days the schedule
// below closes.
function holdTime() {
  const d = new Date(Date.now() + 3 * 86400000)
  while (['12-25', '12-26', '01-02'].includes(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10) + 'T19:00:00.000Z'
}

export async function fillTenant(sub, tenantId, { mark = MARK, slug = 'zqx', loyalty: withLoyalty = true } = {}) {
  const c = as(sub, tenantId)
  const failed = []
  const ids = {}
  // Every write that worked, so the sweep can try each one again as
  // another tenant (valid bodies, pointing at this tenant's ids).
  const writes = []
  const write = (method, url, body, what) => ok(c[method.toLowerCase()](url, body), what || method + ' ' + url)
    .then(res => { writes.push({ method, url, body }); return res })
  const step = async (name, fn) => {
    try { return await fn() } catch (err) { failed.push(name + ': ' + err.message); return null }
  }
  const post = (url, body, what) => write('POST', url, body, what)
  const put = (url, body, what) => write('PUT', url, body, what)
  const patch = (url, body, what) => write('PATCH', url, body, what)
  const get = (url, what) => ok(c.get(url), what || 'GET ' + url)

  // ── Venues, tables, schedule, rules ──
  const venue = await step('venue', () => post('/api/venues', { name: mark + ' Ware', slug: slug + '-ware', timezone: 'Europe/London' }))
  const venue2 = await step('venue 2', () => post('/api/venues', { name: mark + ' Hertford', slug: slug + '-hertford', timezone: 'Europe/London' }))
  const V = ids.venue = venue?.id
  ids.venue2 = venue2?.id
  if (!V) return { ids, failed, writes }
  const sec = await step('section', () => post(`/api/venues/${V}/sections`, { name: mark + ' Main room' }))
  const t1 = await step('table 1', () => post(`/api/venues/${V}/tables`, { label: 'T1', min_covers: 1, max_covers: 2, section_id: sec?.id }))
  const t2 = await step('table 2', () => post(`/api/venues/${V}/tables`, { label: 'T2', min_covers: 2, max_covers: 4, section_id: sec?.id }))
  const t3 = await step('table 3', () => post(`/api/venues/${V}/tables`, { label: 'T3', min_covers: 2, max_covers: 4, section_id: sec?.id }))
  await step('combination', () => post(`/api/venues/${V}/combinations`, { name: 'T1+T2', table_ids: [t1.id, t2.id], min_covers: 3, max_covers: 6 }))
  await step('disallowed pair', () => post(`/api/venues/${V}/disallowed-pairs`, { table_id_a: t2.id, table_id_b: t3.id }))
  const S = `/api/venues/${V}/schedule`
  const sitting = { opens_at: '12:00', closes_at: '21:30', name: 'All day', default_max_covers: 40 }
  const caps = [{ slot_time: '12:00', max_covers: 10 }, { slot_time: '12:15', max_covers: 0 }]
  for (let dow = 0; dow < 7; dow++) {
    await step('template ' + dow, () => put(`${S}/template/${dow}`, { is_open: true, slot_interval_mins: 15 }))
    const st = await step('sitting ' + dow, () => post(`${S}/template/${dow}/sittings`, sitting))
    if (dow === 1 && st) await step('slot caps', () => put(`${S}/sittings/${st.id}/caps`, caps))
  }
  const ov = await step('override', () => post(`${S}/overrides`, { override_date: '2026-12-24', is_open: true, slot_interval_mins: 15 }))
  if (ov) {
    const os = await step('override sitting', () => post(`${S}/overrides/${ov.id}/sittings`, sitting))
    if (os) await step('override caps', () => put(`${S}/overrides/sittings/${os.id}/caps`, caps))
  }
  await step('exception', () => post(`${S}/exceptions`, { name: mark + ' Christmas', date_from: '2026-12-25', date_to: '2026-12-26', is_closed: true }))
  const ex = await step('open exception', () => post(`${S}/exceptions`, { name: mark + ' New year', date_from: '2027-01-01', date_to: '2027-01-02', is_closed: false }))
  if (ex) {
    await step('exception day', () => put(`${S}/exceptions/${ex.id}/template/5`, { is_open: true, slot_interval_mins: 15 }))
    const es = await step('exception sitting', () => post(`${S}/exceptions/${ex.id}/template/5/sittings`, sitting))
    if (es) await step('exception caps', () => put(`${S}/exceptions/${ex.id}/sittings/${es.id}/caps`, caps))
  }
  await step('deposit rules', () => post(`/api/venues/${V}/deposit-rules`, { requires_deposit: false, currency: 'GBP' }))
  await step('rules', async () => {
    const r = await c.patch(`/api/venues/${V}/rules`, { hold_ttl_secs: 300 })
    if (r.status === 404) {
      return post(`/api/venues/${V}/rules`, {
        slot_duration_mins: 90, buffer_after_mins: 0, min_covers: 1, max_covers: 8, book_from_days: 0, book_until_days: 60,
        cutoff_before_mins: 0, hold_ttl_secs: 300, allow_cross_section_combo: false, allow_non_adjacent_combo: false,
        allow_widget_bookings_after_doors_close: false, enable_unconfirmed_flow: false, enable_reconfirmed_status: false, enable_arrived_status: true,
      })
    }
    if (r.status >= 400) throw new Error('rules ' + r.status + ' ' + r.json?.error)
  })

  // ── Bookings and customers ──
  await step('customer', () => post('/api/customers', { name: mark + ' Alice', email: 'alice@' + slug + '.test', phone: '07700900111', notes: mark + ' likes the window' }))
  await step('booking', () => post('/api/bookings/admin-override', { venue_id: V, starts_at: MONDAY + 'T19:00:00', covers: 2, table_ids: [t1.id], guest_name: mark + ' Bob', guest_email: 'bob@' + slug + '.test', guest_phone: '07700900222', guest_notes: mark + ' nut allergy' }))
  await step('test bookings', () => post(`/api/venues/${V}/test-data/seed`, { date_from: MONDAY, date_to: '2026-10-21', occupancy_pct: 30 }))
  await step('hold', () => post('/api/bookings/holds', { venue_id: V, table_id: t3.id, starts_at: holdTime(), covers: 2, guest_name: mark + ' Dee', guest_email: 'dee@' + slug + '.test' }))

  // ── Menus ──
  const menu = await step('menu', () => post('/api/menus', { name: mark + ' Lunch', slug: slug + '-lunch' }))
  ids.menu = menu?.id
  await step('dietary tag', () => post('/api/menus/dietary', { label: mark + ' Spicy', code: slug, glyph: 'S', kind: 'dietary' }))
  // With its own kiosk look and a variation type (migration 206).
  const vg = await step('variant group', () => post('/api/menus/variant-groups', {
    name: mark + ' Size', kiosk_tiles: 'round', kiosk_entrance: 'slide', variation_type: 'side',
    options: [{ label: 'Small', price_pence: 0 }, { label: 'Large', price_pence: 200 }],
  }))
  const vgCopy = vg ? await step('variant group copy', () => post(`/api/menus/variant-groups/${vg.id}/copy`, {})) : null
  let dish = null
  let menuSection = null
  if (menu) {
    const full = await step('menu load', () => get(`/api/menus/${menu.id}`))
    const large = vg?.options?.find(o => o.label === 'Large')
    await step('menu tree', () => patch(`/api/menus/${menu.id}`, {
      ...full,
      callouts: [{ kind: 'custom', title: mark + ' Ask us', body: mark + ' about spice' }],
      sections: [{ title: mark + ' Noodles', items: [
        { name: mark + ' Pad Thai', price_pence: 1250, is_orderable: true, description: mark + ' dish', dietary: [slug, 'gluten'], allergen_levels: { gluten: 'may_contain' },
          variant_groups: vg ? [{ group_id: vg.id, overrides: large ? [{ option_id: large.id, price_pence: 250 }] : [] }] : [] },
        { name: mark + ' Green Curry', price_pence: 1350, is_orderable: true, variants: [{ label: mark + ' Chicken', price_pence: 1350 }] },
      ] }],
    }))
    // A meal deal that asks the Pad Thai's size as the copy of its group,
    // with the deal's own charge for one of its options (options in the
    // deal, shared/combos.js dealChoices()).
    const tree = vg && vgCopy ? await step('menu load for the deal', () => get(`/api/menus/${menu.id}`)) : null
    const pad = tree?.sections?.[0]?.items?.[0]
    if (pad) {
      const body = menuSaveBody(tree)
      body.sections.push({ title: mark + ' Deals', items: [{
        name: mark + ' Lunch deal', kind: 'combo', price_pence: 1500, is_orderable: true,
        combo: { mode: 'manual', steps: [{ id: randomUUID(), name: mark + ' Main', min: 1, max: 1, options: [
          { id: randomUUID(), type: 'item', item_id: pad.id, groups: { [vg.id]: { use: 'swap', group_id: vgCopy.id,
            ...(vgCopy.options?.[0] ? { prices: { [vgCopy.options[0].id]: 75 } } : {}) } } },
        ] }] },
      }] })
      await step('meal deal', () => patch(`/api/menus/${menu.id}`, body))
    }
    await step('menu publish', () => post(`/api/menus/${menu.id}/publish`, {}))
    await step('menu design', () => post(`/api/menus/${menu.id}/designs`, { name: mark + ' A4', layout: { pages: [{ id: 'p1', blocks: [] }] } }))
    await step('menu preview link', () => post(`/api/menus/${menu.id}/preview-link`, {}))
    const reloaded = await step('menu reload', () => get(`/api/menus/${menu.id}`))
    menuSection = reloaded?.sections?.[0] ?? null
    dish = menuSection?.items?.[0] ?? null
  }
  await step('allergen notice', () => put('/api/menus/allergen-notice', { title: mark + ' Allergies', body: mark + ' ask staff', removable_note: '* on request', ordering_text: mark + ' tell us', used_only: true }))
  if (dish) await step('translation', () => put('/api/menus/translations', { lang: 'es', texts: { ['item:' + dish.id + ':name']: mark + ' Pad Thai (es)' } }))

  // ── Staff, rota, tips ──
  await step('rota settings', () => patch('/api/rota/settings', { mode: 'day_parts' }))
  const shift = await step('shift', () => post('/api/rota/shifts', { name: mark + ' Lunch', start_time: '11:00', end_time: '15:00', points: 1 }))
  const role = await step('role', () => post('/api/rota/roles', { name: mark + ' Chef', points_multiplier: 1.5 }))
  const staff = await step('staff', () => post(`/api/rota/venues/${V}/staff`, { name: mark + ' Jo Bloggs', role_id: role?.id, pay_type: 'hourly', default_rate: 11.5 }))
  ids.staff = staff?.id
  if (staff && shift) {
    await step('rota entries', () => put(`/api/rota/venues/${V}/weeks/${MONDAY}/entries`, { entries: [{ staff_id: staff.id, work_date: MONDAY, shift_id: shift.id }] }))
    await step('pay adjustment', () => post(`/api/rota/venues/${V}/weeks/${MONDAY}/pay-adjustments`, { staff_id: staff.id, kind: 'extra', amount: 10, note: mark + ' bonus' }))
    await step('off period', () => post(`/api/rota/venues/${V}/staff/${staff.id}/off-periods`, { from_date: '2026-11-02', to_date: '2026-11-08', note: mark + ' holiday' }))
  }
  const staff2 = await step('staff 2', () => post(`/api/rota/venues/${V}/staff`, { name: mark + ' Sam Smith', pay_type: 'fixed', default_rate: 300 }))
  if (staff && shift) await step('shift rate', () => patch(`/api/rota/venues/${V}/staff/${staff.id}`, { shift_rates: [{ shift_id: shift.id, rate: 12 }] }))
  const W = `/api/rota/venues/${V}/weeks/${MONDAY}`
  const pot = await step('tip pot', () => post('/api/rota/pots', { name: mark + ' Floor tips', distribution: 'points' }))
  const line = pot ? await step('pot line', () => post(`/api/rota/pots/${pot.id}/lines`, { name: mark + ' Cash tips', kind: 'amount' })) : null
  if (line) await step('pot line amount', () => put(`${W}/pot-lines`, { amounts: [{ line_id: line.id, amount: 40 }] }))
  if (pot && staff) await step('pot payees', () => put(`${W}/pots/${pot.id}/payees`, { staff_ids: [staff.id] }))
  const manualPot = await step('manual pot', () => post('/api/rota/pots', { name: mark + ' Bar tips', distribution: 'manual' }))
  if (manualPot && staff) await step('manual pot amounts', () => put(`${W}/pots/${manualPot.id}/manual`, { amounts: [{ staff_id: staff.id, amount: 15 }] }))
  if (staff) {
    await step('tip added', () => post(`${W}/tip-moves`, { kind: 'money', action: 'add', lines: [{ to_staff_id: staff.id, amount: 5 }], note: mark + ' great shift' }))
    await step('points tap', () => post(`${W}/points-nudge`, { staff_id: staff.id, direction: 'minus' }))
  }
  ids.staff2 = staff2?.id

  // ── Cash recon ──
  const C = `/api/venues/${V}/cash-recon`
  const inc = await step('income source', () => post(C + '/config/income-sources', { name: mark + ' Till', type: 'pos', vat_rate: 20, vat_inclusive: true }))
  const chan = await step('payment channel', () => post(C + '/config/payment-channels', { name: mark + ' Cash', type: 'cash' }))
  const scs = await step('sc source', () => post(C + '/config/sc-sources', { name: mark + ' Card tips', type: 'tips', takings_effect: 'subtract' }))
  await step('expense category', () => post(C + '/config/expense-categories', { name: mark + ' Supplies' }))
  await step('cash settings', () => patch(C + '/settings', { allow_bulk_submit: true }))
  if (inc && chan && scs) {
    await step('cash day', () => put(`${C}/daily/${MONDAY}`, {
      notes: mark + ' busy lunch',
      income: [{ source_id: inc.id, gross_amount: 120, vat_amount: 20, net_amount: 100 }],
      takings: [{ channel_id: chan.id, amount: 115 }],
      sc: [{ source_id: scs.id, amount: 5 }],
    }))
  }
  await step('expense', () => post(C + '/expenses', { date: MONDAY, description: mark + ' Ice', amount: 4 }))
  if (staff) {
    await step('wages', () => put(`${C}/wages/${MONDAY}`, { entries: [{ staff_id: staff.id, name: mark + ' Jo', entry_type: 'fixed', total: 100, cash_amount: 0 }] }))
    await step('wage default', () => post(`${C}/wages/${MONDAY}/set-default`, { entries: [{ staff_id: staff.id, entry_type: 'fixed' }] }))
  }

  // ── Food safety, checklists, action log ──
  await step('equipment', () => post('/api/food-safety/equipment', { venue_id: V, name: mark + ' Walk-in', equipment_type: 'fridge', min_temp_c: 0, max_temp_c: 5 }))
  await step('capture time', () => post('/api/food-safety/capture-times', { venue_id: V, label: 'Morning', time_of_day: '09:00' }))
  await step('hold station', () => post('/api/food-safety/hold-stations', { venue_id: V, name: mark + ' Pass', hold_type: 'hot_hold' }))
  await step('hold time', () => post('/api/food-safety/hold-capture-times', { venue_id: V, label: 'Lunch', time_of_day: '12:30' }))
  await step('cooking session', () => post('/api/food-safety/cooking-sessions', { venue_id: V, label: 'Lunch', time_of_day: '12:00' }))
  await step('cooking item', () => post('/api/food-safety/cooking-items', { venue_id: V, name: mark + ' Chicken', category: 'Meat' }))
  await step('delivery', () => post('/api/food-safety/deliveries', { venue_id: V, delivery_date: MONDAY, vendor_name: mark + ' Fresh Co', items: [{ name: mark + ' veg' }], notes: mark + ' fine' }))
  const tpl = await step('checklist', () => post('/api/checklists/templates', { venue_id: V, name: mark + ' Opening', frequency: 'daily' }))
  if (tpl) await step('checklist item', () => post(`/api/checklists/templates/${tpl.id}/items`, { label: mark + ' Lights on' }))
  const cat = await step('action category', () => post('/api/hs-action-log/categories', { name: mark + ' Repairs' }))
  await step('action entry', () => post('/api/hs-action-log/entries', { venue_id: V, category_id: cat?.id, task: mark + ' Fix the door', priority: 'medium' }))
  await step('H&S test data', () => post(`/api/venues/${V}/test-data/hs/generate`, { date_from: '2026-10-12', date_to: '2026-10-14', kinds: ['temps', 'holds', 'cooking', 'orders', 'deliveries', 'checklists'] }))

  // ── Dashboards ──
  // A dashboard and a menu link hidden from the viewer role (migration 229),
  // so the sweep sends the other tenant this tenant's role ids.
  const roles = await step('roles', () => get('/api/access/roles'))
  const viewerRole = (roles || []).find(r => r.key === 'viewer')
  for (const kind of ['hs', 'cash', 'rota', 'custom']) {
    const d = await step('dashboard ' + kind, () => post(`/api/${kind}-dashboards/dashboards`, { venue_id: V, name: mark + ' ' + kind }))
    if (d) await step('widget ' + kind, () => post(`/api/${kind}-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'temp_checks' }))
    if (d && viewerRole && kind === 'hs') {
      await step('dashboard roles', () => patch(`/api/hs-dashboards/dashboards/${d.id}`, { hidden_role_ids: [viewerRole.id] }))
    }
  }

  // ── Purchasing ──
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
    }
  }

  // ── Website, reviews, promotions, support ──
  await step('tenant site', () => patch('/api/website/tenant-site', { subdomain_slug: slug + '-site', meta_title: mark + ' Thai House' }))
  await step('website config', () => post('/api/website/config', { venue_id: V }))
  const WV = '?venue_id=' + V
  await step('opening hours', () => post('/api/website/opening-hours' + WV, [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, opens_at: '12:00', closes_at: '22:00', label: mark + ' hours' }))))
  await step('gallery image', () => post('/api/website/gallery' + WV, { image_url: '/uploads/test/' + slug + '.jpg', caption: mark + ' room' }))
  await step('allergen info', () => post('/api/website/allergens' + WV, { info_type: 'structured', structured_data: [{ dish: mark + ' Pad Thai', allergens: ['peanuts'] }] }))
  await step('staging password', () => put('/api/website/tenant-site/staging-access', { password: slug + '-secret-1' }))
  await step('email template', () => post('/api/email-templates', { venue_id: V, type: 'confirmation', subject: mark + ' Thanks', body_html: '<p>' + mark + ' see you</p>' }))
  await step('website page', () => post('/api/website/pages', { venue_id: null, slug: slug + '-about', title: mark + ' About', kind: 'page', blocks: [] }))
  // The built-in Loyalty page (migration 214): its blocks change like any page's.
  const sitePages = await step('website pages', () => get('/api/website/pages?venue_id=tenant'))
  const loyaltyPage = (sitePages || []).find(p => p.system_key === 'loyalty')
  if (loyaltyPage) {
    await step('loyalty page', () => patch('/api/website/pages/' + loyaltyPage.id, {
      title: mark + ' Loyalty', blocks: [{ id: 'loy-card', type: 'loyalty_card', data: { heading: mark + ' Your card', show_history: false } }],
    }))
  }
  await step('review', () => post('/api/reviews', { venue_id: V, platform: 'google', reviewer_name: mark + ' Gus', rating: 4, review_text: mark + ' good' }))
  await step('promotion', () => post('/api/promotions', { name: mark + ' 10% off', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto' }))
  await step('issue', () => post('/api/issues', { title: mark + ' Printer jam', description: mark + ' jammed', category: 'incident', impact: 'low', urgency: 'low' }))
  await step('feature request', () => post('/api/feature-requests', { title: mark + ' Dark mode', description: mark + ' please' }))
  await step('media category', () => post('/api/media/categories', { name: mark + ' Food' }))
  await step('custom role', () => post('/api/access/roles', { key: slug + '-supervisor', label: mark + ' Supervisor', permissions: { bookings: 'manage' } }))
  const tax = await step('tax rate', () => post('/api/tax-rates', { name: mark + ' Zero', rate: 0 }))
  if (tax) await step('tax rate value', () => put(`/api/tax-rates/${tax.id}/values`, { values: { [V]: 5 } }))
  const orderType = await step('order type', () => post('/api/order-types', { name: mark + ' Drive thru' }))
  // Charges on the company's list (migration 231): a service charge from 6
  // guests, a packaging fee with the tenant's own tax rate, and a cup deposit
  // for each of a dish and the dishes of a section (the venue's matrix below).
  const chargeSvc = await step('charge', () => post('/api/pos/charges', { name: mark + ' Service', kind: 'percent', value: 10, optional: true, min_covers: 6 }))
  const chargePack = await step('charge with a tax rate', () => post('/api/pos/charges', { name: mark + ' Packaging', kind: 'amount', value: 30, tax_rate_id: tax?.id ?? null }))
  const chargeCup = dish && menuSection
    ? await step('dish charge', () => post('/api/pos/charges', { name: mark + ' Cup deposit', kind: 'amount', value: 25, optional: true, basis: 'dishes', per: 'dish', item_ids: [dish.id], section_ids: [menuSection.id] }))
    : null
  // A discount on the company's list (migration 225).
  const tillDiscount = await step('till discount', () => post('/api/pos/discounts', { name: mark + ' Staff meal', kind: 'percent', value: 50, scope: 'check', needs_manager: true }))
  const navItem = await step('nav item', () => post('/api/nav/items', { label: mark + ' Link', route: '/rota', parent_id: null }))
  if (navItem && viewerRole) await step('nav item roles', () => patch(`/api/nav/items/${navItem.id}`, { hidden_role_ids: [viewerRole.id] }))
  await step('ordering settings', () => put(`/api/orders/settings/${V}`, {
    is_enabled: true, hours: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, windows: [{ open: '11:00', close: '22:00' }] })),
    lead_time_mins: 15, slot_interval_mins: 15, max_orders_per_slot: 10, max_days_ahead: 2,
    min_order_pence: 0, payment_methods: ['pay_at_venue'],
  }))
  // Menu times (migration 230): the menu online (its times: on since 2026,
  // at any time of day), on the kiosks at any time, on the tills by its times.
  if (menu) await step('menu times', () => put(`/api/menu-times/venues/${V}`, {
    rows: [{ menu_id: menu.id, times: { from: '2026-01-01', until: null, times: [] }, web: { use: 'menu' }, kiosk: { use: 'always' }, till: { use: 'menu' } }],
  }))
  // Today's ordering hours back to the usual ones (migration 223): no time of day needed.
  await step('ordering hours today', () => post(`/api/orders/hours/${V}`, { until: null }))
  await step('online order', async () => {
    const [o] = await sql`
      INSERT INTO orders (tenant_id, venue_id, service_date, order_number, promised_at, guest_name, guest_email, subtotal_pence, total_pence, payment_method, status)
      VALUES (${tenantId}, ${V}, ${MONDAY}, 1, now(), ${mark + ' Carol'}, ${'carol@' + slug + '.test'}, 1250, 1250, 'pay_at_venue', 'placed') RETURNING id
    `
    ids.order = o.id
  })
  if (dish) await step('sold out', () => put(`/api/orders/availability/${V}/${dish.id}`, { sold_out: 'today' }))
  await step('email settings', () => post(`/api/email-templates/settings/${V}`, { email_provider: 'smtp', from_name: mark + ' Thai' }))

  // ── Till, kitchen, kiosks, screens ──
  // Covers that must be had and no courses (migration 231), then which
  // charges its checks of the Drive thru order type get.
  const stream = await step('revenue stream', () => post(`/api/pos/venues/${V}/revenue-streams`, { name: mark + ' Bar', covers: 'must', courses: false }))
  if (stream && orderType && chargeSvc && chargePack) {
    await step('charge rules', () => put(`/api/pos/venues/${V}/charge-rules`, { rules: [chargeSvc, chargePack, chargeCup].filter(Boolean).map(x => ({ charge_id: x.id, revenue_stream_id: stream.id, order_type_id: orderType.id })) }))
  }
  const printer = await step('printer', () => post(`/api/pos/venues/${V}/printers`, { name: mark + ' Kitchen', host: '192.168.1.50' }))
  // Devices show a code of their own and are linked by it (migration 184):
  // a till from Store tech, a kitchen screen from the installer.
  const tillDevice = await step('till device', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'terminal' }), 'device code')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Till 1', settings: { mode: 'table' } })
  })
  // Printers (migration 191): one plugged into the till, and a venue hub for the network ones.
  if (tillDevice?.device) {
    await step('device printer', () => post(`/api/pos/venues/${V}/printers`, { name: mark + ' Till printer', kind: 'receipt', connection: 'device', device_id: tillDevice.device.id }))
  }
  // A card machine (migration 193): the test machine, the till's.
  const cardMachine = await step('card machine', () => post(`/api/pos/venues/${V}/card-readers`, { provider: 'test', name: mark + ' Test card machine' }))
  if (cardMachine && tillDevice?.device) {
    await step('till card machine', () => patch(`/api/pos/devices/${tillDevice.device.id}`, { settings: { mode: 'table', card_reader: cardMachine.id } }))
    await step('card machine name', () => patch(`/api/pos/card-readers/${cardMachine.id}`, { name: mark + ' Counter card machine' }))
  }
  await step('venue hub', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'hub' }), 'hub code')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Hub' })
  })
  await step('linked kitchen screen', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'kds', device: { width: 1280, height: 800 } }), 'device code')
    await ok(c.post('/api/installer/lookup', { code: shown.code }), 'installer lookup')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Pass screen' })
  })
  const station = await step('kitchen station', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Wok', kind: 'prep' }))
  // A kitchen printer in the flow (migration 191).
  const printerBox = printer ? await step('kitchen printer box', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Ticket printer', kind: 'printer', settings: { printer_id: printer.id } })) : null
  // A Splitter (kind balance, migration 183) whose pieces name one of the tenant's dishes.
  if (dish) await step('balance box', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Wings', kind: 'balance', settings: { pieces: [{ kind: 'dish', id: dish.id, label: dish.name, qty: 8 }] } }))
  // A Sleeper (migration 200): holds dishes for its minutes.
  await step('sleeper', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Delivery wait', kind: 'sleeper', settings: { delay_mins: 10 } }))
  // Kitchen flows (migration 177): the first comes with the setup page; a
  // second copied from it, renamed, put first and in use.
  const tillSetup = station ? await step('till setup', () => get(`/api/pos/venues/${V}/setup`)) : null
  const mainFlow = tillSetup?.kds_flows?.[0]
  if (station && mainFlow) {
    await step('kitchen flow', () => put(`/api/pos/kds-flows/${mainFlow.id}`, {
      links: [{ from: null, to: station.id, targets: [] }, ...(printerBox ? [{ from: null, to: printerBox.id, targets: [] }] : [])],
      layout: { start: { x: 28, y: 28 }, [station.id]: { x: 378, y: 28 } },
    }))
    const busy = await step('second kitchen flow', () => post(`/api/pos/venues/${V}/kds-flows`, { name: mark + ' Busy', copy_from: mainFlow.id }))
    if (busy) {
      await step('rename kitchen flow', () => patch(`/api/pos/kds-flows/${busy.id}`, { name: mark + ' Busy night' }))
      await step('kitchen flows order', () => put(`/api/pos/venues/${V}/kds-flows/order`, { ids: [busy.id, mainFlow.id] }))
      await step('kitchen flow in use', () => put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: busy.id }))
      // A "sent from" filter (migration 192) on the flow not in use: this
      // venue's till, by id; and the printer gets every dish but the till's
      // (an Except link, migration 204).
      if (tillDevice?.device) {
        await step('kitchen flow sent from', () => put(`/api/pos/kds-flows/${mainFlow.id}`, {
          links: [
            { from: null, to: station.id, targets: [{ kind: 'device', id: tillDevice.device.id }] },
            ...(printerBox ? [{ from: null, to: printerBox.id, targets: [{ kind: 'device', id: tillDevice.device.id }], exclude: true }] : []),
          ],
          layout: { start: { x: 28, y: 28 }, [station.id]: { x: 378, y: 28 } },
        }))
      }
    }
    // A flow shared by every location (migration 192): boxes by name, a dish
    // filter and a till by name. Hertford's setup page first, so it has a
    // flow of its own before any shared one exists.
    if (ids.venue2) await step('hertford till setup', () => get(`/api/pos/venues/${ids.venue2}/setup`))
    const sharedFlow = await step('shared kitchen flow', () => post(`/api/pos/venues/${V}/kds-flows`, { name: mark + ' Every site', shared: true }))
    if (sharedFlow) {
      const wokBox = crypto.randomUUID()
      const passBox = crypto.randomUUID()
      await step('shared kitchen flow links', () => put(`/api/pos/kds-flows/${sharedFlow.id}`, {
        boxes: [{ id: wokBox, name: station.name, kind: 'prep' }, { id: passBox, name: mark + ' Pass', kind: 'expo' }],
        links: [
          { from: null, to: wokBox, targets: [...(dish ? [{ kind: 'item', id: dish.id }] : []), { kind: 'device', name: mark + ' Till 1' }] },
          { from: wokBox, to: passBox, targets: [{ kind: 'device', name: mark + ' Bar till' }], exclude: true },
        ],
        layout: { start: { x: 28, y: 28 }, [wokBox]: { x: 378, y: 28 } },
      }))
    }
  }
  await step('till settings', () => patch(`/api/pos/venues/${V}/settings`, { receipt_name: mark + ' Thai House' }))
  // GloriaFood (migration 159) and its orders on the kitchen screens (178).
  await step('gloriafood link', () => put(`/api/gloriafood/venues/${V}/link`, { method: 'push', show_on_board: true }))
  if (orderType) {
    await step('gloriafood kitchen settings', () => patch(`/api/pos/venues/${V}/settings`, {
      kds_gloriafood: true, kds_gloriafood_lead_mins: 25, kds_gloriafood_types: { pickup: orderType.id, delivery: null },
    }))
  }
  await step('floor area', () => post(`/api/pos/venues/${V}/floor-areas`, { name: mark + ' Patio' }))
  const kioskDesign = await step('kiosk design', () => post('/api/pos/kiosk-designs', { name: mark + ' Kiosk' }))
  // A look of its own for the tenant's option group (options.group_looks).
  if (kioskDesign && vg) {
    await step('kiosk design group look', () => put(`/api/pos/kiosk-designs/${kioskDesign.id}`, {
      name: mark + ' Kiosk', settings: {
        options: { group_looks: [{ group_id: vg.id, tiles: 'hexagon', entrance: 'deal' }] },
        // The order done screen of the tenant's own order type (done.types, migration 209's change).
        ...(orderType ? { done: { receipt_qr: true, types: [{ order_type_id: orderType.id, main: 'name', lines: ['number'], message: mark + ' collect at the window' }] } } : {}),
      },
    }))
  }
  // Print designs (migration 190): a kitchen ticket design used at Ware with its own words.
  const printDesign = await step('print design', () => post('/api/pos/print-designs', { kind: 'kitchen', name: mark + ' Tickets' }))
  if (printDesign) {
    await step('print design layout', () => put(`/api/pos/print-designs/${printDesign.id}`, { name: mark + ' Tickets', layout: { blocks: [
      { id: 'tt', type: 'title', opts: { main: 'tent' } }, { id: 'tx', type: 'text', opts: { text: mark + ' thanks' } }, { id: 'it', type: 'items', opts: {} },
    ] } }))
    await step('print design use', () => put('/api/pos/print-design-uses', { venue_id: V, use: 'kitchen', design_id: printDesign.id }))
    await step('print design words', () => put(`/api/pos/print-designs/${printDesign.id}/variations/${V}`, { texts: { tx: { text: mark + ' Ware words' } }, hidden: [] }))
  }
  // A till layout (migration 228) naming a section, a dish, a discount and a charge of the
  // tenant's, used by Ware's tills and by the till itself.
  const tillLayout = await step('till layout', () => post('/api/pos/till-layouts', { name: mark + ' Counter screen', template: 'quick' }))
  if (tillLayout) {
    const zones = tillLayout.layout.zones.map(z => {
      if (z.type === 'categories' && menuSection) return { ...z, sections: [menuSection.id] }
      if (z.type === 'buttons') {
        return {
          ...z,
          buttons: [
            ...z.buttons,
            ...(dish ? [{ id: 'fx-dish', action: 'item', item_id: dish.id, label: mark + ' Pad Thai' }] : []),
            ...(tillDiscount ? [{ id: 'fx-disc', action: 'discount_preset', preset_id: tillDiscount.id }] : []),
            ...(chargeCup ? [{ id: 'fx-charge', action: 'charge', charge_id: chargeCup.id }] : []),
          ],
        }
      }
      return z
    })
    await step('till layout zones', () => put(`/api/pos/till-layouts/${tillLayout.id}`, { name: mark + ' Counter screen', layout: { ...tillLayout.layout, zones } }))
    await step('venue till layout', () => patch(`/api/pos/venues/${V}/settings`, { till_layout_id: tillLayout.id }))
    if (tillDevice?.device) {
      await step('till own layout', () => patch(`/api/pos/devices/${tillDevice.device.id}`, { settings: { mode: 'table', ...(cardMachine ? { card_reader: cardMachine.id } : {}), till_layout: tillLayout.id } }))
    }
  }
  const design = await step('screen design', () => post('/api/screens/designs', { name: mark + ' Board' }))
  const playlist = await step('screen playlist', () => post('/api/screens/playlists', { name: mark + ' Day' }))
  if (playlist && design) await step('playlist boards', () => put(`/api/screens/playlists/${playlist.id}`, { name: mark + ' Day', items: [{ design_id: design.id, duration_secs: 10 }] }))
  await step('screen wall', () => post('/api/screens/walls', { venue_id: V, name: mark + ' Wall', cols: 2, rows: 1 }))

  // ── Loyalty (migration 211; loyalty.test.mjs starts without it) ──
  const loyalty = withLoyalty ? await step('loyalty programme', () => get('/api/loyalty/programme')) : null
  if (loyalty) {
    const lp = loyalty.programme.settings
    await step('loyalty on', () => put('/api/loyalty/programme', { enabled: true, settings: { ...lp, name: mark + ' Club', features: { ...lp.features, stamps: true } } }))
  }
  const fiver = loyalty && await step('loyalty reward', () => post('/api/loyalty/rewards', { name: mark + ' £5 off', kind: 'amount_off', value: 500, points_cost: 100 }))
  const freeDish = loyalty && dish ? await step('loyalty free dish', () => post('/api/loyalty/rewards', { name: mark + ' Free dish', kind: 'free_item', item_ids: [dish.id], points_cost: 50 })) : null
  if (freeDish) await step('loyalty stamp card', () => post('/api/loyalty/stamp-cards', { name: mark + ' Card', stamps_needed: 5, earn: { per: 'item', item_ids: [dish.id] }, reward_id: freeDish.id }))
  const member = loyalty && await step('loyalty member', () => post('/api/loyalty/members', { name: mark + ' Member', email: (mark + '.member@example.test').toLowerCase(), agreed: true }))
  if (member) {
    ids.loyaltyMember = member.id
    await step('loyalty points', () => post(`/api/loyalty/members/${member.id}/adjust`, { points: 300, note: mark + ' opening' }))
    if (fiver) await step('loyalty give reward', () => post(`/api/loyalty/members/${member.id}/rewards`, { reward_id: fiver.id, note: mark + ' sorry' }))
    await step('loyalty member note', () => patch(`/api/loyalty/members/${member.id}`, { notes: mark + ' regular' }))
  }

  // ── Pepper ──
  await step('access token', () => post('/api/ai/tokens', { name: mark + ' Claude Code' }))
  await step('ai settings', () => patch('/api/ai/settings', { guest_chat_enabled: false, chat_retention_days: 90 }))
  const [conv] = await sql`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt, title, model_tier)
    VALUES (${tenantId}, 'staff_chat', ${sub}, ${sub + '@test.local'}, 'test', ${mark + ' chat'}, 'fast') RETURNING id
  `
  await sql`INSERT INTO ai_messages (conversation_id, tenant_id, seq, role, content) VALUES (${conv.id}, ${tenantId}, 1, 'user', ${sql.json([{ type: 'text', text: mark + ' hello' }])})`
  await sql`INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
            VALUES (${tenantId}, ${conv.id}, 'toolu_x', 'set_rota', ${sql.json({})}, ${sql.json({ title: mark + ' card', lines: [] })}, now() + interval '30 minutes')`

  return { ids, failed, writes }
}
