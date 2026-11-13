// The report builder's rules (shared/reports/build.js) on a small catalogue:
// what each field, figure and link can be in a report, the Data panel's
// tree, the words on the shelves and each edit a person can make.
//
// That everything offered really runs is checked against the real catalogue
// and the engine in api/test/reports-build.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseReport, reportProblems, rowId, LIMITS } from '../reports/spec.js'
import {
  pathUses, dataTree, treeNodes, searchTree, rowName, valueName, valueKindText, linkTrail,
  filterShape, filterOps, filterValueKind, filterValueOk, blankValue, shownNumber, storedNumber, filterWords, filterParts, paramWords,
  usedParams, paramInputs, paramKeyFor,
  roomLeft, addRow, addColumn, removeRow, removeColumn, moveRow, moveColumn, updateRow,
  addValue, updateValue, removeValue, moveValue, valueReaders, addFilter, setFilter, removeFilter, setParamDefault,
  setSort, setLimit, limitOf, setTotals, setCompare, compareProblem, setKind, startReport, sortChoices,
  drillRoom, addDrillLevel, removeDrillLevel, moveDrillLevel, updateDrillLevel, setDrillRows, drillLevels,
  setView, viewOptions,
} from '../reports/build.js'

const f = (key, label, type, more = {}) => [key, { key, label, type, ...more }]
const fields = list => Object.fromEntries(list)
const m = (key, label, type, more) => [key, { key, label, type, ...more }]
const link = (key, label, to, more = {}) => [key, { key, label, to, ...more }]

// Checks have lines and payments (several each), a server, a venue and a
// trading day; a line has its check, its dish and the venue. A venue has
// its staff (a list with nothing that adds up); a person has a manager
// (another person) and the dishes they added (a list, named as the checks'
// own list of dishes is).
const CAT = {
  subjects: {
    venue: {
      key: 'venue', label: 'Venues', one: 'venue', name: 'name', base: true, dated: false, venue: false, about: 'Your venues.',
      fields: fields([f('name', 'Name', 'text'), f('active', 'In use', 'yesno')]),
      measures: {}, links: fields([link('staff', 'Staff', 'staff', { many: true })]), list: ['name'],
    },
    staff: {
      key: 'staff', label: 'Staff', one: 'person', name: 'name', base: false, dated: false, venue: true,
      fields: fields([f('name', 'Name', 'text'), f('rate', 'Hourly rate', 'money')]),
      measures: {}, list: ['name'],
      links: fields([link('venue', 'Venue', 'venue'), link('manager', 'Manager', 'staff'), link('lines', 'Dishes they added', 'lines', { many: true })]),
    },
    dishes: {
      key: 'dishes', label: 'Dishes', one: 'dish', name: 'name', base: true, dated: false, venue: false,
      fields: fields([f('name', 'Name', 'text'), f('price', 'Price', 'money')]),
      measures: fields([m('dishes', 'Dishes', 'number', { agg: 'count', across: true })]), links: {}, list: ['name', 'price'],
    },
    checks: {
      key: 'checks', label: 'Checks', one: 'check', name: 'number', base: true, dated: true, venue: true, about: 'Every check.',
      fields: fields([
        f('date', 'Trading day', 'date', { about: 'The day the till counts it on.' }),
        f('number', 'Check', 'text'),
        f('status', 'Status', 'choice', { labels: { open: 'Open', closed: 'Closed', void: 'Void' } }),
        f('covers', 'Guests', 'number', { adds: true }),
        f('order_no', 'Order number', 'number'),
        f('net', 'Net', 'money', { adds: true }),
        f('share', 'Discount rate', 'percent'),
        f('time_open', 'Time open', 'duration'),
        f('opened_at', 'Opened', 'moment'),
        f('paid', 'Paid in full', 'yesno'),
        f('tab_name', 'Name on the order', 'text', { pii: true }),
        f('at', 'Time of day', 'time'),
      ]),
      measures: fields([
        m('checks', 'Checks', 'number', { agg: 'count', across: true }),
        m('net_sales', 'Net sales', 'money', { agg: 'sum', across: true, about: 'Gross less discounts.' }),
        m('average_check', 'Average check', 'money', { ratio: true, across: true }),
        m('typical', 'Typical check', 'money', { agg: 'avg' }),
        m('servers', 'Servers', 'number', { agg: 'count_distinct' }),
      ]),
      links: fields([
        link('venue', 'Venue', 'venue'), link('server', 'Server', 'staff'),
        link('lines', 'Dishes sold', 'lines', { many: true }), link('payments', 'Payments', 'payments', { many: true }),
      ]),
      list: ['number', 'date', 'venue.name', 'server.name', 'covers', 'net', 'status'],
    },
    lines: {
      key: 'lines', label: 'Dishes sold', one: 'dish sold', name: 'name', base: true, dated: true, venue: true,
      fields: fields([
        f('date', 'Trading day', 'date'), f('name', 'Dish', 'text'), f('qty', 'Quantity', 'number', { adds: true }),
        f('unit_price', 'Price each', 'money'), f('net', 'Net', 'money', { adds: true }),
      ]),
      measures: fields([
        m('qty_sold', 'Quantity sold', 'number', { agg: 'sum', across: true }),
        m('net_sales', 'Net sales', 'money', { agg: 'sum', across: true }),
        m('average_price', 'Average price', 'money', { ratio: true, across: true }),
        m('dishes', 'Different dishes', 'number', { agg: 'count_distinct' }),
      ]),
      links: fields([
        link('venue', 'Venue', 'venue'), link('check', 'Check', 'checks'), link('dish', 'Dish on the menu', 'dishes'),
        link('added_by', 'Added by', 'staff'),
      ]),
      list: ['date', 'check.number', 'name', 'qty', 'net'],
    },
    payments: {
      key: 'payments', label: 'Payments', one: 'payment', base: true, dated: true, venue: true,
      fields: fields([f('date', 'Trading day', 'date'), f('tender', 'Tender', 'choice', { labels: { cash: 'Cash', card: 'Card' } }), f('amount', 'Amount', 'money')]),
      measures: fields([m('taken', 'Taken', 'money', { agg: 'sum', across: true })]),
      links: fields([link('venue', 'Venue', 'venue'), link('check', 'Check', 'checks')]),
      list: ['date', 'tender', 'amount'],
    },
  },
}
const uses = path => pathUses(CAT, 'checks', path)
const aggs = path => uses(path).values.map(v => v.measure ? 'figure' : v.agg)

test('what a field, a figure or a link can be in a report', () => {
  // The report's own fields.
  assert.deepEqual([uses('number').group, uses('number').column, aggs('number'), uses('number').filter], [true, true, ['count_distinct'], 'value'])
  assert.deepEqual(uses('number').buckets, [])
  assert.deepEqual(aggs('covers'), ['sum', 'avg', 'min', 'max'])
  assert.deepEqual(aggs('order_no'), ['avg', 'min', 'max'], 'a number that isn\'t an amount is never added up')
  assert.deepEqual(aggs('net'), ['sum', 'avg', 'min', 'max'])
  assert.deepEqual(aggs('share'), ['avg', 'min', 'max'])
  assert.deepEqual(aggs('time_open'), ['avg', 'min', 'max'])
  assert.deepEqual(aggs('status'), ['count_distinct'])
  assert.deepEqual(aggs('paid'), ['count_distinct'])
  assert.deepEqual(uses('date').buckets, ['day', 'week', 'month', 'quarter', 'year', 'weekday'])
  assert.deepEqual(uses('opened_at').buckets, ['day', 'week', 'month', 'quarter', 'year', 'weekday', 'hour'])
  assert.equal(uses('at').filter, null, 'a time of day can be shown and grouped by, not filtered')
  assert.equal(uses('at').group, true)
  assert.deepEqual([uses('net').what, uses('net').type, uses('net').label], ['field', 'money', 'Net'])

  // Its own figures: values, nothing else.
  for (const key of ['checks', 'net_sales', 'average_check', 'typical', 'servers']) {
    const u = uses(key)
    assert.deepEqual([u.what, u.group, u.column, u.filter, u.values], ['measure', false, false, null, [{ measure: key }]], key)
  }

  // Something each row has one of: its fields can be shown, grouped by and
  // filtered, but a number of it is never added up or averaged.
  assert.deepEqual([uses('server.name').group, uses('server.name').column, uses('server.name').filter, aggs('server.name')], [true, true, 'value', ['count_distinct']])
  assert.equal(uses('server.name').label, 'Server')
  assert.deepEqual(aggs('server.rate'), ['min', 'max'])
  assert.deepEqual(pathUses(CAT, 'lines', 'check.net').values.map(v => v.agg), ['min', 'max'], 'a check\'s net would be added once for each of its lines')
  assert.equal(uses('server.rate').label, 'Server hourly rate')
  assert.deepEqual(aggs('server.venue.name'), ['count_distinct'])
  // The linked thing itself: how many different, and the venue by the venues asked for.
  assert.deepEqual([uses('server').what, uses('server').type, uses('server').group, uses('server').column, uses('server').filter, uses('server').values],
    ['link', 'id', false, false, null, [{ agg: 'count_distinct', field: 'server' }]])
  assert.equal(uses('venue').filter, 'venues')
  assert.equal(uses('server.venue').filter, 'venues')
  // A figure of it would count once for each of our rows.
  assert.deepEqual(pathUses(CAT, 'lines', 'check.net_sales').values, [])
  assert.deepEqual(pathUses(CAT, 'lines', 'dish.dishes').values, [])

  // Rows there are several of: only what adds up, straight off the report's own rows.
  assert.deepEqual(uses('lines').values, [])
  assert.deepEqual([uses('lines').group, uses('lines').column, uses('lines').filter], [false, false, null])
  assert.deepEqual(aggs('lines.qty'), ['sum', 'min', 'max'])
  assert.deepEqual([uses('lines.qty').group, uses('lines.qty').column, uses('lines.qty').filter], [false, false, null])
  assert.deepEqual(aggs('lines.unit_price'), [], 'a price each doesn\'t add up')
  assert.deepEqual(aggs('lines.name'), [])
  assert.deepEqual(uses('lines.qty_sold').values, [{ measure: 'lines.qty_sold' }])
  assert.deepEqual(uses('lines.average_price').values, [{ measure: 'lines.average_price' }], 'one total over another still adds up')
  assert.deepEqual(uses('lines.dishes').values, [], 'how many different doesn\'t')
  assert.equal(uses('lines.qty_sold').label, 'Quantity sold (dishes sold)')
  // Not through anything else: a line's dish, a server's checks' lines.
  assert.deepEqual(uses('lines.dish.price').values, [])
  assert.deepEqual(uses('lines.dish.dishes').values, [])
  assert.deepEqual(uses('lines.dish').values, [])
  assert.deepEqual(pathUses(CAT, 'lines', 'check.payments.taken').values, [])
  assert.deepEqual(pathUses(CAT, 'lines', 'check.lines.qty').values, [])

  // Not in the catalogue.
  assert.deepEqual(uses('nothing'), { ok: false, why: 'Checks has nothing called "nothing"' })
  assert.equal(uses('server.nothing').ok, false)
  assert.equal(pathUses(CAT, 'nowhere', 'name').ok, false)
})

test('the Data panel: figures, fields, then a folder for each linked thing', () => {
  const tree = dataTree(CAT, 'checks')
  assert.deepEqual(tree.subject, { key: 'checks', label: 'Checks', one: 'check', about: 'Every check.', dated: true, venue: true })
  assert.deepEqual(tree.figures.map(n => n.path), ['checks', 'net_sales', 'average_check', 'typical', 'servers'])
  assert.deepEqual(tree.fields.map(n => n.path), ['date', 'number', 'status', 'covers', 'order_no', 'net', 'share', 'time_open', 'opened_at', 'paid', 'tab_name', 'at'])
  assert.deepEqual(tree.folders.map(x => [x.key, x.label, x.many, x.to]), [
    ['venue', 'Venue', false, 'venue'], ['server', 'Server', false, 'staff'], ['lines', 'Dishes sold', true, 'lines'], ['payments', 'Payments', true, 'payments'],
  ])
  const net = tree.fields.find(n => n.path === 'net')
  assert.deepEqual({ ...net, uses: null }, { path: 'net', what: 'field', label: 'Net', full: 'Net', about: '', type: 'money', pii: false, trail: [], uses: null })
  assert.equal(tree.fields.find(n => n.path === 'tab_name').pii, true)
  assert.equal(tree.fields.find(n => n.path === 'date').about, 'The day the till counts it on.')

  // A linked thing: itself (how many different, the venues to ask for), its fields, its own links.
  const [venue, server, lines, payments] = tree.folders
  assert.deepEqual([venue.node.path, venue.node.uses.filter, venue.fields.map(n => n.path), venue.folders], ['venue', 'venues', ['venue.name', 'venue.active'], []])
  assert.deepEqual(server.fields.map(n => [n.path, n.label, n.full, n.trail]), [
    ['server.name', 'Name', 'Server', ['Server']], ['server.rate', 'Hourly rate', 'Server hourly rate', ['Server']],
  ])
  assert.deepEqual(server.figures, [])
  // The server's venue is the check's own venue: not offered twice. Nor is
  // the server's manager (a person again), nor the dishes the server added:
  // a list of rows is offered straight off the report's own rows only.
  assert.deepEqual(server.folders, [])
  assert.deepEqual(venue.folders, [])

  // Rows there are several of: what adds up, and nothing further down.
  assert.deepEqual([lines.node, lines.figures.map(n => n.path), lines.fields.map(n => n.path), lines.folders], [null, ['lines.qty_sold', 'lines.net_sales', 'lines.average_price'], ['lines.qty', 'lines.net'], []])
  assert.deepEqual([payments.figures.map(n => n.path), payments.fields.map(n => n.path)], [['payments.taken'], []])
  assert.deepEqual(lines.figures[0].trail, ['Dishes sold'])

  // From a line: its check (and the check's server, a different person from
  // whoever added the line), never round to the check's lines again, and
  // the check's venue only once, as the line's own.
  const fromLine = dataTree(CAT, 'lines')
  const check = fromLine.folders.find(x => x.key === 'check')
  assert.deepEqual(check.figures, [], 'a check\'s figures would count once for every line')
  assert.deepEqual(check.folders.map(x => x.path), ['check.server'])
  assert.deepEqual(check.folders[0].fields.map(n => [n.path, n.full, n.trail]), [
    ['check.server.name', 'Server', ['Check', 'Server']], ['check.server.rate', 'Server hourly rate', ['Check', 'Server']],
  ])
  assert.deepEqual(check.folders[0].folders, [], 'two links down and no further')
  assert.deepEqual(fromLine.folders.map(x => x.key), ['venue', 'check', 'dish', 'added_by'])
  assert.deepEqual(fromLine.folders.find(x => x.key === 'added_by').folders, [])

  // One link down only.
  assert.deepEqual(dataTree(CAT, 'lines', { depth: 1 }).folders.find(x => x.key === 'check').folders, [])
  assert.deepEqual(dataTree(CAT, 'lines', { depth: 0 }).folders, [])
  assert.equal(dataTree(CAT, 'nowhere'), null)

  // A list with nothing that adds up (a venue's staff) isn't a folder at all.
  assert.deepEqual(dataTree(CAT, 'venue').folders, [])
  // A person's manager is offered once, not the manager's manager.
  const person = dataTree(CAT, 'staff')
  assert.deepEqual(person.folders.map(x => [x.path, x.folders.map(y => y.path)]), [['venue', []], ['manager', []], ['lines', []]])
  assert.deepEqual(person.folders[1].fields.map(n => n.path), ['manager.name', 'manager.rate'])

  // In the order the panel shows them.
  assert.deepEqual(treeNodes(dataTree(CAT, 'venue')).map(n => n.path), ['name', 'active'])
  assert.deepEqual(treeNodes(tree).slice(-9).map(n => n.path), [
    'server', 'server.name', 'server.rate', 'lines.qty_sold', 'lines.net_sales', 'lines.average_price', 'lines.qty', 'lines.net', 'payments.taken',
  ])
  assert.deepEqual(treeNodes(null), [])
})

test('searching the Data panel', () => {
  const tree = dataTree(CAT, 'checks')
  const found = q => searchTree(tree, q).map(n => n.path)
  // Names that start with it first, then names that hold it, then folders and what things are about.
  assert.deepEqual(found('net'), ['net_sales', 'net', 'lines.net_sales', 'lines.net'])
  assert.deepEqual(found('server'), ['servers', 'server', 'server.name', 'server.rate'])
  // Ranked, not in the panel's own order (there: Checks, Average check, Typical check, Check number).
  assert.deepEqual(found('check'), ['checks', 'number', 'average_check', 'typical'])
  assert.deepEqual(found('in'), ['venue.active', 'date', 'paid'])
  assert.deepEqual(found('SOLD quantity'), ['lines.qty_sold', 'lines.qty'])
  assert.deepEqual(found('discounts'), ['net_sales'], 'by what it is about')
  assert.deepEqual(found('till'), ['date'])
  assert.deepEqual(found('  '), [])
  assert.deepEqual(found('zebra'), [])
  assert.deepEqual(searchTree(null, 'net'), [])
})

test('what the shelves say', () => {
  assert.equal(rowName(CAT, 'checks', { field: 'server.name' }), 'Server')
  assert.equal(rowName(CAT, 'checks', { field: 'date', bucket: 'week' }), 'Week')
  assert.equal(rowName(CAT, 'checks', { field: 'opened_at', bucket: 'hour' }), 'Opened (hour)')
  assert.equal(rowName(CAT, 'checks', { field: 'date', label: 'Day' }), 'Day')

  const name = v => valueName(CAT, 'checks', v)
  assert.equal(name({ measure: 'net_sales' }), 'Net sales')
  assert.equal(name({ measure: 'lines.qty_sold' }), 'Quantity sold (dishes sold)')
  assert.equal(name({ agg: 'sum', field: 'net' }), 'Total net')
  assert.equal(name({ agg: 'avg', field: 'covers' }), 'Average guests')
  assert.equal(name({ agg: 'min', field: 'server.rate' }), 'Smallest server hourly rate')
  assert.equal(name({ agg: 'max', field: 'lines.qty' }), 'Largest dishes sold quantity')
  assert.equal(name({ agg: 'count_distinct', field: 'server' }), 'Server (how many different)')
  assert.equal(name({ agg: 'count', field: 'tab_name' }), 'Name on the order (how many)')
  assert.equal(name({ agg: 'count' }), 'Checks')
  assert.equal(name({ calc: 'a / b' }), 'Calculation')
  assert.equal(name({ agg: 'sum', of: 'net * 2' }), 'Total')
  assert.equal(name({ measure: 'net_sales', label: 'Sales' }), 'Sales')
  assert.equal(name(null), '')

  assert.deepEqual([{ measure: 'x' }, { calc: 'a' }, { agg: 'sum', of: 'a' }, { agg: 'count' }, { agg: 'count', field: 'a' }, { agg: 'avg', field: 'a' }, { agg: 'count_distinct', field: 'a' }].map(valueKindText),
    ['Figure', 'Calculation', 'Total of a calculation', 'How many rows', 'How many', 'Average', 'How many different'])

  // How a field is reached, for "how this is linked".
  assert.deepEqual(linkTrail(CAT, 'lines', 'check.server.name'), ['Dishes sold', 'Check', 'Server'])
  assert.deepEqual(linkTrail(CAT, 'lines', 'added_by.name'), ['Dishes sold', 'Added by'])
  assert.deepEqual(linkTrail(CAT, 'checks', 'lines.qty_sold'), ['Checks', 'Dishes sold'])
  assert.deepEqual(linkTrail(CAT, 'checks', 'venue'), ['Checks', 'Venue'])
  assert.deepEqual(linkTrail(CAT, 'checks', 'net'), [], 'a field of the report\'s own rows has no links to say')
  assert.deepEqual(linkTrail(CAT, 'checks', 'nothing.here'), [])
})

test('filters: the ways a field can be filtered and what each takes', () => {
  assert.deepEqual(['empty', 'not_empty', 'in', 'not_in', 'between', 'in_period', 'is', 'gte', 'contains'].map(filterShape),
    ['none', 'none', 'many', 'many', 'two', 'period', 'one', 'one', 'one'])

  // The usual way first.
  assert.deepEqual(filterOps('text'), ['in', 'is', 'is_not', 'not_in', 'contains', 'not_contains', 'starts_with', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('choice'), ['in', 'is', 'is_not', 'not_in', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('money'), ['gte', 'is', 'is_not', 'gt', 'lt', 'lte', 'between', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('number')[0], 'gte')
  assert.deepEqual(filterOps('duration'), ['gte', 'gt', 'lt', 'lte', 'between', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('date'), ['in_period', 'is', 'before', 'after', 'between', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('moment')[0], 'in_period')
  assert.deepEqual(filterOps('yesno'), ['is'])
  assert.deepEqual(filterOps('nothing'), [])
  // A day of the week is picked from the seven; an hour, a week or a month is compared.
  assert.deepEqual(filterOps('moment', 'weekday'), ['in', 'not_in'])
  assert.deepEqual(filterOps('moment', 'hour'), ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'])
  assert.deepEqual(filterOps('date', 'month'), filterOps('moment', 'hour'))
  assert.deepEqual(filterOps('date', 'day'), filterOps('date'))

  assert.deepEqual([
    filterValueKind('text', null, 'is'), filterValueKind('choice', null, 'in'), filterValueKind('money', null, 'gte'), filterValueKind('duration', null, 'lt'),
    filterValueKind('yesno', null, 'is'), filterValueKind('date', null, 'in_period'), filterValueKind('date', null, 'before'), filterValueKind('moment', null, 'is'),
    filterValueKind('moment', 'weekday', 'in'), filterValueKind('moment', 'hour', 'between'), filterValueKind('date', 'month', 'is'),
  ], ['text', 'choice', 'number', 'number', 'yesno', 'period', 'day', 'day', 'weekday', 'hour', 'day'])

  const ok = (type, bucket, op, value) => filterValueOk(type, bucket, op, value)
  assert.equal(ok('text', null, 'empty'), true)
  assert.deepEqual([ok('text', null, 'is', 'a'), ok('text', null, 'is', ''), ok('text', null, 'is', '  '), ok('text', null, 'is', 3)], [true, false, false, false])
  assert.deepEqual([ok('text', null, 'in', ['a']), ok('text', null, 'in', []), ok('text', null, 'in', 'a'), ok('text', null, 'in', ['a', ''])], [true, false, false, false])
  assert.deepEqual([ok('money', null, 'gte', 0), ok('money', null, 'gte', '5'), ok('money', null, 'gte', NaN)], [true, false, false])
  assert.deepEqual([ok('money', null, 'between', [1, 2]), ok('money', null, 'between', [1]), ok('money', null, 'between', [1, null])], [true, false, false])
  assert.deepEqual([ok('date', null, 'in_period', { relative: 'last_week' }), ok('date', null, 'in_period', { relative: 'whenever' }), ok('date', null, 'in_period', null)], [true, false, false])
  assert.deepEqual([ok('date', null, 'is', '2026-11-12'), ok('date', null, 'is', '12/11/2026')], [true, false])
  assert.deepEqual([ok('moment', 'weekday', 'in', [1, 7]), ok('moment', 'weekday', 'in', [0]), ok('moment', 'weekday', 'in', [8])], [true, false, false])
  assert.deepEqual([ok('moment', 'hour', 'between', [0, 23]), ok('moment', 'hour', 'is', 24), ok('moment', 'hour', 'is', 9.5)], [true, false, false])
  assert.deepEqual([ok('yesno', null, 'is', true), ok('yesno', null, 'is', false), ok('yesno', null, 'is', 'yes')], [true, true, false])
  assert.equal(ok('text', null, 'in', Array.from({ length: LIMITS.in_values + 1 }, (_, i) => 'v' + i)), false)

  // Nothing picked: no value, no ticks, a range with both ends empty. Half a
  // range, a zero, a No and something typed that isn't a number are not nothing.
  assert.deepEqual([blankValue(null), blankValue(undefined), blankValue(''), blankValue([]), blankValue([null, null]), blankValue(['', null])], [true, true, true, true, true, true])
  assert.deepEqual([blankValue(0), blankValue(false), blankValue(NaN), blankValue([1, null]), blankValue([null, 0]), blankValue(['a']), blankValue({ relative: 'today' })],
    [false, false, false, false, false, false, false])

  // A percentage is typed as per cent and a length of time in minutes.
  assert.deepEqual([storedNumber('percent', '20'), storedNumber('percent', '12.5'), storedNumber('duration', '1.5'), storedNumber('money', ' 1,250.50 '), storedNumber('number', '-3')],
    [0.2, 0.125, 90, 1250.5, -3])
  assert.deepEqual([storedNumber('money', ''), storedNumber('money', 'abc'), storedNumber('money', '1e5'), storedNumber('money', '1.2.3'), storedNumber('money', null)], [null, null, null, null, null])
  assert.deepEqual([shownNumber('percent', 0.2), shownNumber('percent', 0.125), shownNumber('duration', 90), shownNumber('money', 12.5), shownNumber('money', null), shownNumber('money', '5')],
    [20, 12.5, 1.5, 12.5, null, null])
  assert.equal(shownNumber('percent', storedNumber('percent', '33.3')), 33.3)
})

test('a filter said in words', () => {
  const ctx = { venues: [{ id: 'v1', name: 'Ware' }, { id: 'v2', name: 'Hertford' }, { id: 'v3', name: 'Hoddesdon' }, { id: 'v4', name: 'Harlow' }] }
  const say = (cond, more) => filterWords(CAT, 'checks', cond, { ...ctx, ...more })
  assert.equal(say({ field: 'status', op: 'in', value: ['closed'] }), 'Status is Closed')
  assert.equal(say({ field: 'status', op: 'in', value: ['closed', 'void'] }), 'Status is one of Closed, Void')
  assert.equal(say({ field: 'status', op: 'not_in', value: ['void'] }), 'Status is not Void')
  assert.equal(say({ field: 'status', op: 'is_not', value: 'open' }), 'Status is not Open')
  assert.equal(say({ field: 'number', op: 'in', value: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'Check is one of a, b, c, d and 2 more')
  assert.equal(say({ field: 'number', op: 'starts_with', value: 'T1' }), 'Check starts with T1')
  assert.equal(say({ field: 'tab_name', op: 'not_empty' }), 'Name on the order isn\'t empty')
  assert.equal(say({ field: 'net', op: 'between', value: [10, 20] }), 'Net is between £10.00 and £20.00')
  assert.equal(say({ field: 'share', op: 'gte', value: 0.2 }), 'Discount rate is at least 20.0%')
  assert.equal(say({ field: 'time_open', op: 'gt', value: 5400 }), 'Time open is more than 1 h 30 min')
  assert.equal(say({ field: 'paid', op: 'is', value: false }), 'Paid in full: no')
  assert.equal(say({ field: 'date', op: 'in_period', value: { relative: 'last_n_days', n: 30 } }), 'Trading day is in Last 30 days')
  assert.equal(say({ field: 'date', op: 'before', value: '2026-11-12' }), 'Trading day is before Thu 12 Nov 2026')
  assert.equal(say({ field: 'date', bucket: 'month', op: 'is', value: '2026-11-01' }), 'Month is Nov 2026')
  assert.equal(say({ field: 'opened_at', bucket: 'weekday', op: 'not_in', value: [1] }), 'Opened (day of the week) is not Monday')
  assert.equal(say({ field: 'server.name', op: 'contains', value: 'sam' }), 'Server contains sam')

  // The venues a report is opened for.
  const params = [{ key: 'venues', type: 'venues', default: 'all' }, { key: 'period', type: 'period', default: { relative: 'last_week' } }, { key: 'who', type: 'value', default: null }]
  assert.equal(say({ field: 'venue', op: 'in', param: 'venues' }, { params }), 'Venue: every venue')
  assert.equal(say({ field: 'venue', op: 'in', param: 'venues' }, { params: [{ key: 'venues', type: 'venues', default: ['v2', 'v1'] }] }), 'Venue: Hertford, Ware')
  assert.equal(say({ field: 'venue', op: 'in', param: 'venues' }, { params: [{ key: 'venues', type: 'venues', default: ['v1', 'v2', 'v3', 'v4'] }] }), 'Venue: Ware, Hertford, Hoddesdon and 1 more')
  assert.equal(say({ field: 'venue', op: 'in', param: 'venues' }, { params: [{ key: 'venues', type: 'venues', default: ['gone'] }] }), 'Venue: 1 venue')
  // Asked each time: what it starts as, or anything.
  assert.equal(say({ field: 'date', op: 'in_period', param: 'period' }, { params }), 'Trading day is in Last week')
  assert.equal(say({ field: 'server.name', op: 'is', param: 'who' }, { params }), 'Server: anything')
  assert.equal(say({ field: 'server.name', op: 'is', param: 'who' }, { params: [{ key: 'who', type: 'value', default: ['Sam', 'Jo'] }] }), 'Server is one of Sam, Jo')
  assert.equal(say({ field: 'status', op: 'in', param: 'who' }, { params: [{ key: 'who', type: 'value', default: 'closed' }] }), 'Status is Closed')

  // Rows of another kind, and either-or.
  assert.equal(say({ has: 'payments', where: [{ field: 'tender', op: 'is', value: 'cash' }, { field: 'amount', op: 'gt', value: 50 }] }), 'Has payments where Tender is Cash and Amount is more than £50.00')
  assert.equal(say({ has: 'lines', where: [], not: true }), 'Has no dishes sold')
  assert.equal(say({ any: [{ field: 'covers', op: 'gte', value: 8 }, { all: [{ field: 'paid', op: 'is', value: true }, { field: 'net', op: 'lt', value: 5 }] }] }),
    'Any of: Guests is at least 8; or All of: Paid in full: yes; and Net is less than £5.00')
  assert.equal(say(null), '')

  // The same words in two parts, for a shelf: what is filtered, and what it has to be.
  const parts = cond => filterParts(CAT, 'checks', cond, ctx)
  assert.deepEqual(parts({ field: 'status', op: 'in', value: ['closed', 'void'] }), { label: 'Status', rest: 'is one of Closed, Void', sep: ' ' })
  assert.deepEqual(parts({ field: 'paid', op: 'is', value: true }), { label: 'Paid in full', rest: 'yes', sep: ': ' })
  assert.deepEqual(parts({ field: 'tab_name', op: 'empty' }), { label: 'Name on the order', rest: 'is empty', sep: ' ' })
  assert.deepEqual(parts({ has: 'lines', where: [] }), { label: '', rest: 'Has dishes sold', sep: '' })
  assert.deepEqual(parts(null), { label: '', rest: '', sep: '' })
})

const base = () => startReport(CAT, 'checks')

test('a new report: something to show straight away, asking for the usual period and venues', () => {
  const s = base()
  assert.deepEqual(reportProblems(s), [])
  assert.deepEqual([s.kind, s.rows, s.values], ['summary', [{ field: 'date' }], [{ key: 'checks', measure: 'checks' }]])
  assert.deepEqual(s.params, [{ key: 'period', type: 'period', default: { relative: 'last_week' } }, { key: 'venues', type: 'venues', default: 'all' }])
  assert.deepEqual(s.filters, [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' }])
  // Nothing dated: a list of its usual columns. No venue: nothing to ask for.
  const dishes = startReport(CAT, 'dishes')
  assert.deepEqual([dishes.kind, dishes.rows, dishes.params, dishes.filters], ['list', [{ field: 'name' }, { field: 'price' }], [], []])
  assert.deepEqual(reportProblems(dishes), [])
})

test('groupings: added, moved across the top and back, reordered, grouped another way', () => {
  let s = addRow(base(), 'server.name')
  assert.deepEqual(s.rows.map(rowId), ['date', 'server.name'])
  assert.equal(addRow(s, 'server.name'), s, 'the same grouping twice is added once')
  s = addRow(s, { field: 'opened_at', bucket: 'hour' })
  assert.deepEqual(s.rows.map(rowId), ['date', 'server.name', 'opened_at:hour'])
  assert.deepEqual(moveRow(s, 2, 0).rows.map(rowId), ['opened_at:hour', 'date', 'server.name'])
  assert.equal(moveRow(s, 2, 2), s)
  assert.equal(moveRow(s, 0, 9), s)

  // Across the top: a table across. A grouping is in one place at a time.
  let x = addColumn(s, 'server.name')
  assert.deepEqual([x.kind, x.rows.map(rowId), x.columns.map(rowId)], ['matrix', ['date', 'opened_at:hour'], ['server.name']])
  x = addColumn(x, 'status')
  assert.deepEqual(x.columns.map(rowId), ['server.name', 'status'])
  assert.equal(addColumn(x, 'paid'), x, 'two across at most')
  assert.deepEqual(moveColumn(x, 0, 1).columns.map(rowId), ['status', 'server.name'])
  const back = addRow(x, 'server.name')
  assert.deepEqual([back.kind, back.rows.map(rowId), back.columns.map(rowId)], ['matrix', ['date', 'opened_at:hour', 'server.name'], ['status']])
  assert.equal(removeColumn(back, 'status').kind, 'summary')
  assert.deepEqual(removeRow(s, 'date').rows.map(rowId), ['server.name', 'opened_at:hour'])

  // Eight groupings at most.
  let full = base()
  for (const p of ['number', 'status', 'covers', 'order_no', 'net', 'share', 'paid', 'tab_name', 'server.name']) full = addRow(full, p)
  assert.equal(full.rows.length, LIMITS.rows)
  assert.equal(roomLeft(full).rows, 0)
  assert.equal(addRow(full, 'server.name'), full)

  // Grouped another way: what is sorted or subtotalled by it follows.
  let t = setTotals(setSort(addRow(base(), 'server.name'), [{ by: 'date', dir: 'desc' }]), { subtotals: ['date'] })
  t = updateRow(t, 'rows', 'date', { bucket: 'month' })
  assert.deepEqual([t.rows.map(rowId), t.sort, t.totals.subtotals], [['date:month', 'server.name'], [{ by: 'date:month', dir: 'desc' }], ['date:month']])
  t = updateRow(t, 'rows', 'date:month', { bucket: 'day', label: 'Day' })
  assert.deepEqual([t.rows[0], t.sort, t.totals.subtotals], [{ field: 'date', label: 'Day' }, [{ by: 'date', dir: 'desc' }], ['date']])
  assert.deepEqual(updateRow(t, 'rows', 'date', { label: '' }).rows[0], { field: 'date' })
  assert.equal(updateRow(t, 'rows', 'nothing', { label: 'x' }), t)
  // Not onto a grouping the report already has.
  const twice = addRow(addRow(base(), { field: 'date', bucket: 'week' }), 'status')
  assert.equal(updateRow(twice, 'rows', 'date', { bucket: 'week' }), twice)
  assert.deepEqual(updateRow(addColumn(twice, 'status'), 'columns', 'status', { label: 'State' }).columns, [{ field: 'status', label: 'State' }])

  // A list's columns: no grouping into weeks, thirty at most, and nothing across the top.
  const list = setKind(base(), 'list', CAT)
  assert.deepEqual(addRow(list, { field: 'opened_at', bucket: 'hour' }).rows.at(-1), { field: 'opened_at' })
  assert.equal(addColumn(list, 'status'), list)
  assert.equal(roomLeft(list).rows, LIMITS.list_columns - list.rows.length)
})

test('values: added once, renamed without losing their key, taken off', () => {
  let s = addValue(base(), { measure: 'net_sales' })
  assert.deepEqual(s.values.map(v => v.key), ['checks', 'net_sales'])
  assert.equal(addValue(s, { measure: 'net_sales' }), s)
  s = addValue(s, { agg: 'sum', field: 'covers' })
  assert.equal(addValue(s, { agg: 'sum', field: 'covers' }), s)
  s = addValue(s, { agg: 'avg', field: 'covers' })
  s = addValue(s, { calc: 'net_sales / checks', label: 'Each', format: 'money' })
  s = addValue(s, { calc: 'net_sales / checks', label: 'Each again' })
  assert.deepEqual(s.values.map(v => v.key), ['checks', 'net_sales', 'sum_covers', 'avg_covers', 'calc_1', 'calc_2'], 'a calculation can be there twice')
  assert.deepEqual(reportProblems(s), [])

  const named = updateValue(s, 'net_sales', { label: 'Sales', decimals: 0 })
  assert.deepEqual(named.values[1], { key: 'net_sales', measure: 'net_sales', label: 'Sales', decimals: 0 })
  assert.deepEqual(reportProblems(named), [], 'the calculations still read it')
  assert.deepEqual(updateValue(named, 'net_sales', { label: '', decimals: null }).values[1], { key: 'net_sales', measure: 'net_sales' })
  assert.equal(updateValue(s, 'calc_1', { hidden: true }).values[4].hidden, true)
  assert.equal(updateValue(updateValue(s, 'calc_1', { hidden: true }), 'calc_1', { hidden: false }).values[4].hidden, undefined)
  assert.equal(updateValue(s, 'calc_1', { calc: 'net_sales * 2' }).values[4].calc, 'net_sales * 2')

  assert.deepEqual(valueReaders(s, 'checks').map(v => v.key), ['calc_1', 'calc_2'])
  assert.deepEqual(valueReaders(s, 'sum_covers'), [])
  assert.deepEqual(valueReaders(s, 'net'), [], 'not a name that only starts the same')
  assert.ok(reportProblems(removeValue(s, 'checks')).length > 0, 'a calculation left reading nothing says so')
  assert.deepEqual(removeValue(s, 'avg_covers').values.map(v => v.key), ['checks', 'net_sales', 'sum_covers', 'calc_1', 'calc_2'])
  assert.deepEqual(moveValue(s, 0, 2).values.map(v => v.key).slice(0, 3), ['net_sales', 'sum_covers', 'checks'])

  // Twenty at most; none in a list.
  let full = base()
  for (let i = 0; i < 25; i++) full = addValue(full, { calc: 'checks * ' + (i + 1) })
  assert.equal(full.values.length, LIMITS.values)
  assert.equal(roomLeft(full).values, 0)
  const list = setKind(base(), 'list', CAT)
  assert.equal(addValue(list, { measure: 'net_sales' }), list)
})

test('filters: fixed or asked each time, with the parameters they need and no others', () => {
  let s = addFilter(base(), { field: 'status', op: 'in', value: ['closed'] })
  assert.deepEqual(s.filters[2], { field: 'status', op: 'in', value: ['closed'] })
  assert.deepEqual(s.params.map(p => p.key), ['period', 'venues'])
  s = addFilter(s, { field: 'tab_name', op: 'not_empty' })
  assert.deepEqual(s.filters[3], { field: 'tab_name', op: 'not_empty' })
  s = addFilter(s, { field: 'opened_at', bucket: 'hour', op: 'between', value: [12, 14] })
  assert.deepEqual(s.filters[4], { field: 'opened_at', bucket: 'hour', op: 'between', value: [12, 14] })

  // Asked each time: a parameter that starts at the value given.
  let a = setFilter(s, 2, { field: 'status', op: 'in', value: ['closed'] }, { ask: true, label: 'Which checks' })
  assert.deepEqual(a.filters[2], { field: 'status', op: 'in', param: 'status' })
  assert.deepEqual(a.params[2], { key: 'status', type: 'value', label: 'Which checks', default: ['closed'] })
  assert.deepEqual([...usedParams(a)], ['period', 'venues', 'status'])
  // The same one again keeps its parameter; fixed again drops it.
  a = setFilter(a, 2, { field: 'status', op: 'not_in', value: ['void'] }, { ask: true })
  assert.deepEqual(a.params[2], { key: 'status', type: 'value', default: ['void'] })
  assert.equal(a.params.length, 3)
  assert.deepEqual(setFilter(a, 2, { field: 'status', op: 'is', value: 'open' }).params.map(p => p.key), ['period', 'venues'])
  // A period of its own, and venues through another link.
  const p = addFilter(base(), { field: 'opened_at', op: 'in_period', value: { relative: 'this_month' } }, { ask: true })
  assert.deepEqual(p.params[2], { key: 'opened_at', type: 'period', default: { relative: 'this_month' } })
  const v = addFilter(startReport(CAT, 'dishes'), { field: 'name', op: 'contains', value: 'x' }, { ask: true })
  assert.deepEqual(v.params, [{ key: 'name', type: 'value', default: 'x' }])
  const sv = addFilter(removeFilter(base(), 1), { field: 'server.venue', op: 'in' }, { ask: true, venues: true })
  assert.deepEqual([sv.filters.at(-1), sv.params.at(-1)], [{ field: 'server.venue', op: 'in', param: 'venues' }, { key: 'venues', type: 'venues', default: 'all' }])
  // Asked with nothing to start from: it filters nothing until something is picked.
  const blank = addFilter(base(), { field: 'server.name', op: 'in' }, { ask: true })
  assert.deepEqual([blank.filters[2], blank.params[2]], [{ field: 'server.name', op: 'in', param: 'server_name' }, { key: 'server_name', type: 'value', default: null }])

  // Keys never clash, and are names the definition takes.
  assert.equal(paramKeyFor(a, 'status'), 'status_2')
  assert.equal(paramKeyFor(base(), 'date', { op: 'in_period' }), 'period_2')
  assert.equal(paramKeyFor(startReport(CAT, 'dishes'), 'date', { op: 'in_period' }), 'period')
  assert.equal(paramKeyFor(base(), 'server.venue', { venues: true }), 'venues_2')
  assert.equal(paramKeyFor(base(), 'opened_at', { bucket: 'hour' }), 'opened_at_hour')
  assert.equal(paramKeyFor(base(), 'check.server.venue.a_very_long_name_indeed.and_more'), 'check_server_venue_a_very_')
  assert.equal(paramKeyFor(base(), '9lives'), 'p_9lives')

  // Taken off: its parameter goes when nothing else asks for it.
  assert.deepEqual(removeFilter(a, 2).params.map(x => x.key), ['period', 'venues'])
  const shared = normaliseReport({ ...a, filters: [...a.filters, { field: 'server.name', op: 'is', param: 'status' }] })
  assert.deepEqual(removeFilter(shared, 2).params.map(x => x.key), ['period', 'venues', 'status'])
  assert.deepEqual(removeFilter(base(), 0).params, [{ key: 'venues', type: 'venues', default: 'all' }])
  // Thirty at most, and twelve things to ask for.
  let full = base()
  for (let i = 0; i < 40; i++) full = addFilter(full, { field: 'covers', op: 'gte', value: i })
  assert.equal(full.filters.length, LIMITS.filters)
  assert.equal(addFilter(full, { field: 'covers', op: 'gte', value: 99 }), full, 'no room: the report is handed back as it was')
  let asks = base()
  for (let i = 0; i < 20; i++) asks = addFilter(asks, { field: 'covers', op: 'gte', value: i }, { ask: true })
  assert.equal(asks.params.length, LIMITS.params)
  assert.equal(asks.filters.length, LIMITS.params)
  assert.equal(addFilter(asks, { field: 'covers', op: 'gte', value: 99 }, { ask: true }), asks, 'and so it is with nothing left to ask')
  assert.equal(roomLeft(asks).params, 0)

  // The report's usual choices.
  assert.deepEqual(setParamDefault(base(), 'period', { relative: 'today' }).params[0].default, { relative: 'today' })
  const V1 = '11111111-1111-4111-8111-111111111111'
  assert.deepEqual(setParamDefault(base(), 'venues', [V1]).params[1].default, [V1])
  assert.equal(setParamDefault(base(), 'venues', ['not an id']).params[1].default, 'all')
  assert.deepEqual(setParamDefault(base(), 'period', 'nonsense').params[0].default, { relative: 'last_week' })
  assert.deepEqual(setParamDefault(base(), 'nothing', 1), base())
  // Only the one named changes.
  const twoAsked = addFilter(a, { field: 'net', op: 'gte', value: 20 }, { ask: true })
  assert.deepEqual(setParamDefault(twoAsked, 'status', ['open']).params.map(x => x.default), [{ relative: 'last_week' }, 'all', ['open'], 20])
})

test('what a report asks for when it is opened', () => {
  let s = addFilter(base(), { field: 'status', op: 'in', value: ['closed'] }, { ask: true, label: 'Which checks' })
  s = addFilter(s, { field: 'net', op: 'gte', value: 20 }, { ask: true })
  s = addFilter(s, { field: 'opened_at', bucket: 'weekday', op: 'in', value: [5, 6] }, { ask: true })
  s = addFilter(s, { field: 'paid', op: 'is', value: true }, { ask: true })
  s = addFilter(s, { field: 'server.name', op: 'contains' }, { ask: true })
  const inputs = paramInputs(CAT, s)
  assert.deepEqual(inputs.map(i => [i.key, i.type, i.kind, i.shape, i.label, i.op]), [
    ['period', 'period', 'period', 'period', 'Trading day', 'in_period'],
    ['venues', 'venues', 'venues', 'many', 'Venue', 'in'],
    ['status', 'value', 'choice', 'many', 'Which checks', 'in'],
    ['net', 'value', 'number', 'one', 'Net', 'gte'],
    ['opened_at_weekday', 'value', 'weekday', 'many', 'Opened (day of the week)', 'in'],
    ['paid', 'value', 'yesno', 'one', 'Paid in full', 'is'],
    ['server_name', 'value', 'text', 'one', 'Server', 'contains'],
  ])
  assert.deepEqual(inputs[2].field, { type: 'choice', labels: { open: 'Open', closed: 'Closed', void: 'Void' }, label: 'Status' })
  assert.deepEqual([inputs[2].default, inputs[3].default, inputs[4].default, inputs[5].default, inputs[6].default], [['closed'], 20, [5, 6], true, null])
  assert.deepEqual([inputs[1].field, inputs[4].bucket, inputs[4].path], [null, 'weekday', 'opened_at'])
  // A parameter nothing uses isn't asked for, and one inside "has" or "any of" is.
  const odd = normaliseReport({ ...base(), params: [...base().params, { key: 'spare', type: 'value' }, { key: 'how', type: 'value' }],
    filters: [{ any: [{ has: 'payments', where: [{ field: 'tender', op: 'in', param: 'how' }] }] }] })
  assert.deepEqual(paramInputs(CAT, odd).map(i => [i.key, i.kind, i.label, i.subject]), [['how', 'choice', 'Tender', 'payments']])
  assert.equal(inputs[2].subject, 'checks')
  assert.deepEqual(inputs.map(i => i.named), [false, false, true, false, false, false, false], 'only the one the report named')

  // What each is set to, in words, for the button that changes it.
  const words = (i, v) => paramWords(CAT, inputs[i], v)
  assert.equal(words(2, ['closed', 'void']), 'is one of Closed, Void')
  assert.equal(words(2, []), 'anything')
  assert.equal(words(3, 20), 'is at least £20.00')
  assert.equal(words(3, null), 'anything')
  assert.equal(words(4, [6, 7]), 'is one of Saturday, Sunday')
  assert.equal(words(5, false), 'no')
  assert.equal(words(6, 'sam'), 'contains sam')
  assert.equal(paramWords(CAT, paramInputs(CAT, odd)[0], ['cash']), 'is Cash')
  assert.equal(paramWords(CAT, null, 1), '')
  assert.deepEqual([...usedParams(odd)], ['how'])
  assert.deepEqual(paramInputs(CAT, null), [])
})

test('sorting, the top or bottom few, totals and comparing', () => {
  let s = addValue(addRow(removeRow(base(), 'date'), 'server.name'), { measure: 'net_sales' })
  assert.deepEqual(sortChoices(CAT, s), [{ by: 'server.name', label: 'Server' }, { by: 'checks', label: 'Checks' }, { by: 'net_sales', label: 'Net sales' }])
  assert.deepEqual(setSort(s, [{ by: 'net_sales', dir: 'desc' }, { by: 'server.name', dir: 'asc' }]).sort, [{ by: 'net_sales', dir: 'desc' }, { by: 'server.name', dir: 'asc' }])
  assert.deepEqual(setSort(s, [{ by: 'nothing', dir: 'asc' }]).sort, [])

  // The top few by a value: ranked by it, shown in that order, the rest as one row when named.
  const top = setLimit(setSort(s, [{ by: 'server.name', dir: 'asc' }]), { which: 'top', n: 5, by: 'net_sales', rest: 'Everyone else' })
  assert.deepEqual([top.limit, top.sort], [{ top: 5, rest_as: 'Everyone else' }, [{ by: 'net_sales', dir: 'desc' }, { by: 'server.name', dir: 'asc' }]])
  assert.deepEqual(limitOf(top), { which: 'top', n: 5, by: 'net_sales', rest: 'Everyone else' })
  const bottom = setLimit(top, { which: 'bottom', n: 3, by: 'checks', rest: '' })
  assert.deepEqual([bottom.limit, bottom.sort], [{ bottom: 3 }, [{ by: 'checks', dir: 'asc' }, { by: 'server.name', dir: 'asc' }]])
  assert.deepEqual(limitOf(bottom), { which: 'bottom', n: 3, by: 'checks', rest: '' })
  // No value named: by the report's first.
  assert.deepEqual(setLimit(s, { which: 'top', n: 2 }).sort, [{ by: 'checks', dir: 'desc' }])
  assert.deepEqual([setLimit(top, null).limit, limitOf(s)], [null, null])
  assert.equal(setLimit(removeRow(s, 'server.name'), { which: 'top', n: 2 }).limit, null, 'nothing to rank without a grouping')

  // Subtotals for every grouping but the last, and not with a top N.
  const two = addRow(s, 'status')
  assert.deepEqual(setTotals(two, { subtotals: ['server.name', 'status'] }).totals, { grand: true, subtotals: ['server.name'] })
  assert.deepEqual(setTotals(two, { grand: false }).totals, { grand: false, subtotals: [] })
  // One part changed leaves the other as it was.
  assert.deepEqual(setTotals(setTotals(two, { subtotals: ['server.name'] }), { grand: false }).totals, { grand: false, subtotals: ['server.name'] })
  assert.deepEqual(setTotals(setLimit(two, { which: 'top', n: 2 }), { subtotals: ['server.name'] }).totals.subtotals, [])

  // Beside an earlier period: a summary whose filters say its period.
  assert.equal(compareProblem(CAT, s), null)
  assert.deepEqual(setCompare(s, 'last_year').compare, { with: 'last_year' })
  assert.equal(setCompare(setCompare(s, 'last_year'), null).compare, null)
  assert.equal(compareProblem(CAT, setKind(s, 'list', CAT)), 'A list can\'t be compared with an earlier period: make it a summary')
  assert.equal(compareProblem(CAT, addColumn(s, 'status')), 'A table across can\'t be compared with an earlier period: take its columns off first')
  assert.equal(compareProblem(CAT, removeFilter(s, 0)), 'Comparing needs the report\'s period: add the filter "Trading day is in ..."')
  assert.equal(compareProblem(CAT, normaliseReport({ subject: 'dishes', values: [{ measure: 'dishes' }] })), 'Dishes have no day of their own to compare by')
  // A list is sorted by its columns.
  assert.deepEqual(sortChoices(CAT, setKind(s, 'list', CAT)).map(c => c.by), ['number', 'date', 'venue.name', 'server.name', 'covers', 'net', 'status'])
})

test('a summary as a list and a list as a summary', () => {
  const s = setSort(addValue(addRow(addRow(base(), { field: 'opened_at', bucket: 'hour' }), 'paid'), { measure: 'net_sales' }), [{ by: 'net_sales', dir: 'desc' }])
  const list = setKind(setCompare(setLimit(s, { which: 'top', n: 3 }), 'last_year'), 'list', CAT)
  assert.deepEqual(reportProblems(list), [])
  // The usual columns, then what it was grouped by (once each, and never by the hour).
  assert.deepEqual(list.rows, ['number', 'date', 'venue.name', 'server.name', 'covers', 'net', 'status', 'opened_at', 'paid'].map(field => ({ field })))
  assert.deepEqual([list.kind, list.values, list.columns, list.sort, list.limit, list.compare], ['list', [], [], [], null, null])
  assert.deepEqual([list.filters, list.params], [s.filters, s.params], 'what it is filtered by and asks for stays')
  assert.equal(setKind(list, 'list', CAT), list)
  // A list has a column once, however it is asked for.
  assert.equal(addRow(list, { field: 'opened_at', bucket: 'hour' }), list)

  // Back: how many rows, and each amount of the list added up.
  const sum = setKind(list, 'summary', CAT)
  assert.deepEqual(reportProblems(sum), [])
  assert.deepEqual([sum.kind, sum.rows, sum.columns], ['summary', [], []])
  assert.deepEqual(sum.values, [{ key: 'count', agg: 'count' }, { key: 'sum_covers', agg: 'sum', field: 'covers' }, { key: 'sum_net', agg: 'sum', field: 'net' }])
  assert.deepEqual(sum.filters, s.filters)
  assert.equal(setKind(s, 'summary', CAT), s)
  assert.equal(setKind(s, 'matrix', CAT), s)

  // A table across made a summary loses what was across the top, nothing else.
  const across = addColumn(s, 'status')
  assert.deepEqual(setKind(across, 'summary', CAT), s)
  // A column's own name is kept on its total.
  const named = setKind(normaliseReport({ subject: 'checks', kind: 'list', rows: [{ field: 'net', label: 'Takings' }, 'number'] }), 'summary', CAT)
  assert.deepEqual(named.values[1], { key: 'sum_net', agg: 'sum', field: 'net', label: 'Takings' })
  // A grouping the catalogue no longer has (a field since taken away) isn't carried into the list.
  const stale = normaliseReport({ ...base(), rows: [{ field: 'date' }, { field: 'gone' }, { field: 'paid' }] })
  assert.deepEqual(setKind(stale, 'list', CAT).rows, ['number', 'date', 'venue.name', 'server.name', 'covers', 'net', 'status', 'paid'].map(field => ({ field })))
  // Something with no usual columns keeps what it was grouped by.
  const bare = { subjects: { ...CAT.subjects, checks: { ...CAT.subjects.checks, list: [] } } }
  assert.deepEqual(setKind(addRow(startReport(bare, 'checks'), 'status'), 'list', bare).rows, [{ field: 'date' }, { field: 'status' }])
})

test('a chart above the table: its kind, what it draws, and what goes when the report changes', () => {
  const s = addValue(addValue(base(), { measure: 'net_sales' }), { measure: 'average_check' })   // by day: checks, net sales, average check
  assert.deepEqual(s.view, { kind: 'table' })
  const table = viewOptions(CAT, s)
  assert.deepEqual([table.kind, table.pick, table.ys, table.xs, table.why], ['table', 'none', [], [], null])
  assert.deepEqual(table.kinds.map(k => [k.kind, k.ok]), [
    ['table', true], ['bar', true], ['line', true], ['area', true], ['combo', true], ['parts', true], ['figures', true], ['heat', false],
  ])
  assert.equal(table.kinds.find(k => k.kind === 'heat').why, 'A heat table needs two groupings, or a column across the top')

  // Bars: the first value until some are picked; the table stays under the chart unless switched off.
  const bars = setView(s, { kind: 'bar' })
  assert.deepEqual(bars.view, { kind: 'bar', table_below: true })
  assert.deepEqual(reportProblems(bars), [])
  let o = viewOptions(CAT, bars)
  assert.deepEqual([o.pick, o.ys, o.line, o.stack, o.sideways, o.tableBelow, o.stacked, o.sidewaysOn], ['many', ['checks'], null, false, true, true, false, false])
  assert.deepEqual(o.values, [{ key: 'checks', label: 'Checks' }, { key: 'net_sales', label: 'Net sales' }, { key: 'average_check', label: 'Average check' }])
  const two = setView(bars, { y: ['net_sales', 'checks'], stacked: true, sideways: true, table_below: false })
  assert.deepEqual(two.view, { kind: 'bar', y: ['net_sales', 'checks'], stacked: true, sideways: true, table_below: false })
  o = viewOptions(CAT, two)
  assert.deepEqual([o.ys, o.stack, o.stacked, o.sidewaysOn, o.tableBelow], [['net_sales', 'checks'], true, true, true, false], 'two values drawn can be asked to stack')
  // Nothing changes: the same object. What the report doesn't have is dropped.
  assert.equal(setView(two, { stacked: true }), two)
  assert.equal(setView(two, {}), two)
  assert.deepEqual(setView(two, { y: ['nothing', 'checks', 'checks'], x: 'status', line: 'gone' }).view, { kind: 'bar', y: ['checks'], stacked: true, sideways: true, table_below: false })
  assert.deepEqual(setView(two, { kind: 'pie' }).view, { kind: 'table' }, 'a kind there isn\'t is no chart')
  // Off, and on again: a table keeps nothing of the chart; the view given back what it had is checked like any other.
  const off = setView(two, { kind: 'table' })
  assert.deepEqual(off.view, { kind: 'table' })
  assert.deepEqual(setView(off, { ...two.view, kind: 'line' }).view, { ...two.view, kind: 'line' })

  // Areas: different values are lines until they are asked to stack, so the
  // switch is there for two or more of them (one value is just an area). A
  // line chart has nothing to stack.
  o = viewOptions(CAT, setView(two, { kind: 'area' }))
  assert.deepEqual([o.kind, o.ys, o.stack, o.stacked, o.sideways], ['area', ['net_sales', 'checks'], true, true, false])
  o = viewOptions(CAT, setView(bars, { kind: 'area' }))
  assert.deepEqual([o.ys, o.stack, o.stacked], [['checks'], false, false])
  o = viewOptions(CAT, setView(two, { kind: 'line' }))
  assert.deepEqual([o.ys, o.stack], [['net_sales', 'checks'], false])

  // Bars with a line: one value is the line, the others can be bars.
  const combo = setView(s, { kind: 'combo' })
  o = viewOptions(CAT, combo)
  assert.deepEqual([o.pick, o.ys, o.line], ['combo', ['checks'], 'net_sales'], 'the line is the first value that isn\'t a bar')
  o = viewOptions(CAT, setView(combo, { line: 'average_check', y: ['checks', 'net_sales'] }))
  assert.deepEqual([o.ys, o.line], [['checks', 'net_sales'], 'average_check'])
  o = viewOptions(CAT, setView(combo, { line: 'checks', y: ['checks'] }))
  assert.deepEqual([o.ys, o.line], [['net_sales'], 'checks'], 'the line is never one of the bars')
  // One value left: no line and bars to draw, and it says why.
  const lone = removeValue(removeValue(combo, 'net_sales'), 'average_check')
  o = viewOptions(CAT, lone)
  assert.deepEqual([o.kind, o.why, o.pick, o.ys, o.line], ['combo', 'Bars with a line need two values: one for the bars, one for the line', 'none', [], null])

  // Parts of a whole and a heat table draw one value. Figures draw them all unless some are picked.
  o = viewOptions(CAT, setView(s, { kind: 'parts', y: ['net_sales', 'checks'] }))
  assert.deepEqual([o.pick, o.ys, o.stack, o.sideways], ['one', ['net_sales'], false, false])
  o = viewOptions(CAT, setView(s, { kind: 'figures' }))
  assert.deepEqual([o.pick, o.ys, o.xs], ['many', ['checks', 'net_sales', 'average_check'], []])
  assert.deepEqual(viewOptions(CAT, setView(s, { kind: 'figures', y: ['net_sales'] })).ys, ['net_sales'])

  // Two groupings: one value, and a choice of which grouping runs along the bottom (the first, until told).
  const by2 = addRow(bars, 'server.name')
  o = viewOptions(CAT, by2)
  assert.deepEqual([o.pick, o.ys, o.x, o.xLabel, o.stack], ['one', ['checks'], 'date', 'Along the bottom', true])
  assert.deepEqual(o.xs, [{ id: 'date', label: 'Trading day' }, { id: 'server.name', label: 'Server' }])
  // Areas of one value's parts stack by themselves: no switch for them.
  assert.equal(viewOptions(CAT, setView(by2, { kind: 'area' })).stack, false)
  assert.deepEqual(setView(by2, { x: 'server.name' }).view, { kind: 'bar', x: 'server.name', table_below: true })
  assert.equal(viewOptions(CAT, setView(by2, { x: 'server.name' })).x, 'server.name')
  // A heat table has its second grouping across the top until told.
  o = viewOptions(CAT, setView(by2, { kind: 'heat' }))
  assert.deepEqual([o.why, o.x, o.xLabel, o.pick], [null, 'server.name', 'Across the top', 'one'])
  assert.equal(viewOptions(CAT, setView(by2, { kind: 'heat', x: 'date' })).x, 'date')
  // Figures are the totals: nothing runs along the bottom, so there is no grouping to pick.
  o = viewOptions(CAT, setView(by2, { kind: 'figures' }))
  assert.deepEqual([o.xs, o.x, o.xLabel], [[], null, ''])
  // The grouping the chart runs along is renamed with it, and goes with it.
  const named = updateRow(setView(by2, { x: 'date' }), 'rows', 'date', { bucket: 'week' })
  assert.equal(named.view.x, 'date:week')
  assert.equal(removeRow(named, 'date:week').view.x, undefined)
  assert.equal(viewOptions(CAT, removeRow(named, 'date:week')).xs.length, 0)

  // A table across: one value, the columns are the series. No bars with a line, parts or figures.
  const across = addColumn(removeRow(by2, 'server.name'), 'status')
  o = viewOptions(CAT, across)
  assert.deepEqual([across.kind, o.pick, o.ys, o.xs, o.stack], ['matrix', 'one', ['checks'], [], true])
  assert.equal(viewOptions(CAT, setView(across, { kind: 'area' })).stack, false)
  assert.deepEqual(o.kinds.filter(k => !k.ok).map(k => k.kind), ['combo', 'parts', 'figures'])
  assert.equal(viewOptions(CAT, setView(across, { kind: 'parts' })).why, 'Parts of a whole are for a summary with one grouping')

  // A value taken off or hidden is no longer drawn; a list has no chart.
  const picked = setView(bars, { y: ['net_sales', 'checks'] })
  assert.deepEqual(removeValue(picked, 'net_sales').view.y, ['checks'])
  assert.deepEqual(viewOptions(CAT, updateValue(picked, 'net_sales', { hidden: true })).ys, ['checks'])
  assert.deepEqual(viewOptions(CAT, updateValue(updateValue(picked, 'net_sales', { hidden: true }), 'checks', { hidden: true })).ys, ['average_check'])
  const list = setKind(picked, 'list', CAT)
  assert.deepEqual(list.view, { kind: 'table' })
  assert.equal(setView(list, { kind: 'bar' }), list)
  assert.deepEqual(viewOptions(CAT, list).kinds.filter(k => k.ok).map(k => k.kind), ['table'])
  // Not grouped by anything: figures only.
  const flat = removeRow(s, 'date')
  assert.deepEqual(viewOptions(CAT, flat).kinds.filter(k => k.ok).map(k => k.kind), ['table', 'figures'])
  assert.equal(viewOptions(CAT, setView(flat, { kind: 'bar' })).why, 'Group the report by something first')
})

test('what a tapped row opens into: the fields to break it down by and the columns of its rows', () => {
  const s = base()
  assert.equal(s.drill, null, 'a new report offers its rows with their usual columns and nothing to break down by')
  assert.equal(drillRoom(s), LIMITS.drill_down)
  assert.deepEqual(drillLevels(s), [])

  // A level is any field the report could be grouped by; a day or a time with how its days are grouped.
  let d = addDrillLevel(s, 'server.name')
  assert.deepEqual(d.drill, { down: [{ field: 'server.name' }], rows: [] })
  assert.equal(addDrillLevel(d, 'server.name'), d, 'the same level twice is added once')
  assert.equal(addDrillLevel(d, { field: 'server.name' }), d)
  d = addDrillLevel(d, { field: 'opened_at', bucket: 'hour' })
  d = addDrillLevel(d, { field: 'date', bucket: 'day' })
  assert.deepEqual(d.drill.down, [{ field: 'server.name' }, { field: 'opened_at', bucket: 'hour' }, { field: 'date' }], 'by day is the field as it is')
  assert.equal(addDrillLevel(d, 'date'), d)
  assert.equal(addDrillLevel(d, ''), d)
  assert.equal(addDrillLevel(d, {}), d)
  assert.equal(drillRoom(d), LIMITS.drill_down - 3)
  assert.deepEqual(reportProblems(d), [])
  // The same day another way is another level.
  assert.deepEqual(addDrillLevel(d, { field: 'date', bucket: 'week' }).drill.down.map(rowId), ['server.name', 'opened_at:hour', 'date', 'date:week'])

  // The ones a tap can lead to: not what the report is grouped by already (down the side or across the top).
  assert.deepEqual(drillLevels(d).map(rowId), ['server.name', 'opened_at:hour'], 'the report is by day already')
  assert.deepEqual(drillLevels(addColumn(d, 'server.name')).map(rowId), ['opened_at:hour'])
  assert.deepEqual(drillLevels(removeRow(d, 'date')).map(rowId), ['server.name', 'opened_at:hour', 'date'])

  // Into another order, grouped another way, taken off.
  assert.deepEqual(moveDrillLevel(d, 2, 0).drill.down.map(rowId), ['date', 'server.name', 'opened_at:hour'])
  assert.equal(moveDrillLevel(d, 1, 1), d)
  assert.equal(moveDrillLevel(d, 0, 7), d)
  assert.equal(moveDrillLevel(d, -1, 0), d)
  const weekly = updateDrillLevel(d, 'date', { bucket: 'week' })
  assert.deepEqual(weekly.drill.down.map(rowId), ['server.name', 'opened_at:hour', 'date:week'], 'in its own place')
  assert.deepEqual(updateDrillLevel(weekly, 'date:week', { bucket: 'day' }).drill.down, d.drill.down)
  assert.equal(updateDrillLevel(d, 'date', { bucket: 'day' }), d, 'nothing changes')
  assert.equal(updateDrillLevel(d, 'date', {}), d)
  assert.equal(updateDrillLevel(d, 'nothing', { bucket: 'week' }), d)
  const both = addDrillLevel(d, { field: 'date', bucket: 'week' })
  assert.equal(updateDrillLevel(both, 'date', { bucket: 'week' }), both, 'not onto a level that is there already')
  assert.deepEqual(removeDrillLevel(d, 'opened_at:hour').drill.down.map(rowId), ['server.name', 'date'])
  assert.equal(removeDrillLevel(d, 'opened_at'), d)
  assert.equal(removeDrillLevel(removeDrillLevel(removeDrillLevel(d, 'server.name'), 'opened_at:hour'), 'date').drill, null, 'with nothing left there is nothing to keep')

  // Eight levels at most.
  let full = s
  for (const p of ['number', 'status', 'covers', 'order_no', 'net', 'share', 'paid', 'tab_name', 'server.name']) full = addDrillLevel(full, p)
  assert.equal(full.drill.down.length, LIMITS.drill_down)
  assert.equal(drillRoom(full), 0)
  assert.equal(addDrillLevel(full, 'server.name'), full)

  // The columns of the rows behind a row: in the order given, once each; none is the usual ones.
  let r = setDrillRows(d, ['number', 'server.name', 'number', '', null, 'net'])
  assert.deepEqual(r.drill, { down: d.drill.down, rows: ['number', 'server.name', 'net'] })
  assert.equal(setDrillRows(r, ['number', 'server.name', 'net']), r)
  assert.equal(setDrillRows(r, ['number', 'server.name', 'net', 'number']), r, 'the same columns with one named twice is no change')
  assert.deepEqual(setDrillRows(r, ['net', 'number', 'server.name']).drill.rows, ['net', 'number', 'server.name'])
  assert.deepEqual(setDrillRows(r, []).drill, { down: d.drill.down, rows: [] })
  assert.equal(setDrillRows(d, []), d)
  assert.equal(setDrillRows(d, 'number'), d, 'a list of paths, or nothing')
  assert.deepEqual(setDrillRows(s, ['number']).drill, { down: [], rows: ['number'] })
  assert.equal(setDrillRows(setDrillRows(s, ['number']), []).drill, null)
  assert.equal(setDrillRows(s, Array.from({ length: 40 }, (_, i) => 'f' + i)).drill.rows.length, LIMITS.drill_rows)
  assert.deepEqual(reportProblems(r), [])

  // Changing the levels leaves the columns alone, and the other way round.
  assert.deepEqual(removeDrillLevel(r, 'date').drill.rows, ['number', 'server.name', 'net'])
  assert.deepEqual(addDrillLevel(r, 'status').drill.rows, ['number', 'server.name', 'net'])

  // What a row opens in the app (set elsewhere) stays through every one of these edits.
  const opens = normaliseReport({ ...r, drill: { ...r.drill, open: 'self' } })
  assert.equal(opens.drill.open, 'self')
  for (const next of [addDrillLevel(opens, 'status'), removeDrillLevel(opens, 'date'), moveDrillLevel(opens, 0, 1), updateDrillLevel(opens, 'date', { bucket: 'week' }), setDrillRows(opens, ['net'])]) {
    assert.notEqual(next, opens)
    assert.equal(next.drill.open, 'self')
  }

  // A list is its own rows: it keeps what the summary had, so switching back finds it.
  const list = setKind(r, 'list', CAT)
  assert.deepEqual(list.drill, r.drill)
  assert.deepEqual(setKind(list, 'summary', CAT).drill, r.drill)
  // The rest of the report is as it was after each edit.
  for (const next of [d, weekly, r, full]) assert.deepEqual([next.rows, next.values, next.filters, next.params], [s.rows, s.values, s.filters, s.params])
})

test('a filter on what the figures count is said in words and asks for nothing', () => {
  const counted = normaliseReport({ ...setKind(base(), 'list', CAT), filters: [...base().filters, { counted: ['net_sales', 'checks'] }] })
  assert.deepEqual(counted.filters.at(-1), { counted: ['net_sales', 'checks'] })
  assert.deepEqual(filterParts(CAT, 'checks', counted.filters.at(-1)), { label: '', rest: 'Counts towards Net sales, Checks', sep: '' })
  assert.equal(filterWords(CAT, 'checks', { counted: ['net_sales', 'checks', 'average_check', 'typical'] }), 'Counts towards Net sales, Checks, Average check and 1 more')
  assert.equal(filterWords(CAT, 'checks', { counted: ['gone'] }), 'Counts towards gone', 'a figure the catalogue no longer has is named as it was written')
  // It isn't about a field: nothing to type in, no parameter of its own, and the ones the report has stay.
  assert.deepEqual(usedParams(counted), usedParams(base()))
  assert.deepEqual(paramInputs(CAT, counted).map(i => i.key), paramInputs(CAT, base()).map(i => i.key))
  assert.deepEqual(removeFilter(counted, counted.filters.length - 1).filters, base().filters)
})
