// src/components/reports/ValueInput.jsx
//
// What a filter is compared with, typed or picked the way its field asks
// for (docs/REPORTS.md 9). Used by the builder's filter window and by the
// choices a report asks for when it is opened.
//
//   kind    'text' | 'choice' | 'number' | 'yesno' | 'day' | 'weekday' |
//           'hour' | 'period'   (filterValueKind() in shared/reports/build.js)
//   shape   'none' | 'one' | 'two' | 'many' | 'period'   (filterShape())
//   type    the field's type: a percentage is typed as per cent, a duration
//           in minutes, and kept as the report keeps them (a fraction, seconds)
//   labels  a choice field's { value: words }
//   value   the value as the report keeps it; onChange gets the same shape.
//           Something half typed comes through as null (one), or left out
//           of the list (many), so the caller's check says it isn't ready.
//   suggestions  values found in the data, for a text field ([string])

import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { WEEKDAYS_LONG } from '@shared/reports/format.js'
import { shownNumber, storedNumber } from '@shared/reports/build.js'
import { Segmented, DateButton, inputCls } from '@/components/staff/shared'
import PeriodPicker from '@/components/reports/PeriodPicker'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourText = h => String(h).padStart(2, '0') + ':00'
const UNIT = { percent: '%', duration: 'min' }

// A number typed in: the box keeps what was typed while it has the focus (an
// empty box, "1." on the way to 1.5) and passes a number up when it is one.
// Something typed that isn't a number stays in the box to be put right, says
// so, and goes up as NaN: not empty and not a value, so whatever uses it waits.
function NumberBox({ type, value, onChange, label, testId }) {
  const shown = v => { const n = shownNumber(type, v); return n == null ? '' : String(n) }
  const [text, setText] = useState(shown(value))
  const [focused, setFocused] = useState(false)
  const bad = text.trim() !== '' && storedNumber(type, text) == null
  useEffect(() => { if (!focused && !bad) setText(shown(value)) }, [value, focused]) // eslint-disable-line react-hooks/exhaustive-deps
  const unit = UNIT[type]
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="relative inline-flex items-center">
        {type === 'money' && <span className="absolute left-3 text-sm text-muted-foreground pointer-events-none">£</span>}
        <input inputMode="decimal" value={text} aria-label={label} aria-invalid={bad || undefined} data-testid={testId}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={e => {
            const typed = e.target.value
            setText(typed)
            const n = storedNumber(type, typed)
            onChange(n == null && typed.trim() !== '' ? NaN : n)
          }}
          className={cn(inputCls, 'h-12 w-32 tabular-nums', type === 'money' && 'pl-7', unit && 'pr-12', bad && 'border-red-400')} />
        {unit && <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none">{unit}</span>}
      </span>
      {bad && <span className="text-xs text-red-700" role="alert" data-testid="value-not-number">Type a number</span>}
    </span>
  )
}

// One value of a kind.
function One({ kind, type, labels, value, onChange, label, testId }) {
  if (kind === 'number') return <NumberBox type={type} value={value} onChange={onChange} label={label} testId={testId} />
  if (kind === 'yesno') {
    return (
      <Segmented value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={v => onChange(v === 'yes')}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} className="[&>button]:h-12 [&>button]:px-5" />
    )
  }
  if (kind === 'day') return <DateButton value={typeof value === 'string' ? value : ''} onChange={onChange} label={label} className="h-12" />
  if (kind === 'choice' || kind === 'weekday' || kind === 'hour') {
    const options = kind === 'choice' ? Object.entries(labels || {}).map(([v, l]) => ({ v, l }))
      : kind === 'weekday' ? WEEKDAYS_LONG.map((l, i) => ({ v: i + 1, l }))
        : HOURS.map(h => ({ v: h, l: hourText(h) }))
    const pick = raw => onChange(kind === 'choice' ? (raw || null) : raw === '' ? null : Number(raw))
    return (
      <select value={value ?? ''} onChange={e => pick(e.target.value)} aria-label={label} data-testid={testId}
        className={cn(inputCls, 'h-12 w-auto min-w-[10rem] max-w-full')}>
        <option value="">Pick one</option>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    )
  }
  return (
    <input type="text" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} aria-label={label} data-testid={testId}
      maxLength={200} className={cn(inputCls, 'h-12')} />
  )
}

const chip = on => cn('min-h-[48px] px-3 py-1.5 rounded-lg border text-sm text-left touch-manipulation break-words',
  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')

// Several values: ticked from a short list, or typed one at a time.
function Many({ kind, type, labels, value, onChange, label, suggestions }) {
  const list = Array.isArray(value) ? value : []
  const toggle = v => onChange(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const [text, setText] = useState('')
  const [draft, setDraft] = useState(null)
  const [all, setAll] = useState(false)

  if (kind === 'choice' || kind === 'weekday' || kind === 'hour') {
    const options = kind === 'choice' ? Object.entries(labels || {}).map(([v, l]) => ({ v, l }))
      : kind === 'weekday' ? WEEKDAYS_LONG.map((l, i) => ({ v: i + 1, l }))
        : HOURS.map(h => ({ v: h, l: hourText(h) }))
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map(o => (
          <button key={o.v} type="button" onClick={() => toggle(o.v)} aria-pressed={list.includes(o.v)} data-testid="value-choice" data-value={o.v}
            className={chip(list.includes(o.v))}>{o.l}</button>
        ))}
      </div>
    )
  }

  const numeric = kind === 'number'
  const pending = numeric ? draft : text.trim()
  const canAdd = numeric ? Number.isFinite(draft) && !list.includes(draft) : !!pending && !list.includes(pending)
  const add = () => {
    if (!canAdd) return
    onChange([...list, pending])
    setText(''); setDraft(null)
  }
  const offered = (suggestions || []).filter(s => typeof s === 'string' && s.trim() !== '')
  const shownOffers = all ? offered : offered.slice(0, 12)

  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={label + ': chosen'}>
          {list.map(v => (
            <li key={String(v)} className="inline-flex items-center rounded-lg border bg-primary/10 border-primary/40 text-sm" data-testid="value-picked">
              <span className="pl-3 py-1.5 break-words">{numeric ? shownNumber(type, v) : String(v)}</span>
              <button type="button" onClick={() => onChange(list.filter(x => x !== v))} aria-label={'Take ' + v + ' off'}
                className="w-12 h-12 flex items-center justify-center text-muted-foreground touch-manipulation"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); e.stopPropagation(); add() }}>
        {numeric
          ? <NumberBox key={list.length} type={type} value={draft} onChange={setDraft} label={label + ': another value'} testId="value-add-box" />
          : <input type="text" value={text} onChange={e => setText(e.target.value)} aria-label={label + ': another value'} placeholder="Type a value"
              maxLength={200} data-testid="value-add-box" className={cn(inputCls, 'h-12')} />}
        <button type="submit" disabled={!canAdd} data-testid="value-add"
          className="inline-flex items-center gap-1.5 h-12 px-4 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0">
          <Plus className="w-4 h-4" /> Add
        </button>
      </form>
      {shownOffers.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5">Found in the data (tap to pick)</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={label + ': found in the data'}>
            {shownOffers.map(s => (
              <button key={s} type="button" onClick={() => toggle(s)} aria-pressed={list.includes(s)} data-testid="value-offer" className={chip(list.includes(s))}>{s}</button>
            ))}
            {offered.length > shownOffers.length && (
              <button type="button" onClick={() => setAll(true)} className="min-h-[48px] px-3 rounded-lg text-sm text-muted-foreground touch-manipulation hover:bg-muted">
                Show {offered.length - shownOffers.length} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ValueInput({ kind, shape, type, labels, value, onChange, label = 'Value', suggestions, today }) {
  if (shape === 'none') return null
  if (shape === 'period') return <PeriodPicker value={value} onChange={onChange} label={label} today={today} />
  if (shape === 'many') return <Many kind={kind} type={type} labels={labels} value={value} onChange={onChange} label={label} suggestions={suggestions} />
  if (shape === 'two') {
    const pair = Array.isArray(value) ? value : [null, null]
    const set = (i, v) => onChange(i === 0 ? [v, pair[1] ?? null] : [pair[0] ?? null, v])
    return (
      <div className="flex flex-wrap items-center gap-2">
        <One kind={kind} type={type} labels={labels} value={pair[0]} onChange={v => set(0, v)} label={label + ': from'} testId="value-from" />
        <span className="text-sm text-muted-foreground">and</span>
        <One kind={kind} type={type} labels={labels} value={pair[1]} onChange={v => set(1, v)} label={label + ': to'} testId="value-to" />
      </div>
    )
  }
  const offered = kind === 'text' ? (suggestions || []).filter(s => typeof s === 'string' && s.trim() !== '').slice(0, 12) : []
  return (
    <div className="space-y-2">
      <One kind={kind} type={type} labels={labels} value={value} onChange={onChange} label={label} testId="value-one" />
      {offered.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={label + ': found in the data'}>
          {offered.map(s => (
            <button key={s} type="button" onClick={() => onChange(s)} aria-pressed={value === s} data-testid="value-offer" className={chip(value === s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  )
}
