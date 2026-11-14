// src/reports/catalogue/cash.js
//
// Cash reconciliation in the report catalogue (docs/REPORTS.md 20, phase
// 3b): each day's and each week's figures, worked out for every run by the
// Cash Recon page's own rule (shared/cashRecon.js, through reports/work/),
// and what was typed into each day: income, takings, service charges and
// expenses, with the weeks' wage lists.
//
// The days' and weeks' figures read each venue's Cash Recon set-up as it is
// now, as the page does: an income source switched off or left out of
// reconciliation, a channel or a service charge source switched off, count
// nothing. The typed entries keep every amount, and their figures say which
// count. Cash Recon keeps money in pounds.

import { subject, text, number, money, percent, yesno, choice, date, moment, sum, avg, count, one, many } from './define.js'

const MODULE = 'cash_recon'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', ...opts })
const total = (src, opts = {}) => sum(src, { type: 'money', unit: 'pounds', ...opts })

const STATUS = { draft: 'Not submitted', submitted: 'Submitted' }
const BALANCE = "(CASE WHEN {t}.variance < 0 THEN 'short' WHEN {t}.variance > 0 THEN 'over' ELSE 'balanced' END)"
const BALANCES = { short: 'Short', over: 'Over', balanced: 'Balanced' }
const EFFECTS = { none: 'No effect', add: 'Added', subtract: 'Taken off' }

// What counts in the reconciliation, as reconSetup() in shared/cashRecon.js has it.
const INCOME_COUNTS = '({source}.is_active AND NOT COALESCE({source}.exclude_from_recon, false))'
const CHANNEL_COUNTS = '{channel}.is_active'
const CASH_CHANNEL = '({channel}.is_active AND COALESCE({channel}.counts_as_cash, true))'
const SC_COUNTS = '{source}.is_active'
const effect = col => "(CASE {source}." + col + " WHEN 'add' THEN {t}.amount WHEN 'subtract' THEN -{t}.amount ELSE 0 END)"
const SC_ADJUSTMENT = '(' + effect('takings_effect') + ' + ' + effect('income_effect') + ')'

// A wage entry: what is paid by bank comes off first, the rest is due in cash
// (cashDueOf() / unpaidOf() on the Wages page).
const BANK = 'COALESCE({t}.bank_amount, 0)'
const CASH_PAID = 'COALESCE({t}.cash_amount, 0)'
const UNPAID = 'GREATEST(GREATEST(COALESCE({t}.total, 0) - ' + BANK + ', 0) - ' + CASH_PAID + ', 0)'

// The tables the Cash days and Cash weeks rows are worked out from.
const WORK_TABLES = [
  'cash_daily_reports', 'cash_income_entries', 'cash_takings_entries', 'cash_sc_entries', 'cash_expenses',
  'cash_wage_reports', 'cash_wage_entries', 'cash_income_sources', 'cash_payment_channels', 'cash_sc_sources',
]

/** The figures a Cash day and a Cash week both have. */
const figureFields = period => ({
  income: pounds('income', { label: 'Income', about: 'Income from the sources that count in reconciliation.' }),
  income_left_out: pounds('income_left_out', { label: 'Income left out', about: 'Income typed against sources left out of reconciliation (vouchers sold, say).' }),
  takings: pounds('takings', { label: 'Takings', about: 'What the payment channels took.' }),
  cash_takings: pounds('cash_takings', { label: 'Cash takings', about: 'Takings on the channels that count as cash.' }),
  service_charges: pounds('service_charges', { label: 'Service charges and tips' }),
  sc_adjustment: pounds('sc_adjustment', { label: 'Service charge adjustment', about: 'What the service charge sources add to or take off what is expected, each as its source is set up.' }),
  expenses: pounds('expenses', { label: 'Cash expenses', about: 'Expenses paid out of the till.' }),
  card_expenses: pounds('card_expenses', { label: 'Card expenses', about: 'Expenses paid by card: kept for their receipts, never in the reconciliation.' }),
  wages_paid: pounds('wages_paid', { label: 'Cash wages paid', about: 'Cash wages paid out of the till ' + period + '.' }),
  expected: pounds('expected', { label: 'Expected', about: 'Income and the service charge adjustment.' }),
  counted: pounds('counted', { label: 'Counted', about: 'Takings and the cash paid out of the till.' }),
  variance: pounds('variance', { label: 'Variance', about: 'Counted less expected: a minus is short.' }),
  balance: choice({ sql: BALANCE }, BALANCES, { label: 'Short or over' }),
})

/** The totals a Cash day and a Cash week both have. */
const figureMeasures = what => ({
  income_total: total('income', { label: 'Income', about: 'Income from the sources that count in reconciliation.' }),
  income_left_out_total: total('income_left_out', { label: 'Income left out', about: 'Income typed against sources left out of reconciliation.' }),
  takings_total: total('takings', { label: 'Takings' }),
  cash_takings_total: total('cash_takings', { label: 'Cash takings' }),
  service_charges_total: total('service_charges', { label: 'Service charges and tips' }),
  sc_adjustment_total: total('sc_adjustment', { label: 'Service charge adjustment' }),
  expenses_total: total('expenses', { label: 'Cash expenses' }),
  card_expenses_total: total('card_expenses', { label: 'Card expenses' }),
  wages_paid_total: total('wages_paid', { label: 'Cash wages paid' }),
  expected_total: total('expected', { label: 'Expected' }),
  counted_total: total('counted', { label: 'Counted' }),
  variance_total: total('variance', { label: 'Variance', about: 'Counted less expected, added up: a minus is short.' }),
  shortfall: total('variance', { label: 'Shortfall', where: '{t}.variance < 0', about: 'The ' + what + ' that were short, their variances added up.' }),
  surplus: total('variance', { label: 'Surplus', where: '{t}.variance > 0', about: 'The ' + what + ' that were over, their variances added up.' }),
  average_variance: avg('variance', { type: 'money', unit: 'pounds', label: 'Average variance' }),
})

export default [
  // ── Worked out for each run ──────────────────────────────────

  subject({
    key: 'cash.days',
    label: 'Cash days',
    one: 'cash day',
    area: 'cash',
    module: MODULE,
    about: 'Each day with a Cash Recon report, with its figures worked out as the Cash Recon page works them out: what was expected (income and the service charge adjustment), what was counted (takings and the cash paid out of the till), and the variance.',
    from: { work: 'cash_days', tables: WORK_TABLES },
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Day' },
    fields: {
      week_start: date('week_start', { label: 'Week starting' }),
      status: choice('status', STATUS, { label: 'Submitted' }),
      submitted_at: moment('submitted_at', { label: 'Submitted at' }),
      submitted_by: text('submitted_by', { label: 'Submitted by' }),
      ...figureFields('that day'),
    },
    measures: {
      days: count({ label: 'Days', about: 'Days with a Cash Recon report.' }),
      days_submitted: count({ label: 'Days submitted', where: "{t}.status = 'submitted'" }),
      days_short: count({ label: 'Days short', where: '{t}.variance < 0', about: 'Days whose variance was a minus.' }),
      days_over: count({ label: 'Days over', where: '{t}.variance > 0', about: 'Days whose variance was above nothing.' }),
      ...figureMeasures('days'),
    },
    links: {
      report: one('cash.reports', 'id', { label: 'Cash Recon report' }),
    },
    list: ['date', 'venue.name', 'status', 'income', 'takings', 'expenses', 'wages_paid', 'variance'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'cash.weeks',
    label: 'Cash weeks',
    one: 'cash week',
    area: 'cash',
    module: MODULE,
    about: 'Each venue\'s week (Monday to Sunday) with a Cash Recon report or a wage list: its days\' figures added up and the week\'s wages. Cash wages paid on no reported day count once in the week, so the week\'s variance can differ from its days\' added up.',
    from: { work: 'cash_weeks', tables: WORK_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Week starting', grain: 'week' },
    fields: {
      days: number('days', { label: 'Days reported', adds: true }),
      days_submitted: number('days_submitted', { label: 'Days submitted', adds: true }),
      ...figureFields('on the week\'s reported days'),
      cash_wages: pounds('cash_wages', { label: 'Cash wages', about: 'Every cash amount on the week\'s wage list.' }),
      wages_off_days: pounds('wages_off_days', { label: 'Cash wages on no reported day', about: 'Cash wages paid on a day with no report, or with no day: they count in the week\'s variance only.' }),
      wages: pounds('wages', { label: 'Wages', about: 'Every wage on the week\'s wage list, however it was paid.' }),
      bank_wages: pounds('bank_wages', { label: 'Wages by bank' }),
      wage_list: yesno('wage_list', { label: 'Has a wage list' }),
    },
    measures: {
      weeks: count({ label: 'Weeks' }),
      weeks_short: count({ label: 'Weeks short', where: '{t}.variance < 0' }),
      weeks_over: count({ label: 'Weeks over', where: '{t}.variance > 0' }),
      days_total: sum('days', { label: 'Days reported' }),
      ...figureMeasures('weeks'),
      cash_wages_total: total('cash_wages', { label: 'Cash wages' }),
      wages_off_days_total: total('wages_off_days', { label: 'Cash wages on no reported day' }),
      wages_total: total('wages', { label: 'Wages' }),
      bank_wages_total: total('bank_wages', { label: 'Wages by bank' }),
    },
    list: ['date', 'venue.name', 'days', 'income', 'takings', 'cash_wages', 'variance'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  // ── What was typed ────────────────────────────────────────────

  subject({
    key: 'cash.income',
    label: 'Income entries',
    one: 'income entry',
    area: 'cash',
    module: MODULE,
    about: 'Each amount typed against an income source on a day\'s Cash Recon. It counts in the reconciliation while its source is switched on and not left out.',
    from: 'cash_income_entries',
    venue: { sql: '{report}.venue_id' },
    date: { sql: '{report}.report_date', label: 'Day' },
    fields: {
      gross: pounds('gross_amount', { label: 'Gross' }),
      vat: pounds('vat_amount', { label: 'VAT' }),
      net: pounds('net_amount', { label: 'Net' }),
      counts: yesno({ sql: INCOME_COUNTS }, { label: 'Counts in reconciliation' }),
      notes: text('notes'),
    },
    measures: {
      entries: count({ label: 'Entries' }),
      gross_total: total('gross_amount', { label: 'Gross' }),
      vat_total: total('vat_amount', { label: 'VAT' }),
      net_total: total('net_amount', { label: 'Net' }),
      income_counted: total('gross_amount', { label: 'Income counted', where: INCOME_COUNTS, about: 'Gross income on the sources that count in reconciliation: a day\'s Income on Cash days.' }),
    },
    links: {
      report: one('cash.reports', 'report_id', { label: 'Day report' }),
      source: one('cash.income_sources', 'source_id', { label: 'Income source' }),
    },
    list: ['date', 'venue.name', 'source.name', 'gross', 'vat', 'net', 'counts'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'cash.takings',
    label: 'Takings entries',
    one: 'takings entry',
    area: 'cash',
    module: MODULE,
    about: 'Each amount typed against a payment channel on a day\'s Cash Recon. It counts while its channel is switched on; cash takings are those on channels that count as cash.',
    from: 'cash_takings_entries',
    venue: { sql: '{report}.venue_id' },
    date: { sql: '{report}.report_date', label: 'Day' },
    fields: {
      amount: pounds('amount', { label: 'Amount' }),
      counts: yesno({ sql: CHANNEL_COUNTS }, { label: 'Counts in reconciliation' }),
      is_cash: yesno({ sql: CASH_CHANNEL }, { label: 'Counts as cash' }),
      notes: text('notes'),
    },
    measures: {
      entries: count({ label: 'Entries' }),
      amount_total: total('amount', { label: 'Typed', about: 'Every amount typed, whether its channel counts or not.' }),
      takings_counted: total('amount', { label: 'Takings', where: CHANNEL_COUNTS, about: 'Takings on the channels switched on: a day\'s Takings on Cash days.' }),
      cash_takings: total('amount', { label: 'Cash takings', where: CASH_CHANNEL, about: 'Takings on the channels that count as cash.' }),
    },
    links: {
      report: one('cash.reports', 'report_id', { label: 'Day report' }),
      channel: one('cash.payment_channels', 'channel_id', { label: 'Payment channel' }),
    },
    list: ['date', 'venue.name', 'channel.name', 'amount', 'counts'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'cash.service_charges',
    label: 'Service charge entries',
    one: 'service charge entry',
    area: 'cash',
    module: MODULE,
    about: 'Each service charge or tips amount typed on a day\'s Cash Recon, and what it does to what is expected, as its source is set up now.',
    from: 'cash_sc_entries',
    venue: { sql: '{report}.venue_id' },
    date: { sql: '{report}.report_date', label: 'Day' },
    fields: {
      amount: pounds('amount', { label: 'Amount' }),
      counts: yesno({ sql: SC_COUNTS }, { label: 'Counts in reconciliation' }),
      adjustment: pounds({ sql: '(CASE WHEN ' + SC_COUNTS + ' THEN ' + SC_ADJUSTMENT + ' ELSE 0 END)' }, { label: 'Adjustment to expected' }),
      notes: text('notes'),
    },
    measures: {
      entries: count({ label: 'Entries' }),
      amount_total: total('amount', { label: 'Typed' }),
      counted: total('amount', { label: 'Service charges and tips', where: SC_COUNTS, about: 'Amounts on the sources switched on.' }),
      adjustment_total: total({ sql: SC_ADJUSTMENT }, { label: 'Adjustment to expected', where: SC_COUNTS, about: 'What the amounts add to or take off what is expected: a day\'s Service charge adjustment on Cash days.' }),
    },
    links: {
      report: one('cash.reports', 'report_id', { label: 'Day report' }),
      source: one('cash.sc_sources', 'source_id', { label: 'Service charge source' }),
    },
    list: ['date', 'venue.name', 'source.name', 'amount', 'adjustment'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'cash.expenses',
    label: 'Expenses',
    one: 'expense',
    area: 'cash',
    module: MODULE,
    about: 'Each expense on a day\'s Cash Recon. Cash expenses came out of the till and count in the reconciliation; expenses paid by card are kept for their receipts and VAT only.',
    from: 'cash_expenses',
    name: 'description',
    venue: { sql: '{report}.venue_id' },
    date: { sql: '{report}.report_date', label: 'Day' },
    fields: {
      description: text('description'),
      category_name: text({ sql: "COALESCE({category}.name, NULLIF(btrim({t}.category), ''))" }, { label: 'Category' }),
      amount: pounds('amount', { label: 'Amount' }),
      vat: pounds('vat_amount', { label: 'VAT' }),
      paid_by: choice({ sql: "(CASE WHEN {t}.paid_by_card THEN 'card' ELSE 'cash' END)" }, { cash: 'Cash from the till', card: 'Card' }, { label: 'Paid by' }),
      receipt: yesno({ sql: '({t}.receipt_url IS NOT NULL)' }, { label: 'Receipt kept' }),
      notes: text('notes'),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      count_all: count({ label: 'Expenses' }),
      cash_spend: total('amount', { label: 'Cash expenses', where: 'NOT COALESCE({t}.paid_by_card, false)', about: 'Paid out of the till: a day\'s Cash expenses on Cash days.' }),
      card_spend: total('amount', { label: 'Card expenses', where: 'COALESCE({t}.paid_by_card, false)' }),
      spend: total('amount', { label: 'All expenses' }),
      vat_total: total('vat_amount', { label: 'VAT' }),
      without_receipt: count({ label: 'Without a receipt', where: '{t}.receipt_url IS NULL' }),
    },
    links: {
      report: one('cash.reports', 'report_id', { label: 'Day report' }),
      category: one('cash.expense_categories', 'category_id', { label: 'Expense category' }),
    },
    list: ['date', 'venue.name', 'description', 'category_name', 'amount', 'vat', 'paid_by'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'cash.wages',
    label: 'Wage entries',
    one: 'wage entry',
    area: 'cash',
    module: MODULE,
    about: 'Each person on a week\'s wage list in Cash Recon: their wage, what was paid by bank and in cash, and what is still to pay (what isn\'t paid by bank is due in cash).',
    from: 'cash_wage_entries',
    name: 'name',
    venue: { sql: '{list}.venue_id' },
    date: { sql: '{list}.week_start', label: 'Week starting', grain: 'week' },
    fields: {
      name: text('name', { label: 'Name' }),
      pay_type: choice('entry_type', { hourly: 'Hourly', fixed: 'Fixed' }, { label: 'Paid by the hour or fixed' }),
      hours: number('hours', { label: 'Hours', adds: true, decimals: 2 }),
      rate: pounds('rate', { label: 'Rate', adds: false }),
      wage: pounds('total', { label: 'Wage' }),
      bank: pounds('bank_amount', { label: 'Paid by bank' }),
      cash: pounds('cash_amount', { label: 'Paid in cash' }),
      unpaid: pounds({ sql: UNPAID }, { label: 'Still to pay' }),
      paid_on: date('paid_date', { label: 'Paid on' }),
      notes: text('notes'),
    },
    measures: {
      people: count({ label: 'Entries' }),
      hours_total: sum('hours', { label: 'Hours', decimals: 2 }),
      wages_total: total('total', { label: 'Wages' }),
      bank_total: total('bank_amount', { label: 'Paid by bank' }),
      cash_total: total('cash_amount', { label: 'Paid in cash' }),
      unpaid_total: total({ sql: UNPAID }, { label: 'Still to pay' }),
    },
    links: {
      list: one('cash.wage_lists', 'wage_report_id', { label: 'Wage list' }),
      // Empty for someone typed onto the list by name only.
      person: one('staff.people', 'staff_id', { label: 'Person' }),
    },
    list: ['date', 'venue.name', 'name', 'wage', 'bank', 'cash', 'unpaid', 'paid_on'],
    sort: [{ by: 'date', dir: 'desc' }, { by: 'name', dir: 'asc' }],
  }),

  // ── What reports group by ─────────────────────────────────────

  subject({
    key: 'cash.income_sources',
    label: 'Income sources',
    one: 'income source',
    area: 'cash',
    module: MODULE,
    about: 'The income sources each venue\'s Cash Recon asks for (the till, delivery companies, other).',
    from: 'cash_income_sources',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      type: choice('type', { pos: 'Till', delivery: 'Delivery', other: 'Other' }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      vat_inclusive: yesno('vat_inclusive', { label: 'Amounts include VAT' }),
      active: yesno('is_active', { label: 'Switched on' }),
      left_out: yesno('exclude_from_recon', { label: 'Left out of reconciliation' }),
    },
    measures: {
      sources: count({ label: 'Income sources' }),
    },
    links: {
      entries: many('cash.income', 'source_id', { label: 'Income entries' }),
    },
    list: ['name', 'venue.name', 'type', 'active', 'left_out'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'tooltip'],
  }),

  subject({
    key: 'cash.payment_channels',
    label: 'Payment channels',
    one: 'payment channel',
    area: 'cash',
    module: MODULE,
    about: 'The ways each venue\'s takings come in on Cash Recon (cash, card machines, vouchers, online), and which count as cash.',
    from: 'cash_payment_channels',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      type: choice('type', { cash: 'Cash', card: 'Card', voucher: 'Voucher', online: 'Online', other: 'Other' }),
      active: yesno('is_active', { label: 'Switched on' }),
      counts_as_cash: yesno({ sql: 'COALESCE({t}.counts_as_cash, true)' }, { label: 'Counts as cash' }),
    },
    measures: {
      channels: count({ label: 'Payment channels' }),
    },
    links: {
      entries: many('cash.takings', 'channel_id', { label: 'Takings entries' }),
    },
    list: ['name', 'venue.name', 'type', 'active', 'counts_as_cash'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'tooltip'],
  }),

  subject({
    key: 'cash.sc_sources',
    label: 'Service charge sources',
    one: 'service charge source',
    area: 'cash',
    module: MODULE,
    about: 'The service charge and tips sources each venue\'s Cash Recon asks for, and what each does to takings and income.',
    from: 'cash_sc_sources',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      type: choice('type', { tips: 'Tips', service_charge: 'Service charge' }),
      active: yesno('is_active', { label: 'Switched on' }),
      takings_effect: choice('takings_effect', EFFECTS, { label: 'On takings' }),
      income_effect: choice('income_effect', EFFECTS, { label: 'On income' }),
    },
    measures: {
      sources: count({ label: 'Service charge sources' }),
    },
    links: {
      entries: many('cash.service_charges', 'source_id', { label: 'Service charge entries' }),
      pot: one('rota.tip_pots', 'tip_pot_id', { label: 'Tip pot it feeds' }),
    },
    list: ['name', 'venue.name', 'type', 'takings_effect', 'income_effect', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'tooltip'],
  }),

  subject({
    key: 'cash.expense_categories',
    label: 'Expense categories',
    one: 'expense category',
    area: 'cash',
    module: MODULE,
    about: 'The categories each venue sorts its Cash Recon expenses into.',
    from: 'cash_expense_categories',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'Switched on' }),
    },
    measures: {
      categories: count({ label: 'Expense categories' }),
    },
    links: {
      expenses: many('cash.expenses', 'category_id', { label: 'Expenses' }),
    },
    list: ['name', 'venue.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['colour', 'sort_order', 'created_at'],
  }),

  // ── Reached through a link only ───────────────────────────────

  subject({
    key: 'cash.reports',
    label: 'Cash Recon reports',
    one: 'Cash Recon report',
    area: 'cash',
    module: MODULE,
    hidden: true,
    about: 'A day\'s Cash Recon report as typed: its status and notes, and when it was filled in from the till or another system. Its figures are on Cash days.',
    from: 'cash_daily_reports',
    venue: 'venue_id',
    date: { sql: '{t}.report_date', label: 'Day' },
    fields: {
      status: choice('status', STATUS, { label: 'Submitted' }),
      notes: text('notes', { label: 'Notes' }),
      submitted_at: moment('submitted_at', { label: 'Submitted at' }),
      submitted_by: text('submitted_by', { label: 'Submitted by' }),
      pos_filled_at: moment('pos_filled_at', { label: 'Filled from the till at' }),
      pos_filled_by: text('pos_filled_by', { label: 'Filled from the till by' }),
      loyverse_filled_at: moment('loyverse_filled_at', { label: 'Filled from Loyverse at' }),
      loyverse_filled_by: text('loyverse_filled_by', { label: 'Filled from Loyverse by' }),
      gloriafood_filled_at: moment('gloriafood_filled_at', { label: 'Filled from GloriaFood at' }),
      gloriafood_filled_by: text('gloriafood_filled_by', { label: 'Filled from GloriaFood by' }),
    },
    skip: ['created_at', 'updated_at'],
  }),

  subject({
    key: 'cash.wage_lists',
    label: 'Wage lists',
    one: 'wage list',
    area: 'cash',
    module: MODULE,
    hidden: true,
    about: 'A venue\'s wage list for a week on Cash Recon.',
    from: 'cash_wage_reports',
    venue: 'venue_id',
    date: { sql: '{t}.week_start', label: 'Week starting', grain: 'week' },
    fields: {
      notes: text('notes', { label: 'Notes' }),
    },
    skip: ['created_at', 'updated_at'],
  }),
]
