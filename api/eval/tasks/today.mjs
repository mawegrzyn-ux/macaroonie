// Today's tasks (Pepper-first step 5e): Pepper changes a task's state on the
// list Home shows, through the task store (POST /api/ops/tasks): a snooze
// said the way it is said mid-service, and a skip with the reason given
// (decision 7: a skip only with a reason). The fixtures give the first venue
// a fridge ("Oak Walk-in") with a Morning check at 09:00 and a daily
// checklist ("Oak Opening"); the skip task adds a weekly one.

const stateOf = (ctx, like) => ctx.sql`
  SELECT task_key, snoozed_until, skipped_on::text AS skipped_on, skip_reason
    FROM ops_task_states WHERE tenant_id = ${ctx.tenantId} AND venue_id = ${ctx.venue.id} AND task_key LIKE ${like}`

export const tasks = [
  {
    id: 'snooze_fridge_checks',
    area: 'today',
    why: 'A common ask mid-service: the checks are due but the kitchen is in a rush; the list should hide them for a while, not log anything.',
    say: ctx => 'Snooze the fridge checks at ' + ctx.venue.name + ' for an hour, we\'re slammed.',
    expect: 'change',
    async check(ctx) {
      const rows = await stateOf(ctx, 'fridge_check:%')
      if (!rows.length) return 'no fridge check snoozed'
      const mins = rows.map(r => (r.snoozed_until ? (new Date(r.snoozed_until).getTime() - Date.now()) / 60000 : 0))
      if (mins.some(m => m < 40 || m > 70)) return 'snoozed for ' + mins.map(Math.round).join(', ') + ' minutes, not an hour'
      const [{ n }] = await ctx.sql`SELECT count(*)::int AS n FROM fs_temp_logs WHERE tenant_id = ${ctx.tenantId} AND NOT is_generated`
      return n === 0 ? true : 'a reading was logged'
    },
    reference: ctx => [{ tool: 'snooze_task', input: { venue: ctx.venue.name, task: 'fridge checks', minutes: 60 } }],
  },
  {
    id: 'skip_weekly_checklist',
    area: 'today',
    why: 'A compliance task that can\'t be done today: skipped with the reason the person gave, kept for the managers (decision 7).',
    async setup(ctx) {
      const tpl = await ctx.owner.post('/api/checklists/templates', { venue_id: ctx.venue.id, name: 'Oak Deep clean', frequency: 'weekly' })
      ctx.made.template = tpl.json?.id
      if (!ctx.made.template) throw new Error('weekly checklist: ' + tpl.status + ' ' + tpl.body)
      await ctx.owner.post(`/api/checklists/templates/${ctx.made.template}/items`, { label: 'Walk-in shelves' })
    },
    // Named as it is on the list: "the weekly checklist" alone let Pepper fairly ask which (live run, 24 Nov 2026).
    say: ctx => 'Skip the Oak Deep clean checklist at ' + ctx.venue.name + ' today, the walk-in is being repaired.',
    expect: 'change',
    async check(ctx) {
      const rows = await stateOf(ctx, 'checklist:%')
      const skipped = rows.filter(r => r.skipped_on === ctx.today)
      if (skipped.length !== 1) return skipped.length + ' checklists skipped today, not one'
      if (skipped[0].task_key !== 'checklist:' + ctx.made.template) return 'skipped the wrong checklist'
      return /repair/i.test(skipped[0].skip_reason || '') ? true : 'the reason isn\'t the one given: ' + skipped[0].skip_reason
    },
    reference: ctx => [{ tool: 'skip_task', input: { venue: ctx.venue.name, task: 'weekly checklist', reason: 'The walk-in is being repaired' } }],
  },
]
