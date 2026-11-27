// src/components/stock/OverviewTile.jsx
//
// The Overview's stock tile (inventory phase 6b, migration 313): each venue of
// the group in a line, what waits first (counts to approve, transfers to
// receive, flagged items to review), when it was last fully counted and, with
// Costing view and Till reports view, this week's theoretical food cost % and
// the actual of the stock period that covers it (else the latest closed one).
// Every word and figure is the API's (shared/foodCost.js). Lazy-loaded by the
// Overview page (pages/Dashboard.jsx, the dashboards area's).
//
//   API GET /api/stock/overview

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const pct = n => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1) + '%')
const day = at => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null)

export default function StockOverviewTile() {
  const api = useApi()
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-overview'],
    queryFn: () => api.get('/stock/overview'),
    staleTime: 60_000,
  })
  if (isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
  if (error) return <p className="text-sm text-red-600">Stock couldn't be loaded: {error.message}</p>
  if (!data.venues.length) return <p className="text-sm text-muted-foreground">No venues yet.</p>
  return (
    <div className="divide-y" data-testid="overview-stock">
      {data.venues.map(v => {
        const waiting = v.to_approve || v.incoming || v.unreviewed
        return (
          <Link key={v.venue_id} to={'/stock?venue=' + v.venue_id}
            className="block py-2 min-h-[48px] touch-manipulation hover:bg-muted/40 rounded-md px-1" data-testid="overview-stock-venue" data-venue={v.venue}>
            <span className="flex items-center gap-2 text-sm">
              <span className="font-medium flex-1 min-w-0 truncate">{v.venue}</span>
              {data.sees_sales && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0" title="Theoretical food cost this week, and actual for the stock period">
                  {pct(v.theoretical_pct)} theory{v.actual?.pct != null ? ' · ' + pct(v.actual.pct) + ' actual' : ''}
                </span>
              )}
            </span>
            <span className={cn('block text-xs', waiting ? 'text-amber-700' : 'text-muted-foreground')}>
              {v.words}{v.last_full_count_at ? ' · last full count ' + day(v.last_full_count_at) : ''}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
