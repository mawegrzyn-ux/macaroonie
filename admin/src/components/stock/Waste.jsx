// src/components/stock/Waste.jsx
//
// The Stock page's Waste tab (inventory phase 4b, docs/INVENTORY.md 6.3):
// logging waste (WasteForm, Stock use), a trading day's waste with the till's
// voids marked wasted among it (read only: the till is their record, and they
// are never entered again), each with what it took off stock, its reason and
// WRAP kind, who and when, its photo and, with Costing view, its value; the
// day's waste by kind; the last seven days by reason, kind, item or person.
// An entry is undone on its trading day by whoever logged it (or Stock
// manage); after that day Stock manage reverses it, a new entry dated with it
// (each asked twice). WasteList is the phone's list too.
//
//   Waste({ venueId, askedDay, picked })   askedDay: a trading day to open on (?date=: a report's
//   row), picked: the entry it picks out (?waste=)
//   API GET /api/stock/venues/:id/waste?day=, /waste/summary, POST /api/stock/waste/:id/undo | /reverse

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Undo2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorNote, Segmented, addDay } from '@/components/staff/shared'
import { Card, DateButton, btn } from '@/components/purchasing/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useStockMeta, qty, when, pounds, KindBadge } from '@/components/stock/shared'
import WasteForm from '@/components/stock/WasteForm'

export function useWasteDay(venueId, day) {
  const api = useApi()
  return useQuery({
    queryKey: ['stock', venueId, 'waste', day || 'today'],
    queryFn: () => api.get(`/stock/venues/${venueId}/waste` + (day ? '?day=' + day : '')),
    enabled: !!venueId,
  })
}

const amount = e => (e.what === 'item' ? e.qty + ' ' + e.unit : e.what === 'recipe' ? e.qty + ' ' + e.unit + ' of the batch' : e.qty + ' x')

/** One entry: what, how much, why; what it took off; undo or reverse (asked twice) where the person may. */
function WasteRow({ e, values, onUndo, onReverse, busy, picked }) {
  const [asking, setAsking] = useState(null)
  const ref = useRef(null)
  // The entry a report's row opened: picked out, and scrolled to once.
  useEffect(() => { if (picked) ref.current?.scrollIntoView?.({ block: 'center' }) }, [picked])
  const off = e.undone_at
  return (
    <div className={cn('px-4 py-3 text-sm space-y-1', off && 'opacity-60', picked && 'bg-muted/40')} data-testid="waste-row" data-kind={e.kind} data-name={e.name}
      data-picked={picked ? 'yes' : undefined} ref={ref}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('font-medium flex-1 min-w-[10rem]', off && 'line-through')}>
          {e.what === 'dish' ? amount(e) + ' ' + e.name : e.name + ', ' + amount(e)}
        </span>
        {e.kind === 'till_void' && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium" data-testid="waste-till-void">Till void{e.check_number ? ' · check ' + e.check_number : ''}</span>}
        {e.reverses_id && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">Reversal</span>}
        {e.reversed && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">Reversed</span>}
        {off && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium" data-testid="waste-undone">Undone</span>}
        <KindBadge kind={e.reason_kind} />
        {values && <span className="tabular-nums w-16 text-right">{e.value == null ? '–' : pounds(e.value)}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {e.reason}{e.note ? ' · ' + e.note : ''} · {when(e.at)}{e.by ? ' · ' + e.by : ''}{off ? ' · undone' + (e.undone_by ? ' by ' + e.undone_by : '') : ''}
      </p>
      {e.items.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="waste-items">
          {e.what === 'item' ? '' : 'Took off: '}{e.what === 'item' ? '' : e.items.map(i => i.name + ' ' + qty(Math.abs(i.qty_base), i.base_unit)).join(', ')}
        </p>
      )}
      {e.gaps.map(g => <p key={g} className="text-xs text-amber-800" data-testid="waste-row-gap">{g}</p>)}
      {values && e.unvalued > 0 && e.value != null && (
        <p className="text-xs text-muted-foreground" data-testid="waste-row-partial">
          The value leaves out {e.unvalued === 1 ? 'an item' : e.unvalued + ' items'} with no price paid at this venue yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {e.photo_url && (
          <a href={e.photo_url} target="_blank" rel="noreferrer" className={btn.ghost} data-testid="waste-row-photo"><ImageIcon className="w-4 h-4" />Photo</a>
        )}
        {(e.can_undo || e.can_reverse) && (asking ? (
          <span className="inline-flex gap-1">
            <button type="button" className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs touch-manipulation" disabled={busy}
              onClick={() => { setAsking(null); (asking === 'undo' ? onUndo : onReverse)(e.id) }} data-testid="waste-confirm">
              {asking === 'undo' ? 'Yes, undo it' : 'Yes, reverse it'}
            </button>
            <button type="button" className={btn.outline} onClick={() => setAsking(null)}>Keep</button>
          </span>
        ) : (
          <button type="button" className={btn.ghost} onClick={() => setAsking(e.can_undo ? 'undo' : 'reverse')} data-testid={e.can_undo ? 'waste-undo' : 'waste-reverse'}>
            <Undo2 className="w-4 h-4" />{e.can_undo ? 'Undo' : 'Reverse'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A day's entries, newest first, with undo and reverse. */
export function WasteList({ venueId, data, phone = false, picked = null }) {
  const api = useApi()
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['stock', venueId] })
  const undo = useMutation({ mutationFn: id => api.post(`/stock/waste/${id}/undo`, {}), onSuccess: done })
  const reverse = useMutation({ mutationFn: id => api.post(`/stock/waste/${id}/reverse`, {}), onSuccess: done })
  const entries = data?.entries || []
  return (
    <div className="divide-y" data-testid="waste-rows">
      <ErrorNote error={undo.error || reverse.error} />
      {entries.map(e => (
        <WasteRow key={e.kind + e.id} e={e} values={!!data?.sees_values} busy={undo.isPending || reverse.isPending} picked={picked === e.id}
          onUndo={id => undo.mutate(id)} onReverse={id => reverse.mutate(id)} />
      ))}
      {!entries.length && <p className="p-4 text-sm text-muted-foreground">{phone ? 'Nothing wasted here today yet.' : 'No waste on this day.'}</p>}
    </div>
  )
}

const BY = [
  { value: 'reason', label: 'Reason' }, { value: 'kind', label: 'Kind' }, { value: 'item', label: 'Item' }, { value: 'person', label: 'Person' },
]

/** The last seven days added up. */
function WeekSummary({ venueId, to }) {
  const api = useApi()
  const [by, setBy] = useState('reason')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', venueId, 'waste-summary', by, to || ''],
    queryFn: () => api.get(`/stock/venues/${venueId}/waste/summary?by=${by}` + (to ? '&to=' + to : '')),
    enabled: !!venueId,
  })
  return (
    <Card title="The last seven days" actions={<Segmented value={by} onChange={setBy} options={BY} testid="waste-summary-by" />}>
      <div data-testid="waste-summary">
        <ErrorNote error={error} />
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : data && (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {data.from} to {data.to}: {data.entries} entr{data.entries === 1 ? 'y' : 'ies'}{data.till_voids ? ', ' + data.till_voids + ' of them till voids' : ''}
              {data.value != null ? ', worth ' + pounds(data.value) : ''}
            </p>
            <div className="divide-y rounded-lg border">
              {data.rows.map(r => (
                <div key={r.key} className="flex items-center gap-2 px-3 py-2 text-sm min-h-[44px]" data-testid="waste-summary-row">
                  <span className="flex-1 min-w-0 truncate">{by === 'kind' ? <KindBadge kind={r.key} /> : r.label}</span>
                  <span className="text-xs text-muted-foreground">{r.entries} x{r.qty != null && by === 'item' ? ' · ' + qty(r.qty, r.unit) : ''}</span>
                  {data.value != null && <span className="tabular-nums w-16 text-right">{r.value == null ? '–' : pounds(r.value)}</span>}
                </div>
              ))}
              {!data.rows.length && <p className="p-3 text-sm text-muted-foreground">Nothing wasted in these days.</p>}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

export default function Waste({ venueId, askedDay = null, picked = null }) {
  const meta = useStockMeta()
  const ok = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null)
  const [day, setDay] = useState(ok(askedDay))
  useEffect(() => { if (ok(askedDay)) setDay(askedDay) }, [askedDay])
  const { data, isLoading, error } = useWasteDay(venueId, day)
  const shown = day || data?.today
  const canLog = !!meta.data?.can_count
  return (
    <div className="space-y-4" data-testid="stock-waste">
      {/* A shared device logs waste only at its own venue (the API's venue_problem). */}
      {data?.venue_problem ? <p className="rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground" data-testid="waste-venue-problem">{data.venue_problem}</p> : canLog ? (
        <Card title="Log waste">
          <WasteForm venueId={venueId} />
        </Card>
      ) : meta.data && <ReadOnlyNotice what="waste" />}
      <Card title="Waste by day" bodyClass="p-0" actions={(
        <span className="flex items-center gap-1">
          <button type="button" className={cn(btn.ghost, 'w-11 px-0')} aria-label="The day before" onClick={() => shown && setDay(addDay(shown, -1))}><ChevronLeft className="w-4 h-4" /></button>
          <DateButton value={shown} max={data?.today} onChange={setDay} label="Trading day" />
          <button type="button" className={cn(btn.ghost, 'w-11 px-0')} aria-label="The day after" disabled={!shown || shown >= data?.today}
            onClick={() => shown && setDay(addDay(shown, 1))}><ChevronRight className="w-4 h-4" /></button>
        </span>
      )}>
        <ErrorNote error={error} />
        {isLoading ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : data && (
          <>
            {data.by_kind.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 py-3 border-b" data-testid="waste-by-kind">
                {data.by_kind.map(k => (
                  <span key={k.key} className="inline-flex items-center gap-1.5 text-sm"><KindBadge kind={k.key} />{k.entries}{k.value != null ? ' · ' + pounds(k.value) : ''}</span>
                ))}
                {data.value != null && <span className="ml-auto text-sm">Day&apos;s waste <strong>{pounds(data.value)}</strong></span>}
              </div>
            )}
            <WasteList venueId={venueId} data={data} picked={picked} />
            <p className="px-4 py-2 text-xs text-muted-foreground border-t">
              Dishes voided on the till and marked wasted are listed here by themselves: they are already taken off stock, so they are never logged again.
            </p>
          </>
        )}
      </Card>
      <WeekSummary venueId={venueId} to={shown} />
    </div>
  )
}
