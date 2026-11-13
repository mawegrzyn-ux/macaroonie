import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHART_KINDS, SERIES_COLOURS, MAX_SERIES,
  chartChoices, chartValues, chartModel, drawChart, renderChart, chartTip, chartMark,
  axisScale, axisLabels, markLabels, shortValue, changeText,
  brandColour, inkOn, textWidth, fitText, RAMP,
} from '../reports/chart.js'
import { normaliseReport, VIEW_KINDS, VIEW_LABELS } from '../reports/spec.js'

// ── Results in the engine's shapes (api/src/reports/shape.js) ──

const day = i => new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10)
const dateCol = { key: 'date', field: 'date', label: 'Day', type: 'date', role: 'row', empty: '(none)' }
const nameCol = { key: 'name', field: 'name', label: 'Dish', type: 'text', role: 'row', empty: '(none)' }
const sectionCol = { key: 'section.name', field: 'section.name', label: 'Section', type: 'text', role: 'row', empty: '(none)' }
const money = (key, label, extra = {}) => ({ key, label, type: 'money', role: 'value', adds: true, ...extra })
const count = (key, label, extra = {}) => ({ key, label, type: 'number', decimals: 0, role: 'value', adds: true, ...extra })
const pct = (key, label) => ({ key, label, type: 'percent', decimals: 1, role: 'value' })
const meta = (extra = {}) => ({ currency: 'GBP', drill: { down: [], rows: true, of: 'Dishes sold' }, notes: [], ...extra })
const row = (k, cells) => ({ kind: 'row', level: 1, k, cells })

// Sales by day: the 22nd has nothing.
const DAYS = [[0, 1210.5, 50, 0.03], [1, 980.2, 41, 0.041], [2, 1105, 46, 0.052], [4, 1890.4, 79, 0.063]]
const byDay = (view, order = DAYS) => ({
  kind: 'summary', spec: { view },
  columns: [dateCol, money('net_sales', 'Net sales'), count('checks', 'Checks'), pct('discount_rate', 'Discount rate')],
  rows: order.map(([i, a, b, c]) => row([day(i)], [day(i), a, b, c])),
  totals: { cells: [null, 5186.1, 216, 0.047] },
  meta: meta(),
})
const DISHES = [['Pad Thai', 412, 4120.5], ['Green curry with jasmine rice and extra vegetables', 301, 3311], ['Massaman curry', 188, 2256], ['Tom yum soup', 240, 1680]]
const byDish = (view, { rest = false, rows = DISHES } = {}) => ({
  kind: 'summary', spec: { view },
  columns: [nameCol, count('qty_sold', 'Sold'), money('net_sales', 'Net sales')],
  rows: [...rows.map(d => row([d[0]], d)), ...(rest ? [{ kind: 'rest', level: 0, k: [], cells: ['Every other dish', 800, 5200] }] : [])],
  totals: { cells: [null, 1941, 16567.5] },
  meta: meta(),
})
const SECTIONS = ['Starters', 'Mains', 'Desserts', 'Drinks']
const dayBySection = view => {
  const rows = []
  for (let i = 0; i < 3; i++) SECTIONS.forEach((s, j) => { if (!(i === 1 && j === 2)) rows.push({ kind: 'row', level: 2, k: [day(i), s], cells: [day(i), s, 100 * (i + 1) + j * 10] }) })
  return { kind: 'summary', spec: { view }, columns: [dateCol, sectionCol, money('net_sales', 'Net sales')], rows, totals: { cells: [null, null, 2000] }, meta: meta() }
}
const matrix = (view, hours = [12, 18, 19], { adds = true } = {}) => {
  const columns = [dateCol]
  hours.forEach((h, j) => columns.push({ key: 'guests|' + j, label: 'Guests', group: String(h).padStart(2, '0') + ':00', type: 'number', decimals: 0, role: 'value', ...(adds ? { adds: true } : {}), of: 'guests', at: [{ field: 'starts_at', bucket: 'hour', value: h }] }))
  columns.push({ key: 'guests|total', label: 'Guests', group: 'Total', type: 'number', decimals: 0, role: 'total', of: 'guests' })
  const rows = [0, 1].map(i => {
    const cells = hours.map((h, j) => (i === 1 && j === 0 ? null : (i + 1) * 10 + j))
    return row([day(i)], [day(i), ...cells, cells.reduce((a, v) => a + (v || 0), 0)])
  })
  return { kind: 'matrix', spec: { view }, columns, rows, totals: { cells: [null, ...hours.map(() => 30), 90] }, meta: meta() }
}
const noGroup = view => ({
  kind: 'summary', spec: { view },
  columns: [money('net_sales', 'Net sales'), count('checks', 'Checks'), pct('discount_rate', 'Discount rate')],
  rows: [{ kind: 'row', level: 0, k: [], cells: [22128.8, 931, 0.052] }],
  totals: null, meta: meta(),
})
const compared = view => {
  const r = byDay(view)
  r.columns = [dateCol, money('net_sales', 'Net sales'),
    { ...money('net_sales__prev', 'Before'), group: 'Net sales', role: 'compare', of: 'net_sales' },
    { key: 'net_sales__chg', label: 'Change', group: 'Net sales', type: 'percent', decimals: 1, role: 'change', of: 'net_sales' }]
  r.rows = r.rows.map(x => ({ ...x, cells: [x.cells[0], x.cells[1], x.cells[1] - 100, 0.1] }))
  r.totals = { cells: [null, 5186.1, 4786.1, 0.0836] }
  r.meta = meta({ compare: { with: 'previous_period', text: '5 Oct to 18 Oct 2026' } })
  return r
}
const count1 = s => (s.match(/<path/g) || []).length

// ── The kinds a definition can be drawn as ──

test('the kinds of chart, and which a definition can be', () => {
  assert.deepEqual(CHART_KINDS, ['bar', 'line', 'area', 'combo', 'parts', 'figures', 'heat'])
  assert.deepEqual(VIEW_KINDS, ['table', ...CHART_KINDS])
  for (const k of VIEW_KINDS) assert.ok(VIEW_LABELS[k], k)
  const ok = spec => Object.fromEntries(chartChoices(spec).map(c => [c.kind, c.ok ? true : c.why]))

  // The table is always first and always there.
  assert.equal(chartChoices({ kind: 'summary', rows: [{}], values: [{ key: 'a' }] })[0].kind, 'table')
  assert.equal(chartChoices(null)[0].ok, true)

  const list = ok({ kind: 'list', columns: [{}] })
  assert.equal(list.table, true)
  for (const k of CHART_KINDS) assert.equal(list[k], 'A list is shown as a table')

  // A hidden value isn't one a chart can show.
  const none = ok({ kind: 'summary', rows: [{}], values: [{ key: 'a', hidden: true }] })
  for (const k of CHART_KINDS) assert.equal(none[k], 'Add a value first')

  const flat = ok({ kind: 'summary', rows: [], values: [{ key: 'a' }] })
  assert.equal(flat.figures, true)
  assert.equal(flat.bar, 'Group the report by something first')
  assert.equal(flat.heat, 'Group the report by something first')

  const one = ok({ kind: 'summary', rows: [{}], values: [{ key: 'a' }] })
  assert.deepEqual([one.bar, one.line, one.area, one.parts, one.figures], [true, true, true, true, true])
  // Figures are the report's totals: with a grouping they need its Total row.
  assert.equal(ok({ kind: 'summary', rows: [{}], values: [{ key: 'a' }], totals: { grand: false } }).figures, 'Switch the total on to show the report as figures')
  assert.equal(ok({ kind: 'summary', rows: [], values: [{ key: 'a' }], totals: { grand: false } }).figures, true)
  assert.equal(ok({ kind: 'summary', rows: [{}], values: [{ key: 'a' }], totals: { grand: true } }).figures, true)
  assert.equal(one.combo, 'Bars with a line need two values: one for the bars, one for the line')
  assert.equal(one.heat, 'A heat table needs two groupings, or a column across the top')
  assert.equal(ok({ kind: 'summary', rows: [{}], values: [{ key: 'a' }, { key: 'b' }] }).combo, true)

  const two = ok({ kind: 'summary', rows: [{}, {}], values: [{ key: 'a' }, { key: 'b' }] })
  assert.deepEqual([two.bar, two.line, two.area, two.heat, two.figures], [true, true, true, true, true])
  assert.equal(two.parts, 'Parts of a whole need one grouping')
  assert.equal(two.combo, 'Bars with a line need one grouping')

  const across = ok({ kind: 'matrix', rows: [{}], columns: [{}], values: [{ key: 'a' }] })
  assert.deepEqual([across.bar, across.line, across.area, across.heat], [true, true, true, true])
  assert.equal(across.combo, 'Bars with a line are for a summary with one grouping')
  assert.equal(across.parts, 'Parts of a whole are for a summary with one grouping')
  assert.equal(across.figures, 'Figures are for a summary')
})

test('a definition keeps its chart: parts of a whole, never a kind the app doesn\'t have', () => {
  const base = { subject: 'till.lines', kind: 'summary', rows: [{ field: 'section.name' }], values: [{ measure: 'net_sales' }] }
  assert.equal(normaliseReport({ ...base, view: { kind: 'parts' } }).view.kind, 'parts')
  assert.equal(normaliseReport({ ...base, view: { kind: 'pie' } }).view.kind, 'table')
  assert.equal(normaliseReport({ ...base, view: { kind: 'figures', table_below: false } }).view.table_below, false)
})

// ── Scales and the words on them ──

test('a scale starts at zero and its marks are round', () => {
  assert.deepEqual(axisScale(0, 2750).ticks, [0, 1000, 2000, 3000])
  assert.deepEqual(axisScale(120, 4120.5).ticks, [0, 1000, 2000, 3000, 4000, 5000])
  // The smallest value is never where the scale starts.
  assert.equal(axisScale(900, 1000).min, 0)
  // Below zero: zero is still on it.
  const neg = axisScale(-120, 300)
  assert.ok(neg.min <= -120 && neg.max >= 300 && neg.ticks.includes(0), JSON.stringify(neg))
  // Nothing at all still gives a scale.
  assert.deepEqual(axisScale(0, 0).ticks.at(0), 0)
  assert.ok(axisScale(0, 0).max > 0)
  assert.ok(axisScale(null, undefined).max > 0)

  // A percentage is worked out in percent points.
  assert.deepEqual(axisScale(0, 0.108, { type: 'percent' }).ticks, [0, 0.025, 0.05, 0.075, 0.1, 0.125])
  assert.deepEqual(axisScale(0, 0.5, { type: 'percent' }).ticks, [0, 0.1, 0.2, 0.3, 0.4, 0.5])
  // Counts go up in whole numbers.
  assert.deepEqual(axisScale(0, 3, { counts: true }).ticks, [0, 1, 2, 3])
  assert.ok(axisScale(0, 7, { counts: true }).ticks.every(Number.isInteger))
  // Time in the steps a clock has: 15 minutes, not 16 and two thirds.
  assert.deepEqual(axisScale(0, 3300, { type: 'duration' }).ticks, [0, 900, 1800, 2700, 3600])
  // Fewer marks when asked.
  assert.ok(axisScale(0, 2750, { target: 3 }).ticks.length <= 4)
})

test('amounts on one chart are written the same way', () => {
  // Along an axis: one unit for every mark.
  assert.deepEqual(axisLabels([0, 2500, 5000, 7500, 10000, 12500], { type: 'money' }), ['£0', '£2.5K', '£5K', '£7.5K', '£10K', '£12.5K'])
  assert.deepEqual(axisLabels([0, 1000, 2000, 3000], { type: 'money' }), ['£0', '£1,000', '£2,000', '£3,000'])
  assert.deepEqual(axisLabels([0, 0.5, 1, 1.5], { type: 'money' }), ['£0', '£0.50', '£1.00', '£1.50'])
  assert.deepEqual(axisLabels([0, 0.025, 0.05, 0.075], { type: 'percent' }), ['0%', '2.5%', '5%', '7.5%'])
  assert.deepEqual(axisLabels([0, 0.1, 0.2], { type: 'percent' }), ['0%', '10%', '20%'])
  assert.deepEqual(axisLabels([0, 50, 100, 150], { type: 'number', decimals: 0 }), ['0', '50', '100', '150'])
  assert.deepEqual(axisLabels([0, 0.5, 1], { type: 'number' }), ['0', '0.5', '1'])
  assert.deepEqual(axisLabels([0, 500000, 1000000, 1500000], { type: 'number' }), ['0', '0.5M', '1M', '1.5M'])
  assert.deepEqual(axisLabels([0, 900, 1800], { type: 'duration' }), ['0 s', '15 min', '30 min'])
  assert.deepEqual(axisLabels([-200, 0, 200], { type: 'money' }), ['−£200', '£0', '£200'])
  assert.deepEqual(axisLabels([0, 10, 20], { type: 'money' }, { currency: 'EUR' }), ['€0', '€10', '€20'])

  // On marks: whole pounds once any is a hundred or more, never £1,211 beside £980.20.
  assert.deepEqual(markLabels([1210.5, 980.2, null, 2750.25], { type: 'money' }), ['£1,211', '£980', '', '£2,750'])
  assert.deepEqual(markLabels([23.77, 9.5], { type: 'money' }), ['£23.77', '£9.50'])
  assert.deepEqual(markLabels([12, 9], { type: 'money' }), ['£12', '£9'])
  assert.deepEqual(markLabels([12500, 9800], { type: 'money' }), ['£12.5K', '£9.8K'])
  assert.deepEqual(markLabels([12000, 9000], { type: 'money' }), ['£12K', '£9K'])
  assert.deepEqual(markLabels([0.072, 0.044], { type: 'percent' }), ['7.2%', '4.4%'])
  assert.deepEqual(markLabels([0.07, 0.04], { type: 'percent' }), ['7%', '4%'])
  assert.deepEqual(markLabels([2.4, 3], { type: 'number' }), ['2.40', '3.00'])
  assert.deepEqual(markLabels([2.4, 3], { type: 'number', decimals: 1 }), ['2.4', '3.0'])
  assert.deepEqual(markLabels([412, 301], { type: 'number', decimals: 0 }), ['412', '301'])
  // A rounding crumb is nothing, never a minus in front of a nought.
  assert.deepEqual(markLabels([-0.001, 5], { type: 'money' }), ['£0', '£5.00'])
  assert.deepEqual(markLabels([-12.5, 5], { type: 'money' }), ['−£12.50', '£5.00'])
  assert.equal(shortValue(22128.8, { type: 'money' }), '£22.1K')
  assert.equal(shortValue(null, { type: 'money' }), '')
  assert.equal(shortValue(NaN, { type: 'number' }), '')

  assert.equal(changeText(0.124), '+12.4%')
  assert.equal(changeText(-0.03), '−3.0%')
  assert.equal(changeText(0), '0.0%')
  assert.equal(changeText(null), '')
})

test('colours: the brand\'s when it stands out, and words that read on a colour', () => {
  assert.equal(brandColour('#630812'), '#630812')
  assert.equal(brandColour(' #036 '), '#003366')
  // Too pale to see on white: the usual blue is used instead.
  assert.equal(brandColour('#ffe9a8'), null)
  assert.equal(brandColour('#ffffff'), null)
  for (const bad of ['red', 'transparent', '', null, undefined, 12, '#12345', 'var(--x)', '#63081g']) assert.equal(brandColour(bad), null, String(bad))
  assert.equal(inkOn('#0d366b'), '#ffffff')
  assert.equal(inkOn('#cde2fb'), '#0b0b0b')
  // Eight colours, none twice.
  assert.equal(SERIES_COLOURS.length, MAX_SERIES)
  assert.equal(new Set(SERIES_COLOURS).size, MAX_SERIES)
})

test('words are measured near enough to cut them to a width', () => {
  assert.ok(textWidth('mmmm') > textWidth('iiii'))
  assert.equal(textWidth(''), 0)
  assert.equal(textWidth(null), 0)
  assert.ok(textWidth('Pad Thai', 24) > textWidth('Pad Thai', 12))
  assert.equal(fitText('Pad Thai', 200), 'Pad Thai')
  const cut = fitText('Green curry with jasmine rice and extra vegetables', 120)
  assert.ok(cut.endsWith('…') && cut.length < 30 && textWidth(cut) <= 120, cut)
  assert.ok(fitText('Green curry', 1).length <= 2)
})

// ── What is drawn ──

test('what can\'t be a chart says why, or says nothing when there is nothing', () => {
  const none = r => { const m = chartModel(r); assert.equal(m.ok, false); return m.why }
  assert.equal(none(null), null)
  assert.equal(none(byDay({ kind: 'table' })), null)
  assert.equal(none(byDay({})), null)
  assert.equal(none(byDay({ kind: 'pie' })), null)
  assert.equal(none({ ...byDay({ kind: 'bar' }), rows: [] }), null)
  assert.equal(none({ kind: 'list', spec: { view: { kind: 'bar' } }, columns: [nameCol], rows: [row(['a'], ['a'])], meta: meta() }), 'A list is shown as a table')
  assert.match(none({ ...byDay({ kind: 'bar' }), meta: meta({ currency: null, currency_column: 'venue.currency' }) }), /more than one currency/)
  assert.match(none(noGroup({ kind: 'bar' })), /Group the report by something/)
  // The view handed in wins over the definition's own (the builder trying a kind).
  assert.equal(chartModel(byDay({ kind: 'table' }), { view: { kind: 'bar' } }).ok, true)
  assert.equal(renderChart(byDay({ kind: 'table' })).ok, false)
  assert.equal(renderChart(noGroup({ kind: 'bar' })).why, chartModel(noGroup({ kind: 'bar' })).why)
  assert.deepEqual(drawChart({ ok: false, why: 'x' }), { svg: '', width: 0, height: 0, targets: [], legend: [], label: '' })
})

test('bars by day: one series, the day with nothing as a gap', () => {
  const m = chartModel(byDay({ kind: 'bar' }))
  assert.equal(m.ok, true)
  assert.equal(m.form, 'plot')
  assert.deepEqual(m.cats.map(c => c.k), [day(0), day(1), day(2), day(3), day(4)])
  assert.deepEqual(m.cats.map(c => !!c.gap), [false, false, false, true, false])
  assert.deepEqual(m.cats.map(c => c.short), ['19 Oct', '20 Oct', '21 Oct', '22 Oct', '23 Oct'])
  assert.equal(m.cats[0].label, 'Mon 19 Oct 2026')
  assert.deepEqual(m.cats[0].at, [{ field: 'date', value: day(0) }])
  // The first value shown when the view names none.
  assert.equal(m.series.length, 1)
  assert.deepEqual(m.series[0].values, [1210.5, 980.2, 1105, null, 1890.4])
  assert.equal(m.series[0].adds, true)
  assert.deepEqual(m.series[0].value, { key: 'net_sales', label: 'Net sales' })
  assert.deepEqual(m.panels.map(p => [p.type, p.mark]), [['money', 'bar']])
  assert.equal(m.x.ordered, true)
  assert.equal(m.currency, 'GBP')

  // Bars the report sorted another way stay in the report's order, and no days are made up.
  const sorted = chartModel(byDay({ kind: 'bar' }, [DAYS[3], DAYS[0], DAYS[2], DAYS[1]]))
  assert.deepEqual(sorted.cats.map(c => c.k), [day(4), day(0), day(2), day(1)])
  assert.ok(sorted.cats.every(c => !c.gap))
  // A line always runs from left to right.
  const line = chartModel(byDay({ kind: 'line' }, [DAYS[3], DAYS[0], DAYS[2], DAYS[1]]))
  assert.deepEqual(line.cats.map(c => c.k), [day(0), day(1), day(2), day(3), day(4)])
  assert.deepEqual(line.series[0].values, [1210.5, 980.2, 1105, null, 1890.4])
  assert.equal(line.panels[0].mark, 'line')

  // The year is said once the rows run over more than one.
  const years = byDay({ kind: 'bar' })
  years.rows = [row(['2026-12-31'], ['2026-12-31', 5, 1, 0]), row(['2027-01-01'], ['2027-01-01', 6, 1, 0])]
  assert.deepEqual(chartModel(years).cats.map(c => c.short), ['31 Dec 26', '1 Jan 27'])
})

test('the values a chart shows, each kind of figure on a plot of its own', () => {
  // Pounds and a count: two plots sharing the rows, never two scales on one.
  const two = chartModel(byDay({ kind: 'bar', y: ['net_sales', 'checks'] }))
  assert.deepEqual(two.series.map(s => [s.key, s.panel]), [['net_sales', 0], ['checks', 1]])
  assert.deepEqual(two.panels.map(p => p.type), ['money', 'number'])
  assert.equal(two.panels[1].counts, true)
  // In the view's order.
  assert.deepEqual(chartModel(byDay({ kind: 'bar', y: ['checks', 'net_sales'] })).series.map(s => s.key), ['checks', 'net_sales'])
  // A key the report hasn't got is passed over.
  assert.deepEqual(chartModel(byDay({ kind: 'bar', y: ['nope', 'checks'] })).series.map(s => s.key), ['checks'])

  // Two of the same kind share one plot.
  const r = byDay({ kind: 'line', y: ['net_sales', 'tips'] })
  r.columns = [dateCol, money('net_sales', 'Net sales'), money('tips', 'Tips'), pct('discount_rate', 'Discount rate')]
  const same = chartModel(r)
  assert.deepEqual(same.series.map(s => s.panel), [0, 0])
  assert.equal(same.panels.length, 1)

  // A fourth kind of figure isn't drawn, and the chart says so.
  const many = byDay({ kind: 'line', y: ['a', 'b', 'c', 'd'] })
  many.columns = [dateCol, money('a', 'Sales'), count('b', 'Checks'), pct('c', 'Rate'), { key: 'd', label: 'Wait', type: 'duration', role: 'value' }]
  many.rows = many.rows.map(x => ({ ...x, cells: [x.cells[0], 1, 2, 0.3, 400] }))
  const cut = chartModel(many)
  assert.deepEqual(cut.series.map(s => s.key), ['a', 'b', 'c'])
  assert.equal(cut.panels.length, 3)
  assert.match(cut.notes.join(' '), /Not drawn .*Wait/)
})

test('one value beside the period before', () => {
  const m = chartModel(compared({ kind: 'bar' }))
  assert.deepEqual(m.series.map(s => [s.key, s.label, !!s.muted]), [['net_sales', 'Net sales', false], ['net_sales__prev', 'Before', true]])
  assert.deepEqual(m.series[1].values, [1110.5, 880.2, 1005, null, 1790.4])
  // The earlier period never stacks on this one, whatever the view asks.
  assert.equal(chartModel(compared({ kind: 'bar', stacked: true })).panels[0].stacked, undefined)
  // With two values shown, each is itself: no room for both periods of both.
  const two = compared({ kind: 'bar', y: ['net_sales', 'checks'] })
  two.columns.push(count('checks', 'Checks'))
  two.rows = two.rows.map(x => ({ ...x, cells: [...x.cells, 5] }))
  assert.deepEqual(chartModel(two).series.map(s => s.key), ['net_sales', 'checks'])
  // The drawing: this period in colour, the one before in grey, both in the legend.
  const d = drawChart(m)
  assert.deepEqual(d.legend.map(l => [l.label, l.colour]), [['Net sales', SERIES_COLOURS[0]], ['Before', '#898781']])
})

test('bars with a line', () => {
  // The line is the value named, else the second one shown.
  const m = chartModel(byDay({ kind: 'combo', y: ['net_sales'], line: 'discount_rate' }))
  assert.deepEqual(m.series.map(s => [s.key, s.mark, s.panel]), [['net_sales', 'bar', 0], ['discount_rate', 'line', 1]])
  const dflt = chartModel(byDay({ kind: 'combo' }))
  assert.deepEqual(dflt.series.map(s => [s.key, s.mark]), [['net_sales', 'bar'], ['checks', 'line']])
  // Asked for as the bars too: it is the line, and the bars are another value.
  const both = chartModel(byDay({ kind: 'combo', y: ['checks'], line: 'checks' }))
  assert.deepEqual(both.series.map(s => [s.key, s.mark]), [['net_sales', 'bar'], ['checks', 'line']])
  // The same kind of figure: bars and line on one plot.
  const r = byDay({ kind: 'combo', y: ['made'], line: 'cancelled' })
  r.columns = [dateCol, count('made', 'Made'), count('cancelled', 'Cancelled'), pct('rate', 'Rate')]
  assert.deepEqual(chartModel(r).series.map(s => s.panel), [0, 0])
  // One value: nothing to draw the line from.
  const one = byDay({ kind: 'combo' })
  one.columns = [dateCol, money('net_sales', 'Net sales')]
  one.rows = one.rows.map(x => ({ ...x, cells: x.cells.slice(0, 2) }))
  assert.equal(chartModel(one).why, 'Bars with a line need two values: one for the bars, one for the line')
})

test('two groupings: one along the bottom, a series for each of the other', () => {
  const m = chartModel(dayBySection({ kind: 'bar' }))
  assert.deepEqual(m.cats.map(c => c.k), [day(0), day(1), day(2)])
  assert.deepEqual(m.series.map(s => s.label), SECTIONS)
  assert.deepEqual(m.series.map(s => s.at), SECTIONS.map(s => [{ field: 'section.name', value: s }]))
  // Desserts sold nothing on the 20th: a hole, not a nought.
  assert.deepEqual(m.series[2].values, [120, null, 320])
  assert.deepEqual(m.series[0].values, [100, 200, 300])
  assert.ok(m.series.every(s => s.value.key === 'net_sales' && s.panel === 0))

  // The other grouping along the bottom when the view says so.
  const flip = chartModel(dayBySection({ kind: 'bar', x: 'section.name' }))
  assert.deepEqual(flip.cats.map(c => c.label), SECTIONS)
  assert.deepEqual(flip.series.map(s => s.label), ['Mon 19 Oct 2026', 'Tue 20 Oct 2026', 'Wed 21 Oct 2026'])

  // One value only, and "everything else" has no place: both said.
  const r = dayBySection({ kind: 'bar', y: ['net_sales', 'qty'] })
  r.columns.push(count('qty', 'Sold'))
  r.rows = [...r.rows.map(x => ({ ...x, cells: [...x.cells, 1] })), { kind: 'rest', level: 0, k: [], cells: ['Everything else', null, 50, 5] }]
  const noted = chartModel(r)
  assert.equal(noted.series.length, 4)
  assert.match(noted.notes.join(' | '), /shows one value: Net sales/)
  assert.match(noted.notes.join(' | '), /"Everything else" isn't in the chart/)

  // Stacked when asked and the figure adds up; side by side when it doesn't.
  assert.equal(chartModel(dayBySection({ kind: 'bar', stacked: true })).panels[0].stacked, true)
  assert.equal(chartModel(dayBySection({ kind: 'bar' })).panels[0].stacked, undefined)
  const avg = dayBySection({ kind: 'bar', stacked: true })
  avg.columns[2] = money('net_sales', 'Average check', { adds: false })
  const side = chartModel(avg)
  assert.equal(side.panels[0].stacked, undefined)
  assert.match(side.notes.join(' '), /don't add up to a whole, so the bars sit side by side/)

  // Areas would hide each other: they stack when the figure adds up, and are lines when it doesn't.
  assert.deepEqual([chartModel(dayBySection({ kind: 'area' })).panels[0].mark, chartModel(dayBySection({ kind: 'area' })).panels[0].stacked], ['area', true])
  const lines = chartModel({ ...avg, spec: { view: { kind: 'area' } } })
  assert.equal(lines.panels[0].mark, 'line')
  assert.match(lines.notes.join(' '), /so they are drawn as lines/)

  // Different values aren't the parts of anything (bookings and guests don't
  // add up to something): lines, with nothing added up, until the report says
  // they do add up.
  const two = view => ({
    kind: 'summary', spec: { view },
    columns: [dateCol, count('bookings', 'Bookings'), count('guests', 'Guests'), pct('rate', 'No-show rate')],
    rows: [0, 1, 2].map(i => row([day(i)], [day(i), 10 + i, 40 + i, 0.1])),
    totals: { cells: [null, 33, 123, 0.1] }, meta: meta(),
  })
  const apart = chartModel(two({ kind: 'area', y: ['bookings', 'guests'] }))
  assert.deepEqual([apart.panels.length, apart.panels[0].mark, apart.panels[0].stacked, apart.notes], [1, 'line', undefined, []])
  assert.deepEqual(apart.series.map(s => s.mark), ['line', 'line'])
  assert.deepEqual(chartTip(apart, { cat: 0 }).lines.map(l => [l.label, l.value]), [['Bookings', '10'], ['Guests', '40']])
  const piled = chartModel(two({ kind: 'area', y: ['bookings', 'guests'], stacked: true }))
  assert.deepEqual([piled.panels[0].mark, piled.panels[0].stacked, piled.notes], ['area', true, []])
  assert.deepEqual(chartTip(piled, { cat: 0 }).lines.map(l => [l.label, l.value]), [['Bookings', '10'], ['Guests', '40'], ['Total', '50']])
  // One value is an area whatever the switch says, with nothing to add up.
  for (const stacked of [false, true]) {
    const one = chartModel(two({ kind: 'area', y: ['guests'], stacked }))
    assert.deepEqual([one.panels[0].mark, one.panels[0].stacked, one.notes], ['area', undefined, []])
    assert.deepEqual(chartTip(one, { cat: 1 }).lines.map(l => l.label), ['Guests'])
  }
  // Asked to stack what doesn't add up, or what goes below zero: lines, and the chart says why.
  const rates = two({ kind: 'area', y: ['bookings', 'guests'], stacked: true })
  rates.columns[2] = count('guests', 'Guests a booking', { adds: false })
  assert.deepEqual([chartModel(rates).panels[0].mark, chartModel(rates).notes], ['line', ['These figures don\'t add up to a whole, so they are drawn as lines']])
  const below = two({ kind: 'area', y: ['bookings', 'guests'], stacked: true })
  below.rows[1] = row([day(1)], [day(1), -3, 41, 0.1])
  assert.deepEqual([chartModel(below).panels[0].mark, chartModel(below).panels[0].stacked], ['line', undefined])
  assert.match(chartModel(below).notes.join(' '), /so they are drawn as lines/)
  // A table across is one value's parts: stacked by itself, as another grouping is.
  assert.deepEqual([chartModel(matrix({ kind: 'area' })).panels[0].mark, chartModel(matrix({ kind: 'area' })).panels[0].stacked], ['area', true])
})

test('a table across as a chart, and more series than colours', () => {
  const m = chartModel(matrix({ kind: 'bar' }))
  assert.deepEqual(m.cats.map(c => c.k), [day(0), day(1)])
  assert.deepEqual(m.series.map(s => s.label), ['12:00', '18:00', '19:00'])
  assert.deepEqual(m.series.map(s => s.values), [[10, null], [11, 21], [12, 22]])
  assert.deepEqual(m.series[1].at, [{ field: 'starts_at', bucket: 'hour', value: 18 }])
  assert.deepEqual(m.series[0].value, { key: 'guests', label: 'Guests' })
  // The Total column is never a series.
  assert.ok(m.series.every(s => !s.key.endsWith('total')))

  // No rows down the side: the columns across the top are the chart's rows, in their own order.
  const flat = matrix({ kind: 'line' })
  flat.columns = flat.columns.slice(1)
  flat.rows = [{ kind: 'row', level: 0, k: [], cells: [10, 11, 12, 33] }]
  const f = chartModel(flat)
  // Along a line of hours the ones with nothing are gaps, as days are.
  assert.deepEqual(f.cats.map(c => c.short), ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'])
  assert.deepEqual(f.series[0].values, [10, null, null, null, null, null, 11, 12])
  assert.deepEqual(f.cats[6].at, [{ field: 'starts_at', bucket: 'hour', value: 18 }])
  assert.deepEqual(f.cats.map(c => !!c.gap), [false, true, true, true, true, true, false, false])

  // Ten hours: the seven largest and everything else, since guests add up.
  const hours = [9, 10, 11, 12, 13, 14, 17, 18, 19, 20]
  const wide = chartModel(matrix({ kind: 'bar' }, hours))
  assert.equal(wide.series.length, MAX_SERIES)
  const rest = wide.series.at(-1)
  assert.deepEqual([rest.key, rest.label, rest.rest], ['__rest', 'Everything else', true])
  // The three smallest columns (09:00, 10:00, 11:00), added up row by row.
  assert.deepEqual(rest.values, [10 + 11 + 12, 21 + 22])
  assert.deepEqual(wide.series.slice(0, -1).map(s => s.label), ['12:00', '13:00', '14:00', '17:00', '18:00', '19:00', '20:00'])
  assert.match(wide.notes.join(' '), /7 largest on their own and adds the other 3 together/)
  // A figure that doesn't add up: the eight largest, and the rest left to the table.
  const rates = chartModel(matrix({ kind: 'bar' }, hours, { adds: false }))
  assert.equal(rates.series.length, MAX_SERIES)
  assert.ok(rates.series.every(s => !s.rest))
  assert.match(rates.notes.join(' '), /8 largest of 10: the table has them all/)

  // A second value across the top: the chart shows one and says which.
  const dual = matrix({ kind: 'bar', y: ['spend'] })
  dual.columns.splice(4, 0, { key: 'spend|0', label: 'Spend', group: '12:00', type: 'money', role: 'value', adds: true, of: 'spend', at: [{ field: 'starts_at', bucket: 'hour', value: 12 }] })
  dual.rows = dual.rows.map(x => ({ ...x, cells: [...x.cells.slice(0, 4), 99, ...x.cells.slice(4)] }))
  const d = chartModel(dual)
  assert.deepEqual(d.series.map(s => s.value.key), ['spend'])
  assert.match(d.notes.join(' '), /shows one value: Spend/)
})

test('too many rows: the first sixty, and the chart says so', () => {
  const rows = Array.from({ length: 75 }, (_, i) => ['Dish ' + (i + 1), 75 - i, 10])
  const m = chartModel(byDish({ kind: 'bar' }, { rows }))
  assert.equal(m.cats.length, 60)
  assert.equal(m.series[0].values.length, 60)
  assert.match(m.notes.join(' '), /first 60 of 75 rows: the table has them all/)
  // "Everything else" is a bar of its own on a chart of names, and left out along a line of days.
  const rest = chartModel(byDish({ kind: 'bar' }, { rest: true }))
  assert.deepEqual([rest.cats.at(-1).label, rest.cats.at(-1).rest], ['Every other dish', true])
  const r = byDay({ kind: 'line' })
  r.rows.push({ kind: 'rest', level: 0, k: [], cells: ['Every other day', 1, 1, 0] })
  const line = chartModel(r)
  assert.ok(line.cats.every(c => !c.rest))
  assert.match(line.notes.join(' '), /"Every other day" has no place along the bottom/)
})

test('parts of a whole', () => {
  const m = chartModel(byDish({ kind: 'parts', y: ['net_sales'] }))
  assert.equal(m.form, 'stack')
  // The top four, and the rest of the whole in grey.
  assert.deepEqual(m.cats.map(c => c.label), [...DISHES.map(d => d[0]), 'Everything else'])
  assert.equal(m.cats.at(-1).rest, true)
  assert.equal(m.total, 16567.5)
  assert.equal(m.series[0].values.at(-1), 16567.5 - (4120.5 + 3311 + 2256 + 1680))
  // The report's own "everything else" is the rest: nothing is added twice.
  const whole = byDish({ kind: 'parts', y: ['net_sales'] }, { rest: true })
  whole.totals = { cells: [null, 2741, 16567.5] }
  const w = chartModel(whole)
  assert.deepEqual(w.cats.map(c => c.label).slice(-2), ['Tom yum soup', 'Every other dish'])
  assert.equal(w.cats.length, 5)
  // No total: the parts shown are the whole.
  const bare = byDish({ kind: 'parts' })
  bare.totals = null
  assert.equal(chartModel(bare).total, 412 + 301 + 188 + 240)

  // More than six parts: bars in order, each with its share.
  const rows = Array.from({ length: 8 }, (_, i) => ['Dish ' + (i + 1), 80 - i * 10, 10])
  const long = byDish({ kind: 'parts' }, { rows })
  long.totals = { cells: [null, 360, 80] }
  const bars = chartModel(long)
  assert.deepEqual([bars.form, bars.sideways, bars.cats.length, bars.total], ['plot', true, 8, 360])
  assert.match(drawChart(bars, { width: 700 }).svg, /80 · 22\.2%/)

  // Below zero: not parts of anything.
  const neg = byDish({ kind: 'parts' }, { rows: [['Refunds', -40, 1], ['Sales', 100, 1]] })
  const n = chartModel(neg)
  assert.deepEqual([n.form, n.total], ['plot', null])
  assert.match(n.notes.join(' '), /below zero, so they are drawn as bars/)

  // An average or a rate can't be cut into parts.
  const avg = byDish({ kind: 'parts', y: ['net_sales'] })
  avg.columns[2] = money('net_sales', 'Average price', { adds: false })
  assert.match(chartModel(avg).why, /Average price doesn't add up to a whole/)
  assert.equal(chartModel(dayBySection({ kind: 'parts' })).why, 'Parts of a whole are for a summary with one grouping')
  assert.equal(chartModel(matrix({ kind: 'parts' })).why, 'Parts of a whole are for a summary with one grouping')
  const empty = byDish({ kind: 'parts' }, { rows: [['A', 0, 0], ['B', null, 0]] })
  assert.equal(chartModel(empty).why, null)
})

test('a heat table: a table across, or two groupings', () => {
  const m = chartModel(matrix({ kind: 'heat' }))
  assert.equal(m.form, 'heat')
  assert.deepEqual(m.xs.map(x => x.short), ['12:00', '18:00', '19:00'])
  assert.deepEqual(m.ys.map(y => [y.label, y.short]), [['Mon 19 Oct 2026', 'Mon 19 Oct'], ['Tue 20 Oct 2026', 'Tue 20 Oct']])
  assert.deepEqual(m.cells, [[10, 11, 12], [null, 21, 22]])
  assert.equal(m.value.label, 'Guests')
  // Down the side from the columns; across the top from what the result says its columns are.
  assert.deepEqual([m.yLabel, m.xLabel], ['Day', ''])
  assert.equal(drawChart(m, { width: 600 }).label, 'Heat table: Guests by day')
  const named = matrix({ kind: 'heat' })
  named.meta.across = ['Hour']
  assert.deepEqual([chartModel(named).yLabel, chartModel(named).xLabel], ['Day', 'Hour'])
  assert.equal(renderChart(named, { width: 600 }).label, 'Heat table: Guests by day and hour')
  named.meta.across = ['Hour', 'Area']
  assert.equal(renderChart(named, { width: 600 }).label, 'Heat table: Guests by day and hour, area')
  named.meta.across = ['VAT rate']
  assert.equal(renderChart(named, { width: 600 }).label, 'Heat table: Guests by day and VAT rate', 'initials keep their capitals')
  for (const odd of [null, 'Hour', [null, ''], {}]) {
    named.meta.across = odd
    assert.equal(renderChart(named, { width: 600 }).label, 'Heat table: Guests by day', JSON.stringify(odd))
  }

  const two = chartModel(dayBySection({ kind: 'heat' }))
  // The second grouping across the top, the first down the side.
  assert.deepEqual(two.xs.map(x => x.label), SECTIONS)
  assert.deepEqual(two.ys.map(y => y.short), ['Mon 19 Oct', 'Tue 20 Oct', 'Wed 21 Oct'])
  assert.deepEqual(two.cells[1], [200, 210, null, 230])
  assert.deepEqual([two.xLabel, two.yLabel], ['Section', 'Day'])
  assert.equal(renderChart(dayBySection({ kind: 'heat' }), { width: 600 }).label, 'Heat table: Net sales by day and section')
  // Or the one the view names, in its own order when it has one.
  const flip = dayBySection({ kind: 'heat', x: 'date' })
  flip.rows.reverse()
  const f = chartModel(flip)
  assert.deepEqual(f.xs.map(x => x.short), ['19 Oct', '20 Oct', '21 Oct'])
  assert.deepEqual(f.ys.map(y => y.label), [...SECTIONS].reverse())
  assert.equal(f.cells[f.ys.findIndex(y => y.label === 'Desserts')][1], null)

  // The same words as the builder's (chartChoices), so the two never disagree.
  assert.equal(chartModel(byDay({ kind: 'heat' })).why, 'A heat table needs two groupings, or a column across the top')
  assert.equal(chartChoices({ kind: 'summary', rows: [{}], values: [{ key: 'a' }] }).find(c => c.kind === 'heat').why, chartModel(byDay({ kind: 'heat' })).why)
  // Rows over more than one year keep their years.
  const years = matrix({ kind: 'heat' })
  years.rows[1] = row(['2027-01-01'], ['2027-01-01', 1, 2, 3, 6])
  assert.deepEqual(chartModel(years).ys.map(y => y.short), [undefined, undefined])

  // The drawing: a cell for each, the lightest and darkest named, numbers in the cells when they fit.
  const d = drawChart(m, { width: 600 })
  assert.equal(d.targets.length, 6)
  assert.deepEqual(d.targets[4], { ...d.targets[4], cat: 1, series: 1 })
  assert.deepEqual(d.legend, [])
  assert.match(d.svg, />21</)
  assert.match(d.svg, />Mon 19 Oct</)
  // In the brand's colour when it has one.
  assert.ok(drawChart(m, { width: 600, brand: '#630812' }).svg.includes('#630812'))
  assert.ok(!d.svg.includes('#630812'))
})

test('figures: each value\'s total, its change, and a trend', () => {
  const flat = chartModel(noGroup({ kind: 'figures' }))
  assert.equal(flat.form, 'figures')
  assert.deepEqual(flat.tiles.map(t => [t.label, t.value, t.change, t.trend]), [['Net sales', 22128.8, null, null], ['Checks', 931, null, null], ['Discount rate', 0.052, null, null]])
  assert.equal(flat.against, null)
  // Only the values the view names, in its order.
  assert.deepEqual(chartModel(noGroup({ kind: 'figures', y: ['checks', 'net_sales'] })).tiles.map(t => t.key), ['checks', 'net_sales'])

  // Grouped: the report's own totals (never rows added up here), with the run of days under each.
  const grouped = chartModel(byDay({ kind: 'figures' }))
  assert.deepEqual(grouped.tiles.map(t => t.value), [5186.1, 216, 0.047])
  assert.deepEqual(grouped.tiles[0].trend, [1210.5, 980.2, 1105, 1890.4])
  // A report of dishes has no order to run along.
  assert.equal(chartModel(byDish({ kind: 'figures' })).tiles[0].trend, null)
  // Totals switched off: nothing to show, and what to do about it.
  assert.equal(chartModel({ ...byDay({ kind: 'figures' }), totals: null }).why, 'Switch the total on to show the report as figures')
  assert.equal(chartModel(matrix({ kind: 'figures' })).why, 'Figures are for a summary')

  const cmp = chartModel(compared({ kind: 'figures' }))
  assert.deepEqual([cmp.tiles[0].value, cmp.tiles[0].before, cmp.tiles[0].change], [5186.1, 4786.1, 0.0836])
  assert.equal(cmp.against, 'the period before')
  assert.equal(chartModel({ ...compared({ kind: 'figures' }), meta: meta({ compare: { with: 'last_year' } }) }).against, 'last year')
  const d = drawChart(cmp, { width: 700 })
  assert.match(d.svg, /£5,186\.10/)
  assert.match(d.svg, /\+8\.4% on the period before/)
  assert.deepEqual([d.targets, d.legend], [[], []])
  // Two tiles side by side on a phone, too narrow for one line: the change, then what it is against.
  const pair = { ...cmp, tiles: [cmp.tiles[0], { ...cmp.tiles[0], key: 'checks', label: 'Checks', change: -0.031 }] }
  const narrow = drawChart(pair, { width: 360 }).svg
  assert.match(narrow, />\+8\.4%</)
  assert.match(narrow, />−3\.1%</)
  assert.equal((narrow.match(/>on the period before</g) || []).length, 2)
  assert.ok(drawChart(pair, { width: 360 }).height > drawChart(pair, { width: 760 }).height)

  // Nine values: eight tiles, and the chart says so.
  const nine = noGroup({ kind: 'figures' })
  nine.columns = Array.from({ length: 9 }, (_, i) => count('v' + i, 'Value ' + i))
  nine.rows = [{ kind: 'row', level: 0, k: [], cells: Array.from({ length: 9 }, (_, i) => i) }]
  const cut = chartModel(nine)
  assert.equal(cut.tiles.length, 8)
  assert.match(cut.notes.join(' '), /first 8 of 9 values/)
  // Five tiles are three and two, not four and one.
  const five = noGroup({ kind: 'figures' })
  five.columns = Array.from({ length: 5 }, (_, i) => count('v' + i, 'Value ' + i))
  five.rows = [{ kind: 'row', level: 0, k: [], cells: [1, 2, 3, 4, 5] }]
  const xs = [...drawChart(chartModel(five), { width: 760 }).svg.matchAll(/<rect x="([\d.]+)" y="(\d+)"/g)].map(x => [Number(x[1]), Number(x[2])])
  assert.equal(xs.filter(([, y]) => y === 0).length, 3)
  assert.equal(xs.length, 5)
})

// ── The drawing ──

test('the drawing: an SVG with a name, a mark for each row, a legend for two or more series', () => {
  const one = renderChart(byDay({ kind: 'bar' }), { width: 720 })
  assert.equal(one.ok, true)
  assert.ok(one.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 '))
  assert.match(one.svg, /role="img" aria-label="Bars: Net sales by day"/)
  assert.match(one.svg, /<title>Bars: Net sales by day<\/title>/)
  assert.equal(one.label, 'Bars: Net sales by day')
  assert.equal(one.width, 720)
  assert.ok(one.height > 150 && one.height < 420, String(one.height))
  // A place to point at for every row, the gap included, side by side across the plot.
  assert.deepEqual(one.targets.map(t => t.cat), [0, 1, 2, 3, 4])
  assert.ok(one.targets.every((t, i) => i === 0 || Math.abs(t.x - (one.targets[i - 1].x + one.targets[i - 1].w)) < 0.2))
  // One series: no legend (the title names it), four bars (none for the gap), the amounts on their caps.
  assert.deepEqual(one.legend, [])
  assert.equal(count1(one.svg), 4)
  assert.match(one.svg, />£1,211</)
  assert.match(one.svg, />£980</)
  assert.ok(!one.svg.includes('£980.20'))
  // A scale from zero.
  assert.match(one.svg, />£0</)
  assert.match(one.svg, />£2,000</)

  // The width is the page's; never narrower than a chart can be read at.
  assert.equal(drawChart(one.model, { width: 100 }).width, 260)
  assert.equal(drawChart(one.model, {}).width, 720)
  // No room for the amounts on a fortnight's bars on a phone: the bars are still there,
  // and only every few days are named.
  const fortnight = chartModel(byDay({ kind: 'bar' }, Array.from({ length: 14 }, (_, i) => [i, 1000 + i * 100.5, 10, 0.01])))
  assert.match(drawChart(fortnight, { width: 760 }).svg, />£1,101</)
  const small = drawChart(fortnight, { width: 260 })
  assert.equal(count1(small.svg), 14)
  assert.ok(!small.svg.includes('£1,101'))
  assert.equal(small.targets.length, 14)
  assert.ok((small.svg.match(/ Oct</g) || []).length < 14)

  const two = renderChart(byDay({ kind: 'line', y: ['net_sales', 'checks'] }), { width: 720 })
  assert.deepEqual(two.legend.map(l => [l.key, l.label, l.colour, l.mark, l.hidden, l.toggle]), [
    ['net_sales', 'Net sales', SERIES_COLOURS[0], 'line', false, true],
    ['checks', 'Checks', SERIES_COLOURS[1], 'line', false, true],
  ])
  // Each plot is named when there is more than one.
  assert.match(two.svg, />Net sales</)
  assert.match(two.svg, />Checks</)
  assert.match(two.label, /^Lines: Net sales, Checks by day$/)
})

test('colour goes with the series: hiding one never repaints the others', () => {
  const m = chartModel(dayBySection({ kind: 'bar' }))
  const all = drawChart(m, { width: 700 })
  assert.deepEqual(all.legend.map(l => l.colour), SERIES_COLOURS.slice(0, 4))
  const some = drawChart(m, { width: 700, hidden: ['s0', 's2'] })
  assert.deepEqual(some.legend.map(l => [l.colour, l.hidden]), [[SERIES_COLOURS[0], true], [SERIES_COLOURS[1], false], [SERIES_COLOURS[2], true], [SERIES_COLOURS[3], false]])
  assert.ok(!some.svg.includes(SERIES_COLOURS[0]) && !some.svg.includes(SERIES_COLOURS[2]))
  assert.ok(some.svg.includes(SERIES_COLOURS[1]) && some.svg.includes(SERIES_COLOURS[3]))
  // A Set works as well as a list.
  assert.equal(drawChart(m, { width: 700, hidden: new Set(['s1']) }).legend[1].hidden, true)
  // Switching every one off switches none off (a chart is never empty): the
  // drawing, its legend and the words about a row all say the same.
  const every = ['s0', 's1', 's2', 's3']
  const none = drawChart(m, { width: 700, hidden: every })
  assert.equal(none.svg, all.svg)
  assert.deepEqual(none.legend.map(l => l.hidden), [false, false, false, false])
  assert.equal(drawChart(m, { width: 700, legend: 'inside', hidden: every }).svg, drawChart(m, { width: 700, legend: 'inside' }).svg)
  assert.equal(chartTip(m, { cat: 0 }, { hidden: every }).lines.length, chartTip(m, { cat: 0 }).lines.length)
  // A key the chart doesn't have changes nothing, and doesn't count towards "every one".
  assert.equal(drawChart(m, { width: 700, hidden: ['nope'] }).svg, all.svg)
  assert.deepEqual(drawChart(m, { width: 700, hidden: ['nope', 's0', 's1', 's2'] }).legend.map(l => l.hidden), [true, true, true, false])
  // The words about a row leave the hidden ones out too.
  assert.deepEqual(chartTip(m, { cat: 0 }, { hidden: ['s0'] }).lines.map(l => l.label), ['Mains', 'Desserts', 'Drinks'])

  // One series wears the brand's colour, when it stands out on white.
  const one = chartModel(byDay({ kind: 'bar' }))
  assert.ok(drawChart(one, { brand: '#630812' }).svg.includes('#630812'))
  assert.ok(drawChart(one, { brand: '#ffe9a8' }).svg.includes(SERIES_COLOURS[0]))
  assert.ok(!drawChart(one, { brand: '#ffe9a8' }).svg.includes('#ffe9a8'))
  // Several series keep the fixed colours: the brand's would be one more to tell apart.
  assert.ok(!all.svg.includes('#630812') && !drawChart(m, { brand: '#630812' }).svg.includes('#630812'))
  // "Everything else" is grey, and takes no colour from the others.
  const wide = chartModel(matrix({ kind: 'bar' }, [9, 10, 11, 12, 13, 14, 17, 18, 19, 20]))
  assert.deepEqual(drawChart(wide).legend.map(l => l.colour), [...SERIES_COLOURS.slice(0, 7), '#898781'])
})

test('names that don\'t fit under their bars go down the side', () => {
  const m = chartModel(byDish({ kind: 'bar' }))
  const d = drawChart(m, { width: 400 })
  // A row for each dish, as wide as the chart (easy to hit), one above the other.
  assert.equal(d.targets.length, 4)
  assert.ok(d.targets.every(t => t.x === 0 && t.w === 400))
  assert.ok(d.targets.every((t, i) => i === 0 || t.y === d.targets[i - 1].y + d.targets[i - 1].h))
  // The long name is cut, the amounts are at the ends of the bars.
  assert.match(d.svg, />Green curry[^<]*…</)
  assert.match(d.svg, />412</)
  // Days fit under their bars: upright, unless the view says sideways.
  const days = chartModel(byDay({ kind: 'bar' }))
  assert.ok(drawChart(days, { width: 700 }).targets.every(t => t.h > 100))
  const side = chartModel(byDay({ kind: 'bar', sideways: true }))
  assert.equal(side.sideways, true)
  assert.ok(drawChart(side, { width: 700 }).targets.every(t => t.w === 700))
  // Sideways is for bars: a line stays a line.
  assert.equal(chartModel(byDay({ kind: 'line', sideways: true })).sideways, false)
  // Stacked bars down the side keep their parts.
  const st = chartModel(dayBySection({ kind: 'bar', stacked: true, sideways: true }))
  const sd = drawChart(st, { width: 500 })
  assert.equal(sd.targets.length, 3)
  for (const c of SERIES_COLOURS.slice(0, 4)) assert.ok(sd.svg.includes(c), c)
})

test('a chart says which figure it draws wherever the legend doesn\'t', () => {
  const texts = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(x => x[1])
  const bold = svg => [...svg.matchAll(/<text[^>]*font-weight="600"[^>]*>([^<]*)<\/text>/g)].map(x => x[1])

  // One series has no legend: the plot is headed with the figure's name, upright and sideways.
  const one = renderChart(byDay({ kind: 'bar' }), { width: 720 })
  assert.equal(one.model.of, undefined)
  assert.deepEqual(bold(one.svg), ['Net sales'])
  const side = renderChart(byDish({ kind: 'bar', y: ['net_sales'], sideways: true }), { width: 720 })
  assert.deepEqual(bold(side.svg), ['Net sales'])
  // The amounts on the bars keep clear of it.
  const head = one.svg.match(/<text[^>]*y="([\d.]+)"[^>]*font-weight="600"/)
  const cap = one.svg.match(/<text[^>]*y="([\d.]+)"[^>]*>£1,890</)
  assert.ok(head && cap && Number(cap[1]) - Number(head[1]) >= 12, [head?.[1], cap?.[1]].join(' / '))

  // Two values in one plot: the legend names them, nothing is said twice.
  const two = renderChart(byDay({ kind: 'bar', y: ['net_sales'] }), { width: 720 })
  assert.equal(two.legend.length, 0)
  const money2 = { ...byDay({ kind: 'bar', y: ['net_sales', 'tips'] }) }
  money2.columns = [dateCol, money('net_sales', 'Net sales'), money('tips', 'Tips')]
  money2.rows = money2.rows.map(r => ({ ...r, cells: [r.cells[0], r.cells[1], 12] }))
  const both = renderChart(money2, { width: 720 })
  assert.deepEqual(both.legend.map(l => l.label), ['Net sales', 'Tips'])
  assert.deepEqual(bold(both.svg), [])

  // Series named after another grouping: the legend names the sections, the heading the figure.
  const by = renderChart(dayBySection({ kind: 'bar', stacked: true }), { width: 720 })
  assert.equal(by.model.of, 'Net sales')
  assert.deepEqual(by.legend.map(l => l.label), SECTIONS)
  assert.deepEqual(bold(by.svg), ['Net sales'])
  assert.equal(by.label, 'Bars: Net sales (Starters, Mains, Desserts, Drinks) by day')
  // Hiding a series never moves the plot: the heading stays.
  const fewer = drawChart(by.model, { width: 720, hidden: ['s1', 's2', 's3'] })
  assert.equal(fewer.height, by.height)
  assert.deepEqual(bold(fewer.svg), ['Net sales'])
  // The same down the side, and for the columns of a table across.
  assert.deepEqual(bold(renderChart(dayBySection({ kind: 'bar', stacked: true, sideways: true }), { width: 500 }).svg), ['Net sales'])
  const across = renderChart(matrix({ kind: 'line' }), { width: 720 })
  assert.equal(across.model.of, 'Guests')
  assert.deepEqual(across.legend.map(l => l.label), ['12:00', '18:00', '19:00'])
  assert.deepEqual(bold(across.svg), ['Guests'])

  // Parts of a whole: the figure and what it comes to; a heat table: the figure beside its scale.
  const parts = renderChart(byDish({ kind: 'parts', y: ['net_sales'] }), { width: 720 })
  assert.equal(parts.model.form, 'stack')
  assert.deepEqual(bold(parts.svg).filter(t => !/%$/.test(t)), ['Net sales · £16,567.50 in all'])
  const heat = renderChart(matrix({ kind: 'heat' }), { width: 720 })
  assert.deepEqual(bold(heat.svg), ['Guests'])
  assert.ok(texts(heat.svg).includes('Guests'))
})

test('a printed chart carries its own legend', () => {
  const m = chartModel(dayBySection({ kind: 'bar' }))
  const plain = drawChart(m, { width: 700 })
  const printed = drawChart(m, { width: 700, legend: 'inside' })
  for (const s of SECTIONS) {
    assert.ok(!plain.svg.includes('>' + s + '<'), s)
    assert.ok(printed.svg.includes('>' + s + '<'), s)
  }
  assert.ok(printed.height > plain.height)
  assert.match(printed.svg, /print-color-adjust:exact/)
  // A hidden series isn't in a printed legend.
  assert.ok(!drawChart(m, { width: 700, legend: 'inside', hidden: ['s1'] }).svg.includes('>Mains<'))
  // One series has no legend to carry.
  const one = chartModel(byDay({ kind: 'bar' }))
  assert.equal(drawChart(one, { width: 700, legend: 'inside' }).height, drawChart(one, { width: 700 }).height)
  // Parts of a whole name their parts.
  const parts = chartModel(byDish({ kind: 'parts' }))
  assert.match(drawChart(parts, { width: 700, legend: 'inside' }).svg, />Pad Thai</)
  assert.deepEqual(drawChart(parts).legend.map(l => [l.label, l.toggle]).at(-1), ['Everything else', false])
})

test('every word that reaches the drawing is escaped', () => {
  const nasty = '<script>alert("x")</script> & \'co\''
  const rows = [[nasty, 5, 10], ['"Quoted" <b>bold</b>', 3, 6]]
  for (const view of [{ kind: 'bar' }, { kind: 'bar', sideways: true }, { kind: 'line' }, { kind: 'parts' }, { kind: 'figures' }]) {
    const r = byDish(view, { rows })
    r.columns[1] = count('qty_sold', 'Sold <i>&</i>')
    const d = renderChart(r, { width: 500, legend: 'inside' })
    assert.equal(d.ok, true, view.kind)
    assert.ok(!/<script|<b>|<i>/.test(d.svg), view.kind + (view.sideways ? ' sideways' : ''))
    assert.ok(!d.svg.includes('alert("x")'), view.kind)
    // Only the drawing's own elements.
    const tags = new Set([...d.svg.matchAll(/<([a-z]+)/g)].map(x => x[1]))
    for (const t of tags) assert.ok(['svg', 'title', 'text', 'rect', 'path', 'line', 'circle'].includes(t), t)
  }
  // Across the top and in a legend too.
  const m = matrix({ kind: 'heat' })
  m.columns[1].group = '<img src=x onerror=1>'
  assert.ok(!drawChart(chartModel(m)).svg.includes('<img'))
  const s = dayBySection({ kind: 'bar' })
  s.rows[0].k[1] = '<svg onload=1>'
  s.rows[0].cells[1] = '<svg onload=1>'
  assert.ok(!drawChart(chartModel(s), { legend: 'inside' }).svg.includes('<svg onload'))
  // A name is data, never a colour or an attribute.
  assert.ok(!drawChart(chartModel(byDay({ kind: 'bar' })), { brand: '"/><script>' }).svg.includes('<script'))
})

// ── What a mark says and stands for ──

test('what a mark says: a line for each series that has something there', () => {
  const one = chartModel(byDay({ kind: 'bar' }))
  assert.deepEqual(chartTip(one, { cat: 1 }), { title: 'Tue 20 Oct 2026', lines: [{ label: 'Net sales', value: '£980.20', colour: SERIES_COLOURS[0] }] })
  // The day with nothing says so, rather than a line of noughts.
  assert.deepEqual(chartTip(one, { cat: 3 }), { title: 'Thu 22 Oct 2026', lines: [], none: true })
  assert.equal(chartTip(one, { cat: 99 }), null)
  assert.equal(chartTip(one, null), null)
  assert.equal(chartTip({ ok: false }, { cat: 0 }), null)

  // Two plots: both values, each in its own colour and its own words.
  const two = chartModel(byDay({ kind: 'combo', y: ['net_sales'], line: 'discount_rate' }))
  assert.deepEqual(chartTip(two, { cat: 0 }).lines, [
    { label: 'Net sales', value: '£1,210.50', colour: SERIES_COLOURS[0] },
    { label: 'Discount rate', value: '3.0%', colour: SERIES_COLOURS[1] },
  ])
  // A stack: its parts and what they come to; a part with nothing left out.
  const st = chartModel(dayBySection({ kind: 'bar', stacked: true }))
  const tip = chartTip(st, { cat: 1 })
  assert.deepEqual(tip.lines.map(l => [l.label, l.value]), [['Starters', '£200.00'], ['Mains', '£210.00'], ['Drinks', '£230.00'], ['Total', '£640.00']])
  assert.equal(tip.lines.at(-1).colour, null)
  // Side by side: no total.
  assert.ok(!chartTip(chartModel(dayBySection({ kind: 'bar' })), { cat: 1 }).lines.some(l => l.label === 'Total'))
  // The period before, in grey.
  assert.deepEqual(chartTip(chartModel(compared({ kind: 'line' })), { cat: 0 }).lines.map(l => [l.label, l.value, l.colour]), [['Net sales', '£1,210.50', SERIES_COLOURS[0]], ['Before', '£1,110.50', '#898781']])

  // Parts of a whole: the amount and its share, as a block and as a bar.
  const parts = chartModel(byDish({ kind: 'parts', y: ['net_sales'] }))
  assert.deepEqual(chartTip(parts, { cat: 0 }), { title: 'Pad Thai', lines: [{ label: 'Net sales', value: '£4,120.50', colour: SERIES_COLOURS[0] }, { label: 'Share', value: '24.9%', colour: null }] })
  assert.equal(chartTip(parts, { cat: 4 }).lines[0].colour, '#898781')
  const rows = Array.from({ length: 8 }, (_, i) => ['Dish ' + (i + 1), 80 - i * 10, 10])
  const long = byDish({ kind: 'parts' }, { rows })
  long.totals = { cells: [null, 360, 80] }
  assert.deepEqual(chartTip(chartModel(long), { cat: 0 }).lines.map(l => [l.label, l.value]), [['Sold', '80'], ['Share', '22.2%']])

  // A heat table: the row and the column, and nothing where there is nothing.
  const heat = chartModel(matrix({ kind: 'heat' }))
  assert.deepEqual(chartTip(heat, { cat: 0, series: 1 }), { title: 'Mon 19 Oct 2026 · 18:00', lines: [{ label: 'Guests', value: '11', colour: null }] })
  assert.deepEqual(chartTip(heat, { cat: 1, series: 0 }), { title: 'Tue 20 Oct 2026 · 12:00', lines: [], none: true })
  assert.equal(chartTip(heat, { cat: 5, series: 0 }), null)
  assert.equal(chartTip(chartModel(noGroup({ kind: 'figures' })), { cat: 0 }), null)
})

test('what a mark stands for, to open it up', () => {
  const one = chartModel(byDay({ kind: 'bar' }))
  assert.deepEqual(chartMark(one, { cat: 1 }), { at: [{ field: 'date', value: day(1) }], label: 'Tue 20 Oct 2026', value: { key: 'net_sales', label: 'Net sales' } })
  // A day with nothing has nothing behind it.
  assert.equal(chartMark(one, { cat: 3 }), null)
  assert.equal(chartMark(one, { cat: 9 }), null)
  assert.equal(chartMark(one, null), null)
  // A bucket goes with its field.
  const weeks = byDay({ kind: 'line' })
  weeks.columns[0] = { key: 'date:week', field: 'date', bucket: 'week', label: 'Week', type: 'date', role: 'row' }
  assert.deepEqual(chartMark(chartModel(weeks), { cat: 0 }).at, [{ field: 'date', bucket: 'week', value: day(0) }])

  // Two values on one chart: the row, and no one figure.
  assert.equal(chartMark(chartModel(byDay({ kind: 'bar', y: ['net_sales', 'checks'] })), { cat: 0 }).value, null)
  // The period before is the same figure: still the one.
  assert.deepEqual(chartMark(chartModel(compared({ kind: 'bar' })), { cat: 0 }).value, { key: 'net_sales', label: 'Net sales' })
  // Two groupings: the row along the bottom (each grouping held is a filter).
  const two = chartMark(chartModel(dayBySection({ kind: 'bar' })), { cat: 2 })
  assert.deepEqual(two.at, [{ field: 'date', value: day(2) }])
  assert.equal(two.value.key, 'net_sales')
  // "Everything else" stands for nothing in particular.
  const rest = chartModel(byDish({ kind: 'bar' }, { rest: true }))
  assert.equal(chartMark(rest, { cat: 4 }), null)
  assert.equal(chartMark(rest, { cat: 0 }).label, 'Pad Thai')
  const parts = chartModel(byDish({ kind: 'parts' }))
  assert.equal(chartMark(parts, { cat: 4 }), null)
  assert.deepEqual(chartMark(parts, { cat: 1 }).at, [{ field: 'name', value: DISHES[1][0] }])
  // Nothing in a grouping is a value like any other.
  const blank = byDish({ kind: 'bar' }, { rows: [[null, 5, 10], ['Pad Thai', 3, 6]] })
  blank.rows[0].k = [null]
  const b = chartModel(blank)
  assert.equal(b.cats[0].label, '(none)')
  assert.deepEqual(chartMark(b, { cat: 0 }).at, [{ field: 'name', value: null }])

  // A heat cell: its row and its column.
  const heat = chartModel(matrix({ kind: 'heat' }))
  assert.deepEqual(chartMark(heat, { cat: 1, series: 2 }), {
    at: [{ field: 'date', value: day(1) }, { field: 'starts_at', bucket: 'hour', value: 19 }],
    label: 'Tue 20 Oct 2026 · 19:00', value: { key: 'guests', label: 'Guests' },
  })
  assert.equal(chartMark(heat, { cat: 7, series: 0 }), null)
  // Figures open nothing: the table under them does.
  assert.equal(chartMark(chartModel(noGroup({ kind: 'figures' })), { cat: 0 }), null)
})

test('which values a chart draws: the view\'s picks, else the first; every one for figures; a line and its bars', () => {
  const keys = ['net', 'checks', 'rate']
  // Bars, lines, areas, parts, a heat table: the picks in the view's order, else the first value.
  for (const kind of ['bar', 'line', 'area', 'parts', 'heat']) {
    assert.deepEqual(chartValues(kind, keys, {}), { ys: ['net'], line: null }, kind)
    assert.deepEqual(chartValues(kind, keys, { y: ['rate', 'net'] }), { ys: ['rate', 'net'], line: null }, kind)
  }
  // Picks the report doesn't show are left out, and a pick twice counts once.
  assert.deepEqual(chartValues('bar', keys, { y: ['gone', 'checks', 'checks'] }).ys, ['checks'])
  assert.deepEqual(chartValues('bar', keys, { y: ['gone'] }).ys, ['net'])
  assert.deepEqual(chartValues('bar', [], { y: ['net'] }), { ys: [], line: null })
  assert.deepEqual(chartValues('bar', keys), { ys: ['net'], line: null })
  assert.deepEqual(chartValues('bar', null, null), { ys: [], line: null })
  // Figures: every value unless some are picked.
  assert.deepEqual(chartValues('figures', keys, {}).ys, keys)
  assert.deepEqual(chartValues('figures', keys, { y: ['checks'] }).ys, ['checks'])
  // Bars with a line: the line is the one named, else the first that isn't a bar.
  assert.deepEqual(chartValues('combo', keys, {}), { ys: ['net'], line: 'checks' })
  assert.deepEqual(chartValues('combo', keys, { y: ['checks'] }), { ys: ['checks'], line: 'net' })
  assert.deepEqual(chartValues('combo', keys, { line: 'rate' }), { ys: ['net'], line: 'rate' })
  assert.deepEqual(chartValues('combo', keys, { y: ['net', 'checks'], line: 'rate' }), { ys: ['net', 'checks'], line: 'rate' })
  // The line is never one of the bars; with every value picked as a bar (a report that was
  // drawn as bars a moment ago) the last of them becomes the line.
  assert.deepEqual(chartValues('combo', keys, { y: ['net', 'rate'], line: 'net' }), { ys: ['rate'], line: 'net' })
  assert.deepEqual(chartValues('combo', keys, { y: ['net'], line: 'net' }), { ys: ['checks'], line: 'net' })
  assert.deepEqual(chartValues('combo', keys, { y: keys }), { ys: ['net', 'checks'], line: 'rate' })
  assert.deepEqual(chartValues('combo', keys, { y: ['rate', 'net', 'checks'] }), { ys: ['rate', 'net'], line: 'checks' })
  assert.deepEqual(chartValues('combo', ['net', 'checks'], { y: ['checks', 'net'] }), { ys: ['checks'], line: 'net' })
  assert.deepEqual(chartValues('combo', ['net'], {}), { ys: [], line: null })
  assert.deepEqual(chartValues('combo', ['net'], { line: 'net' }), { ys: [], line: null })

  // The drawing follows the same rule: what it draws is what chartValues() says, for every kind and view.
  const shown = ['net_sales', 'checks', 'discount_rate']
  const views = [
    {}, { y: ['checks'] }, { y: ['discount_rate', 'net_sales'] }, { line: 'discount_rate' },
    { y: ['net_sales', 'checks'], line: 'discount_rate' }, { y: ['net_sales'], line: 'net_sales' },
    // Every value picked as a bar: bars with a line make the last of them the line.
    { y: shown }, { y: ['discount_rate', 'checks', 'net_sales'] },
  ]
  for (const view of views) {
    const said = JSON.stringify(view)
    for (const kind of ['bar', 'line', 'combo']) {
      const m = chartModel(byDay({ kind, ...view }))
      const want = chartValues(kind, shown, view)
      assert.equal(m.ok, true, kind + ' ' + said)
      const lines = kind === 'combo' ? m.series.filter(x => x.mark === 'line') : []
      assert.deepEqual(m.series.filter(x => !lines.includes(x)).map(x => x.key), want.ys, kind + ' ' + said)
      assert.deepEqual(lines.map(x => x.key), want.line ? [want.line] : [], kind + ' ' + said)
    }
    assert.deepEqual(chartModel(byDay({ kind: 'figures', ...view })).tiles.map(t => t.key), chartValues('figures', shown, view).ys, said)
  }
  assert.deepEqual(chartModel(byDay({ kind: 'combo', y: shown })).series.map(x => [x.key, x.mark]), [['net_sales', 'bar'], ['checks', 'bar'], ['discount_rate', 'line']])
})

// ── Limits, orders and words that a deliberate fault once slipped past ──

const sumOf = (cols, rows, view) => ({ kind: 'summary', spec: { view }, columns: cols, rows, totals: { cells: cols.map(() => null) }, meta: meta() })
const daysOf = n => Array.from({ length: n }, (_, i) => row([day(i)], [day(i), i + 1]))
const bookings = () => count('n', 'Bookings')

test('a run of days: four hundred points (more than a chart of names), the rest left to the table', () => {
  for (const kind of ['line', 'bar']) {
    const m = chartModel(sumOf([dateCol, bookings()], daysOf(450), { kind }))
    assert.equal(m.cats.length, 400, kind)
    assert.deepEqual(m.notes, ['The chart draws the first 400 of 450 rows: the table has them all'], kind)
  }
  assert.deepEqual(chartModel(sumOf([dateCol, bookings()], daysOf(401), { kind: 'line' })).cats.length, 400)
  const all = chartModel(sumOf([dateCol, bookings()], daysOf(400), { kind: 'line' }))
  assert.deepEqual([all.cats.length, all.notes], [400, []])
})

test('the order along the bottom: hours of the day, weeks a week apart, days far apart still in date order', () => {
  // A time by its hour has an order of its own: given 18, 12, 19 it runs 12 to 19, the hours with nothing as gaps.
  const hourCol = { key: 'starts_at', field: 'starts_at', label: 'Time', type: 'moment', bucket: 'hour', role: 'row' }
  const h = chartModel(sumOf([hourCol, bookings()], [row([18], [18, 5]), row([12], [12, 9]), row([19], [19, 2])], { kind: 'line' }))
  assert.equal(h.x.ordered, true)
  assert.deepEqual(h.cats.map(c => c.short), ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'])
  assert.deepEqual(h.cats.map(c => !!c.gap), [false, true, true, true, true, true, false, false])
  assert.deepEqual(h.series[0].values, [9, null, null, null, null, null, 5, 2])

  // Weeks: the one between two weeks is a gap, not six days of nothing.
  const weekCol = { ...dateCol, bucket: 'week', label: 'Week' }
  const w = chartModel(sumOf([weekCol, bookings()], [row(['2026-10-19'], ['2026-10-19', 5]), row(['2026-11-02'], ['2026-11-02', 9])], { kind: 'line' }))
  assert.deepEqual(w.cats.map(c => [c.k, !!c.gap]), [['2026-10-19', false], ['2026-10-26', true], ['2026-11-02', false]])

  // Days too far apart to draw every day between them: each one, in date order, with no gaps.
  const far = chartModel(sumOf([dateCol, bookings()], [row(['2026-06-01'], ['2026-06-01', 5]), row(['2024-01-01'], ['2024-01-01', 9]), row(['2025-03-01'], ['2025-03-01', 2])], { kind: 'line' }))
  assert.deepEqual(far.cats.map(c => c.k), ['2024-01-01', '2025-03-01', '2026-06-01'])
  assert.deepEqual(far.series[0].values, [9, 2, 5])
  assert.ok(far.cats.every(c => !c.gap))
  assert.deepEqual(far.notes, [])
})

test('the words along the bottom: a month\'s year only when the rows span two, a grouping\'s own word for nothing', () => {
  const monthCol = { ...dateCol, bucket: 'month', label: 'Month' }
  const months = ks => chartModel(sumOf([monthCol, bookings()], ks.map((k, i) => row([k], [k, i + 1])), { kind: 'bar' })).cats.map(c => c.short)
  assert.deepEqual(months(['2026-11-01', '2026-12-01', '2027-01-01']), ['Nov 26', 'Dec 26', 'Jan 27'])
  assert.deepEqual(months(['2026-10-01', '2026-11-01']), ['Oct', 'Nov'])
  // A row with nothing in its grouping goes by the grouping's own word for that.
  const dish = sumOf([{ ...nameCol, empty: 'No dish' }, bookings()], [row(['Pad Thai'], ['Pad Thai', 3]), row([null], [null, 2])], { kind: 'bar' })
  assert.deepEqual(chartModel(dish).cats.map(c => c.label), ['Pad Thai', 'No dish'])
})

test('counts go up in whole steps of 1, 2 or 5', () => {
  // Never 2.5, and never 2.5 rounded up to 3.
  assert.deepEqual(axisScale(0, 12, { type: 'number', counts: true }), { min: 0, max: 15, step: 5, ticks: [0, 5, 10, 15] })
  assert.deepEqual(axisScale(0, 12, { type: 'money' }).step, 2.5)
})

test('a point on its own on a long line is a dot', () => {
  // Forty days are too many for a dot each, but day 11 has nothing either side to join.
  const rows = Array.from({ length: 40 }, (_, i) => i).filter(i => i !== 10 && i !== 12).map(i => row([day(i)], [day(i), i + 1]))
  const m = chartModel(sumOf([dateCol, bookings()], rows, { kind: 'line' }))
  assert.equal(m.cats.length, 40)
  assert.equal((drawChart(m, { width: 900 }).svg.match(/<circle/g) || []).length, 1)
})

test('more series than colours that don\'t add up: the eight largest, not the first eight', () => {
  const m = chartModel(matrix({ kind: 'bar' }, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], { adds: false }))
  assert.deepEqual(m.series.map(s => s.label), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  assert.deepEqual(m.notes, ['The chart draws the 8 largest of 10: the table has them all'])
  // A line the report doesn't have isn't drawn: the first value not among the bars is.
  assert.deepEqual(chartValues('combo', ['a', 'b', 'c'], { line: 'gone' }), { ys: ['a'], line: 'b' })
})

test('a result with no rows draws nothing and says nothing, whatever the kind', () => {
  for (const kind of CHART_KINDS) {
    const r = byDay({ kind })
    r.rows = []
    const m = chartModel(r)
    assert.deepEqual([m.ok, m.why], [false, null], kind)
  }
})

test('a heat table: forty columns and sixty rows at most, and what it leaves out it says', () => {
  const wide = chartModel(matrix({ kind: 'heat' }, Array.from({ length: 45 }, (_, i) => i)))
  assert.deepEqual([wide.xs.length, wide.cells[0].length, wide.ys.length], [40, 40, 2])
  assert.deepEqual(wide.notes, ['The heat table draws the first 40 of 45 columns: the table has them all'])
  const tallRows = n => Array.from({ length: n }, (_, i) => ({ kind: 'row', level: 2, k: [day(i), 'Mains'], cells: [day(i), 'Mains', i] }))
  const tall = chartModel(sumOf([dateCol, sectionCol, count('n', 'Sold')], tallRows(70), { kind: 'heat', x: 'section.name' }))
  assert.deepEqual([tall.ys.length, tall.cells.length, tall.xs.length], [60, 60, 1])
  assert.deepEqual(tall.notes, ['The heat table draws the first 60 of 70 rows: the table has them all'])
  const big = matrix({ kind: 'heat' }, Array.from({ length: 45 }, (_, i) => i))
  big.rows = Array.from({ length: 70 }, (_, i) => row([day(i)], [day(i), ...Array.from({ length: 45 }, (_, j) => i + j), 0]))
  assert.deepEqual(chartModel(big).notes, ['The heat table draws the first 60 of 70 rows and 40 of 45 columns: the table has them all'])
  assert.deepEqual(chartModel(sumOf([dateCol, sectionCol, count('n', 'Sold')], tallRows(60), { kind: 'heat', x: 'section.name' })).notes, [])

  // The report's own "everything else" has no cell of its own.
  const rest = sumOf([nameCol, sectionCol, count('n', 'Sold')], [{ kind: 'row', level: 2, k: ['A', 'Mains'], cells: ['A', 'Mains', 3] }, { kind: 'rest', level: 0, k: [], cells: ['Every other dish', null, 9] }], { kind: 'heat' })
  assert.deepEqual(chartModel(rest).notes, ['"Every other dish" isn\'t in the heat table'])
  // Three groupings aren't a heat table, in the builder as on the page.
  const three = { kind: 'summary', spec: { view: { kind: 'heat' } }, columns: [dateCol, sectionCol, nameCol, count('n', 'Sold')], rows: [{ kind: 'row', level: 3, k: [day(0), 'Mains', 'A'], cells: [day(0), 'Mains', 'A', 1] }], totals: { cells: [null, null, null, 1] }, meta: meta() }
  assert.equal(chartModel(three).why, 'A heat table needs two groupings, or a column across the top')
  assert.equal(chartChoices({ kind: 'summary', rows: [{}, {}, {}], values: [{ key: 'a' }] }).find(k => k.kind === 'heat').why, 'A heat table needs two groupings, or a column across the top')
})

test('a heat table\'s shades: from zero, empty cells blank, words that read on their cell, amounts only where they fit', () => {
  const r = { ...matrix({ kind: 'heat' }), meta: meta({ across: ['Time'] }) }
  r.rows = [row([day(0)], [day(0), 100, 105, 110, 315]), row([day(1)], [day(1), null, 5, 108, 113])]
  const d = drawChart(chartModel(r), { width: 700 })
  // The cells come first, left to right and top to bottom: 100, 105, 110, nothing, 5, 108.
  const fills = (d.svg.match(/<rect[^>]*>/g) || []).slice(0, 6).map(x => x.match(/fill="([^"]+)"/)[1])
  // The shades run from zero: a hundred is dark, not the lightest shade because it is the smallest of these.
  assert.notEqual(fills[0], RAMP[0])
  assert.equal(fills[2], RAMP.at(-1))
  assert.equal(fills[4], RAMP[1])
  // A cell with nothing in it is blank, not the shade of zero.
  assert.equal(fills[3], '#f4f4f1')
  // White words on dark cells, dark words on light ones.
  const ink = Object.fromEntries([...d.svg.matchAll(/<text[^>]*fill="([^"]+)"[^>]*>(\d+)<\/text>/g)].filter(x => ['105', '5', '108'].includes(x[2])).map(x => [x[2], x[1]]))
  assert.deepEqual(ink, { 105: '#ffffff', 5: '#0b0b0b', 108: '#ffffff' })
  // Too narrow for the amounts: the cells go without them, and the scale says what the shades mean.
  const narrow = drawChart(chartModel({ ...matrix({ kind: 'heat' }, Array.from({ length: 24 }, (_, i) => i)), meta: meta({ across: ['Time'] }) }), { width: 320 }).svg
  assert.deepEqual([...narrow.matchAll(/>(\d+)<\/text>/g)].map(x => x[1]), ['0', '43'])
})

test('parts of a whole: six in one bar, seven as bars down the side, everything else in grey', () => {
  const whole = (rows, total) => ({ kind: 'summary', spec: { view: { kind: 'parts' } }, columns: [nameCol, count('qty', 'Sold')], rows, totals: { cells: [null, total] }, meta: meta() })
  const dishes = n => Array.from({ length: n }, (_, i) => row(['Dish ' + (i + 1)], ['Dish ' + (i + 1), 100 - i * 10]))
  assert.equal(chartModel(whole(dishes(6), 450)).form, 'stack')
  const seven = chartModel(whole(dishes(7), 490))
  assert.deepEqual([seven.form, seven.sideways, seven.cats.length], ['plot', true, 7])

  // The report's own "everything else" is grey, in one bar and down the side.
  const rest = { kind: 'rest', level: 0, k: [], cells: ['Every other dish', 40] }
  const stack = drawChart(chartModel(whole([...dishes(3), rest], 310)), { width: 600 })
  assert.deepEqual(stack.legend.map(l => l.colour), [SERIES_COLOURS[0], SERIES_COLOURS[1], SERIES_COLOURS[2], '#898781'])
  assert.deepEqual((stack.svg.match(/<rect[^>]*>/g) || []).map(x => x.match(/fill="([^"]+)"/)[1]), [SERIES_COLOURS[0], SERIES_COLOURS[1], SERIES_COLOURS[2], '#898781'])
  const side = drawChart(chartModel(whole([...dishes(7), rest], 530)), { width: 600 })
  const bars = (side.svg.match(/<path[^>]*>/g) || []).map(x => x.match(/fill="([^"]+)"/)[1])
  assert.deepEqual(bars, [...Array(7).fill(SERIES_COLOURS[0]), '#898781'])

  // A part with nothing in it takes no room: two blocks, the second ending at the edge.
  const zero = drawChart(chartModel(whole([row(['A'], ['A', 60]), row(['B'], ['B', 0]), row(['C'], ['C', 40])], 100)), { width: 500 })
  const blocks = (zero.svg.match(/<rect[^>]*>/g) || []).map(x => [Number(x.match(/ x="([^"]+)"/)[1]), Number(x.match(/ width="([^"]+)"/)[1])])
  assert.deepEqual(blocks, [[0, 298.8], [300.8, 199.2]])
  assert.equal(zero.targets.length, 2)
  // A share is written in its part only when it fits there, with a decimal under 10%.
  const sliver = drawChart(chartModel(whole([row(['A'], ['A', 990]), row(['B'], ['B', 10])], 1000)), { width: 320 }).svg
  assert.match(sliver, />99%</)
  assert.doesNotMatch(sliver, />1\.0%</)
  const small = drawChart(chartModel(whole([row(['A'], ['A', 950]), row(['B'], ['B', 50])], 1000)), { width: 1200 }).svg
  assert.match(small, />95%</)
  assert.match(small, />5\.0%</)
})

test('figures: four tiles to a row at most, a shorter figure when the whole one doesn\'t fit, a dash for none, a trend from three days', () => {
  const tiles = (n, value = i => i + 1, type = count) => {
    const r = noGroup({ kind: 'figures' })
    r.columns = Array.from({ length: n }, (_, i) => type('v' + i, 'Value ' + i))
    r.rows = [{ kind: 'row', level: 0, k: [], cells: Array.from({ length: n }, (_, i) => value(i)) }]
    return r
  }
  const eight = drawChart(chartModel(tiles(8)), { width: 1600 }).svg
  const ys = [...eight.matchAll(/<rect x="[\d.]+" y="(\d+)"/g)].map(x => Number(x[1]))
  assert.deepEqual([ys.length, new Set(ys).size, ys.filter(y => y === 0).length], [8, 2, 4])

  // Four tiles side by side: £1,234,567.89 doesn't fit in one, so it says £1.2M.
  const four = drawChart(chartModel(tiles(4, () => 1234567.89, money)), { width: 720 }).svg
  assert.doesNotMatch(four, /£1,234,567\.89/)
  assert.equal((four.match(/>£1\.2M</g) || []).length, 4)
  // The same figure alone has the room.
  assert.match(drawChart(chartModel(tiles(1, () => 1234567.89, money)), { width: 720 }).svg, />£1,234,567\.89</)

  // A total with nothing in it is a dash.
  const none = byDay({ kind: 'figures' })
  none.totals = { cells: [null, 5186.1, null, 0.047] }
  assert.match(drawChart(chartModel(none), { width: 700 }).svg, />–</)

  // Two days aren't a trend; three are.
  assert.deepEqual(chartModel(byDay({ kind: 'figures' }, DAYS.slice(0, 2))).tiles.map(t => t.trend), [null, null, null])
  assert.deepEqual(chartModel(byDay({ kind: 'figures' }, DAYS.slice(0, 3))).tiles[0].trend, [1210.5, 980.2, 1105])
})
