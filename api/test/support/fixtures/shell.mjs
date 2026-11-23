// The shell: a menu link hidden from the viewer role (made.viewerRole from
// dashboards.mjs); last of all (fillLate), push notices and the task store.
import { sql } from '../app.mjs'

export const order = 110
// After Pepper, where the push notices have always been made: the last rows.
export const lateOrder = 230

export async function fill(ctx) {
  const { V, mark, made, step, post, patch, put } = ctx
  const { viewerRole } = made
  const navItem = await step('nav item', () => post('/api/nav/items', { label: mark + ' Link', route: '/rota', parent_id: null }))
  if (navItem && viewerRole) await step('nav item roles', () => patch(`/api/nav/items/${navItem.id}`, { hidden_role_ids: [viewerRole.id] }))
  // ── The usage record (migration 270): a page and a menu search ──
  await step('usage record', () => post('/api/usage/events', { events: [
    { kind: 'page', path: '/rota' },
    { kind: 'search', query: mark + ' fridge', results: 2, pepper: true, picked: 'pepper', path: '/food-safety' },
  ] }))
  // ── Pins on Home (migration 272): a page at a venue and tab, and one plain ──
  await step('home pins', () => put('/api/pins', { pins: [
    { path: '/food-safety', venue_id: V, tab: 'holds', label: mark + ' holds' },
    { path: '/rota' },
  ] }))
}

export async function fillLate(ctx) {
  const { V, mark, tenantId, ids, step, post, put, get } = ctx
  // ── The task store (migration 278): a Today task given to the person, and
  // the feed's record of it for the day (the notices sweep keeps it) ──
  const feed = await step('today feed', () => get(`/api/ops/today?venue_id=${V}&time=10:00`))
  const task = feed?.tasks.find(t => t.kind === 'fridge_check') || feed?.tasks[0]
  if (task) {
    const people = await step('task people', () => get(`/api/ops/tasks/people?venue_id=${V}&key=${encodeURIComponent(task.key)}`))
    const me = people?.people.find(p => p.me)
    if (me) await step('task owner', () => post('/api/ops/tasks', { venue_id: V, key: task.key, action: 'assign', owner_id: me.id }))
    await sql`INSERT INTO ops_task_days (tenant_id, venue_id, day, task_key, area, kind, title, compliance, late_at)
              VALUES (${tenantId}, ${V}, current_date, ${task.key}, ${task.area}, ${task.kind}, ${task.title}, ${!!task.compliance}, now())
              ON CONFLICT DO NOTHING`
  }
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
