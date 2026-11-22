// Core: the venues (every other area's rows hang off the first; without it
// fillTenant() stops), the dev tools' rows and a custom Access role.
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
}
