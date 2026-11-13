// src/components/reports/PeriodPicker.jsx
//
// The period a report is run for (docs/REPORTS.md 5.5): a named period
// ("Last week", "Last 28 days") that moves with the calendar, or two dates.
// The names and what they mean on a given day come from
// shared/reports/period.js, the same file the engine reads.
//
//   value     { relative, n? } | { from, to }
//   onChange  called with the new period
//   today     the day it is at the venues ('YYYY-MM-DD'), from the last
//             result; the picker's dates are worked out from it

import { useEffect, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import {
  PERIOD_LABELS, MAX_N_DAYS, normalisePeriod, periodText, resolvePeriod, rangeText, todayIn,
} from '@shared/reports/period.js'
import { Modal, DateButton, inputCls } from '@/components/staff/shared'
import { cn } from '@/lib/utils'

const GROUPS = [
  { title: 'Days', keys: ['today', 'yesterday'] },
  { title: 'Weeks (Monday to Sunday)', keys: ['week_to_date', 'this_week', 'last_week'] },
  { title: 'Months', keys: ['month_to_date', 'this_month', 'last_month'] },
  { title: 'Quarters and years', keys: ['quarter_to_date', 'this_quarter', 'last_quarter', 'year_to_date', 'this_year', 'last_year'] },
  { title: 'Coming up', keys: ['tomorrow', 'next_week', 'next_month'] },
]
const LAST_DAYS = [7, 14, 28, 90]
const NEXT_DAYS = [7, 14, 28]

const same = (a, b) => JSON.stringify(normalisePeriod(a)) === JSON.stringify(normalisePeriod(b))

function Choice({ period, today, current, onPick, label }) {
  const r = resolvePeriod(period, today)
  const on = same(period, current)
  return (
    <button type="button" onClick={() => onPick(period)} aria-pressed={on} data-testid="period-choice"
      className={cn('min-h-[48px] px-3 py-1.5 rounded-lg border text-left touch-manipulation',
        on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
      <span className="block text-sm font-medium leading-tight">{label}</span>
      {r && <span className={cn('block text-[11px] leading-tight mt-0.5', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{rangeText(r.from, r.to)}</span>}
    </button>
  )
}

// A number of days typed in. The box keeps what was typed while it is being
// typed (an empty box is allowed on the way to another number).
function DaysBox({ label, verb, onPick }) {
  const [text, setText] = useState('')
  const n = Math.round(Number(text))
  const ok = text !== '' && Number.isFinite(n) && n >= 1 && n <= MAX_N_DAYS
  return (
    <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (ok) onPick(n) }}>
      <input inputMode="numeric" value={text} aria-label={label} placeholder="Days"
        onChange={e => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        className={cn(inputCls, 'h-12 w-24')} />
      <button type="submit" disabled={!ok}
        className="h-12 px-4 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50">
        {verb}
      </button>
    </form>
  )
}

export default function PeriodPicker({ value, onChange, today, label = 'Period' }) {
  const [open, setOpen] = useState(false)
  const day = today || todayIn('Europe/London')
  const current = normalisePeriod(value)
  const now = resolvePeriod(current, day)
  const [from, setFrom] = useState(now?.from || day)
  const [to, setTo] = useState(now?.to || day)
  // Opening the window starts the two dates from the period showing.
  useEffect(() => {
    if (open && now) { setFrom(now.from); setTo(now.to) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pick = p => { onChange(normalisePeriod(p)); setOpen(false) }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label + ': ' + periodText(current, day)} data-testid="period-button"
        className="inline-flex items-center gap-2 min-h-[48px] px-3 py-1.5 rounded-lg border bg-background text-sm text-left touch-manipulation hover:bg-muted max-w-full">
        <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
          <span className="block font-medium leading-tight break-words">{periodText(current, day) || 'Pick a period'}</span>
        </span>
      </button>

      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          {GROUPS.slice(0, 1).map(g => (
            <section key={g.title} role="group" aria-label={g.title}>
              <h3 className="text-xs font-medium text-muted-foreground mb-1.5">{g.title}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {g.keys.map(k => <Choice key={k} period={{ relative: k }} label={PERIOD_LABELS[k]} today={day} current={current} onPick={pick} />)}
              </div>
            </section>
          ))}

          <section role="group" aria-label="The last few days">
            <h3 className="text-xs font-medium text-muted-foreground mb-1.5">The last few days (up to yesterday)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {LAST_DAYS.map(n => <Choice key={n} period={{ relative: 'last_n_days', n }} label={'Last ' + n + ' days'} today={day} current={current} onPick={pick} />)}
            </div>
            <DaysBox label="Another number of days back" verb="Show the last days" onPick={n => pick({ relative: 'last_n_days', n })} />
          </section>

          {GROUPS.slice(1, 4).map(g => (
            <section key={g.title} role="group" aria-label={g.title}>
              <h3 className="text-xs font-medium text-muted-foreground mb-1.5">{g.title}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {g.keys.map(k => <Choice key={k} period={{ relative: k }} label={PERIOD_LABELS[k]} today={day} current={current} onPick={pick} />)}
              </div>
            </section>
          ))}

          <section role="group" aria-label="Coming up">
            <h3 className="text-xs font-medium text-muted-foreground mb-1.5">Coming up (bookings and orders ahead)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {GROUPS[4].keys.map(k => <Choice key={k} period={{ relative: k }} label={PERIOD_LABELS[k]} today={day} current={current} onPick={pick} />)}
              {NEXT_DAYS.map(n => <Choice key={n} period={{ relative: 'next_n_days', n }} label={'Next ' + n + ' days'} today={day} current={current} onPick={pick} />)}
            </div>
          </section>

          <section role="group" aria-label="Your own dates">
            <h3 className="text-xs font-medium text-muted-foreground mb-1.5">Your own dates</h3>
            <div className="flex flex-wrap items-center gap-2">
              <DateButton value={from} onChange={setFrom} label="From" className="h-12" />
              <span className="text-sm text-muted-foreground">to</span>
              <DateButton value={to} onChange={setTo} label="To" className="h-12" />
              <button type="button" onClick={() => pick({ from, to })} data-testid="period-dates-apply"
                className="h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
                Show these dates
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">Dates stay as picked. A named period moves on with the calendar each time the report is opened.</p>
          </section>
        </Modal>
      )}
    </>
  )
}
