// src/components/hs/HsSetup.jsx
//
// The per-venue food safety setup shown in H&S settings (HsSettings.jsx):
// fridges & freezers, their check times, hold stations, their check times
// (kept separate: /capture-times vs /hold-capture-times) and cooking
// sessions. The check pages (Food safety, H&S Dashboard widgets) only
// record readings; everything they are set up with lives here.
//
// Lists save as you go: Add / Edit open a small form with its own Save,
// drag reorders straight away, Remove asks to confirm first.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { Plus, X, GripVertical, Clock } from 'lucide-react'
import { useApi } from '@/lib/api'
import {
  TYPE_LABELS, HOLD_TYPE_LABELS, timeLabel, HoldStationModal, HoldCaptureTimeModal,
  CookingSessionsSettings,
} from '@/components/foodSafety/shared'

const EQUIPMENT_DEFAULTS = {
  fridge:    { target: 5,   min: -2,  max: 8 },
  freezer:   { target: -18, min: -30, max: -15 },
  hot_hold:  { target: 63,  min: 63,  max: 100 },
  cold_hold: { target: 5,   min: -2,  max: 8 },
  other:     { target: null, min: null, max: null },
}

// Every query key that shows food safety setup or readings, refreshed
// after any change here so open check pages pick it up.
const FS_KEYS = [
  'fs-equipment', 'fs-capture-times', 'fs-temp-logs', 'fs-hold-stations',
  'fs-hold-capture-times', 'fs-holds', 'fs-cooking-sessions', 'fs-cooking',
  'dashboard-hs-status-today', 'dashboard-hs-status-week',
]

export const SETUP_SECTIONS = [
  { key: 'equipment',          label: 'Fridges & freezers' },
  { key: 'capture_times',      label: 'Fridge check times' },
  { key: 'hold_stations',      label: 'Hold stations' },
  { key: 'hold_capture_times', label: 'Hold check times' },
  { key: 'cooking_sessions',   label: 'Cooking sessions' },
]

export function HsSetupSection({ section, venueId }) {
  if (!venueId) return <p className="text-sm text-muted-foreground py-6">Pick a venue first.</p>
  switch (section) {
    case 'equipment':          return <EquipmentSettings venueId={venueId} />
    case 'capture_times':      return <CaptureTimesSettings venueId={venueId} kind="temp" />
    case 'hold_stations':      return <HoldStationsSettings venueId={venueId} />
    case 'hold_capture_times': return <CaptureTimesSettings venueId={venueId} kind="hold" />
    case 'cooking_sessions':   return <CookingSessionsSettings venueId={venueId} />
    default:                   return null
  }
}

// ── Shared list pieces ─────────────────────────────────────────

function useFsInvalidate() {
  const qc = useQueryClient()
  return () => { for (const k of FS_KEYS) qc.invalidateQueries({ queryKey: [k] }) }
}

function SectionHead({ hint, onAdd }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <p className="text-sm text-muted-foreground">{hint}</p>
      <button type="button" onClick={onAdd}
        className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 min-h-[44px] text-sm font-medium touch-manipulation shrink-0">
        <Plus className="w-4 h-4" /> Add
      </button>
    </div>
  )
}

function RowActions({ confirming, busy, removeLabel = 'Remove', onEdit, onRemove, onConfirm, onCancel }) {
  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onConfirm} disabled={busy}
          className="text-xs font-medium rounded-md px-3 min-h-[40px] bg-destructive text-destructive-foreground touch-manipulation disabled:opacity-50">
          Yes, {removeLabel.toLowerCase()}
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs rounded-md px-3 min-h-[40px] border touch-manipulation">Cancel</button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={onEdit}
        className="text-xs text-primary rounded-md px-2 min-h-[40px] hover:bg-accent touch-manipulation">Edit</button>
      <button type="button" onClick={onRemove}
        className="text-xs text-red-600 rounded-md px-2 min-h-[40px] hover:bg-accent touch-manipulation">{removeLabel}</button>
    </div>
  )
}

function SortableItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 pl-1 pr-2 py-1.5 bg-background">
      <button type="button" {...attributes} {...listeners}
        className="w-10 h-10 shrink-0 flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation"
        title="Drag to reorder" aria-label="Drag to reorder">
        <GripVertical className="w-4 h-4" />
      </button>
      {children}
    </li>
  )
}

// A sortable list of named things (fridges, hold stations): drag handle,
// details, Edit / Remove (soft delete via DELETE, confirmed inline).
function SortableList({ rows, onReorder, render, confirmId, setConfirmId, removing, onEdit, onRemove, removeLabel }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 6 } }),
  )
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    onReorder(arrayMove(rows, rows.findIndex(r => r.id === active.id), rows.findIndex(r => r.id === over.id)))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
      <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
        <ul className="border rounded-lg divide-y">
          {rows.map(r => (
            <SortableItem key={r.id} id={r.id}>
              <div className="flex-1 min-w-0">{render(r)}</div>
              <RowActions confirming={confirmId === r.id} busy={removing} removeLabel={removeLabel}
                onEdit={() => onEdit(r)} onRemove={() => setConfirmId(r.id)}
                onConfirm={() => onRemove(r.id)} onCancel={() => setConfirmId(null)} />
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function rangeText(r) {
  const t = r.target_temp_c != null ? `target ${r.target_temp_c}°C` : null
  const mm = r.min_temp_c != null || r.max_temp_c != null ? `${r.min_temp_c ?? '—'} to ${r.max_temp_c ?? '—'}°C` : null
  return [t, mm].filter(Boolean).join(' · ')
}

// ── Fridges & freezers ─────────────────────────────────────────

function EquipmentSettings({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const invalidate = useFsInvalidate()
  const [modal, setModal] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const key = ['fs-equipment', venueId]
  const { data: rows = [], isLoading } = useQuery({
    queryKey: key, queryFn: () => api.get(`/food-safety/equipment?venue_id=${venueId}`),
  })
  const create = useMutation({ mutationFn: b => api.post('/food-safety/equipment', b), onSuccess: () => { invalidate(); setModal(null) } })
  const patch  = useMutation({ mutationFn: ({ id, ...b }) => api.patch(`/food-safety/equipment/${id}`, b), onSuccess: () => { invalidate(); setModal(null) } })
  const remove = useMutation({ mutationFn: id => api.delete(`/food-safety/equipment/${id}`), onSuccess: () => { invalidate(); setConfirmId(null) } })
  const reorder = useMutation({ mutationFn: ids => api.patch('/food-safety/equipment/reorder', { ids }), onError: invalidate })

  return (
    <div>
      <SectionHead hint="The fridges and freezers checked each day, with their safe range. Drag to set the order they appear in." onAdd={() => setModal('new')} />
      {isLoading ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg">No fridges or freezers yet.</p>
      ) : (
        <SortableList rows={rows} removeLabel="Deactivate"
          confirmId={confirmId} setConfirmId={setConfirmId} removing={remove.isPending}
          onEdit={setModal} onRemove={id => remove.mutate(id)}
          onReorder={next => { qc.setQueryData(key, next); reorder.mutate(next.map(r => r.id)) }}
          render={r => (
            <>
              <span className="block text-sm font-medium truncate">{r.name}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {[TYPE_LABELS[r.equipment_type], rangeText(r), r.location].filter(Boolean).join(' · ')}
              </span>
            </>
          )} />
      )}
      {modal && (
        <EquipmentModal initial={modal === 'new' ? null : modal} venueId={venueId}
          onClose={() => setModal(null)} isSaving={create.isPending || patch.isPending}
          error={create.error || patch.error}
          onSave={b => modal === 'new' ? create.mutate(b) : patch.mutate({ id: modal.id, ...b })} />
      )}
    </div>
  )
}

function EquipmentModal({ initial, venueId, onClose, onSave, isSaving, error }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.equipment_type ?? 'fridge')
  const [target, setTarget] = useState(initial?.target_temp_c ?? EQUIPMENT_DEFAULTS.fridge.target)
  const [min, setMin] = useState(initial?.min_temp_c ?? EQUIPMENT_DEFAULTS.fridge.min)
  const [max, setMax] = useState(initial?.max_temp_c ?? EQUIPMENT_DEFAULTS.fridge.max)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function applyType(t) {
    setType(t)
    const d = EQUIPMENT_DEFAULTS[t] || EQUIPMENT_DEFAULTS.other
    setTarget(d.target); setMin(d.min); setMax(d.max)
  }
  const num = v => v != null && v !== '' ? Number(v) : null
  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      venue_id: venueId, name: name.trim(), equipment_type: type,
      target_temp_c: num(target), min_temp_c: num(min), max_temp_c: num(max),
      location: location.trim() || null, notes: notes.trim() || null,
    })
  }

  return (
    <FormModal title={initial ? 'Edit fridge / freezer' : 'Add fridge / freezer'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name *">
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" placeholder="Walk-in fridge 1" />
        </Field>
        <Field label="Type">
          <select value={type} onChange={e => applyType(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          {[['Target °C', target, setTarget], ['Min °C', min, setMin], ['Max °C', max, setMax]].map(([l, v, set]) => (
            <Field key={l} label={l} small>
              <input type="number" step="0.1" value={v ?? ''} onChange={e => set(e.target.value)}
                className="w-full border rounded px-2 py-2 text-sm bg-background min-h-[44px]" />
            </Field>
          ))}
        </div>
        <Field label="Location">
          <input value={location} onChange={e => setLocation(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" placeholder="Kitchen / Prep" />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
        </Field>
        <FormButtons isSaving={isSaving} disabled={!name.trim()} onClose={onClose} error={error} />
      </form>
    </FormModal>
  )
}

// ── Hold stations ──────────────────────────────────────────────

function HoldStationsSettings({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const invalidate = useFsInvalidate()
  const [modal, setModal] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const key = ['fs-hold-stations', venueId]
  const { data: rows = [], isLoading } = useQuery({
    queryKey: key, queryFn: () => api.get(`/food-safety/hold-stations?venue_id=${venueId}`),
  })
  const create = useMutation({ mutationFn: b => api.post('/food-safety/hold-stations', b), onSuccess: () => { invalidate(); setModal(null) } })
  const patch  = useMutation({ mutationFn: ({ id, ...b }) => api.patch(`/food-safety/hold-stations/${id}`, b), onSuccess: () => { invalidate(); setModal(null) } })
  const remove = useMutation({ mutationFn: id => api.delete(`/food-safety/hold-stations/${id}`), onSuccess: () => { invalidate(); setConfirmId(null) } })
  const reorder = useMutation({ mutationFn: ids => api.patch('/food-safety/hold-stations/reorder', { ids }), onError: invalidate })

  return (
    <div>
      <SectionHead hint="Hot and cold holding stations (bain-marie, salad bar, ...) and their safe range. Drag to set the order." onAdd={() => setModal('new')} />
      {isLoading ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg">No hold stations yet.</p>
      ) : (
        <SortableList rows={rows} removeLabel="Deactivate"
          confirmId={confirmId} setConfirmId={setConfirmId} removing={remove.isPending}
          onEdit={setModal} onRemove={id => remove.mutate(id)}
          onReorder={next => { qc.setQueryData(key, next); reorder.mutate(next.map(r => r.id)) }}
          render={r => (
            <>
              <span className="block text-sm font-medium truncate">{r.name}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {[HOLD_TYPE_LABELS[r.hold_type], rangeText(r)].filter(Boolean).join(' · ')}
              </span>
            </>
          )} />
      )}
      {modal && (
        <HoldStationModal initial={modal === 'new' ? null : modal} venueId={venueId}
          onClose={() => setModal(null)} isSaving={create.isPending || patch.isPending}
          onSave={b => modal === 'new' ? create.mutate(b) : patch.mutate({ id: modal.id, ...b })} />
      )}
    </div>
  )
}

// ── Check times (fridges: /capture-times, holds: /hold-capture-times) ──

function CaptureTimesSettings({ venueId, kind }) {
  const api = useApi()
  const invalidate = useFsInvalidate()
  const [modal, setModal] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const path = kind === 'hold' ? '/food-safety/hold-capture-times' : '/food-safety/capture-times'
  const key = [kind === 'hold' ? 'fs-hold-capture-times' : 'fs-capture-times', venueId]
  const { data: rows = [], isLoading } = useQuery({ queryKey: key, queryFn: () => api.get(`${path}?venue_id=${venueId}`) })
  const create = useMutation({ mutationFn: b => api.post(path, b), onSuccess: () => { invalidate(); setModal(null) } })
  const patch  = useMutation({ mutationFn: ({ id, ...b }) => api.patch(`${path}/${id}`, b), onSuccess: () => { invalidate(); setModal(null) } })
  const remove = useMutation({ mutationFn: id => api.delete(`${path}/${id}`), onSuccess: () => { invalidate(); setConfirmId(null) } })

  const hint = kind === 'hold'
    ? 'When hot and cold hold checks happen each day. Leave empty to log one reading per station per day.'
    : 'When fridge and freezer temperatures are checked each day. Leave empty to log one reading per fridge per day.'

  return (
    <div>
      <SectionHead hint={`${hint} Listed in time order.`} onAdd={() => setModal('new')} />
      {isLoading ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg">No check times yet.</p>
      ) : (
        <ul className="border rounded-lg divide-y">
          {rows.map(r => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-1.5">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{timeLabel(r.time_of_day)}</span>
              </span>
              <RowActions confirming={confirmId === r.id} busy={remove.isPending}
                onEdit={() => setModal(r)} onRemove={() => setConfirmId(r.id)}
                onConfirm={() => remove.mutate(r.id)} onCancel={() => setConfirmId(null)} />
            </li>
          ))}
        </ul>
      )}
      {modal && kind === 'hold' && (
        <HoldCaptureTimeModal initial={modal === 'new' ? null : modal} venueId={venueId}
          onClose={() => setModal(null)} isSaving={create.isPending || patch.isPending}
          onSave={b => modal === 'new' ? create.mutate(b) : patch.mutate({ id: modal.id, ...b })} />
      )}
      {modal && kind !== 'hold' && (
        <CaptureTimeModal initial={modal === 'new' ? null : modal} venueId={venueId}
          onClose={() => setModal(null)} isSaving={create.isPending || patch.isPending}
          error={create.error || patch.error}
          onSave={b => modal === 'new' ? create.mutate(b) : patch.mutate({ id: modal.id, ...b })} />
      )}
    </div>
  )
}

function CaptureTimeModal({ initial, venueId, onClose, onSave, isSaving, error }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [time, setTime] = useState(initial ? timeLabel(initial.time_of_day) : '09:00')
  function submit(e) {
    e.preventDefault()
    if (!label.trim() || !time) return
    onSave({ venue_id: venueId, label: label.trim(), time_of_day: time })
  }
  return (
    <FormModal title={initial ? 'Edit fridge check time' : 'Add fridge check time'} onClose={onClose} narrow>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Label *">
          <input value={label} onChange={e => setLabel(e.target.value)} required autoFocus placeholder="e.g. Morning check"
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
        </Field>
        <Field label="Time *">
          <input type="time" value={time} onChange={e => setTime(e.target.value)} required
            className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
        </Field>
        <FormButtons isSaving={isSaving} disabled={!label.trim()} onClose={onClose} error={error} />
      </form>
    </FormModal>
  )
}

// ── Small form bits ────────────────────────────────────────────

function FormModal({ title, onClose, narrow, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className={`bg-background rounded-xl shadow-xl w-full ${narrow ? 'max-w-sm' : 'max-w-md'} max-h-[85vh] overflow-y-auto p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent touch-manipulation"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, small, children }) {
  return (
    <div>
      <label className={`block ${small ? 'text-xs' : 'text-sm'} font-medium mb-1`}>{label}</label>
      {children}
    </div>
  )
}

function FormButtons({ isSaving, disabled, onClose, error }) {
  return (
    <>
      {error && <p className="text-sm text-destructive">{error.body?.error || error.message}</p>}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={isSaving || disabled}
          className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px] touch-manipulation">Cancel</button>
      </div>
    </>
  )
}
