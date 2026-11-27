// src/components/stock/Transfers.jsx
//
// The Stock page's Transfers tab (inventory phase 4b, docs/INVENTORY.md 6.4):
// stock sent between the group's venues in two steps. Send (Stock use at this
// venue): another venue, the items in their own units, a note. What is on its
// way here, to receive (Stock use): each line's quantity as it arrived, which
// can differ from what was sent (what didn't arrive stays as lost in transit).
// What this venue sent that is still on its way, with Cancel (asked twice:
// the stock comes back here). The history: received and cancelled ones, what
// was lost, and with Costing view the value at the sender's average. The
// opened transfer is in the address (?transfer=), so Today's card opens it.
//
//   Transfers({ venueId, transferId, onOpenTransfer })
//   API GET/POST /api/stock/venues/:id/transfers, GET /api/stock/transfers/:id,
//       POST /api/stock/transfers/:id/receive | /cancel

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Plus, Search, Truck, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, useVenues } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useStockList, matchItem, qty, when, pounds, TransferStatus } from '@/components/stock/shared'

function useTransfers(venueId) {
  const api = useApi()
  return useQuery({ queryKey: ['stock', venueId, 'transfers'], queryFn: () => api.get(`/stock/venues/${venueId}/transfers`), enabled: !!venueId })
}

/** Send stock to another venue: the items in their own units. */
function SendTransfer({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: venues = [] } = useVenues()
  const { data } = useStockList(venueId)
  const items = useMemo(() => data?.items || [], [data])
  const others = venues.filter(v => v.id !== venueId)
  const [to, setTo] = useState('')
  const [lines, setLines] = useState([])
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const toId = to || others[0]?.id || ''
  const found = search.trim() ? items.filter(i => !lines.some(l => l.item_id === i.item_id) && matchItem(i, search)).slice(0, 8) : []
  const send = useMutation({
    mutationFn: () => api.post(`/stock/venues/${venueId}/transfers`, {
      to_venue_id: toId, lines: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty), unit: l.unit })), note: note.trim() || null,
    }),
    onSuccess: () => { setLines([]); setNote(''); setSearch(''); qc.invalidateQueries({ queryKey: ['stock'] }) },
  })
  const ready = toId && lines.length && lines.every(l => l.qty > 0)
  if (!others.length) return <p className="text-sm text-muted-foreground">The group has one venue: there is nowhere to send stock.</p>
  return (
    <div className="space-y-3" data-testid="transfer-send">
      <Field label="To">
        <select value={toId} onChange={e => setTo(e.target.value)} className={cn(inputCls, 'h-12 w-64 max-w-full')} data-testid="transfer-to">
          {others.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      {lines.length > 0 && (
        <div className="rounded-lg border divide-y" data-testid="transfer-lines">
          {lines.map((l, n) => {
            const item = items.find(i => i.item_id === l.item_id)
            return (
              <div key={l.item_id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="transfer-line" data-item={item?.name}>
                <span className="flex-1 min-w-[8rem] text-sm font-medium">{item?.name}
                  <span className="block text-xs text-muted-foreground font-normal">on hand {qty(item?.on_hand, item?.base_unit)}</span>
                </span>
                <NumInput value={l.qty} onChange={v => setLines(x => x.map((y, i) => (i === n ? { ...y, qty: v } : y)))} className="w-24 h-12 text-base" aria-label={'How much ' + item?.name} data-testid="transfer-qty" />
                <select value={l.unit} onChange={e => setLines(x => x.map((y, i) => (i === n ? { ...y, unit: e.target.value } : y)))} aria-label="Unit"
                  className="h-12 min-w-[6rem] max-w-[12rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
                  {(item?.units || []).map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                </select>
                <button type="button" onClick={() => setLines(x => x.filter((_, i) => i !== n))} aria-label={'Take ' + item?.name + ' off'}
                  className="w-12 h-12 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
              </div>
            )
          })}
        </div>
      )}
      <Field label="Add an item">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code or barcode" className={cn(inputCls, 'pl-9 h-12')} data-testid="transfer-search" />
        </div>
        {found.length > 0 && (
          <div className="mt-1 rounded-lg border divide-y bg-background">
            {found.map(i => (
              <button key={i.item_id} type="button" onClick={() => { setLines(x => [...x, { item_id: i.item_id, qty: null, unit: i.default_unit }]); setSearch('') }} data-testid="transfer-add"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted min-h-[48px] touch-manipulation flex items-center gap-2">
                <Plus className="w-4 h-4" />{i.name} <span className="text-xs text-muted-foreground">on hand {qty(i.on_hand, i.base_unit)}</span>
              </button>
            ))}
          </div>
        )}
      </Field>
      <Field label="Note (optional)">
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={cn(inputCls, 'h-12')} placeholder="For the weekend" />
      </Field>
      <button type="button" className={btn.primary + ' h-12'} disabled={!ready || send.isPending} onClick={() => send.mutate()} data-testid="transfer-send-save">
        {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}Send {lines.length ? lines.length + ' item' + (lines.length === 1 ? '' : 's') : ''}
      </button>
      <ErrorNote error={send.error} />
    </div>
  )
}

/** A transfer on its way here: what arrived of each line, in the item's own units. */
function Receive({ transfer, onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: t, isLoading, error } = useQuery({ queryKey: ['stock', 'transfer', transfer.id], queryFn: () => api.get('/stock/transfers/' + transfer.id) })
  const [got, setGot] = useState({})
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!t) return
    // As sent, in the unit it was sent in (else the item's usual unit) until someone says otherwise.
    setGot(Object.fromEntries(t.lines.map(l => {
      const u = (l.units || []).find(x => x.label === l.unit || x.key === l.unit)
      return [l.id, u ? { qty: l.qty, unit: u.key } : { qty: l.qty_base, unit: l.base_unit }]
    })))
  }, [t])
  const receive = useMutation({
    mutationFn: () => api.post(`/stock/transfers/${t.id}/receive`, {
      lines: t.lines.map(l => ({ line_id: l.id, qty: Number(got[l.id]?.qty ?? 0), unit: got[l.id]?.unit })), note: note.trim() || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock'] }); onDone?.() },
  })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />
  if (error) return <ErrorNote error={error} />
  return (
    <div className="space-y-2" data-testid="transfer-receive">
      {t.lines.map(l => {
        const g = got[l.id] || {}
        const unit = (l.units || []).find(u => u.key === g.unit)
        const base = unit && g.qty != null ? Number(g.qty) * unit.base_qty : null
        const short = base != null && base < l.qty_base
        return (
          <div key={l.id} className="flex flex-wrap items-center gap-2" data-testid="transfer-receive-line" data-item={l.name}>
            <span className="flex-1 min-w-[10rem] text-sm">
              <span className="font-medium">{l.name}</span>
              <span className="block text-xs text-muted-foreground">sent {l.qty} {l.unit} = {qty(l.qty_base, l.base_unit)}</span>
              {short && <span className="block text-xs text-amber-800" data-testid="transfer-short">{qty(l.qty_base - base, l.base_unit)} short: kept as lost in transit</span>}
            </span>
            <NumInput value={g.qty ?? null} onChange={v => setGot(x => ({ ...x, [l.id]: { ...g, qty: v } }))} className="w-24 h-12 text-base" aria-label={'Arrived of ' + l.name} data-testid="transfer-receive-qty" />
            <select value={g.unit || ''} onChange={e => setGot(x => ({ ...x, [l.id]: { ...g, unit: e.target.value } }))} aria-label="Unit"
              className="h-12 min-w-[6rem] max-w-[12rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
              {(l.units || []).map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
          </div>
        )
      })}
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="A note (optional): one tray short" className={cn(inputCls, 'h-12')} />
      <button type="button" className={btn.primary + ' h-12'} disabled={receive.isPending || t.lines.some(l => got[l.id]?.qty == null)} onClick={() => receive.mutate()} data-testid="transfer-receive-save">
        {receive.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Receive it
      </button>
      <ErrorNote error={receive.error} />
    </div>
  )
}

/** One transfer as a card: where from and to, its lines, what the person may do. */
function TransferCard({ t, values, open, onOpen, venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const cancel = useMutation({ mutationFn: () => api.post(`/stock/transfers/${t.id}/cancel`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }) })
  const incoming = t.to_venue_id === venueId
  return (
    <div className={cn('px-4 py-3 space-y-2', open && 'bg-muted/30')} data-testid="transfer-row" data-status={t.status} data-direction={incoming ? 'in' : 'out'}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t.label}</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">{t.from_name}<ArrowRight className="w-3.5 h-3.5" />{t.to_name}</span>
        <TransferStatus status={t.status} />
        {t.lost && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900" data-testid="transfer-lost">Lost in transit</span>}
        <span className="flex-1" />
        {values && t.value != null && <span className="tabular-nums">{pounds(t.value)}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Sent {when(t.sent_at)}{t.sent_by ? ' by ' + t.sent_by : ''}
        {t.received_at ? ' · received ' + when(t.received_at) + (t.received_by ? ' by ' + t.received_by : '') : ''}
        {t.cancelled_at ? ' · cancelled ' + when(t.cancelled_at) + (t.cancelled_by ? ' by ' + t.cancelled_by : '') : ''}
        {t.note ? ' · ' + t.note : ''}{t.receive_note ? ' · ' + t.receive_note : ''}
      </p>
      {!open && (
        <p className="text-xs text-muted-foreground" data-testid="transfer-row-lines">
          {t.lines.map(l => l.name + ' ' + qty(l.qty_base, l.base_unit) + (l.lost_base ? ' (' + qty(l.lost_base, l.base_unit) + ' lost' + (values && l.lost_value != null ? ', ' + pounds(l.lost_value) : '') + ')' : '')).join(', ')}
        </p>
      )}
      {t.can_receive && (open ? <Receive transfer={t} onDone={() => onOpen(null)} /> : (
        <button type="button" className={btn.primary} onClick={() => onOpen(t.id)} data-testid="transfer-open-receive">Receive</button>
      ))}
      {t.can_cancel && (asking ? (
        <span className="inline-flex gap-1">
          <button type="button" className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs touch-manipulation" onClick={() => { setAsking(false); cancel.mutate() }} data-testid="transfer-cancel-yes">Yes, cancel it: the stock comes back here</button>
          <button type="button" className={btn.outline} onClick={() => setAsking(false)}>Keep it</button>
        </span>
      ) : (
        <button type="button" className={btn.ghost} onClick={() => setAsking(true)} data-testid="transfer-cancel">Cancel the transfer</button>
      ))}
      <ErrorNote error={cancel.error} />
    </div>
  )
}

export default function Transfers({ venueId, transferId, onOpenTransfer }) {
  const { data, isLoading, error } = useTransfers(venueId)
  const values = !!data?.sees_values
  const section = (title, list, empty, testid) => (
    <Card title={title} bodyClass="p-0">
      <div className="divide-y" data-testid={testid}>
        {list.map(t => <TransferCard key={t.id} t={t} values={values} venueId={venueId} open={transferId === t.id} onOpen={onOpenTransfer} />)}
        {!list.length && <p className="p-4 text-sm text-muted-foreground">{empty}</p>}
      </div>
    </Card>
  )
  if (isLoading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  return (
    <div className="space-y-4" data-testid="stock-transfers">
      <ErrorNote error={error} />
      {section('On its way here', data.incoming, 'Nothing is on its way here.', 'transfers-incoming')}
      {data.can_send ? <Card title="Send stock"><SendTransfer venueId={venueId} /></Card> : <ReadOnlyNotice what="transfers" />}
      {section('Sent from here, on its way', data.outgoing, 'Nothing sent from here is on its way.', 'transfers-outgoing')}
      {section('History', data.history, 'No transfers yet.', 'transfers-history')}
    </div>
  )
}
