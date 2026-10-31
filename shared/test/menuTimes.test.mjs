// shared/menuTimes.js: when each menu is on, per channel (website, kiosks, tills).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanSchedule, cleanCell, cleanRow, isDefaultRow, channelTimes, channelLabel, timesLabel,
  menusOnNow, tillMenusShown, nextStart, menuTimesProblems, menuTimesWarnings, CHANNELS,
} from '../menuTimes.js'
import { scheduleError, scheduleProblem } from '../menuSchedule.js'

const LUNCH = { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }] }
const DINNER = { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '17:00', end: '22:00' }] }
// Monday 2 November 2026.
const at = (hm, date = '2026-11-02', dow = 1) => {
  const [h, m] = hm.split(':').map(Number)
  return { date, dow, minutes: h * 60 + m }
}

test('schedules and cells are tidied; nothing set is any time', () => {
  assert.equal(cleanSchedule(null), null)
  assert.equal(cleanSchedule({ from: null, until: null, times: [] }), null, 'says nothing: any time')
  assert.deepEqual(cleanSchedule({ from: '2026-12-01', until: 'soon', times: [{ days: [5, 1, 1, 9, 'x'], start: '11:00:00', end: '15:00' }, { days: [1], start: 'noon', end: '15:00' }] }),
    { from: '2026-12-01', until: null, times: [{ days: [1, 5], start: '11:00', end: '15:00' }] }, 'days sorted, once each; seconds and bad times gone')
  assert.deepEqual(cleanCell({ use: 'own', times: LUNCH }), { use: 'own', times: LUNCH })
  assert.deepEqual(cleanCell({ use: 'own', times: { times: [] } }), { use: 'always', times: null }, 'own times with none set: any time')
  assert.deepEqual(cleanCell({ use: 'menu', times: LUNCH }), { use: 'menu', times: null }, 'times only kept with own')
  assert.deepEqual(cleanCell({ use: 'sometimes' }), { use: 'menu', times: null })
  assert.deepEqual(cleanCell(undefined), { use: 'menu', times: null })
  const r = cleanRow({ menu_id: 'm1', times: LUNCH, till: { use: 'always' }, kiosk: { use: 'off' } })
  assert.deepEqual(r, { menu_id: 'm1', times: LUNCH, web: { use: 'menu', times: null }, kiosk: { use: 'off', times: null }, till: { use: 'always', times: null } })
  assert.equal(isDefaultRow({ menu_id: 'm1' }), true)
  assert.equal(isDefaultRow({ menu_id: 'm1', web: { use: 'off' } }), true, 'web on / off lives in menu_ids')
  assert.equal(isDefaultRow({ menu_id: 'm1', times: LUNCH }), false)
  assert.equal(isDefaultRow({ menu_id: 'm1', till: { use: 'off' } }), false)
  assert.deepEqual(CHANNELS, ['web', 'kiosk', 'till'])
})

test('each channel follows the menu, any time, its own times, or is off', () => {
  const row = { menu_id: 'm1', times: LUNCH, web: { use: 'menu' }, kiosk: { use: 'own', times: DINNER }, till: { use: 'always' } }
  assert.deepEqual(channelTimes(row, 'web'), LUNCH)
  assert.deepEqual(channelTimes(row, 'kiosk'), DINNER)
  assert.equal(channelTimes(row, 'till'), null)
  assert.equal(channelTimes({ ...row, till: { use: 'off' } }, 'till'), false)
  assert.equal(channelTimes(undefined, 'till'), null, 'no row: any time')
  assert.equal(channelTimes({ menu_id: 'm1' }, 'kiosk'), null)
  assert.equal(channelLabel(row, 'web'), 'Mon–Fri 11:00–15:00')
  assert.equal(channelLabel(row, 'till'), 'Any time')
  assert.equal(channelLabel({ till: { use: 'off' } }, 'till'), 'Off')
  assert.equal(timesLabel(null), 'Any time')
  assert.equal(timesLabel(DINNER), 'Mon–Fri 17:00–22:00')
})

test('menus on now, in their order; the end minute counts', () => {
  const menus = [{ id: 'lunch', times: LUNCH }, { id: 'dinner', times: DINNER }, { id: 'drinks', times: null }]
  assert.deepEqual(menusOnNow(menus, at('12:00')), ['lunch', 'drinks'])
  assert.deepEqual(menusOnNow(menus, at('15:00')), ['lunch', 'drinks'], 'lunch until 15:00 takes 15:00')
  assert.deepEqual(menusOnNow(menus, at('15:01')), ['drinks'])
  assert.deepEqual(menusOnNow(menus, at('18:30')), ['dinner', 'drinks'])
  assert.deepEqual(menusOnNow(menus, at('12:00', '2026-11-07', 6)), ['drinks'], 'Saturday: no lunch')
  const dated = [{ id: 'xmas', times: { from: '2026-12-01', until: '2026-12-24', times: [] } }]
  assert.deepEqual(menusOnNow(dated, at('12:00')), [], 'not started yet')
  assert.deepEqual(menusOnNow(dated, at('12:00', '2026-12-10', 4)), ['xmas'])
  assert.deepEqual(menusOnNow(dated, at('12:00', '2026-12-25', 5)), [], 'ended')
})

test('the till shows the menus on now; a pick holds until they change', () => {
  const menus = [{ id: 'lunch', times: LUNCH }, { id: 'dinner', times: DINNER }, { id: 'drinks', times: null }]
  const noon = tillMenusShown(menus, at('12:00'))
  assert.deepEqual(noon, { ids: ['lunch', 'drinks'], auto: true, onNow: ['lunch', 'drinks'], basis: '2026-11-02|lunch,drinks', none: false })
  // Staff pick dinner at 12:00 (an early dinner order).
  const pick = { ids: ['dinner', 'drinks'], basis: noon.basis }
  assert.deepEqual(tillMenusShown(menus, at('14:30'), pick).ids, ['dinner', 'drinks'], 'still lunch time: the pick holds')
  assert.equal(tillMenusShown(menus, at('14:30'), pick).auto, false)
  const later = tillMenusShown(menus, at('15:30'), pick)
  assert.deepEqual(later.ids, ['drinks'], 'lunch ended: the menu times again')
  assert.equal(later.auto, true)
  assert.equal(tillMenusShown(menus, at('12:00', '2026-11-03', 2), pick).auto, true, 'the next day\'s lunch doesn\'t bring the pick back')
  assert.deepEqual(tillMenusShown(menus, at('12:00'), { ids: ['dinner', 'drinks'], basis: noon.basis }).ids, ['dinner', 'drinks'])
  assert.deepEqual(tillMenusShown(menus, at('12:00'), { ids: ['drinks', 'lunch'], basis: noon.basis }).ids, ['lunch', 'drinks'], 'the menus\' own order')
  assert.equal(tillMenusShown(menus, at('12:00'), { ids: ['gone'], basis: noon.basis }).auto, true, 'a pick of menus the till no longer has')
  const timed = [{ id: 'lunch', times: LUNCH }, { id: 'dinner', times: DINNER }]
  const gap = tillMenusShown(timed, at('16:00'))
  assert.deepEqual(gap.ids, ['lunch', 'dinner'], 'no menu on now: every menu, not none')
  assert.equal(gap.none, true)
  assert.equal(tillMenusShown([], at('16:00')).ids.length, 0)
})

test('the next menu to come on today', () => {
  const menus = [{ id: 'lunch', times: LUNCH }, { id: 'dinner', times: DINNER }, { id: 'drinks', times: null }]
  assert.equal(nextStart(menus, at('09:00')), '11:00')
  assert.equal(nextStart(menus, at('12:00')), '17:00')
  assert.equal(nextStart(menus, at('17:00')), null, 'starting now is on, not next')
  assert.equal(nextStart(menus, at('23:00')), null)
  assert.equal(nextStart(menus, at('09:00', '2026-11-07', 6)), null, 'nothing on Saturdays')
  assert.equal(nextStart([{ id: 'x', times: { ...LUNCH, from: '2026-12-01' } }], at('09:00')), null, 'not started yet')
})

test('problems stop a save; menus on together are only notes', () => {
  const names = { a: 'Lunch', b: 'Brunch', c: 'Drinks' }
  const bad = { from: null, until: null, times: [{ days: [], start: '11:00', end: '15:00' }] }
  assert.deepEqual(menuTimesProblems([{ menu_id: 'a', times: bad }], names), [{ menu_id: 'a', channel: null, message: 'Lunch: pick at least one day for each time.' }])
  assert.deepEqual(menuTimesProblems([{ menu_id: 'a', times: LUNCH, till: { use: 'own', times: { times: [{ days: [1], start: '15:00', end: '11:00' }] } } }], names),
    [{ menu_id: 'a', channel: 'till', message: 'Lunch on tills: each time must end after it starts (15:00–11:00).' }])
  assert.deepEqual(menuTimesProblems([{ menu_id: 'a', times: { from: '2026-12-02', until: '2026-12-01', times: [] } }], names)[0].message,
    'Lunch: the end date is before the start date.')
  assert.deepEqual(menuTimesProblems([{ menu_id: 'a', times: LUNCH, kiosk: { use: 'menu', times: bad } }], names), [], 'a cell not on own times isn\'t checked')
  const brunch = { from: null, until: null, times: [{ days: [5], start: '10:00', end: '12:00' }] }
  const rows = [
    { menu_id: 'a', times: LUNCH },
    { menu_id: 'b', times: brunch, web: { use: 'menu' }, kiosk: { use: 'off' }, till: { use: 'own', times: { times: [{ days: [6], start: '10:00', end: '12:00' }] } } },
    { menu_id: 'c' },
  ]
  const w = menuTimesWarnings(rows, names)
  assert.deepEqual(w.map(x => x.channel), ['web'], 'web only: off on kiosks, other days on tills, drinks any time')
  assert.deepEqual(w[0].menu_ids, ['a', 'b'])
  assert.equal(w[0].message, 'Lunch and Brunch are on at the same time on website: both show then.')
  const ended = [{ menu_id: 'a', times: { ...LUNCH, until: '2026-10-01' } }, { menu_id: 'b', times: brunch }]
  assert.deepEqual(menuTimesWarnings(ended, names, '2026-11-02'), [], 'a menu that has ended can\'t clash')
  const since = { from: '2026-01-01', until: null, times: [] }
  assert.deepEqual(menuTimesWarnings([{ menu_id: 'a', times: LUNCH }, { menu_id: 'c', times: since }], names, '2026-11-02'), [],
    'all day since a day gone by: any time, no note')
  assert.equal(menuTimesWarnings([{ menu_id: 'a', times: LUNCH }, { menu_id: 'c', times: { ...since, from: '2026-12-01' } }], names, '2026-11-02').length, 3,
    'all day from a day to come: it meets lunch on every channel')
})

test('scheduleError is the one check of a schedule; scheduleProblem still uses it', () => {
  assert.equal(scheduleError(null), null)
  assert.equal(scheduleError({ times: [{ days: [1], start: '11:00', end: '15:00' }, { days: [1, 2], start: '14:00', end: '16:00' }] }, 'Lunch'),
    'Lunch: its times overlap (11:00–15:00 and 14:00–16:00).')
  assert.equal(scheduleProblem(['a'], { a: { times: [{ days: [1], start: '12:00', end: '11:00' }] } }, { a: 'Lunch' }),
    'Lunch: each time must end after it starts (12:00–11:00).')
})
