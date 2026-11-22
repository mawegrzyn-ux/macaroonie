// Dashboards and their widgets. Hands on made.viewerRole (the viewer role,
// read here: shell.mjs and reports.mjs hide or share things with it).
export const order = 70

export const kinds = { widgetId: ['hs_dashboard_widgets'] }

export async function fill(ctx) {
  const { V, mark, made, step, post, patch, get } = ctx
  // A dashboard and a menu link hidden from the viewer role (migration 229),
  // so the sweep sends the other tenant this tenant's role ids.
  const roles = await step('roles', () => get('/api/access/roles'))
  const viewerRole = (roles || []).find(r => r.key === 'viewer')
  made.viewerRole = viewerRole
  for (const kind of ['hs', 'cash', 'rota', 'custom']) {
    const d = await step('dashboard ' + kind, () => post(`/api/${kind}-dashboards/dashboards`, { venue_id: V, name: mark + ' ' + kind }))
    if (d) await step('widget ' + kind, () => post(`/api/${kind}-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'temp_checks' }))
    if (d && viewerRole && kind === 'hs') {
      await step('dashboard roles', () => patch(`/api/hs-dashboards/dashboards/${d.id}`, { hidden_role_ids: [viewerRole.id] }))
    }
  }
}
