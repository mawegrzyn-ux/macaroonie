// The shell: a menu link hidden from the viewer role (made.viewerRole from
// dashboards.mjs); last of all (fillLate), push notices.
import { sql } from '../app.mjs'

export const order = 110
// After Pepper, where the push notices have always been made: the last rows.
export const lateOrder = 230

export async function fill(ctx) {
  const { mark, made, step, post, patch } = ctx
  const { viewerRole } = made
  const navItem = await step('nav item', () => post('/api/nav/items', { label: mark + ' Link', route: '/rota', parent_id: null }))
  if (navItem && viewerRole) await step('nav item roles', () => patch(`/api/nav/items/${navItem.id}`, { hidden_role_ids: [viewerRole.id] }))
  // ── The usage record (migration 270): a page and a menu search ──
  await step('usage record', () => post('/api/usage/events', { events: [
    { kind: 'page', path: '/rota' },
    { kind: 'search', query: mark + ' fridge', results: 2, pepper: true, picked: 'pepper', path: '/food-safety' },
  ] }))
}

export async function fillLate(ctx) {
  const { V, mark, tenantId, ids, step, post, put } = ctx
  // ── Push notices (migration 262) ──
  await step('notice settings', () => put('/api/notices/settings', {
    enabled: true, venue_ids: [V], areas: ['food_safety', 'cash'], due_soon: true, late: true, quiet_from: '23:00', quiet_to: '06:00',
  }))
  const device = await step('notice device', () => post('/api/notices/devices', {
    kind: 'web', label: mark + ' browser',
    token: { endpoint: 'https://push.example.invalid/' + mark.toLowerCase() + '-' + tenantId.slice(0, 8), keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } },
  }))
  if (device?.id) ids.push_device = device.id
  await sql`INSERT INTO task_notices (tenant_id, venue_id, task_key, day, kind, title)
            VALUES (${tenantId}, ${V}, ${'temps:' + mark}, current_date, 'late', ${mark + ' fridge checks'})
            ON CONFLICT DO NOTHING`
}
