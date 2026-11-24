// src/components/home/Sites.jsx — Your sites, above the store (Pepper-first
// step 7c, reports/AI first back office strategy.md "Above the store").
//
// For someone with Manage on Venues in a group with more than one venue,
// first on Home: every venue ranked by what needs it today (late tasks,
// checks out of range, cash-ups missing, devices offline, skips), each with
// its reasons as chips and the share of its tasks done in their window today
// and this week. A tap switches Home to that venue. GET /api/ops/sites
// (api/src/services/sites.js), from the feed's record the notices sweep keeps
// every five minutes: by site, never by person.

import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronRight, CheckCircle2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const TONE = {
  red: 'bg-red-50 border-red-300 text-red-900',
  amber: 'bg-amber-50 border-amber-300 text-amber-900',
  slate: 'bg-muted/60 border-border text-foreground',
}

const pct = c => (c?.share == null ? '–' : Math.round(c.share) + '%')

/** The ranked sites; `current` is the venue Home shows, `onPick(id)` switches Home to another. */
export default function Sites({ current, onPick, enabled }) {
  const api = useApi()
  const q = useQuery({
    queryKey: ['ops-sites'],
    queryFn: () => api.get('/ops/sites'),
    enabled: !!enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
  if (!enabled || !q.data || q.data.sites.length < 2) return null
  const { sites, today, week } = q.data
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="home-sites">
      <div className="section-head px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Building2 className="w-4 h-4 shrink-0" />
        <h2 className="font-semibold">Your sites</h2>
        <span className="ml-auto text-xs opacity-90" data-testid="sites-group">
          Done in time: today {pct(today)} · this week {pct(week)}
        </span>
      </div>
      <ul className="divide-y">
        {sites.map((s, i) => (
          <li key={s.venue_id}>
            <button type="button" onClick={() => onPick(s.venue_id)} data-testid="site" data-venue={s.venue_id} data-rank={i + 1}
              aria-current={s.venue_id === current ? 'true' : undefined}
              className={cn('w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 min-h-[56px] hover:bg-accent touch-manipulation',
                s.venue_id === current && 'bg-primary/5')}>
              <span className="min-w-[8rem] flex-1">
                <span className="block font-medium" data-testid="site-name">{s.name}</span>
                <span className="flex flex-wrap gap-1.5 mt-1" data-testid="site-reasons">
                  {s.reasons.length ? s.reasons.map(r => (
                    <span key={r.key} data-testid="site-reason" data-key={r.key}
                      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', TONE[r.tone] || TONE.slate)}>{r.text}</span>
                  )) : (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Nothing late</span>
                  )}
                  {!s.recorded && <span className="text-xs text-muted-foreground">No record yet today</span>}
                </span>
              </span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                <span className="text-right"><span className="block font-semibold text-sm text-foreground" data-testid="site-today">{pct(s.today)}</span>today</span>
                <span className="text-right"><span className="block font-semibold text-sm text-foreground" data-testid="site-week">{pct(s.week)}</span>week</span>
                <ChevronRight className="w-4 h-4" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 py-2 border-t text-xs text-muted-foreground">
        Done in time: tasks finished before they went late, out of those due. Updated every few minutes. Tap a site to see its day.
      </p>
    </section>
  )
}
