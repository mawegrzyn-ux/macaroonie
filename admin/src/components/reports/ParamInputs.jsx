// src/components/reports/ParamInputs.jsx
//
// The choices a report asks for when it is opened (docs/REPORTS.md 6): its
// period, its venues and any filter set to "ask each time". The viewer
// changes them for the visit; the builder's preview changes what the report
// starts with.
//
//   inputs    paramInputs(catalogue, spec) from shared/reports/build.js
//             (without a catalogue: the report's period and venues only)
//   values    { [key]: value } as they are now
//   onChange  (key, value)
//   venues    the group's venues; the venues choice shows with two or more
//   today     the day it is at the venues, for the period picker's dates

import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { paramWords, filterValueOk, blankValue as blank } from '@shared/reports/build.js'
import { Modal } from '@/components/staff/shared'
import PeriodPicker from '@/components/reports/PeriodPicker'
import VenuesPicker from '@/components/reports/VenuesPicker'
import ValueInput from '@/components/reports/ValueInput'

// A filter that asks each time: a button saying what it is set to, and a
// window to change it. Nothing picked means every row.
function ValueChoice({ catalogue, input, value, onChange, currency }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (open) setDraft(value) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const type = input.field?.type || 'text'
  const words = paramWords(catalogue, input, value, { currency })
  const ok = blank(draft) || filterValueOk(type, input.bucket, input.op, draft)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={input.label + ': ' + words} data-testid="value-choice-button" data-key={input.key}
        className="inline-flex items-center gap-2 min-h-[48px] px-3 py-1.5 rounded-lg border bg-background text-sm text-left touch-manipulation hover:bg-muted max-w-full">
        <SlidersHorizontal className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] leading-tight text-muted-foreground">{input.label}</span>
          <span className="block font-medium leading-tight break-words">{words}</span>
        </span>
      </button>
      {open && (
        <Modal title={input.label} onClose={() => setOpen(false)}
          footer={(
            <>
              <button type="button" disabled={!ok} onClick={() => { onChange(blank(draft) ? null : draft); setOpen(false) }} data-testid="value-choice-apply"
                className="h-12 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                Show
              </button>
              {!blank(value) && (
                <button type="button" onClick={() => { onChange(null); setOpen(false) }} data-testid="value-choice-clear"
                  className="h-12 px-4 rounded-lg border bg-background text-sm touch-manipulation hover:bg-muted">
                  Show everything
                </button>
              )}
            </>
          )}>
          <ValueInput kind={input.kind} shape={input.shape} type={type} labels={input.field?.labels} value={draft} onChange={setDraft} label={input.label} />
          <p className="text-[11px] text-muted-foreground">Leave it empty to show everything.</p>
        </Modal>
      )}
    </>
  )
}

export default function ParamInputs({ catalogue, inputs, values, onChange, venues = [], today, currency }) {
  // A report's one period is "Period" and its venues "Venues"; a name of its
  // own, or the field's when there are two, says which is which.
  const count = type => inputs.filter(i => i.type === type).length
  const labelOf = (i, usual) => (i.named || count(i.type) > 1 ? i.label : usual)
  return (
    <>
      {inputs.map(i => {
        const value = values[i.key]
        if (i.type === 'period') return <PeriodPicker key={i.key} label={labelOf(i, 'Period')} value={value} today={today} onChange={v => onChange(i.key, v)} />
        if (i.type === 'venues') {
          if (venues.length < 2) return null
          return <VenuesPicker key={i.key} label={labelOf(i, 'Venues')} venues={venues} value={value} onChange={v => onChange(i.key, v)} />
        }
        if (!catalogue || !i.subject) return null
        return <ValueChoice key={i.key} catalogue={catalogue} input={i} value={value} onChange={v => onChange(i.key, v)} currency={currency} />
      })}
    </>
  )
}

/** Whether any of a report's choices would show (the row of buttons is left out otherwise). */
export const showsInputs = (inputs, venues = []) => inputs.some(i => i.type === 'period' || i.type === 'value' || (i.type === 'venues' && venues.length > 1))
