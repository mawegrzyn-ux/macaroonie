// shared/cashRecon.js
//
// Cash Recon's one rule for a day's and a week's figures: what was taken,
// what was declared and the variance between them. The day view, the week
// grid and its dashboard widgets (admin/src/pages/CashRecon.jsx), the week
// route (api/src/routes/cashRecon.js) and the report builder's Cash days and
// Cash weeks (api/src/reports/work/) all work them out here, so they can't
// disagree.
//
// Staff pay expenses and cash wages out of the till before the cash is
// counted, so the counted takings are already short by them; the variance
// adds them back:
//
//   day   = takings + cash expenses + cash wages paid that day
//           − (income + service charge adjustment)
//   week  = the days' variances + the week's cash wages not paid on one of
//           those days (no "paid on" day, or a day not counted)
//
// Positive is a surplus (more taken than declared), negative a shortfall.
// Only the venue's active income sources, payment channels and service
// charge sources count, as set up now; an income source marked "exclude
// from reconciliation" is shown but left out. Expenses paid by card never
// left the till and don't count either.
//
// Money is in pounds; every figure comes back rounded to the penny.

/** What a service charge source can do to each side of the variance. */
export const SC_EFFECTS = ['none', 'add', 'subtract']

/**
 * What one service charge source adds to one side of the adjustment:
 * 'add' the amount, 'subtract' minus it, 'none' nothing.
 */
export function scEffectAmount(effect, amount) {
  if (effect === 'add') return amount
  if (effect === 'subtract') return -amount
  return 0
}

/** An amount as typed or stored ('12.50', 12.5, null) as a number; anything else is 0. */
export function amountOf(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** To the penny. */
export function pennies(n) {
  const x = Math.round(amountOf(n) * 100) / 100
  return x === 0 ? 0 : x // never -0
}

/**
 * What a venue's Cash Recon set-up counts (the config route's
 * income_sources, sc_sources and payment_channels):
 *   sources   every active income source (the day view lists them all)
 *   counted   the ones the variance counts (not excluded from reconciliation)
 *   sc        active service charge sources
 *   channels  active payment channels
 *   cash      the channels that are cash in the till (counts_as_cash)
 */
export function reconSetup(config) {
  const sources = (config?.income_sources ?? []).filter(s => s.is_active)
  const sc = (config?.sc_sources ?? []).filter(s => s.is_active)
  const channels = (config?.payment_channels ?? []).filter(c => c.is_active)
  return {
    sources,
    counted: sources.filter(s => !s.exclude_from_recon),
    sc,
    channels,
    cash: channels.filter(c => c.counts_as_cash !== false),
  }
}

/**
 * One day's figures.
 *
 *   setup         reconSetup(config)
 *   amount(kind, id)
 *                 the day's amount for an income source (kind 'income': its
 *                 gross), a service charge source ('sc') or a payment
 *                 channel ('takings'); anything not a number counts as 0
 *   expenses      cash expenses that day (not paid by card)
 *   cardExpenses  expenses paid by card (shown, never in the variance)
 *   wagesPaid     cash wages paid out of the till that day
 */
export function cashDay(setup, { amount, expenses = 0, cardExpenses = 0, wagesPaid = 0 } = {}) {
  const read = (kind, id) => amountOf(amount ? amount(kind, id) : 0)
  const sum = (list, kind) => list.reduce((s, r) => s + read(kind, r.id), 0)
  const income = sum(setup.counted, 'income')
  const incomeAll = sum(setup.sources, 'income')
  const takings = sum(setup.channels, 'takings')
  const cashTakings = sum(setup.cash, 'takings')
  const serviceCharges = sum(setup.sc, 'sc')
  const scAdjustment = setup.sc.reduce((s, r) => {
    const a = read('sc', r.id)
    return s + scEffectAmount(r.takings_effect, a) + scEffectAmount(r.income_effect, a)
  }, 0)
  const exp = amountOf(expenses)
  const wages = amountOf(wagesPaid)
  const expected = income + scAdjustment
  const counted = takings + exp + wages
  return {
    income: pennies(income),
    income_left_out: pennies(incomeAll - income),
    takings: pennies(takings),
    cash_takings: pennies(cashTakings),
    service_charges: pennies(serviceCharges),
    sc_adjustment: pennies(scAdjustment),
    expenses: pennies(exp),
    card_expenses: pennies(cardExpenses),
    wages_paid: pennies(wages),
    expected: pennies(expected),
    counted: pennies(counted),
    variance: pennies(counted - expected),
  }
}

const DAY_SUMS = ['income', 'income_left_out', 'takings', 'cash_takings', 'service_charges', 'sc_adjustment',
  'expenses', 'card_expenses', 'wages_paid', 'expected', 'counted', 'variance']

/**
 * A week's figures from the days counted (cashDay results) and the week's
 * cash wages (every cash amount on its wage list). Wages paid on a day
 * that isn't among `days` are only in the week's variance (wages_off_days).
 */
export function cashWeek(days, cashWages = 0) {
  const out = { days: days.length }
  for (const k of DAY_SUMS) out[k] = pennies(days.reduce((s, d) => s + amountOf(d?.[k]), 0))
  const wages = amountOf(cashWages)
  const offDays = wages - out.wages_paid
  out.cash_wages = pennies(wages)
  out.wages_off_days = pennies(offDays)
  out.counted = pennies(out.counted + offDays)
  out.variance = pennies(out.variance + offDays)
  return out
}
