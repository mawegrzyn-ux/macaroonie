// Core: the venues (every other area's rows hang off the first; without it
// fillTenant() stops), the dev tools' rows and a custom Access role.
import { ok } from '../app.mjs'

export const order = 10

export const kinds = { venueId: ['venues'], tenantId: ['tenants'], userId: ['users'] }

export async function fill(ctx) {
  const { mark, slug, ids, step, post } = ctx
  const venue = await step('venue', () => post('/api/venues', { name: mark + ' Ware', slug: slug + '-ware', timezone: 'Europe/London' }))
  const venue2 = await step('venue 2', () => post('/api/venues', { name: mark + ' Hertford', slug: slug + '-hertford', timezone: 'Europe/London' }))
  ctx.V = ids.venue = venue?.id
  ids.venue2 = venue2?.id
  if (!ctx.V) return
  await step('issue', () => post('/api/issues', { title: mark + ' Printer jam', description: mark + ' jammed', category: 'incident', impact: 'low', urgency: 'low' }))
  await step('feature request', () => post('/api/feature-requests', { title: mark + ' Dark mode', description: mark + ' please' }))
  await step('custom role', () => post('/api/access/roles', { key: slug + '-supervisor', label: mark + ' Supervisor', permissions: { bookings: 'manage' } }))
  // ── A shared device (migration 280): the owner's office PIN, a wrong PIN,
  // the person switch and one change made as that person ──
  const device = await step('shared device', () => post('/api/shared-devices', { venue_id: ctx.V, name: mark + ' Kitchen tablet' }))
  await step('office pin', () => ctx.put('/api/shared-devices/my-pin', { pin: '2580' }))
  if (device?.token) {
    const on = { 'x-shared-device': device.token }
    await step('shared device switch', async () => {
      const people = await ok(ctx.c.get('/api/shared-devices/people', undefined, on), 'people')
      const me = people.people.find(p => p.pin === 'office')
      await ctx.c.post('/api/shared-devices/act', { person: me.key, pin: '9999' }, on)
      const act = await ok(ctx.c.post('/api/shared-devices/act', { person: me.key, pin: '2580' }, on), 'act')
      await ok(ctx.c.post('/api/issues', { title: mark + ' Tablet cracked', description: mark + ' corner', category: 'incident', impact: 'low', urgency: 'low' },
        { ...on, 'x-acting-person': act.token }), 'change on the device')
    })
    ids.sharedDevice = device.device?.id
  }
}
