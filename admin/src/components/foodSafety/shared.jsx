// src/components/foodSafety/shared.jsx
//
// Pieces shared between the Food safety page's own "Today" tab and the
// H&S Dashboard's temperature-check widget — both need the exact same
// equipment × capture-time grid, so it lives here once rather than
// being copied.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle, Check, Minus } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const TYPE_LABELS = {
  fridge: 'Fridge', freezer: 'Freezer', hot_hold: 'Hot hold',
  cold_hold: 'Cold hold', other: 'Other',
}

// Mirrors the backend's withinRange() in foodSafety.js — used to decide
// client-side, before saving, whether the out-of-range comment popup is required.
export function withinRange(temp, min, max) {
  if (temp == null || Number.isNaN(temp)) return null
  if (min != null && temp < min) return false
  if (max != null && temp > max) return false
  return true
}

export function timeLabel(t) {
  return t ? t.slice(0, 5) : ''
}

export function Badge({ ok, children }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      ok === true  && 'bg-green-100 text-green-800',
      ok === false && 'bg-red-100 text-red-800',
      ok == null   && 'bg-slate-100 text-slate-600',
    )}>
      {ok === true && <Check className="w-3 h-3" />}
      {ok === false && <AlertTriangle className="w-3 h-3" />}
      {children}
    </span>
  )
}

// Required-comment gate for out-of-range readings. Shown instead of saving
// directly — the reading only reaches the API once a corrective action is given.
export function RangeCommentModal({ equipment, temp, onCancel, onConfirm, isSaving }) {
  const [action, setAction] = useState('')
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 border-2 border-red-200">
        <div className="flex items-center gap-2 mb-1 text-red-700">
          <AlertTriangle className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Reading is out of range</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {equipment.name} was logged at <strong>{temp}°C</strong>, outside the allowed{' '}
          {equipment.min_temp_c ?? '—'} to {equipment.max_temp_c ?? '—'}°C range. Add a comment
          on what action was taken before saving.
        </p>
        <label className="block text-sm font-medium mb-1">Corrective action *</label>
        <textarea value={action} onChange={e => setAction(e.target.value)} rows={3} autoFocus
          placeholder="e.g. Adjusted thermostat, moved stock to backup unit, called engineer"
          className="w-full border rounded px-3 py-2 text-sm bg-background resize-none mb-4" />
        <div className="flex gap-2">
          <button type="button" disabled={!action.trim() || isSaving}
            onClick={() => onConfirm(action.trim())}
            className="flex-1 bg-red-600 text-white rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
            {isSaving ? 'Saving…' : 'Confirm & save'}
          </button>
          <button type="button" onClick={onCancel} disabled={isSaving} className="px-4 py-2 border rounded text-sm min-h-[44px]">Back</button>
        </div>
      </div>
    </div>
  )
}

// One equipment × capture-time cell: pre-filled with today's already-logged
// reading (if any) and always directly editable — no modal. Plus/minus
// steppers either side for tablet use; a save (check) button appears once
// the value has changed. Out-of-range values aren't saved directly —
// attemptSave() hands off to the parent's RangeCommentModal gate (shared
// across every cell) so a corrective action is captured first.
export function TempCell({ equipment, captureTime, existingLog, onSave, onOutOfRange, isSaving }) {
  const [value, setValue] = useState(() =>
    existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  const [dirty, setDirty] = useState(false)

  // Resync from the server value after a save round-trips (new log id /
  // temperature) — but never while the operator is mid-edit, since this
  // effect only fires when the *existing log itself* changes.
  useEffect(() => {
    setValue(existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
    setDirty(false)
  }, [existingLog?.id, existingLog?.temperature_c])

  function bump(delta) {
    const current = value === '' ? (equipment.target_temp_c ?? 0) : Number(value)
    setValue(String(Math.round((current + delta) * 10) / 10))
    setDirty(true)
  }

  function attemptSave() {
    if (value === '' || isSaving) return
    const temp = Number(value)
    const inRange = withinRange(temp, equipment.min_temp_c, equipment.max_temp_c)
    if (inRange === false) {
      onOutOfRange({ equipment, captureTime, temp })
      return
    }
    onSave({
      venue_id: equipment.venue_id,
      equipment_id: equipment.id,
      capture_time_id: captureTime?.id ?? null,
      temperature_c: temp,
      corrective_action: null,
      notes: null,
    })
  }

  const badReading = !dirty && existingLog?.is_within_range === false

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => bump(-0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Decrease ${equipment.name} temperature`}>
        <Minus className="w-4 h-4" />
      </button>
      <input type="number" step="0.1" inputMode="decimal" value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onKeyDown={e => { if (e.key === 'Enter') attemptSave() }}
        placeholder={equipment.target_temp_c != null ? String(equipment.target_temp_c) : '—'}
        className={cn(
          'w-16 text-center text-sm font-semibold border rounded-lg px-1 py-2 bg-background min-h-[40px] touch-manipulation',
          badReading && 'border-red-400 bg-red-50 text-red-700',
        )} />
      <button type="button" onClick={() => bump(0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Increase ${equipment.name} temperature`}>
        <Plus className="w-4 h-4" />
      </button>
      <button type="button" onClick={attemptSave} disabled={!dirty || value === '' || isSaving}
        className={cn(
          'w-10 h-10 shrink-0 rounded-lg flex items-center justify-center touch-manipulation',
          dirty && value !== '' ? 'bg-primary text-primary-foreground' : 'text-transparent pointer-events-none',
        )}
        aria-label={`Save ${equipment.name} reading`}>
        <Check className="w-4 h-4" />
      </button>
    </div>
  )
}

// Full equipment × capture-time grid for one venue/date — the entire "Today"
// experience (data fetching, out-of-range gate, inline entry) as a single
// drop-in component. Used by the Food safety page's Today tab and by the
// H&S Dashboard's temperature-check widget card.
export function TempChecksTable({ venueId, date, emptyState, showType = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const [pendingOutOfRange, setPendingOutOfRange] = useState(null)

  const enabled = !!venueId

  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ['fs-equipment', venueId],
    queryFn: () => api.get(`/food-safety/equipment?venue_id=${venueId}`),
    enabled,
  })
  const { data: captureTimes = [] } = useQuery({
    queryKey: ['fs-capture-times', venueId],
    queryFn: () => api.get(`/food-safety/capture-times?venue_id=${venueId}`),
    enabled,
  })
  const { data: tempLogs = [] } = useQuery({
    queryKey: ['fs-temp-logs', venueId, date],
    queryFn: () => api.get(`/food-safety/temp-logs?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createTemp = useMutation({
    mutationFn: body => api.post('/food-safety/temp-logs', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fs-temp-logs', venueId, date] })
      setPendingOutOfRange(null)
    },
  })

  if (!enabled) return null
  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
  if (equipment.length === 0) {
    return emptyState ?? <p className="text-sm text-muted-foreground py-8 text-center">No equipment configured for this venue yet.</p>
  }

  // One column per configured capture time (Food safety → Equipment tab sets
  // these up — any label, any number, e.g. 8AM/12PM/4PM/10PM). With none
  // configured, fall back to a single ad-hoc "Today" column.
  const columns = captureTimes.length > 0 ? captureTimes : [null]

  return (
    <>
      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/50">Equipment</th>
              {showType && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Type</th>}
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Range</th>
              {columns.map(ct => (
                <th key={ct?.id ?? 'adhoc'} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                  {ct ? <>{ct.label}<span className="block font-normal text-[11px]">{timeLabel(ct.time_of_day)}</span></> : 'Today'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {equipment.map(eq => (
              <tr key={eq.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium whitespace-nowrap sticky left-0 bg-background">{eq.name}</td>
                {showType && <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{TYPE_LABELS[eq.equipment_type]}</td>}
                <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                  {eq.min_temp_c ?? '—'} … {eq.max_temp_c ?? '—'}°C
                </td>
                {columns.map(ct => {
                  const existingLog = tempLogs.find(l => l.equipment_id === eq.id
                    && (ct ? l.capture_time_id === ct.id : l.capture_time_id == null))
                  return (
                    <td key={ct?.id ?? 'adhoc'} className="px-3 py-2">
                      <TempCell
                        equipment={eq}
                        captureTime={ct}
                        existingLog={existingLog}
                        onSave={body => createTemp.mutate(body)}
                        onOutOfRange={setPendingOutOfRange}
                        isSaving={createTemp.isPending}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingOutOfRange && (
        <RangeCommentModal
          equipment={pendingOutOfRange.equipment}
          temp={pendingOutOfRange.temp}
          isSaving={createTemp.isPending}
          onCancel={() => setPendingOutOfRange(null)}
          onConfirm={action => createTemp.mutate({
            venue_id: pendingOutOfRange.equipment.venue_id,
            equipment_id: pendingOutOfRange.equipment.id,
            capture_time_id: pendingOutOfRange.captureTime?.id ?? null,
            temperature_c: pendingOutOfRange.temp,
            corrective_action: action,
            notes: null,
          })}
        />
      )}
    </>
  )
}
