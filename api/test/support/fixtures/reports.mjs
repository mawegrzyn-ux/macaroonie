// Reports (migration 243): a saved report run, previewed, planned, exported,
// kept as a file, printed, changed, shared with the viewer role
// (made.viewerRole from dashboards.mjs), copied, starred and scheduled; a
// layout, a page of reports, a data link. fillTenant(..., { reports: false })
// leaves them out: reports-api.test.mjs starts without them.
import { MONDAY } from './parts.mjs'

export const order = 210

export const kinds = { fileId: ['report_files'], scheduleId: ['report_schedules'], layoutId: ['report_layouts'], linkId: ['report_data_links'] }

export async function fill(ctx) {
  const { V, mark, slug, ids, made, withReports, step, post, put, patch, get } = ctx
  const { viewerRole } = made
  // A saved report that names this tenant's venue in its definition and in
  // what it is run with, shared with a role: the sweep sends each write
  // again as the other tenant.
  if (withReports) {
    const spec = {
      subject: 'bookings.bookings',
      params: [{ key: 'period', type: 'period', default: { relative: 'last_week' } }, { key: 'venues', type: 'venues', default: 'all' }],
      rows: ['date'], values: [{ measure: 'bookings' }, { measure: 'guests' }],
      filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' }, { field: 'venue', op: 'in', value: [V] }],
    }
    const given = { params: { period: { from: MONDAY, to: '2026-10-25' }, venues: [V] } }
    const saved = await step('report', () => post('/api/reports', { name: mark + ' Bookings by day', description: mark + ' every day', spec, tags: [slug] }))
    const rid = saved?.report?.id
    if (rid) {
      ids.report = rid
      await step('report run', () => post(`/api/reports/${rid}/run`, given))
      await step('report preview', () => post('/api/reports/preview', { spec, ...given }))
      await step('report plan', () => post('/api/reports/plan', {
        plan: { subject: 'bookings.bookings', by: [{ field: 'date' }], figures: [{ figure: 'bookings' }], venues: [mark + ' Ware'], period: { from: MONDAY, to: '2026-10-25' } },
        report: spec,
      }))
      await step('report file', () => post(`/api/reports/${rid}/export`, { format: 'csv', ...given }))
      // A file kept to download later (migration 250): only its maker downloads it.
      const kept = await step('report kept file', () => post(`/api/reports/${rid}/files`, { format: 'csv', ...given }))
      if (kept?.file?.id) ids.reportFile = kept.file.id
      await step('report print link', () => post(`/api/reports/${rid}/print-link`, given))
      await step('report changed', () => put(`/api/reports/${rid}`, { description: mark + ' week by week', spec: { ...spec, rows: [{ field: 'date', bucket: 'week' }] } }))
      if (viewerRole) await step('report shared', () => patch(`/api/reports/${rid}/sharing`, { shared: 'roles', role_ids: [viewerRole.id] }))
      await step('report copy', () => post(`/api/reports/${rid}/copy`, { name: mark + ' Bookings by week (copy)' }))
      await step('report star', () => post(`/api/reports/${rid}/star`, {}))
      // A schedule (migration 251) to the person themselves, over a period
      // that moves, changed, paused and started again. Nothing is sent: the
      // sweep sends only what is due, and these tests don't run it.
      const me = await step('report recipients', () => get('/api/reports/recipients'))
      if (me?.me?.user_id) {
        const made = await step('report schedule', () => post(`/api/reports/${rid}/schedules`, {
          name: mark + ' Monday bookings', timing: { every: 'week', days: [1], time: '07:30' },
          params: { period: { relative: 'last_week' }, venues: [V] },
          delivery: { in_message: true, attach: 'csv' }, condition: { when: 'rows' },
          recipients: [{ user_id: me.me.user_id }],
        }))
        const scheduleId = made?.schedule?.id
        if (scheduleId) {
          ids.reportSchedule = scheduleId
          await step('report schedule changed', () => patch(`/api/reports/schedules/${scheduleId}`, { message: mark + ' for the Monday meeting' }))
          await step('report schedule paused', () => post(`/api/reports/schedules/${scheduleId}/pause`, {}))
          await step('report schedule resumed', () => post(`/api/reports/schedules/${scheduleId}/resume`, {}))
        }
      }
      // A layout (migration 253) and a page of two reports with words
      // between them, for this tenant's venue: one of its reports run for
      // the screen, its print link made, and the layout picked for it. The
      // layout isn't the group's default, so other reports print as before.
      const laid = await step('report layout', () => post('/api/reports/layouts', {
        name: mark + ' Board pack',
        settings: { page: { size: 'a4', way: 'landscape' }, footer: { text: mark + ' in confidence' } },
      }))
      const layoutId = laid?.layout?.id
      if (layoutId) {
        ids.reportLayout = layoutId
        await step('report layout changed', () => put(`/api/reports/layouts/${layoutId}`, {
          settings: { page: { size: 'a4', way: 'landscape' }, footer: { text: mark + ' in confidence' }, style: { density: 'compact' } },
        }))
      }
      const page = await step('report page', () => post('/api/reports', {
        name: mark + ' Monday pack', description: mark + ' for the Monday meeting',
        spec: {
          kind: 'page', period: { from: MONDAY, to: '2026-10-25' }, venues: [V],
          blocks: [
            { type: 'text', title: mark + ' This week', text: mark + ' read before the meeting' },
            { type: 'report', ref: rid, show: 'table' },
            { type: 'break' },
            { type: 'report', ref: 'starter:bookings_by_source', title: mark + ' Where bookings came from' },
          ],
        },
      }))
      const pageId = page?.report?.id
      if (pageId) {
        ids.reportPage = pageId
        const first = page.report.spec.blocks.find(b => b.type === 'report')
        await step('report page block', () => post(`/api/reports/${pageId}/blocks/${first.id}/run`, { venues: [V] }))
        await step('report page print link', () => post(`/api/reports/${pageId}/print-link`, { venues: [V] }))
        await step('report page changed', () => put(`/api/reports/${pageId}`, { description: mark + ' for Monday at ten' }))
        if (layoutId) await step('report page layout', () => put(`/api/reports/${pageId}/layout`, { layout_id: layoutId }))
      }
      // A data link (migration 256) with its venue fixed and the period
      // left open, changed and given a new key.
      const linked = await step('report data link', () => post(`/api/reports/${rid}/data-links`, {
        name: mark + ' Accountant sheet', params: { venues: [V] }, open_params: ['period'], rate_per_hour: 120,
      }))
      const linkId = linked?.link?.id
      if (linkId) {
        ids.reportDataLink = linkId
        await step('report data link changed', () => patch(`/api/reports/data-links/${linkId}`, { name: mark + ' Accountant sheet (weekly)' }))
        await step('report data link key', () => post(`/api/reports/data-links/${linkId}/new-key`, {}))
      }
    }
  }
}
