// src/components/reports/builder/SetUp.jsx
//
// The report builder's Set up panel (docs/REPORTS.md 9): what kind of report
// it is, then its shelves (rows, across the top, values, filters), how it is
// sorted, cut to a top few, totalled and compared, the chart drawn above its
// table (docs/REPORTS.md 12), and what a tapped row opens into
// (docs/REPORTS.md 8): the fields it can be broken down by, and the columns
// of the rows behind it.
//
// Every change goes through an edit in shared/reports/build.js and comes
// back as a whole definition (onChange). The shelves are drop targets of the
// page's drag context: a field dragged from the Data panel lands on one, and
// a shelf's own entries drag into order by their grips.
//
//   onOpen   ({ what: 'row', where, id } | { what: 'value', key } |
//             { what: 'calc' } | { what: 'filter', index }) opens a window
//   onAdd    (shelf) opens the Data panel for that shelf ('rows', 'columns',
//            'values', 'filters', 'drill', 'drillrows')
//   onKind   ('summary' | 'list')
//   dragNode the Data panel field being dragged (shelves that can't take it dim)
//   overShelf the shelf the drag is over

import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Plus, Calculator, Undo2 } from 'lucide-react'
import {
  rowName, valueName, valueKindText, filterParts, sortChoices, limitOf, setLimit, setSort, setTotals, setCompare,
  compareProblem, removeRow, removeColumn, removeValue, removeFilter, roomLeft, BUCKET_LABELS,
  pathUses, drillRoom, removeDrillLevel, updateDrillLevel, setDrillRows, viewOptions, setView,
} from '@shared/reports/build.js'
import { rowId, COMPARE_WITH, COMPARE_LABELS, LIMITS } from '@shared/reports/spec.js'
import { resolvePath, pathLabel } from '@shared/reports/paths.js'
import { Segmented, inputCls } from '@/components/staff/shared'
import { cn } from '@/lib/utils'

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const SORT_LEVELS = 3

/** Whether a Data panel field can be dropped on a shelf of this report. */
export function accepts(node, shelf, spec) {
  if (!node) return false
  const list = spec.kind === 'list'
  if (shelf === 'rows') return list ? !!node.uses.column : !!node.uses.group
  if (shelf === 'columns') return !list && !!node.uses.group
  if (shelf === 'values') return !list && node.uses.values.length > 0
  if (shelf === 'filters') return !!node.uses.filter
  // What a tapped row opens into: a field to break it down by, a column of the rows behind it.
  if (shelf === 'drill') return !list && !!node.uses.group
  if (shelf === 'drillrows') return !list && !!node.uses.column
  return false
}

// Words typed into a box that the definition trims: the box keeps what was
// typed while it has the focus, so a space at the end of a word isn't lost.
function WordsBox({ value, onChange, label, placeholder, maxLength, testId }) {
  const [text, setText] = useState(value || '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value || '') }, [value, focused])
  return (
    <input type="text" value={text} aria-label={label} placeholder={placeholder} maxLength={maxLength} data-testid={testId}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={e => { setText(e.target.value); onChange(e.target.value) }}
      className={cn(inputCls, 'h-12')} />
  )
}

// A whole number typed in; an empty box is allowed on the way to another number.
function CountBox({ value, onChange, min = 1, max, label, testId }) {
  const [text, setText] = useState(String(value ?? ''))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(String(value ?? '')) }, [value, focused])
  return (
    <input inputMode="numeric" value={text} aria-label={label} data-testid={testId}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={e => {
        const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
        setText(t)
        const n = Number(t)
        if (t !== '' && n >= min && n <= max) onChange(n)
      }}
      className={cn(inputCls, 'h-12 w-20 tabular-nums')} />
  )
}

function Heading({ children, extra }) {
  return (
    <div className="flex items-center gap-2 min-h-[28px]">
      <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {extra}
    </div>
  )
}

const addBtn = 'inline-flex items-center gap-1 h-12 px-3 rounded-lg border bg-background text-xs font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const tick = 'flex items-center gap-3 min-h-[48px] cursor-pointer touch-manipulation'

// The chart drawn above the report's table: which kind, and what it draws.
// viewOptions() (shared/reports/build.js) says what there is to choose for
// the report as it stands; every choice is a setView().
function ChartPart({ catalogue, spec, onChange }) {
  const o = viewOptions(catalogue, spec)
  // A kind that doesn't fit the report says why when tapped, and changes nothing.
  const [said, setSaid] = useState(null)
  useEffect(() => { setSaid(null) }, [spec])
  // Back to a table and on to a chart again keeps what the chart drew (while this panel is open).
  const last = useRef(null)
  useEffect(() => { if (spec.view && spec.view.kind !== 'table') last.current = spec.view }, [spec.view])

  const pickKind = k => {
    if (!k.ok) { setSaid(k); return }
    setSaid(null)
    if (k.kind === o.kind) return
    onChange(setView(spec, k.kind === 'table' ? { kind: 'table' } : { ...(o.kind === 'table' ? last.current : null), kind: k.kind }))
  }
  // Values keep the report's own order however they are ticked; one always stays.
  const order = keys => o.values.map(v => v.key).filter(k => keys.includes(k))
  const tickValue = (key, on) => {
    const next = order(on ? [...o.ys, key] : o.ys.filter(k => k !== key))
    if (next.length) onChange(setView(spec, { y: next }))
  }
  const bars = o.values.filter(v => v.key !== o.line)

  return (
    <section className="rounded-xl border bg-muted/40 p-2 space-y-2" data-testid="setup-chart">
      <Heading>Chart</Heading>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Shown as" data-testid="chart-kinds">
        {o.kinds.map(k => (
          <button key={k.kind} type="button" onClick={() => pickKind(k)} aria-pressed={k.kind === o.kind} aria-disabled={!k.ok}
            data-testid="chart-kind" data-kind={k.kind} data-ok={k.ok ? '1' : '0'}
            className={cn('min-h-[48px] px-2 py-1 rounded-lg border text-xs font-medium leading-tight touch-manipulation',
              k.kind === o.kind ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
              !k.ok && k.kind !== o.kind && 'text-muted-foreground/70')}>
            {k.kind === 'table' ? 'Table only' : k.label}
          </button>
        ))}
      </div>
      {said && <p className="text-[11px] text-muted-foreground leading-snug" data-testid="chart-why" data-kind={said.kind}>{said.why}.</p>}
      {o.why && <p className="text-[11px] text-amber-800 leading-snug" data-testid="chart-unfit">{o.why}. Until then the report shows its table.</p>}

      {o.kind !== 'table' && !o.why && (
        <>
          {o.pick === 'many' && (
            <div data-testid="chart-values">
              <p className="text-[11px] text-muted-foreground">{o.kind === 'figures' ? 'Figures to show' : 'Values to draw'}</p>
              {o.values.map(v => (
                <label key={v.key} className={tick}>
                  <input type="checkbox" checked={o.ys.includes(v.key)} disabled={o.ys.length === 1 && o.ys[0] === v.key}
                    onChange={e => tickValue(v.key, e.target.checked)} data-testid="chart-value" data-key={v.key} className="w-5 h-5 shrink-0" />
                  <span className="text-sm min-w-0 break-words">{v.label}</span>
                </label>
              ))}
            </div>
          )}
          {o.pick === 'one' && (
            <label className="block">
              <span className="block text-[11px] text-muted-foreground mb-1">Value to draw</span>
              <select value={o.ys[0] || ''} onChange={e => onChange(setView(spec, { y: [e.target.value] }))} data-testid="chart-value-one" className={cn(inputCls, 'h-12')}>
                {o.values.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </label>
          )}
          {o.pick === 'combo' && (
            <>
              <label className="block">
                <span className="block text-[11px] text-muted-foreground mb-1">The line</span>
                <select value={o.line || ''} onChange={e => onChange(setView(spec, { line: e.target.value, y: o.ys.filter(k => k !== e.target.value) }))}
                  data-testid="chart-line" className={cn(inputCls, 'h-12')}>
                  {o.values.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
              </label>
              <div data-testid="chart-values">
                <p className="text-[11px] text-muted-foreground">The bars</p>
                {bars.map(v => (
                  <label key={v.key} className={tick}>
                    <input type="checkbox" checked={o.ys.includes(v.key)} disabled={o.ys.length === 1 && o.ys[0] === v.key}
                      onChange={e => tickValue(v.key, e.target.checked)} data-testid="chart-value" data-key={v.key} className="w-5 h-5 shrink-0" />
                    <span className="text-sm min-w-0 break-words">{v.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {o.xs.length > 0 && (
            <label className="block">
              <span className="block text-[11px] text-muted-foreground mb-1">{o.xLabel}</span>
              <select value={o.x || ''} onChange={e => onChange(setView(spec, { x: e.target.value }))} data-testid="chart-x" className={cn(inputCls, 'h-12')}>
                {o.xs.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          )}
          <div>
            {o.stack && (
              <label className={tick}>
                <input type="checkbox" checked={o.stacked} onChange={e => onChange(setView(spec, { stacked: e.target.checked }))} data-testid="chart-stacked" className="w-5 h-5 shrink-0" />
                <span className="text-sm">
                  {o.kind === 'area' ? 'Stack the areas on each other' : 'Stack the bars on each other'}
                  {o.kind === 'area' && <span className="block text-[11px] text-muted-foreground" data-testid="chart-stacked-hint">For values that add up to a whole. Left off, they are drawn as lines.</span>}
                </span>
              </label>
            )}
            {o.sideways && (
              <label className={tick}>
                <input type="checkbox" checked={o.sidewaysOn} onChange={e => onChange(setView(spec, { sideways: e.target.checked }))} data-testid="chart-sideways" className="w-5 h-5 shrink-0" />
                <span className="text-sm">Bars go sideways (for long names)</span>
              </label>
            )}
            <label className={tick}>
              <input type="checkbox" checked={o.tableBelow} onChange={e => onChange(setView(spec, { table_below: e.target.checked }))} data-testid="chart-table-below" className="w-5 h-5 shrink-0" />
              <span className="text-sm">Show the table under the chart</span>
            </label>
          </div>
        </>
      )}
    </section>
  )
}

// One entry of a shelf that has an order: a grip, the entry (opens its
// window) and a button to take it off.
function Entry({ id, label, sub, onOpen, onRemove, kind }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-testid="shelf-entry" data-id={id} data-kind={kind}
      className={cn('flex items-stretch rounded-lg border bg-background', isDragging && 'relative z-10 shadow-md opacity-80')}>
      <button type="button" {...attributes} {...listeners} aria-label={'Drag ' + label + ' to another place'} data-testid="shelf-grip"
        className="w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground/70 cursor-grab active:cursor-grabbing touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <button type="button" onClick={onOpen} data-testid="shelf-open"
        className="flex-1 min-w-0 min-h-[48px] py-1.5 text-left touch-manipulation hover:bg-muted">
        <span className="block text-sm leading-tight break-words">{label}</span>
        {sub && <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 break-words">{sub}</span>}
      </button>
      <button type="button" onClick={onRemove} aria-label={'Take ' + label + ' off'} data-testid="shelf-remove"
        className="w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground rounded-r-lg touch-manipulation hover:bg-muted hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </li>
  )
}

// One entry of a drill-down shelf: a grip, what it is (with how its days are
// grouped, for a day or a time) and a button to take it off. There is
// nothing more to set, so the entry itself isn't a button.
function DrillEntry({ id, label, sub, kind, buckets = [], bucket = 'day', onBucket, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-testid="shelf-entry" data-id={id} data-kind={kind}
      className={cn('flex items-stretch rounded-lg border bg-background', isDragging && 'relative z-10 shadow-md opacity-80')}>
      <button type="button" {...attributes} {...listeners} aria-label={'Drag ' + label + ' to another place'} data-testid="shelf-grip"
        className="w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground/70 cursor-grab active:cursor-grabbing touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0 min-h-[48px] py-1.5 flex flex-col justify-center">
        <span className="block text-sm leading-tight break-words" data-testid="drill-entry-name">{label}</span>
        {sub && <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 break-words" data-testid="drill-entry-sub">{sub}</span>}
      </div>
      {buckets.length > 0 && (
        <select value={bucket} onChange={e => onBucket(e.target.value)} aria-label={'Group ' + label + ' by'} data-testid="drill-bucket"
          className={cn(inputCls, 'h-12 w-[6.5rem] shrink-0 self-center px-2 text-xs')}>
          {buckets.map(b => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
        </select>
      )}
      <button type="button" onClick={onRemove} aria-label={'Take ' + label + ' off'} data-testid="shelf-remove"
        className="w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground rounded-r-lg touch-manipulation hover:bg-muted hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </li>
  )
}

// A shelf: a drop target with its entries and an Add button.
function Shelf({ shelf, title, hint, empty, ids, children, onAdd, addLabel = 'Add', full, extra, foot, over, dimmed }) {
  const { setNodeRef } = useDroppable({ id: 'shelf:' + shelf })
  return (
    <section ref={setNodeRef} data-testid={'shelf-' + shelf} data-over={over ? '1' : '0'}
      className={cn('rounded-xl border p-2 space-y-2 transition-colors', over ? 'border-primary bg-primary/5' : 'bg-muted/40', dimmed && 'opacity-40')}>
      <Heading extra={(
        <span className="flex items-center gap-1.5">
          {extra}
          <button type="button" onClick={onAdd} disabled={full} data-testid={'shelf-add-' + shelf} className={addBtn}>
            <Plus className="w-3.5 h-3.5" /> {addLabel}
          </button>
        </span>
      )}>{title}</Heading>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
      {ids ? (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">{children}</ul>
        </SortableContext>
      ) : <ul className="space-y-1.5">{children}</ul>}
      {empty && <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground" data-testid="shelf-empty">{empty}</p>}
      {foot}
    </section>
  )
}

export default function SetUp({ catalogue, spec, onChange, onOpen, onAdd, onKind, venues = [], currency, dragNode = null, overShelf = null, className }) {
  const subject = catalogue.subjects[spec.subject]
  const list = spec.kind === 'list'
  const room = roomLeft(spec)
  const one = subject?.one || 'row'
  const dim = shelf => !!dragNode && !accepts(dragNode, shelf, spec)

  // The line under a grouping: what it is when its heading doesn't say (a
  // heading of its own, a day grouped by week), and whether it has a subtotal.
  const rowSub = r => {
    const found = resolvePath(catalogue, spec.subject, r.field)
    const timed = found.ok && found.kind === 'field' && (found.def.type === 'date' || found.def.type === 'moment')
    const bucket = r.bucket || 'day'
    const by = !list && timed ? 'by ' + BUCKET_LABELS[bucket].toLowerCase() : ''
    const own = pathLabel(catalogue, spec.subject, r.field)
    const parts = []
    if (r.label || (by && bucket !== 'day')) parts.push(by ? own + ', ' + by : own)
    else if (by) parts.push('By day')
    if (spec.totals.subtotals.includes(rowId(r))) parts.push('Subtotal after each')
    return parts.join(' · ')
  }
  const valueSub = v => [v.calc ? v.calc : valueKindText(v), v.hidden ? 'Not shown' : ''].filter(Boolean).join(' · ')

  // ── Sort ──
  const choices = sortChoices(catalogue, spec)
  const labelOfSort = by => choices.find(c => c.by === by)?.label || pathLabel(catalogue, spec.subject, by)
  const sort = spec.sort.slice(0, SORT_LEVELS)
  const freeChoices = at => choices.filter(c => c.by === sort[at]?.by || !sort.some(s => s.by === c.by))
  const setSortAt = (at, patch) => onChange(setSort(spec, spec.sort.map((s, i) => (i === at ? { ...s, ...patch } : s))))
  const addSort = () => {
    const next = choices.find(c => !spec.sort.some(s => s.by === c.by))
    if (next) onChange(setSort(spec, [...spec.sort, { by: next.by, dir: 'asc' }]))
  }

  // ── Top or bottom few ──
  const limit = limitOf(spec)
  const shown = spec.values.filter(v => !v.hidden)
  const canLimit = !list && spec.rows.length > 0 && shown.length > 0
  const pickLimit = which => onChange(which === 'all' ? setLimit(spec, null) : setLimit(spec, { which, n: limit?.n || 10, by: limit?.by, rest: limit?.rest || '' }))

  const compareWhy = list ? null : compareProblem(catalogue, spec)

  // ── What a tapped row opens into ──
  const down = spec.drill?.down || []
  const drillRows = spec.drill?.rows || []
  const grouped = new Set([...spec.rows, ...spec.columns].map(rowId))
  const usual = subject?.list || []            // the usual columns of a list of these, for this role
  const what = lowerFirst(subject?.label || 'rows')
  const columnName = path => pathLabel(catalogue, spec.subject, path)

  return (
    <div className={cn('p-3 space-y-3', className)} data-testid="setup">
      <section className="space-y-1.5" data-testid="setup-kind">
        <Heading>Kind of report</Heading>
        <Segmented value={list ? 'list' : 'summary'} onChange={onKind} className="w-full [&>button]:h-12 [&>button]:flex-1"
          options={[{ value: 'summary', label: 'Summary' }, { value: 'list', label: 'List' }]} />
        <p className="text-[11px] text-muted-foreground leading-snug">
          {list ? 'One row for each ' + one + ', with the columns you pick.' : 'Figures added up, by whatever you group them by.'}
        </p>
      </section>

      <Shelf shelf="rows" title={list ? 'Columns' : 'Rows'} onAdd={() => onAdd('rows')} full={room.rows <= 0}
        hint={list ? 'Left to right, in this order.' : 'What each row is: a day, a dish, a server.'}
        empty={!spec.rows.length ? (list ? 'No columns yet. Add one, or drag a field here.' : 'Not grouped: one row with the totals. Add a grouping, or drag a field here.') : null}
        ids={spec.rows.map(r => 'row:' + rowId(r))} over={overShelf === 'rows'} dimmed={dim('rows')}>
        {spec.rows.map(r => (
          <Entry key={rowId(r)} id={'row:' + rowId(r)} kind="row" label={rowName(catalogue, spec.subject, r)} sub={rowSub(r)}
            onOpen={() => onOpen({ what: 'row', where: 'rows', id: rowId(r) })} onRemove={() => onChange(removeRow(spec, rowId(r)))} />
        ))}
      </Shelf>

      {!list && (
        <Shelf shelf="columns" title="Across the top" onAdd={() => onAdd('columns')} full={room.columns <= 0}
          hint={spec.columns.length ? 'Each one becomes a set of columns.' : null}
          empty={!spec.columns.length ? 'Nothing across the top. Put a grouping here to compare side by side (two at most).' : null}
          ids={spec.columns.map(r => 'col:' + rowId(r))} over={overShelf === 'columns'} dimmed={dim('columns')}>
          {spec.columns.map(r => (
            <Entry key={rowId(r)} id={'col:' + rowId(r)} kind="column" label={rowName(catalogue, spec.subject, r)} sub={rowSub(r)}
              onOpen={() => onOpen({ what: 'row', where: 'columns', id: rowId(r) })} onRemove={() => onChange(removeColumn(spec, rowId(r)))} />
          ))}
        </Shelf>
      )}

      {!list && (
        <Shelf shelf="values" title="Values" onAdd={() => onAdd('values')} full={room.values <= 0}
          hint="What is added up in each row."
          empty={!spec.values.length ? 'No values yet. Add a figure, or drag one here.' : null}
          ids={spec.values.map(v => 'val:' + v.key)} over={overShelf === 'values'} dimmed={dim('values')}
          extra={(
            <button type="button" onClick={() => onOpen({ what: 'calc' })} disabled={room.values <= 0} data-testid="shelf-add-calc" className={addBtn}
              title="A value worked out from the others">
              <Calculator className="w-3.5 h-3.5" /> Calculation
            </button>
          )}>
          {spec.values.map(v => (
            <Entry key={v.key} id={'val:' + v.key} kind={v.calc ? 'calc' : 'value'} label={valueName(catalogue, spec.subject, v)} sub={valueSub(v)}
              onOpen={() => onOpen({ what: 'value', key: v.key })} onRemove={() => onChange(removeValue(spec, v.key))} />
          ))}
        </Shelf>
      )}

      <Shelf shelf="filters" title="Filters" onAdd={() => onAdd('filters')} full={room.filters <= 0}
        hint={'Which ' + lowerFirst(subject?.label || 'rows') + ' count.'}
        empty={!spec.filters.length ? 'No filters: everything counts.' : null}
        over={overShelf === 'filters'} dimmed={dim('filters')}>
        {spec.filters.map((f, i) => {
          const p = filterParts(catalogue, spec.subject, f, { params: spec.params, venues, currency })
          const found = f.field ? resolvePath(catalogue, spec.subject, f.field) : null
          // A plain filter on a field opens its window; the venues filter and
          // filters made of several parts are read here and taken off here.
          const opens = !!found?.ok && found.kind === 'field'
          const words = (
            <>
              <span className="block text-sm leading-tight break-words">
                {p.label && <span className="font-medium">{p.label}</span>}{p.label ? p.sep : ''}{p.rest}
              </span>
              {f.param && <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">Asked each time the report is opened</span>}
            </>
          )
          return (
            <li key={i} className="flex items-stretch rounded-lg border bg-background" data-testid="shelf-entry" data-kind="filter" data-index={i}>
              {opens ? (
                <button type="button" onClick={() => onOpen({ what: 'filter', index: i })} data-testid="shelf-open"
                  className="flex-1 min-w-0 min-h-[48px] px-3 py-1.5 text-left rounded-l-lg touch-manipulation hover:bg-muted">{words}</button>
              ) : <div className="flex-1 min-w-0 min-h-[48px] px-3 py-1.5 flex flex-col justify-center">{words}</div>}
              <button type="button" onClick={() => onChange(removeFilter(spec, i))} aria-label={'Take the filter off: ' + p.label + p.sep + p.rest} data-testid="shelf-remove"
                className="w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground rounded-r-lg touch-manipulation hover:bg-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </li>
          )
        })}
      </Shelf>

      <section className="rounded-xl border bg-muted/40 p-2 space-y-2" data-testid="setup-sort">
        <Heading extra={sort.length < SORT_LEVELS && sort.length < choices.length && (
          <button type="button" onClick={addSort} data-testid="sort-add" className={addBtn}><Plus className="w-3.5 h-3.5" /> {sort.length ? 'Then by' : 'Add'}</button>
        )}>Sort</Heading>
        {!sort.length && <p className="text-[11px] text-muted-foreground leading-snug">{list ? 'As the rows come: newest first where they have a date.' : 'In the order of the first grouping.'}</p>}
        {sort.map((s, i) => (
          <div key={s.by} className="flex items-center gap-1.5" data-testid="sort-level">
            <select value={s.by} onChange={e => setSortAt(i, { by: e.target.value })} aria-label={i ? 'Then sort by' : 'Sort by'} data-testid="sort-by"
              className={cn(inputCls, 'h-12 flex-1 min-w-0 px-2')}>
              {!choices.some(c => c.by === s.by) && <option value={s.by}>{labelOfSort(s.by)}</option>}
              {freeChoices(i).map(c => <option key={c.by} value={c.by}>{c.label}</option>)}
            </select>
            <select value={s.dir} onChange={e => setSortAt(i, { dir: e.target.value })} aria-label="Which way" data-testid="sort-dir"
              className={cn(inputCls, 'h-12 w-[6.5rem] shrink-0 px-2')}>
              <option value="asc">Low to high</option>
              <option value="desc">High to low</option>
            </select>
            <button type="button" onClick={() => onChange(setSort(spec, spec.sort.filter((_, n) => n !== i)))} aria-label={'Stop sorting by ' + labelOfSort(s.by)} data-testid="sort-remove"
              className="w-12 h-12 shrink-0 flex items-center justify-center text-muted-foreground rounded-lg touch-manipulation hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </section>

      {!list && (
        <section className="rounded-xl border bg-muted/40 p-2 space-y-2" data-testid="setup-limit">
          <Heading>Show</Heading>
          <Segmented value={limit ? limit.which : 'all'} onChange={pickLimit} disabled={!canLimit} className="w-full [&>button]:h-12 [&>button]:flex-1"
            options={[{ value: 'all', label: 'Every row' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
          {!canLimit && <p className="text-[11px] text-muted-foreground leading-snug">The top or bottom few need a grouping and a value to rank them by.</p>}
          {limit && (
            <>
              <div className="flex items-center gap-1.5">
                <CountBox value={limit.n} max={LIMITS.top} label="How many rows" testId="limit-n" onChange={n => onChange(setLimit(spec, { ...limit, n }))} />
                <span className="text-xs text-muted-foreground shrink-0">by</span>
                <select value={limit.by || ''} onChange={e => onChange(setLimit(spec, { ...limit, by: e.target.value }))} aria-label="Ranked by" data-testid="limit-by"
                  className={cn(inputCls, 'h-12 flex-1 min-w-0 px-2')}>
                  {shown.map(v => <option key={v.key} value={v.key}>{valueName(catalogue, spec.subject, v)}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-3 min-h-[48px] cursor-pointer touch-manipulation">
                <input type="checkbox" checked={!!limit.rest} data-testid="limit-rest" className="w-5 h-5 shrink-0"
                  onChange={e => onChange(setLimit(spec, { ...limit, rest: e.target.checked ? 'Everything else' : '' }))} />
                <span className="text-sm">A row for everything else</span>
              </label>
              {limit.rest && (
                <WordsBox value={limit.rest} label="What everything else is called" placeholder="Everything else" maxLength={LIMITS.label} testId="limit-rest-name"
                  onChange={text => { if (text.trim()) onChange(setLimit(spec, { ...limit, rest: text })) }} />
              )}
              <p className="text-[11px] text-muted-foreground leading-snug">
                The {limit.n} {limit.which === 'top' ? 'highest' : 'lowest'} are kept; they come in the order set under Sort.
              </p>
            </>
          )}
        </section>
      )}

      <section className="rounded-xl border bg-muted/40 p-2 space-y-1" data-testid="setup-totals">
        <Heading>Totals</Heading>
        <label className="flex items-center gap-3 min-h-[48px] cursor-pointer touch-manipulation">
          <input type="checkbox" checked={spec.totals.grand} onChange={e => onChange(setTotals(spec, { grand: e.target.checked }))} data-testid="totals-grand" className="w-5 h-5 shrink-0" />
          <span className="text-sm">A total row at the bottom</span>
        </label>
        {!list && spec.rows.length > 1 && !spec.limit && (
          <p className="text-[11px] text-muted-foreground leading-snug">For a subtotal after each group, tap a grouping in Rows.</p>
        )}
      </section>

      {!list && (
        <section className="rounded-xl border bg-muted/40 p-2 space-y-2" data-testid="setup-compare">
          <Heading>Compare with</Heading>
          <select value={spec.compare?.with || ''} onChange={e => onChange(setCompare(spec, e.target.value || null))} disabled={!!compareWhy && !spec.compare}
            aria-label="Compare with" data-testid="compare-with" className={cn(inputCls, 'h-12 disabled:opacity-50')}>
            <option value="">Nothing</option>
            {COMPARE_WITH.map(k => <option key={k} value={k}>{COMPARE_LABELS[k]}</option>)}
          </select>
          {compareWhy && <p className={cn('text-[11px] leading-snug', spec.compare ? 'text-amber-800' : 'text-muted-foreground')} data-testid="compare-why">{compareWhy}.</p>}
          {!compareWhy && spec.compare && <p className="text-[11px] text-muted-foreground leading-snug">Each value gets the earlier period beside it and the change.</p>}
        </section>
      )}

      {!list && <ChartPart catalogue={catalogue} spec={spec} onChange={onChange} />}

      {!list && (
        <div className="space-y-3" data-testid="setup-drill">
          <Shelf shelf="drill" title="Tap a row: break it down by" onAdd={() => onAdd('drill')} full={drillRoom(spec) <= 0}
            hint={down.length ? 'A tapped row shows the same figures by one of these. Each can be used once on the way down.' : null}
            empty={!down.length ? 'Nothing yet. Add a field (a dish, a server, the hour) and a row of the report can be tapped to see its figures by it.' : null}
            ids={down.map(x => 'drill:' + rowId(x))} over={overShelf === 'drill'} dimmed={dim('drill')}>
            {down.map(x => {
              const id = rowId(x)
              const buckets = pathUses(catalogue, spec.subject, x.field).buckets || []
              return (
                <DrillEntry key={id} id={'drill:' + id} kind="drill" label={rowName(catalogue, spec.subject, x)}
                  sub={grouped.has(id) ? 'The report is grouped by this already' : ''}
                  buckets={buckets} bucket={x.bucket || 'day'} onBucket={bucket => onChange(updateDrillLevel(spec, id, { bucket }))}
                  onRemove={() => onChange(removeDrillLevel(spec, id))} />
              )
            })}
          </Shelf>

          {drillRows.length ? (
            <Shelf shelf="drillrows" title="Tap a row: show the rows" onAdd={() => onAdd('drillrows')} full={drillRows.length >= LIMITS.drill_rows}
              hint={'The ' + what + ' behind a tapped row are listed with these columns, left to right.'}
              ids={drillRows.map(path => 'drillrow:' + path)} over={overShelf === 'drillrows'} dimmed={dim('drillrows')}
              foot={usual.length > 0 && (
                <button type="button" onClick={() => onChange(setDrillRows(spec, []))} data-testid="drill-rows-usual" className={cn(addBtn, 'w-full justify-center')}>
                  <Undo2 className="w-3.5 h-3.5" /> Back to the usual columns
                </button>
              )}>
              {drillRows.map(path => (
                <DrillEntry key={path} id={'drillrow:' + path} kind="drillrow" label={columnName(path)}
                  onRemove={() => onChange(setDrillRows(spec, drillRows.filter(x => x !== path)))} />
              ))}
            </Shelf>
          ) : (
            // None chosen: the usual columns of a list of these. Choose starts from them.
            <Shelf shelf="drillrows" title="Tap a row: show the rows" addLabel={usual.length ? 'Choose' : 'Add'}
              onAdd={() => (usual.length ? onChange(setDrillRows(spec, usual)) : onAdd('drillrows'))}
              over={overShelf === 'drillrows'} dimmed={dim('drillrows')}>
              <li className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground leading-snug" data-testid="drill-rows-usual-note">
                {usual.length
                  ? <>The {what} behind a tapped row are listed with their usual columns: {usual.map(columnName).join(', ')}. Choose to pick your own.</>
                  : <>Your role can&apos;t see the usual columns of {what}, so a tapped row doesn&apos;t list them. Add the columns it should have.</>}
              </li>
            </Shelf>
          )}
        </div>
      )}
    </div>
  )
}
