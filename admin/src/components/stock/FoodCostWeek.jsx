// src/components/stock/FoodCostWeek.jsx
//
// Food cost for a Cash Recon week (inventory phase 6b, docs/INVENTORY.md 8.1):
// the theoretical food cost % of the week's sales, and the actual only for the
// stock period that covers the week (else the latest closed one, named with
// its dates), said in words. Actual needs a full count at both ends, so a week
// never gets an actual of its own. Read only; every figure and word is the
// API's (shared/foodCost.js). Lazy-loaded by the Cash Recon week view (cash's
// pages/CashRecon.jsx) and by the food cost dashboard widget.
//
//   FoodCostWeek({ venueId, weekStart, compact })
//   useFoodCostWeek(venueId, weekStart, enabled)
//   API GET /api/stock/venues/:venueId/food-cost/week?start=

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/utils'

const pct = n => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1) + '%')
const pts = n => (n == null ? null : (n > 0 ? '+' : '') + (Math.round(n * 10) / 10).toFixed(1) + ' pts')

export function useFoodCostWeek(venueId, weekStart, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: ['stock-food-cost-week', venueId, weekStart],
    queryFn: () => api.get(`/stock/venues/${venueId}/food-cost/week?start=${weekStart}`),
    enabled: !!venueId && !!weekStart && enabled,
    staleTime: 60_000,
  })
}

/** Whether this person may see food cost % (a share of sales): Costing view and Till reports view. */
export function useSeesFoodCost() {
  const costing = usePermission('costing')
  const sales = usePermission('pos_reports')
  return costing.canView && sales.canView
}

function Tile({ label, value, sub, testid }) {
  return (
    <div className="rounded-xl border bg-background px-3 py-2 min-w-[8.5rem] flex-1" data-testid={testid}>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="block text-lg font-semibold tabular-nums">{value}</span>
      {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** The week's food cost: two tiles and the words. Nothing at all for someone who can't see it. */
export function FoodCostWeek({ venueId, weekStart, compact = false }) {
  const sees = useSeesFoodCost()
  const { data, isLoading, error } = useFoodCostWeek(venueId, weekStart, sees)
  if (!sees) return null
  const a = data?.actual
  const body = isLoading
    ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Working out food cost…</p>
    : error
      ? <p className="text-sm text-red-600">Food cost couldn't be loaded: {error.message}</p>
      : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Tile label="Theoretical, this week" value={pct(data.theoretical.theoretical_pct)} testid="food-cost-week-theoretical"
              sub={data.theoretical.uncosted_units > 0 ? 'reads low: dishes without a recipe' : 'by the recipes of what sold'} />
            <Tile label={a?.covers ? 'Actual, the period covering it' : 'Actual, latest closed period'} value={pct(a?.pct)} testid="food-cost-week-actual"
              sub={a ? a.period.words + (pts(a.gap_pts) ? ' · gap ' + pts(a.gap_pts) : '') : 'needs a full count at both ends'} />
          </div>
          <ul className={cn('text-xs text-muted-foreground space-y-1', compact && 'line-clamp-4')} data-testid="food-cost-week-words">
            {data.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )
  if (compact) return body
  return (
    <div className="w-full rounded-2xl border bg-card shadow-sm p-4 space-y-2" data-testid="food-cost-week">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Food cost</span>
        <Link to={'/stock?tab=variance&venue=' + venueId}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary min-h-[48px] px-2 touch-manipulation">
          Variance <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {body}
    </div>
  )
}

export default FoodCostWeek
