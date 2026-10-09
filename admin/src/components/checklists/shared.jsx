// src/components/checklists/shared.jsx
//
// Pieces shared between the Checklists page's own "Today" tab and the
// H&S Dashboard's checklist widget — both need the exact same
// tick-and-save panel for a single checklist occurrence, so it lives
// here once rather than being copied.

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, CheckCheck } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

const NOTES_AUTOSAVE_DEBOUNCE_MS = 800

export const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

export function periodLabel(frequency, periodStart) {
  const d = new Date(periodStart + 'T12:00:00')
  if (frequency === 'monthly') return format(d, 'MMMM yyyy')
  if (frequency === 'weekly') return `Week of ${format(d, 'd MMM')}`
  return format(d, 'EEEE d MMM')
}

// Tick-list + notes for one checklist occurrence (a single day/week/month
// period of one template). Ticks and notes autosave. There is no separate
// "complete" step: the API marks the occurrence completed as soon as every
// task is ticked (and back to in progress when one is unticked). "Tick
// all" ticks every task in one save. Self-contained data fetching so it can
// be dropped into a modal (Checklists page) or a dashboard card (H&S
// Dashboard) without prop drilling. `onClose`, if given, shows a close
// button.
//
// `hideHeader` moves the Tick all action out of this component: the parent
// (the dashboard widget card's own title bar) gets
// `onStateChange({ isCompleted, isPending, tickAll, untickAll })` and
// renders a compact action there. Without `hideHeader`, the Tick all
// button sits above the list and `onStateChange` is unused.
export function ChecklistRunPanel({ template, date, onClose, hideHeader = false, onStateChange }) {
  const api = useApi()
  const qc = useQueryClient()
  const [checks, setChecks] = useState({})
  const [notes, setNotes] = useState('')
  const notesTimerRef = useRef(null)

  const { data, isLoading } = useQuery({
    queryKey: ['checklist-instance', template.id, date],
    queryFn: () => api.get(`/checklists/instance?template_id=${template.id}&date=${date}`),
  })

  // Keyed on period_start + instance id rather than the whole `data`
  // object: a background refetch of the SAME period (triggered by our own
  // autosave invalidation below) must not clobber an in-flight local edit
  // the operator just made while that refetch was in transit. Genuinely
  // switching to a different period (or an instance being created by the
  // very first save) still re-syncs correctly since one of these changes.
  useEffect(() => {
    if (!data) return
    const initial = {}
    for (const it of data.items) {
      initial[it.id] = data.item_values[it.id]?.checked ?? false
    }
    setChecks(initial)
    setNotes(data.instance?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.period_start, data?.instance?.id])

  useEffect(() => () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current) }, [])

  // Deliberately invalidates every cached DATE for this template, not just
  // the one just saved — a weekly/monthly instance is shared across many
  // calendar dates (all mapping to the same period_start server-side), so
  // saving on one date must not leave another already-visited date in the
  // same week/month showing stale, pre-save tick state.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['checklist-instance', template.id] })
    qc.invalidateQueries({ queryKey: ['checklists-due'] })
    qc.invalidateQueries({ queryKey: ['dashboard-hs-status-today'] })
    qc.invalidateQueries({ queryKey: ['dashboard-hs-status-week'] })
  }

  function buildBody(checksOverride, notesOverride) {
    const c = checksOverride ?? checks
    const n = notesOverride ?? notes
    return {
      template_id: template.id,
      date,
      items: (data?.items ?? []).map(it => ({ template_item_id: it.id, checked: !!c[it.id] })),
      notes: (n ?? '').trim() || null,
    }
  }

  const save = useMutation({
    mutationFn: ({ checksOverride, notesOverride } = {}) =>
      api.put('/checklists/instance', buildBody(checksOverride, notesOverride)),
    onSuccess: invalidate,
  })

  function toggleCheck(itemId, checked) {
    const nextChecks = { ...checks, [itemId]: checked }
    setChecks(nextChecks)
    save.mutate({ checksOverride: nextChecks })
  }

  function setAll(checked) {
    const nextChecks = Object.fromEntries((data?.items ?? []).map(it => [it.id, checked]))
    setChecks(nextChecks)
    save.mutate({ checksOverride: nextChecks })
  }

  function handleNotesChange(value) {
    setNotes(value)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(() => {
      save.mutate({ notesOverride: value })
    }, NOTES_AUTOSAVE_DEBOUNCE_MS)
  }

  function flushNotes() {
    if (notesTimerRef.current) { clearTimeout(notesTimerRef.current); notesTimerRef.current = null }
    save.mutate({ notesOverride: notes })
  }

  const checkedCount = Object.values(checks).filter(Boolean).length
  const totalCount = data?.items?.length ?? 0
  // From the local ticks, so the header flips the moment the last box is
  // ticked rather than after the save comes back.
  const isCompleted = totalCount > 0 && checkedCount === totalCount

  // hideHeader means the parent (the H&S Dashboard widget card) draws its
  // own title bar and wants Tick all there — hand it what it needs.
  useEffect(() => {
    if (!hideHeader || !data) return
    onStateChange?.({
      isCompleted, isPending: save.isPending, hasItems: totalCount > 0,
      tickAll: () => setAll(true),
      untickAll: () => setAll(false),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideHeader, !!data, isCompleted, totalCount, save.isPending, data?.period_start, data?.instance?.id])

  return (
    <>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{template.name}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs text-muted-foreground">
          {periodLabel(template.frequency, data?.period_start ?? date)}
          {totalCount > 0 && <> · {checkedCount}/{totalCount} done</>}
        </p>
        {!hideHeader && totalCount > 0 && !isCompleted && (
          <button type="button" onClick={() => setAll(true)} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 min-h-[44px] text-sm font-medium hover:bg-accent disabled:opacity-50 touch-manipulation shrink-0">
            <CheckCheck className="w-4 h-4" /> Tick all
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : (
        <>
          {isCompleted && (
            <div className="mb-3 flex items-center justify-between gap-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                {data?.instance?.status === 'completed' ? (
                  <>
                    Completed by {data.instance.completed_by || 'someone'}
                    {data.instance.completed_at && <> · {format(new Date(data.instance.completed_at), 'd MMM, HH:mm')}</>}
                  </>
                ) : 'All done'}
              </span>
            </div>
          )}

          <ul className="border rounded-lg divide-y mb-3">
            {(data?.items ?? []).map(it => (
              <li key={it.id}>
                <label className="flex items-start gap-3 px-3 py-3 touch-manipulation min-h-[48px] cursor-pointer">
                  <input type="checkbox" checked={!!checks[it.id]}
                    onChange={e => toggleCheck(it.id, e.target.checked)}
                    className="mt-0.5 w-5 h-5 shrink-0 touch-manipulation" />
                  <span className="text-sm leading-snug">{it.label}</span>
                </label>
              </li>
            ))}
          </ul>

          <label className="block text-xs font-medium mb-1">Notes</label>
          <textarea value={notes} onChange={e => handleNotesChange(e.target.value)} onBlur={flushNotes}
            rows={2}
            className="w-full border rounded px-3 py-2 text-sm bg-background resize-none mb-4" />

          {save.error && (
            <p className="text-sm text-destructive">{save.error.body?.error || save.error.message}</p>
          )}
        </>
      )}
    </>
  )
}

// The checklist action for a dashboard widget's own title bar, fed by
// ChecklistRunPanel's onStateChange (hideHeader mode): "Tick all" until
// every task is ticked, then an "All done" badge. Tapping the badge offers
// "Untick all" (confirmed), the way back from an accidental Tick all.
export function ChecklistHeaderAction({ state }) {
  const [confirmUntick, setConfirmUntick] = useState(false)
  useEffect(() => { if (!state?.isCompleted) setConfirmUntick(false) }, [state?.isCompleted])
  if (!state?.hasItems) return null

  if (!state.isCompleted) {
    return (
      <button type="button" onClick={state.tickAll} disabled={state.isPending}
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 min-h-[36px] touch-manipulation">
        <CheckCheck className="w-3.5 h-3.5" /> Tick all
      </button>
    )
  }
  if (confirmUntick) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={() => { state.untickAll(); setConfirmUntick(false) }} disabled={state.isPending}
          className="text-xs font-medium px-2 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50 min-h-[36px] touch-manipulation">
          Untick all
        </button>
        <button type="button" onClick={() => setConfirmUntick(false)}
          className="text-xs font-medium px-2 py-1.5 rounded-md border min-h-[36px] touch-manipulation">
          Cancel
        </button>
      </div>
    )
  }
  return (
    <button type="button" onClick={() => setConfirmUntick(true)} title="Tap to untick all"
      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-1.5 py-1.5 min-h-[36px] shrink-0 touch-manipulation">
      <Check className="w-3.5 h-3.5" /> All done
    </button>
  )
}
