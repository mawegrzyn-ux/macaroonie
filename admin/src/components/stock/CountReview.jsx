// src/components/stock/CountReview.jsx
//
// A submitted, approved or cancelled count (inventory phase 4a): expected
// (what the ledger said was there at the count's moment) against counted
// for each item, with the value of each difference and the totals for
// people with Costing view (countReview() in shared/stock.js, worked out by
// the API). A submitted count is approved here (Stock manage; with the
// group's second person setting, by someone who neither counted nor
// submitted it), sent back to counting, or cancelled. An approved count is
// what stock on hand reads; it is replaced by counting again, never edited.
//
//   CountReview({ count, onClose, onChanged })

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Undo2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorNote } from '@/components/staff/shared'
import { btn } from '@/components/purchasing/shared'
import { CountStatus, LaterCountNote, qty, signedBase, when, pounds, COUNT_KINDS } from '@/components/stock/shared'

export default function CountReview({ count: c, onClose, onChanged }) {
  const api = useApi()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(null)
  const act = useMutation({
    mutationFn: what => api.post(`/stock/counts/${c.id}/${what}`, {}),
    onSuccess: (out, what) => {
      setAsking(null)
      if (what === 'cancel') { onChanged?.(); onClose?.(); return }
      qc.setQueryData(['stock', 'count', c.id], out)
      onChanged?.()
    },
  })
  const rows = c.review?.rows || []
  const t = c.review?.totals
  const off = rows.filter(r => r.diff)
  return (
    <div className="space-y-3" data-testid="stock-count-review" data-count={c.id}>
      <div className="rounded-xl border bg-background p-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold">{c.key_list_name ? 'Key items: ' + c.key_list_name : COUNT_KINDS[c.kind]?.label}</p>
          <p className="text-xs text-muted-foreground">
            As at {when(c.counted_at)}{c.submitted_by ? ' · submitted by ' + c.submitted_by : ''}{c.approved_by ? ' · approved by ' + c.approved_by + ' ' + when(c.approved_at) : ''}
          </p>
        </div>
        <CountStatus status={c.status} />
      </div>
      <LaterCountNote later={c.later_count} />

      {c.sees_values && t && (
        <div className="grid grid-cols-3 gap-2" data-testid="stock-review-totals">
          <Total label="Missing" value={pounds(t.loss)} tone="text-red-700" />
          <Total label="Found" value={pounds(t.gain)} tone="text-emerald-700" />
          <Total label="Net" value={pounds(t.net)} tone={t.net < 0 ? 'text-red-700' : ''} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {off.length} of {rows.length} item{rows.length === 1 ? '' : 's'} differ from what was expected. Sales aren&apos;t taken off yet, so items used in dishes show as short.
      </p>

      <div className="rounded-xl border bg-background overflow-hidden">
        <div className={cn('grid gap-2 px-3 py-2 section-head text-xs font-semibold', c.sees_values ? 'grid-cols-[1fr_5rem_5rem_5rem_4.5rem]' : 'grid-cols-[1fr_5rem_5rem_5rem]')}>
          <span>Item</span><span className="text-right">Expected</span><span className="text-right">Counted</span><span className="text-right">Difference</span>
          {c.sees_values && <span className="text-right">Value</span>}
        </div>
        <div className="divide-y" data-testid="stock-review-rows">
          {rows.map(r => (
            <div key={r.item_id} data-testid="stock-review-row" data-item={r.name}
              className={cn('grid gap-2 px-3 py-2.5 text-sm tabular-nums', c.sees_values ? 'grid-cols-[1fr_5rem_5rem_5rem_4.5rem]' : 'grid-cols-[1fr_5rem_5rem_5rem]')}>
              <span className="min-w-0 truncate font-medium">{r.name}</span>
              <span className="text-right text-muted-foreground">{r.expected == null ? 'new' : qty(r.expected, r.base_unit)}</span>
              <span className="text-right">{qty(r.counted, r.base_unit)}</span>
              <span className={cn('text-right', r.diff < 0 && 'text-red-700', r.diff > 0 && 'text-emerald-700')}>{r.diff == null ? '–' : r.diff ? signedBase(r.diff, r.base_unit) : '0'}</span>
              {c.sees_values && <span className="text-right">{r.value == null ? '–' : pounds(r.value)}</span>}
            </div>
          ))}
          {!rows.length && <p className="p-4 text-sm text-muted-foreground">{c.status === 'cancelled' ? 'This count was cancelled.' : 'Nothing was counted.'}</p>}
        </div>
      </div>

      {c.status === 'submitted' && (
        <div className="flex flex-wrap items-center gap-2">
          {c.approve_problem && (
            <p className="w-full flex items-start gap-2 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="stock-approve-problem">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{c.approve_problem}
            </p>
          )}
          {c.can_approve && (asking === 'approve' ? (
            <span className="inline-flex gap-1">
              <button type="button" className={btn.primary + ' h-12'} onClick={() => act.mutate('approve')} disabled={act.isPending} data-testid="stock-count-approve-yes">
                {act.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Yes, approve: on hand becomes these counts
              </button>
              <button type="button" className={btn.outline + ' h-12'} onClick={() => setAsking(null)}>Not yet</button>
            </span>
          ) : (
            <button type="button" className={btn.primary + ' h-12'} onClick={() => setAsking('approve')} data-testid="stock-count-approve">
              <CheckCircle2 className="w-4 h-4" />Approve
            </button>
          ))}
          <ManageActions c={c} asking={asking} setAsking={setAsking} act={act} />
        </div>
      )}
      <ErrorNote error={act.error} />
    </div>
  )
}

function ManageActions({ c, asking, setAsking, act }) {
  // Sending back and cancelling a submitted count are Stock manage: the API refuses otherwise.
  if (!c.can_manage) return null
  return (
    <>
      <button type="button" className={btn.outline + ' h-12'} onClick={() => act.mutate('reopen')} disabled={act.isPending} data-testid="stock-count-reopen">
        <Undo2 className="w-4 h-4" />Back to counting
      </button>
      {asking === 'cancel' ? (
        <span className="inline-flex gap-1">
          <button type="button" className="h-12 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm" onClick={() => act.mutate('cancel')} data-testid="stock-count-cancel-yes">Yes, cancel it</button>
          <button type="button" className={btn.outline + ' h-12'} onClick={() => setAsking(null)}>Keep it</button>
        </span>
      ) : (
        <button type="button" className={btn.ghost + ' h-12'} onClick={() => setAsking('cancel')} data-testid="stock-count-cancel">Cancel count</button>
      )}
    </>
  )
}

function Total({ label, value, tone }) {
  return (
    <div className="rounded-xl border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  )
}
