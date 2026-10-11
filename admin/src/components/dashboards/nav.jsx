// src/components/dashboards/nav.jsx
//
// The one date navigator for every dashboard (H&S, Cash, Rota, and the blank
// ones on the Dashboards page, desktop and phone). Since any dashboard can
// hold any widget (migration 152), it always tracks a single selected day,
// and the week is the Monday-to-Sunday week that day falls in:
//   ctx = { date, weekStart, selectedDay, setSelectedDay }
// H&S widgets read ctx.date; cash and rota widgets read ctx.weekStart and
// ctx.selectedDay (day tiles and the rota grid set it).
//
// What the bar shows depends on the widgets on the dashboard
// (navModeFor(), each widget type's `nav` in widgetTypes.jsx):
//   'day'   one day, arrows step a day
//   'week'  one week, arrows step a week (the selected day becomes today if
//           it's in that week, else the Monday, as the Cash Dashboard always
//           did)
//   'both'  the day and its week, inner arrows step a day, outer arrows a week
// Tapping the label opens the device's date picker in every mode.

import { useState, useMemo, useCallback } from 'react'
import { format, addDays, addWeeks, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn, openPicker } from '@/lib/utils'
import { getMonday, isoWeekDates } from '@/pages/CashRecon'

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function useDashboardNav() {
  const [date, setDate] = useState(todayStr)
  const weekStart = getMonday(parseISO(date))

  const stepDay = useCallback(delta => {
    setDate(d => format(addDays(parseISO(d), delta), 'yyyy-MM-dd'))
  }, [])
  const stepWeek = useCallback(delta => {
    setDate(d => {
      const monday = format(addWeeks(parseISO(getMonday(parseISO(d))), delta), 'yyyy-MM-dd')
      const today = todayStr()
      return isoWeekDates(monday).includes(today) ? today : monday
    })
  }, [])
  const goToday = useCallback(() => setDate(todayStr()), [])

  const ctx = useMemo(
    () => ({ date, weekStart, selectedDay: date, setSelectedDay: setDate }),
    [date, weekStart],
  )
  return { date, weekStart, setDate, stepDay, stepWeek, goToday, ctx }
}

/** 'day' | 'week' | 'both' for a dashboard's widgets; `fallback` when none needs a date. */
export function navModeFor(widgets, typeByKey, fallback = 'day') {
  let day = false
  let week = false
  for (const w of widgets) {
    const nav = typeByKey[w.widget_type]?.nav
    if (nav === 'day') day = true
    else if (nav === 'week') week = true
  }
  if (day && week) return 'both'
  if (week) return 'week'
  if (day) return 'day'
  return fallback
}

function ArrowButton({ onClick, label, children }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation">
      {children}
    </button>
  )
}

function weekLabel(weekStart) {
  return `${format(parseISO(weekStart), 'd MMM')} – ${format(addDays(parseISO(weekStart), 6), 'd MMM yyyy')}`
}

// Shorter, for the second line in 'both' mode: "5 – 11 Oct", "28 Sep – 4 Oct".
function shortWeekLabel(weekStart) {
  const start = parseISO(weekStart)
  const end = addDays(start, 6)
  return start.getMonth() === end.getMonth()
    ? `${format(start, 'd')} – ${format(end, 'd MMM')}`
    : `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`
}

export function DashboardNav({ nav, mode, mobile = false }) {
  const { date, weekStart, setDate, stepDay, stepWeek, goToday } = nav
  const today = todayStr()
  const isToday = date === today
  const isThisWeek = weekStart === getMonday(new Date())
  const dayText = isToday ? 'Today' : format(parseISO(date), 'EEE d MMM yyyy')

  const showReset = mode === 'week' ? !isThisWeek : !isToday
  const resetText = mode === 'week' ? 'This week' : 'Today'

  const label = (
    <div className={cn('relative', mobile ? 'flex-1 min-w-0' : 'shrink-0')}>
      <div className={cn(
        'px-3 rounded-lg text-center whitespace-nowrap overflow-hidden touch-manipulation flex flex-col justify-center',
        mobile ? 'w-full min-h-[44px] border' : 'w-44 min-h-[44px] hover:bg-accent',
      )}>
        {mode === 'week' ? (
          <span className="text-sm font-medium truncate">{weekLabel(weekStart)}</span>
        ) : mode === 'both' ? (
          <>
            <span className="text-sm font-medium leading-tight truncate">{dayText}</span>
            <span className="text-[11px] text-muted-foreground leading-tight truncate">Week {shortWeekLabel(weekStart)}</span>
          </>
        ) : (
          <span className="text-sm font-medium truncate">{dayText}</span>
        )}
      </div>
      <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
        onClick={openPicker} aria-label="Pick a date"
        className="absolute inset-0 opacity-0 cursor-pointer w-full" />
    </div>
  )

  return (
    <div className={cn('flex items-center gap-1.5', mobile ? 'w-full' : 'shrink-0')}>
      {mode === 'both' && (
        <ArrowButton onClick={() => stepWeek(-1)} label="Previous week"><ChevronsLeft className="w-5 h-5" /></ArrowButton>
      )}
      {mode === 'week' ? (
        <ArrowButton onClick={() => stepWeek(-1)} label="Previous week"><ChevronLeft className="w-5 h-5" /></ArrowButton>
      ) : (
        <ArrowButton onClick={() => stepDay(-1)} label="Previous day"><ChevronLeft className="w-5 h-5" /></ArrowButton>
      )}
      {label}
      {mode === 'week' ? (
        <ArrowButton onClick={() => stepWeek(1)} label="Next week"><ChevronRight className="w-5 h-5" /></ArrowButton>
      ) : (
        <ArrowButton onClick={() => stepDay(1)} label="Next day"><ChevronRight className="w-5 h-5" /></ArrowButton>
      )}
      {mode === 'both' && (
        <ArrowButton onClick={() => stepWeek(1)} label="Next week"><ChevronsRight className="w-5 h-5" /></ArrowButton>
      )}
      {showReset && (
        <button type="button" onClick={goToday}
          className={cn('shrink-0 text-xs px-2.5 rounded-lg border hover:bg-accent touch-manipulation min-h-[44px]', !mobile && 'ml-1')}>
          {resetText}
        </button>
      )}
    </div>
  )
}
