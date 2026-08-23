// src/pages/FoodSafety.jsx
// SFBB food safety temperature & delivery logs (per venue).

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Thermometer, Truck, Flame, Snowflake, ChefHat, AlertTriangle, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

const TABS = [
  { key: 'today',     label: 'Today',     icon: Thermometer },
  { key: 'equipment', label: 'Equipment', icon: Snowflake },
  { key: 'deliveries',label: 'Deliveries',icon: Truck },
  { key: 'holds',     label: 'Holds',     icon: Flame },
  { key: 'cooking',   label: 'Cooking',   icon: ChefHat },
]

const TYPE_LABELS = {
  fridge: 'Fridge', freezer: 'Freezer', hot_hold: 'Hot hold',
  cold_hold: 'Cold hold', other: 'Other',
}

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

function Badge({ ok, children }) {
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

function TempLogModal({ equipment, venueId, onClose, onSave, isSaving }) {
  const [temp, setTemp] = useState('')
  const [action, setAction] = useState('')
  const [notes, setNotes] = useState('')

  function submit(e) {
    e.preventDefault()
    if (temp === '') return
    onSave({
      venue_id: venueId,
      equipment_id: equipment.id,
      temperature_c: Number(temp),
      corrective_action: action.trim() || null,
      notes: notes.trim() || null,
    })
  }

  const range = equipment.min_temp_c != null || equipment.max_temp_c != null
    ? `${equipment.min_temp_c ?? '—'} to ${equipment.max_temp_c ?? '—'}°C`
    : null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Log temperature — {equipment.name}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        {range && <p className="text-xs text-muted-foreground mb-3">Allowed range: {range} (target {equipment.target_temp_c ?? '—'}°C)</p>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Temperature °C *</label>
            <input type="number" step="0.1" value={temp} onChange={e => setTemp(e.target.value)} required
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action (if out of range)</label>
            <input value={action} onChange={e => setAction(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="e.g. Adjusted thermostat, moved stock" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || temp === ''}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save reading'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeliveryModal({ venueId, onClose, onSave, isSaving }) {
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

function HoldModal({ venueId, onClose, onSave, isSaving }) {
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

function CookingModal({ venueId, onClose, onSave, isSaving }) {
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

export default function FoodSafety() {
  const api = useApi()
  const qc = useQueryClient()

  const [tab, setTab] = useState('today')
  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [eqModal, setEqModal] = useState(null)
  const [tempEq, setTempEq] = useState(null)
  const [showDelivery, setShowDelivery] = useState(false)
  const [showHold, setShowHold] = useState(false)
  const [showCooking, setShowCooking] = useState(false)

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

  const { data: tempLogs = [] } = useQuery({
    queryKey: ['fs-temp-logs', venueId, date],
    queryFn: () => api.get(`/food-safety/temp-logs?venue_id=${venueId}&date=${date}`),
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
  const createTemp = useMutation({
    mutationFn: body => api.post('/food-safety/temp-logs', body),
    onSuccess: () => { invalidate(); setTempEq(null) },
  })
  const createDelivery = useMutation({
    mutationFn: body => api.post('/food-safety/deliveries', body),
    onSuccess: () => { invalidate(); setShowDelivery(false) },
  })
  const createHold = useMutation({
    mutationFn: body => api.post('/food-safety/holds', body),
    onSuccess: () => { invalidate(); setShowHold(false) },
  })
  const createCooking = useMutation({
    mutationFn: body => api.post('/food-safety/cooking', body),
    onSuccess: () => { invalidate(); setShowCooking(false) },
  })

  const loggedIds = new Set(tempLogs.map(l => l.equipment_id))

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
          {eqLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : equipment.length === 0 ? (
            <div className="border rounded-xl p-8 text-center">
              <p className="text-muted-foreground text-sm mb-3">No equipment yet. Add fridges and freezers first.</p>
              <button type="button" onClick={() => setEqModal('new')}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
                <Plus className="w-4 h-4" /> Add equipment
              </button>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Equipment</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Range</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Today</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {equipment.map(eq => {
                    const logs = tempLogs.filter(l => l.equipment_id === eq.id)
                    const latest = logs[0]
                    return (
                      <tr key={eq.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{eq.name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{TYPE_LABELS[eq.equipment_type]}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {eq.min_temp_c ?? '—'} … {eq.max_temp_c ?? '—'}°C
                        </td>
                        <td className="px-4 py-3">
                          {latest ? (
                            <Badge ok={latest.is_within_range}>{latest.temperature_c}°C</Badge>
                          ) : (
                            <span className="text-xs text-amber-600">Not logged</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => setTempEq(eq)}
                            className="text-xs font-medium text-primary hover:underline">
                            {loggedIds.has(eq.id) ? 'Add reading' : 'Log temp'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

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
        </div>
      ) : tab === 'deliveries' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Delivery checks</h2>
            <button type="button" onClick={() => setShowDelivery(true)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
              <Plus className="w-4 h-4" /> New check
            </button>
          </div>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No deliveries logged for this date.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
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
        </div>
      ) : tab === 'holds' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Hot / cold hold checks</h2>
            <button type="button" onClick={() => setShowHold(true)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
              <Plus className="w-4 h-4" /> New check
            </button>
          </div>
          {holds.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No hold checks for this date.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
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
        </div>
      ) : tab === 'cooking' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Cooking / reheat checks</h2>
            <button type="button" onClick={() => setShowCooking(true)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
              <Plus className="w-4 h-4" /> New check
            </button>
          </div>
          {cooking.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No cooking checks for this date.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
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
      {tempEq && (
        <TempLogModal
          equipment={tempEq}
          venueId={venueId}
          onClose={() => setTempEq(null)}
          onSave={body => createTemp.mutate(body)}
          isSaving={createTemp.isPending}
        />
      )}
      {showDelivery && (
        <DeliveryModal
          venueId={venueId}
          onClose={() => setShowDelivery(false)}
          onSave={body => createDelivery.mutate(body)}
          isSaving={createDelivery.isPending}
        />
      )}
      {showHold && (
        <HoldModal
          venueId={venueId}
          onClose={() => setShowHold(false)}
          onSave={body => createHold.mutate(body)}
          isSaving={createHold.isPending}
        />
      )}
      {showCooking && (
        <CookingModal
          venueId={venueId}
          onClose={() => setShowCooking(false)}
          onSave={body => createCooking.mutate(body)}
          isSaving={createCooking.isPending}
        />
      )}
    </div>
  )
}
