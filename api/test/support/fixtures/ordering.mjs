// Online ordering: a promotion, the venue's ordering settings and hours, an
// online order, a dish sold out. The venue's menu times (a menus thing) are
// made here too, between the ordering settings and today's hours: saving
// them writes ordering_settings.menu_ids, so they must come after the
// settings, as they always have.
import { sql } from '../app.mjs'
import { MONDAY } from './parts.mjs'

export const order = 120

export const kinds = { paymentId: ['order_payments'] }

export async function fill(ctx) {
  const { V, mark, slug, tenantId, ids, made, step, post, put } = ctx
  const { menu, dish } = made
  await step('promotion', () => post('/api/promotions', { name: mark + ' 10% off', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto' }))
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
}
