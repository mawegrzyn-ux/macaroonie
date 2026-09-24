// src/components/foodSafety/shared.jsx
//
// Pieces shared between the Food safety page's own tabs and the H&S
// Dashboard's widgets — both need the exact same equipment ×
// capture-time grid, delivery/hold/cooking check logs and their
// logging forms, so they live here once rather than being copied.

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, AlertTriangle, Check, Minus, Settings } from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const AUTOSAVE_DEBOUNCE_MS = 600

export const TYPE_LABELS = {
  fridge: 'Fridge', freezer: 'Freezer', hot_hold: 'Hot hold',
  cold_hold: 'Cold hold', other: 'Other',
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

// One equipment × capture-time cell: pre-filled with today's already-logged
// reading (if any) and always directly editable — no modal, no save button.
// Plus/minus steppers either side for tablet use; any change (typing or a
// stepper tap) autosaves after a short debounce, and immediately on blur —
// including out-of-range values, which save immediately with no popup.
// A reading that's out of range and still missing a corrective action is
// flagged red; once a corrective action has been recorded (via the
// end-of-day review, see EndOfDayReview below) it's flagged amber instead,
// so the "still needs attention" cases stay visually distinct.
export function TempCell({ equipment, captureTime, existingLog, onSave, isSaving }) {
  const [value, setValue] = useState(() =>
    existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  const timerRef = useRef(null)

  // Resync from the server value after a save round-trips — but never
  // while the operator is mid-edit, since this effect only fires when the
  // *existing log itself* changes.
  useEffect(() => {
    setValue(existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  }, [existingLog?.id, existingLog?.temperature_c])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function attemptSave(raw) {
    if (raw === '') return
    const temp = Number(raw)
    if (Number.isNaN(temp)) return
    onSave({
      venue_id: equipment.venue_id,
      equipment_id: equipment.id,
      capture_time_id: captureTime?.id ?? null,
      temperature_c: temp,
      // Carry forward any corrective action already on this slot (e.g. from
      // the end-of-day review) rather than wiping it out on every re-touch
      // of the stepper — a plain autosave here isn't the place to collect
      // a fresh one.
      corrective_action: existingLog?.corrective_action ?? null,
      notes: existingLog?.notes ?? null,
    })
  }

  function scheduleSave(raw) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => attemptSave(raw), AUTOSAVE_DEBOUNCE_MS)
  }

  function flushSave() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    attemptSave(value)
  }

  function bump(delta) {
    const current = value === '' ? (equipment.target_temp_c ?? 0) : Number(value)
    const next = String(Math.round((current + delta) * 10) / 10)
    setValue(next)
    scheduleSave(next)
  }

  const isCurrentReading = value === (existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  const unresolved = isCurrentReading && existingLog?.is_within_range === false && !existingLog?.corrective_action
  const resolved   = isCurrentReading && existingLog?.is_within_range === false && !!existingLog?.corrective_action

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => bump(-0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Decrease ${equipment.name} temperature`}>
        <Minus className="w-4 h-4" />
      </button>
      <input type="number" step="0.1" inputMode="decimal" value={value}
        onChange={e => { setValue(e.target.value); scheduleSave(e.target.value) }}
        onBlur={flushSave}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder={equipment.target_temp_c != null ? String(equipment.target_temp_c) : '—'}
        title={resolved ? `Out of range — corrective action logged: ${existingLog.corrective_action}` : undefined}
        className={cn(
          'w-16 text-center text-sm font-semibold border rounded-lg px-1 py-2 bg-background min-h-[40px] touch-manipulation',
          unresolved && 'border-red-400 bg-red-50 text-red-700',
          resolved && 'border-amber-300 bg-amber-50 text-amber-700',
          isSaving && 'opacity-60',
        )} />
      <button type="button" onClick={() => bump(0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Increase ${equipment.name} temperature`}>
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

// Full equipment × capture-time grid for one venue/date — the entire "Today"
// experience (data fetching, inline entry) as a single drop-in component.
// Out-of-range readings save immediately, same as any other value — a
// corrective action can be attached later via EndOfDayReview rather than
// gating the save itself. Used by the Food safety page's Today tab and by
// the H&S Dashboard's temperature-check widget card.
export function TempChecksTable({ venueId, date, emptyState, showType = true }) {
  const api = useApi()
  const qc = useQueryClient()

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fs-temp-logs', venueId, date] }),
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

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}
function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function emptyDeliveryForm(date) {
  return {
    id: null, delivery_date: date, vendor_name: '',
    packaging_ok: true, damage_ok: true, quality_ok: true, temp_ok: true,
    product_temp_c: '', accepted: true, corrective_action: '', notes: '',
  }
}

function DeliveryTick({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer touch-manipulation min-h-[36px]">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="rounded w-4 h-4" />
      {label}
    </label>
  )
}

// Full delivery-checks experience for one venue: an always-visible entry
// form (new or editing) on the left, and the current week's logged
// deliveries on the right — clicking one loads it into the form so it can
// be corrected without re-typing everything. Replaces the old
// modal-per-entry flow for the Food safety page's Deliveries tab
// (DeliveryChecksPanel/DeliveryModal above stay as they are, still used by
// the H&S Dashboard's compact delivery-checks widget).
export function DeliveryChecksBoard({ venueId, date }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState(() => emptyDeliveryForm(date))

  const weekStart = mondayOf(date)
  const weekEnd = addDaysISO(weekStart, 6)

  const enabled = !!venueId
  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['fs-deliveries-week', venueId, weekStart],
    queryFn: () => api.get(`/food-safety/deliveries?venue_id=${venueId}&from=${weekStart}&to=${weekEnd}&limit=200`),
    enabled,
  })

  const createDelivery = useMutation({
    mutationFn: body => api.post('/food-safety/deliveries', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fs-deliveries-week', venueId, weekStart] })
      setForm(emptyDeliveryForm(date))
    },
  })
  const updateDelivery = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/food-safety/deliveries/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fs-deliveries-week', venueId, weekStart] }),
  })

  // Re-anchor to the newly selected date's week whenever the page's date
  // picker moves — but never clobber an in-progress edit or partially
  // filled new entry.
  useEffect(() => {
    setForm(f => (f.id ? f : emptyDeliveryForm(date)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  if (!enabled) return null

  function loadIntoForm(d) {
    setForm({
      id: d.id, delivery_date: d.delivery_date, vendor_name: d.vendor_name,
      packaging_ok: d.packaging_ok, damage_ok: d.damage_ok, quality_ok: d.quality_ok, temp_ok: d.temp_ok,
      product_temp_c: d.product_temp_c ?? '', accepted: d.accepted,
      corrective_action: d.corrective_action ?? '', notes: d.notes ?? '',
    })
  }

  function submit(e) {
    e.preventDefault()
    if (!form.vendor_name.trim()) return
    const body = {
      venue_id: venueId,
      delivery_date: form.delivery_date,
      vendor_name: form.vendor_name.trim(),
      packaging_ok: form.packaging_ok,
      damage_ok: form.damage_ok,
      quality_ok: form.quality_ok,
      temp_ok: form.temp_ok,
      product_temp_c: form.product_temp_c !== '' ? Number(form.product_temp_c) : null,
      accepted: form.accepted,
      corrective_action: form.corrective_action.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (form.id) updateDelivery.mutate({ id: form.id, ...body })
    else createDelivery.mutate(body)
  }

  const isSaving = createDelivery.isPending || updateDelivery.isPending
  const isEditing = !!form.id

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <form onSubmit={submit} className="flex-1 min-w-0 border rounded-xl p-4 space-y-3 h-fit">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{isEditing ? `Editing — ${form.vendor_name || 'delivery'}` : 'New delivery check'}</h3>
          {isEditing && (
            <button type="button" onClick={() => setForm(emptyDeliveryForm(date))} className="text-xs text-muted-foreground hover:underline touch-manipulation">
              Cancel edit
            </button>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Date *</label>
            <input type="date" value={form.delivery_date} required
              onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vendor *</label>
            <input value={form.vendor_name} required placeholder="Supplier name"
              onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border rounded p-3">
          <DeliveryTick label="Packaging OK" value={form.packaging_ok} onChange={v => setForm(f => ({ ...f, packaging_ok: v }))} />
          <DeliveryTick label="No damage" value={form.damage_ok} onChange={v => setForm(f => ({ ...f, damage_ok: v }))} />
          <DeliveryTick label="Quality OK" value={form.quality_ok} onChange={v => setForm(f => ({ ...f, quality_ok: v }))} />
          <DeliveryTick label="Temperature OK" value={form.temp_ok} onChange={v => setForm(f => ({ ...f, temp_ok: v }))} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">Product temp °C</label>
            <input type="number" step="0.1" value={form.product_temp_c}
              onChange={e => setForm(f => ({ ...f, product_temp_c: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div className="pb-2.5">
            <DeliveryTick label="Accepted" value={form.accepted} onChange={v => setForm(f => ({ ...f, accepted: v }))} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Corrective action</label>
          <input value={form.corrective_action}
            onChange={e => setForm(f => ({ ...f, corrective_action: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea value={form.notes} rows={2}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
        </div>
        <button type="submit" disabled={isSaving || !form.vendor_name.trim()}
          className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
          {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Log delivery'}
        </button>
      </form>

      <div className="lg:w-80 shrink-0 border rounded-xl p-3 space-y-2 max-h-[640px] overflow-y-auto">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          This week · {format(new Date(weekStart + 'T12:00:00'), 'd MMM')}–{format(new Date(weekEnd + 'T12:00:00'), 'd MMM')}
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No deliveries logged this week.</p>
        ) : (
          <ul className="space-y-1.5">
            {deliveries.map(d => (
              <li key={d.id}>
                <button type="button" onClick={() => loadIntoForm(d)}
                  className={cn(
                    'w-full text-left flex items-center justify-between gap-2 text-sm border rounded-lg px-3 py-2 touch-manipulation hover:bg-accent min-h-[44px]',
                    form.id === d.id && 'border-primary bg-primary/5',
                  )}>
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{d.vendor_name}</span>
                    <span className="block text-[11px] text-muted-foreground">{format(new Date(d.delivery_date + 'T12:00:00'), 'EEE d MMM')}</span>
                  </span>
                  <Badge ok={d.accepted}>{d.accepted ? 'OK' : 'Rejected'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Hot / cold hold checks ───────────────────────────────────────
//
// "Fridges-style" setup — named stations with their own target/min/max,
// kept as their own tab/concept rather than folded into fs_equipment.
// HoldCell/HoldChecksTable mirror TempCell/TempChecksTable exactly, just
// posting station_id instead of equipment_id — a deliberate small
// duplication (see CLAUDE.md's architecture notes) rather than a shared
// abstraction, since Holds is meant to stay organisationally distinct
// from Equipment even though the interaction pattern is identical.

export const HOLD_TYPE_LABELS = { hot_hold: 'Hot hold', cold_hold: 'Cold hold' }

export function HoldStationModal({ initial, venueId, onClose, onSave, isSaving }) {
  const DEFAULTS = {
    hot_hold:  { target: 63, min: 63, max: 100 },
    cold_hold: { target: 5,  min: -2, max: 8 },
  }
  const [name, setName] = useState(initial?.name ?? '')
  const [holdType, setHoldType] = useState(initial?.hold_type ?? 'hot_hold')
  const [target, setTarget] = useState(initial?.target_temp_c ?? DEFAULTS.hot_hold.target)
  const [min, setMin] = useState(initial?.min_temp_c ?? DEFAULTS.hot_hold.min)
  const [max, setMax] = useState(initial?.max_temp_c ?? DEFAULTS.hot_hold.max)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function applyType(t) {
    setHoldType(t)
    const d = DEFAULTS[t]
    setTarget(d.target)
    setMin(d.min)
    setMax(d.max)
  }

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      venue_id: venueId,
      name: name.trim(),
      hold_type: holdType,
      target_temp_c: target != null && target !== '' ? Number(target) : null,
      min_temp_c: min != null && min !== '' ? Number(min) : null,
      max_temp_c: max != null && max !== '' ? Number(max) : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{initial ? 'Edit hold station' : 'Add hold station'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Bain-marie 1 / Salad bar" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={holdType} onChange={e => applyType(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {Object.entries(HOLD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Target °C</label>
              <input type="number" step="0.1" value={target ?? ''} onChange={e => setTarget(e.target.value)}
                className="w-full border rounded px-2 py-2 text-sm bg-background min-h-[44px]" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Min °C</label>
              <input type="number" step="0.1" value={min ?? ''} onChange={e => setMin(e.target.value)}
                className="w-full border rounded px-2 py-2 text-sm bg-background min-h-[44px]" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Max °C</label>
              <input type="number" step="0.1" value={max ?? ''} onChange={e => setMax(e.target.value)}
                className="w-full border rounded px-2 py-2 text-sm bg-background min-h-[44px]" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <input value={location} onChange={e => setLocation(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Kitchen / Front counter" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !name.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function HoldCaptureTimeModal({ initial, venueId, onClose, onSave, isSaving }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [time, setTime] = useState(initial ? timeLabel(initial.time_of_day) : '12:00')

  function submit(e) {
    e.preventDefault()
    if (!label.trim() || !time) return
    onSave({ venue_id: venueId, label: label.trim(), time_of_day: time })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{initial ? 'Edit capture time' : 'Add capture time'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Label *</label>
            <input value={label} onChange={e => setLabel(e.target.value)} required
              placeholder="e.g. Lunch service"
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Time *</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !label.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// One hold station × capture-time cell — identical interaction to TempCell
// (autosave on type/stepper, debounced, out-of-range saves immediately —
// see the note on TempCell) but posts station_id instead of equipment_id.
function HoldCell({ station, captureTime, existingLog, onSave, isSaving }) {
  const [value, setValue] = useState(() =>
    existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  const timerRef = useRef(null)

  useEffect(() => {
    setValue(existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  }, [existingLog?.id, existingLog?.temperature_c])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function attemptSave(raw) {
    if (raw === '') return
    const temp = Number(raw)
    if (Number.isNaN(temp)) return
    onSave({
      venue_id: station.venue_id,
      station_id: station.id,
      capture_time_id: captureTime?.id ?? null,
      temperature_c: temp,
      corrective_action: existingLog?.corrective_action ?? null,
      notes: existingLog?.notes ?? null,
    })
  }

  function scheduleSave(raw) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => attemptSave(raw), AUTOSAVE_DEBOUNCE_MS)
  }

  function flushSave() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    attemptSave(value)
  }

  function bump(delta) {
    const current = value === '' ? (station.target_temp_c ?? 0) : Number(value)
    const next = String(Math.round((current + delta) * 10) / 10)
    setValue(next)
    scheduleSave(next)
  }

  const isCurrentReading = value === (existingLog?.temperature_c != null ? String(existingLog.temperature_c) : '')
  const unresolved = isCurrentReading && existingLog?.is_within_range === false && !existingLog?.corrective_action
  const resolved   = isCurrentReading && existingLog?.is_within_range === false && !!existingLog?.corrective_action

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => bump(-0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Decrease ${station.name} temperature`}>
        <Minus className="w-4 h-4" />
      </button>
      <input type="number" step="0.1" inputMode="decimal" value={value}
        onChange={e => { setValue(e.target.value); scheduleSave(e.target.value) }}
        onBlur={flushSave}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder={station.target_temp_c != null ? String(station.target_temp_c) : '—'}
        title={resolved ? `Out of range — corrective action logged: ${existingLog.corrective_action}` : undefined}
        className={cn(
          'w-16 text-center text-sm font-semibold border rounded-lg px-1 py-2 bg-background min-h-[40px] touch-manipulation',
          unresolved && 'border-red-400 bg-red-50 text-red-700',
          resolved && 'border-amber-300 bg-amber-50 text-amber-700',
          isSaving && 'opacity-60',
        )} />
      <button type="button" onClick={() => bump(0.5)}
        className="w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
        aria-label={`Increase ${station.name} temperature`}>
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

// Full hold-station × capture-time grid for one venue/date — the grid-only
// piece (station/capture-time management stays on the Food safety page's
// Holds tab, same split as Equipment vs TempChecksTable). Used by the
// Holds tab and the H&S Dashboard's hold-checks widget.
export function HoldChecksTable({ venueId, date, emptyState, showType = true }) {
  const api = useApi()
  const qc = useQueryClient()

  const enabled = !!venueId

  const { data: stations = [], isLoading } = useQuery({
    queryKey: ['fs-hold-stations', venueId],
    queryFn: () => api.get(`/food-safety/hold-stations?venue_id=${venueId}`),
    enabled,
  })
  const { data: captureTimes = [] } = useQuery({
    queryKey: ['fs-hold-capture-times', venueId],
    queryFn: () => api.get(`/food-safety/hold-capture-times?venue_id=${venueId}`),
    enabled,
  })
  const { data: logs = [] } = useQuery({
    queryKey: ['fs-holds', venueId, date],
    queryFn: () => api.get(`/food-safety/holds?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createHold = useMutation({
    mutationFn: body => api.post('/food-safety/holds', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fs-holds', venueId, date] }),
  })

  if (!enabled) return null
  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
  if (stations.length === 0) {
    return emptyState ?? <p className="text-sm text-muted-foreground py-8 text-center">No hold stations configured for this venue yet.</p>
  }

  const columns = captureTimes.length > 0 ? captureTimes : [null]

  return (
    <div className="border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground sticky left-0 bg-muted/50">Station</th>
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
          {stations.map(st => (
            <tr key={st.id} className="border-b last:border-0">
              <td className="px-4 py-3 font-medium whitespace-nowrap sticky left-0 bg-background">{st.name}</td>
              {showType && <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{HOLD_TYPE_LABELS[st.hold_type]}</td>}
              <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                {st.min_temp_c ?? '—'} … {st.max_temp_c ?? '—'}°C
              </td>
              {columns.map(ct => {
                const existingLog = logs.find(l => l.station_id === st.id
                  && (ct ? l.capture_time_id === ct.id : l.capture_time_id == null))
                return (
                  <td key={ct?.id ?? 'adhoc'} className="px-3 py-2">
                    <HoldCell
                      station={st}
                      captureTime={ct}
                      existingLog={existingLog}
                      onSave={body => createHold.mutate(body)}
                      isSaving={createHold.isPending}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Cooking / reheat checks ──────────────────────────────────────
//
// Menu categories as tabs, menu items as buttons — click a dish, log its
// core temperature (steppers + optional corrective-action note), no
// typing a dish name each time. "Sessions" (configured via the gear icon)
// define how many times a day this happens and how many items must be
// checked each time to meet criteria. A live "today's checks" side panel
// works like a till receipt while working through service.

function CookingSessionForm({ initial, onCancel, onSave, isSaving }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [time, setTime] = useState(initial?.time_of_day ? timeLabel(initial.time_of_day) : '')
  const [count, setCount] = useState(initial?.required_items_count ?? 1)

  function submit(e) {
    e.preventDefault()
    if (!label.trim()) return
    onSave({ label: label.trim(), time_of_day: time || null, required_items_count: Number(count) || 1 })
  }

  return (
    <form onSubmit={submit} className="space-y-2 border rounded-lg p-3">
      <div>
        <label className="block text-xs font-medium mb-1">Label *</label>
        <input value={label} onChange={e => setLabel(e.target.value)} required autoFocus
          placeholder="e.g. Lunch service"
          className="w-full border rounded px-2 py-1.5 text-sm bg-background min-h-[40px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium mb-1">Time (optional)</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm bg-background min-h-[40px]" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Items required</label>
          <input type="number" min={1} value={count} onChange={e => setCount(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm bg-background min-h-[40px]" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={isSaving || !label.trim()}
          className="flex-1 bg-primary text-primary-foreground rounded px-3 py-2 text-sm font-medium min-h-[40px] disabled:opacity-50">
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 border rounded text-sm min-h-[40px]">Cancel</button>
      </div>
    </form>
  )
}

function CookingSessionsModal({ venueId, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState(null) // 'new' | session row | null

  const { data: sessions = [] } = useQuery({
    queryKey: ['fs-cooking-sessions', venueId],
    queryFn: () => api.get(`/food-safety/cooking-sessions?venue_id=${venueId}`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fs-cooking-sessions', venueId] })
  const create = useMutation({
    mutationFn: body => api.post('/food-safety/cooking-sessions', body),
    onSuccess: () => { invalidate(); setForm(null) },
  })
  const patch = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/food-safety/cooking-sessions/${id}`, body),
    onSuccess: () => { invalidate(); setForm(null) },
  })
  const deactivate = useMutation({
    mutationFn: id => api.delete(`/food-safety/cooking-sessions/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Cooking check sessions</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          How many times a day cooking checks happen, and how many items must be checked each time to meet criteria.
        </p>

        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No sessions yet.</p>
        ) : (
          <ul className="border rounded-lg divide-y mb-3">
            {sessions.map(s => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.time_of_day ? `${timeLabel(s.time_of_day)} · ` : ''}{s.required_items_count} item{s.required_items_count === 1 ? '' : 's'} required
                  </span>
                </span>
                <button type="button" onClick={() => setForm(s)} className="text-xs text-primary hover:underline">Edit</button>
                <button type="button" onClick={() => deactivate.mutate(s.id)} className="text-xs text-red-600 hover:underline">Remove</button>
              </li>
            ))}
          </ul>
        )}

        {form ? (
          <CookingSessionForm
            initial={form === 'new' ? null : form}
            isSaving={create.isPending || patch.isPending}
            onCancel={() => setForm(null)}
            onSave={body => form === 'new'
              ? create.mutate({ venue_id: venueId, ...body })
              : patch.mutate({ id: form.id, ...body })}
          />
        ) : (
          <button type="button" onClick={() => setForm('new')}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
            <Plus className="w-4 h-4" /> Add session
          </button>
        )}
      </div>
    </div>
  )
}

// The temperature-entry modal for a clicked menu item (or a custom
// off-menu dish). Autosaves like TempCell/HoldCell: the first interaction
// (a stepper tap, typing a temp, or — for a custom dish — naming it)
// creates the check; every change after that debounces a PATCH onto the
// same row rather than creating another one. Closing the modal (X or
// Done) flushes any pending change first, since unmounting would
// otherwise drop it. There's no Cancel — once something's been logged,
// closing just stops editing it rather than undoing it.
function CookingEntryModal({ target, venueId, date, sessionId, onClose, onCreate, onUpdate, isSaving }) {
  const [temp, setTemp] = useState('75')
  const [note, setNote] = useState('')
  const [customName, setCustomName] = useState('')
  const [checkId, setCheckId] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function persist(rawTemp, rawNote) {
    if (rawTemp === '') return
    const coreTemp = Number(rawTemp)
    if (Number.isNaN(coreTemp)) return
    if (checkId) {
      onUpdate(checkId, { core_temp_c: coreTemp, corrective_action: rawNote.trim() || null })
      return
    }
    if (target.custom && !customName.trim()) return
    onCreate({
      venue_id: venueId,
      check_date: date,
      session_id: sessionId || null,
      menu_item_id: target.custom ? null : target.itemId,
      dish_name: target.custom ? customName.trim() : null,
      core_temp_c: coreTemp,
      corrective_action: rawNote.trim() || null,
    }, id => setCheckId(id))
  }

  function scheduleSave(rawTemp, rawNote) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist(rawTemp, rawNote), AUTOSAVE_DEBOUNCE_MS)
  }

  function flushSave() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    persist(temp, note)
  }

  function close() { flushSave(); onClose() }

  function bump(delta) {
    setTemp(prev => {
      const current = prev === '' ? 75 : Number(prev)
      const next = String(Math.round((current + delta) * 10) / 10)
      scheduleSave(next, note)
      return next
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{target.custom ? 'Log a dish' : target.itemName}</h2>
          <button type="button" onClick={close} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-4">
          {target.custom && (
            <div>
              <label className="block text-sm font-medium mb-1">Dish name *</label>
              <input value={customName} onChange={e => setCustomName(e.target.value)}
                onBlur={() => { if (!checkId) persist(temp, note) }} required autoFocus
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-2 text-center">Core temperature °C</label>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={() => bump(-1)}
                className="w-12 h-12 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
                aria-label="Decrease temperature">
                <Minus className="w-5 h-5" />
              </button>
              <input type="number" step="0.1" inputMode="decimal" value={temp}
                onChange={e => { setTemp(e.target.value); scheduleSave(e.target.value, note) }}
                onBlur={flushSave}
                className="w-24 text-center text-xl font-semibold border rounded-lg px-2 py-2 bg-background min-h-[48px]" />
              <button type="button" onClick={() => bump(1)}
                className="w-12 h-12 shrink-0 rounded-lg border flex items-center justify-center hover:bg-accent touch-manipulation"
                aria-label="Increase temperature">
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1">SFBB target: ≥75°C for 30 seconds (or FSA equivalents)</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action (optional)</label>
            <textarea value={note}
              onChange={e => { setNote(e.target.value); scheduleSave(temp, e.target.value) }}
              onBlur={flushSave} rows={2}
              placeholder="e.g. Returned to heat for a further 5 minutes"
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <button type="button" onClick={close}
            className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Full cooking-checks experience for one venue/date: session tabs +
// required-count progress, menu category tabs + item buttons, the
// temp-entry modal, and a live "today's checks" side panel. Used by the
// Food safety page's Cooking tab and the H&S Dashboard's cooking-checks
// widget.
export function CookingChecksPanel({ venueId, date }) {
  const api = useApi()
  const qc = useQueryClient()
  const [sessionId, setSessionId] = useState('')
  const [activeSectionId, setActiveSectionId] = useState('')
  const [entryTarget, setEntryTarget] = useState(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)

  const enabled = !!venueId

  const { data: sessions = [] } = useQuery({
    queryKey: ['fs-cooking-sessions', venueId],
    queryFn: () => api.get(`/food-safety/cooking-sessions?venue_id=${venueId}`),
    enabled,
  })

  useEffect(() => {
    if (sessionId && !sessions.some(s => s.id === sessionId)) setSessionId('')
    if (!sessionId && sessions.length) setSessionId(sessions[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  const { data: menuRows = [] } = useQuery({
    queryKey: ['fs-cooking-menu-items', venueId],
    queryFn: () => api.get(`/food-safety/cooking/menu-items?venue_id=${venueId}`),
    enabled,
  })

  const sections = useMemo(() => {
    const bySection = new Map()
    for (const row of menuRows) {
      if (!bySection.has(row.section_id)) {
        bySection.set(row.section_id, { id: row.section_id, title: row.section_title, items: [] })
      }
      bySection.get(row.section_id).items.push({ id: row.item_id, name: row.item_name })
    }
    return Array.from(bySection.values())
  }, [menuRows])

  useEffect(() => {
    if (activeSectionId && !sections.some(s => s.id === activeSectionId)) setActiveSectionId('')
    if (!activeSectionId && sections.length) setActiveSectionId(sections[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections])

  const { data: checks = [] } = useQuery({
    queryKey: ['fs-cooking', venueId, date],
    queryFn: () => api.get(`/food-safety/cooking?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const createCheck = useMutation({
    mutationFn: body => api.post('/food-safety/cooking', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fs-cooking', venueId, date] }),
  })
  const updateCheck = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/food-safety/cooking/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fs-cooking', venueId, date] }),
  })

  if (!enabled) return null

  const activeSession = sessions.find(s => s.id === sessionId) ?? null
  const sessionChecks = activeSession ? checks.filter(c => c.session_id === activeSession.id) : checks
  const countDone = sessionChecks.length
  const target = activeSession?.required_items_count ?? null
  const activeSection = sections.find(s => s.id === activeSectionId) ?? null

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {sessions.map(s => (
              <button key={s.id} type="button" onClick={() => setSessionId(s.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap touch-manipulation',
                  s.id === sessionId ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}>
                {s.label}
              </button>
            ))}
            {sessions.length === 0 && <span className="text-sm text-muted-foreground">No sessions configured</span>}
          </div>
          <button type="button" onClick={() => setSessionsOpen(true)}
            className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation shrink-0" title="Manage sessions">
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {activeSession && (
          <div className={cn(
            'rounded-lg px-3 py-2 text-sm inline-flex items-center gap-1.5',
            countDone >= target ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
          )}>
            {countDone >= target ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {countDone}/{target} items checked for {activeSession.label}
          </div>
        )}

        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border rounded-xl">
            No menu items yet — build a menu on the Menus page first, or log a custom dish below.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b">
              {sections.map(s => (
                <button key={s.id} type="button" onClick={() => setActiveSectionId(s.id)}
                  className={cn(
                    'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px touch-manipulation',
                    s.id === activeSectionId ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}>
                  {s.title}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(activeSection?.items ?? []).map(item => {
                const countToday = checks.filter(c => c.menu_item_id === item.id).length
                return (
                  <button key={item.id} type="button"
                    onClick={() => setEntryTarget({ itemId: item.id, itemName: item.name })}
                    className="relative border rounded-lg px-3 py-3 text-sm font-medium text-left hover:bg-accent hover:border-primary/40 touch-manipulation min-h-[48px]">
                    {item.name}
                    {countToday > 0 && (
                      <span className="absolute top-1 right-1 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                        {countToday}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <button type="button" onClick={() => setEntryTarget({ custom: true })}
          className="text-xs text-primary hover:underline">
          + Log a dish not on the menu
        </button>
      </div>

      <div className="lg:w-72 shrink-0 border rounded-xl p-3 space-y-2 max-h-[420px] overflow-y-auto">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Today's checks ({checks.length})</p>
        {checks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">None yet</p>
        ) : (
          <ul className="space-y-1.5">
            {checks.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm border-b pb-1.5 last:border-0">
                <span className="min-w-0">
                  <span className="block font-medium truncate">{c.dish_name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {format(new Date(c.recorded_at), 'HH:mm')}{c.session_label ? ` · ${c.session_label}` : ''}
                  </span>
                </span>
                <Badge ok={c.is_within_range}>{c.core_temp_c}°C</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {entryTarget && (
        <CookingEntryModal
          target={entryTarget}
          venueId={venueId}
          date={date}
          sessionId={sessionId}
          onClose={() => setEntryTarget(null)}
          onCreate={(body, cb) => createCheck.mutate(body, { onSuccess: row => cb(row.id) })}
          onUpdate={(id, body) => updateCheck.mutate({ id, ...body })}
          isSaving={createCheck.isPending || updateCheck.isPending}
        />
      )}

      {sessionsOpen && (
        <CookingSessionsModal venueId={venueId} onClose={() => setSessionsOpen(false)} />
      )}
    </div>
  )
}

// ── End of day review ─────────────────────────────────────────────
//
// Temp checks, hold checks and cooking checks all autosave immediately —
// including out-of-range readings — rather than popping up a corrective-
// action prompt on every stepper tap. Instead, any reading that's out of
// range and still missing a corrective action shows up here: one button,
// visible regardless of which tab is active, that cycles through every
// unresolved reading for the day and collects a corrective action for
// each. "Do this later" closes without losing progress — whatever's left
// stays unresolved (and the badge count reflects it) until reopened.
export function EndOfDayReview({ venueId, date }) {
  const api = useApi()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [action, setAction] = useState('')

  const enabled = !!venueId

  const { data: tempLogs = [] } = useQuery({
    queryKey: ['fs-temp-logs', venueId, date],
    queryFn: () => api.get(`/food-safety/temp-logs?venue_id=${venueId}&date=${date}`),
    enabled,
  })
  const { data: holds = [] } = useQuery({
    queryKey: ['fs-holds', venueId, date],
    queryFn: () => api.get(`/food-safety/holds?venue_id=${venueId}&date=${date}`),
    enabled,
  })
  const { data: cooking = [] } = useQuery({
    queryKey: ['fs-cooking', venueId, date],
    queryFn: () => api.get(`/food-safety/cooking?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const unresolved = useMemo(() => {
    const items = []
    for (const l of tempLogs) {
      if (l.is_within_range === false && !l.corrective_action) {
        items.push({
          name: l.equipment_name, temp: l.temperature_c,
          range: `${l.min_temp_c ?? '—'} to ${l.max_temp_c ?? '—'}°C`,
          endpoint: `/food-safety/temp-logs/${l.id}`, invalidateKey: ['fs-temp-logs', venueId, date],
        })
      }
    }
    for (const h of holds) {
      if (h.is_within_range === false && !h.corrective_action) {
        items.push({
          name: h.station_name, temp: h.temperature_c,
          range: `${h.min_temp_c ?? '—'} to ${h.max_temp_c ?? '—'}°C`,
          endpoint: `/food-safety/holds/${h.id}`, invalidateKey: ['fs-holds', venueId, date],
        })
      }
    }
    for (const c of cooking) {
      if (c.is_within_range === false && !c.corrective_action) {
        items.push({
          name: c.dish_name, temp: c.core_temp_c, range: '75°C or above',
          endpoint: `/food-safety/cooking/${c.id}`, invalidateKey: ['fs-cooking', venueId, date],
        })
      }
    }
    return items
  }, [tempLogs, holds, cooking, venueId, date])

  const patch = useMutation({
    mutationFn: ({ endpoint, body }) => api.patch(endpoint, body),
    onSuccess: (_, { invalidateKey }) => qc.invalidateQueries({ queryKey: invalidateKey }),
  })

  if (!enabled) return null

  function openReview() {
    setIndex(0)
    setAction('')
    setOpen(true)
  }

  const current = unresolved[index]
  const isLast = index + 1 >= unresolved.length

  function confirmAndNext() {
    if (!current || !action.trim()) return
    patch.mutate({ endpoint: current.endpoint, body: { corrective_action: action.trim() } }, {
      onSuccess: () => {
        setAction('')
        if (isLast) setOpen(false)
        else setIndex(i => i + 1)
      },
    })
  }

  return (
    <>
      <button type="button" onClick={openReview} disabled={unresolved.length === 0}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation',
          unresolved.length > 0 ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-emerald-50 text-emerald-700 cursor-default',
        )}>
        {unresolved.length > 0 ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
        {unresolved.length > 0 ? `End of day review (${unresolved.length})` : 'End of day — all clear'}
      </button>

      {open && current && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 border-2 border-red-200">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Reading was out of range</h2>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{index + 1} of {unresolved.length}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {current.name} was logged at <strong>{current.temp}°C</strong>, outside the allowed {current.range} range.
              Add a comment on what action was taken.
            </p>
            <label className="block text-sm font-medium mb-1">Corrective action *</label>
            <textarea value={action} onChange={e => setAction(e.target.value)} rows={3} autoFocus
              placeholder="e.g. Adjusted thermostat, moved stock to backup unit, called engineer"
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none mb-4" />
            <div className="flex gap-2">
              <button type="button" disabled={!action.trim() || patch.isPending} onClick={confirmAndNext}
                className="flex-1 bg-red-600 text-white rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
                {patch.isPending ? 'Saving…' : isLast ? 'Confirm & finish' : 'Confirm & next'}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={patch.isPending}
                className="px-4 py-2 border rounded text-sm min-h-[44px]">Do this later</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
