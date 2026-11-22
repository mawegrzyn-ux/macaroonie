// Addresses that open a page at a venue, a day or a week, and a tab
// (shared/nav/links.js, docs/PEPPER_FIRST.md 4.6): what each page's record
// says it accepts, and pageLink() / linkValues() keeping only that, in a good
// shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_PAGES } from '../nav/index.js'
import { LINK_KEYS, isUuid, isDay, isMonday, pageAccepts, linkValues, pageLink } from '../nav/links.js'

const V = '3f2a6c1e-8b4d-4e2f-9a7c-1d2e3f4a5b6c'

test('a page record says what its address accepts, and the tabs when it takes one', () => {
  for (const p of NAV_PAGES) {
    if (p.accepts === undefined) { assert.equal(p.tabs, undefined, p.path + ': tabs without accepts'); continue }
    assert.ok(Array.isArray(p.accepts) && p.accepts.length, p.path + ': accepts is a list')
    for (const k of p.accepts) assert.ok(LINK_KEYS.includes(k), p.path + ': unknown key ' + k)
    assert.equal(new Set(p.accepts).size, p.accepts.length, p.path + ': a key once')
    if (p.accepts.includes('tab')) {
      assert.ok(Array.isArray(p.tabs) && p.tabs.length, p.path + ' takes a tab: it names its tabs')
      for (const t of p.tabs) assert.match(t, /^[a-z][a-z0-9_-]*$/, p.path + ': tab key ' + t)
    } else {
      assert.equal(p.tabs, undefined, p.path + ': tabs without tab in accepts')
    }
  }
})

test('the six pages of step 1 accept what they open at', () => {
  assert.deepEqual(pageAccepts('/timeline'), { keys: ['venue', 'date'], tabs: [] })
  assert.deepEqual(pageAccepts('/bookings'), { keys: ['venue', 'date'], tabs: [] })
  assert.deepEqual(pageAccepts('/rota'), { keys: ['venue', 'week'], tabs: [] })
  assert.deepEqual(pageAccepts('/food-safety'), { keys: ['venue', 'date', 'tab'], tabs: ['today', 'deliveries', 'holds', 'cooking'] })
  assert.deepEqual(pageAccepts('/orders'), { keys: ['venue', 'date', 'tab'], tabs: ['board', 'report', 'transactions'] })
  assert.deepEqual(pageAccepts('/cash-recon'), { keys: ['venue', 'date', 'week', 'tab'], tabs: ['week', 'wages'] })
  assert.deepEqual(pageAccepts('/menus'), { keys: [], tabs: [] }, 'a page that accepts nothing')
  assert.deepEqual(pageAccepts('/no-such-page'), { keys: [], tabs: [] })
})

test('the shapes: a uuid, a real day, a Monday', () => {
  assert.ok(isUuid(V) && isUuid(V.toUpperCase()))
  for (const bad of ['', 'ware', '1234', V.slice(1), V + 'a', null, 42]) assert.equal(isUuid(bad), false, String(bad))
  assert.ok(isDay('2026-11-22') && isDay('2028-02-29'))
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-11-2', '22/11/2026', '2026-11-22T10:00', '', null]) {
    assert.equal(isDay(bad), false, String(bad))
  }
  assert.ok(isMonday('2026-11-23'))
  assert.equal(isMonday('2026-11-22'), false, 'a Sunday')
  assert.equal(isMonday('2026-11-24'), false, 'a Tuesday')
})

test('pageLink keeps only what the page accepts, in the order venue, date, week, tab', () => {
  assert.equal(pageLink('/rota', { venue: V, week: '2026-11-23' }), '/rota?venue=' + V + '&week=2026-11-23')
  assert.equal(pageLink('/rota', { date: '2026-11-25', tab: 'pay' }), '/rota', 'the rota takes no day and no tab')
  assert.equal(pageLink('/timeline', { tab: 'today', date: '2026-11-22', venue: V, week: '2026-11-23' }),
    '/timeline?venue=' + V + '&date=2026-11-22')
  assert.equal(pageLink('/food-safety', { venue: V, date: '2026-11-22', tab: 'holds' }),
    '/food-safety?venue=' + V + '&date=2026-11-22&tab=holds')
  assert.equal(pageLink('/cash-recon', { week: '2026-11-23', tab: 'wages' }), '/cash-recon?week=2026-11-23&tab=wages')
  assert.equal(pageLink('/orders', { tab: 'transactions' }), '/orders?tab=transactions')
  assert.equal(pageLink('/menus', { venue: V, date: '2026-11-22' }), '/menus', 'a page that accepts nothing gets its path')
  assert.equal(pageLink('/rota'), '/rota')
})

test('pageLink drops a value in a bad shape, and a tab the page does not have', () => {
  assert.equal(pageLink('/rota', { venue: 'Ware', week: '2026-11-25' }), '/rota', 'a venue by name, a week not a Monday')
  assert.equal(pageLink('/bookings', { venue: V, date: '2026-02-30' }), '/bookings?venue=' + V)
  assert.equal(pageLink('/orders', { tab: 'Board' }), '/orders', 'tab keys as written')
  assert.equal(pageLink('/orders', { tab: 'wages' }), '/orders', 'another page\'s tab')
  assert.equal(pageLink('/timeline', { venue: V.toUpperCase() }), '/timeline?venue=' + V, 'a venue id in lowercase')
  assert.equal(pageLink('/timeline', { venue: ' ' + V + ' ', date: null }), '/timeline?venue=' + V)
})

test('linkValues reads an address as the page does', () => {
  const q = new URLSearchParams('venue=' + V + '&date=2026-11-22&tab=holds&order=abc&week=2026-11-23')
  assert.deepEqual(linkValues('/food-safety', q), { venue: V, date: '2026-11-22', tab: 'holds' })
  assert.deepEqual(linkValues('/rota', q), { venue: V, week: '2026-11-23' })
  assert.deepEqual(linkValues('/rota', new URLSearchParams('week=2026-11-24')), {})
  assert.deepEqual(linkValues('/menus', q), {})
  assert.deepEqual(linkValues('/orders', {}), {})
  assert.deepEqual(linkValues('/orders', null), {})
})
