// src/components/checklists/shared.jsx
//
// Pieces shared between the Checklists page's own "Today" tab and the
// H&S Dashboard's checklist widget — both need the exact same
// tick-and-save panel for a single checklist occurrence, so it lives
// here once rather than being copied.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, RotateCcw } from 'lucide-react'
import { useApi } from '@/lib/api'
import { format } from 'date-fns'

export const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

export function periodLabel(frequency, periodStart) {
  const d = new Date(periodStart + 'T12:00:00')
  if (frequency === 'monthly') return format(d, 'MMMM yyyy')
  if (frequency === 'weekly') return `Week of ${format(d, 'd MMM')}`
  return format(d, 'EEEE d MMM')
}

// Tick-list + notes + save/complete/reopen flow for one checklist occurrence
// (a single day/week/month period of one template). Self-contained data
// fetching so it can be dropped into a modal (Checklists page) or a
// dashboard card (H&S Dashboard) without prop drilling. `onClose`, if
// given, shows a close button and is called after "Mark complete" / "Yes,
// reopen" (not after "Save progress", which keeps the panel open).
export function ChecklistRunPanel({ template, date, onClose, hideHeader = false }) {
  const api = useApi()
  const qc = useQueryClient()
  const [checks, setChecks] = useState({})
  const [notes, setNotes] = useState('')
  const [confirmReopen, setConfirmReopen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['checklist-instance', template.id, date],
    queryFn: () => api.get(`/checklists/instance?template_id=${template.id}&date=${date}`),
  })

  useEffect(() => {
    if (!data) return
    const initial = {}
    for (const it of data.items) {
      initial[it.id] = data.item_values[it.id]?.checked ?? false
    }
    setChecks(initial)
    setNotes(data.instance?.notes ?? '')
  }, [data])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['checklist-instance', template.id, date] })
    qc.invalidateQueries({ queryKey: ['checklists-due'] })
  }

  function buildBody(markComplete) {
    return {
      template_id: template.id,
      date,
      items: (data?.items ?? []).map(it => ({ template_item_id: it.id, checked: !!checks[it.id] })),
      notes: notes.trim() || null,
      mark_complete: markComplete,
    }
  }

  const save = useMutation({
    mutationFn: (markComplete) => api.put('/checklists/instance', buildBody(markComplete)),
    onSuccess: (_, markComplete) => {
      invalidate()
      if (markComplete !== undefined) onClose?.()
    },
  })

  const isCompleted = data?.instance?.status === 'completed'
  const checkedCount = Object.values(checks).filter(Boolean).length
  const totalCount = data?.items?.length ?? 0

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
      <p className="text-xs text-muted-foreground mb-4">
        {periodLabel(template.frequency, data?.period_start ?? date)}
        {totalCount > 0 && <> · {checkedCount}/{totalCount} done</>}
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : (
        <>
          {isCompleted && (
            <div className="mb-3 flex items-center justify-between gap-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                Completed by {data.instance.completed_by || 'someone'}
                {data.instance.completed_at && <> · {format(new Date(data.instance.completed_at), 'd MMM, HH:mm')}</>}
              </span>
            </div>
          )}

          <ul className="border rounded-lg divide-y mb-3">
            {(data?.items ?? []).map(it => (
              <li key={it.id}>
                <label className="flex items-start gap-3 px-3 py-3 cursor-pointer touch-manipulation min-h-[48px]">
                  <input type="checkbox" checked={!!checks[it.id]}
                    onChange={e => setChecks(prev => ({ ...prev, [it.id]: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 shrink-0 touch-manipulation" />
                  <span className="text-sm leading-snug">{it.label}</span>
                </label>
              </li>
            ))}
          </ul>

          <label className="block text-xs font-medium mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border rounded px-3 py-2 text-sm bg-background resize-none mb-4" />

          {!isCompleted ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => save.mutate(undefined)} disabled={save.isPending}
                className="flex-1 border rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
                Save progress
              </button>
              <button type="button" onClick={() => save.mutate(true)} disabled={save.isPending}
                className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
                {save.isPending ? 'Saving…' : 'Mark complete'}
              </button>
            </div>
          ) : !confirmReopen ? (
            <button type="button" onClick={() => setConfirmReopen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 border border-amber-300 text-amber-700 rounded px-4 py-2 text-sm font-medium min-h-[44px] hover:bg-amber-50 touch-manipulation">
              <RotateCcw className="w-3.5 h-3.5" /> Reopen this checklist
            </button>
          ) : (
            <div className="border border-amber-300 rounded-lg p-3 space-y-2">
              <p className="text-xs text-amber-800">Reopen so changes can be made? It will show as not-yet-completed again.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => save.mutate(false)} disabled={save.isPending}
                  className="flex-1 bg-amber-600 text-white rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
                  {save.isPending ? 'Working…' : 'Yes, reopen'}
                </button>
                <button type="button" onClick={() => setConfirmReopen(false)}
                  className="flex-1 border rounded px-4 py-2 text-sm min-h-[44px] touch-manipulation">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
