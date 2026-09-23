// src/pages/FoodSafety.jsx
// SFBB food safety temperature & delivery logs (per venue).

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Thermometer, Truck, Flame, Snowflake, ChefHat, Clock } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import {
  TYPE_LABELS, timeLabel, TempChecksTable,
  DeliveryChecksPanel, HoldChecksPanel, CookingChecksPanel,
} from '@/components/foodSafety/shared'

const TABS = [
  { key: 'today',     label: 'Today',     icon: Thermometer },
  { key: 'equipment', label: 'Equipment', icon: Snowflake },
  { key: 'deliveries',label: 'Deliveries',icon: Truck },
  { key: 'holds',     label: 'Holds',     icon: Flame },
  { key: 'cooking',   label: 'Cooking',   icon: ChefHat },
]

const DEFAULTS = {
  fridge:    { target: 5,   min: -2,  max: 8 },
  freezer:   { target: -18, min: -30, max: -15 },
  hot_hold:  { target: 63,  min: 63,  max: 100 },
  cold_hold: { target: 5,   min: -2,  max: 8 },
  other:     { target: null, min: null, max: null },
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function EquipmentModal({ initial, venueId, onClose, onSave, isSaving }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.equipment_type ?? 'fridge')
  const [target, setTarget] = useState(initial?.target_temp_c ?? DEFAULTS.fridge.target)
  const [min, setMin] = useState(initial?.min_temp_c ?? DEFAULTS.fridge.min)
  const [max, setMax] = useState(initial?.max_temp_c ?? DEFAULTS.fridge.max)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function applyType(t) {
    setType(t)
    const d = DEFAULTS[t] || DEFAULTS.other
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
      equipment_type: type,
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
          <h2 className="text-lg font-semibold">{initial ? 'Edit equipment' : 'Add equipment'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Walk-in fridge 1" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={type} onChange={e => applyType(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
              placeholder="Kitchen / Prep" />
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
            <button type="button" onClick={onClose}
              className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CaptureTimeModal({ initial, venueId, onClose, onSave, isSaving }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [time, setTime] = useState(initial ? timeLabel(initial.time_of_day) : '09:00')

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
              placeholder="e.g. Morning check"
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

export default function FoodSafety() {
  const api = useApi()
  const qc = useQueryClient()

  const [tab, setTab] = useState('today')
  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [eqModal, setEqModal] = useState(null)
  const [ctModal, setCtModal] = useState(null)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const enabled = !!venueId

  const { data: equipment = [], isLoading: eqLoading } = useQuery({
    queryKey: ['fs-equipment', venueId],
    queryFn: () => api.get(`/food-safety/equipment?venue_id=${venueId}`),
    enabled,
  })

  const { data: captureTimes = [] } = useQuery({
    queryKey: ['fs-capture-times', venueId],
    queryFn: () => api.get(`/food-safety/capture-times?venue_id=${venueId}`),
    enabled,
  })

  const { data: deliveries = [] } = useQuery({
    queryKey: ['fs-deliveries', venueId, date],
    queryFn: () => api.get(`/food-safety/deliveries?venue_id=${venueId}&date=${date}`),
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fs-equipment'] })
    qc.invalidateQueries({ queryKey: ['fs-capture-times'] })
    qc.invalidateQueries({ queryKey: ['fs-temp-logs'] })
    qc.invalidateQueries({ queryKey: ['fs-deliveries'] })
    qc.invalidateQueries({ queryKey: ['fs-holds'] })
    qc.invalidateQueries({ queryKey: ['fs-cooking'] })
  }

  const createEq = useMutation({
    mutationFn: body => api.post('/food-safety/equipment', body),
    onSuccess: () => { invalidate(); setEqModal(null) },
  })
  const patchEq = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/food-safety/equipment/${id}`, body),
    onSuccess: () => { invalidate(); setEqModal(null) },
  })
  const deactivateEq = useMutation({
    mutationFn: id => api.delete(`/food-safety/equipment/${id}`),
    onSuccess: invalidate,
  })
  const createCt = useMutation({
    mutationFn: body => api.post('/food-safety/capture-times', body),
    onSuccess: () => { invalidate(); setCtModal(null) },
  })
  const patchCt = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/food-safety/capture-times/${id}`, body),
    onSuccess: () => { invalidate(); setCtModal(null) },
  })
  const deactivateCt = useMutation({
    mutationFn: id => api.delete(`/food-safety/capture-times/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Food safety</h1>
        <div className="flex flex-wrap items-center gap-2">
          {venues.length > 1 && (
            <select value={venueId} onChange={e => setVenueId(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
        </div>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}>
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : tab === 'today' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Equipment temperatures — {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}</h2>
          </div>

          <TempChecksTable
            venueId={venueId}
            date={date}
            emptyState={
              <div className="border rounded-xl p-8 text-center">
                <p className="text-muted-foreground text-sm mb-3">No equipment yet. Add fridges and freezers first.</p>
                <button type="button" onClick={() => setEqModal('new')}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
                  <Plus className="w-4 h-4" /> Add equipment
                </button>
              </div>
            }
          />

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="border rounded-xl p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Deliveries</p>
              <p className="text-2xl font-semibold">{deliveries.length}</p>
            </div>
            <div className="border rounded-xl p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Hold checks</p>
              <p className="text-2xl font-semibold">{holds.length}</p>
            </div>
            <div className="border rounded-xl p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Cooking checks</p>
              <p className="text-2xl font-semibold">{cooking.length}</p>
            </div>
          </div>
        </div>
      ) : tab === 'equipment' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Equipment list</h2>
            <button type="button" onClick={() => setEqModal('new')}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {equipment.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No active equipment.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Min / Max</th>
                    <th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {equipment.map(eq => (
                    <tr key={eq.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{eq.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[eq.equipment_type]}</td>
                      <td className="px-4 py-3">{eq.target_temp_c != null ? `${eq.target_temp_c}°C` : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {eq.min_temp_c ?? '—'} / {eq.max_temp_c ?? '—'}°C
                      </td>
                      <td className="px-4 py-3 space-x-2">
                        <button type="button" onClick={() => setEqModal(eq)} className="text-xs text-primary hover:underline">Edit</button>
                        <button type="button" onClick={() => deactivateEq.mutate(eq.id)} className="text-xs text-red-600 hover:underline">Deactivate</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between items-center mb-4 mt-8">
            <div>
              <h2 className="font-semibold">Capture times</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                When temperature checks happen each day. Shown as a picker on the Today tab —
                leave empty to log a single ad-hoc reading per day instead.
              </p>
            </div>
            <button type="button" onClick={() => setCtModal('new')}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] shrink-0">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {captureTimes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No capture times configured.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Label</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                    <th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {captureTimes.map(ct => (
                    <tr key={ct.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{ct.label}</td>
                      <td className="px-4 py-3 text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> {timeLabel(ct.time_of_day)}
                      </td>
                      <td className="px-4 py-3 space-x-2">
                        <button type="button" onClick={() => setCtModal(ct)} className="text-xs text-primary hover:underline">Edit</button>
                        <button type="button" onClick={() => deactivateCt.mutate(ct.id)} className="text-xs text-red-600 hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'deliveries' ? (
        <div>
          <h2 className="font-semibold mb-4">Delivery checks</h2>
          <DeliveryChecksPanel venueId={venueId} date={date} />
        </div>
      ) : tab === 'holds' ? (
        <div>
          <h2 className="font-semibold mb-4">Hot / cold hold checks</h2>
          <HoldChecksPanel venueId={venueId} date={date} />
        </div>
      ) : tab === 'cooking' ? (
        <div>
          <h2 className="font-semibold mb-4">Cooking / reheat checks</h2>
          <CookingChecksPanel venueId={venueId} date={date} />
        </div>
      ) : null}

      {eqModal && (
        <EquipmentModal
          initial={eqModal === 'new' ? null : eqModal}
          venueId={venueId}
          onClose={() => setEqModal(null)}
          onSave={body => eqModal === 'new'
            ? createEq.mutate(body)
            : patchEq.mutate({ id: eqModal.id, ...body })}
          isSaving={createEq.isPending || patchEq.isPending}
        />
      )}
      {ctModal && (
        <CaptureTimeModal
          initial={ctModal === 'new' ? null : ctModal}
          venueId={venueId}
          onClose={() => setCtModal(null)}
          onSave={body => ctModal === 'new'
            ? createCt.mutate(body)
            : patchCt.mutate({ id: ctModal.id, ...body })}
          isSaving={createCt.isPending || patchCt.isPending}
        />
      )}
    </div>
  )
}
