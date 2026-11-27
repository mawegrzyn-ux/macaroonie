// src/components/stock/CountSheet.jsx
//
// One stock count (inventory phase 4a, docs/INVENTORY.md 6.2), on the Stock
// page's Counts tab and on the phone (/mobile/stock-count). While it is
// being counted (draft): its storage areas as tabs (each with how many of
// its items are counted, and Done), the items of the area in shelf order,
// each counted in its own units, several on one line (2 cases + 3 each +
// 400 g), a search that also finds items outside the sheet, and the Office
// app's scanner. Once submitted or approved: CountReview.
//
// Counting is the one place where Save is not a button (Standard Design Rule
// 5 gives way): each line is saved on its own about a second after it is
// typed (PUT /api/stock/counts/:id/lines), and said so on the sheet, so two
// people can count two areas of one count at once; the sheet fetches the
// count again every few seconds to show the others' lines. Expected is
// shown while counting unless the group counts blind.
//
//   CountSheet({ countId, venueId, phone, onClose })

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, Circle, Loader2, ScanLine, Search, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote, Modal } from '@/components/staff/shared'
import { btn } from '@/components/purchasing/shared'
import { canScan, scanBarcode } from '@/lib/officeApp'
import { EntriesEditor, CountStatus, matchItem, qty, when, useStockList, COUNT_KINDS } from '@/components/stock/shared'

const CountReview = lazy(() => import('@/components/stock/CountReview'))
const SAVE_AFTER_MS = 900
const REFRESH_MS = 8000
const keyOf = (itemId, areaId) => itemId + '|' + (areaId || '')

/** Saves each line on its own a moment after it is typed; flushes what is waiting when the sheet closes. */
function useLineSaver(countId) {
  // useApi() is a new object on every render: kept in a ref, so `send` and
  // `save` stay the same functions and the wait before saving isn't cut short.
  const api = useApi()
  const apiRef = useRef(api)
  apiRef.current = api
  const qc = useQueryClient()
  const timers = useRef(new Map())
  const waiting = useRef(new Map())
  const [state, setState] = useState({})
  const send = useCallback(async (k, body) => {
    waiting.current.delete(k)
    setState(s => ({ ...s, [k]: 'saving' }))
    try {
      const out = await apiRef.current.put(`/stock/counts/${countId}/lines`, body)
      qc.setQueryData(['stock', 'count', countId], c => {
        if (!c) return c
        const lines = c.lines.filter(l => keyOf(l.item_id, l.area_id) !== k)
        return { ...c, lines: out.line ? [...lines, out.line] : lines }
      })
      setState(s => ({ ...s, [k]: 'saved' }))
    } catch (err) {
      setState(s => ({ ...s, [k]: { error: err.message } }))
    }
  }, [qc, countId])
  const save = useCallback((itemId, areaId, entries) => {
    const k = keyOf(itemId, areaId)
    const body = { item_id: itemId, area_id: areaId || null, entries: entries.filter(e => e.qty != null).map(e => ({ qty: e.qty, unit: e.unit })) }
    waiting.current.set(k, body)
    setState(s => ({ ...s, [k]: 'waiting' }))
    clearTimeout(timers.current.get(k))
    timers.current.set(k, setTimeout(() => send(k, body), SAVE_AFTER_MS))
  }, [send])
  const flush = useCallback(() => {
    for (const [k, body] of waiting.current) { clearTimeout(timers.current.get(k)); send(k, body) }
  }, [send])
  useEffect(() => () => { for (const [k, body] of waiting.current) { clearTimeout(timers.current.get(k)); send(k, body) } }, [send])
  const busy = Object.values(state).some(v => v === 'waiting' || v === 'saving')
  return { save, flush, state, busy }
}

export default function CountSheet({ countId, venueId, phone = false, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['stock', 'count', countId], queryFn: () => api.get('/stock/counts/' + countId),
    refetchInterval: q => (q.state.data?.status === 'draft' ? REFRESH_MS : false),
  })
  if (isLoading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error) return <ErrorNote error={error} />
  if (!c) return null
  if (c.status !== 'draft') {
    return <Suspense fallback={null}><CountReview count={c} onClose={onClose} onChanged={() => qc.invalidateQueries({ queryKey: ['stock'] })} /></Suspense>
  }
  return <Counting c={c} venueId={venueId} phone={phone} onClose={onClose} />
}

function Counting({ c, venueId, phone, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const saver = useLineSaver(c.id)
  const [areaId, setAreaId] = useState(() => c.areas[0]?.id || (c.other.length ? 'other' : 'all'))
  const [search, setSearch] = useState('')
  const [typed, setTyped] = useState({})
  const [missing, setMissing] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const stockList = useStockList(venueId, !!search.trim())
  const lineOf = useMemo(() => new Map(c.lines.map(l => [keyOf(l.item_id, l.area_id), l])), [c.lines])
  const expectedOf = useMemo(() => new Map(Object.entries(c.expected || {})), [c.expected])
  const area = c.areas.find(a => a.id === areaId) || null
  const sheetIds = areaId === 'all' ? [...new Set([...c.areas.flatMap(a => a.item_ids), ...c.other])] : areaId === 'other' ? c.other : area?.item_ids || []
  const counted = new Set(c.lines.map(l => l.item_id))
  const lineArea = areaId === 'all' || areaId === 'other' ? null : areaId
  const shown = sheetIds.map(id => c.items[id]).filter(Boolean).filter(i => matchItem(i, search))
  // Found by the search but not on this part of the sheet: counted here all the same.
  const elsewhere = search.trim() && !shown.length
    ? (stockList.data?.items || []).filter(i => matchItem(i, search)).slice(0, 10).map(i => ({ ...i, id: i.item_id }))
    : []
  const setEntries = (item, entries) => {
    const k = keyOf(item.id, lineArea)
    setTyped(t => ({ ...t, [k]: entries }))
    saver.save(item.id, lineArea, entries)
  }
  const areaDone = useMutation({
    mutationFn: ({ id, done }) => api.post(`/stock/counts/${c.id}/areas/${id}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock', 'count', c.id] }),
  })
  const submit = useMutation({
    mutationFn: body => api.post(`/stock/counts/${c.id}/submit`, body || {}),
    onSuccess: out => { setMissing(null); qc.setQueryData(['stock', 'count', c.id], out); qc.invalidateQueries({ queryKey: ['stock'] }) },
    onError: err => { if (err.body?.code === 'not_counted') setMissing(err.body.items || []) },
  })
  const cancel = useMutation({
    mutationFn: () => api.post(`/stock/counts/${c.id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock'] }); onClose?.() },
  })
  // A full count asks about what nobody counted before it is sent (the API refuses with the same list, 422 not_counted).
  const startSubmit = () => {
    saver.flush()
    if (c.kind === 'full') {
      const scope = [...new Set([...c.areas.flatMap(a => a.item_ids), ...c.other])]
      const left = scope.filter(id => !counted.has(id) && !Object.entries(typed).some(([k, e]) => k.startsWith(id + '|') && e?.some(x => x.qty != null)))
      if (left.length) { setMissing(left.map(id => ({ id, name: c.items[id]?.name || 'An item' })).sort((a, b) => a.name.localeCompare(b.name))); return }
    }
    setTimeout(() => submit.mutate({}), saver.busy ? 600 : 0)
  }
  const progress = a => {
    const n = a.item_ids.filter(id => counted.has(id)).length
    return n + ' of ' + a.item_ids.length
  }
  return (
    <div className={cn('space-y-3', phone && 'pb-24')} data-testid="stock-count-sheet" data-count={c.id}>
      <div className="rounded-xl border bg-background p-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold">{c.key_list_name ? 'Key items: ' + c.key_list_name : COUNT_KINDS[c.kind]?.label}</p>
          <p className="text-xs text-muted-foreground">As at {when(c.counted_at)} · started by {c.started_by || 'someone'} · {counted.size} item{counted.size === 1 ? '' : 's'} counted</p>
        </div>
        <CountStatus status={c.status} />
        <span className="text-xs text-muted-foreground w-full" data-testid="stock-count-autosave">
          Each line saves by itself as you type{saver.busy ? ': saving...' : '.'} {c.blind ? 'Blind count: what is expected stays hidden until it is submitted.' : ''}
        </span>
      </div>

      {/* Areas: each with how many of its items are counted, and Done. */}
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="stock-count-areas">
        {c.areas.map(a => (
          <button key={a.id} type="button" onClick={() => setAreaId(a.id)} data-testid="stock-count-area" data-area={a.name} aria-pressed={areaId === a.id}
            className={cn('shrink-0 h-12 px-3 rounded-lg border text-sm inline-flex items-center gap-2 touch-manipulation',
              areaId === a.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {a.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4 opacity-50" />}
            {a.name}<span className="text-xs opacity-80">{progress(a)}</span>
          </button>
        ))}
        {c.other.length > 0 && (
          <button type="button" onClick={() => setAreaId('other')} aria-pressed={areaId === 'other'} data-testid="stock-count-area" data-area="other"
            className={cn('shrink-0 h-12 px-3 rounded-lg border text-sm touch-manipulation', areaId === 'other' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            Not in an area <span className="text-xs opacity-80">{c.other.filter(id => counted.has(id)).length} of {c.other.length}</span>
          </button>
        )}
        {c.areas.length > 0 && (
          <button type="button" onClick={() => setAreaId('all')} aria-pressed={areaId === 'all'}
            className={cn('shrink-0 h-12 px-3 rounded-lg border text-sm touch-manipulation', areaId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            Everything
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item, or scan its barcode"
            className={cn(inputCls, 'pl-9 h-12')} data-testid="stock-count-search" />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear" className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {canScan() && (
          <button type="button" className={cn(btn.outline, 'h-12 w-12 px-0')} aria-label="Scan a barcode" data-testid="stock-count-scan"
            onClick={async () => { const code = await scanBarcode().catch(() => null); if (code) setSearch(code) }}>
            <ScanLine className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-background divide-y" data-testid="stock-count-lines">
        {[...shown, ...elsewhere].map(item => {
          const k = keyOf(item.id, lineArea)
          const line = lineOf.get(k)
          const entries = typed[k] ?? (line?.entries?.length ? line.entries.map(e => ({ qty: e.qty, unit: e.unit })) : null)
          const st = saver.state[k]
          const exp = c.blind ? undefined : expectedOf.get(item.id)
          const others = c.lines.filter(l => l.item_id === item.id && keyOf(l.item_id, l.area_id) !== k)
          return (
            <div key={k} className={cn('px-3 py-3 flex flex-wrap gap-3', phone ? 'flex-col' : 'items-start')} data-testid="stock-count-line" data-item={item.name}>
              <div className="flex-1 min-w-[10rem]">
                <p className="text-sm font-medium">{item.name}{elsewhere.includes(item) && <span className="ml-2 text-[11px] text-muted-foreground">not on this sheet</span>}</p>
                <p className="text-xs text-muted-foreground">
                  {[item.code, exp !== undefined && exp !== null ? 'Expected ' + qty(exp, item.base_unit) : null,
                    others.length ? 'Also counted: ' + others.map(o => qty(o.qty_base, item.base_unit) + (o.area_id ? ' in ' + (c.areas.find(a => a.id === o.area_id)?.name || 'another area') : '')).join(', ') : null,
                    line?.counted_by ? 'by ' + line.counted_by : null].filter(Boolean).join(' · ')}
                </p>
                <p className="text-[11px] h-4" data-testid="stock-line-state" data-state={typeof st === 'string' ? st : st ? 'error' : ''}>
                  {st === 'waiting' || st === 'saving' ? 'Saving...' : st === 'saved' ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check className="w-3 h-3" />Saved</span> : st?.error ? <span className="text-red-700">{st.error}</span> : ''}
                </p>
              </div>
              <EntriesEditor item={item} entries={entries} onChange={e => setEntries(item, e)} />
            </div>
          )
        })}
        {!shown.length && !elsewhere.length && (
          <p className="p-4 text-sm text-muted-foreground">{search ? 'No item matches.' : areaId === 'other' ? 'Nothing here.' : 'No items in this area yet: add them on the Settings tab, or find one above.'}</p>
        )}
      </div>

      <div className={cn('flex flex-wrap gap-2', phone && 'fixed bottom-0 inset-x-0 bg-background border-t p-3 z-20')}>
        {area && (
          <button type="button" className={btn.outline + ' h-12'} disabled={areaDone.isPending}
            onClick={() => areaDone.mutate({ id: area.id, done: !area.done })} data-testid="stock-count-area-done">
            {area.done ? <><Circle className="w-4 h-4" />Not done yet</> : <><CheckCircle2 className="w-4 h-4" />{area.name} done</>}
          </button>
        )}
        <span className="flex-1" />
        {cancelling ? (
          <span className="inline-flex gap-1">
            <button type="button" className="h-12 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm" onClick={() => cancel.mutate()} data-testid="stock-count-cancel-yes">Yes, cancel the count</button>
            <button type="button" className={btn.outline + ' h-12'} onClick={() => setCancelling(false)}>Keep it</button>
          </span>
        ) : (
          <button type="button" className={btn.ghost + ' h-12'} onClick={() => setCancelling(true)} data-testid="stock-count-cancel">Cancel count</button>
        )}
        <button type="button" className={btn.primary + ' h-12'} disabled={submit.isPending || !c.can_count} onClick={startSubmit} data-testid="stock-count-submit">
          {submit.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Submit the count
        </button>
      </div>
      {submit.error && submit.error.body?.code !== 'not_counted' && <ErrorNote error={submit.error} />}
      <ErrorNote error={cancel.error || areaDone.error} />

      {missing && (
        <Modal title="Not counted yet" onClose={() => setMissing(null)}
          footer={<>
            <button type="button" className={btn.primary + ' h-12'} disabled={submit.isPending} onClick={() => setTimeout(() => submit.mutate({ all_zero: true }), saver.busy ? 800 : 0)} data-testid="stock-count-zero-all">
              Confirm all {missing.length} as zero and submit
            </button>
            <button type="button" className={btn.outline + ' h-12'} onClick={() => setMissing(null)}>Go back and count</button>
          </>}>
          <p className="text-sm">A full count covers every item at the venue. These have no count: is there none of each?</p>
          <ul className="text-sm divide-y rounded-lg border" data-testid="stock-count-missing">
            {missing.map(i => <li key={i.id} className="px-3 py-2">{i.name}</li>)}
          </ul>
        </Modal>
      )}
    </div>
  )
}
