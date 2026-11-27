// src/components/stock/Variance.jsx
//
// The Stock page's Variance tab (inventory phase 6a, docs/INVENTORY.md 8.1):
// a venue's period (the one running since its latest full count, to now, or
// one between two full counts, open or closed) with every item's actual
// usage against theoretical (usage from sales), its waste, variance and the
// unexplained part, ranked by pounds of unexplained loss, each with its
// share of food sales, flagged by the group's band; food cost actual and
// theoretical; close and reopen (Stock manage; reopening needs a note);
// tapping an item shows its evidence (explain_variance) and its figures
// between its counts, and lets Stock manage mark it reviewed. By venue: one
// item across the group's venues ("which site loses most on chicken"). Key
// items: what key-item counts give between each pair of counts. Every figure
// is the API's (shared/variance.js); nothing is worked out here.
//
//   Variance({ venueId, askedPeriod, canManage })
//   API GET /api/stock/venues/:id/periods, /variance?period=, /variance/items/:itemId,
//       /variance/key, GET /api/stock/variance/by-venue, POST /api/stock/periods/:id/close,
//       /reopen, /items/:itemId/review

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, Lock, LockOpen } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorNote, Segmented, inputCls } from '@/components/staff/shared'
import { Card, Drawer, btn as baseBtn } from '@/components/purchasing/shared'
import { qty, pounds, dayWords, when } from '@/components/stock/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'

// The tab's buttons and fields at 48 px (design rule 1; the shared ones are 44 px).
const btn = { primary: cn(baseBtn.primary, 'h-12'), outline: cn(baseBtn.outline, 'h-12') }
const fieldCls = cn(inputCls, 'h-12')

const VIEWS = [{ value: 'items', label: 'By item' }, { value: 'venues', label: 'By venue' }, { value: 'key', label: 'Key items' }]
const pct = n => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1) + '%')
const pts = n => (n == null ? '–' : (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toFixed(2) + ' pts')
const signed = (n, unit) => (n == null ? '–' : (n > 0 ? '+' : n < 0 ? '-' : '') + qty(Math.abs(n), unit))
const periodLabel = p => (p.current ? 'Since the last full count (' + dayWords(p.from_at) + ' to now)' : p.words + (p.status === 'closed' ? ' · closed' : ' · open'))

function Flag({ row }) {
  if (!row.flagged) return null
  return (
    <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-900" data-testid="variance-flag">
      <AlertTriangle className="w-3 h-3" />{row.flag_why === 'gain' ? 'Over' : 'Flagged'}
    </span>
  )
}

function Reviewed({ row }) {
  if (!row.reviewed) return null
  return <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800" data-testid="variance-reviewed"><CheckCircle2 className="w-3 h-3" />Reviewed</span>
}

/** Close a period (asked first), or reopen it with a note. */
function PeriodActions({ data, venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(null)
  const [note, setNote] = useState('')
  const id = data.period?.id
  const done = () => { setAsking(null); setNote(''); qc.invalidateQueries({ queryKey: ['stock', venueId] }) }
  const close = useMutation({ mutationFn: () => api.post(`/stock/periods/${id}/close`, {}), onSuccess: done })
  const reopen = useMutation({ mutationFn: () => api.post(`/stock/periods/${id}/reopen`, { note }), onSuccess: done })
  useEffect(() => { setAsking(null); setNote('') }, [id])
  if (!data.can_close && !data.can_reopen) return null
  if (asking === 'close') {
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-2" data-testid="variance-close-ask">
        <span className="flex-1 min-w-[14rem]">Close this period? Its figures are frozen as they are now, like a Z, and its days are never worked out again: sales that arrive late count in the next period.</span>
        <button type="button" className={btn.primary} disabled={close.isPending} onClick={() => close.mutate()} data-testid="variance-close-yes">
          {close.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Close it
        </button>
        <button type="button" className={btn.outline} onClick={() => setAsking(null)}>Keep it open</button>
        <ErrorNote error={close.error} />
      </div>
    )
  }
  if (asking === 'reopen') {
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm space-y-2" data-testid="variance-reopen-ask">
        <p>Reopen this period? Its days are worked out again from the sales (late ones in them) and its figures follow the documents again until it is closed. Say why:</p>
        <textarea className={cn(inputCls, 'h-20 py-2')} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="A delivery was booked in late" data-testid="variance-reopen-note" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} disabled={note.trim().length < 3 || reopen.isPending} onClick={() => reopen.mutate()} data-testid="variance-reopen-yes">
            {reopen.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Reopen it
          </button>
          <button type="button" className={btn.outline} onClick={() => setAsking(null)}>Keep it closed</button>
        </div>
        <ErrorNote error={reopen.error} />
      </div>
    )
  }
  return data.can_close ? (
    <button type="button" className={btn.outline} onClick={() => setAsking('close')} data-testid="variance-close"><Lock className="w-4 h-4" />Close the period</button>
  ) : (
    <button type="button" className={btn.outline} onClick={() => setAsking('reopen')} data-testid="variance-reopen"><LockOpen className="w-4 h-4" />Reopen</button>
  )
}

function FoodCost({ data }) {
  const fc = data.food_cost
  if (!fc) {
    return <p className="text-sm text-muted-foreground" data-testid="variance-food-cost-hidden">Food cost % needs Costing view and Till reports view.</p>
  }
  const tile = (label, value, sub, testid) => (
    <div className="rounded-lg border bg-background px-3 py-2 min-w-[9rem]" data-testid={testid}>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="block text-lg font-semibold tabular-nums">{value}</span>
      {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
  // Actual food cost only once every item sales used has an actual: until then it would be a few items against all of them.
  const partial = fc.complete === false
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" data-testid="variance-food-cost">
        {tile('Actual food cost', pct(fc.actual_pct), partial ? 'not known yet' : fc.actual_value != null ? pounds(fc.actual_value) + ' used' : null, 'variance-actual-pct')}
        {tile('Theoretical', pct(fc.theoretical_pct), fc.theoretical_value != null ? pounds(fc.theoretical_value) + ' by recipes' : null, 'variance-theoretical-pct')}
        {tile('Gap', pts(fc.gap_pts), null, 'variance-gap')}
        {tile('Net food sales', fc.net_food_pence == null ? '–' : pounds(fc.net_food_pence / 100), data.late_food_pence ? pounds(data.late_food_pence / 100) + ' of it late' : null, 'variance-net')}
        {data.band?.unexplained_pct != null && tile('Unexplained', pts(data.band.unexplained_pct), data.band.over ? 'over the ' + data.band.band_pct + ' point band' : 'inside the ' + data.band.band_pct + ' point band', 'variance-band')}
      </div>
      {partial && (
        <p className="text-xs text-muted-foreground" data-testid="variance-food-cost-partial">
          Actual food cost and the gap need every item sales used counted at both ends: {fc.uncounted_used === 1 ? '1 item isn\'t' : fc.uncounted_used + ' items aren\'t'} yet.
          {data.period?.current ? ' They show once the next full count is approved.' : ' Count every item sales use in the full counts, so the next period has them.'}
        </p>
      )}
    </div>
  )
}

/** The items of a period, biggest unexplained loss first. */
function ItemList({ data, onOpen }) {
  const values = data.rows.some(r => 'unexplained_value' in r)
  const [only, setOnly] = useState(false)
  const rows = only ? data.rows.filter(r => r.flagged) : data.rows
  return (
    <div className="bg-background border rounded-xl overflow-hidden" data-testid="variance-items">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 section-head text-xs font-semibold">
        <span className="flex-1">Item</span>
        <button type="button" className="h-12 px-3 rounded-lg border bg-background text-xs touch-manipulation" onClick={() => setOnly(!only)} data-testid="variance-only-flagged">
          {only ? 'Show every item' : 'Only flagged (' + data.flagged + ')'}
        </button>
      </div>
      <div className="divide-y">
        {rows.map(r => (
          <button key={r.item_id} type="button" onClick={() => onOpen(r)} className="w-full text-left px-4 py-3 text-sm hover:bg-muted/40 touch-manipulation min-h-[48px]"
            data-testid="variance-item" data-item={r.name} data-flagged={r.flagged ? 'yes' : 'no'}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium flex-1 min-w-[9rem]">{r.name}</span>
              <Flag row={r} /><Reviewed row={r} />
              {r.late ? <span className="text-[11px] text-violet-800" data-testid="variance-late">late sales in it</span> : null}
              <span className="tabular-nums font-medium" data-testid="variance-unexplained">
                {r.unexplained == null ? 'not counted' : signed(r.unexplained, r.base_unit) + (values && r.unexplained_value != null ? ' · ' + pounds(r.unexplained_value) : '')}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Used {qty(r.actual, r.base_unit)} · sales took {qty(r.theoretical, r.base_unit)} · waste {qty(r.waste, r.base_unit)}
              {r.adjusted ? ' · adjusted ' + signed(r.adjusted, r.base_unit) : ''}
              {r.share_pct != null ? ' · ' + pts(r.share_pct) + ' of food sales' : ''}
            </span>
          </button>
        ))}
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">{only ? 'Nothing is flagged in this period.' : 'No stock moved in this period.'}</p>}
      </div>
    </div>
  )
}

/** One item: its figures, the evidence for its variance, its figures between counts, the reviewed flag. */
function ItemDrawer({ venueId, periodId, row, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const q = periodId ? '?period=' + periodId : '?period=current'
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', venueId, 'variance-item', row.item_id, periodId || 'current'],
    queryFn: () => api.get(`/stock/venues/${venueId}/variance/items/${row.item_id}${q}`),
  })
  const [note, setNote] = useState('')
  // Taking a review back deletes it and its note: asked first (design rule 6).
  const [undoAsk, setUndoAsk] = useState(false)
  const review = useMutation({
    mutationFn: reviewed => api.post(`/stock/periods/${periodId}/items/${row.item_id}/review`, { reviewed, note: note.trim() || null }),
    onSuccess: () => { setUndoAsk(false); qc.invalidateQueries({ queryKey: ['stock', venueId] }) },
  })
  const r = data?.row || row
  const u = r.base_unit
  const line = (label, value, testid) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm" data-testid={testid}><span className="text-muted-foreground">{label}</span><span className="tabular-nums font-medium">{value}</span></div>
  )
  const reviewed = review.data ? review.data.reviewed : r.reviewed
  // Where each piece is put right: the Stock page at this venue (an item's history when no tab), else the page as it is.
  const link = page => {
    if (!page || !page.startsWith('/stock')) return page
    return page + (page.includes('?') ? '&' : '?') + 'venue=' + venueId + (page.includes('tab=') ? '' : '&item=' + row.item_id)
  }
  return (
    <Drawer title={row.name} subtitle="Variance in the period" onClose={onClose} wide>
      <ErrorNote error={error} />
      <Card title="The figures" bodyClass="divide-y">
        {line('Opening', qty(r.opening, u), 'variance-opening')}
        {line('Received', qty(r.received, u))}
        {line('Transfers in', qty(r.transfers_in, u))}
        {line('Transfers out (lost in transit too)', qty(r.transfers_out, u))}
        {line('Closing', r.closing == null ? 'not counted' : qty(r.closing, u))}
        {line('Actual usage', qty(r.actual, u), 'variance-actual')}
        {line('Theoretical (sales by their recipes)' + (r.late ? ', late sales ' + qty(r.late, u) : ''), qty(r.theoretical, u), 'variance-theoretical')}
        {line('Waste', qty(r.waste, u))}
        {r.adjusted ? line('Adjusted', signed(r.adjusted, u)) : null}
        {line('Variance', signed(r.variance, u) + (r.variance_value != null ? ' · ' + pounds(r.variance_value) : ''))}
        {line('Unexplained', signed(r.unexplained, u) + (r.unexplained_value != null ? ' · ' + pounds(r.unexplained_value) : ''), 'variance-item-unexplained')}
      </Card>
      <Card title="Why it may be" bodyClass="space-y-3">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (data?.evidence || []).map(e => (
          <div key={e.kind} className="text-sm space-y-0.5" data-testid="variance-evidence" data-kind={e.kind}>
            <p className="font-medium">{e.label}</p>
            <p>{e.text}</p>
            <p className="text-xs text-muted-foreground">{e.fix}</p>
            {e.page && <Link to={link(e.page)} className="text-xs text-primary underline underline-offset-2 inline-flex items-center min-h-[48px] touch-manipulation">Open it</Link>}
          </div>
        ))}
        {data && !data.evidence.length && <p className="text-sm text-muted-foreground">Nothing in the documents points at a cause: count it again, or look at how its dishes are made.</p>}
      </Card>
      {data?.intervals?.length > 0 && (
        <Card title="Between its counts" bodyClass="p-0">
          <div className="divide-y" data-testid="variance-intervals">
            {data.intervals.map(i => (
              <div key={i.from} className="flex flex-wrap gap-2 px-4 py-2.5 text-sm">
                <span className="flex-1 min-w-[10rem]">{when(i.from)} to {when(i.to)}</span>
                <span className="tabular-nums">{signed(i.unexplained, u)}{i.unexplained_value != null ? ' · ' + pounds(i.unexplained_value) : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {data?.can_review && (
        <Card title="Reviewed" bodyClass="space-y-2">
          {reviewed ? (
            <>
              <p className="text-sm" data-testid="variance-reviewed-by">Reviewed by {reviewed.by} {when(reviewed.at)}{reviewed.note ? ': ' + reviewed.note : ''}</p>
              {undoAsk ? (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-2" data-testid="variance-unreview-ask">
                  <span className="flex-1 min-w-[12rem]">Take the review back? {reviewed.note ? 'Its note goes too, and the' : 'The'} item shows as flagged and not reviewed again.</span>
                  <button type="button" className={btn.primary} disabled={review.isPending} onClick={() => review.mutate(false)} data-testid="variance-unreview-yes">
                    {review.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Take it back
                  </button>
                  <button type="button" className={btn.outline} onClick={() => setUndoAsk(false)}>Keep the review</button>
                </div>
              ) : (
                <button type="button" className={btn.outline} disabled={review.isPending} onClick={() => setUndoAsk(true)} data-testid="variance-unreview">Not reviewed after all</button>
              )}
            </>
          ) : (
            <>
              <input className={fieldCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="What you found (optional)" data-testid="variance-review-note" />
              <button type="button" className={btn.primary} disabled={review.isPending} onClick={() => review.mutate(true)} data-testid="variance-review">
                {review.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Mark as reviewed
              </button>
            </>
          )}
          <ErrorNote error={review.error} />
        </Card>
      )}
    </Drawer>
  )
}

/** One item at every venue: its latest period at each, or the one running since its last full count. */
function ByVenue({ items, sees }) {
  const api = useApi()
  const [itemId, setItemId] = useState(items[0]?.item_id || '')
  const [which, setWhich] = useState('latest')
  useEffect(() => { if (!itemId && items[0]) setItemId(items[0].item_id) }, [items])
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', 'variance-by-venue', itemId, which],
    queryFn: () => api.get(`/stock/variance/by-venue?item=${itemId}&which=${which}`),
    enabled: !!itemId,
  })
  return (
    <div className="space-y-3" data-testid="variance-by-venue">
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(fieldCls, 'w-auto min-w-[12rem]')} value={itemId} onChange={e => setItemId(e.target.value)} aria-label="Item" data-testid="variance-by-venue-item">
          {items.map(i => <option key={i.item_id} value={i.item_id}>{i.name}</option>)}
        </select>
        <Segmented value={which} onChange={setWhich} options={[{ value: 'latest', label: 'Latest period' }, { value: 'current', label: 'Since the last full count' }]} />
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : data && (
        <div className="bg-background border rounded-xl divide-y overflow-hidden">
          {data.venues.map(v => (
            <div key={v.venue_id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm" data-testid="variance-venue" data-venue={v.venue}>
              <span className="font-medium flex-1 min-w-[8rem]">{v.venue}</span>
              {v.row && <Flag row={v.row} />}
              <span className="text-xs text-muted-foreground">{v.period ? periodLabel(v.period) : 'No full count yet'}</span>
              <span className="tabular-nums font-medium w-full sm:w-auto text-right">
                {!v.row ? '–' : v.row.unexplained == null ? 'not counted' : signed(v.row.unexplained, data.item.base_unit) + (sees && v.row.unexplained_value != null ? ' · ' + pounds(v.row.unexplained_value) : '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Key items between their counts (the last two weeks). */
function KeyItems({ venueId }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['stock', venueId, 'variance-key'], queryFn: () => api.get(`/stock/venues/${venueId}/variance/key`) })
  return (
    <div className="space-y-3" data-testid="variance-key">
      <p className="text-sm text-muted-foreground">What each key-item count found against the documents since the count before it, for the last two weeks: counted daily, these are daily figures.</p>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (data?.items || []).map(i => (
        <Card key={i.item_id} title={i.name} bodyClass="p-0">
          <div className="divide-y">
            {i.intervals.map(x => (
              <div key={x.from} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm" data-testid="variance-key-row">
                <span className="flex-1 min-w-[10rem]">{when(x.from)} to {when(x.to)}</span>
                <Flag row={x} />
                <span className="text-xs text-muted-foreground">sales took {qty(x.theoretical, i.base_unit)}</span>
                <span className="tabular-nums font-medium">{signed(x.unexplained, i.base_unit)}{x.unexplained_value != null ? ' · ' + pounds(x.unexplained_value) : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
      {data && !data.items.length && <p className="text-sm text-muted-foreground">No key-item counts were approved here in the last two weeks.</p>}
    </div>
  )
}

export default function Variance({ venueId, askedPeriod = null, canManage }) {
  const api = useApi()
  const [periodId, setPeriodId] = useState(askedPeriod || null)
  const [view, setView] = useState('items')
  const [open, setOpen] = useState(null)
  useEffect(() => { setPeriodId(askedPeriod || null); setOpen(null) }, [venueId, askedPeriod])
  const periods = useQuery({ queryKey: ['stock', venueId, 'periods'], queryFn: () => api.get(`/stock/venues/${venueId}/periods`) })
  const q = periodId ? '?period=' + periodId : ''
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['stock', venueId, 'variance', periodId || 'default'],
    queryFn: () => api.get(`/stock/venues/${venueId}/variance${q}`),
    retry: false,
  })
  const choices = useMemo(() => [
    ...(periods.data?.current ? [{ id: '', label: periodLabel(periods.data.current) }] : []),
    ...(periods.data?.periods || []).map(p => ({ id: p.id, label: periodLabel(p) + (p.unreviewed ? ' · ' + p.unreviewed + ' to review' : '') })),
  ], [periods.data])
  const none = error?.body?.code === 'no_count'
  const p = data?.period
  return (
    <div className="space-y-4" data-testid="stock-variance">
      <Card title="Variance" bodyClass="space-y-3" actions={isFetching && !isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}>
        <p className="flex items-start gap-2 text-sm"><Info className="w-4 h-4 mt-0.5 shrink-0" />
          Actual usage (opening count, plus what came in, less what went out and the closing count) against what sales took by their recipes. Waste and adjustments explain their part; the rest is unexplained.
        </p>
        {choices.length > 0 && (
          <select className={cn(fieldCls, 'w-full sm:w-auto sm:min-w-[22rem]')} value={periodId || (p && !p.current ? p.id : '')} onChange={e => { setPeriodId(e.target.value || null); setOpen(null) }} aria-label="Period" data-testid="variance-period">
            {choices.map(c => <option key={c.id || 'current'} value={c.id}>{c.label}</option>)}
          </select>
        )}
        {p && (
          <p className="text-sm text-muted-foreground" data-testid="variance-period-state">
            {p.current ? 'Running: actual usage shows for the items counted since (a key-item count is enough), the rest once the next full count is approved.'
              : p.status === 'closed' ? 'Closed ' + when(p.closed_at) + (p.closed_by ? ' by ' + p.closed_by : '') + ': these are its figures as they were then.'
                : 'Open: its figures follow the documents until it is closed.'}
            {p.reopen_note ? ' Reopened ' + when(p.reopened_at) + ': ' + p.reopen_note : ''}
          </p>
        )}
        {data && canManage && <PeriodActions data={data} venueId={venueId} />}
        {data && !canManage && <ReadOnlyNotice what="the stock periods" />}
        {!none && <ErrorNote error={error} />}
      </Card>

      {none ? (
        <p className="text-sm text-muted-foreground" data-testid="variance-none">Variance starts at a venue's first approved full count: count everything on the Counts tab, and the period runs from there.</p>
      ) : isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <>
          <Card title="Food cost" bodyClass="space-y-2"><FoodCost data={data} /></Card>
          <div className="overflow-x-auto"><Segmented value={view} onChange={setView} options={VIEWS} testid="variance-view" /></div>
          {view === 'items' && <ItemList data={data} onOpen={setOpen} />}
          {view === 'venues' && <ByVenue items={data.rows} sees={data.sees_values} />}
          {view === 'key' && <KeyItems venueId={venueId} />}
        </>
      )}
      {open && <ItemDrawer venueId={venueId} periodId={p?.current ? null : p?.id} row={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
