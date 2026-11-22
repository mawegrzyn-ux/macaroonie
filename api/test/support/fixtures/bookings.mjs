// Bookings: tables, the schedule, rules, customers, bookings and a hold;
// later (fillLate), the booking emails' template and settings.
import { MONDAY } from './parts.mjs'

export const order = 20
// After online ordering, where the email settings have always been made.
export const lateOrder = 130

export const kinds = {
  holdId: ['booking_holds'], paymentId: ['payments'],
  sid: ['venue_sittings', 'override_sittings', 'exception_sittings'], eid: ['schedule_exceptions'], oid: ['schedule_date_overrides'],
}

// A hold must be for a time still ahead (the booking cutoff refuses one in
// the past): 19:00 UTC three days from now, past the days the schedule
// below closes.
function holdTime() {
  const d = new Date(Date.now() + 3 * 86400000)
  while (['12-25', '12-26', '01-02'].includes(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10) + 'T19:00:00.000Z'
}

export async function fill(ctx) {
  const { V, mark, slug, c, step, post, put } = ctx
  // ── Venues, tables, schedule, rules ──
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
}

export async function fillLate(ctx) {
  const { V, mark, step, post } = ctx
  await step('email template', () => post('/api/email-templates', { venue_id: V, type: 'confirmation', subject: mark + ' Thanks', body_html: '<p>' + mark + ' see you</p>' }))
  await step('email settings', () => post(`/api/email-templates/settings/${V}`, { email_provider: 'smtp', from_name: mark + ' Thai' }))
}
