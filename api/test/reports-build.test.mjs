// The report builder only offers what the engine runs (docs/REPORTS.md 9).
//
// shared/reports/build.js says what each field, figure and link of the data
// catalogue can be in a report (a grouping, a list column, a value, a
// filter) and how a report is changed a step at a time. The builder's screen
// is drawn from it. These tests take everything it offers, for every
// subject, put it into definitions the way the screen does and run them on a
// database with real sales: a choice the engine refuses, or that isn't SQL
// the database accepts, can't be on the screen.
//
// The sales are the two trading days of support/tillDays.mjs (see
// reports-engine.test.mjs for the checks and dishes).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { runner, refused, rowsOf, totalsRow, LEVELS } from './support/reports.mjs'
import { CATALOGUE, catalogueView, listColumns, worksAcross, ACROSS_AGGS } from '../src/reports/catalogue/index.js'
import { normaliseReport, reportProblems, rowId, LIMITS } from '../../shared/reports/spec.js'
import { resolvePath } from '../../shared/reports/paths.js'
import { drillSpec } from '../../shared/reports/drill.js'
import { NUMERIC_TYPES } from '../../shared/reports/format.js'
import {
  pathUses, dataTree, treeNodes, searchTree, startReport, filterOps, filterShape, filterValueKind, filterWords,
  addRow, addColumn, removeRow, removeColumn, updateRow, addValue, updateValue, removeValue, addFilter, setFilter, removeFilter,
  setParamDefault, setSort, setLimit, limitOf, setTotals, setCompare, compareProblem, setKind, paramInputs, usedParams,
  rowName, valueName, sortChoices, addDrillLevel, setDrillRows, drillLevels, drillRoom,
} from '../../shared/reports/build.js'

let ids, run, t, view, d1, d2, d3
const TODAY = { relative: 'today' }
const cells = res => res.rows.map(r => r.cells)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  t = await sellTwoDays({ owner: as(A.owner, ids.a), tenantId: ids.a, filled })
  d1 = t.d1.name; d2 = t.d2.name; d3 = t.d3.name
  run = runner(ids.a)
  // What someone with View on every area the catalogue asks for is offered.
  view = catalogueView(LEVELS)
})
after(closeApp)

const why = e => (Array.isArray(e?.problems) ? e.problems.join('; ') : String(e?.message || e)).slice(0, 300)

// Runs definitions holding many parts at once. When one is refused, each of
// its parts is run on its own to say which.
async function runParts(what, parts, size, make) {
  const bad = []
  for (let i = 0; i < parts.length; i += size) {
    const chunk = parts.slice(i, i + size)
    const attempt = async list => {
      const spec = make(list)
      const problems = reportProblems(spec)
      if (problems.length) throw new Error('The definition has problems: ' + problems.join('; '))
      return run(spec)
    }
    try { await attempt(chunk) } catch (e) {
      let found = 0
      for (const p of chunk) {
        try { await attempt([p]) } catch (e2) { found++; bad.push(what + ' ' + JSON.stringify(p) + ': ' + why(e2)) }
      }
      if (!found) bad.push(what + ' together (' + chunk.length + ' from ' + JSON.stringify(chunk[0]) + '): ' + why(e))
    }
  }
  return bad
}

// A value to filter by, for a way of filtering a field.
function sample(def, bucket, op) {
  const shape = filterShape(op)
  if (shape === 'none') return undefined
  if (shape === 'period') return { relative: 'last_n_days', n: 30 }
  const kind = filterValueKind(def.type, bucket, op)
  const labels = Object.keys(def.labels || {})
  const pair = {
    text: ['a', 'b'], choice: [labels[0] || 'a', labels[1] || labels[0] || 'b'], number: [2, 9], yesno: [true, false],
    day: ['2026-10-19', '2026-10-25'], weekday: [3, 6], hour: [9, 18],
  }[kind]
  return shape === 'one' ? pair[0] : pair
}

test('everything the Data panel offers runs, for every subject: each grouping, column, value and filter', async () => {
  const bad = []
  const counts = { subjects: 0, groupings: 0, columns: 0, values: 0, filters: 0 }
  for (const key of Object.keys(view.subjects)) {
    const nodes = treeNodes(dataTree(view, key))
    assert.ok(nodes.length > 0, key + ' has something to pick')
    counts.subjects++
    const blank = kind => normaliseReport({ subject: key, kind })
    const counted = () => normaliseReport({ subject: key, values: [{ agg: 'count' }] })

    // A list of every column.
    const columns = nodes.filter(n => n.uses.column).map(n => n.path)
    counts.columns += columns.length
    bad.push(...await runParts(key + ' column', columns, LIMITS.list_columns, list => list.reduce((s, p) => addRow(s, p), blank('list'))))

    // Every grouping, each way its days can be grouped.
    const groupings = nodes.filter(n => n.uses.group).flatMap(n => (n.uses.buckets.length ? n.uses.buckets.map(bucket => ({ field: n.path, bucket })) : [{ field: n.path }]))
    counts.groupings += groupings.length
    bad.push(...await runParts(key + ' grouping', groupings, LIMITS.rows, list => list.reduce((s, r) => addRow(s, r), counted())))
    // Across the top: the same groupings, so the first few are enough.
    bad.push(...await runParts(key + ' across', groupings.slice(0, 4), 1, list => addColumn(addRow(counted(), groupings.find(g => g.field !== list[0].field) || groupings[0]), list[0])))

    // Every value.
    const values = nodes.flatMap(n => n.uses.values)
    counts.values += values.length
    bad.push(...await runParts(key + ' value', values, LIMITS.values, list => list.reduce((s, v) => addValue(s, v), blank('summary'))))

    // Every filter, each way its field can be filtered. Days and hours
    // grouped another way filter alike whatever the field: one of each.
    const filters = []
    const bucketed = new Set()
    for (const n of nodes) {
      if (n.uses.filter === 'venues') { filters.push({ cond: { field: n.path, op: 'in', value: [t.V] }, opts: { ask: true, venues: true } }); continue }
      if (n.uses.filter !== 'value') continue
      const def = resolvePath(view, key, n.path).def
      for (const op of filterOps(n.type)) filters.push({ cond: { field: n.path, op, ...(filterShape(op) === 'none' ? {} : { value: sample(def, null, op) }) } })
      if (n.uses.buckets.length && !bucketed.has(n.type)) {
        bucketed.add(n.type)
        for (const bucket of n.uses.buckets.filter(b => b !== 'day')) {
          for (const op of filterOps(n.type, bucket)) filters.push({ cond: { field: n.path, bucket, op, ...(filterShape(op) === 'none' ? {} : { value: sample(def, bucket, op) }) } })
        }
      }
    }
    counts.filters += filters.length
    const withFilters = list => list.reduce((s, f) => {
      const next = addFilter(s, f.cond, f.opts)
      // Each one must have been taken as it was offered.
      assert.equal(next.filters.length, s.filters.length + 1, key + ': the filter ' + JSON.stringify(f.cond) + ' was dropped')
      return next
    }, counted())
    // "Is empty" and "isn't empty" give the statement no value of their own:
    // they run apart from the rest, so nothing beside them can hide a
    // statement that only breaks when they are a report's only filter.
    const bare = f => filterShape(f.cond.op) === 'none'
    bad.push(...await runParts(key + ' filter', filters.filter(f => !bare(f)), 12, withFilters))
    bad.push(...await runParts(key + ' filter', filters.filter(bare), 12, withFilters))
  }
  assert.deepEqual(bad, [])
  // Every subject in the catalogue, each one the role builds on.
  assert.equal(counts.subjects, Object.keys(CATALOGUE.subjects).length)
  assert.equal(Object.values(view.subjects).filter(s => s.base).length, counts.subjects)
  assert.ok(counts.groupings > 1500 && counts.columns > 900 && counts.values > 1500 && counts.filters > 4000, JSON.stringify(counts))
})

test('every drill the builder offers is one the engine opens: each field a row can be broken down by, and each column of its rows', async () => {
  const bad = []
  const counts = { subjects: 0, levels: 0, opened: 0, columns: 0, refused: 0 }
  const idOf = l => (l.bucket && l.bucket !== 'day' ? l.field + ':' + l.bucket : l.field)
  const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
  for (const key of Object.keys(view.subjects)) {
    const nodes = treeNodes(dataTree(view, key))
    const groupable = nodes.filter(n => n.uses.group)
    assert.ok(groupable.length > 0, key + ' can be grouped by something')
    counts.subjects++
    // A summary to tap: how many of the subject's rows, by the first thing they can be grouped by.
    const base = addRow(normaliseReport({ subject: key, values: [{ agg: 'count' }] }), groupable[0].path)
    assert.deepEqual(reportProblems(base), [], key)
    const grouped = rowId(base.rows[0])
    const usual = listColumns(key, LEVELS)
    const first = (await run(base)).rows.find(r => r.kind === 'row')
    // The row that is tapped: the first one there is (none where the test data has no such rows).
    const at = first ? base.rows.map((g, i) => ({ field: g.field, ...(g.bucket ? { bucket: g.bucket } : {}), value: first.k[i] ?? null })) : []

    // Every level the Add window offers (a field the report could be grouped by), each way its days can be grouped.
    const levels = groupable.flatMap(n => (n.uses.buckets.length ? n.uses.buckets.map(bucket => ({ field: n.path, bucket })) : [{ field: n.path }]))
    counts.levels += levels.length
    for (const chunk of chunks(levels, LIMITS.drill_down)) {
      let spec = base
      for (const level of chunk) {
        const next = addDrillLevel(spec, level)
        if (next === spec) bad.push(key + ': the level ' + idOf(level) + ' wasn\'t taken')
        spec = next
      }
      assert.deepEqual(reportProblems(spec), [], key)
      assert.equal(drillRoom(spec), LIMITS.drill_down - chunk.length, key)
      const res = await run(spec)
      const offered = new Map((res.meta.drill?.down || []).map(d => [rowId(d), d]))
      // What the builder says a tap can lead to is what the engine says, level for level.
      assert.deepEqual(drillLevels(spec).map(rowId), [...offered.keys()], key + ': the builder and the engine offer the same levels')
      for (const level of chunk) {
        const id = idOf(level)
        if (id === grouped) { if (offered.has(id)) bad.push(key + ': ' + id + ' is offered though the report is grouped by it'); continue }
        const offer = offered.get(id)
        if (!offer) { bad.push(key + ': the engine doesn\'t offer the level ' + id); continue }
        if (!offer.label) bad.push(key + ': the level ' + id + ' has no name')
        const d = drillSpec(spec, { at, to: level.bucket === 'day' ? { field: level.field } : level }, { listColumns: usual })
        if (d.problem) { bad.push(key + ' by ' + id + ': ' + d.problem); continue }
        try {
          const down = await run(d.spec)
          if (down.kind !== 'summary' || down.columns[0].key !== id) bad.push(key + ' by ' + id + ': came back as ' + down.kind + ' by ' + down.columns[0]?.key)
          counts.opened++
        } catch (e) { bad.push(key + ' by ' + id + ': ' + why(e)) }
      }
    }

    // The rows behind a row, with every column the Add window offers for them (a field a list can show).
    const columns = nodes.filter(n => n.uses.column).map(n => n.path)
    counts.columns += columns.length
    for (const chunk of chunks(columns, LIMITS.drill_rows)) {
      const spec = setDrillRows(base, chunk)
      assert.deepEqual(spec.drill.rows, chunk, key)
      const d = drillSpec(spec, { at, to: 'rows' }, { listColumns: usual })
      if (d.problem) { bad.push(key + ' rows: ' + d.problem); continue }
      try {
        const offers = (await run(spec)).meta.drill
        if (!offers?.rows) bad.push(key + ': rows with ' + chunk.join(', ') + ' aren\'t offered')
        const list = await run(d.spec)
        if (list.kind !== 'list' || list.columns.map(c => c.key).join() !== chunk.join()) bad.push(key + ' rows: came back as ' + list.kind + ' with ' + list.columns.map(c => c.key).join())
        counts.opened++
      } catch (e) {
        // Say which column.
        for (const path of chunk) {
          try { await run(drillSpec(setDrillRows(base, [path]), { at, to: 'rows' }).spec) } catch (e2) { bad.push(key + ' rows with ' + path + ': ' + why(e2)) }
        }
        bad.push(key + ' rows (' + chunk.length + ' columns): ' + why(e))
      }
    }
    // With none chosen: the usual columns of a list of them.
    if (usual.length) {
      const list = await run(drillSpec(base, { at, to: 'rows' }, { listColumns: usual }).spec)
      assert.deepEqual(list.columns.map(c => c.key), usual, key)
    }

    // What the Add windows leave out can't be a level: a figure, and anything of rows there are several of.
    const figure = nodes.find(n => !n.uses.group && n.uses.values.length)
    const across = Object.entries(view.subjects[key].links).find(([, l]) => l.many && view.subjects[l.to])
    const not = [figure?.path, across ? across[0] + '.' + Object.keys(view.subjects[across[1].to].fields)[0] : null].filter(Boolean)
    for (const path of not) {
      const spec = normaliseReport({ ...base, drill: { down: [path] } })
      const res = await run(spec)
      if (res.meta.drill?.down.length) bad.push(key + ': ' + path + ' is offered as a level')
      const d = drillSpec(spec, { at, to: { field: path } }, { listColumns: usual })
      const r = d.problem ? { status: 422 } : await refused(run(d.spec)).catch(e => ({ ran: String(e.message) }))
      if (r.ran) bad.push(key + ': a breakdown by ' + path + ' ran')
      counts.refused++
    }
  }
  assert.deepEqual(bad, [])
  assert.equal(counts.subjects, Object.keys(CATALOGUE.subjects).length)
  assert.ok(counts.levels > 1500 && counts.columns > 900 && counts.opened > 1500 && counts.refused >= counts.subjects, JSON.stringify(counts))
})

test('what the builder leaves out because the engine can\'t do it really is refused', async () => {
  const kept = []
  const no = async (key, what, spec) => {
    const r = await refused(run(spec)).catch(e => ({ ran: String(e.message) }))
    if (r.ran) kept.push(key + ': ' + what + ' ran')
  }
  const seen = { measureByLink: 0, leftOfMany: 0, groupOfMany: 0, sumByLink: 0 }
  for (const [key, s] of Object.entries(view.subjects)) {
    for (const [lk, link] of Object.entries(s.links)) {
      const to = view.subjects[link.to]
      if (!to) continue
      const measure = Object.keys(to.measures)[0]
      const numeric = Object.entries(to.fields).find(([, f]) => NUMERIC_TYPES.includes(f.type) && f.adds)?.[0]
      const anyField = Object.keys(to.fields)[0]
      if (!link.many) {
        // A figure of something each row has one of would count once for every row.
        if (measure) {
          assert.deepEqual(pathUses(view, key, lk + '.' + measure).values, [])
          await no(key, 'the figure ' + lk + '.' + measure, { subject: key, values: [{ measure: lk + '.' + measure }] })
          seen.measureByLink++
        }
        if (numeric) {
          const offered = pathUses(view, key, lk + '.' + numeric).values.map(v => v.agg)
          assert.deepEqual(offered, ['min', 'max'], key + ' ' + lk + '.' + numeric)
          for (const agg of ['sum', 'avg']) await no(key, agg + ' of ' + lk + '.' + numeric, { subject: key, values: [{ agg, field: lk + '.' + numeric }] })
          seen.sumByLink++
        }
        continue
      }
      // Rows there are several of: nothing to group by or list, and only figures that add up.
      const uses = pathUses(view, key, lk + '.' + anyField)
      assert.equal(uses.group, false)
      assert.equal(uses.column, false)
      assert.equal(uses.filter, null)
      await no(key, 'grouping by ' + lk + '.' + anyField, { subject: key, rows: [lk + '.' + anyField], values: [{ agg: 'count' }] })
      await no(key, 'a list of ' + lk + '.' + anyField, { subject: key, kind: 'list', rows: [lk + '.' + anyField] })
      await no(key, 'a filter on ' + lk + '.' + anyField, { subject: key, values: [{ agg: 'count' }], filters: [{ field: lk + '.' + anyField, op: 'not_empty' }] })
      seen.groupOfMany++
      for (const [mk, m] of Object.entries(to.measures)) {
        if (pathUses(view, key, lk + '.' + mk).values.length) continue
        assert.ok(!m.across, key + ' ' + lk + '.' + mk + ' is left out for a reason')
        await no(key, 'the figure ' + lk + '.' + mk, { subject: key, values: [{ measure: lk + '.' + mk }] })
        seen.leftOfMany++
      }
      if (numeric) await no(key, 'the average of ' + lk + '.' + numeric, { subject: key, values: [{ agg: 'avg', field: lk + '.' + numeric }] })
    }
  }
  assert.deepEqual(kept, [])
  assert.ok(seen.measureByLink > 10 && seen.groupOfMany > 5 && seen.sumByLink > 10, JSON.stringify(seen))
})

test('a new report about anything shows something straight away', async () => {
  for (const [key, s] of Object.entries(view.subjects)) {
    const spec = startReport(view, key)
    assert.deepEqual(reportProblems(spec), [], key)
    const first = Object.keys(s.measures)[0]
    if (s.dated && first) {
      assert.equal(spec.kind, 'summary', key)
      assert.deepEqual(spec.rows, [{ field: 'date' }], key)
      assert.deepEqual(spec.values.map(v => v.measure), [first], key)
      assert.deepEqual(spec.params.map(p => p.type), s.venue ? ['period', 'venues'] : ['period'], key)
    } else {
      assert.equal(spec.kind, 'list', key)
      assert.deepEqual(spec.rows.map(r => r.field), s.list, key)
    }
    assert.equal(spec.filters.some(f => f.field === 'venue' && f.param === 'venues'), !!s.venue, key)
    const res = await run(spec, { period: TODAY })
    assert.equal(res.kind, spec.kind, key)
  }
  // The checks sold today: five closed ones, by day.
  const checks = await run(startReport(view, 'till.checks'), { period: TODAY })
  assert.deepEqual(cells(checks), [[t.date, 5]])
  assert.deepEqual(checks.columns.map(c => c.label), ['Trading day', 'Checks'])
  // Staff and kiosks have no day: a list of them, by name.
  const takers = await run(startReport(view, 'till.takers'))
  assert.ok(takers.rows.length >= 2)
  assert.deepEqual(takers.columns.map(c => c.key), view.subjects['till.takers'].list)
})

test('a session in the builder: every step is a report that runs', async () => {
  const ok = spec => { assert.deepEqual(reportProblems(spec), []); return spec }
  // Dishes sold, today.
  let s = ok(setParamDefault(startReport(view, 'till.lines'), 'period', TODAY))
  assert.deepEqual(s.rows, [{ field: 'date' }])
  assert.deepEqual(s.values, [{ key: 'qty_sold', measure: 'qty_sold' }])

  // By dish instead of by day, with what they came to.
  s = ok(addValue(addRow(removeRow(s, 'date'), 'name'), { measure: 'net_sales' }))
  assert.equal(addValue(s, { measure: 'net_sales' }), s, 'the same figure twice is added once')
  assert.equal(addRow(s, 'name'), s)
  const names = [d1, d2, d3].sort((a, b) => a.localeCompare(b))
  let res = await run(s)
  assert.deepEqual(cells(res).map(r => r[0]), names)
  assert.deepEqual(res.totals.cells, [null, 11, 78.8])
  assert.deepEqual(sortChoices(view, s), [{ by: 'name', label: 'Dish' }, { by: 'qty_sold', label: 'Quantity sold' }, { by: 'net_sales', label: 'Net sales' }])

  // The two that took the most, and the rest as one row.
  const top = ok(setLimit(s, { which: 'top', n: 2, by: 'net_sales', rest: 'Every other dish' }))
  assert.deepEqual(top.sort, [{ by: 'net_sales', dir: 'desc' }])
  assert.deepEqual(limitOf(top), { which: 'top', n: 2, by: 'net_sales', rest: 'Every other dish' })
  res = await run(top)
  assert.deepEqual(cells(res), [[d1, 4, 46.8], [d2, 6, 24], ['Every other dish', 1, 8]])
  // The fewest sold.
  const bottom = ok(setLimit(top, { which: 'bottom', n: 1, by: 'qty_sold', rest: '' }))
  assert.deepEqual(bottom.sort, [{ by: 'qty_sold', dir: 'asc' }])
  assert.deepEqual(cells(await run(bottom)), [[d3, 1, 8]])
  assert.equal(limitOf(setLimit(bottom, null)), null)

  // A name of its own for a value: its key stays, so anything that reads it still does.
  let named = ok(updateValue(s, 'net_sales', { label: 'Came to' }))
  named = ok(addValue(named, { calc: 'net_sales / qty_sold', label: 'Each', format: 'money' }))
  assert.deepEqual(named.values.map(v => v.key), ['qty_sold', 'net_sales', 'calc_1'])
  res = await run(setSort(named, [{ by: 'name', dir: 'asc' }]))
  assert.deepEqual(res.columns.map(c => c.label), ['Dish', 'Quantity sold', 'Came to', 'Each'])
  assert.deepEqual(rowsOf(res).find(r => r.name === d1), { name: d1, qty_sold: 4, net_sales: 46.8, calc_1: 11.7 })
  assert.equal(valueName(view, 'till.lines', named.values[1]), 'Came to')
  assert.equal(valueName(view, 'till.lines', s.values[1]), 'Net sales')
  assert.equal(updateValue(named, 'net_sales', { label: '' }).values[1].label, undefined)
  // Taking a value off that a calculation reads leaves the calculation with a problem to show.
  assert.ok(reportProblems(removeValue(named, 'qty_sold')).length > 0)

  // Across the top by order type: a table across. Taking it off again gives the summary back.
  const across = ok(addColumn(s, 'check.order_type.name'))
  assert.equal(across.kind, 'matrix')
  res = await run(across)
  assert.equal(res.kind, 'matrix')
  assert.deepEqual(removeColumn(across, 'check.order_type.name'), s)
  assert.deepEqual(setKind(across, 'summary', view), s)
  // What was a row moves across, and back.
  const moved = addColumn(addRow(s, 'check.server.name'), 'name')
  assert.deepEqual([moved.rows.map(rowId), moved.columns.map(rowId)], [['check.server.name'], ['name']])
  assert.deepEqual(addRow(moved, 'name').columns, [])

  // As a list: the usual columns, then what it was grouped by. And as a summary again: the list's own totals.
  const list = ok(setKind(addRow(addRow(s, 'check.server.name'), 'check.order_type.name'), 'list', view))
  assert.equal(list.kind, 'list')
  assert.ok(view.subjects['till.lines'].list.includes('check.server.name'))
  assert.deepEqual(list.rows.map(r => r.field), [...view.subjects['till.lines'].list, 'check.order_type.name'])
  assert.deepEqual([list.values, list.sort, list.limit], [[], [], null])
  assert.deepEqual(list.filters, s.filters, 'the filters stay')
  res = await run(list)
  const lineCount = res.meta.row_count
  assert.ok(lineCount >= 7)
  const summed = ok(setKind(list, 'summary', view))
  assert.equal(summed.kind, 'summary')
  assert.deepEqual(summed.rows, [])
  assert.equal(summed.values[0].agg, 'count')
  assert.ok(summed.values.length > 1 && summed.values.slice(1).every(v => v.agg === 'sum'))
  res = await run(summed)
  assert.equal(res.rows.length + (res.totals ? 1 : 0) >= 1, true)
  assert.equal((res.totals?.cells || res.rows[0].cells)[0], lineCount)

  // By week and by server, with a subtotal for each week; the day grouped another way keeps its place.
  let two = ok(addRow(addRow(removeRow(s, 'name'), 'date'), 'check.server.name'))
  two = ok(setTotals(setSort(two, [{ by: 'date', dir: 'asc' }]), { subtotals: ['date'] }))
  two = ok(updateRow(two, 'rows', 'date', { bucket: 'week' }))
  assert.deepEqual(two.rows.map(rowId), ['date:week', 'check.server.name'])
  assert.deepEqual([two.sort, two.totals.subtotals], [[{ by: 'date:week', dir: 'asc' }], ['date:week']])
  assert.equal(rowName(view, 'till.lines', two.rows[0]), 'Week')
  res = await run(two)
  assert.ok(res.rows.some(r => r.kind === 'subtotal'))
  assert.equal(updateRow(two, 'rows', 'date:week', { label: 'Week beginning' }).rows[0].label, 'Week beginning')

  // Beside the period before: only a summary whose filters say its period.
  assert.equal(compareProblem(view, s), null)
  res = await run(ok(setCompare(s, 'previous_period')))
  assert.ok(res.meta.compare?.text)
  assert.match(compareProblem(view, list), /list/)
  assert.match(compareProblem(view, across), /table across/)
  const noPeriod = removeFilter(s, s.filters.findIndex(f => f.field === 'date'))
  assert.match(compareProblem(view, noPeriod), /"Trading day is in \.\.\."/)
  assert.deepEqual(noPeriod.params.map(p => p.key), ['venues'], 'a parameter nothing asks for goes with its filter')
  assert.equal((await refused(run({ ...noPeriod, compare: { with: 'previous_period' } }))).status, 422)
})

test('filters: fixed, asked each time, and said in words', async () => {
  let s = setParamDefault(addValue(addRow(removeRow(startReport(view, 'till.checks'), 'date'), 'status'), { measure: 'net_sales' }), 'period', TODAY)
  const all = cells(await run(s))
  assert.deepEqual(all.map(r => r[0]).sort(), ['closed', 'open', 'void'])

  // A fixed filter.
  const closed = addFilter(s, { field: 'status', op: 'in', value: ['closed'] })
  assert.deepEqual(closed.filters[2], { field: 'status', op: 'in', value: ['closed'] })
  assert.deepEqual(cells(await run(closed)), [['closed', 5, 78.8]])
  const ctx = { params: closed.params, venues: [{ id: t.V, name: 'Ware' }] }
  assert.equal(filterWords(view, 'till.checks', closed.filters[2], ctx), 'Status is Closed')
  assert.equal(filterWords(view, 'till.checks', { field: 'status', op: 'not_in', value: ['void', 'merged'] }, ctx), 'Status is none of Void, Merged into another')
  assert.equal(filterWords(view, 'till.checks', closed.filters[0], ctx), 'Trading day is in Today')
  assert.equal(filterWords(view, 'till.checks', closed.filters[1], ctx), 'Venue: every venue')
  assert.equal(filterWords(view, 'till.checks', closed.filters[1], { ...ctx, params: [{ key: 'venues', type: 'venues', default: [t.V] }] }), 'Venue: Ware')
  assert.equal(filterWords(view, 'till.checks', { field: 'net', op: 'gte', value: 20 }, ctx), 'Net is at least £20.00')
  assert.equal(filterWords(view, 'till.checks', { field: 'covers', op: 'between', value: [2, 4] }, ctx), 'Guests is between 2 and 4')
  assert.equal(filterWords(view, 'till.checks', { field: 'opened_at', bucket: 'weekday', op: 'in', value: [5, 6] }, ctx), 'Opened (day of the week) is one of Friday, Saturday')
  assert.equal(filterWords(view, 'till.checks', { field: 'opened_at', bucket: 'hour', op: 'between', value: [12, 14] }, ctx), 'Opened (hour) is between 12:00 and 14:00')
  assert.equal(filterWords(view, 'till.checks', { field: 'tab_name', op: 'empty' }, ctx), 'Name on the order is empty')
  assert.equal(filterWords(view, 'till.checks', { field: 'venue.active', op: 'is', value: true }, ctx), 'Venue in use: yes')
  assert.equal(filterWords(view, 'till.checks', { has: 'payments', where: [{ field: 'tender', op: 'is', value: 'cash' }] }, ctx), 'Has payments where Tender is Cash')
  assert.equal(filterWords(view, 'till.checks', { has: 'lines', where: [], not: true }, ctx), 'Has no dishes sold')
  assert.equal(filterWords(view, 'till.checks', { any: [{ field: 'covers', op: 'gt', value: 6 }, { field: 'net', op: 'gt', value: 100 }] }, ctx),
    'Any of: Guests is more than 6; or Net is more than £100.00')

  // The same filter changed in place, then asked each time: its value is where it starts.
  const at = closed.filters.length - 1
  const asked = setFilter(closed, at, { field: 'status', op: 'in', value: ['closed'] }, { ask: true, label: 'Which checks' })
  assert.deepEqual(asked.filters[at], { field: 'status', op: 'in', param: 'status' })
  assert.deepEqual(asked.params[2], { key: 'status', type: 'value', label: 'Which checks', default: ['closed'] })
  assert.deepEqual([...usedParams(asked)].sort(), ['period', 'status', 'venues'])
  assert.equal(filterWords(view, 'till.checks', asked.filters[at], { params: asked.params }), 'Status is Closed')
  const inputs = paramInputs(view, asked)
  assert.deepEqual(inputs.map(i => [i.key, i.type, i.kind, i.shape, i.label]), [
    ['period', 'period', 'period', 'period', 'Trading day'], ['venues', 'venues', 'venues', 'many', 'Venue'], ['status', 'value', 'choice', 'many', 'Which checks'],
  ])
  assert.deepEqual(Object.keys(inputs[2].field.labels), ['open', 'closed', 'void', 'merged'])
  assert.deepEqual(cells(await run(asked)), [['closed', 5, 78.8]])
  assert.deepEqual(cells(await run(asked, { status: ['void'] })).map(r => r[0]), ['void'])
  assert.deepEqual(cells(await run(asked, { status: [] })).map(r => r[0]).sort(), ['closed', 'open', 'void'], 'nothing picked: every row')
  // Asked again with another value: the same parameter, not a second one.
  const again = setFilter(asked, at, { field: 'status', op: 'in', value: ['void'] }, { ask: true, label: 'Which checks' })
  assert.deepEqual(again.params.map(p => p.key), ['period', 'venues', 'status'])
  assert.deepEqual(again.params[2].default, ['void'])
  // Fixed again, and then taken off: the parameter goes each time.
  assert.deepEqual(setFilter(asked, at, { field: 'status', op: 'is', value: 'closed' }).params.map(p => p.key), ['period', 'venues'])
  assert.deepEqual(removeFilter(asked, at), s)

  // A second filter on the same field gets a key of its own.
  const twice = addFilter(asked, { field: 'status', op: 'not_in', value: ['merged'] }, { ask: true })
  assert.deepEqual(twice.params.map(p => p.key), ['period', 'venues', 'status', 'status_2'])

  // A number asked each time, typed as people type it.
  const big = addFilter(s, { field: 'net', op: 'gte', value: 20 }, { ask: true })
  assert.deepEqual(paramInputs(view, big)[2], {
    key: 'net', type: 'value', label: 'Net', named: false, default: 20, op: 'gte', bucket: null, path: 'net',
    subject: 'till.checks', field: { type: 'money', labels: null, label: 'Net' }, kind: 'number', shape: 'one',
  })
  assert.deepEqual(cells(await run(big)).map(r => r[1]).reduce((a, b) => a + b, 0), 2)
  assert.deepEqual(cells(await run(big, { net: 24 })).map(r => r[1]).reduce((a, b) => a + b, 0), 1)
})

test('searching the Data panel finds fields by their own name, their folder and what they are about', () => {
  const tree = dataTree(view, 'till.checks')
  const found = q => searchTree(tree, q).map(n => n.path)
  assert.deepEqual(found('server'), ['server', 'server.name', 'server.kind', 'server.active'])
  assert.deepEqual(found('net').slice(0, 2), ['net_sales', 'net'])
  assert.ok(found('dishes sold').includes('lines.qty_sold'))
  assert.deepEqual(found('tender'), [], 'payments are a list of rows: only what adds up is offered')
  assert.deepEqual(found(''), [])
  assert.deepEqual(found('zzz'), [])
  // One venue folder, not one under every linked thing.
  assert.deepEqual(found('venue').filter(p => p.endsWith('venue')), ['venue'])
  // A line's check's server is a different person from whoever added the line.
  const lines = treeNodes(dataTree(view, 'till.lines')).map(n => n.path)
  assert.ok(lines.includes('check.server.name') && lines.includes('added_by.name'))
  assert.ok(!lines.includes('check.venue.name') && !lines.includes('check.day.date'))
})

// The rule itself, on figures made up for the purpose: the catalogue's own
// ratios all divide one total or count by another, so nothing above would
// notice the rule letting any ratio through.
test('which figures add up through a list of rows is one rule, for plain figures and for ratios', () => {
  const made = { measures: {
    total: { agg: 'sum' }, rows: { agg: 'count' }, low: { agg: 'min' }, high: { agg: 'max' },
    mean: { agg: 'avg' }, different: { agg: 'count_distinct' },
    kept: { agg: 'sum', needs: 'customers' },
    share: { ratio: ['total', 'rows'] },
    skewed: { ratio: ['total', 'mean'] },
    of_different: { ratio: ['different', 'rows'] },
    nested: { ratio: ['share', 'rows'] },
    broken: { ratio: ['total', 'nothing'] },
    guarded: { ratio: ['kept', 'rows'] },
  } }
  const across = (key, levels) => worksAcross(made, made.measures[key], levels)

  assert.deepEqual(ACROSS_AGGS, ['sum', 'count', 'min', 'max'])
  for (const key of ['total', 'rows', 'low', 'high']) assert.equal(across(key), true, key + ' adds up')
  for (const key of ['mean', 'different']) assert.equal(across(key), false, key + ' doesn\'t add up')

  assert.equal(across('share'), true, 'a ratio of two figures that add up')
  assert.equal(across('skewed'), false, 'a ratio with an average in it')
  assert.equal(across('of_different'), false, 'a ratio with a "how many different" in it')
  assert.equal(across('nested'), false, 'a ratio of a ratio')
  assert.equal(across('broken'), false, 'a ratio of a figure the subject hasn\'t got')

  // A part the role may not see: the ratio isn't offered to that role (the engine would refuse it).
  assert.equal(across('guarded'), true, 'asked with no role in mind')
  assert.equal(across('guarded', { customers: 'view' }), true)
  assert.equal(across('guarded', { customers: 'none' }), false)
  assert.equal(across('guarded', {}), false)
  assert.equal(across('share', {}), true, 'a ratio whose parts anyone may see')

  // And the view the browser gets marks exactly these, for every subject of the real catalogue.
  for (const [key, subject] of Object.entries(CATALOGUE.subjects)) {
    const seen = view.subjects[key]
    if (!seen) continue
    for (const [name, m] of Object.entries(subject.measures)) {
      if (!seen.measures[name]) continue
      assert.equal(!!seen.measures[name].across, worksAcross(subject, m, LEVELS), key + '.' + name)
    }
  }
})
