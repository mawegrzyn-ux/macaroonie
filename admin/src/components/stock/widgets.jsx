// src/components/stock/widgets.jsx
//
// The bodies of the stock and costing dashboard widgets (inventory phase 6b;
// their names are components/stock/widgetTypes.js). Lazy-loaded by the widget
// catalog (components/dashboards/widgetTypes.jsx) only on a dashboard that
// has one. Every figure is the API's (shared/foodCost.js, shared/variance.js,
// shared/stock.js, shared/costing.js); nothing is worked out here. A widget
// whose figures need a narrower permission than its module says so in place
// (design rule: never a 403 inside a widget).
//
//   StockWidget({ widget, venueId, ctx })   one of the four, by widget.widget_type
//   API GET /api/stock/venues/:id/food-cost/week?start=  (food cost)
//       GET /api/stock/venues/:id/waste/summary?from=&to=&by=reason  (waste)
//       GET /api/stock/venues/:id/variance?period=latest  (top variance items)
//       GET /api/stock/venues/:id/margins-by-menu?start=  (margin by menu)

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, addDays, parseISO } from 'date-fns'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FoodCostWeek, useSeesFoodCost } from '@/components/stock/FoodCostWeek'
import { pounds, qty } from '@/components/stock/shared'

const pct = n => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1) + '%')
const penceMoney = p => (p == null ? '–' : pounds(Number(p) / 100))
const weekWords = start => format(parseISO(start), 'd MMM') + ' to ' + format(addDays(parseISO(start), 6), 'd MMM')

function Note({ children, testid }) {
  return <p className="text-sm text-muted-foreground py-4 text-center" data-testid={testid}>{children}</p>
}
function Loading() {
  return <p className="text-sm text-muted-foreground flex items-center gap-2 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
}
function Failed({ error }) {
  if (error?.status === 404) return <Note>{error.message}</Note>
  return <p className="text-sm text-red-600 py-4">Couldn't load this: {error?.message}</p>
}
function More({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-primary min-h-[48px] px-1 touch-manipulation">
      {children} <ChevronRight className="w-3.5 h-3.5" />
    </Link>
  )
}

// ── Food cost % actual and theoretical ──────────────────────────────────────

function FoodCostWidget({ venueId, ctx }) {
  const sees = useSeesFoodCost()
  const api = useApi()
  const { data } = useQuery({
    queryKey: ['stock-food-cost-week', venueId, ctx.weekStart],
    queryFn: () => api.get(`/stock/venues/${venueId}/food-cost/week?start=${ctx.weekStart}`),
    enabled: sees && !!venueId,
    staleTime: 60_000,
  })
  if (!sees) return <Note testid="widget-food-cost-hidden">Food cost % is a share of sales: it needs Till reports view as well as Costing view.</Note>
  return (
    <div className="space-y-3" data-testid="widget-food-cost">
      <p className="text-xs text-muted-foreground">Week of {weekWords(ctx.weekStart)}</p>
      <FoodCostWeek venueId={venueId} weekStart={ctx.weekStart} compact />
      {data?.recent?.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <div className="section-head px-3 py-2 text-xs font-semibold grid grid-cols-[1fr_auto_auto] gap-3">
            <span>Closed periods</span><span className="w-14 text-right">Actual</span><span className="w-14 text-right">Theory</span>
          </div>
          <div className="divide-y">
            {data.recent.map(p => (
              <div key={p.id} className="px-3 py-2 text-sm grid grid-cols-[1fr_auto_auto] gap-3" data-testid="widget-food-cost-period">
                <span className="min-w-0 truncate">{format(new Date(p.from_at), 'd MMM')} to {format(new Date(p.to_at), 'd MMM')}</span>
                <span className="w-14 text-right tabular-nums">{p.complete ? pct(p.actual_pct) : 'n/k'}</span>
                <span className="w-14 text-right tabular-nums text-muted-foreground">{pct(p.theoretical_pct)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Waste this week by reason ───────────────────────────────────────────────

function WasteWidget({ venueId, ctx }) {
  const api = useApi()
  const to = format(addDays(parseISO(ctx.weekStart), 6), 'yyyy-MM-dd')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-waste-summary', venueId, ctx.weekStart, 'reason'],
    queryFn: () => api.get(`/stock/venues/${venueId}/waste/summary?from=${ctx.weekStart}&to=${to}&by=reason`),
    enabled: !!venueId,
  })
  if (isLoading) return <Loading />
  if (error) return <Failed error={error} />
  return (
    <div className="space-y-2" data-testid="widget-waste">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">Week of {weekWords(ctx.weekStart)} · {data.entries} {data.entries === 1 ? 'entry' : 'entries'}{data.till_voids ? ', ' + data.till_voids + ' till voids' : ''}</p>
        {data.sees_values && <span className="text-sm font-semibold tabular-nums" data-testid="widget-waste-total">{pounds(data.value)}</span>}
      </div>
      {data.rows.length === 0
        ? <Note>No waste logged this week.</Note>
        : (
          <div className="divide-y border rounded-xl">
            {data.rows.map(r => (
              <div key={r.key} className="px-3 py-2 text-sm flex items-center gap-3" data-testid="widget-waste-reason" data-reason={r.label}>
                <span className="flex-1 min-w-0 truncate">{r.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{r.entries} {r.entries === 1 ? 'entry' : 'entries'}</span>
                {data.sees_values && <span className="w-20 text-right tabular-nums">{r.value == null ? '–' : pounds(r.value)}</span>}
              </div>
            ))}
          </div>
        )}
      {!data.sees_values && <p className="text-xs text-muted-foreground">Values need Costing view.</p>}
      <More to={'/stock?tab=waste&venue=' + venueId}>Waste</More>
    </div>
  )
}

// ── Top variance items ──────────────────────────────────────────────────────

const TOP = 6

function VarianceWidget({ venueId }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-variance', venueId, 'latest'],
    queryFn: () => api.get(`/stock/venues/${venueId}/variance?period=latest`),
    enabled: !!venueId,
  })
  if (isLoading) return <Loading />
  if (error) return <Failed error={error} />
  const values = data.sees_values
  // Ranked by the API (pounds of unexplained loss first); the flagged ones and the biggest losses.
  const rows = data.rows.filter(r => (r.flagged || (values ? r.unexplained_value > 0 : r.unexplained > 0))).slice(0, TOP)
  return (
    <div className="space-y-2" data-testid="widget-variance">
      <p className="text-xs text-muted-foreground">
        {data.period.words} · {data.period.status === 'closed' ? 'closed' : 'open'} · {data.flagged} flagged{data.unreviewed ? ', ' + data.unreviewed + ' not reviewed' : ''}
      </p>
      {rows.length === 0
        ? <Note>No unexplained loss in this period.</Note>
        : (
          <div className="divide-y border rounded-xl">
            {rows.map(r => (
              <div key={r.item_id} className="px-3 py-2 text-sm flex items-center gap-3" data-testid="widget-variance-item" data-item={r.name}>
                <span className={cn('flex-1 min-w-0 truncate', r.flagged && 'font-medium')}>{r.name}{r.flagged ? ' · flagged' : ''}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{r.unexplained == null ? 'not counted' : qty(r.unexplained, r.base_unit)}</span>
                {values && <span className="w-20 text-right tabular-nums">{r.unexplained_value == null ? '–' : pounds(r.unexplained_value)}</span>}
              </div>
            ))}
          </div>
        )}
      {!values && <p className="text-xs text-muted-foreground">Pounds need Costing view.</p>}
      <More to={'/stock?tab=variance&venue=' + venueId + (data.period.id ? '&period=' + data.period.id : '')}>Variance</More>
    </div>
  )
}

// ── Margin by menu ──────────────────────────────────────────────────────────

function MarginsWidget({ venueId, ctx }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-margins-by-menu', venueId, ctx.weekStart],
    queryFn: () => api.get(`/stock/venues/${venueId}/margins-by-menu?start=${ctx.weekStart}`),
    enabled: !!venueId,
  })
  if (isLoading) return <Loading />
  if (error) return <Failed error={error} />
  const sales = data.sees_sales
  return (
    <div className="space-y-2" data-testid="widget-margins">
      <p className="text-xs text-muted-foreground">Sold in the week of {weekWords(data.week_start)}, at what was paid for the items</p>
      {data.menus.length === 0
        ? <Note>Nothing sold this week has been worked out yet.</Note>
        : (
          <div className="border rounded-xl overflow-hidden">
            <div className={cn('section-head px-3 py-2 text-xs font-semibold grid gap-3', sales ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]')}>
              <span>Menu</span>
              {sales && <span className="w-20 text-right">Net</span>}
              <span className="w-20 text-right">{sales ? 'GP' : 'Cost'}</span>
              <span className="w-14 text-right">{sales ? 'Cost %' : 'Units'}</span>
            </div>
            <div className="divide-y">
              {data.menus.map(m => (
                <div key={m.menu_id || 'none'} className={cn('px-3 py-2 text-sm grid gap-3 items-center', sales ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]')}
                  data-testid="widget-margins-menu" data-menu={m.menu || 'none'}>
                  <span className="min-w-0 truncate">{m.menu || 'Not on a menu now'}{m.uncosted_qty > 0 && <span className="block text-xs text-muted-foreground">{Math.round(m.uncosted_qty)} sold without a full recipe</span>}</span>
                  {sales && <span className="w-20 text-right tabular-nums">{penceMoney(m.net_pence)}</span>}
                  <span className="w-20 text-right tabular-nums">{sales ? penceMoney(m.gp_pence) : penceMoney(m.cost_pence)}</span>
                  <span className="w-14 text-right tabular-nums">{sales ? pct(m.cost_pct) : Math.round(m.qty)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      {!sales && <p className="text-xs text-muted-foreground">Sales, GP and cost % need Till reports view.</p>}
      <More to={'/menu-margins?tab=sold&venue=' + venueId}>Menu margins</More>
    </div>
  )
}

export function StockWidget({ widget, venueId, ctx }) {
  // The Stock and Costing views are checked by the catalog (NoAccess); each body checks the narrower ones.
  if (!venueId) return <Note>Pick a venue.</Note>
  switch (widget.widget_type) {
    case 'stock_food_cost':      return <FoodCostWidget venueId={venueId} ctx={ctx} />
    case 'stock_waste_week':     return <WasteWidget venueId={venueId} ctx={ctx} />
    case 'stock_variance_items': return <VarianceWidget venueId={venueId} />
    case 'stock_menu_margins':   return <MarginsWidget venueId={venueId} ctx={ctx} />
    default:                     return null
  }
}

export default StockWidget
