// src/components/cashRecon/widgets.jsx
//
// Widgets for the Cash Recon Dashboard (pages/CashDashboard.jsx), which
// runs on the shared DashboardPage engine from HSDashboard.jsx.
//
// Every figure comes from the same place as Cash Recon itself:
//   - reconCalc()/useReconWeek() in CashRecon.jsx for the week grid maths
//     (totals, variance, Net Cash, Cash to bank)
//   - SpreadsheetView (hideHeader) for the editable grid
//   - PettyCashPanel from MobileExpenses.jsx for petty cash
//   - the wages PATCH .../entries/:id/paid endpoint for the Paid checkbox
// so the dashboard can never disagree with the Cash Recon pages.
//
// Navigation context (ctx) comes from useWeekNav(): the week being shown,
// plus a selected day that the day tiles widget sets and the day balance
// and petty cash widgets read.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import {
  ChevronLeft, ChevronRight, Check, Loader2,
  Users, Receipt, Table2, Scale, CalendarDays, LayoutGrid,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  fmt, parseNum, getMonday, isoWeekDates, StatusBadge,
  SpreadsheetView, useReconWeek,
} from '@/pages/CashRecon'
import { PettyCashPanel } from '@/pages/mobile/MobileExpenses'

export const CASH_WIDGET_TYPES = [
  { key: 'cash_day_tiles',    label: 'Days of the week',       icon: LayoutGrid,   defaultTitle: 'This week' },
  { key: 'cash_day_balance',  label: 'Day balance',            icon: Scale,        defaultTitle: 'Day balance' },
  { key: 'cash_week_balance', label: 'Week balance',           icon: CalendarDays, defaultTitle: 'Week balance' },
  { key: 'cash_recon_grid',   label: 'Reconciliation grid',    icon: Table2,       defaultTitle: 'Reconciliation', flush: true },
  { key: 'cash_wages_paid',   label: 'Wages paid',             icon: Users,        defaultTitle: 'Wages paid' },
  { key: 'cash_petty_cash',   label: 'Petty cash',             icon: Receipt,      defaultTitle: 'Petty cash' },
]

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

// ── Week navigator ─────────────────────────────────────────────

export function useWeekNav() {
  const [weekStart, setWeekStartRaw] = useState(() => getMonday(new Date()))
  const [selectedDay, setSelectedDay] = useState(() => todayStr())

  // Keep the selected day inside the week being shown: today if it's in
  // that week, otherwise the Monday.
  function setWeekStart(next) {
    setWeekStartRaw(next)
    const today = todayStr()
    setSelectedDay(isoWeekDates(next).includes(today) ? today : next)
  }

  const isThisWeek = weekStart === getMonday(new Date())
  const element = (
    <div className="flex items-center gap-1.5 shrink-0">
      <button type="button" onClick={() => setWeekStart(getMonday(subWeeks(parseISO(weekStart), 1)))}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation"
        aria-label="Previous week">
        <ChevronLeft className="w-5 h-5" />
      </button>
      <span className="w-44 shrink-0 text-center text-sm font-medium whitespace-nowrap">
        {format(parseISO(weekStart), 'd MMM')} – {format(addDays(parseISO(weekStart), 6), 'd MMM yyyy')}
      </span>
      <button type="button" onClick={() => setWeekStart(getMonday(addWeeks(parseISO(weekStart), 1)))}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation"
        aria-label="Next week">
        <ChevronRight className="w-5 h-5" />
      </button>
      {!isThisWeek && (
        <button type="button" onClick={() => setWeekStart(getMonday(new Date()))}
          className="text-xs px-2.5 py-1.5 rounded-lg border hover:bg-accent touch-manipulation ml-1">
          This week
        </button>
      )}
    </div>
  )

  return { ctx: { weekStart, selectedDay, setSelectedDay }, element }
}

// ── Small shared bits ──────────────────────────────────────────

function Row({ label, value, bold, tone, muted }) {
  const n = parseNum(value)
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', bold && 'font-semibold border-t mt-1 pt-2', muted && 'text-muted-foreground')}>
      <span className="min-w-0 truncate">{label}</span>
      <span className={cn(
        'tabular-nums shrink-0',
        tone === 'var' && (n > 0 ? 'text-amber-600' : n < 0 ? 'text-red-600' : 'text-green-700'),
      )}>
        {fmt(n)}
      </span>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  )
}

// ── Days of the week ───────────────────────────────────────────

function DayTilesWidget({ venueId, ctx }) {
  const { detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  if (isLoading && !detail) return <Loading />
  const open = new Set(calc.visibleDates)
  const today = todayStr()

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
      {calc.dates.map(date => {
        const day = detail?.days?.[date]
        const isOpen = open.has(date)
        const selected = date === ctx.selectedDay
        const v = calc.variance(date)
        return (
          <button key={date} type="button" onClick={() => ctx.setSelectedDay(date)}
            className={cn(
              'text-left rounded-xl border p-3 min-h-[96px] touch-manipulation transition-colors',
              selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-accent',
              !isOpen && 'opacity-60',
            )}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-sm font-semibold">{format(parseISO(date), 'EEE')}</span>
              {date === today && <span className="text-[10px] font-medium text-primary">Today</span>}
            </div>
            <div className="text-xs text-muted-foreground mb-1.5">{format(parseISO(date), 'd MMM')}</div>
            {!isOpen ? (
              <div className="text-xs text-muted-foreground">Closed</div>
            ) : (
              <>
                <StatusBadge status={day?.status ?? 'none'} />
                <div className="mt-1.5 text-xs tabular-nums">
                  <div>Income {fmt(calc.dayTotal(date, 'income'))}</div>
                  <div className={cn(v > 0 ? 'text-amber-600' : v < 0 ? 'text-red-600' : 'text-green-700')}>
                    Var {fmt(v)}
                  </div>
                </div>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Day balance ────────────────────────────────────────────────

function DayBalanceWidget({ venueId, ctx }) {
  const { detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  if (isLoading && !detail) return <Loading />
  const date = ctx.selectedDay
  const day = detail?.days?.[date]
  const isOpen = calc.visibleDates.includes(date)
  const card = calc.dayCardExpenses(date)

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-semibold">{format(parseISO(date), 'EEEE d MMM')}</span>
        {isOpen && <StatusBadge status={day?.status ?? 'none'} />}
      </div>
      {!isOpen ? (
        <p className="text-sm text-muted-foreground">The venue is closed on this day.</p>
      ) : (
        <>
          <Row label="Total income" value={calc.dayTotal(date, 'income')} />
          {calc.activeSc.length > 0 && <Row label="Service charges" value={calc.dayTotal(date, 'sc')} />}
          <Row label="Total takings" value={calc.dayTotal(date, 'takings')} />
          <Row label="Variance" value={calc.variance(date)} tone="var" />
          <Row label="Cash takings" value={calc.cashTakingsTotal(date)} />
          <Row label="Expenses (cash)" value={calc.dayExpenses(date)} />
          {card > 0 && <Row label="Paid by card (not in recon)" value={card} muted />}
          <Row label="Net cash" value={calc.netCash(date)} bold />
        </>
      )}
    </div>
  )
}

// ── Week balance ───────────────────────────────────────────────

function WeekBalanceWidget({ venueId, ctx }) {
  const { detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  if (isLoading && !detail) return <Loading />
  const submitted = calc.visibleDates.filter(d => detail?.days?.[d]?.status === 'submitted').length
  const card = calc.weekCardExpenses()
  const wagesMismatch = parseNum(detail?.wages_total) !== parseNum(detail?.wages_cash_total)

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        {submitted}/{calc.visibleDates.length} open days submitted
      </div>
      <Row label="Total income" value={calc.weekDayTotal('income')} />
      <Row label="Total takings" value={calc.weekDayTotal('takings')} />
      <Row label="Variance" value={calc.weekVariance()} tone="var" />
      <Row label="Cash takings" value={calc.weekCashTakings()} />
      <Row label="Expenses (cash)" value={calc.weekExpenses()} />
      {card > 0 && <Row label="Paid by card (not in recon)" value={card} muted />}
      <Row label="Net cash" value={calc.weekNetCash()} />
      <Row label="Wages (cash paid)" value={calc.weekCashWages()} />
      {wagesMismatch && (
        <p className="text-xs text-amber-700 -mt-0.5 mb-1">
          Wages to pay {fmt(parseNum(detail?.wages_total))}, cash paid {fmt(parseNum(detail?.wages_cash_total))}.
        </p>
      )}
      <Row label="Cash to bank" value={calc.weekNetPosition()} bold />
    </div>
  )
}

// ── Reconciliation grid ────────────────────────────────────────

function ReconGridWidget({ venueId, ctx }) {
  return (
    <SpreadsheetView
      venueId={venueId}
      weekStart={ctx.weekStart}
      hideHeader
      onSelectDay={ctx.setSelectedDay}
      onSelectWages={() => {}}
    />
  )
}

// ── Wages paid ─────────────────────────────────────────────────

function entryTotal(e) {
  return parseNum(e.total ?? (parseNum(e.hours) * parseNum(e.rate)))
}

function WagesPaidWidget({ venueId, ctx }) {
  const api = useApi()
  const qc = useQueryClient()
  const { weekStart } = ctx

  const { data: wagesData, isLoading } = useQuery({
    queryKey: ['cash-recon-wages', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })

  // The dedicated paid endpoint works whether or not the week's wages are
  // submitted — marking staff paid happens after the report is final.
  const markPaid = useMutation({
    mutationFn: ({ id, paid }) => api.patch(`/venues/${venueId}/cash-recon/wages/${weekStart}/entries/${id}/paid`, { paid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
    },
  })

  if (isLoading) return <Loading />
  const entries = (wagesData?.entries ?? []).filter(e => e.id)
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No wages saved for this week yet. Set them up on the Cash Recon Wages page.
      </p>
    )
  }

  const toPay = entries.reduce((s, e) => s + entryTotal(e), 0)
  const paid  = entries.reduce((s, e) => s + parseNum(e.cash_amount), 0)

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1 pb-1.5 border-b">
        <span>Staff</span>
        <span className="flex items-center gap-6"><span>To pay</span><span className="w-11 text-center">Paid</span></span>
      </div>
      <div className="divide-y">
        {entries.map(e => {
          const isPaid = parseNum(e.cash_amount) > 0
          const pending = markPaid.isPending && markPaid.variables?.id === e.id
          return (
            <div key={e.id} className="flex items-center gap-3 py-1.5 px-1">
              <span className="flex-1 min-w-0 truncate text-sm">{e.name}</span>
              <span className="text-sm tabular-nums">{fmt(entryTotal(e))}</span>
              <button type="button" role="checkbox" aria-checked={isPaid} aria-label={`${e.name} paid`}
                disabled={pending}
                onClick={() => markPaid.mutate({ id: e.id, paid: !isPaid })}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg touch-manipulation hover:bg-accent disabled:opacity-50">
                <span className={cn(
                  'w-6 h-6 rounded-md border-2 flex items-center justify-center',
                  isPaid ? 'bg-primary border-primary text-primary-foreground' : 'bg-background',
                )}>
                  {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isPaid && <Check className="w-4 h-4" />}
                </span>
              </button>
            </div>
          )
        })}
      </div>
      <div className="border-t mt-1 pt-2 space-y-0.5 text-sm">
        <div className="flex justify-between"><span>To pay</span><span className="tabular-nums">{fmt(toPay)}</span></div>
        <div className="flex justify-between"><span>Paid (cash)</span><span className="tabular-nums">{fmt(paid)}</span></div>
        <div className="flex justify-between font-semibold">
          <span>Outstanding</span><span className="tabular-nums">{fmt(Math.max(0, toPay - paid))}</span>
        </div>
      </div>
    </div>
  )
}

// ── Petty cash ─────────────────────────────────────────────────

function PettyCashWidget({ venueId, ctx }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">{format(parseISO(ctx.selectedDay), 'EEEE d MMM')}</div>
      <PettyCashPanel venueId={venueId} date={ctx.selectedDay} />
    </div>
  )
}

// ── Dispatcher ─────────────────────────────────────────────────

export function renderCashWidget({ widget, venueId, ctx }) {
  switch (widget.widget_type) {
    case 'cash_day_tiles':    return <DayTilesWidget venueId={venueId} ctx={ctx} />
    case 'cash_day_balance':  return <DayBalanceWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_balance': return <WeekBalanceWidget venueId={venueId} ctx={ctx} />
    case 'cash_recon_grid':   return <ReconGridWidget venueId={venueId} ctx={ctx} />
    case 'cash_wages_paid':   return <WagesPaidWidget venueId={venueId} ctx={ctx} />
    case 'cash_petty_cash':   return <PettyCashWidget venueId={venueId} ctx={ctx} />
    default:                  return null
  }
}
