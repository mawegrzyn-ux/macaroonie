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

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import {
  ChevronLeft, ChevronRight, Check, Loader2,
  Users, Receipt, Table2, Scale, CalendarDays, LayoutGrid, ListChecks, Sigma,
  AlertTriangle, UserCog, Plus, Trash2, Copy, Star, X,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  fmt, parseNum, getMonday, isoWeekDates, StatusBadge, CardBadge, ScEffectBadge,
  SpreadsheetView, DayView, useReconWeek,
  PAY_TYPES, staffRateLabel, wageEntryForStaff, defaultWageEntries,
} from '@/pages/CashRecon'
import { PettyCashPanel } from '@/pages/mobile/MobileExpenses'

export const CASH_WIDGET_TYPES = [
  { key: 'cash_day_tiles',    label: 'Days of the week',       icon: LayoutGrid,   defaultTitle: 'This week',
    options: [
      { key: 'hide_closed', label: 'Hide closed days', hint: 'Leave out days the venue is closed' },
      { key: 'compact',     label: 'Compact',          hint: 'Smaller tiles: day, status and variance only' },
    ] },
  { key: 'cash_day_balance',  label: 'Day balance',            icon: Scale,        defaultTitle: 'Day balance' },
  { key: 'cash_week_balance', label: 'Week balance',           icon: CalendarDays, defaultTitle: 'Week balance' },
  { key: 'cash_recon_grid',   label: 'Reconciliation grid',    icon: Table2,       defaultTitle: 'Reconciliation', flush: true },
  { key: 'cash_wages_paid',   label: 'Wages paid',             icon: Users,        defaultTitle: 'Wages paid', HeaderValue: WagesPaidHeader },
  { key: 'cash_petty_cash',   label: 'Petty cash',             icon: Receipt,      defaultTitle: 'Petty cash' },
  { key: 'cash_week_expenses', label: 'Week expenses',         icon: ListChecks,   defaultTitle: 'Expenses this week', HeaderValue: WeekExpensesHeader },
  { key: 'cash_week_summary_grid', label: 'Week summary grid', icon: Sigma,        defaultTitle: 'Week summary', flush: true, HeaderValue: WeekSummaryHeader },
  { key: 'cash_week_staff',   label: 'Week staff list',        icon: UserCog,      defaultTitle: 'Staff this week' },
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

// ── Header figures ─────────────────────────────────────────────
//
// A widget type's optional `HeaderValue` component renders a headline
// figure in the card's title bar (WidgetCard in HSDashboard.jsx). They read
// the same queries as the widget bodies, so they add no requests.

function HeaderFigure({ label, value, tone }) {
  const n = parseNum(value)
  return (
    <span className="shrink-0 text-right leading-tight">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn(
        'block text-sm font-semibold tabular-nums',
        tone === 'var' && (n > 0 ? 'text-amber-600' : n < 0 ? 'text-red-600' : 'text-green-700'),
      )}>
        {fmt(n)}
      </span>
    </span>
  )
}

function WeekSummaryHeader({ venueId, ctx }) {
  const { detail, calc } = useReconWeek(venueId, ctx.weekStart)
  if (!detail) return null
  return <HeaderFigure label="Variance" value={calc.weekVariance()} tone="var" />
}

function WeekExpensesHeader({ venueId, ctx }) {
  const { detail, calc } = useReconWeek(venueId, ctx.weekStart)
  if (!detail) return null
  return <HeaderFigure label="Total" value={calc.weekExpenses()} />
}

function useWeekWages(venueId, weekStart) {
  const api = useApi()
  return useQuery({
    queryKey: ['cash-recon-wages', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })
}

function WagesPaidHeader({ venueId, ctx }) {
  const { data } = useWeekWages(venueId, ctx.weekStart)
  if (data === undefined) return null
  const paid = (data?.entries ?? []).reduce((s, e) => s + parseNum(e.cash_amount), 0)
  return <HeaderFigure label="Paid" value={paid} />
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  )
}

// ── Days of the week ───────────────────────────────────────────

// Tapping a day selects it (the day balance and petty cash widgets follow)
// and opens that day's full declaration (DayView) over the dashboard.
// Rendered inline rather than in a portal so it stays inside the
// dashboard's full-screen element. Options (widget.settings):
//   hide_closed  leave out days the venue is closed
//   compact      small tiles: day, status dot, variance

const STATUS_DOT = {
  submitted: 'bg-green-500',
  draft:     'bg-amber-500',
}

function DayTilesWidget({ venueId, ctx, settings }) {
  const qc = useQueryClient()
  const { detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  const [openDate, setOpenDate] = useState(null)
  if (isLoading && !detail) return <Loading />
  const open = new Set(calc.visibleDates)
  const today = todayStr()
  const compact = !!settings?.compact
  const dates = settings?.hide_closed ? calc.dates.filter(d => open.has(d)) : calc.dates

  function openDay(date) {
    ctx.setSelectedDay(date)
    setOpenDate(date)
  }

  function closeDay() {
    setOpenDate(null)
    // DayView refreshes the day and the week cards; the dashboard's
    // widgets read week-detail, so refresh that too.
    qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
  }

  return (
    <>
      {dates.length === 0 ? (
        <p className="text-sm text-muted-foreground">The venue is closed all week.</p>
      ) : (
        <div className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 76 : 118}px, 1fr))` }}>
          {dates.map(date => {
            const day = detail?.days?.[date]
            const isOpen = open.has(date)
            const selected = date === ctx.selectedDay
            const v = calc.variance(date)
            const vTone = v > 0 ? 'text-amber-600' : v < 0 ? 'text-red-600' : 'text-green-700'
            return (
              <button key={date} type="button" onClick={() => openDay(date)}
                aria-label={`Open ${format(parseISO(date), 'EEEE d MMMM')}`}
                className={cn(
                  'text-left rounded-xl border touch-manipulation transition-colors',
                  compact ? 'p-2 min-h-[56px]' : 'p-3 min-h-[96px]',
                  selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-accent',
                  !isOpen && 'opacity-60',
                )}>
                {compact ? (
                  <>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-semibold">{format(parseISO(date), 'EEE d')}</span>
                      {isOpen && (
                        <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', STATUS_DOT[day?.status] ?? 'bg-muted-foreground/30')}
                          title={day?.status === 'submitted' ? 'Submitted' : day?.status === 'draft' ? 'Draft' : 'Not started'} />
                      )}
                    </div>
                    <div className={cn('mt-1 text-xs tabular-nums', isOpen ? vTone : 'text-muted-foreground')}>
                      {isOpen ? fmt(v) : 'Closed'}
                    </div>
                  </>
                ) : (
                  <>
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
                          <div className={vTone}>Var {fmt(v)}</div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}

      {openDate && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col" role="dialog" aria-modal="true"
          aria-label={`Declaration for ${format(parseISO(openDate), 'EEEE d MMMM')}`}>
          <DayView venueId={venueId} date={openDate} onBack={closeDay} />
        </div>
      )}
    </>
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

// ── Week summary grid ──────────────────────────────────────────

// The reconciliation grid's rows with only its WEEK column: every income
// source, SC source and payment channel, the section totals, expenses and
// the summary rows down to Cash to bank. Read-only; every figure comes from
// reconCalc() so it always matches the full grid's WEEK column.
function SummaryRow({ label, value, strong, tone, muted, children }) {
  const n = parseNum(value)
  return (
    <tr className={cn('border-b border-border/40', strong && 'bg-muted/10 border-border', muted && 'text-muted-foreground')}>
      <td className={cn('px-3 py-1.5 text-xs', strong ? 'font-bold' : 'font-medium')}>
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate">{label}</span>
          {children}
        </span>
      </td>
      <td className={cn(
        'px-3 py-1.5 text-xs text-right tabular-nums whitespace-nowrap',
        strong ? 'font-bold' : 'font-semibold',
        n === 0 && !strong && 'text-muted-foreground/40',
        tone === 'var' && (n > 0 ? 'text-amber-600' : n < 0 ? 'text-red-600' : 'text-green-700'),
      )}>
        {n !== 0 || strong || tone ? fmt(n) : '—'}
      </td>
    </tr>
  )
}

function SummarySection({ label }) {
  return (
    <tr className="bg-muted/70 border-y border-border">
      <td colSpan={2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </td>
    </tr>
  )
}

function WeekSummaryGridWidget({ venueId, ctx }) {
  const { detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  if (isLoading && !detail) return <Loading />
  const { activeSources, activeSc, activeChannels, weekTotal, weekDayTotal } = calc
  const scTotal = activeSc.reduce((s, r) => s + weekTotal('sc', r.id), 0)
  const card = calc.weekCardExpenses()
  const wagesMismatch = parseNum(detail?.wages_total) !== parseNum(detail?.wages_cash_total)

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
        <tr>
          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
            {calc.visibleDates.filter(d => detail?.days?.[d]?.status === 'submitted').length}/{calc.visibleDates.length} days submitted
          </th>
          <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground bg-muted/30 w-[110px]">WEEK</th>
        </tr>
      </thead>
      <tbody>
        <SummarySection label="Income" />
        {activeSources.map(s => (
          <SummaryRow key={s.id} label={s.name} value={weekTotal('income', s.id)}>
            {s.exclude_from_recon && <span className="text-[10px] text-muted-foreground shrink-0">(excl.)</span>}
          </SummaryRow>
        ))}
        <SummaryRow label="Total Income" value={weekDayTotal('income')} strong />

        {activeSc.length > 0 && <>
          <SummarySection label="Service Charges" />
          {activeSc.map(s => (
            <SummaryRow key={s.id} label={s.name} value={weekTotal('sc', s.id)}>
              <ScEffectBadge effect={s.takings_effect} label="takings" colourClass="text-amber-600 shrink-0" />
              <ScEffectBadge effect={s.income_effect} label="income" colourClass="text-emerald-600 shrink-0" />
            </SummaryRow>
          ))}
          <SummaryRow label="Total SC" value={scTotal} strong />
        </>}

        <SummarySection label="Takings" />
        {activeChannels.map(c => (
          <SummaryRow key={c.id} label={c.name} value={weekTotal('takings', c.id)}>
            {c.counts_as_cash === false && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">Non-cash</span>
            )}
          </SummaryRow>
        ))}
        <SummaryRow label="Total Takings" value={weekDayTotal('takings')} strong />

        <SummarySection label="Expenses" />
        <SummaryRow label="Total Expenses (cash)" value={calc.weekExpenses()} />
        {card > 0 && <SummaryRow label="Paid by card (not in recon)" value={card} muted />}

        <SummarySection label="Summary" />
        <SummaryRow label="Variance" value={calc.weekVariance()} tone="var" />
        <SummaryRow label="Net Cash" value={calc.weekNetCash()} />
        <SummaryRow label="Wages (cash paid)" value={calc.weekCashWages()}>
          {wagesMismatch && (
            <AlertTriangle
              className="w-3.5 h-3.5 text-amber-600 shrink-0"
              title={`Total wages ${fmt(parseNum(detail?.wages_total))} does not match cash paid ${fmt(parseNum(detail?.wages_cash_total))}`}
            />
          )}
        </SummaryRow>
        <SummaryRow label="Cash to bank" value={calc.weekNetPosition()} strong />
      </tbody>
    </table>
  )
}

// ── Week staff list ────────────────────────────────────────────

// Manage who is on this week's wages and what they're paid: pay type,
// hours x rate or a fixed amount, add/remove, copy the list from another
// week, and set it as the default for future weeks. Edits are held in a
// local draft and only written by Save (the whole-tree PUT the Wages page
// uses); Paid status (cash_amount) is carried over from the server, so the
// Wages paid widget's ticks survive a save here.

function weekEntryTotal(e) {
  return e.entry_type === 'hourly'
    ? Math.round(parseNum(e.hours) * parseNum(e.rate) * 100) / 100
    : parseNum(e.total)
}

function NumField({ value, onChange, placeholder, prefix, suffix, disabled, label, inputClassName = 'w-16' }) {
  return (
    <label className={cn(
      'h-11 flex items-center gap-1 rounded-lg border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-primary/40',
      disabled && 'opacity-60',
    )}>
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className={cn(inputClassName, 'bg-transparent text-right tabular-nums outline-none touch-manipulation')}
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  )
}

function PayTypeSwitch({ value, onChange, disabled }) {
  return (
    <div className="flex rounded-lg border overflow-hidden shrink-0">
      {PAY_TYPES.map(t => (
        <button key={t.value} type="button" disabled={disabled}
          onClick={() => onChange(t.value)}
          className={cn(
            'h-11 px-2 text-xs font-medium touch-manipulation transition-colors disabled:cursor-default',
            value === t.value ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
          )}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function WeekStaffWidget({ venueId, ctx }) {
  const api = useApi()
  const qc = useQueryClient()
  const { weekStart } = ctx

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })
  const { data: wagesData } = useQuery({
    queryKey: ['cash-recon-wages', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })

  // null = showing what's saved (or the default list for a new week);
  // an array = unsaved edits. Reset whenever the venue or week changes.
  const [draft, setDraft] = useState(null)
  const [panel, setPanel] = useState(null)       // null | 'add' | 'copy'
  const [notice, setNotice] = useState(null)
  const [addStaffId, setAddStaffId] = useState('')
  const [addName, setAddName] = useState('')
  const [copyWeek, setCopyWeek] = useState('')
  const [copying, setCopying] = useState(false)
  const key = `${venueId}|${weekStart}`
  const [draftKey, setDraftKey] = useState(key)
  if (draftKey !== key) {
    setDraftKey(key); setDraft(null); setPanel(null); setNotice(null)
  }

  const savedEntries = wagesData?.entries ?? []
  const isNew = savedEntries.length === 0
  const baseEntries = useMemo(
    () => (isNew ? defaultWageEntries(config) : savedEntries),
    [isNew, config, savedEntries],
  )
  const entries = draft ?? baseEntries
  const isSubmitted = wagesData?.status === 'submitted'
  const canSave = !isSubmitted && (draft !== null || (isNew && entries.length > 0))
  const staffById = useMemo(() => Object.fromEntries((config?.staff ?? []).map(s => [s.id, s])), [config])
  const savedById = useMemo(() => Object.fromEntries(savedEntries.map(e => [e.id, e])), [savedEntries])

  const copyOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const wk = getMonday(subWeeks(parseISO(weekStart), i + 1))
    return { value: wk, label: `w/c ${format(parseISO(wk), 'd MMM yyyy')}${i === 0 ? ' (last week)' : ''}` }
  }), [weekStart])

  function edit(next) { setDraft(next); setNotice(null) }
  function updateEntry(idx, patch) { edit(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e))) }

  function changeType(idx, type) {
    const e = entries[idx]
    if ((e.entry_type ?? 'fixed') === type) return
    if (type === 'fixed') {
      const t = weekEntryTotal(e)
      updateEntry(idx, { entry_type: 'fixed', total: t > 0 ? t.toFixed(2) : '' })
    } else {
      const staff = e.staff_id ? staffById[e.staff_id] : null
      const rate = e.rate || ((staff?.pay_type === 'hourly' && staff.default_rate != null) ? String(staff.default_rate) : '')
      updateEntry(idx, { entry_type: 'hourly', rate })
    }
  }

  const invalidateWeek = () => {
    qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId, weekStart] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
  }

  const save = useMutation({
    mutationFn: () => api.put(`/venues/${venueId}/cash-recon/wages/${weekStart}`, {
      notes: wagesData?.notes ?? null,
      entries: entries.map(e => {
        const hourly = e.entry_type === 'hourly'
        const saved = e.id ? savedById[e.id] : null
        const total = weekEntryTotal(e)
        // Someone ticked Paid (cash_amount = their full total) stays fully
        // paid when their amount changes; a partial cash split is kept as is.
        const savedCash = parseNum(saved?.cash_amount ?? e.cash_amount)
        const fullyPaid = saved && savedCash > 0 && savedCash === parseNum(saved.total)
        return {
          staff_id:    e.staff_id ?? null,
          name:        e.name,
          entry_type:  hourly ? 'hourly' : 'fixed',
          hours:       hourly ? parseNum(e.hours) : null,
          rate:        hourly ? parseNum(e.rate) : null,
          total,
          cash_amount: fullyPaid ? total : savedCash,
          notes:       e.notes || null,
        }
      }),
    }),
    onSuccess: () => { setDraft(null); setNotice({ tone: 'ok', text: 'Saved' }); invalidateWeek() },
    onError: err => setNotice({ tone: 'error', text: err?.message || 'Save failed' }),
  })

  const setDefault = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/cash-recon/wages/${weekStart}/set-default`, {
      entries: entries.map(e => ({ staff_id: e.staff_id ?? null, entry_type: e.entry_type ?? 'fixed' })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
      const adhoc = entries.some(e => !e.staff_id)
      setNotice({ tone: 'ok', text: adhoc ? 'Set as default (ad-hoc names are not included)' : 'Set as the default list for new weeks' })
    },
    onError: err => setNotice({ tone: 'error', text: err?.message || 'Could not set default' }),
  })

  function addEntry() {
    if (addStaffId) {
      const member = staffById[addStaffId]
      if (member) edit([...entries, wageEntryForStaff(member)])
    } else if (addName.trim()) {
      edit([...entries, { staff_id: null, name: addName.trim(), entry_type: 'fixed', hours: '', rate: '', total: '', cash_amount: '', notes: '' }])
    }
    setAddStaffId(''); setAddName(''); setPanel(null)
  }

  async function copyFrom() {
    const wk = copyWeek || copyOptions[0].value
    setCopying(true)
    try {
      const src = await qc.fetchQuery({
        queryKey: ['cash-recon-wages', venueId, wk],
        queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${wk}`),
      })
      const list = src?.entries ?? []
      const label = `w/c ${format(parseISO(wk), 'd MMM')}`
      if (list.length === 0) {
        setNotice({ tone: 'error', text: `No wages saved for ${label}` })
      } else {
        edit(list.map(e => ({
          staff_id:    e.staff_id ?? null,
          name:        e.name,
          entry_type:  e.entry_type ?? 'fixed',
          hours:       e.hours != null ? String(e.hours) : '',
          rate:        e.rate != null ? String(e.rate) : '',
          total:       e.total != null ? String(e.total) : '',
          cash_amount: '',
          notes:       '',
        })))
        setNotice({ tone: 'info', text: `Copied ${list.length} from ${label}. Save to keep it.` })
        setPanel(null)
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err?.message || 'Could not load that week' })
    } finally {
      setCopying(false)
    }
  }

  if (wagesData === undefined || !config) return <Loading />

  const onList = new Set(entries.map(e => e.staff_id).filter(Boolean))
  const addable = (config.staff ?? []).filter(s => s.is_active && !onList.has(s.id))
  const total = entries.reduce((sum, e) => sum + weekEntryTotal(e), 0)

  return (
    <div className="space-y-2">
      {isSubmitted && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This week's wages are submitted. Unsubmit them on the Cash Recon Wages page to change the list.
        </p>
      )}
      {!isSubmitted && isNew && draft === null && entries.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing saved for this week yet. Filled from your {config.wage_defaults?.length ? 'default list' : 'active staff'}; Save to keep it.
        </p>
      )}

      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No staff on this week yet.</p>
      )}

      {/* One row per person when the widget is wide enough; the row wraps
          (name first, controls below) only when it isn't. The amount area
          has a fixed width so pay type, amounts and totals line up. */}
      {entries.length > 0 && (
        <div className="rounded-xl border divide-y">
          {entries.map((e, idx) => {
            const hourly = e.entry_type === 'hourly'
            return (
              <div key={e.id ?? `${e.staff_id ?? 'adhoc'}-${idx}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5">
                <span className="flex-1 basis-28 min-w-[7rem] truncate text-sm font-medium" title={e.name}>
                  {e.name}
                  {!e.staff_id && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">ad-hoc</span>}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
                  <PayTypeSwitch value={hourly ? 'hourly' : 'fixed'} disabled={isSubmitted} onChange={t => changeType(idx, t)} />
                  <div className="w-[11.5rem] flex items-center justify-end gap-1">
                    {hourly ? (
                      <>
                        <NumField label="Hours" value={e.hours} placeholder="0" suffix="h" disabled={isSubmitted}
                          inputClassName="w-10" onChange={v => updateEntry(idx, { hours: v })} />
                        <span className="text-muted-foreground text-sm">×</span>
                        <NumField label="Rate" value={e.rate} placeholder="0.00" prefix="£" suffix="/hr" disabled={isSubmitted}
                          inputClassName="w-11" onChange={v => updateEntry(idx, { rate: v })} />
                      </>
                    ) : (
                      <NumField label="Amount" value={e.total} placeholder="0.00" prefix="£" disabled={isSubmitted}
                        onChange={v => updateEntry(idx, { total: v })} />
                    )}
                  </div>
                  <span className="w-[4.5rem] text-right text-sm font-semibold tabular-nums shrink-0">{fmt(weekEntryTotal(e))}</span>
                  {isSubmitted ? (
                    <span className="w-11 shrink-0" aria-hidden="true" />
                  ) : (
                    <button type="button" aria-label={`Remove ${e.name}`}
                      onClick={() => edit(entries.filter((_, i) => i !== idx))}
                      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 touch-manipulation">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between px-1 pt-1 text-sm font-semibold">
        <span>Total wages</span><span className="tabular-nums">{fmt(total)}</span>
      </div>

      {panel === 'add' && (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
          {addable.length > 0 && (
            <select value={addStaffId} onChange={ev => { setAddStaffId(ev.target.value); setAddName('') }}
              className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation">
              <option value="">Pick from staff list…</option>
              {addable.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({(s.pay_type ?? 'fixed') === 'hourly' ? 'Hourly' : 'Fixed'}{staffRateLabel(s) ? `, ${staffRateLabel(s)}` : ''})
                </option>
              ))}
            </select>
          )}
          <input type="text" value={addName} placeholder={addable.length > 0 ? 'or type a one-off name' : 'Name'}
            onChange={ev => { setAddName(ev.target.value); setAddStaffId('') }}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation" />
          <div className="flex gap-2">
            <button type="button" onClick={addEntry} disabled={!addStaffId && !addName.trim()}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
            <button type="button" onClick={() => setPanel(null)}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {panel === 'copy' && (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
          <p className="text-xs text-muted-foreground">Replaces this week's list with the staff, pay types, hours and amounts from:</p>
          <select value={copyWeek || copyOptions[0].value} onChange={ev => setCopyWeek(ev.target.value)}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation">
            {copyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={copyFrom} disabled={copying}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
              {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} Copy
            </button>
            <button type="button" onClick={() => setPanel(null)}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {notice && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
          notice.tone === 'error' ? 'bg-red-50 text-red-700' : notice.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-muted text-foreground',
        )}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="shrink-0 touch-manipulation">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {!isSubmitted && panel === null && (
          <>
            <button type="button" onClick={() => setPanel('add')}
              className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Add staff
            </button>
            <button type="button" onClick={() => setPanel('copy')}
              className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <Copy className="w-4 h-4" /> Copy from…
            </button>
          </>
        )}
        <button type="button" onClick={() => setDefault.mutate()}
          disabled={setDefault.isPending || !entries.some(e => e.staff_id)}
          title="Use this list (who is on it, and Fixed/Hourly) for new weeks"
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50 flex items-center gap-1.5">
          {setDefault.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />} Set as default
        </button>
      </div>

      {canSave && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
          {draft !== null && (
            <button type="button" onClick={() => { setDraft(null); setNotice(null) }} disabled={save.isPending}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
              Discard changes
            </button>
          )}
        </div>
      )}
    </div>
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

  const { data: wagesData, isLoading } = useWeekWages(venueId, weekStart)

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

// ── Week expenses ──────────────────────────────────────────────

// Every expense logged in the week, grouped by day, from the same
// week-detail response the balance widgets use (so it refreshes whenever
// an expense is added in the petty cash widget or Cash Recon). Tapping a
// day heading selects that day, which the petty cash widget follows.
function WeekExpensesWidget({ venueId, ctx }) {
  const { config, detail, isLoading, calc } = useReconWeek(venueId, ctx.weekStart)
  if (isLoading && !detail) return <Loading />

  const catById = Object.fromEntries((config?.expense_categories ?? []).map(c => [c.id, c]))
  const days = calc.dates
    .map(date => ({ date, expenses: detail?.days?.[date]?.expenses ?? [] }))
    .filter(d => d.expenses.length > 0)

  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">No expenses logged this week.</p>
  }

  const all = days.flatMap(d => d.expenses)
  const vat = all.reduce((s, e) => s + parseNum(e.vat_amount), 0)
  const card = calc.weekCardExpenses()

  return (
    <div>
      <div className="space-y-3">
        {days.map(({ date, expenses }) => (
          <div key={date}>
            <button type="button" onClick={() => ctx.setSelectedDay(date)}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-1 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide touch-manipulation hover:bg-accent',
                date === ctx.selectedDay ? 'text-primary' : 'text-muted-foreground',
              )}>
              <span>{format(parseISO(date), 'EEE d MMM')}</span>
              <span className="tabular-nums normal-case">{fmt(calc.dayExpenses(date))}</span>
            </button>
            <div className="divide-y border rounded-lg">
              {expenses.map(exp => {
                const cat = exp.category_id ? catById[exp.category_id]?.name : exp.category
                return (
                  <div key={exp.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{exp.description}</div>
                      {(cat || exp.paid_by_card || parseNum(exp.vat_amount) > 0) && (
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground min-w-0">
                          {cat && <span className="truncate">{cat}</span>}
                          {parseNum(exp.vat_amount) > 0 && <span className="shrink-0">VAT {fmt(exp.vat_amount)}</span>}
                          {exp.paid_by_card && <CardBadge />}
                        </div>
                      )}
                    </div>
                    <span className={cn('text-sm tabular-nums shrink-0', exp.paid_by_card && 'text-muted-foreground')}>
                      {fmt(exp.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t mt-3 pt-1">
        <Row label="Expenses (cash)" value={calc.weekExpenses()} bold />
        {card > 0 && <Row label="Paid by card (not in recon)" value={card} muted />}
        {vat > 0 && <Row label="Includes VAT" value={vat} muted />}
      </div>
    </div>
  )
}

// ── Dispatcher ─────────────────────────────────────────────────

export function renderCashWidget({ widget, venueId, ctx }) {
  switch (widget.widget_type) {
    case 'cash_day_tiles':    return <DayTilesWidget venueId={venueId} ctx={ctx} settings={widget.settings} />
    case 'cash_day_balance':  return <DayBalanceWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_balance': return <WeekBalanceWidget venueId={venueId} ctx={ctx} />
    case 'cash_recon_grid':   return <ReconGridWidget venueId={venueId} ctx={ctx} />
    case 'cash_wages_paid':   return <WagesPaidWidget venueId={venueId} ctx={ctx} />
    case 'cash_petty_cash':   return <PettyCashWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_expenses': return <WeekExpensesWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_summary_grid': return <WeekSummaryGridWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_staff':   return <WeekStaffWidget venueId={venueId} ctx={ctx} />
    default:                  return null
  }
}
