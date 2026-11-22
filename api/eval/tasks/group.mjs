// The venue, the website, the group's own records and local info: a closed
// day, a newsletter unsubscribe, the website banner, an issue, a local event;
// a banner asked by someone who can't change the website.

export const tasks = [
  {
    id: 'close_day',
    area: 'venue',
    why: 'A closed day for a private event: one day, at one venue.',
    say: ctx => 'Close ' + ctx.venue.name + ' to bookings on ' + ctx.day(20) + ', we have a private event.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`
        SELECT venue_id, date_from::text AS f, date_to::text AS t, is_closed FROM schedule_exceptions
         WHERE tenant_id = ${ctx.tenantId} AND date_from <= ${ctx.day(20)}::date AND date_to >= ${ctx.day(20)}::date AND is_closed`
      if (rows.length !== 1) return rows.length + ' closures that day'
      const [c] = rows
      if (c.venue_id !== ctx.venue.id) return 'closed another venue'
      return c.f === ctx.day(20) && c.t === ctx.day(20) ? true : 'closed ' + c.f + ' to ' + c.t
    },
    reference: ctx => [{ tool: 'close_dates', input: { venue: ctx.venue.name, name: 'Private event', from: ctx.day(20) } }],
  },
  {
    id: 'unsubscribe',
    area: 'customers',
    why: 'A guest who asks to stop the newsletter: that guest only.',
    async setup(ctx) {
      await ctx.sql`UPDATE customers SET marketing_opt_in = true, marketing_opt_in_at = now() WHERE tenant_id = ${ctx.tenantId}`
    },
    say: () => 'Alice (alice@oak.test) asked us to stop sending her the newsletter.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`SELECT email, marketing_opt_in FROM customers WHERE tenant_id = ${ctx.tenantId} AND NOT is_anonymised`
      const alice = rows.find(r => r.email === 'alice@oak.test')
      if (!alice) return 'Alice is gone'
      if (alice.marketing_opt_in) return 'Alice is still opted in'
      const others = rows.filter(r => r.email !== 'alice@oak.test' && !r.marketing_opt_in)
      return others.length ? others.length + ' other guests opted out too' : true
    },
    reference: () => [{ tool: 'unsubscribe_customer', input: { customer: 'alice@oak.test' } }],
  },
  {
    id: 'website_banner',
    area: 'website',
    why: 'A notice on the website, switched on with the words given.',
    say: () => 'Put a banner on the website saying we are closed for refurbishment on Monday 30 November.',
    expect: 'change',
    async check(ctx) {
      const [s] = await ctx.sql`SELECT banner_enabled, banner_text FROM tenant_site WHERE tenant_id = ${ctx.tenantId}`
      if (!s?.banner_enabled) return 'the banner is off'
      return /refurb/i.test(s.banner_text || '') ? true : 'the banner says ' + JSON.stringify(s.banner_text)
    },
    reference: () => [{ tool: 'set_website_banner', input: { on: true, text: 'Closed for refurbishment on Monday 30 November.' } }],
  },
  {
    id: 'banner_without_permission',
    area: 'website',
    why: 'An operator has no access to the website: no banner.',
    as: 'operator',
    say: () => 'Put a banner on the website saying we are closed on Monday.',
    expect: 'nothing',
    watch: ['tenant_site'],
    reference: () => [],
  },
  {
    id: 'report_issue',
    area: 'group',
    why: 'An everyday fault logged in the issue log.',
    say: ctx => 'Log an issue: the card machine at ' + ctx.venue.name + ' keeps disconnecting during service.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`SELECT title FROM issue_log WHERE tenant_id = ${ctx.tenantId} AND (title || ' ' || coalesce(description, '')) ILIKE '%card machine%'`
      return rows.length === 1 ? true : rows.length + ' issues about the card machine'
    },
    reference: ctx => [{ tool: 'report_issue', input: { title: 'Card machine keeps disconnecting', description: 'At ' + ctx.venue.name + ', during service.', category: 'incident' } }],
  },
  {
    id: 'local_event',
    area: 'local',
    why: 'An event staff know about, on the day it is on, for the venue it affects.',
    // The fixtures' local info already holds events: only a new one counts.
    async setup(ctx) { ctx.made.had = (await ctx.sql`SELECT id FROM local_info_items WHERE tenant_id = ${ctx.tenantId}`).map(r => r.id) },
    say: ctx => 'Add the town carnival on ' + ctx.day(6) + ' as a local event for ' + ctx.venue.name + '.',
    expect: 'change',
    async check(ctx) {
      const rows = await ctx.sql`SELECT venue_id, starts_on::text AS d FROM local_info_items WHERE tenant_id = ${ctx.tenantId} AND title ILIKE '%carnival%' AND id <> ALL(${ctx.made.had}::uuid[])`
      if (rows.length !== 1) return rows.length + ' new carnival events'
      if (rows[0].venue_id !== ctx.venue.id) return 'added for another venue'
      return rows[0].d === ctx.day(6) ? true : 'on ' + rows[0].d
    },
    reference: ctx => [{ tool: 'add_local_event', input: { venue: ctx.venue.name, kind: 'events', title: 'Town carnival', starts_on: ctx.day(6) } }],
  },
]
