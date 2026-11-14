import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scEffectAmount, amountOf, pennies, reconSetup, cashDay, cashWeek } from '../cashRecon.js'

const CONFIG = {
  income_sources: [
    { id: 'pos', is_active: true },
    { id: 'deliveroo', is_active: true },
    { id: 'vouchers_sold', is_active: true, exclude_from_recon: true },
    { id: 'old', is_active: false },
  ],
  sc_sources: [
    { id: 'tips', is_active: true, takings_effect: 'add', income_effect: 'none' },
    { id: 'sc', is_active: true, takings_effect: 'none', income_effect: 'subtract' },
    { id: 'refunded', is_active: true, takings_effect: 'subtract', income_effect: 'add' },
    { id: 'gone', is_active: false, takings_effect: 'add', income_effect: 'add' },
  ],
  payment_channels: [
    { id: 'cash', is_active: true, counts_as_cash: true },
    { id: 'card', is_active: true, counts_as_cash: false },
    { id: 'float', is_active: true },              // not said: counts as cash
    { id: 'closed', is_active: false, counts_as_cash: true },
  ],
}

const amounts = map => (kind, id) => map[kind + ':' + id]

test('scEffectAmount, amountOf and pennies', () => {
  assert.equal(scEffectAmount('add', 5), 5)
  assert.equal(scEffectAmount('subtract', 5), -5)
  assert.equal(scEffectAmount('none', 5), 0)
  assert.equal(scEffectAmount(undefined, 5), 0)
  assert.equal(amountOf('12.50'), 12.5)
  assert.equal(amountOf(''), 0)
  assert.equal(amountOf(null), 0)
  assert.equal(amountOf('abc'), 0)
  assert.equal(amountOf(Infinity), 0)
  assert.equal(pennies(0.1 + 0.2), 0.3)
  assert.equal(pennies(-0.004), 0)
  assert.ok(!Object.is(pennies(-0.004), -0))
  assert.equal(pennies('7.5'), 7.5)
})

test('reconSetup: active only, excluded income and non-cash channels apart', () => {
  const s = reconSetup(CONFIG)
  assert.deepEqual(s.sources.map(x => x.id), ['pos', 'deliveroo', 'vouchers_sold'])
  assert.deepEqual(s.counted.map(x => x.id), ['pos', 'deliveroo'])
  assert.deepEqual(s.sc.map(x => x.id), ['tips', 'sc', 'refunded'])
  assert.deepEqual(s.channels.map(x => x.id), ['cash', 'card', 'float'])
  assert.deepEqual(s.cash.map(x => x.id), ['cash', 'float'])
  assert.deepEqual(reconSetup(null), { sources: [], counted: [], sc: [], channels: [], cash: [] })
})

test('cashDay: the variance adds back what was paid out of the till', () => {
  const day = cashDay(reconSetup(CONFIG), {
    amount: amounts({
      'income:pos': '1000.10', 'income:deliveroo': 200.2, 'income:vouchers_sold': 50, 'income:old': 999,
      'sc:tips': 30, 'sc:sc': 40, 'sc:refunded': 5, 'sc:gone': 1000,
      'takings:cash': '300.05', 'takings:card': 850.15, 'takings:float': 10, 'takings:closed': 77,
    }),
    expenses: 12.5, cardExpenses: 8, wagesPaid: 60,
  })
  // income 1200.30 (vouchers and the switched-off source left out)
  assert.equal(day.income, 1200.3)
  assert.equal(day.income_left_out, 50)
  // takings 1160.20, cash 310.05
  assert.equal(day.takings, 1160.2)
  assert.equal(day.cash_takings, 310.05)
  assert.equal(day.service_charges, 75)
  // tips +30 (takings), sc -40 (income), refunded -5 +5 = 0  ->  -10
  assert.equal(day.sc_adjustment, -10)
  assert.equal(day.expenses, 12.5)
  assert.equal(day.card_expenses, 8)
  assert.equal(day.wages_paid, 60)
  assert.equal(day.expected, 1190.3)
  assert.equal(day.counted, 1232.7)
  // 1160.20 + 12.50 + 60 - (1200.30 - 10) = 42.40
  assert.equal(day.variance, 42.4)
})

test('cashDay: nothing typed is all zeros, and a shortfall is negative', () => {
  const setup = reconSetup(CONFIG)
  const empty = cashDay(setup)
  for (const v of Object.values(empty)) assert.equal(v, 0)
  const short = cashDay(setup, { amount: amounts({ 'income:pos': 100, 'takings:card': 90.01 }) })
  assert.equal(short.variance, -9.99)
})

test('cashWeek: the days add up, and wages not paid on a counted day count once', () => {
  const setup = reconSetup(CONFIG)
  const mon = cashDay(setup, { amount: amounts({ 'income:pos': 100, 'takings:cash': 100 }), wagesPaid: 20 })
  const tue = cashDay(setup, { amount: amounts({ 'income:pos': 50, 'takings:card': 45 }), expenses: 5 })
  assert.equal(mon.variance, 20)
  assert.equal(tue.variance, 0)
  // 70 of cash wages on the week's list: 20 paid on Monday, 50 on no counted day
  const week = cashWeek([mon, tue], 70)
  assert.equal(week.days, 2)
  assert.equal(week.income, 150)
  assert.equal(week.takings, 145)
  assert.equal(week.expenses, 5)
  assert.equal(week.wages_paid, 20)
  assert.equal(week.cash_wages, 70)
  assert.equal(week.wages_off_days, 50)
  assert.equal(week.variance, 70)
  // the week's variance doesn't depend on which day the wages were paid
  const monNone = cashDay(setup, { amount: amounts({ 'income:pos': 100, 'takings:cash': 100 }) })
  assert.equal(cashWeek([monNone, tue], 70).variance, week.variance)
  assert.equal(cashWeek([], 0).variance, 0)
})
