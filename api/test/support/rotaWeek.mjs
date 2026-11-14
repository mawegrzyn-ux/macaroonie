// Three rota weeks at a venue with every part the rota maths reads
// (services/rotaCalc.js), made through the API, plus a second venue with one
// person. Used by the report builder's rota subjects test
// (reports-rota.test.mjs), which holds the reports to the Rota page's own
// figures (GET /api/rota/venues/:venueId/weeks/:week/pay).
//
// What is in it:
//   shifts      Lunch 11:00-15:00 (1 point), Dinner 17:00-23:00 (2 points),
//               Late 22:00-02:00 (1 point, past midnight)
//   staff       Ana hourly (£12, £14 on Dinner), paid by bank, a chef (x1.5)
//               Ben fixed £300 a week, part by bank (£100), a server
//               Cal fixed £80 a day, cash; Dee £50 a shift (£40 on Lunch)
//               Eve hourly, leaves on week 2's Wednesday
//               Fay hourly, off the rota all of week 1
//               Gus hourly, taken off week 2; Hal hourly, switched off
//               after working week 1; Ivy hourly, never on the rota
//   entries     shifts and periods, every kind of time off, a shift past
//               midnight, a period partly in a shift
//   pay         a pay override, extra pay, a deduction, an advance repaid
//               the week after, a wage left part paid (carried into week 2)
//   tips        a points pot (card tips source, £ and % lines, a 2.5%
//               surcharge, tips rounded to 10p), a manual pot paid by bank
//               to two people, a house pot; point and £ moves; £ taps and a
//               point tap whose spare points carry into the weeks after
import { ok } from './app.mjs'

export const ROTA_MONDAY = '2026-09-07'

export const addDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)

export async function fillRotaWeeks(owner, V, W) {
  const R = '/api/rota'
  const post = (path, body, what) => ok(owner.post(R + path, body), what || path)
  const put = (path, body, what) => ok(owner.put(R + path, body), what || path)
  const patch = (path, body, what) => ok(owner.patch(R + path, body), what || path)
  const [w1, w2, w3] = [0, 7, 14].map(n => addDays(ROTA_MONDAY, n))
  const day = (week, n) => addDays(week, n)

  await patch('/settings', { mode: 'day_parts', tip_round_to: 0.1, tip_round_mode: 'nearest' }, 'rota settings')
  const shift = {
    lunch: await post('/shifts', { name: 'Lunch', start_time: '11:00', end_time: '15:00', points: 1 }),
    dinner: await post('/shifts', { name: 'Dinner', start_time: '17:00', end_time: '23:00', points: 2 }),
    late: await post('/shifts', { name: 'Late', start_time: '22:00', end_time: '02:00', points: 1 }),
  }
  const role = {
    chef: await post('/roles', { name: 'Chef', points_multiplier: 1.5 }),
    server: await post('/roles', { name: 'Server', points_multiplier: 1 }),
  }
  const person = (body, venue = V) => post(`/venues/${venue}/staff`, body, 'staff ' + body.name)
  const staff = {
    ana: await person({ name: 'Ana', role_id: role.chef.id, pay_type: 'hourly', default_rate: 12, pay_method: 'bank' }),
    ben: await person({ name: 'Ben', role_id: role.server.id, pay_type: 'fixed', pay_basis: 'week', default_rate: 300, pay_method: 'split', bank_amount: 100 }),
    cal: await person({ name: 'Cal', pay_type: 'fixed', pay_basis: 'day', default_rate: 80 }),
    dee: await person({ name: 'Dee', role_id: role.server.id, pay_type: 'fixed', pay_basis: 'shift', default_rate: 50 }),
    eve: await person({ name: 'Eve', pay_type: 'hourly', default_rate: 11 }),
    fay: await person({ name: 'Fay', pay_type: 'hourly', default_rate: 10 }),
    gus: await person({ name: 'Gus', pay_type: 'hourly', default_rate: 10 }),
    hal: await person({ name: 'Hal', pay_type: 'hourly', default_rate: 9 }),
    ivy: await person({ name: 'Ivy', pay_type: 'hourly', default_rate: 10 }),
  }
  await patch(`/venues/${V}/staff/${staff.ana.id}`, { shift_rates: [{ shift_id: shift.dinner.id, rate: 14 }] }, 'Ana\'s dinner rate')
  await patch(`/venues/${V}/staff/${staff.dee.id}`, { shift_rates: [{ shift_id: shift.lunch.id, rate: 40 }] }, 'Dee\'s lunch amount')
  await post(`/venues/${V}/staff/${staff.fay.id}/off-periods`, { from_date: w1, to_date: day(w1, 6), note: 'Holiday' }, 'Fay off week 1')

  // Service charge sources at the venue, each feeding a pot.
  const C = `/api/venues/${V}/cash-recon`
  const scSource = body => ok(owner.post(`${C}/config/sc-sources`, body), 'sc source ' + body.name)
  const src = {
    tips: await scSource({ name: 'Card tips', type: 'tips' }),
    service: await scSource({ name: 'Service charge', type: 'service_charge' }),
    house: await scSource({ name: 'House share', type: 'service_charge' }),
  }
  const pot = {
    floor: await post('/pots', { name: 'Floor tips', distribution: 'points', surcharges: [{ name: 'Card fees', pct: 2.5 }] }),
    bar: await post('/pots', { name: 'Bar tips', distribution: 'manual', payout_method: 'bank', payout_to: 'people' }),
    house: await post('/pots', { name: 'House', distribution: 'house' }),
  }
  await put(`/pots/${pot.floor.id}/sources`, { source_ids: [src.tips.id] }, 'floor sources')
  await put(`/pots/${pot.bar.id}/sources`, { source_ids: [src.service.id] }, 'bar sources')
  await put(`/pots/${pot.house.id}/sources`, { source_ids: [src.house.id] }, 'house sources')
  const line = {
    cash: await post(`/pots/${pot.floor.id}/lines`, { name: 'Cash tips', kind: 'amount' }),
    bonus: await post(`/pots/${pot.floor.id}/lines`, { name: 'Bonus', kind: 'percent' }),
    house: await post(`/pots/${pot.house.id}/lines`, { name: 'Kept', kind: 'amount' }),
  }
  const sc = (date, pairs) => ok(owner.put(`${C}/daily/${date}`, { sc: pairs.map(([s, amount]) => ({ source_id: s.id, amount })) }), 'sc ' + date)
  await sc(w1, [[src.tips, 40], [src.service, 60], [src.house, 10]])
  await sc(day(w1, 4), [[src.tips, 25.2]])
  await sc(day(w2, 1), [[src.tips, 33.33], [src.service, 20]])

  // ── Week 1 ──
  const at = (who, date, sh, status = 'on') => ({ staff_id: staff[who].id, work_date: date, shift_id: shift[sh].id, status })
  const span = (who, date, start_time, end_time, status = 'on') => ({ staff_id: staff[who].id, work_date: date, start_time, end_time, status })
  const entries = (week, list, extra = {}) => put(`/venues/${V}/weeks/${week}/entries`, { entries: list, ...extra }, 'entries ' + week)
  await entries(w1, [
    at('ana', w1, 'lunch'), span('ana', day(w1, 1), '16:00', '23:30'), at('ana', day(w1, 2), 'lunch', 'sick'),
    at('ana', day(w1, 3), 'dinner', 'pto'), at('ana', day(w1, 5), 'late'),
    at('ben', w1, 'dinner'), at('ben', day(w1, 1), 'dinner'), at('ben', day(w1, 4), 'lunch', 'uto'),
    at('cal', w1, 'lunch'), at('cal', day(w1, 1), 'lunch'), at('cal', day(w1, 5), 'dinner', 'abs'),
    at('dee', w1, 'lunch'), at('dee', w1, 'dinner'), span('dee', day(w1, 1), '12:00', '14:00'),
    at('gus', day(w1, 2), 'lunch'), at('hal', day(w1, 2), 'lunch'),
  ])
  const week = w => `/venues/${V}/weeks/${w}`
  await put(`${week(w1)}/pot-lines`, { amounts: [{ line_id: line.cash.id, amount: 50 }, { line_id: line.bonus.id, amount: 10 }, { line_id: line.house.id, amount: 15 }] }, 'pot lines week 1')
  await put(`${week(w1)}/pots/${pot.bar.id}/manual`, { amounts: [{ staff_id: staff.ben.id, amount: 20 }, { staff_id: staff.cal.id, amount: 15 }] }, 'bar week 1')
  await put(`${week(w1)}/pots/${pot.bar.id}/payees`, { staff_ids: [staff.ben.id, staff.cal.id] }, 'bar payees')
  await patch(`${week(w1)}/staff/${staff.cal.id}`, { pay_override: 200 }, 'Cal\'s pay override')
  await post(`${week(w1)}/pay-adjustments`, { staff_id: staff.ana.id, kind: 'extra', amount: 10, note: 'Cover' })
  await post(`${week(w1)}/pay-adjustments`, { staff_id: staff.dee.id, kind: 'deduction', amount: 5, note: 'Uniform' })
  await post(`${week(w1)}/pay-adjustments`, { staff_id: staff.ben.id, kind: 'advance', amount: 50, note: 'Advance' })
  await post(`${week(w1)}/tip-moves`, { kind: 'points', action: 'move', from_staff_id: staff.ana.id, lines: [{ to_staff_id: staff.dee.id, amount: 0.5 }] }, 'points move')
  await post(`${week(w1)}/tip-moves`, { kind: 'money', action: 'add', lines: [{ to_staff_id: staff.ben.id, amount: 5 }], note: 'Bonus' }, 'tips added')
  await post(`${week(w1)}/tip-moves`, { kind: 'money', action: 'remove', lines: [{ to_staff_id: staff.cal.id, amount: 2 }], note: 'Breakage' }, 'tips taken out')
  for (let i = 0; i < 2; i++) await post(`${week(w1)}/tip-nudge`, { staff_id: staff.ana.id, direction: 'minus' }, 'tip tap')
  await post(`${week(w1)}/points-nudge`, { staff_id: staff.ben.id, direction: 'minus' }, 'point tap')
  // Hal is switched off after working week 1 (kept, since he has entries).
  await ok(owner.delete(`${R}/venues/${V}/staff/${staff.hal.id}`), 'switch Hal off')
  // Ana's week 1 wage left part paid: £50 carries into week 2's pay.
  await ok(owner.put(`${C}/wages/${w1}`, { entries: [
    { staff_id: staff.ana.id, name: 'Ana', total: 200, cash_amount: 150 },
    { staff_id: staff.cal.id, name: 'Cal', total: 100 },
  ] }), 'wages week 1')

  // ── Week 2 ──
  await entries(w2, [
    at('ana', w2, 'dinner'), span('ana', day(w2, 2), '10:00', '12:00'),
    at('ben', w2, 'lunch'), at('ben', day(w2, 6), 'lunch', 'pto'),
    at('cal', day(w2, 1), 'dinner'),
    at('eve', w2, 'lunch'), at('eve', day(w2, 1), 'lunch'),
    at('fay', day(w2, 3), 'dinner'),
  ], { removed_staff_ids: [staff.gus.id] })
  await put(`/venues/${V}/staff/${staff.eve.id}/leaving`, { left_on: day(w2, 2), note: 'Moved away' }, 'Eve leaves')
  await put(`${week(w2)}/pot-lines`, { amounts: [{ line_id: line.cash.id, amount: 30 }] }, 'pot lines week 2')
  await put(`${week(w2)}/pots/${pot.bar.id}/manual`, { amounts: [{ staff_id: staff.ana.id, amount: 10 }] }, 'bar week 2')
  await post(`${week(w2)}/pay-adjustments`, { staff_id: staff.fay.id, kind: 'extra', amount: 7.5, note: 'Training' })
  await post(`${week(w2)}/tip-nudge`, { staff_id: staff.ben.id, direction: 'plus' }, 'tip tap from the carried pot')
  await post(`${week(w2)}/tip-moves`, { kind: 'money', action: 'move', from_staff_id: staff.ben.id, lines: [{ to_staff_id: staff.fay.id, amount: 1 }] }, 'tips move')

  // ── Week 3 ──
  await entries(w3, [at('ana', w3, 'lunch'), at('ben', day(w3, 1), 'dinner')])
  await put(`${week(w3)}/pots/${pot.bar.id}/manual`, { amounts: [{ staff_id: staff.ivy.id, amount: 12 }] }, 'bar week 3')

  // ── The second venue: one person, one shift ──
  const zed = await person({ name: 'Zed', pay_type: 'hourly', default_rate: 10 }, W)
  await put(`/venues/${W}/weeks/${w1}/entries`, { entries: [{ staff_id: zed.id, work_date: w1, shift_id: shift.lunch.id }] }, 'Zed week 1')
  staff.zed = zed

  return { weeks: [w1, w2, w3], shift, role, staff, src, pot, line }
}
