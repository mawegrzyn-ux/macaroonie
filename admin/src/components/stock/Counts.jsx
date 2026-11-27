// src/components/stock/Counts.jsx
//
// The Stock page's Counts tab (inventory phase 4a): the venue's counts (the
// one being counted and those waiting for approval first, then the last 30),
// starting a full count or a key-item count from a list (Stock use), and one
// count opened: CountSheet while it is counted, CountReview after. The
// opened count is in the address (?count=), so Today's cards open it.
//
//   Counts({ venueId, countId, onOpenCount })
//   API GET/POST /api/stock/venues/:venueId/counts, GET /api/stock/key-lists

import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ClipboardList, Loader2, Plus } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { Card, btn } from '@/components/purchasing/shared'
import { CountStatus, when, useStockMeta, COUNT_KINDS } from '@/components/stock/shared'

const CountSheet = lazy(() => import('@/components/stock/CountSheet'))

export function useCounts(venueId) {
  const api = useApi()
  return useQuery({ queryKey: ['stock', venueId, 'counts'], queryFn: () => api.get(`/stock/venues/${venueId}/counts`), enabled: !!venueId })
}

/** Start a count: full, or key items from one of the group's lists. */
export function StartCount({ venueId, onStarted }) {
  const api = useApi()
  const qc = useQueryClient()
  const [kind, setKind] = useState('full')
  const [listId, setListId] = useState('')
  const lists = useQuery({ queryKey: ['stock', 'key-lists'], queryFn: () => api.get('/stock/key-lists') })
  const start = useMutation({
    mutationFn: () => api.post(`/stock/venues/${venueId}/counts`, kind === 'key' ? { kind, key_list_id: listId || lists.data?.[0]?.id } : { kind }),
    onSuccess: c => { qc.invalidateQueries({ queryKey: ['stock', venueId, 'counts'] }); onStarted(c.id) },
    onError: err => { if (err.body?.code === 'open_count' && err.body.count_id) onStarted(err.body.count_id) },
  })
  const noLists = kind === 'key' && lists.data && !lists.data.length
  return (
    <Card title="Start a count">
      <div className="space-y-3" data-testid="stock-start">
        <Segmented value={kind} onChange={setKind} testid="stock-start-kind"
          options={[{ value: 'full', label: COUNT_KINDS.full.label }, { value: 'key', label: COUNT_KINDS.key.label }]} />
        <p className="text-xs text-muted-foreground">{COUNT_KINDS[kind].hint}</p>
        {kind === 'key' && (
          noLists ? <p className="text-sm text-muted-foreground">No key-item lists yet: a manager makes them on the Settings tab.</p> : (
            <Field label="Key-item list">
              <select className={cn(inputCls, 'h-12 max-w-sm')} value={listId || lists.data?.[0]?.id || ''} onChange={e => setListId(e.target.value)} data-testid="stock-start-list">
                {(lists.data || []).map(l => <option key={l.id} value={l.id}>{l.name} ({l.items.length})</option>)}
              </select>
            </Field>
          )
        )}
        <button type="button" className={btn.primary + ' h-12'} disabled={start.isPending || noLists} onClick={() => start.mutate()} data-testid="stock-start-go">
          {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Start counting
        </button>
        {start.error?.body?.code !== 'open_count' && <ErrorNote error={start.error} />}
      </div>
    </Card>
  )
}

export default function Counts({ venueId, countId, onOpenCount }) {
  const { data: meta } = useStockMeta()
  const { data: counts = [], isLoading, error } = useCounts(venueId)
  if (countId) {
    return (
      <div className="space-y-3">
        <button type="button" className={btn.ghost + ' h-12'} onClick={() => onOpenCount(null)} data-testid="stock-count-back">
          <ChevronLeft className="w-4 h-4" />All counts
        </button>
        <Suspense fallback={<Loader2 className="w-5 h-5 animate-spin" />}>
          <CountSheet countId={countId} venueId={venueId} onClose={() => onOpenCount(null)} />
        </Suspense>
      </div>
    )
  }
  const draft = counts.find(c => c.status === 'draft')
  return (
    <div className="space-y-4" data-testid="stock-counts">
      {meta?.can_count && !draft && <StartCount venueId={venueId} onStarted={onOpenCount} />}
      <Card title="Counts" bodyClass="p-0">
        <ErrorNote error={error} />
        {isLoading ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <div className="divide-y" data-testid="stock-count-list">
            {counts.map(c => (
              <button key={c.id} type="button" onClick={() => onOpenCount(c.id)} data-testid="stock-count-row" data-status={c.status}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40 touch-manipulation min-h-[56px]">
                <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium block truncate">{c.key_list_name ? 'Key items: ' + c.key_list_name : COUNT_KINDS[c.kind]?.label}</span>
                  <span className="text-xs text-muted-foreground block truncate">
                    {when(c.counted_at)} · {c.items} item{c.items === 1 ? '' : 's'}{c.approved_by ? ' · approved by ' + c.approved_by : c.submitted_by ? ' · submitted by ' + c.submitted_by : c.started_by ? ' · ' + c.started_by : ''}
                  </span>
                </span>
                <CountStatus status={c.status} />
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
            {!counts.length && <p className="p-4 text-sm text-muted-foreground">No counts at this venue yet.</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
