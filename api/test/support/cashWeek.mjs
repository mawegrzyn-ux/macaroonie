// A venue week of Cash Recon with every part the variance rule reads
// (shared/cashRecon.js), made through the API, and the figures it should
// give, worked out by hand. Used by the week route's test and the report
// builder's Cash days and Cash weeks.
//
// The set-up: an income source left out of reconciliation and one switched
// off, a card channel and a float counted as cash, a channel switched off,
// service charge sources with every effect (one switched off), expenses in
// cash and by card, and wages paid on a reported day, on a day with no
// report, with no day, and by bank. Monday to Wednesday and Friday have a
// report (Friday's submitted), Thursday has none.
import { ok } from './app.mjs'

export const CASH_MONDAY = '2026-10-19'

export const addDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)

export async function fillCashWeek(owner, V, monday = CASH_MONDAY) {
  const C = `/api/venues/${V}/cash-recon`
  const add = (what, body) => ok(owner.post(`${C}/config/${what}`, body), what)
  const src = {
    food: await add('income-sources', { name: 'Food', type: 'pos' }),
    drinks: await add('income-sources', { name: 'Drinks', type: 'pos' }),
    vouchers: await add('income-sources', { name: 'Vouchers sold', exclude_from_recon: true }),
    old: await add('income-sources', { name: 'Old till' }),
  }
  const chan = {
    cash: await add('payment-channels', { name: 'Cash', type: 'cash' }),
    card: await add('payment-channels', { name: 'Card', type: 'card' }),
    float: await add('payment-channels', { name: 'Float', type: 'other', counts_as_cash: true }),
    closed: await add('payment-channels', { name: 'Old cash tin', type: 'cash' }),
  }
  const sc = {
    tips: await add('sc-sources', { name: 'Card tips', type: 'tips', takings_effect: 'add' }),
    service: await add('sc-sources', { name: 'Service charge', type: 'service_charge', income_effect: 'subtract' }),
    both: await add('sc-sources', { name: 'Refunded charge', type: 'service_charge', takings_effect: 'subtract', income_effect: 'add' }),
    gone: await add('sc-sources', { name: 'Old tips', type: 'tips', takings_effect: 'add', income_effect: 'add' }),
  }
  const [mon, tue, wed, thu, fri] = [0, 1, 2, 3, 4].map(n => addDays(monday, n))
  const day = (date, body) => ok(owner.put(`${C}/daily/${date}`, body), 'day ' + date)
  const income = (pairs) => pairs.map(([s, gross_amount]) => ({ source_id: s.id, gross_amount }))
  const takings = (pairs) => pairs.map(([c, amount]) => ({ channel_id: c.id, amount }))

  await day(mon, {
    income: income([[src.food, '1000.10'], [src.drinks, 200.2], [src.vouchers, 50], [src.old, 999]]),
    takings: takings([[chan.cash, '300.05'], [chan.card, 850.15], [chan.float, 10], [chan.closed, 77]]),
    sc: [[sc.tips, 30], [sc.service, 40], [sc.both, 5], [sc.gone, 1000]].map(([s, amount]) => ({ source_id: s.id, amount })),
    expenses: [
      { description: 'Ice', amount: 12.5, vat_amount: 2.08 },
      { description: 'Gas by card', amount: 8, paid_by_card: true },
    ],
  })
  await day(tue, { income: income([[src.food, 500]]), takings: takings([[chan.card, 495]]), expenses: [{ description: 'Milk', amount: 5 }] })
  await day(wed, { income: income([[src.food, 300]]), takings: takings([[chan.cash, 290]]) })
  await day(fri, { income: income([[src.food, 100]]), takings: takings([[chan.cash, 110]]) })
  await ok(owner.post(`${C}/daily/${fri}/submit`, {}), 'submit Friday')

  // Switched off after their amounts were typed: they still hold amounts
  // that must not count.
  await ok(owner.delete(`${C}/config/income-sources/${src.old.id}`), 'switch off a source')
  await ok(owner.delete(`${C}/config/payment-channels/${chan.closed.id}`), 'switch off a channel')
  await ok(owner.delete(`${C}/config/sc-sources/${sc.gone.id}`), 'switch off an SC source')

  await ok(owner.put(`${C}/wages/${monday}`, { entries: [
    { name: 'Ana', total: 60, cash_amount: 60, paid_date: mon },
    { name: 'Ben', total: 40, cash_amount: 40, paid_date: thu },
    { name: 'Cal', total: 20, cash_amount: 20 },
    { name: 'Dee', total: 180, bank_amount: 180 },
  ] }), 'wages')

  // By hand. Monday: income 1000.10 + 200.20 (vouchers and the old till left
  // out); takings 300.05 + 850.15 + 10 (the old tin left out); cash in the
  // till 310.05 (cash and the float, which isn't card); service charges
  // 30 + 40 + 5 = 75; adjustment +30 (tips on takings) - 40 (service off
  // income) - 5 + 5 (both sides) = -10; expenses 12.50 in cash (the gas
  // was by card); wages 60 paid that day.
  //   counted 1160.20 + 12.50 + 60 = 1232.70, expected 1200.30 - 10 = 1190.30
  const days = {
    [mon]: {
      income: 1200.3, income_left_out: 50, takings: 1160.2, cash_takings: 310.05, service_charges: 75,
      sc_adjustment: -10, expenses: 12.5, card_expenses: 8, wages_paid: 60,
      expected: 1190.3, counted: 1232.7, variance: 42.4, status: 'draft',
    },
    [tue]: {
      income: 500, income_left_out: 0, takings: 495, cash_takings: 0, service_charges: 0,
      sc_adjustment: 0, expenses: 5, card_expenses: 0, wages_paid: 0,
      expected: 500, counted: 500, variance: 0, status: 'draft',
    },
    [wed]: {
      income: 300, income_left_out: 0, takings: 290, cash_takings: 290, service_charges: 0,
      sc_adjustment: 0, expenses: 0, card_expenses: 0, wages_paid: 0,
      expected: 300, counted: 290, variance: -10, status: 'draft',
    },
    [fri]: {
      income: 100, income_left_out: 0, takings: 110, cash_takings: 110, service_charges: 0,
      sc_adjustment: 0, expenses: 0, card_expenses: 0, wages_paid: 0,
      expected: 100, counted: 110, variance: 10, status: 'submitted',
    },
  }
  // The week: the four days add up to a variance of 42.40; the week's cash
  // wages are 120, 60 of them paid on a counted day (Monday), so 60 (Ben on
  // Thursday, which has no report, and Cal with no day) count once in the
  // week only: 42.40 + 60 = 102.40.
  const week = {
    days: 4, income: 2100.3, takings: 2055.2, cash_takings: 710.05, service_charges: 75, sc_adjustment: -10,
    expenses: 17.5, card_expenses: 8, wages_paid: 60, cash_wages: 120, wages_off_days: 60,
    expected: 2090.3, counted: 2192.7, variance: 102.4,
    wages: 300, bank_wages: 180, days_submitted: 1,
  }
  return { src, chan, sc, dates: { mon, tue, wed, thu, fri }, days, week }
}
