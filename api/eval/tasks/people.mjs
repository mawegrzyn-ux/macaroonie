// Staff, the rota and cash: a new starter, a shift, a holiday, a petty cash
// expense; a question about the rota that must change nothing. The fixtures
// give the first venue "Oak Jo Bloggs" (hourly) and "Oak Sam Smith", and the
// shift "Oak Lunch" (11:00 to 15:00).

export const tasks = [
  {
    id: 'add_staff',
    area: 'rota',
    why: 'A new starter with an hourly rate.',
    say: ctx => 'Add a new member of staff at ' + ctx.venue.name + ': Lena Fox, paid £11.44 an hour.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`SELECT venue_id, pay_type, default_rate::float8 AS rate FROM cash_staff WHERE tenant_id = ${ctx.tenantId} AND name ILIKE '%lena fox%'`
      if (rows.length !== 1) return rows.length + ' people called Lena Fox'
      const [s] = rows
      if (s.venue_id !== ctx.venue.id) return 'added at another venue'
      return s.pay_type === 'hourly' && s.rate === 11.44 ? true : s.pay_type + ' at ' + s.rate
    },
    reference: ctx => [{ tool: 'add_staff_member', input: { venue: ctx.venue.name, name: 'Lena Fox', pay_type: 'hourly', rate: 11.44 } }],
  },
  {
    id: 'put_on_rota',
    area: 'rota',
    why: 'One shift on the rota for one person and one day, the rest of the week as it was.',
    say: ctx => 'Put Jo Bloggs on the lunch shift at ' + ctx.venue.name + ' on ' + ctx.day(3) + '.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`
        SELECT e.work_date::text AS day, e.status, s.name AS shift FROM rota_entries e
          JOIN cash_staff p ON p.id = e.staff_id LEFT JOIN rota_shifts s ON s.id = e.shift_id
         WHERE e.tenant_id = ${ctx.tenantId} AND p.name ILIKE '%jo bloggs%' AND e.work_date = ${ctx.day(3)}::date`
      if (rows.length !== 1) return rows.length + ' rota entries for Jo that day'
      const [e] = rows
      if (e.status && !['on', 'working', 'shift'].includes(e.status)) return 'marked ' + e.status
      return /lunch/i.test(e.shift || '') ? true : 'on ' + (e.shift || 'no shift')
    },
    reference: ctx => [{ tool: 'set_rota', input: { venue: ctx.venue.name, changes: [{ person: 'Jo Bloggs', date: ctx.day(3), shift: 'Oak Lunch' }] } }],
  },
  {
    id: 'holiday',
    area: 'rota',
    // The venue and "unpaid" are said (first live run, 23 Nov 2026): Jo works at two
    // venues, and paid holiday (set_rota, pto) or unpaid time off is a real choice
    // Pepper was right to ask about; the task tests the action, not the questions.
    why: 'Unpaid time off at a named venue, with both ends of the dates.',
    say: ctx => 'Put Jo Bloggs down for unpaid time off at ' + ctx.venue.name + ' from ' + ctx.day(10) + ' to ' + ctx.day(14) + '.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`
        SELECT o.from_date::text AS f, o.to_date::text AS t FROM staff_rota_off o JOIN cash_staff p ON p.id = o.staff_id
         WHERE o.tenant_id = ${ctx.tenantId} AND p.name ILIKE '%jo bloggs%'`
      const hit = rows.find(r => r.f === ctx.day(10) && r.t === ctx.day(14))
      return hit ? true : 'time off: ' + JSON.stringify(rows)
    },
    reference: ctx => [{ tool: 'add_time_off', input: { venue: ctx.venue.name, person: 'Jo Bloggs', from: ctx.day(10), to: ctx.day(14), note: 'Holiday' } }],
  },
  {
    id: 'rota_question',
    area: 'rota',
    why: 'A question about the rota is answered from it, never by changing it.',
    say: ctx => 'Who is working at ' + ctx.venue.name + ' this week?',
    expect: 'nothing',
    watch: ['rota_entries', 'staff_rota_off', 'cash_staff'],
    reference: () => [],
  },
  {
    id: 'petty_cash',
    area: 'cash',
    why: 'A petty cash expense on today\'s Cash Recon day, the amount in pounds.',
    say: ctx => 'Add a petty cash expense at ' + ctx.venue.name + ' today: £12.40 for milk.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`
        SELECT x.amount::float8 AS amount, x.description, r.report_date::text AS day, r.venue_id FROM cash_expenses x
          JOIN cash_daily_reports r ON r.id = x.report_id
         WHERE x.tenant_id = ${ctx.tenantId} AND x.description ILIKE '%milk%'`
      if (rows.length !== 1) return rows.length + ' expenses for milk'
      const [x] = rows
      if (x.venue_id !== ctx.venue.id || x.day !== ctx.today) return 'on ' + x.day + ' at another venue or day'
      return x.amount === 12.4 ? true : '£' + x.amount
    },
    reference: ctx => [{ tool: 'add_expense', input: { venue: ctx.venue.name, description: 'Milk', amount: 12.4 } }],
  },
]
