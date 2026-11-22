// Food safety and the H&S action log: fridge readings in and out of range, a
// delivery check, an action logged; asking when the reading is missing.
// The fixtures give the first venue a fridge ("Oak Walk-in", 0 to 5 C, a
// Morning check at 09:00) and a supplier ("Oak Fresh Co").

const readingsOf = ctx => ctx.sql`
  SELECT l.temperature_c::float8 AS t, l.corrective_action, l.log_date::text AS day, e.name
    FROM fs_temp_logs l JOIN fs_equipment e ON e.id = l.equipment_id
   WHERE l.tenant_id = ${ctx.tenantId} AND NOT l.is_generated ORDER BY l.created_at`

export const tasks = [
  {
    id: 'fridge_reading',
    area: 'safety',
    why: 'The commonest check of the day, said the way it is said in a kitchen.',
    say: ctx => 'The walk-in fridge at ' + ctx.venue.name + ' is reading 3 degrees.',
    expect: 'change',
    async check(ctx) {
      const rows = await readingsOf(ctx)
      if (rows.length !== 1) return rows.length + ' readings logged, not one'
      const [r] = rows
      if (r.t !== 3) return 'logged ' + r.t + ' C'
      if (r.day !== ctx.today) return 'logged for ' + r.day
      return /walk-in/i.test(r.name) ? true : 'logged for ' + r.name
    },
    reference: ctx => [{ tool: 'log_temperature', input: { venue_id: ctx.venue.id, fridge: 'Walk-in', temperature_c: 3 } }],
  },
  {
    id: 'fridge_out_of_range',
    area: 'safety',
    why: 'An out-of-range reading needs what was done about it (log_temperature asks for corrective_action).',
    say: ctx => 'Walk-in fridge at ' + ctx.venue.name + ' is at 9C. We moved everything into the other fridge and called the engineer.',
    expect: 'change',
    async check(ctx) {
      const [r] = await readingsOf(ctx)
      if (!r) return 'no reading logged'
      if (r.t !== 9) return 'logged ' + r.t + ' C'
      return (r.corrective_action || '').trim().length > 5 ? true : 'no corrective action with it'
    },
    reference: ctx => [{ tool: 'log_temperature', input: { venue_id: ctx.venue.id, fridge: 'Walk-in', temperature_c: 9, corrective_action: 'Moved the stock to the other fridge and called the engineer.' } }],
  },
  {
    id: 'ask_for_reading',
    area: 'safety',
    why: 'A check with no reading must not be logged with a made-up one.',
    say: () => 'Log the fridge temperature.',
    expect: 'nothing',
    watch: ['fs_temp_logs'],
    reference: () => [],
  },
  {
    id: 'delivery_check',
    area: 'safety',
    why: 'A delivery logged on arrival, with its temperature.',
    // The fixtures receive a purchase order from the same supplier today, which logs a check of its own.
    async setup(ctx) { ctx.made.had = (await ctx.sql`SELECT id FROM fs_delivery_checks WHERE tenant_id = ${ctx.tenantId}`).map(r => r.id) },
    say: ctx => 'The Fresh Co delivery has just come in at ' + ctx.venue.name + '. All fine, the chilled stuff is at 4 degrees, we accepted it.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`
        SELECT product_temp_c::float8 AS t, accepted, delivery_date::text AS day FROM fs_delivery_checks
         WHERE tenant_id = ${ctx.tenantId} AND NOT is_generated AND delivery_date = ${ctx.today}::date AND vendor_name ILIKE '%fresh co%'
           AND id <> ALL(${ctx.made.had}::uuid[])`
      if (rows.length !== 1) return rows.length + ' new delivery checks today'
      if (rows[0].t !== 4) return 'logged at ' + rows[0].t + ' C'
      return rows[0].accepted ? true : 'not marked accepted'
    },
    reference: ctx => [{ tool: 'log_delivery', input: { venue_id: ctx.venue.id, supplier: 'Oak Fresh Co', product_temp_c: 4, accepted: true, packaging_ok: true, damage_ok: true, quality_ok: true, temp_ok: true } }],
  },
  {
    id: 'hs_action',
    area: 'safety',
    why: 'A repair logged as an H&S action at the right priority.',
    say: ctx => 'Add to the H&S action log at ' + ctx.venue.name + ': the step at the back door is loose. High priority.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`SELECT priority, is_completed, venue_id FROM hs_action_log WHERE tenant_id = ${ctx.tenantId} AND task || ' ' || coalesce(details, '') ILIKE '%step%'`
      if (rows.length !== 1) return rows.length + ' actions about the step'
      if (rows[0].venue_id !== ctx.venue.id) return 'logged at another venue'
      return rows[0].priority === 'high' ? true : 'priority ' + rows[0].priority
    },
    reference: ctx => [{ tool: 'add_hs_action', input: { venue_id: ctx.venue.id, task: 'Loose step at the back door', priority: 'high' } }],
  },
]
