// src/components/foodSafety/shared.jsx
//
// Pieces shared between the Food safety page's own tabs and the H&S
// Dashboard's widgets — both need the exact same equipment ×
// capture-time grid, delivery/hold/cooking check logs and their
// logging forms, so they live here once rather than being copied.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, AlertTriangle, Check, Minus } from 'lucide-react'
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

// ── Delivery checks ─────────────────────────────────────────────

export function DeliveryModal({ venueId, onClose, onSave, isSaving }) {
  const [vendor, setVendor] = useState('')
  const [packaging, setPackaging] = useState(true)
  const [damage, setDamage] = useState(true)
  const [quality, setQuality] = useState(true)
  const [tempOk, setTempOk] = useState(true)
  const [prodTemp, setProdTemp] = useState('')
  const [accepted, setAccepted] = useState(true)
  const [action, setAction] = useState('')
  const [notes, setNotes] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!vendor.trim()) return
    onSave({
      venue_id: venueId,
      vendor_name: vendor.trim(),
      packaging_ok: packaging,
      damage_ok: damage,
      quality_ok: quality,
      temp_ok: tempOk,
      product_temp_c: prodTemp !== '' ? Number(prodTemp) : null,
      accepted,
      corrective_action: action.trim() || null,
      notes: notes.trim() || null,
    })
  }

  const Tick = ({ label, value, onChange }) => (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Delivery check</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor *</label>
            <input value={vendor} onChange={e => setVendor(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" placeholder="Supplier name" />
          </div>
          <div className="space-y-2 border rounded p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Quality ticks</p>
            <Tick label="Packaging OK" value={packaging} onChange={setPackaging} />
            <Tick label="No damage" value={damage} onChange={setDamage} />
            <Tick label="Quality OK" value={quality} onChange={setQuality} />
            <Tick label="Temperature OK" value={tempOk} onChange={setTempOk} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Product temp °C</label>
            <input type="number" step="0.1" value={prodTemp} onChange={e => setProdTemp(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="rounded" />
            Accepted
          </label>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action</label>
            <input value={action} onChange={e => setAction(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !vendor.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save check'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Delivery log for one venue/date, with its own "New check" trigger — the
// entire delivery-checks experience as a single drop-in component. Used by
// the Food safety page's Deliveries tab and the H&S Dashboard's delivery
// widget.
export function DeliveryChecksPanel({ venueId, date, emptyState }) {
  const api = useApi()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const enabled = !!venueId
  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['fs-deliveries', venueId, date],
    queryFn: () => api.get(`/food-safety/deliveries?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createDelivery = useMutation({
    mutationFn: body => api.post('/food-safety/deliveries', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fs-deliveries', venueId, date] })
      setShowModal(false)
    },
  })

  if (!enabled) return null

  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2">
        <p className="text-xs text-muted-foreground">{deliveries.length} logged today</p>
        <button type="button" onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium min-h-[36px] touch-manipulation">
          <Plus className="w-3.5 h-3.5" /> New check
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : deliveries.length === 0 ? (
        emptyState ?? <p className="text-sm text-muted-foreground py-6 text-center">No deliveries logged for this date.</p>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Checks</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Temp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{d.vendor_name}</td>
                  <td className="px-4 py-3 text-xs space-x-1">
                    <Badge ok={d.packaging_ok}>Pkg</Badge>
                    <Badge ok={d.damage_ok}>Dmg</Badge>
                    <Badge ok={d.quality_ok}>Qty</Badge>
                    <Badge ok={d.temp_ok}>T°</Badge>
                  </td>
                  <td className="px-4 py-3">{d.product_temp_c != null ? `${d.product_temp_c}°C` : '—'}</td>
                  <td className="px-4 py-3">
                    <Badge ok={d.accepted}>{d.accepted ? 'Accepted' : 'Rejected'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <DeliveryModal
          venueId={venueId}
          onClose={() => setShowModal(false)}
          onSave={body => createDelivery.mutate(body)}
          isSaving={createDelivery.isPending}
        />
      )}
    </>
  )
}

// ── Hot / cold hold checks ───────────────────────────────────────

export function HoldModal({ venueId, onClose, onSave, isSaving }) {
  const [holdType, setHoldType] = useState('hot_hold')
  const [item, setItem] = useState('')
  const [temp, setTemp] = useState('')
  const [action, setAction] = useState('')
  const [notes, setNotes] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!item.trim() || temp === '') return
    onSave({
      venue_id: venueId,
      hold_type: holdType,
      item_name: item.trim(),
      temperature_c: Number(temp),
      corrective_action: action.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Hold temperature check</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={holdType} onChange={e => setHoldType(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              <option value="hot_hold">Hot hold (≥63°C)</option>
              <option value="cold_hold">Cold hold (≤8°C)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Item / location *</label>
            <input value={item} onChange={e => setItem(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Bain-marie / salad bar" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Temperature °C *</label>
            <input type="number" step="0.1" value={temp} onChange={e => setTemp(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action</label>
            <input value={action} onChange={e => setAction(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !item.trim() || temp === ''}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save check'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Hot/cold hold check log for one venue/date, with its own "New check"
// trigger. Used by the Food safety page's Holds tab and the H&S
// Dashboard's hold-checks widget.
export function HoldChecksPanel({ venueId, date, emptyState }) {
  const api = useApi()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const enabled = !!venueId
  const { data: holds = [], isLoading } = useQuery({
    queryKey: ['fs-holds', venueId, date],
    queryFn: () => api.get(`/food-safety/holds?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createHold = useMutation({
    mutationFn: body => api.post('/food-safety/holds', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fs-holds', venueId, date] })
      setShowModal(false)
    },
  })

  if (!enabled) return null

  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2">
        <p className="text-xs text-muted-foreground">{holds.length} logged today</p>
        <button type="button" onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium min-h-[36px] touch-manipulation">
          <Plus className="w-3.5 h-3.5" /> New check
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : holds.length === 0 ? (
        emptyState ?? <p className="text-sm text-muted-foreground py-6 text-center">No hold checks for this date.</p>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Temp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">OK?</th>
              </tr>
            </thead>
            <tbody>
              {holds.map(h => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-muted-foreground">{h.hold_type === 'hot_hold' ? 'Hot' : 'Cold'}</td>
                  <td className="px-4 py-3 font-medium">{h.item_name}</td>
                  <td className="px-4 py-3">{h.temperature_c}°C</td>
                  <td className="px-4 py-3"><Badge ok={h.is_within_range}>{h.is_within_range ? 'In range' : 'Out'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <HoldModal
          venueId={venueId}
          onClose={() => setShowModal(false)}
          onSave={body => createHold.mutate(body)}
          isSaving={createHold.isPending}
        />
      )}
    </>
  )
}

// ── Cooking / reheat checks ──────────────────────────────────────

export function CookingModal({ venueId, onClose, onSave, isSaving }) {
  const [dish, setDish] = useState('')
  const [temp, setTemp] = useState('')
  const [holdSec, setHoldSec] = useState('')
  const [action, setAction] = useState('')
  const [notes, setNotes] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!dish.trim() || temp === '') return
    onSave({
      venue_id: venueId,
      dish_name: dish.trim(),
      core_temp_c: Number(temp),
      hold_seconds: holdSec !== '' ? parseInt(holdSec, 10) : null,
      corrective_action: action.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Cooking / reheat check</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">SFBB target: core ≥75°C for 30 seconds (or FSA equivalents)</p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Dish *</label>
            <input value={dish} onChange={e => setDish(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" placeholder="Chicken curry batch" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1">Core temp °C *</label>
              <input type="number" step="0.1" value={temp} onChange={e => setTemp(e.target.value)} required
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hold (seconds)</label>
              <input type="number" value={holdSec} onChange={e => setHoldSec(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" placeholder="30" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action</label>
            <input value={action} onChange={e => setAction(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !dish.trim() || temp === ''}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save check'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Cooking/reheat check log for one venue/date, with its own "New check"
// trigger. Used by the Food safety page's Cooking tab and the H&S
// Dashboard's cooking-checks widget.
export function CookingChecksPanel({ venueId, date, emptyState }) {
  const api = useApi()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const enabled = !!venueId
  const { data: cooking = [], isLoading } = useQuery({
    queryKey: ['fs-cooking', venueId, date],
    queryFn: () => api.get(`/food-safety/cooking?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createCooking = useMutation({
    mutationFn: body => api.post('/food-safety/cooking', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fs-cooking', venueId, date] })
      setShowModal(false)
    },
  })

  if (!enabled) return null

  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2">
        <p className="text-xs text-muted-foreground">{cooking.length} logged today</p>
        <button type="button" onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium min-h-[36px] touch-manipulation">
          <Plus className="w-3.5 h-3.5" /> New check
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : cooking.length === 0 ? (
        emptyState ?? <p className="text-sm text-muted-foreground py-6 text-center">No cooking checks for this date.</p>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Dish</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Core temp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Hold</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">OK?</th>
              </tr>
            </thead>
            <tbody>
              {cooking.map(c => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{c.dish_name}</td>
                  <td className="px-4 py-3">{c.core_temp_c}°C</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.hold_seconds != null ? `${c.hold_seconds}s` : '—'}</td>
                  <td className="px-4 py-3"><Badge ok={c.is_within_range}>{c.is_within_range ? '≥75°C' : 'Below'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CookingModal
          venueId={venueId}
          onClose={() => setShowModal(false)}
          onSave={body => createCooking.mutate(body)}
          isSaving={createCooking.isPending}
        />
      )}
    </>
  )
}
