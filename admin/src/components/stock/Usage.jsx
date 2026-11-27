// src/components/stock/Usage.jsx
//
// The Stock page's Usage tab (inventory phase 5, docs/INVENTORY.md 7): what
// sales took off stock at the venue over some days (up to 31), by item or by
// day, with how much came from the till, kiosks, online orders and other
// tills; the dishes sold without a full recipe (what took nothing off, or
// not all of it) with why and how to fix each; what was left out (open items,
// services); and, for Stock manage, Recompute (those days worked out again
// from the sales now). The job works the last 14 days out every few minutes:
// the tab says up to when.
//
//   Usage({ venueId })   API GET /api/stock/venues/:id/usage?from=&to=,
//                        POST /api/stock/venues/:id/usage/recompute

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Loader2, RefreshCw } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorNote, Segmented, addDay } from '@/components/staff/shared'
import { Card, DateButton, btn } from '@/components/purchasing/shared'
import { qty, pounds, dayWords, when } from '@/components/stock/shared'
import { SALE_CHANNELS } from '@shared/costing.js'

const CHANNELS = { ...SALE_CHANNELS, gloriafood: 'GloriaFood' }
const CHANNEL_KEYS = ['till', 'kiosk', 'online', 'imported']
const LEFT_OUT = { open: 'Typed in on the till (no dish)', service: 'A service: no recipe needed', gone: 'No longer on a menu' }
const day = d => (d ? dayWords(d + 'T12:00:00Z') : '')

/** Each channel's part of a quantity, in words: "till 4 each, online 1 each". */
function ChannelSplit({ channels, unit }) {
  const parts = Object.entries(channels || {}).filter(([, v]) => Number(v)).sort((a, b) => CHANNEL_KEYS.indexOf(a[0]) - CHANNEL_KEYS.indexOf(b[0]))
  if (!parts.length) return null
  return (
    <span className="text-xs text-muted-foreground" data-testid="usage-channels">
      {parts.map(([k, v]) => (CHANNELS[k] || k) + ' ' + qty(v, unit)).join(', ')}
    </span>
  )
}

export default function Usage({ venueId, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [range, setRange] = useState(null)
  const [view, setView] = useState('items')
  const [asking, setAsking] = useState(false)
  const q = range ? '?from=' + range.from + '&to=' + range.to : ''
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['stock', venueId, 'usage', q],
    queryFn: () => api.get(`/stock/venues/${venueId}/usage${q}`),
    enabled: !!venueId,
  })
  // The days shown start as the API's (the last 7 up to today).
  useEffect(() => { if (data && !range) setRange({ from: data.from, to: data.to }) }, [data])
  useEffect(() => { setRange(null); setAsking(false) }, [venueId])
  const recompute = useMutation({
    mutationFn: () => api.post(`/stock/venues/${venueId}/usage/recompute`, range),
    onSuccess: () => { setAsking(false); qc.invalidateQueries({ queryKey: ['stock', venueId] }) },
  })
  const span = range ? Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1 : 0
  const tooLong = data && span > data.max_days
  const values = !!data?.sees_values
  const byDay = useMemo(() => {
    const m = new Map()
    for (const r of data?.by_day || []) {
      if (!m.has(r.day)) m.set(r.day, [])
      m.get(r.day).push(r)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])
  const marks = useMemo(() => new Map((data?.days || []).map(d => [d.day, d])), [data])
  const set = changes => { setRange(r => ({ ...r, ...changes })); setAsking(false) }

  return (
    <div className="space-y-4" data-testid="stock-usage">
      <Card title="Usage from sales" bodyClass="space-y-3">
        {data?.note && (
          <p className="flex items-start gap-2 text-sm" data-testid="usage-note"><Info className="w-4 h-4 mt-0.5 shrink-0" />{data.note}</p>
        )}
        {data?.last_error && <p className="text-sm text-red-800">The last run here failed: {data.last_error}</p>}
        {data?.dirty_from && <p className="text-sm text-muted-foreground">A recipe or setting changed: the days from {day(data.dirty_from)} are being worked out again.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <DateButton value={range?.from} max={range?.to || data?.today} onChange={v => set({ from: v })} label="From" />
          <span className="text-sm text-muted-foreground">to</span>
          <DateButton value={range?.to} min={range?.from} max={data?.today} onChange={v => set({ to: v })} label="To" />
          {data && (
            <>
              <button type="button" className={btn.outline} onClick={() => set({ from: data.today, to: data.today })}>Today</button>
              <button type="button" className={btn.outline} onClick={() => set({ from: addDay(data.today, -6), to: data.today })}>Last 7 days</button>
            </>
          )}
          {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        {tooLong && <p className="text-sm text-amber-800">Pick up to {data.max_days} days.</p>}
        {canManage && data?.can_recompute && range && !tooLong && (
          asking ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-2" data-testid="usage-recompute-ask">
              <span className="flex-1 min-w-[14rem]">Work out {span === 1 ? day(range.from) : span + ' days, ' + day(range.from) + ' to ' + day(range.to) + ','} again from the sales now? What is kept for {span === 1 ? 'it' : 'them'} is replaced.</span>
              <button type="button" className={btn.primary} disabled={recompute.isPending} onClick={() => recompute.mutate()} data-testid="usage-recompute-yes">
                {recompute.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Recompute
              </button>
              <button type="button" className={btn.outline} onClick={() => setAsking(false)}>Keep</button>
            </div>
          ) : (
            <button type="button" className={btn.outline} onClick={() => setAsking(true)} data-testid="usage-recompute">
              <RefreshCw className="w-4 h-4" />Recompute these days
            </button>
          )
        )}
        {recompute.data && <p className="text-sm text-green-800" data-testid="usage-recomputed">Worked out again: {recompute.data.days} {recompute.data.days === 1 ? 'day' : 'days'}, {recompute.data.lines} lines sold.</p>}
        <ErrorNote error={error || recompute.error} />
      </Card>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={view} onChange={setView} options={[{ value: 'items', label: 'By item' }, { value: 'days', label: 'By day' }]} testid="usage-view" />
            <span className="text-sm text-muted-foreground">
              {(data.days || []).reduce((s, d) => s + d.lines, 0)} lines sold, {(data.days || []).reduce((s, d) => s + d.uncosted_lines, 0)} without a full recipe
            </span>
          </div>
          {view === 'items' ? (
            <div className="bg-background border rounded-xl overflow-hidden" data-testid="usage-items">
              <div className={cn('grid grid-cols-[1fr_auto] gap-2 px-4 py-2 section-head text-xs font-semibold', values && 'sm:grid-cols-[1fr_8rem_6rem]')}>
                <span>Item</span><span className="text-right">Used</span>{values && <span className="text-right hidden sm:block">Value</span>}
              </div>
              <div className="divide-y">
                {data.items.map(i => (
                  <div key={i.item_id} className={cn('grid grid-cols-[1fr_auto] gap-2 px-4 py-3 text-sm', values && 'sm:grid-cols-[1fr_8rem_6rem]')} data-testid="usage-item" data-item={i.name}>
                    <span className="min-w-0"><span className="font-medium block">{i.name}</span><ChannelSplit channels={i.channels} unit={i.base_unit} /></span>
                    <span className="text-right tabular-nums font-medium">{qty(i.qty_base, i.base_unit)}</span>
                    {values && <span className="text-right tabular-nums hidden sm:block">{i.value == null ? '–' : pounds(i.value)}</span>}
                  </div>
                ))}
                {!data.items.length && <p className="p-4 text-sm text-muted-foreground">Nothing was taken off by sales on these days{data.days.length ? '' : ' (not worked out yet)'}.</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3" data-testid="usage-days">
              {byDay.map(([d, rows]) => (
                <Card key={d} title={day(d)} actions={marks.get(d) && <span className="text-xs text-muted-foreground">worked out {when(marks.get(d).computed_at)}</span>} bodyClass="p-0">
                  <div className="divide-y">
                    {rows.map(r => (
                      <div key={r.item_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm" data-testid="usage-day-item">
                        <span className="font-medium flex-1 min-w-[10rem]">{r.name}</span>
                        <ChannelSplit channels={r.channels} unit={r.base_unit} />
                        <span className="tabular-nums font-medium w-24 text-right">{qty(r.qty_base, r.base_unit)}</span>
                        {values && <span className="tabular-nums w-16 text-right">{r.value == null ? '–' : pounds(r.value)}</span>}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
              {!byDay.length && <p className="text-sm text-muted-foreground">Nothing was taken off by sales on these days.</p>}
            </div>
          )}

          <Card title={'Sold without a full recipe' + (data.uncosted.length ? ' (' + data.uncosted.length + ')' : '')} bodyClass="p-0">
            <div className="divide-y" data-testid="usage-uncosted">
              {data.uncosted.map(u => (
                <div key={u.dish_id || u.name} className="px-4 py-3 text-sm space-y-1" data-testid="usage-uncosted-row" data-name={u.name}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium flex-1 min-w-[10rem]">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.channels.map(c => CHANNELS[c] || c).join(', ')}</span>
                    <span className="tabular-nums">{u.uncosted_qty === u.qty ? u.qty + ' sold' : u.uncosted_qty + ' of ' + u.qty + ' sold'}</span>
                  </div>
                  {u.gaps.map(g => (
                    <p key={g.text} className="text-xs"><span className="text-amber-800">{g.text}.</span>{g.fix ? ' ' + g.fix : ''}</p>
                  ))}
                  {u.dish_id && (
                    <Link to={'/recipes?tab=dishes&dish=' + u.dish_id} className="text-xs text-primary underline underline-offset-2 inline-flex items-center min-h-[32px]">Open it on the Recipes page</Link>
                  )}
                </div>
              ))}
              {!data.uncosted.length && <p className="p-4 text-sm text-muted-foreground">Every dish sold on these days took its recipe off stock.</p>}
            </div>
          </Card>

          {data.left_out.length > 0 && (
            <Card title="Left out" bodyClass="p-0">
              <div className="divide-y" data-testid="usage-left-out">
                {data.left_out.map(l => (
                  <div key={l.reason + l.name} className="flex flex-wrap gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium flex-1 min-w-[10rem]">{l.name}</span>
                    <span className="text-xs text-muted-foreground">{LEFT_OUT[l.reason] || l.reason}</span>
                    <span className="tabular-nums">{l.qty} sold</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
