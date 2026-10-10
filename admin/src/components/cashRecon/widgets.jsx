// src/components/cashRecon/widgets.jsx
//
// Widgets for the Cash Recon Dashboard (pages/CashDashboard.jsx), which
// runs on the shared DashboardPage engine from HSDashboard.jsx.
//
// Every figure comes from the same place as Cash Recon itself:
//   - reconCalc()/useReconWeek() in CashRecon.jsx for the week grid maths
//     (totals and the variance)
//   - SpreadsheetView (hideHeader) for the editable grid
//   - PettyCashPanel from MobileExpenses.jsx for petty cash
//   - WeekWagesEditor (WagesTable.jsx) for the wage widgets
//   - the rota pay payload (useRotaPay, computeRotaWeek() on the server) for
//     the tips to pay out widget, the same figures as the Rota page's tips
// so the dashboard can never disagree with the Cash Recon or Rota pages.
//
// Navigation context (ctx) comes from useWeekNav(): the week being shown,
// plus a selected day that the day tiles widget sets and the day balance
// and petty cash widgets read.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import {
  ChevronLeft, ChevronRight, Loader2,
  Users, Receipt, Table2, Scale, CalendarDays, LayoutGrid, ListChecks, Sigma,
  AlertTriangle, UserCog, Coins,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  fmt, parseNum, getMonday, isoWeekDates, StatusBadge, CardBadge, ScEffectBadge,
  SpreadsheetView, DayView, useReconWeek,
} from '@/pages/CashRecon'
import { PettyCashPanel } from '@/pages/mobile/MobileExpenses'
import { WeekWagesEditor } from './WagesTable'
import { useRotaPay, useRotaPerms, tipRows, TipMoneyCell } from '@/components/staff/rota'

// Display options for the two wage widgets (widget.settings), passed to
// WeekWagesEditor. Saving still writes the whole week (hidden fields are
// sent back unchanged).
const WAGES_OPTIONS = [
  { key: 'hide_manage', label: 'Hide list changes', hint: 'No Add staff, Copy from, Set as default or remove buttons' },
  { key: 'hide_bulk',   label: 'Hide pay-all options', hint: 'No Pay everyone in full or Paid on for all' },
  { key: 'paid_only',   label: 'Name and Paid only', hint: 'Show just each name and what they were paid' },
  { key: 'show_bank',   label: 'Show bank transfer', hint: 'Add the Bank column next to cash in hand' },
]

// Display options for the tips to pay out widget (widget.settings). The cash
// and bank transfer totals always show; these only hide the detail.
const TIPS_PAYOUT_OPTIONS = [
  { key: 'hide_pots',   label: 'Hide tip pots', hint: 'Leave out where the tips came from and how each pot is paid' },
  { key: 'hide_people', label: 'Hide staff list', hint: 'Show only the cash and bank transfer totals' },
  { key: 'hide_share',  label: 'Hide each person\'s total', hint: 'Staff list shows only Bank and Cash' },
  { key: 'hide_empty',  label: 'Hide people with nothing to pay', hint: 'Leave out staff with no tips this week' },
  { key: 'hide_notes',  label: 'Hide notes', hint: 'No notes about unallocated tips, handed-on money or pots with nobody picked' },
]

export const CASH_WIDGET_TYPES = [
  { key: 'cash_day_tiles',    label: 'Days of the week',       icon: LayoutGrid,   defaultTitle: 'This week',
    options: [
      { key: 'hide_closed', label: 'Hide closed days', hint: 'Leave out days the venue is closed' },
      { key: 'compact',     label: 'Compact',          hint: 'Smaller tiles: day, status and variance only' },
    ] },
  { key: 'cash_day_balance',  label: 'Day balance',            icon: Scale,        defaultTitle: 'Day balance' },
  { key: 'cash_week_balance', label: 'Week balance',           icon: CalendarDays, defaultTitle: 'Week balance' },
  { key: 'cash_recon_grid',   label: 'Reconciliation grid',    icon: Table2,       defaultTitle: 'Reconciliation', flush: true },
  { key: 'cash_wages_paid',   label: 'Wages paid',             icon: Users,        defaultTitle: 'Wages paid', HeaderValue: WagesPaidHeader,
    options: WAGES_OPTIONS },
  { key: 'cash_petty_cash',   label: 'Petty cash',             icon: Receipt,      defaultTitle: 'Petty cash' },
  { key: 'cash_week_expenses', label: 'Week expenses',         icon: ListChecks,   defaultTitle: 'Expenses this week', HeaderValue: WeekExpensesHeader },
  { key: 'cash_week_summary_grid', label: 'Week summary grid', icon: Sigma,        defaultTitle: 'Week summary', flush: true, HeaderValue: WeekSummaryHeader },
  { key: 'cash_week_staff',   label: 'Week staff list',        icon: UserCog,      defaultTitle: 'Staff this week', HeaderValue: WagesPaidHeader,
    options: WAGES_OPTIONS },
  { key: 'cash_tips_payout',  label: 'Tips to pay out',        icon: Coins,        defaultTitle: 'Tips to pay out', HeaderValue: TipsPayoutHeader,
    options: TIPS_PAYOUT_OPTIONS },
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

// ── Tips to pay out ────────────────────────────────────────────

// The week's tips as money to hand over: how much goes out in cash and how
// much by bank transfer, per person and in total. Read-only; every figure is
// the rota pay payload's (tip_cash / tip_bank per person, totals.tips_cash /
// tips_bank), the same as the Rota page's tips table, which is where pots,
// shares, moves and payees are edited. Needs rota_tips view.

function TipsPayoutHeader({ venueId, ctx }) {
  const { canSeeTips } = useRotaPerms()
  const { data } = useRotaPay(venueId, ctx.weekStart, canSeeTips)
  if (data?.totals?.tips_shared == null) return null
  return <HeaderFigure label="Tips" value={data.totals.tips_shared} />
}

function PayoutTile({ label, value }) {
  return (
    <div className="rounded-xl border bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums leading-tight">{fmt(value)}</p>
    </div>
  )
}

function potPayoutText(p) {
  const how = p.payout_method === 'bank' ? 'By bank transfer' : 'In cash'
  if (p.payout_to === 'people' && p.payees?.length) return `${how} to ${p.payees.map(x => x.name).join(', ')}`
  return `${how}, each person's share`
}

function TipsPayoutWidget({ venueId, ctx, settings = {} }) {
  const { canSeeTips } = useRotaPerms()
  const { data, isLoading, error } = useRotaPay(venueId, ctx.weekStart, canSeeTips)
  if (!canSeeTips) return <p className="text-sm text-muted-foreground py-4 text-center">You don't have access to rota tips.</p>
  if (isLoading && !data) return <Loading />
  if (error) return <p className="text-sm text-destructive py-4 text-center">{error.message || 'Could not load tips.'}</p>

  const pots = (data.pots ?? []).filter(p => p.distribution !== 'house')
  if (!pots.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No tip pots set up yet. Add one in Rota setup.</p>
  }
  const t = data.totals
  let rows = tipRows(data)
  if (settings.hide_empty) rows = rows.filter(r => r.tip_cash || r.tip_bank)
  const nobodyPicked = pots.filter(p => p.no_payees)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <PayoutTile label="Cash" value={t.tips_cash} />
        <PayoutTile label="Bank transfer" value={t.tips_bank} />
      </div>

      {!settings.hide_notes && (t.tips_handed_on > 0 || t.tips_unallocated > 0 || nobodyPicked.length > 0) && (
        <div className="space-y-1 text-xs">
          {t.tips_handed_on > 0 && (
            <p className="text-red-700">{fmt(t.tips_handed_on)} to be handed on by people paid more than their share.</p>
          )}
          {t.tips_unallocated > 0 && (
            <p className="text-muted-foreground">{fmt(t.tips_unallocated)} unallocated (not paid to anyone).</p>
          )}
          {nobodyPicked.map(p => (
            <p key={p.id} className="text-amber-700">{p.name}: nobody picked to be paid, so it is paid as shares. Pick people on the Rota page.</p>
          ))}
        </div>
      )}

      {!settings.hide_pots && (
        <div className="divide-y rounded-xl border">
          {pots.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{potPayoutText(p)}</p>
              </div>
              <span className="tabular-nums shrink-0">{fmt(p.paid_to_people ?? p.total)}</span>
            </div>
          ))}
          {t.kept_by_house > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
              <span className="flex-1 min-w-0">Kept by the house</span>
              <span className="tabular-nums shrink-0">{fmt(t.kept_by_house)}</span>
            </div>
          )}
        </div>
      )}

      {!settings.hide_people && (rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 text-center">No tips to pay out this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Staff</th>
                {!settings.hide_share && <th className="text-right px-2 py-2 font-medium">Total</th>}
                <th className="text-right px-2 py-2 font-medium">Bank</th>
                <th className="text-right px-3 py-2 font-medium">Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.staff_id}>
                  <td className="px-3 py-2"><div className="font-medium truncate max-w-[160px]">{r.name}</div></td>
                  {!settings.hide_share && <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.tip_share)}</td>}
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap"><TipMoneyCell value={r.tip_bank} /></td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium"><TipMoneyCell value={r.tip_cash} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2">Total</td>
                {!settings.hide_share && <td className="px-2 py-2 text-right tabular-nums">{fmt(t.tips_shared)}</td>}
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t.tips_bank)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(t.tips_cash)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
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
          <Row label="Expenses (cash)" value={calc.dayExpenses(date)} />
          {card > 0 && <Row label="Paid by card (not in recon)" value={card} muted />}
          {calc.dayWages(date) > 0 && <Row label="Wages paid (cash)" value={calc.dayWages(date)} />}
          <Row label="Variance" value={calc.variance(date)} tone="var" bold />
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
      <Row label="Expenses (cash)" value={calc.weekExpenses()} />
      {card > 0 && <Row label="Paid by card (not in recon)" value={card} muted />}
      <Row label="Wages (cash paid)" value={calc.weekCashWages()} />
      {wagesMismatch && (
        <p className="text-xs text-amber-700 -mt-0.5 mb-1">
          Wages to pay {fmt(parseNum(detail?.wages_total))}, cash paid {fmt(parseNum(detail?.wages_cash_total))}.
        </p>
      )}
      <Row label="Variance" value={calc.weekVariance()} tone="var" bold />
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
// source, SC source and payment channel, the section totals, what was paid
// out of the till, and the variance. Read-only; every figure comes from
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

        <SummarySection label="Paid out of till" />
        <SummaryRow label="Total Expenses (cash)" value={calc.weekExpenses()} />
        {card > 0 && <SummaryRow label="Paid by card (not in recon)" value={card} muted />}
        <SummaryRow label="Wages (cash paid)" value={calc.weekCashWages()}>
          {wagesMismatch && (
            <AlertTriangle
              className="w-3.5 h-3.5 text-amber-600 shrink-0"
              title={`Total wages ${fmt(parseNum(detail?.wages_total))} does not match cash paid ${fmt(parseNum(detail?.wages_cash_total))}`}
            />
          )}
        </SummaryRow>

        <SummarySection label="Summary" />
        <SummaryRow label="Variance" value={calc.weekVariance()} tone="var" strong />
      </tbody>
    </table>
  )
}

// ── Week staff list / Wages paid ───────────────────────────────

// Both wage widgets are the shared WeekWagesEditor (Name, Total, Paid, Paid
// on, Notes, explicit Save), the same editor as the Cash Recon Wages page.
// A payment entered here is recorded on the day selected on the dashboard.

function WeekWagesWidget({ venueId, ctx, settings }) {
  return (
    <WeekWagesEditor venueId={venueId} weekStart={ctx.weekStart} defaultPaidDay={ctx.selectedDay}
      hideManage={!!settings?.hide_manage} hideBulk={!!settings?.hide_bulk} paidOnly={!!settings?.paid_only}
      showBank={!!settings?.show_bank} />
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
    case 'cash_wages_paid':   return <WeekWagesWidget venueId={venueId} ctx={ctx} settings={widget.settings} />
    case 'cash_petty_cash':   return <PettyCashWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_expenses': return <WeekExpensesWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_summary_grid': return <WeekSummaryGridWidget venueId={venueId} ctx={ctx} />
    case 'cash_week_staff':   return <WeekWagesWidget venueId={venueId} ctx={ctx} settings={widget.settings} />
    case 'cash_tips_payout':  return <TipsPayoutWidget venueId={venueId} ctx={ctx} settings={widget.settings} />
    default:                  return null
  }
}
