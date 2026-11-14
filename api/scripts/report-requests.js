// api/scripts/report-requests.js
//
// About 80 report requests the way people type them, each with what a right
// answer must contain (docs/REPORTS.md 10, "Checking it works"). Run them
// against the live model with scripts/report-smart-check.js before each
// release of the smart builder; the API tests only check the plumbing,
// against a stand-in Claude.
//
// A request may name things of the group it runs for: {venue} and {venue2}
// (its first two open venues), {dish} (the dish sold most on its tills,
// else one on its menus) and {server} (who took the most checks). A
// request that needs one the group hasn't got is skipped.
//
// What an answer must contain (`expect`), every part optional:
//   subject   a subject key, or a list of keys any of which will do
//   values    figures the report must show: a measure's key, or a field's
//             key for a figure worked out from a field (a total, an
//             average). An entry that is a list means any one of those.
//   rows      what it is grouped or listed by, as 'path' or 'path:bucket'
//             ('server', 'date:weekday', 'opened_at:hour'): a path matches
//             itself and anything under it ('server' matches server.name);
//             'date:day' also matches a date with no bucket. A list = any.
//   period    a named period ('last_month'), { relative, n } or 'dates'
//             (a range of dates); a list = any
//   compare   'previous_period' | 'last_year'
//   kind      'list' | 'summary' | 'matrix', or a list of them
//   limit     { top: n } | { bottom: n } (true for any n)
//   view      a chart kind, or a list of them
//   filters   [{ field: path or list, value?: words found in its value }]
//   venues    ['{venue}', ...]: exactly these venues
//   couldnt   true, or a pattern: Pepper says what it couldn't do
//   question  true: Pepper asks something
//   none      true: no report (nothing the reports hold can show it)
//   noneOr    true: no report, or a report with a couldnt line
// `then` is a change asked of the report afterwards ("only weekends"), with
// its own `expect`; `look` is a note for the person reading the results.

export const REQUESTS = [
  // ── Till: sales ──
  { area: 'till', request: 'Net sales by day last week',
    expect: { subject: ['till.checks', 'till.lines'], values: ['net_sales'], rows: ['date:day'], period: 'last_week' },
    then: { request: 'split it by venue', expect: { values: ['net_sales'], rows: ['date:day', 'venue'] } } },
  { area: 'till', request: 'Net sales by dish for last month at {venue}, top 20',
    expect: { subject: 'till.lines', values: ['net_sales'], rows: [['name', 'item']], period: 'last_month', limit: { top: 20 }, venues: ['{venue}'] },
    then: { request: 'only weekends', expect: { values: ['net_sales'], limit: { top: 20 }, filters: [{ field: ['date', 'sent_at'] }] } } },
  { area: 'till', request: 'How many covers did we do each day this week',
    expect: { subject: 'till.checks', values: ['guests'], rows: ['date:day'], period: ['this_week', 'week_to_date'] } },
  { area: 'till', request: 'Average spend per guest by week this quarter',
    expect: { subject: 'till.checks', values: ['per_guest'], rows: ['date:week'], period: ['this_quarter', 'quarter_to_date'] } },
  { area: 'till', request: 'Sales by hour of the day yesterday',
    expect: { subject: ['till.checks', 'till.lines'], values: [['net_sales', 'total_sales', 'gross_sales']], rows: [['opened_at:hour', 'closed_at:hour', 'sent_at:hour']], period: 'yesterday' } },
  { area: 'till', request: 'Which server took the most money this month',
    expect: { subject: 'till.checks', values: [['net_sales', 'total_sales', 'gross_sales']], rows: ['server'], period: ['this_month', 'month_to_date'] },
    look: 'Best sorted by the figure, highest first, or the top one only.' },
  { area: 'till', request: 'Top 10 dishes by quantity sold last week',
    expect: { subject: 'till.lines', values: ['qty_sold'], rows: [['name', 'item']], period: 'last_week', limit: { top: 10 } } },
  { area: 'till', request: 'Sales by menu section this month compared with last month',
    expect: { subject: 'till.lines', values: [['net_sales', 'gross_sales']], rows: ['section'], period: ['this_month', 'month_to_date'], compare: 'previous_period' } },
  { area: 'till', request: 'Gross sales, discounts and net sales by week this year',
    expect: { subject: 'till.checks', values: ['gross_sales', 'discounts', 'net_sales'], rows: ['date:week'], period: ['this_year', 'year_to_date'] } },
  { area: 'till', request: 'Average check by day of the week over the last 8 weeks',
    expect: { subject: 'till.checks', values: ['average_check'], rows: ['date:weekday'], period: [{ relative: 'last_n_days', n: 56 }, 'dates'] } },
  { area: 'till', request: 'Busiest hours on Saturdays this month',
    expect: { subject: 'till.checks', values: [['checks', 'guests', 'net_sales', 'total_sales']], rows: [['opened_at:hour', 'closed_at:hour']], filters: [{ field: ['date', 'opened_at', 'closed_at'] }] },
    look: 'The filter should hold the days to Saturdays (a day of the week filter).' },
  { area: 'till', request: 'Sales by venue this week compared with the same week last year',
    expect: { subject: 'till.checks', values: [['net_sales', 'total_sales']], rows: ['venue'], period: ['this_week', 'week_to_date'], compare: 'last_year' } },
  { area: 'till', request: 'Net sales by revenue stream and order type last month',
    expect: { subject: 'till.checks', values: ['net_sales'], rows: ['stream', 'order_type'], period: 'last_month' } },
  { area: 'till', request: 'Eat in versus takeaway sales this week',
    expect: { subject: 'till.checks', values: [['net_sales', 'total_sales']], rows: ['order_type'], period: ['this_week', 'week_to_date'] },
    look: 'Order types are each group\'s own: eat in and takeaway are their names.' },
  { area: 'till', request: 'How much {dish} did we sell each week this quarter',
    expect: { subject: 'till.lines', values: [['qty_sold', 'net_sales']], rows: ['date:week'], period: ['this_quarter', 'quarter_to_date'], filters: [{ field: ['name', 'item'], value: '{dish}' }] } },
  { area: 'till', request: 'Which dishes sold fewer than 5 last month',
    expect: { subject: 'till.lines', values: ['qty_sold'], rows: [['name', 'item']], period: 'last_month' },
    look: 'A filter can\'t be on a figure: expect the fewest first (or a bottom few) and a line saying "fewer than 5" couldn\'t be a filter.' },
  { area: 'till', request: 'Sales per guest by server this month',
    expect: { subject: 'till.checks', values: ['per_guest'], rows: ['server'], period: ['this_month', 'month_to_date'] } },
  { area: 'till', request: 'How long do tables stay on average, by day of the week, last month',
    expect: { subject: 'till.checks', values: ['time_open'], rows: ['date:weekday'], period: 'last_month' },
    look: 'Ideally only table service (a filter on Service).' },
  { area: 'till', request: 'What did {server} sell each day this week',
    expect: { subject: ['till.checks', 'till.lines'], values: [['net_sales', 'total_sales', 'qty_sold']], rows: ['date:day'], filters: [{ field: ['server', 'added_by'], value: '{server}' }] } },
  { area: 'till', request: 'Dishes sold by section and day over the last 7 days, as a table across',
    expect: { subject: 'till.lines', kind: 'matrix', values: [['qty_sold', 'net_sales']], rows: ['section', 'date:day'], period: [{ relative: 'last_n_days', n: 7 }, 'last_week'] } },
  { area: 'till', request: 'Show me net sales by day last month as a line chart',
    expect: { subject: ['till.checks', 'till.lines'], values: ['net_sales'], rows: ['date:day'], period: 'last_month', view: 'line' } },
  { area: 'till', request: 'Takings by tender as a pie chart for last week',
    expect: { subject: 'till.payments', values: [['takings', 'taken', 'net_taken']], rows: ['tender'], period: 'last_week', view: ['parts', 'bar'] },
    look: 'There is no pie: Parts of a whole is the nearest.' },
  { area: 'till', request: 'Net sales at {venue} and {venue2} by week this month', needs: ['venue2'],
    expect: { subject: 'till.checks', values: ['net_sales'], rows: ['venue', 'date:week'], venues: ['{venue}', '{venue2}'] } },
  { area: 'till', request: 'Checks still open right now',
    expect: { subject: 'till.checks', period: ['today', 'any'] },
    look: 'Either the Checks still open figure or a list of checks whose status is open.' },
  { area: 'till', request: 'Z report figures for yesterday',
    expect: { subject: ['till.days', 'till.checks', 'till.payments'], period: 'yesterday' } },
  { area: 'till', request: 'Sales',
    expect: { values: [['net_sales', 'total_sales', 'sales', 'gross_sales']] },
    look: 'Too vague to be sure: a sales report with what Pepper assumed (or a question).' },

  // ── Till: payments, discounts, charges, voids, VAT, cash ──
  { area: 'till', request: 'Card versus cash takings by day this week',
    expect: { subject: 'till.payments', values: [['takings', 'taken', 'net_taken']], rows: ['date:day', 'tender'], period: ['this_week', 'week_to_date'] } },
  { area: 'till', request: 'Tips by server last month',
    expect: { subject: ['till.payments', 'till.checks'], values: [['tips', 'tip']], rows: [['server', 'staff']], period: 'last_month' } },
  { area: 'till', request: 'Refunds this month with who approved them',
    expect: { subject: 'till.payments', kind: 'list', rows: ['approved_by'], filters: [{ field: 'kind', value: 'refund' }], period: ['this_month', 'month_to_date'] } },
  { area: 'till', request: 'Discounts given this week by who gave them',
    expect: { subject: 'till.discounts', values: [['amount_given', 'times_given']], rows: ['applied_by'], period: ['this_week', 'week_to_date'] } },
  { area: 'till', request: 'Service charge taken each day last week',
    expect: { subject: ['till.charges', 'till.checks'], values: [['amount_charged', 'charges']], rows: ['date:day'], period: 'last_week' } },
  { area: 'till', request: 'How often was the optional service charge taken off this month',
    expect: { subject: 'till.charges', values: [['times_removed', 'amount_removed']], period: ['this_month', 'month_to_date'] } },
  { area: 'till', request: 'List every void yesterday with the reason and who did it',
    expect: { subject: 'till.voids', kind: 'list', rows: ['reason', 'voided_by'], period: 'yesterday' } },
  { area: 'till', request: 'Voids by reason last month',
    expect: { subject: 'till.voids', values: [['value_voided', 'voids', 'qty_voided']], rows: ['reason'], period: 'last_month' } },
  { area: 'till', request: 'Cancelled orders this week and why',
    expect: { subject: 'till.cancelled', rows: ['reason'], period: ['this_week', 'week_to_date'] } },
  { area: 'till', request: 'VAT by rate for last quarter',
    expect: { subject: 'till.vat', values: ['vat_total'], rows: ['rate'], period: 'last_quarter' } },
  { area: 'till', request: 'Cash over or short by day last month',
    expect: { subject: ['till.days', 'cash.days'], values: [['difference_total', 'cash_difference', 'variance_total', 'variance']], rows: ['date:day'], period: 'last_month' },
    look: 'Either the till\'s cash count at the close of day (Till reports) or the Cash Recon variance will do.' },

  // ── Online ordering ──
  { area: 'online', request: 'Online orders by day last week',
    expect: { subject: ['online.orders', 'online.sales'], values: ['orders'], rows: ['date:day'], period: 'last_week' },
    then: { request: 'add net sales', expect: { values: ['orders', 'net_sales'], rows: ['date:day'] } } },
  { area: 'online', request: 'Online net sales by day this month including GloriaFood',
    expect: { subject: 'online.sales', values: ['net_sales'], rows: ['date:day'], period: ['this_month', 'month_to_date'] } },
  { area: 'online', request: 'Average time from accepted to ready for online orders by hour this week',
    expect: { subject: 'online.orders', values: [['average_ready', 'time_to_ready']], rows: [['placed_at:hour', 'accepted_at:hour', 'ready_at:hour']], period: ['this_week', 'week_to_date'] } },
  { area: 'online', request: 'Top 10 dishes ordered online last month',
    expect: { subject: 'online.items', values: [['qty_sold', 'net_sales']], rows: [['name', 'item']], period: 'last_month', limit: { top: 10 } } },
  { area: 'online', request: 'Which promotions were used most online this month',
    expect: { subject: 'online.promotions', values: [['times_used', 'discount_given', 'orders']], rows: ['name'], period: ['this_month', 'month_to_date'] } },
  { area: 'online', request: 'Online orders rejected or cancelled last week, with the reason',
    expect: { subject: 'online.orders', kind: 'list', rows: ['cancel_reason'], filters: [{ field: ['status', 'counted'] }], period: 'last_week' } },
  { area: 'online', request: 'Platform fees by week this quarter',
    expect: { subject: 'online.orders', values: ['platform_fees'], rows: ['date:week'], period: ['this_quarter', 'quarter_to_date'] } },
  { area: 'online', request: 'Collection versus delivery online orders this month',
    expect: { subject: ['online.orders', 'online.sales'], values: ['orders'], rows: [['fulfilment', 'type']], period: ['this_month', 'month_to_date'] } },
  { area: 'online', request: 'Online tips by day last week',
    expect: { subject: ['online.orders', 'online.sales'], values: ['tips'], rows: ['date:day'], period: 'last_week' } },
  { area: 'online', request: 'Average online order value by day of the week over the last 30 days',
    expect: { subject: ['online.orders', 'online.sales'], values: ['average_order'], rows: ['date:weekday'], period: [{ relative: 'last_n_days', n: 30 }, 'dates'] } },

  // ── Bookings ──
  { area: 'bookings', request: 'Bookings and covers by day next week',
    expect: { subject: 'bookings.bookings', values: [['bookings', 'expected'], 'guests'], rows: ['date:day'], period: 'next_week' } },
  { area: 'bookings', request: 'No-show rate by day of the week this year',
    expect: { subject: 'bookings.bookings', values: ['no_show_rate'], rows: ['date:weekday'], period: ['this_year', 'year_to_date'] } },
  { area: 'bookings', request: 'Bookings made online versus by staff last month',
    expect: { subject: 'bookings.bookings', values: [['bookings', 'made']], rows: ['source'], period: 'last_month' } },
  { area: 'bookings', request: 'How far ahead do people book, by party size',
    expect: { subject: 'bookings.bookings', values: [['average_lead', 'lead_days']], rows: ['party_size'] } },
  { area: 'bookings', request: 'List tomorrow\'s bookings with the guest\'s name, party size and time',
    expect: { subject: 'bookings.bookings', kind: 'list', rows: ['guest_name', ['covers', 'party_size'], 'starts_at'], period: 'tomorrow' } },
  { area: 'bookings', request: 'Parties of 8 or more booked for next month',
    expect: { subject: 'bookings.bookings', filters: [{ field: ['covers', 'party_size'] }], period: 'next_month' } },
  { area: 'bookings', request: 'Cancelled bookings by week this quarter',
    expect: { subject: 'bookings.bookings', values: [['cancelled', 'bookings']], rows: ['date:week'], period: ['this_quarter', 'quarter_to_date'] } },
  { area: 'bookings', request: 'Deposits taken and refunded last month',
    expect: { subject: 'bookings.deposits', values: ['taken', 'refunded_total'], period: 'last_month' } },
  { area: 'bookings', request: 'New versus returning guests in bookings this month',
    expect: { subject: 'bookings.bookings', values: [['bookings', 'guests']], rows: ['guest_kind'], period: ['this_month', 'month_to_date'] } },

  // ── Customers and menus ──
  { area: 'other', request: 'How many people joined the newsletter each month this year',
    expect: { subject: 'guests.customers', values: [['subscribers', 'customers']], rows: [['newsletter_since:month', 'created_at:month']] } },
  { area: 'other', request: 'Dishes on the menu without a photo',
    expect: { subject: 'menu.dishes', filters: [{ field: 'has_photo' }] } },

  // ── Cash reconciliation ──
  { area: 'cash', request: 'Cash variance by day last week',
    expect: { subject: 'cash.days', values: [['variance_total', 'variance']], rows: ['date:day'], period: 'last_week' } },
  { area: 'cash', request: 'Which days was the cash short last month',
    expect: { subject: 'cash.days', period: 'last_month' },
    look: 'The short days: a list filtered on the variance below 0 (or the balance Short), or the days short counted by date.' },
  { area: 'cash', request: 'Petty cash spend by category this month',
    expect: { subject: 'cash.expenses', values: [['cash_spend', 'spend']], rows: [['category_name', 'category']], period: ['this_month', 'month_to_date'] } },
  { area: 'cash', request: 'Wages paid in cash and by bank by week this quarter',
    expect: { subject: 'cash.wages', values: ['cash_total', 'bank_total'], rows: ['date:week'], period: ['this_quarter', 'quarter_to_date'] } },
  { area: 'cash', request: 'Takings by payment channel last month',
    expect: { subject: ['cash.takings', 'till.payments'], values: [['takings_counted', 'amount_total', 'takings']], rows: [['channel', 'tender']], period: 'last_month' },
    look: 'Cash Recon\'s payment channels, or the till\'s tenders.' },

  // ── Kitchen and kiosks ──
  { area: 'kitchen', request: 'Average ticket time by station last week',
    expect: { subject: 'kitchen.tickets', values: ['average_time'], rows: [['station_name', 'station']], period: 'last_week' } },
  { area: 'kitchen', request: 'What are the most common reasons for remakes this month',
    expect: { subject: 'kitchen.remakes', values: ['remakes'], rows: ['reason'], period: ['this_month', 'month_to_date'] } },
  { area: 'kitchen', request: 'How many tickets were late at each station yesterday',
    expect: { subject: 'kitchen.tickets', values: ['late_count'], rows: [['station_name', 'station']], period: 'yesterday' } },
  { area: 'kiosks', request: 'Kiosk orders and sales by day this week',
    expect: { subject: 'kiosks.visits', values: ['orders', 'sales'], rows: ['date:day'], period: ['this_week', 'week_to_date'] } },
  { area: 'kiosks', request: 'Where do people give up on the kiosk',
    expect: { subject: 'kiosks.visits', values: ['gave_up'], rows: [['last_screen', 'furthest']] } },

  // ── Loyalty ──
  { area: 'loyalty', request: 'Loyalty points earned and spent by month this year',
    expect: { subject: 'loyalty.ledger', values: ['earned', 'spent'], rows: ['date:month'], period: ['this_year', 'year_to_date'] } },
  { area: 'loyalty', request: 'Which loyalty rewards were used most last month',
    expect: { subject: 'loyalty.redemptions', values: ['used'], rows: [['name', 'reward']], period: 'last_month' } },
  { area: 'loyalty', request: 'How many people joined the loyalty programme each week',
    expect: { subject: 'loyalty.members', values: [['joined', 'members']], rows: ['date:week'] } },
  { area: 'loyalty', request: 'Which members hold the most points',
    expect: { subject: 'loyalty.members', period: 'any' },
    look: 'Points held now by everyone, whenever they joined (no period).' },

  // ── Purchasing ──
  { area: 'purchasing', request: 'How much did we spend with each supplier last month',
    expect: { subject: ['purchasing.orders', 'purchasing.order_lines'], values: [['spend', 'goods']], rows: [['supplier', 'order.supplier']], period: 'last_month' } },
  { area: 'purchasing', request: 'Which suppliers delivered short most often this year',
    expect: { subject: 'purchasing.order_lines', values: [['short', 'problems']], rows: ['order.supplier'], period: ['this_year', 'year_to_date'] } },
  { area: 'purchasing', request: 'Spend by inventory category this month',
    expect: { subject: 'purchasing.order_lines', values: [['spend', 'goods']], rows: [['category_name', 'item.category']], period: ['this_month', 'month_to_date'] } },

  // ── Food safety and H&S ──
  { area: 'safety', request: 'Fridge readings out of range last week',
    expect: { subject: 'safety.fridge_checks', period: 'last_week' } },
  { area: 'safety', request: 'Checklists done at each venue this month',
    expect: { subject: 'safety.checklists', values: ['done'], rows: ['venue'], period: ['this_month', 'month_to_date'] } },
  { area: 'safety', request: 'Open H&S actions that are overdue',
    expect: { subject: 'safety.actions', period: 'any' },
    look: 'Every action still open, whatever day it was logged (no period).' },

  // ── What the reports can't show (yet) ──
  { area: 'other', request: 'Gross profit margin by dish last month',
    expect: { couldnt: true },
    look: 'No recipe costs: say so, perhaps with sales by dish.' },
  { area: 'other', request: 'Labour cost as a share of sales by week this quarter',
    expect: { couldnt: true },
    look: 'Rota pay isn\'t in the reports yet (phase 3): say so.' },
  { area: 'other', request: 'Fridge checks missed by day last month',
    expect: { noneOr: true },
    look: 'Readings are in the reports, checks missed aren\'t yet: none, or readings with a line saying so.' },
  { area: 'other', request: 'How much chicken do we have in stock',
    expect: { noneOr: true } },
  { area: 'till', request: 'Net sales last week at Atlantis',
    expect: { values: ['net_sales'], period: 'last_week', couldnt: /Atlantis/i },
    look: 'No venue called Atlantis: every venue, with a line saying so (or a question).' },
]

// ── The group's own names for {venue}, {venue2}, {dish} and {server} ──

const FILLS = ['venue', 'venue2', 'dish', 'server']
export const fillsOf = text => FILLS.filter(k => String(text).includes('{' + k + '}'))
export const fill = (text, names) => String(text).replace(/\{(venue2|venue|dish|server)\}/g, (_, k) => names[k] ?? '{' + k + '}')

// ── Judging an answer ──

const list = x => (Array.isArray(x) ? x : x == null ? [] : [x])
const lower = s => String(s ?? '').toLowerCase()

/** The filters of a definition, inside any / all / has too. */
function allFilters(filters) {
  const out = []
  for (const f of list(filters)) {
    if (!f || typeof f !== 'object') continue
    if (f.any || f.all) out.push(...allFilters(f.any || f.all))
    else if (f.has) out.push(...allFilters(f.where).map(x => ({ ...x, field: f.has + '.' + x.field })))
    else out.push(f)
  }
  return out
}

const pathMatches = (path, want) => path === want || String(path).startsWith(want + '.')

function rowMatches(g, want) {
  const [path, bucket] = String(want).split(':')
  if (!pathMatches(g.field, path)) return false
  if (!bucket) return true
  return g.bucket === bucket || (bucket === 'day' && !g.bucket)
}

function valueMatches(v, want) {
  if (v.measure === want) return true
  const field = v.field || v.of
  return !!field && String(field).split('.').pop() === want
}

function periodMatches(p, want) {
  if (want === 'any') return !p
  if (!p) return false
  if (want === 'dates') return !p.relative && !!p.from
  if (typeof want === 'string') return p.relative === want
  return p.relative === want.relative && (want.n == null || p.n === want.n)
}

const paramDefault = (spec, type) => (spec.params || []).find(x => x.type === type)?.default

/**
 * What an answer is missing, as sentences (none = it passes). `names` holds
 * the group's names for the fills; `venueIds` maps a venue's name to its id.
 */
export function checkAnswer(expect, out, { names = {}, venueIds = {} } = {}) {
  const e = expect || {}
  const spec = out?.spec || null
  const misses = []
  if (e.none) return spec ? ['Expected no report, got one about ' + spec.subject] : []
  if (e.noneOr) {
    if (spec && !list(out.couldnt).length) misses.push('Expected no report, or one saying what it couldn\'t do')
    return misses
  }
  if (e.couldnt) {
    const lines = list(out?.couldnt)
    const ok = e.couldnt instanceof RegExp ? lines.some(l => e.couldnt.test(l)) || list(out?.questions).length > 0 : lines.length > 0
    if (!ok) misses.push('Expected a line saying what it couldn\'t do' + (e.couldnt instanceof RegExp ? ' (' + e.couldnt.source + ')' : ''))
  }
  if (e.question && !list(out?.questions).length) misses.push('Expected a question')
  const needsReport = ['subject', 'values', 'rows', 'period', 'compare', 'kind', 'limit', 'view', 'filters', 'venues'].some(k => e[k] != null)
  if (!needsReport) return misses
  if (!spec) return [...misses, 'No report' + (out?.problem ? ': ' + out.problem : list(out?.couldnt).length ? ' (' + list(out.couldnt).join('; ') + ')' : '')]
  if (out.problem) misses.push('It didn\'t run: ' + out.problem)

  if (e.subject && !list(e.subject).includes(spec.subject)) misses.push('About ' + spec.subject + ', not ' + list(e.subject).join(' or '))
  if (e.kind && !list(e.kind).includes(spec.kind)) misses.push('A ' + spec.kind + ', not ' + list(e.kind).join(' or '))

  const values = list(spec.values)
  for (const want of list(e.values)) {
    const any = list(want)
    if (!values.some(v => any.some(w => valueMatches(v, w)))) misses.push('No figure ' + any.join(' or '))
  }
  const groups = [...list(spec.rows), ...list(spec.columns)]
  for (const want of list(e.rows)) {
    const any = list(want)
    if (!groups.some(g => any.some(w => rowMatches(g, w)))) misses.push('Not by ' + any.join(' or ') + ' (has ' + (groups.map(g => g.field + (g.bucket ? ':' + g.bucket : '')).join(', ') || 'nothing') + ')')
  }
  if (e.period != null) {
    const p = paramDefault(spec, 'period')
    if (!list(e.period).some(w => periodMatches(p, w))) misses.push('Period ' + JSON.stringify(p ?? null) + ', not ' + list(e.period).map(w => typeof w === 'string' ? w : JSON.stringify(w)).join(' or '))
  }
  if (e.compare && spec.compare?.with !== e.compare) misses.push('Compared with ' + (spec.compare?.with || 'nothing') + ', not ' + e.compare)
  if (e.limit) {
    const which = 'top' in e.limit ? 'top' : 'bottom'
    const n = spec.limit?.[which]
    if (!n || (e.limit[which] !== true && n !== e.limit[which])) misses.push('Not the ' + which + ' ' + (e.limit[which] === true ? 'few' : e.limit[which]) + ' (' + JSON.stringify(spec.limit ?? null) + ')')
  }
  if (e.view && !list(e.view).includes(spec.view?.kind)) misses.push('Drawn as ' + (spec.view?.kind || 'a table') + ', not ' + list(e.view).join(' or '))
  if (e.filters) {
    const filters = allFilters(spec.filters)
    for (const want of e.filters) {
      const fields = list(want.field)
      const words = want.value ? lower(fill(want.value, names)) : null
      const hit = filters.some(f => {
        if (!fields.some(w => pathMatches(f.field, w))) return false
        if (!words) return true
        const value = f.param ? (spec.params || []).find(x => x.key === f.param)?.default : f.value
        return list(value).some(v => lower(v).includes(words) || words.includes(lower(v)))
      })
      if (!hit) misses.push('No filter on ' + fields.join(' or ') + (words ? ' for "' + words + '"' : ''))
    }
  }
  if (e.venues) {
    const want = e.venues.map(v => venueIds[fill(v, names)]).filter(Boolean).sort()
    const got = paramDefault(spec, 'venues')
    if (!Array.isArray(got) || got.slice().sort().join() !== want.join()) misses.push('Venues ' + JSON.stringify(got ?? 'all') + ', not ' + e.venues.map(v => fill(v, names)).join(' and '))
  }
  return misses
}

// ── Checking the list against the catalogue (api/test/reports-smart.test.mjs) ──

/** What in the list names something the catalogue hasn't got, as sentences. */
export function listProblems(catalogue, requests = REQUESTS) {
  const problems = []
  const BUCKETS = ['day', 'week', 'month', 'quarter', 'year', 'weekday', 'hour']
  const firstOk = (subjects, path) => subjects.some(s => {
    const sub = catalogue.subjects[s]
    if (!sub) return false
    const head = String(path).split('.')[0]
    return !!(sub.fields?.[head] || sub.links?.[head])
  })
  requests.forEach((r, i) => {
    const at = '#' + (i + 1) + ' "' + r.request + '"'
    for (const k of fillsOf(r.request)) if (k === 'venue2' && !list(r.needs).includes('venue2')) problems.push(at + ' names {venue2} without needs')
    for (const part of [r.expect, r.then?.expect]) {
      if (!part) continue
      const subjects = list(part.subject || r.expect.subject)
      for (const s of subjects) if (!catalogue.subjects[s]) problems.push(at + ': no subject ' + s)
      if (!subjects.length) continue
      for (const want of list(part.values)) for (const w of list(want)) {
        if (!subjects.some(s => catalogue.subjects[s]?.measures?.[w] || catalogue.subjects[s]?.fields?.[w])) problems.push(at + ': no figure or field ' + w)
      }
      for (const want of list(part.rows)) for (const w of list(want)) {
        const [path, bucket] = String(w).split(':')
        if (!firstOk(subjects, path)) problems.push(at + ': no field or link ' + path)
        if (bucket && !BUCKETS.includes(bucket)) problems.push(at + ': no bucket ' + bucket)
      }
      for (const f of list(part.filters)) for (const w of list(f.field)) if (!firstOk(subjects, w)) problems.push(at + ': no field or link ' + w + ' to filter')
    }
  })
  return problems
}
