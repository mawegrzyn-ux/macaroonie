// components/orders/ScheduleEditor.jsx
//
// Date range + times-of-day editor shared by Ordering setup (menu
// schedules) and Promotions. Rules and checks: shared/menuSchedule.js.

import { useState } from 'react'
import { Plus, Trash2, Clock, X, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DAY_SHORT, isScheduled, scheduleLabel } from '@shared/menuSchedule.js'

// Date as a styled button over an invisible native date input (design rule 10).
export function DateButton({ label, value, onChange }) {
  const text = value ? new Date(value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Any'
  return (
    <div className="flex items-center gap-1">
      <label className="relative inline-flex items-center gap-2 min-h-[44px] px-3 border rounded-md text-sm bg-background touch-manipulation cursor-pointer">
        <CalendarDays className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{text}</span>
        <input type="date" value={value || ''} onChange={e => onChange(e.target.value || null)} aria-label={label}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </label>
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label.toLowerCase()} date`}
          className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

const WEEK = [1, 2, 3, 4, 5, 6, 0]

/**
 * Optional date range and time windows per day, in the shape of
 * shared/menuSchedule.js: ordering menus (migration 130) and promotions
 * (migration 131). onChange(null) = always on.
 */
export function ScheduleEditor({ value, onChange, className = '', alwaysLabel = 'Always available', resetLabel = '{resetLabel}', datesLabel = '{datesLabel}' }) {
  const sched = value || { from: null, until: null, times: [] }
  const [open, setOpen] = useState(false)
  const times = sched.times || []
  const put = patch => onChange({ ...sched, ...patch })
  const setTime = (i, patch) => put({ times: times.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  function addTime() {
    const last = times[times.length - 1]
    put({ times: [...times, last
      ? { days: [...last.days], start: last.end, end: last.end < '21:00' ? '22:00' : '23:59' }
      : { days: [1, 2, 3, 4, 5, 6, 0], start: '11:00', end: '15:00' }] })
  }

  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 min-h-[40px] text-sm text-primary touch-manipulation">
        <Clock className="w-4 h-4" />
        {isScheduled(sched) ? scheduleLabel(sched) : alwaysLabel}
        <span className="text-muted-foreground underline underline-offset-2">{open ? 'Done' : 'Set times and dates'}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border bg-muted/30 p-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{datesLabel}</p>
            <div className="flex flex-wrap gap-2">
              <DateButton label="From" value={sched.from} onChange={v => put({ from: v })} />
              <DateButton label="Until" value={sched.until} onChange={v => put({ until: v })} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Times of day {times.length ? '' : '(none: all day)'}</p>
            {times.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                <div className="flex flex-wrap gap-1">
                  {WEEK.map(d => {
                    const on = t.days.includes(d)
                    return (
                      <button key={d} type="button" aria-pressed={on}
                        onClick={() => setTime(i, { days: on ? t.days.filter(x => x !== d) : [...t.days, d] })}
                        className={cn('w-11 h-11 rounded-md text-xs font-semibold touch-manipulation border',
                          on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground')}>
                        {DAY_SHORT[d]}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input type="time" value={t.start} onChange={e => setTime(i, { start: e.target.value })} aria-label="Start"
                    className="border rounded-md px-2 min-h-[44px] bg-background" />
                  <span>to</span>
                  <input type="time" value={t.end} onChange={e => setTime(i, { end: e.target.value })} aria-label="End"
                    className="border rounded-md px-2 min-h-[44px] bg-background" />
                  <button type="button" onClick={() => put({ times: times.filter((_, j) => j !== i) })} aria-label="Remove time"
                    className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addTime}
              className="inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-sm bg-background touch-manipulation">
              <Plus className="w-4 h-4" /> Add times
            </button>
          </div>
          {isScheduled(sched) && (
            <button type="button" onClick={() => onChange(null)}
              className="text-sm text-muted-foreground underline underline-offset-2 min-h-[40px] touch-manipulation">
              {resetLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

