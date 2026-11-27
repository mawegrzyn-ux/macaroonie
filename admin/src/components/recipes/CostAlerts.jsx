// src/components/recipes/CostAlerts.jsx
//
// Price creep on the Menu margins page (inventory phase 7b, migration 315;
// docs/INVENTORY.md 8.2): a small banner across the page when supplier price
// changes took dishes over their cost target or limit and nobody has marked
// them seen yet ("4 dishes crossed 35% since 1 Dec: Chicken thighs up 12%"),
// at the page's venue (every venue on the group's prices). See them opens a
// drawer of the alerts of the last 90 days (back to the oldest not seen yet,
// when that is older, so what the banner counts is listed): each dish at its
// venue and order type, its cost % before and after, what moved (each item's
// cost per kg, litre or each, and what it did to a serving), where the change
// came from, and who marked it seen. Mark as seen (Costing manage, on the
// banner or in the drawer) clears every unseen alert at the venue for
// everyone. ?alerts=1 opens the drawer (Today's card links here); &alert= (a
// report row) marks that alert in it.
// Loaded on demand by pages/MenuMargins.jsx.
// API: routes/costAlerts.js (/api/cost-alerts). The words come from the API
// (alertSummary() in shared/priceCreep.js); the page shows them.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, Loader2, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorNote } from '@/components/staff/shared'
import { Drawer, btn } from '@/components/purchasing/shared'
import { pounds, BandBadge } from '@/components/recipes/shared'
import { perBaseText } from '@shared/costing.js'
import { moveWords, dayWords, CREEP_SOURCES } from '@shared/priceCreep.js'

const DAYS = 90
const DAY = 86400000
const sinceDay = () => new Date(Date.now() - DAYS * DAY).toISOString().slice(0, 10)
const signed = p => (p == null ? '' : (p < 0 ? '-' : '+') + pounds(Math.abs(p)))

export default function CostAlerts({ venueId = '', canManage = false, open = false, alertId = '', onOpen, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const q = venueId ? '?venue_id=' + venueId : ''
  const summary = useQuery({ queryKey: ['cost-alerts', 'summary', venueId], queryFn: () => api.get('/cost-alerts/summary' + q) })
  const seen = useMutation({
    mutationFn: body => api.post('/cost-alerts/seen', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cost-alerts'] }),
  })
  const s = summary.data
  return (
    <>
      {s?.count > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2 flex flex-wrap items-center gap-3" data-testid="cost-alerts-banner">
          <TrendingUp className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-0 text-sm font-medium" data-testid="cost-alerts-words">{s.words}</p>
          <button type="button" className={cn(btn.outline, 'h-12 text-foreground')} onClick={onOpen} data-testid="cost-alerts-open">See them</button>
          {canManage && (
            <button type="button" className={cn(btn.ghost, 'h-12')} disabled={seen.isPending}
              onClick={() => seen.mutate(venueId ? { venue_id: venueId } : {})} data-testid="cost-alerts-seen">
              {seen.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Mark as seen
            </button>
          )}
        </div>
      )}
      <ErrorNote error={seen.error} />
      {open && <AlertList venueId={venueId} canManage={canManage} alertId={alertId} onClose={onClose} oldest={s?.since || ''} unseenCount={s?.count || 0} />}
    </>
  )
}

function AlertList({ venueId, canManage, alertId, onClose, oldest = '', unseenCount = 0 }) {
  const api = useApi()
  const qc = useQueryClient()
  // The last 90 days, or back to the oldest alert nobody has seen (the banner counts those).
  const recent = sinceDay()
  const since = oldest && oldest < recent ? oldest : recent
  const params = new URLSearchParams({ since, limit: '200', ...(venueId ? { venue_id: venueId } : {}) }).toString()
  const list = useQuery({ queryKey: ['cost-alerts', 'list', params], queryFn: () => api.get('/cost-alerts?' + params) })
  const seen = useMutation({
    mutationFn: body => api.post('/cost-alerts/seen', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cost-alerts'] }),
  })
  const alerts = list.data?.alerts || []
  // Every unseen alert at the venue, as the banner's Mark as seen does, also any beyond the list.
  const unseen = Math.max(alerts.filter(a => !a.seen_at).length, unseenCount)
  const span = since === recent ? 'the last ' + DAYS + ' days' : 'since ' + dayWords(since)
  return (
    <Drawer title="Price creep" subtitle={'Dishes a supplier price change took over their cost target, ' + span} onClose={onClose} wide
      footer={canManage && unseen > 0 ? (
        <button type="button" className={cn(btn.primary, 'h-12 w-full')} disabled={seen.isPending}
          onClick={() => seen.mutate(venueId ? { venue_id: venueId } : {})} data-testid="cost-alerts-seen-all">
          {seen.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Mark {unseen} as seen
        </button>
      ) : null}>
      <div className="p-4 space-y-3" data-testid="cost-alerts-list">
        <ErrorNote error={list.error || seen.error} />
        {list.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !alerts.length ? (
          <p className="text-sm text-muted-foreground">No dish crossed its cost target after a price change in the last {DAYS} days.</p>
        ) : alerts.map(a => <AlertCard key={a.id} a={a} prices={list.data?.sees_prices} marked={a.id === alertId} />)}
      </div>
    </Drawer>
  )
}

function AlertCard({ a, prices, marked }) {
  const causes = Array.isArray(a.causes) ? a.causes : []
  return (
    <section className={cn('rounded-xl border bg-background p-3 space-y-2', !a.seen_at && 'border-amber-300', marked && 'ring-2 ring-primary')} data-testid="cost-alert">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex-1 min-w-0">{a.name}</h3>
        <span className="text-xs text-muted-foreground">{dayWords(a.day)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {[a.venue, a.menu, a.order_type].filter(Boolean).join(' · ')}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <BandBadge band={a.old_band} pct={a.old_cost_pct} />
        <span aria-hidden="true">to</span>
        <BandBadge band={a.new_band} pct={a.new_cost_pct} />
        <span className="text-xs text-muted-foreground">crossed {Number(a.threshold_pct)}% ({a.new_band === 'over' ? 'the limit' : 'the target'})</span>
      </div>
      {causes.length > 0 ? (
        <ul className="text-sm space-y-1">
          {causes.map(c => (
            <li key={c.item_id || c.name} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{moveWords(c)}</span>
              <span className="text-muted-foreground tabular-nums">
                {(c.before == null ? 'no price' : perBaseText(c.before, c.base_unit)) + ' to ' + (c.after == null ? 'no price' : perBaseText(c.after, c.base_unit))}
                {c.effect != null && ', ' + signed(c.effect) + ' a serving'}
                {prices && c.quote_after?.supplier ? ' (' + [c.quote_after.supplier, c.quote_after.pack].filter(Boolean).join(', ') + ')' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm">{a.cause}</p>}
      <p className="text-xs text-muted-foreground">
        {CREEP_SOURCES[a.source] || 'A price change'}{a.changed_by ? ' by ' + a.changed_by : ''}
        {a.seen_at ? ' · seen by ' + (a.seen_by || 'someone') : ' · not seen yet'}
      </p>
    </section>
  )
}
