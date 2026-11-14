// src/components/reports/builder/Windows.jsx
//
// The report builder's three small windows (docs/REPORTS.md 9): a grouping
// or list column, a value, and a filter. Each keeps what is typed to itself
// and hands back a whole new definition when Apply is pressed, through the
// edits in shared/reports/build.js. Nothing changes until then. A value can
// be a figure of another subject of the report, and a filter one of that
// subject's own (docs/REPORTS.md 7.1).

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import {
  pathUses, linkTrail, rowName, valueName, valueKindText, valueReaders,
  updateRow, removeRow, removeColumn, addRow, addColumn, setTotals,
  addValue, updateValue, removeValue,
  filterOps, filterShape, filterValueKind, filterValueOk, blankValue as blank, setFilter, removeFilter,
  roomLeft, updateAlso, BUCKET_LABELS,
} from '@shared/reports/build.js'
import { rowId, valueSubject, OP_LABELS, LIMITS } from '@shared/reports/spec.js'
import { resolvePath, pathLabel } from '@shared/reports/paths.js'
import { parseExpr, exprProblem, exprRefs, ExprError, MAX_EXPR_LENGTH } from '@shared/reports/expr.js'
import { useApi } from '@/lib/api'
import { Modal, Field, Segmented, inputCls } from '@/components/staff/shared'
import ValueInput from '@/components/reports/ValueInput'
import { cn } from '@/lib/utils'

const primary = 'h-12 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50'
const plain = 'h-12 px-4 rounded-lg border bg-background text-sm touch-manipulation hover:bg-muted disabled:opacity-50'
const danger = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg border border-red-200 bg-background text-sm text-red-700 touch-manipulation hover:bg-red-50'
const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

function Toggle({ checked, onChange, label, hint, testId, disabled }) {
  return (
    <label className={cn('flex items-start gap-3 min-h-[48px] py-1.5 touch-manipulation', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} data-testid={testId} className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

function Linked({ catalogue, subject, path }) {
  const trail = linkTrail(catalogue, subject, path)
  if (!trail.length) return null
  return <p className="text-[11px] text-muted-foreground" data-testid="how-linked">How this is linked: {trail.join(' › ')}</p>
}

// ── A grouping, or a list's column ───────────────────────────

/** where: 'rows' | 'columns'; id: the entry's row id. */
export function RowWindow({ catalogue, spec, where, id, onApply, onClose }) {
  const entry = spec[where].find(x => rowId(x) === id)
  const [label, setLabel] = useState(entry?.label || '')
  const [bucket, setBucket] = useState(entry?.bucket || 'day')
  const [subtotal, setSubtotal] = useState(spec.totals.subtotals.includes(id))
  if (!entry) return null

  const list = spec.kind === 'list'
  const buckets = list ? [] : pathUses(catalogue, spec.subject, entry.field).buckets || []
  const nextRef = { field: entry.field, ...(buckets.length && bucket !== 'day' ? { bucket } : {}) }
  const nextId = rowId(nextRef)
  const own = pathLabel(catalogue, spec.subject, entry.field, nextRef.bucket)
  const clash = nextId !== id && [...spec.rows, ...spec.columns].some(x => rowId(x) === nextId)
  const at = spec.rows.findIndex(x => rowId(x) === id)
  // A subtotal sits after each group of an outer grouping: never the last one, and not with a top N.
  const canSubtotal = where === 'rows' && spec.kind === 'summary' && !spec.limit && at !== -1 && at < spec.rows.length - 1
  const room = roomLeft(spec)

  const apply = () => {
    let next = updateRow(spec, where, id, { label: label.trim(), ...(buckets.length ? { bucket } : {}) })
    if (canSubtotal) {
      const others = next.totals.subtotals.filter(x => x !== nextId)
      next = setTotals(next, { subtotals: subtotal ? [...others, nextId] : others })
    }
    onApply(next)
  }
  const title = list ? 'Column' : where === 'columns' ? 'Across the top' : 'Grouping'

  return (
    <Modal title={title + ': ' + rowName(catalogue, spec.subject, entry)} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={apply} disabled={clash} data-testid="row-apply" className={primary}>Apply</button>
          {!list && where === 'rows' && room.columns > 0 && (
            <button type="button" onClick={() => onApply(addColumn(spec, entry))} data-testid="row-to-columns" className={plain}>Move across the top</button>
          )}
          {!list && where === 'columns' && (
            <button type="button" onClick={() => onApply(addRow(spec, entry))} data-testid="row-to-rows" className={plain}>Move down to the rows</button>
          )}
          <button type="button" onClick={() => onApply(where === 'rows' ? removeRow(spec, id) : removeColumn(spec, id))} data-testid="row-remove" className={danger}>
            <Trash2 className="w-4 h-4" /> Take it off
          </button>
        </>
      )}>
      <Field label="Heading" hint="Leave it empty to use its own name.">
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} maxLength={LIMITS.label} placeholder={own} data-testid="row-label" className={cn(inputCls, 'h-12')} />
      </Field>
      {buckets.length > 0 && (
        <Field label="Group its days by" group>
          <div className="flex flex-wrap gap-2">
            {buckets.map(b => (
              <button key={b} type="button" onClick={() => setBucket(b)} aria-pressed={bucket === b} data-testid="row-bucket" data-bucket={b}
                className={cn('min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation', bucket === b ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {BUCKET_LABELS[b]}
              </button>
            ))}
          </div>
        </Field>
      )}
      {clash && <p className="text-xs text-red-700" role="alert">The report is already grouped that way.</p>}
      {canSubtotal && (
        <Toggle checked={subtotal} onChange={setSubtotal} testId="row-subtotal" label={'A subtotal after each ' + own.toLowerCase()} />
      )}
      {where === 'rows' && spec.kind === 'summary' && !!spec.limit && spec.rows.length > 1 && (
        <p className="text-[11px] text-muted-foreground">Subtotals aren't shown with a top or bottom few: the rows shown wouldn't add up to them.</p>
      )}
      <Linked catalogue={catalogue} subject={spec.subject} path={entry.field} />
    </Modal>
  )
}

// ── A value ──────────────────────────────────────────────────

const FORMAT_NAMES = { number: 'A number', money: 'Money', percent: 'A percentage', duration: 'Time taken' }

// Why a calculation can't be worked out, as a sentence, or null (the rules
// reportProblems() in shared/reports/spec.js applies to every calculation).
function calcProblem(text, spec, ownKey) {
  if (!text.trim()) return 'Type the calculation'
  try {
    const ast = parseExpr(text)
    const keys = new Set(spec.values.map(v => v.key))
    const why = exprProblem(ast, { context: 'summary', known: n => keys.has(n) && n !== ownKey })
    if (why) return why
    const calcKeys = new Set(spec.values.filter(v => v.calc && v.key !== ownKey).map(v => v.key))
    const chained = exprRefs(ast).find(n => calcKeys.has(n))
    return chained ? 'A calculation can\'t use another calculation ("' + chained + '")' : null
  } catch (e) {
    return e instanceof ExprError ? e.message : 'The calculation can\'t be read'
  }
}

/** valueKey: one of the report's values, or null for a new calculation. */
export function ValueWindow({ catalogue, spec, valueKey, onApply, onClose }) {
  const value = valueKey ? spec.values.find(v => v.key === valueKey) : null
  const isCalc = !valueKey || !!value?.calc
  const [label, setLabel] = useState(value?.label || '')
  const [format, setFormat] = useState(value?.format || '')
  const [decimals, setDecimals] = useState(value?.decimals ?? '')
  const [hidden, setHidden] = useState(!!value?.hidden)
  const [calc, setCalc] = useState(value?.calc || '')
  const [touched, setTouched] = useState(false)
  const box = useRef(null)
  if (valueKey && !value) return null

  const others = spec.values.filter(v => v.key !== valueKey && !v.calc)
  const problem = isCalc ? calcProblem(calc, spec, valueKey) : null
  const readers = valueKey ? valueReaders(spec, valueKey) : []
  const own = value ? valueName(catalogue, spec, { ...value, label: '' }) : 'Calculation'
  // A figure of another subject of the report: its paths are that subject's.
  const subjectKey = value ? valueSubject(spec, value) : spec.subject
  const other = value?.from ? (spec.also || []).find(a => a.key === value.from) : null
  const full = !valueKey && roomLeft(spec).values <= 0

  // A value's short name goes in where the cursor is.
  const insert = key => {
    const el = box.current
    const at = el ? el.selectionStart ?? calc.length : calc.length
    const end = el ? el.selectionEnd ?? at : at
    const next = (calc.slice(0, at) + key + calc.slice(end)).slice(0, MAX_EXPR_LENGTH)
    setCalc(next); setTouched(true)
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + key.length, at + key.length) } })
  }

  const apply = () => {
    const patch = {
      label: label.trim(), format: format || null, decimals: decimals === '' ? null : Number(decimals), hidden,
      ...(isCalc ? { calc: calc.trim() } : {}),
    }
    if (valueKey) return onApply(updateValue(spec, valueKey, patch))
    const entry = { calc: patch.calc, ...(patch.label ? { label: patch.label } : {}), ...(patch.format ? { format: patch.format } : {}),
      ...(patch.decimals != null ? { decimals: patch.decimals } : {}), ...(hidden ? { hidden: true } : {}) }
    onApply(addValue(spec, entry))
  }

  return (
    <Modal title={valueKey ? 'Value: ' + valueName(catalogue, spec, value) : 'A calculation'} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={apply} disabled={!!problem || full} data-testid="value-apply" className={primary}>{valueKey ? 'Apply' : 'Add it'}</button>
          {valueKey && (
            <button type="button" onClick={() => onApply(removeValue(spec, valueKey))} data-testid="value-remove" className={danger}>
              <Trash2 className="w-4 h-4" /> Take it off
            </button>
          )}
        </>
      )}>
      {value && !isCalc && (
        <p className="text-xs text-muted-foreground" data-testid="value-what">
          {valueKindText(value)}{value.measure || value.field ? ': ' + pathLabel(catalogue, subjectKey, value.measure || value.field) : ''}
          {other && <span className="block mt-0.5" data-testid="value-also">From {lowerFirst(other.label || catalogue.subjects[other.subject]?.label || other.subject)}, lined up by the report&apos;s rows</span>}
        </p>
      )}

      {isCalc && (
        <>
          <Field label="The calculation" hint="Use the values' short names with + - * / and brackets. total(x) is x for the whole report, so net_sales / total(net_sales) is each row's share.">
            <textarea ref={box} value={calc} onChange={e => { setCalc(e.target.value); setTouched(true) }} rows={3} maxLength={MAX_EXPR_LENGTH}
              spellCheck={false} autoCapitalize="off" autoCorrect="off" data-testid="value-calc"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </Field>
          {others.length > 0 ? (
            <div role="group" aria-label="The report's values">
              <p className="text-[11px] text-muted-foreground mb-1.5">Tap a value to put it in</p>
              <div className="flex flex-wrap gap-2">
                {others.map(v => (
                  <button key={v.key} type="button" onClick={() => insert(v.key)} data-testid="value-calc-chip" data-key={v.key}
                    className="min-h-[48px] px-3 py-1 rounded-lg border bg-background text-left touch-manipulation hover:bg-muted">
                    <span className="block text-xs leading-tight">{valueName(catalogue, spec, v)}</span>
                    <span className="block text-[11px] font-mono text-muted-foreground leading-tight">{v.key}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <p className="text-xs text-amber-800">Add a value to the report first: a calculation works on the report's other values.</p>}
          <p className="text-[11px] text-muted-foreground">
            Also: round(x, 2), abs(x), min(a, b), max(a, b), if(test, a, b), running(x) for a running total, rank(x) for a row's place
            {spec.compare ? ', and change(x) or previous(x) for the period compared with.' : '.'}
          </p>
          {touched && problem && <p className="text-xs text-red-700" role="alert" data-testid="value-calc-problem">{problem}</p>}
          {full && <p className="text-xs text-red-700" role="alert">A report takes {LIMITS.values} values at most.</p>}
        </>
      )}

      <Field label="Heading" hint={isCalc ? 'What the column is called.' : 'Leave it empty to use its own name.'}>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} maxLength={LIMITS.label} placeholder={own} data-testid="value-label" className={cn(inputCls, 'h-12')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Show it as">
          <select value={format} onChange={e => setFormat(e.target.value)} data-testid="value-format" className={cn(inputCls, 'h-12')}>
            <option value="">{isCalc ? 'A number' : 'As it comes'}</option>
            {Object.entries(FORMAT_NAMES).filter(([k]) => !(isCalc && k === 'number')).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
        </Field>
        <Field label="Decimal places">
          <select value={decimals} onChange={e => setDecimals(e.target.value)} data-testid="value-decimals" className={cn(inputCls, 'h-12')}>
            <option value="">As usual</option>
            {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      {!isCalc && (
        <Toggle checked={hidden} onChange={setHidden} testId="value-hidden" label="Only for calculations" hint="It is worked out but not shown as a column." />
      )}
      {valueKey && !isCalc && (
        <p className="text-[11px] text-muted-foreground">Its short name in calculations: <span className="font-mono">{valueKey}</span></p>
      )}
      {readers.length > 0 && (
        <p className="text-[11px] text-amber-800" data-testid="value-readers">
          Used by {readers.map(v => valueName(catalogue, spec, v)).join(', ')}. Taking it off stops {readers.length === 1 ? 'that calculation' : 'those calculations'} working.
        </p>
      )}
      {value && !isCalc && <Linked catalogue={catalogue} subject={subjectKey} path={value.measure || value.field} />}
    </Modal>
  )
}

// ── A filter ─────────────────────────────────────────────────

// How a day or a moment can be filtered: itself, or a part of it.
const PARTS = [{ value: '', label: 'The date' }, { value: 'weekday', label: 'Day of the week' }, { value: 'hour', label: 'Hour of the day' }]

/**
 * index: one of the report's top-level filters, or null for a new one on
 * `path`. Only plain conditions open here ("any of" and "has" filters are
 * shown in words on the shelf). With `also` (the key of another subject of
 * the report) it is one of that subject's own filters: a value set here,
 * never asked for when the report is opened, and only its rows are picked.
 */
export function FilterWindow({ catalogue, spec, index = null, path: newPath = null, also = null, today, onApply, onClose }) {
  const api = useApi()
  const other = also ? (spec.also || []).find(a => a.key === also) || null : null
  const subjectKey = other ? other.subject : spec.subject
  const list = other ? other.filters : spec.filters
  const old = index != null ? list[index] : null
  const path = old ? old.field : newPath
  const oldParam = old?.param ? spec.params.find(p => p.key === old.param) : null
  const found = useMemo(() => resolvePath(catalogue, subjectKey, path), [catalogue, subjectKey, path])
  const def = found.ok && found.kind === 'field' ? found.def : null
  const type = def?.type || 'text'
  const timed = type === 'date' || type === 'moment'
  const hasPeriod = spec.params.some(p => p.type === 'period')

  const [bucket, setBucket] = useState(old?.bucket && old.bucket !== 'day' ? old.bucket : '')
  const [op, setOp] = useState(old?.op || filterOps(type, null)[0])
  const [value, setValue] = useState(() => {
    if (old) return oldParam ? oldParam.default : old.value
    return timed ? { relative: 'last_week' } : null
  })
  // A new filter on the report's own day asks each time when nothing else does: it is the report's period.
  const [ask, setAsk] = useState(other ? false : old ? !!old.param : (path === 'date' && timed && !hasPeriod))
  const [askLabel, setAskLabel] = useState(oldParam?.label || '')

  const ops = filterOps(type, bucket || null)
  const shape = filterShape(op)
  const kind = filterValueKind(type, bucket || null, op)
  const label = pathLabel(catalogue, subjectKey, path, bucket || null)

  const pickBucket = b => {
    const first = filterOps(type, b || null)[0]
    setBucket(b); setOp(first)
    setValue(filterShape(first) === 'period' ? { relative: 'last_week' } : null)
  }
  const pickOp = next => {
    const was = [filterShape(op), filterValueKind(type, bucket || null, op)]
    const now = [filterShape(next), filterValueKind(type, bucket || null, next)]
    setOp(next)
    if (was[0] !== now[0] || was[1] !== now[1]) setValue(now[0] === 'period' ? { relative: 'last_week' } : null)
  }

  // Values found in the data, for a text field (not for personal details).
  const wantsOffers = !!def && type === 'text' && !def.pii && kind === 'text' && shape !== 'none'
  const periodFilter = spec.filters.find(f => f.field === 'date' && !f.bucket && f.op === 'in_period')
  const period = periodFilter?.param ? spec.params.find(p => p.key === periodFilter.param)?.default : periodFilter?.value
  // The report's period applies to another subject too, when it has days.
  const dated = !!catalogue.subjects[subjectKey]?.fields?.date
  const offersQ = useQuery({
    queryKey: ['report-values', subjectKey, path, (dated && period) || null],
    queryFn: () => api.post('/reports/preview', {
      rows: 60,
      spec: {
        subject: subjectKey, kind: 'summary', rows: [{ field: path }], values: [{ key: 'n', agg: 'count' }],
        filters: dated && period ? [{ field: 'date', op: 'in_period', value: period }] : [],
        sort: [{ by: 'n', dir: 'desc' }], limit: { top: 60 }, totals: { grand: false },
      },
    }),
    enabled: wantsOffers, retry: false, staleTime: 5 * 60_000,
  })
  const offers = wantsOffers ? (offersQ.data?.rows || []).map(r => r.cells?.[0]).filter(v => typeof v === 'string' && v.trim() !== '') : []

  if (!found.ok || !def) return null

  const asking = ask && shape !== 'none'
  const ok = shape === 'none' || filterValueOk(type, bucket || null, op, value) || (asking && shape !== 'period' && blank(value))
  const room = roomLeft(spec)
  const full = index == null && (other ? list.length >= LIMITS.filters : room.filters <= 0)
  const noAsk = asking && !oldParam && room.params <= 0

  const apply = () => {
    const cond = { field: path, ...(bucket ? { bucket } : {}), op, ...(shape !== 'none' ? { value: blank(value) ? null : value } : {}) }
    if (other) {
      onApply(updateAlso(spec, other.key, { filters: index != null ? list.map((f, n) => (n === index ? cond : f)) : [...list, cond] }))
      return
    }
    onApply(setFilter(spec, index ?? spec.filters.length, cond, { ask: asking, label: askLabel.trim() }))
  }
  const remove = () => onApply(other
    ? updateAlso(spec, other.key, { filters: list.filter((_, n) => n !== index) })
    : removeFilter(spec, index))
  const otherName = other ? other.label || catalogue.subjects[other.subject]?.label || other.subject : ''

  return (
    <Modal title={'Filter: ' + label} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={apply} disabled={!ok || full || noAsk} data-testid="filter-apply" className={primary}>{index == null ? 'Add the filter' : 'Apply'}</button>
          {index != null && (
            <button type="button" onClick={remove} data-testid="filter-remove" className={danger}>
              <Trash2 className="w-4 h-4" /> Take it off
            </button>
          )}
        </>
      )}>
      {other && (
        <p className="text-xs text-muted-foreground" data-testid="filter-also">
          This picks which of {lowerFirst(otherName)}&apos;s rows count. The report&apos;s own rows aren&apos;t changed.
        </p>
      )}
      {timed && (
        <Field label="Filter by" group>
          <Segmented value={bucket} onChange={pickBucket} className="[&>button]:h-12"
            options={PARTS.filter(p => p.value !== 'hour' || type === 'moment')} />
        </Field>
      )}
      <Field label={label}>
        <select value={op} onChange={e => pickOp(e.target.value)} data-testid="filter-op" className={cn(inputCls, 'h-12')}>
          {ops.map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </select>
      </Field>
      {shape !== 'none' && (
        <div data-testid="filter-value">
          <ValueInput kind={kind} shape={shape} type={type} labels={def.labels} value={value} onChange={setValue} label={label} suggestions={offers} today={today} />
          {type === 'percent' && <p className="text-[11px] text-muted-foreground mt-1.5">Typed as a percentage: 20 is 20%.</p>}
          {type === 'duration' && <p className="text-[11px] text-muted-foreground mt-1.5">Typed in minutes.</p>}
        </div>
      )}
      {shape !== 'none' && !other && (
        <div className="rounded-lg border p-3 space-y-2">
          <Toggle checked={ask} onChange={setAsk} testId="filter-ask" label="Ask each time the report is opened"
            hint={shape === 'period' ? 'Whoever opens it can pick another period. What is set here is what it starts with.' : 'Whoever opens it can pick something else. What is set here is what it starts with; leave it empty to start with everything.'} />
          {ask && (
            <Field label="Call the choice" hint="Leave it empty to use the field's name.">
              <input type="text" value={askLabel} onChange={e => setAskLabel(e.target.value)} maxLength={LIMITS.label} placeholder={label} data-testid="filter-ask-label" className={cn(inputCls, 'h-12')} />
            </Field>
          )}
        </div>
      )}
      {full && <p className="text-xs text-red-700" role="alert">A report takes {LIMITS.filters} filters at most.</p>}
      {noAsk && <p className="text-xs text-red-700" role="alert">A report asks for {LIMITS.params} things at most. Take one off, or set this filter's value here.</p>}
      {def.about && <p className="text-[11px] text-muted-foreground">{def.about}</p>}
      <Linked catalogue={catalogue} subject={subjectKey} path={path} />
    </Modal>
  )
}
