// src/reports/shape.js
//
// From the database's rows to a report's result (docs/REPORTS.md 7.2).
// Nothing here talks to the database: compile.js made the statements, run.js
// ran them, and this file puts the rows in order.
//
//   list      the rows as they came, with the count and the sums of its
//             money and count columns
//   summary   the rows in the report's order, subtotals after each group,
//             a top or bottom N with "Everything else", the period compared
//             with beside each figure, calculations worked out per row
//   matrix    the column values across the top, a cell for each row and
//             column, a total for each row and each column
//
// A result:
//
//   { columns: [{ key, label, type, role: 'row' | 'value' | 'compare' |
//                 'change' | 'total', bucket?, labels?, decimals?, group?, of?, at? }],
//     rows:    [{ cells, kind: 'row' | 'subtotal' | 'rest', level, k, id? }],
//     totals:  { cells } | null,
//     row_count, truncated, notes }
//
// Cells are plain values in everyday units (money in pounds, a percentage
// as a fraction, a day as YYYY-MM-DD); the page and the files format them
// with shared/reports/format.js. `k` holds a row's grouping values, for
// opening the rows behind it.

import { evalExpr, exprCalls } from '../../../shared/reports/expr.js'
import { changeOf, formatValue } from '../../../shared/reports/format.js'
import { ReportError, GROUP_CAP, MATRIX_COLUMNS } from './compile.js'

const SEP = '\u0000'
const NONE = '\u0001'
const CROSS = '\u0002'
const tupleKey = keys => keys.map(k => (k == null ? NONE : k)).join(SEP)

const round6 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)
// A calculation's answer as a number: a comparison on its own counts 1 or 0.
const asNumber = v => (v === true ? 1 : v === false ? 0 : typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseKey(text, how) {
  if (text == null) return null
  if (how === 'number') { const n = Number(text); return Number.isFinite(n) ? n : null }
  if (how === 'yesno') return text === 'true' || text === 't'
  return text
}

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' })
const numCmp = (a, b) => a - b

// How two values of one grouping compare, smallest first: numbers by size,
// days by date, a choice in the order its labels are listed, yes before no,
// words as people sort them ("Table 2" before "Table 10").
function keyComparer({ col, parse }) {
  if (parse === 'number') return numCmp
  if (parse === 'yesno') return (a, b) => (a === b ? 0 : a ? -1 : 1)
  if (col.labels) {
    const order = new Map(Object.keys(col.labels).map((k, i) => [k, i]))
    return (a, b) => {
      const x = order.has(a) ? order.get(a) : 1e9
      const y = order.has(b) ? order.get(b) : 1e9
      return x !== y ? x - y : collator.compare(String(a), String(b))
    }
  }
  if (col.type === 'date') return (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}
// Empty values always go last, whichever way round the rest are.
const ordered = (cmp, dir) => (a, b) => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const c = cmp(a, b)
  return dir === 'desc' ? -c : c
}

// The names a calculation hands to one of its functions: rank(net_sales) -> net_sales.
function namesIn(ast, fn, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out
  if (ast.k === 'call' && ast.fn === fn && ast.args?.[0]?.k === 'ref') out.add(ast.args[0].name)
  for (const x of [ast.a, ast.b, ...(ast.args || [])]) if (x) namesIn(x, fn, out)
  return out
}

// ── Lists ────────────────────────────────────────────────────

/** A list's result: `rows` from the rows statement, `total` the totals statement's one row. */
export function shapeList(plan, rows, total, { cap, sums = true } = {}) {
  const columns = plan.columns
  const cut = cap && rows.length > cap ? rows.slice(0, cap) : rows
  const cell = (v, c) => {
    if (v == null) return null
    if (c.type === 'number' || c.type === 'money' || c.type === 'percent' || c.type === 'duration') return round6(Number(v))
    return v
  }
  const count = total ? Number(total.n) : cut.length
  return {
    columns,
    rows: cut.map(r => ({ cells: columns.map((c, i) => cell(r['c' + i], c)), kind: 'row', level: 0, k: [], id: r._id })),
    totals: total
      ? { count, cells: columns.map((c, i) => (sums && plan.adds[i] && total['s' + i] != null ? round6(Number(total['s' + i])) : null)) }
      : null,
    row_count: count,
    truncated: cut.length < count,
    notes: [...plan.notes],
  }
}

// ── What a statement's rows hold ─────────────────────────────

// A figure over no rows at all: a total or a count is 0, anything else nothing.
const emptyFigures = plan => Object.fromEntries(plan.figures.map(f =>
  [f.out, f.agg === 'sum' || f.agg === 'count' || f.agg === 'count_distinct' ? 0 : null]))

function figuresOf(plan, row) {
  const out = {}
  for (const f of plan.figures) out[f.out] = row[f.out] == null ? null : Number(row[f.out])
  return out
}

// A row's keys that were kept (not added up over): `lvl` has a bit per key, the first key's highest.
const keptKeys = (names, row) => names.map((_, i) => ((row.lvl >> (names.length - 1 - i)) & 1) === 0)

// The report's values that aren't calculations, from one row's figures.
function plainValues(plan, figs) {
  const out = {}
  for (const v of plan.values) {
    if (v.src.fig) out[v.key] = figs[v.src.fig] ?? null
    else if (v.src.ratio) {
      const a = figs[v.src.ratio[0]], b = figs[v.src.ratio[1]]
      out[v.key] = a == null || b == null || b === 0 ? null : a / b
    }
  }
  return out
}

// Calculations, worked out on a row's values. `extra` gives what only some
// rows have: their rank, the running total, the period compared with.
function withCalcs(plan, vals, grand, extra = {}) {
  for (const v of plan.values) {
    if (!v.src.calc) continue
    vals[v.key] = asNumber(evalExpr(v.src.calc, {
      value: name => vals[name],
      total: name => grand?.[name] ?? null,
      rank: name => extra.rank?.[name] ?? null,
      running: name => extra.running?.[name] ?? null,
      change: name => (extra.before ? changeOf(vals[name], extra.before[name]) : null),
      previous: name => extra.before?.[name] ?? null,
    }))
  }
  return vals
}

// A calculation that reads the earlier period itself (change(), previous())
// isn't given "Before" and "Change" columns of its own.
const compared = v => !(v.src.calc && exprCalls(v.src.calc).some(f => f === 'change' || f === 'previous'))

function valueColumns(plan, compare) {
  const out = []
  for (const v of plan.values) {
    if (v.hidden) continue
    const col = { key: v.key, label: v.label, type: v.type, ...(v.decimals != null ? { decimals: v.decimals } : {}), role: 'value' }
    out.push(col)
    if (compare && compared(v)) {
      out.push({ ...col, key: v.key + '__prev', label: 'Before', group: v.label, role: 'compare', of: v.key })
      out.push({ key: v.key + '__chg', label: 'Change', group: v.label, type: 'percent', decimals: 1, role: 'change', of: v.key })
    }
  }
  return out
}

// ── Summaries ────────────────────────────────────────────────

/**
 * A summary in two steps, since "Everything else" can only be asked for
 * once the rows shown are known:
 *
 *   const s = summaryShaper(plan, rows, compareRows)
 *   s.restKeys        the rows shown, when the rest are wanted (else null)
 *   s.finish({ rest, compareRest, cap })     rest: { names, rows } of the
 *                                            statement plan.rest(keys) made
 */
export function summaryShaper(plan, mainRows, compareRows = null) {
  if (mainRows.length > GROUP_CAP) {
    throw new ReportError('This report would have more than ' + GROUP_CAP.toLocaleString('en-GB') + ' rows. Group by less, or add a filter')
  }
  const n = plan.rows.length
  const names = plan.main.names
  const empty = emptyFigures(plan)
  const comparing = !!plan.compare

  // Every level's rows by their keys: [0] the grand total, [n] the rows themselves.
  const read = rows => {
    const levels = Array.from({ length: n + 1 }, () => new Map())
    for (const r of rows || []) {
      const kept = keptKeys(names, r)
      let depth = 0
      while (depth < n && kept[depth]) depth++
      const keys = names.slice(0, depth).map(name => r[name] ?? null)
      levels[depth].set(tupleKey(keys), { keys, figs: figuresOf(plan, r) })
    }
    return levels
  }
  const now = read(mainRows)
  const then = comparing ? read(compareRows) : null

  const nodes = Array.from({ length: n + 1 }, () => new Map())
  for (let d = 0; d <= n; d++) {
    for (const [key, e] of now[d]) {
      nodes[d].set(key, { keys: e.keys, vals: plainValues(plan, e.figs), before: comparing ? plainValues(plan, then[d].get(key)?.figs || empty) : null })
    }
    // Rows the earlier period has and this one doesn't.
    if (comparing) {
      for (const [key, e] of then[d]) {
        if (!nodes[d].has(key)) nodes[d].set(key, { keys: e.keys, vals: plainValues(plan, empty), before: plainValues(plan, e.figs) })
      }
    }
  }
  if (!nodes[0].has('')) nodes[0].set('', { keys: [], vals: plainValues(plan, empty), before: comparing ? plainValues(plan, empty) : null })
  const grand = nodes[0].get('')

  for (const level of nodes) {
    for (const node of level.values()) node.k = node.keys.map((t, i) => parseKey(t, plan.rows[i].parse))
  }

  // Subtotals sit after each group of these groupings (by their place in the rows).
  const subLevels = (plan.totals?.subtotals || [])
    .map(id => plan.rows.findIndex(r => r.col.key === id))
    .filter(i => i >= 0 && i < n - 1)
    .sort((a, b) => a - b)
  // Ranks and running totals start again after each subtotal.
  const blockDepth = subLevels.length ? subLevels[subLevels.length - 1] + 1 : 0
  const blockOf = node => tupleKey(node.keys.slice(0, blockDepth))

  const detail = [...nodes[n].values()]

  // rank(x): a row's place by x among the rows of its block, 1 the largest.
  const rankNames = new Set()
  for (const v of plan.values) if (v.src.calc) namesIn(v.src.calc, 'rank', rankNames)
  const ranks = new Map()
  if (rankNames.size && n > 0) {
    const blocks = new Map()
    for (const node of detail) {
      const b = blockOf(node)
      if (!blocks.has(b)) blocks.set(b, [])
      blocks.get(b).push(node)
    }
    for (const list of blocks.values()) {
      for (const name of rankNames) {
        const sorted = list.map(x => x.vals[name]).filter(x => x != null).sort((a, b) => b - a)
        for (const node of list) {
          const v = node.vals[name]
          if (v == null) continue
          if (!ranks.has(node)) ranks.set(node, {})
          ranks.get(node)[name] = sorted.findIndex(x => x <= v) + 1
        }
      }
    }
  }

  // Calculations: everything but running totals, which need the rows in order.
  const calc = (node, extra = {}) => {
    if (node.before) withCalcs(plan, node.before, grand.before)
    withCalcs(plan, node.vals, grand.vals, { before: node.before, rank: ranks.get(node), ...extra })
  }
  // The grand total first: every other row's total() reads its plain values.
  for (let d = 0; d <= n; d++) for (const node of nodes[d].values()) calc(node)

  // ── Order ──
  const rowIndex = new Map(plan.rows.map((r, i) => [r.col.key, i]))
  const valueKeys = new Set(plan.values.map(v => v.key))
  const keyCmp = plan.rows.map(keyComparer)
  const byKeys = (a, b) => {
    for (let i = 0; i < n; i++) { const c = ordered(keyCmp[i])(a.k[i], b.k[i]); if (c) return c }
    return 0
  }
  // No subtotals: the rows in one run, by each sort in turn.
  const flat = (a, b) => {
    for (const s of plan.sort) {
      let c = 0
      if (rowIndex.has(s.by)) { const i = rowIndex.get(s.by); c = ordered(keyCmp[i], s.dir)(a.k[i], b.k[i]) }
      else if (valueKeys.has(s.by)) c = ordered(numCmp, s.dir)(a.vals[s.by], b.vals[s.by])
      if (c) return c
    }
    return byKeys(a, b)
  }
  // With subtotals: groups stay together. Each level is ordered by the
  // first sort that is a figure (the group's own subtotal of it) or that
  // names the level.
  const groupOf = (node, depth) => (depth === n ? node : nodes[depth].get(tupleKey(node.keys.slice(0, depth))))
  const grouped = (a, b) => {
    for (let i = 0; i < n; i++) {
      if (a.keys[i] === b.keys[i]) continue
      const s = plan.sort.find(x => valueKeys.has(x.by) || rowIndex.get(x.by) === i)
      if (s && valueKeys.has(s.by)) {
        const c = ordered(numCmp, s.dir)(groupOf(a, i + 1)?.vals[s.by], groupOf(b, i + 1)?.vals[s.by])
        if (c) return c
        return ordered(keyCmp[i])(a.k[i], b.k[i])
      }
      return ordered(keyCmp[i], s?.dir)(a.k[i], b.k[i])
    }
    return 0
  }
  let rows = detail.sort(subLevels.length ? grouped : flat)

  // ── Top or bottom N ──
  const all = rows.length
  let restKeys = null
  if (plan.limit && n > 0) {
    const count = plan.limit.top || plan.limit.bottom
    if (rows.length > count) {
      const dir = plan.limit.top ? 'desc' : 'asc'
      const ranked = [...rows].sort((a, b) => ordered(numCmp, dir)(a.vals[plan.rankKey], b.vals[plan.rankKey]) || byKeys(a, b))
      const keep = new Set(ranked.slice(0, count))
      rows = rows.filter(r => keep.has(r))
      if (plan.rest) restKeys = rows.map(r => r.keys)
    }
  }

  const finish = ({ rest = null, compareRest = null, cap = null } = {}) => {
    const notes = [...plan.notes]
    const columns = [...plan.rows.map(r => r.col), ...valueColumns(plan, comparing)]
    const shown = plan.values.filter(v => !v.hidden)

    // Running totals, down the rows as shown.
    const runNames = new Set()
    for (const v of plan.values) if (v.src.calc && exprCalls(v.src.calc).includes('running')) namesIn(v.src.calc, 'running', runNames)
    if (runNames.size && n > 0) {
      const sums = new Map()
      for (const node of rows) {
        const b = blockOf(node)
        if (!sums.has(b)) sums.set(b, {})
        const run = sums.get(b)
        for (const name of runNames) run[name] = (run[name] || 0) + (node.vals[name] || 0)
        calc(node, { running: { ...run } })
      }
    }

    const cellsOf = (node, depth) => {
      const cells = []
      for (let i = 0; i < n; i++) cells.push(i < depth ? node.k[i] : null)
      for (const v of shown) {
        cells.push(round6(node.vals[v.key]))
        if (comparing && compared(v)) {
          const before = node.before?.[v.key] ?? null
          cells.push(round6(before), round6(changeOf(node.vals[v.key], before)))
        }
      }
      return cells
    }

    const out = []
    if (n === 0) {
      // No groupings: the figures on one row.
      out.push({ cells: cellsOf(grand, 0), kind: 'row', level: 0, k: [] })
    } else {
      // A subtotal after the last row of each group, the innermost first.
      const closing = (node, next) => {
        for (let j = subLevels.length - 1; j >= 0; j--) {
          const depth = subLevels[j] + 1
          const mine = tupleKey(node.keys.slice(0, depth))
          if (next && tupleKey(next.keys.slice(0, depth)) === mine) continue
          const group = nodes[depth].get(mine)
          if (group) out.push({ cells: cellsOf(group, depth), kind: 'subtotal', level: depth, k: group.k })
        }
      }
      rows.forEach((node, i) => {
        out.push({ cells: cellsOf(node, n), kind: 'row', level: n, k: node.k })
        if (subLevels.length) closing(node, rows[i + 1])
      })
    }

    if (rows.length < all) {
      const which = plan.limit.top ? 'top' : 'bottom'
      notes.push('The ' + which + ' ' + rows.length.toLocaleString('en-GB') + ' of ' + all.toLocaleString('en-GB') + ' are shown')
      if (plan.rest && rest) {
        const figs = rest.rows?.[0] ? figuresOf(plan, rest.rows[0]) : empty
        const node = {
          keys: [], k: [],
          vals: plainValues(plan, figs),
          before: comparing ? plainValues(plan, compareRest?.rows?.[0] ? figuresOf(plan, compareRest.rows[0]) : empty) : null,
        }
        calc(node)
        const cells = cellsOf(node, 0)
        cells[0] = plan.limit.rest_as
        out.push({ cells, kind: 'rest', level: 0, k: [] })
      }
    }

    const truncated = !!cap && out.length > cap
    if (truncated) notes.push('Only the first ' + cap.toLocaleString('en-GB') + ' rows are shown. Export the report for all of them, or narrow it down')

    return {
      columns,
      rows: truncated ? out.slice(0, cap) : out,
      // With no groupings the one row is the total already.
      totals: plan.totals?.grand !== false && n > 0 ? { cells: cellsOf(grand, 0) } : null,
      row_count: n === 0 ? 1 : all,
      truncated,
      notes,
    }
  }

  return { restKeys, finish }
}

// ── Matrices ─────────────────────────────────────────────────

/**
 * A matrix, in the same two steps as a summary:
 *
 *   const m = matrixShaper(plan, rows)
 *   m.restKeys
 *   m.finish({ rest, cap })
 */
export function matrixShaper(plan, mainRows) {
  if (mainRows.length > GROUP_CAP) {
    throw new ReportError('This matrix would have more than ' + GROUP_CAP.toLocaleString('en-GB') + ' cells. Group by less, or add a filter')
  }
  const nr = plan.rows.length
  const names = plan.main.names
  const empty = emptyFigures(plan)

  const cells = new Map()
  const rowTotals = new Map()
  const colTotals = new Map()
  let grandFigs = null
  for (const r of mainRows) {
    const kept = keptKeys(names, r)
    const rowsKept = kept.slice(0, nr).every(Boolean), rowsUp = kept.slice(0, nr).every(x => !x)
    const colsKept = kept.slice(nr).every(Boolean), colsUp = kept.slice(nr).every(x => !x)
    const rk = names.slice(0, nr).map(name => r[name] ?? null)
    const ck = names.slice(nr).map(name => r[name] ?? null)
    const figs = figuresOf(plan, r)
    // With no row groupings a row of cells is the column totals as well.
    if (rowsKept && colsKept) cells.set(tupleKey(rk) + CROSS + tupleKey(ck), figs)
    if (rowsKept && colsUp) rowTotals.set(tupleKey(rk), { keys: rk, figs })
    if (rowsUp && colsKept) colTotals.set(tupleKey(ck), { keys: ck, figs })
    if (rowsUp && colsUp) grandFigs = figs
  }
  const grand = plainValues(plan, grandFigs || empty)
  withCalcs(plan, grand, grand)
  const valuesOf = figs => withCalcs(plan, plainValues(plan, figs), grand)

  // Across the top: each column value, smallest first.
  const colCmp = plan.cols.map(keyComparer)
  const across = [...colTotals.values()].map(c => ({ ...c, k: c.keys.map((t, i) => parseKey(t, plan.cols[i].parse)) }))
  across.sort((a, b) => {
    for (let i = 0; i < plan.cols.length; i++) { const c = ordered(colCmp[i])(a.k[i], b.k[i]); if (c) return c }
    return 0
  })
  if (across.length > MATRIX_COLUMNS) {
    throw new ReportError('This matrix would have ' + across.length.toLocaleString('en-GB') + ' columns (' + MATRIX_COLUMNS
      + ' at most). Put a field with fewer values across the top, or add a filter')
  }

  // Down the side: each row, ordered by its keys or by a figure's row total.
  const rowIndex = new Map(plan.rows.map((r, i) => [r.col.key, i]))
  const valueKeys = new Set(plan.values.map(v => v.key))
  const keyCmp = plan.rows.map(keyComparer)
  let rows = [...rowTotals.values()].map(r => ({ ...r, k: r.keys.map((t, i) => parseKey(t, plan.rows[i].parse)), vals: valuesOf(r.figs) }))
  const byKeys = (a, b) => {
    for (let i = 0; i < nr; i++) { const c = ordered(keyCmp[i])(a.k[i], b.k[i]); if (c) return c }
    return 0
  }
  rows.sort((a, b) => {
    for (const s of plan.sort) {
      let c = 0
      if (rowIndex.has(s.by)) { const i = rowIndex.get(s.by); c = ordered(keyCmp[i], s.dir)(a.k[i], b.k[i]) }
      else if (valueKeys.has(s.by)) c = ordered(numCmp, s.dir)(a.vals[s.by], b.vals[s.by])
      if (c) return c
    }
    return byKeys(a, b)
  })

  const all = rows.length
  let restKeys = null
  if (plan.limit && nr > 0) {
    const count = plan.limit.top || plan.limit.bottom
    if (rows.length > count) {
      const dir = plan.limit.top ? 'desc' : 'asc'
      const ranked = [...rows].sort((a, b) => ordered(numCmp, dir)(a.vals[plan.rankKey], b.vals[plan.rankKey]) || byKeys(a, b))
      const keep = new Set(ranked.slice(0, count))
      rows = rows.filter(r => keep.has(r))
      if (plan.rest) restKeys = rows.map(r => r.keys)
    }
  }

  const finish = ({ rest = null, cap = null } = {}) => {
    const notes = [...plan.notes]
    const shown = plan.values.filter(v => !v.hidden)
    const heading = c => c.k.map((v, i) => formatValue(v, plan.cols[i].col) || plan.cols[i].col.empty || '(none)').join(' · ')

    const columns = plan.rows.map(r => r.col)
    across.forEach((c, j) => {
      const at = plan.cols.map((g, i) => ({ field: g.col.field, ...(g.col.bucket ? { bucket: g.col.bucket } : {}), value: c.k[i] }))
      for (const v of shown) {
        columns.push({ key: v.key + '|' + j, label: v.label, group: heading(c), type: v.type, ...(v.decimals != null ? { decimals: v.decimals } : {}), role: 'value', of: v.key, at })
      }
    })
    for (const v of shown) {
      columns.push({ key: v.key + '|total', label: v.label, group: 'Total', type: v.type, ...(v.decimals != null ? { decimals: v.decimals } : {}), role: 'total', of: v.key })
    }

    // One row: its cells across (an empty cell where nothing was sold), then its own totals.
    const line = (rowKey, totals, cellFigs) => {
      const out = []
      for (const c of across) {
        const figs = cellFigs(tupleKey(c.keys))
        const vals = figs ? valuesOf(figs) : null
        for (const v of shown) out.push(vals ? round6(vals[v.key]) : null)
      }
      for (const v of shown) out.push(round6(totals[v.key]))
      return out
    }

    const out = rows.map(r => ({
      cells: [...r.k, ...line(r.keys, r.vals, ck => cells.get(tupleKey(r.keys) + CROSS + ck))],
      kind: 'row', level: nr, k: r.k,
    }))

    if (rows.length < all) {
      const which = plan.limit.top ? 'top' : 'bottom'
      notes.push('The ' + which + ' ' + rows.length.toLocaleString('en-GB') + ' of ' + all.toLocaleString('en-GB') + ' are shown')
      if (plan.rest && rest) {
        // Everything else: a row of its own, from the rows left out.
        const names2 = rest.names || []
        const perCol = new Map()
        let total = empty
        for (const r of rest.rows || []) {
          const kept = keptKeys(names2, r)
          if (kept.every(Boolean) && names2.length) perCol.set(tupleKey(names2.map(name => r[name] ?? null)), figuresOf(plan, r))
          if (kept.every(x => !x)) total = figuresOf(plan, r)
        }
        const cellsRow = Array(nr).fill(null)
        cellsRow[0] = plan.limit.rest_as
        out.push({ cells: [...cellsRow, ...line([], valuesOf(total), ck => perCol.get(ck))], kind: 'rest', level: 0, k: [] })
      }
    }

    const truncated = !!cap && out.length > cap
    if (truncated) notes.push('Only the first ' + cap.toLocaleString('en-GB') + ' rows are shown. Export the report for all of them, or narrow it down')

    return {
      columns,
      rows: truncated ? out.slice(0, cap) : out,
      totals: plan.totals?.grand !== false
        ? { cells: [...Array(nr).fill(null), ...line([], grand, ck => colTotals.get(ck)?.figs)] }
        : null,
      row_count: all,
      truncated,
      notes,
    }
  }

  return { restKeys, finish }
}
