// src/pages/Schedule.jsx
// Weekly schedule editor + date overrides.
// Each day shows its sittings. Click a sitting to edit slot caps.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronDown, ChevronUp, Trash2, Save, Copy, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, DAYS, INTERVALS } from '@/lib/utils'

// ── Slot caps editor ──────────────────────────────────────────
// Shows all generated slots for a sitting with editable cover caps.
function SlotCapsEditor({ sitting, venueId, onSaved }) {
  const api = useApi()
  const qc  = useQueryClient()

  // Generate slot times from sitting opens_at → closes_at using interval
  const [caps, setCaps] = useState(() => {
    const existing = {}
    // PostgreSQL TIME columns come back as "HH:MM:SS" in JSON — normalise to "HH:MM"
    ;(sitting.caps ?? []).forEach(c => {
      const key = String(c.slot_time).slice(0, 5)
      existing[key] = c.max_covers
    })
    return existing
  })

  // Generate slot times between opens_at and closes_at
  const slots = generateSlotTimes(sitting.opens_at, sitting.closes_at, 15) // interval comes from template

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = Object.entries(caps)
        .filter(([, v]) => v !== '' && v !== null)
        .map(([slot_time, max_covers]) => ({ slot_time, max_covers: Number(max_covers) }))
      return api.put(`/venues/${venueId}/schedule/sittings/${sitting.id}/caps`, payload)
    },
    onSuccess: () => { qc.invalidateQueries(['schedule', venueId]); onSaved?.() },
  })

  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Slot cover caps — blank = use sitting default ({sitting.default_max_covers ?? 'unlimited'})
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {slots.map(time => (
          <div key={time} className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-10 shrink-0">{time}</span>
            <input
              type="number"
              min={0}
              value={caps[time] ?? ''}
              onChange={e => setCaps(prev => ({ ...prev, [time]: e.target.value === '' ? undefined : e.target.value }))}
              placeholder="—"
              className={cn(
                'w-14 text-xs border rounded px-1.5 py-1 text-center',
                caps[time] === '0' || caps[time] === 0 ? 'border-destructive/50 bg-destructive/5 text-destructive' : ''
              )}
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50 mt-2"
      >
        <Save className="w-3 h-3" />
        {saveMutation.isPending ? 'Saving…' : 'Save caps'}
      </button>
    </div>
  )
}

function generateSlotTimes(opensAt, closesAt, intervalMins) {
  const slots = []
  const [oh, om] = opensAt.split(':').map(Number)
  const [ch, cm] = closesAt.split(':').map(Number)
  let mins = oh * 60 + om
  const end  = ch * 60 + cm
  while (mins < end) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0')
    const m = String(mins % 60).padStart(2, '0')
    slots.push(`${h}:${m}`)
    mins += intervalMins
  }
  return slots
}

// ── Day card ──────────────────────────────────────────────────
function DayCard({ dow, template, venueId, allDows }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [expandedSitting,  setExpandedSitting]  = useState(null)
  const [editingSittingId, setEditingSittingId] = useState(null)
  const [editData,         setEditData]         = useState({})
  const [addingSitting,    setAddingSitting]     = useState(false)
  const [newSitting, setNewSitting] = useState({ opens_at: '12:00', closes_at: '15:00', default_max_covers: '', doors_close_time: '', name: '' })
  const [showCopyDay, setShowCopyDay] = useState(false)
  const [copySourceDow, setCopySourceDow] = useState('')

  const copyDayMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/schedule/copy-day`, {
      source_dow: Number(copySourceDow),
      target_dow: dow,
    }),
    onSuccess: () => { qc.invalidateQueries(['schedule', venueId]); setShowCopyDay(false); setCopySourceDow('') },
  })

  const isOpen = template?.is_open ?? false

  const toggleMutation = useMutation({
    mutationFn: () => api.put(`/venues/${venueId}/schedule/template/${dow}`, {
      is_open:            !isOpen,
      slot_interval_mins: template?.slot_interval_mins ?? 15,
    }),
    onSuccess: () => qc.invalidateQueries(['schedule', venueId]),
  })

  const addSittingMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/schedule/template/${dow}/sittings`, {
      ...newSitting,
      default_max_covers: newSitting.default_max_covers === '' ? null : Number(newSitting.default_max_covers),
      doors_close_time:   newSitting.doors_close_time || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries(['schedule', venueId])
      setAddingSitting(false)
      setNewSitting({ opens_at: '12:00', closes_at: '15:00', default_max_covers: '', doors_close_time: '', name: '' })
    },
  })

  const deleteSittingMutation = useMutation({
    mutationFn: (sittingId) => api.delete(`/venues/${venueId}/schedule/sittings/${sittingId}`),
    onSuccess: () => qc.invalidateQueries(['schedule', venueId]),
  })

  const editSittingMutation = useMutation({
    mutationFn: ({ id, data }) => api.patch(`/venues/${venueId}/schedule/sittings/${id}`, data),
    onSuccess:  () => { qc.invalidateQueries(['schedule', venueId]); setEditingSittingId(null) },
  })

  function startEditSitting(sitting) {
    // Normalise HH:MM:SS → HH:MM for time inputs
    setEditData({
      opens_at:           String(sitting.opens_at).slice(0, 5),
      closes_at:          String(sitting.closes_at).slice(0, 5),
      default_max_covers: sitting.default_max_covers ?? '',
      doors_close_time:   sitting.doors_close_time ? String(sitting.doors_close_time).slice(0, 5) : '',
      name:               sitting.name ?? '',
    })
    setEditingSittingId(sitting.id)
    setExpandedSitting(null)  // close caps editor if open
  }

  function saveEditSitting(sitting) {
    editSittingMutation.mutate({
      id:   sitting.id,
      data: {
        opens_at:           editData.opens_at,
        closes_at:          editData.closes_at,
        default_max_covers: editData.default_max_covers === '' ? null : Number(editData.default_max_covers),
        doors_close_time:   editData.doors_close_time || null,
        name:               editData.name || null,
      },
    })
  }

  const intervalMutation = useMutation({
    mutationFn: (interval) => api.put(`/venues/${venueId}/schedule/template/${dow}`, {
      is_open:            isOpen,
      slot_interval_mins: interval,
    }),
    onSuccess: () => qc.invalidateQueries(['schedule', venueId]),
  })

  return (
    <div className={cn('border rounded-lg overflow-hidden', !isOpen && 'opacity-60')}>
      {/* Day header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleMutation.mutate()}
            className={cn(
              'relative w-10 h-6 rounded-full transition-colors overflow-hidden shrink-0',
              isOpen ? 'bg-primary' : 'bg-gray-300'
            )}
          >
            <span className={cn(
              'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
              isOpen ? 'translate-x-4' : 'translate-x-0'
            )} />
          </button>
          <span className="font-medium text-sm">{DAYS[dow]}</span>
        </div>

        {isOpen && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Interval</span>
              <select
                value={template?.slot_interval_mins ?? 15}
                onChange={e => intervalMutation.mutate(Number(e.target.value))}
                className="text-xs border rounded px-1.5 py-1"
              >
                {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>
        )}
        {showCopyDay ? (
          <div className="flex items-center gap-1.5">
            <select
              value={copySourceDow}
              onChange={e => setCopySourceDow(e.target.value)}
              className="text-xs border rounded px-1.5 py-1"
            >
              <option value="">Copy from…</option>
              {allDows.filter(d => d !== dow).map(d => (
                <option key={d} value={d}>{DAYS[d]}</option>
              ))}
            </select>
            <button
              onClick={() => copyDayMutation.mutate()}
              disabled={!copySourceDow || copyDayMutation.isPending}
              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50"
            >
              {copyDayMutation.isPending ? '…' : 'Apply'}
            </button>
            <button onClick={() => setShowCopyDay(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowCopyDay(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Copy from another day"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Sittings */}
      {isOpen && (
        <div className="p-3 space-y-2">
          {(template?.sittings ?? []).map(sitting => (
            <div key={sitting.id} className="border rounded-md overflow-hidden">

              {editingSittingId === sitting.id ? (
                /* ── Inline edit form ───────────────────── */
                <div className="px-3 py-2 bg-background space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Edit sitting</p>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Session name (optional)</label>
                    <input
                      type="text"
                      value={editData.name ?? ''}
                      onChange={e => setEditData(prev => ({ ...prev, name: e.target.value || null }))}
                      placeholder="e.g. Lunch, Dinner, Brunch"
                      className="w-full text-sm border rounded-lg px-3 py-2 mt-1 outline-none focus:border-primary touch-manipulation"
                      maxLength={100}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Opens</label>
                      <input
                        type="time" step="900"
                        value={editData.opens_at}
                        onChange={e => setEditData(p => ({ ...p, opens_at: e.target.value }))}
                        className="text-sm border rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Last order</label>
                      <input
                        type="time" step="900"
                        value={editData.closes_at}
                        onChange={e => setEditData(p => ({ ...p, closes_at: e.target.value }))}
                        className="text-sm border rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Default covers cap</label>
                      <input
                        type="number" placeholder="Unlimited"
                        value={editData.default_max_covers}
                        onChange={e => setEditData(p => ({ ...p, default_max_covers: e.target.value }))}
                        className="text-sm border rounded px-2 py-1 w-28"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Doors close</label>
                      <input
                        type="time" step="900"
                        value={editData.doors_close_time}
                        onChange={e => setEditData(p => ({ ...p, doors_close_time: e.target.value }))}
                        className="text-sm border rounded px-2 py-1"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEditSitting(sitting)}
                      disabled={editSittingMutation.isPending}
                      className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                    >
                      {editSittingMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingSittingId(null)}
                      className="text-xs px-3 py-1.5 border rounded"
                    >
                      Cancel
                    </button>
                    {editSittingMutation.isError && (
                      <span className="text-xs text-destructive self-center">
                        {editSittingMutation.error?.message ?? 'Save failed'}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                /* ── Normal sitting row ─────────────────── */
                <div className="flex items-center justify-between px-3 py-2 bg-background">
                  <button
                    onClick={() => setExpandedSitting(expandedSitting === sitting.id ? null : sitting.id)}
                    className="flex items-center gap-2 text-sm font-medium flex-1 text-left min-w-0"
                  >
                    <span className="shrink-0">
                      {sitting.name && <span className="font-medium text-foreground mr-1">{sitting.name}</span>}
                      {String(sitting.opens_at).slice(0, 5)} – {String(sitting.closes_at).slice(0, 5)}
                    </span>
                    <span className="text-xs text-muted-foreground font-normal truncate">
                      {sitting.default_max_covers != null
                        ? `default ${sitting.default_max_covers} covers`
                        : 'no default cap'}
                      {sitting.doors_close_time && (
                        <span className="ml-2 text-orange-600">
                          doors {String(sitting.doors_close_time).slice(0, 5)}
                        </span>
                      )}
                    </span>
                    {expandedSitting === sitting.id
                      ? <ChevronUp   className="w-3.5 h-3.5 ml-auto shrink-0 text-muted-foreground" />
                      : <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0 text-muted-foreground" />}
                  </button>
                  {/* Edit sitting times/covers */}
                  <button
                    onClick={() => startEditSitting(sitting)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-2 shrink-0"
                    title="Edit sitting times and default covers"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {/* Delete sitting */}
                  <button
                    onClick={() => deleteSittingMutation.mutate(sitting.id)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-1 shrink-0"
                    title="Delete sitting"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {expandedSitting === sitting.id && editingSittingId !== sitting.id && (
                <div className="px-3 pb-3 border-t bg-muted/20">
                  <SlotCapsEditor
                    sitting={sitting}
                    venueId={venueId}
                    onSaved={() => setExpandedSitting(null)}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Add sitting form */}
          {addingSitting ? (
            <div className="border rounded-md p-3 space-y-2 bg-muted/20">
              <p className="text-xs font-medium">New sitting</p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Session name (optional)</label>
                <input
                  type="text"
                  value={newSitting.name ?? ''}
                  onChange={e => setNewSitting(p => ({ ...p, name: e.target.value || null }))}
                  placeholder="e.g. Lunch, Dinner, Brunch"
                  className="w-full text-sm border rounded-lg px-3 py-2 mt-1 outline-none focus:border-primary touch-manipulation"
                  maxLength={100}
                />
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Opens</label>
                  <input type="time" value={newSitting.opens_at}
                    onChange={e => setNewSitting(p => ({ ...p, opens_at: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Last order</label>
                  <input type="time" value={newSitting.closes_at}
                    onChange={e => setNewSitting(p => ({ ...p, closes_at: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Doors close</label>
                  <input type="time" value={newSitting.doors_close_time}
                    onChange={e => setNewSitting(p => ({ ...p, doors_close_time: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Max covers</label>
                  <input
                    type="number" placeholder="Unlimited"
                    value={newSitting.default_max_covers}
                    onChange={e => setNewSitting(p => ({ ...p, default_max_covers: e.target.value }))}
                    className="text-sm border rounded px-2 py-1 w-28"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => addSittingMutation.mutate()}
                  disabled={addSittingMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                >
                  {addSittingMutation.isPending ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => setAddingSitting(false)} className="text-xs px-3 py-1.5 border rounded">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingSitting(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" /> Add sitting
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Schedule page ─────────────────────────────────────────
export default function Schedule() {
  const api = useApi()
  const qc  = useQueryClient()
  const [selectedVenueId, setSelectedVenueId] = useState(null)
  const [copyFromId, setCopyFromId]           = useState('')
  const [showCopyFrom, setShowCopyFrom]       = useState(false)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const venueId = selectedVenueId ?? venues[0]?.id ?? null

  const { data: schedule = [], isLoading } = useQuery({
    queryKey: ['schedule', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/schedule`),
    enabled:  !!venueId,
  })

  const copyMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/schedule/copy-from`, { source_venue_id: copyFromId }),
    onSuccess: () => {
      qc.invalidateQueries(['schedule', venueId])
      setShowCopyFrom(false)
      setCopyFromId('')
    },
  })

  // Build map of dow → template
  const templateByDow = Object.fromEntries((schedule ?? []).map(t => [t.day_of_week, t]))

  const otherVenues = venues.filter(v => v.id !== venueId)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="font-semibold">Schedule</h1>
        <div className="flex items-center gap-2">
          {otherVenues.length > 0 && (
            showCopyFrom ? (
              <div className="flex items-center gap-2">
                <select
                  value={copyFromId}
                  onChange={e => setCopyFromId(e.target.value)}
                  className="text-sm border rounded px-2 py-1"
                >
                  <option value="">Select venue…</option>
                  {otherVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button
                  onClick={() => copyMutation.mutate()}
                  disabled={!copyFromId || copyMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                >
                  {copyMutation.isPending ? 'Copying…' : 'Copy'}
                </button>
                <button onClick={() => setShowCopyFrom(false)} className="text-xs px-2 py-1.5 border rounded">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCopyFrom(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded hover:bg-muted"
              >
                <Copy className="w-3.5 h-3.5" /> Copy from
              </button>
            )
          )}
          <select
            value={venueId ?? ''}
            onChange={e => { setSelectedVenueId(e.target.value); setShowCopyFrom(false) }}
            className="text-sm border rounded px-2 py-1"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="space-y-3 max-w-2xl">
            <p className="text-sm text-muted-foreground mb-4">
              Configure open days, sitting windows, and per-slot cover caps.
              Toggle a day off to close it. Click a sitting to edit its slot caps.
            </p>
            {[1,2,3,4,5,6,0].map(dow => (  // Mon–Sun order
              <DayCard
                key={dow}
                dow={dow}
                template={templateByDow[dow]}
                venueId={venueId}
                allDows={[1,2,3,4,5,6,0]}
              />
            ))}
          </div>
        )}

        {venueId && (
          <>
            <hr className="my-6" />
            <ExceptionsSection venueId={venueId} />
          </>
        )}
      </div>
    </div>
  )
}

// ── ExceptionsSection ─────────────────────────────────────────
// Shows all schedule exceptions for the venue with CRUD.
function ExceptionsSection({ venueId }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: exceptions = [], isLoading } = useQuery({
    queryKey: ['exceptions', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/schedule/exceptions`),
    enabled:  !!venueId,
  })

  const [showCreate, setShowCreate]     = useState(false)
  const [createData, setCreateData]     = useState({
    name:      '',
    date_from: '',
    date_to:   '',
    is_closed: true,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/schedule/exceptions`, createData),
    onSuccess: () => {
      qc.invalidateQueries(['exceptions', venueId])
      setShowCreate(false)
      setCreateData({ name: '', date_from: '', date_to: '', is_closed: true })
    },
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Schedule exceptions</h2>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md"
          >
            <Plus className="w-3.5 h-3.5" /> New exception
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Exceptions override the weekly schedule for a date range — either close the venue or run alternative hours.
      </p>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
          <p className="text-xs font-semibold">New exception</p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-0.5">Name</label>
              <input
                type="text" placeholder="e.g. Christmas 2025, Summer hours…"
                value={createData.name}
                onChange={e => setCreateData(p => ({ ...p, name: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-0.5">From</label>
                <input type="date" value={createData.date_from}
                  onChange={e => setCreateData(p => ({ ...p, date_from: e.target.value, date_to: p.date_to || e.target.value }))}
                  className="w-full text-sm border rounded px-2 py-1.5" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-0.5">To</label>
                <input type="date" value={createData.date_to}
                  onChange={e => setCreateData(p => ({ ...p, date_to: e.target.value }))}
                  min={createData.date_from}
                  className="w-full text-sm border rounded px-2 py-1.5" />
              </div>
            </div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" checked={createData.is_closed}
                  onChange={() => setCreateData(p => ({ ...p, is_closed: true }))} />
                Closed
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" checked={!createData.is_closed}
                  onChange={() => setCreateData(p => ({ ...p, is_closed: false }))} />
                Alternative schedule
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!createData.name || !createData.date_from || !createData.date_to || createMutation.isPending}
              className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="text-xs px-3 py-1.5 border rounded">Cancel</button>
            {createMutation.isError && (
              <span className="text-xs text-destructive self-center">
                {createMutation.error?.message ?? 'Failed to create'}
              </span>
            )}
          </div>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      <div className="space-y-2">
        {exceptions.map(exc => (
          <ExceptionCard key={exc.id} exc={exc} venueId={venueId} />
        ))}
        {!isLoading && exceptions.length === 0 && !showCreate && (
          <p className="text-xs text-muted-foreground italic">No exceptions configured.</p>
        )}
      </div>
    </div>
  )
}

function ExceptionCard({ exc, venueId }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/venues/${venueId}/schedule/exceptions/${exc.id}`),
    onSuccess:  () => qc.invalidateQueries(['exceptions', venueId]),
  })

  const fmtDate = (d) => {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  const isSingleDay = exc.date_from === exc.date_to
  const dateLabel = isSingleDay ? fmtDate(exc.date_from) : `${fmtDate(exc.date_from)} – ${fmtDate(exc.date_to)}`

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 bg-background">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn(
            'shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded',
            exc.is_closed
              ? 'bg-red-100 text-red-700'
              : 'bg-blue-100 text-blue-700',
          )}>
            {exc.is_closed ? 'Closed' : 'Alt schedule'}
          </span>
          <span className="text-sm font-medium truncate">{exc.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{dateLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!exc.is_closed && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs px-2.5 py-1 border rounded hover:bg-muted"
            >
              {expanded ? 'Done' : 'Configure'}
            </button>
          )}
          <button
            onClick={() => { if (confirm(`Delete "${exc.name}"?`)) deleteMutation.mutate() }}
            disabled={deleteMutation.isPending}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && !exc.is_closed && (
        <div className="border-t bg-muted/10 p-3 space-y-2">
          <p className="text-xs text-muted-foreground mb-2">
            Configure hours per day of week for this exception period. Days with no configuration use the base weekly schedule.
          </p>
          {[1,2,3,4,5,6,0].map(dow => (
            <ExceptionDayCard
              key={dow}
              exc={exc}
              dow={dow}
              template={exc.day_templates?.find(t => t.day_of_week === dow) ?? null}
              venueId={venueId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExceptionDayCard({ exc, dow, template, venueId }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [addingSitting,    setAddingSitting]    = useState(false)
  const [editingSittingId, setEditingSittingId] = useState(null)
  const [editData,         setEditData]         = useState({})
  const [newSitting, setNewSitting] = useState({ opens_at: '12:00', closes_at: '15:00', default_max_covers: '', doors_close_time: '', name: '' })

  const isOpen = template?.is_open ?? false
  const eid = exc.id

  const toggleMutation = useMutation({
    mutationFn: () => api.put(`/venues/${venueId}/schedule/exceptions/${eid}/template/${dow}`, {
      is_open:            !isOpen,
      slot_interval_mins: template?.slot_interval_mins ?? 15,
    }),
    onSuccess: () => qc.invalidateQueries(['exceptions', venueId]),
  })

  const addSittingMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/schedule/exceptions/${eid}/template/${dow}/sittings`, {
      ...newSitting,
      default_max_covers: newSitting.default_max_covers === '' ? null : Number(newSitting.default_max_covers),
      doors_close_time:   newSitting.doors_close_time || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries(['exceptions', venueId])
      setAddingSitting(false)
      setNewSitting({ opens_at: '12:00', closes_at: '15:00', default_max_covers: '', doors_close_time: '', name: '' })
    },
  })

  const editSittingMutation = useMutation({
    mutationFn: ({ id, data }) => api.patch(`/venues/${venueId}/schedule/exceptions/${eid}/sittings/${id}`, data),
    onSuccess: () => { qc.invalidateQueries(['exceptions', venueId]); setEditingSittingId(null) },
  })

  const deleteSittingMutation = useMutation({
    mutationFn: (sid) => api.delete(`/venues/${venueId}/schedule/exceptions/${eid}/sittings/${sid}`),
    onSuccess:  () => qc.invalidateQueries(['exceptions', venueId]),
  })

  function startEdit(sitting) {
    setEditData({
      opens_at:           String(sitting.opens_at).slice(0, 5),
      closes_at:          String(sitting.closes_at).slice(0, 5),
      default_max_covers: sitting.default_max_covers ?? '',
      doors_close_time:   sitting.doors_close_time ? String(sitting.doors_close_time).slice(0, 5) : '',
      name:               sitting.name ?? '',
    })
    setEditingSittingId(sitting.id)
  }

  function saveEdit(sitting) {
    editSittingMutation.mutate({
      id:   sitting.id,
      data: {
        opens_at:           editData.opens_at,
        closes_at:          editData.closes_at,
        default_max_covers: editData.default_max_covers === '' ? null : Number(editData.default_max_covers),
        doors_close_time:   editData.doors_close_time || null,
        name:               editData.name || null,
      },
    })
  }

  return (
    <div className={cn('border rounded-md overflow-hidden', !template && 'opacity-60')}>
      <div className="flex items-center justify-between px-3 py-2 bg-background">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => toggleMutation.mutate()}
            className={cn(
              'relative w-9 h-5 rounded-full transition-colors overflow-hidden shrink-0',
              isOpen ? 'bg-primary' : 'bg-gray-300'
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              isOpen ? 'translate-x-4' : 'translate-x-0'
            )} />
          </button>
          <span className="text-sm font-medium">{DAYS[dow]}</span>
          {!template && <span className="text-xs text-muted-foreground italic">uses base schedule</span>}
        </div>
      </div>

      {isOpen && (
        <div className="p-2 space-y-1.5 border-t bg-muted/10">
          {(template?.sittings ?? []).map(sitting => (
            <div key={sitting.id} className="border rounded bg-background overflow-hidden">
              {editingSittingId === sitting.id ? (
                <div className="px-2 py-2 space-y-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Session name (optional)</label>
                    <input
                      type="text"
                      value={editData.name ?? ''}
                      onChange={e => setEditData(prev => ({ ...prev, name: e.target.value || null }))}
                      placeholder="e.g. Lunch, Dinner, Brunch"
                      className="w-full text-sm border rounded-lg px-3 py-2 mt-1 outline-none focus:border-primary touch-manipulation"
                      maxLength={100}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Opens</label>
                      <input type="time" step="900" value={editData.opens_at}
                        onChange={e => setEditData(p => ({ ...p, opens_at: e.target.value }))}
                        className="text-sm border rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Last order</label>
                      <input type="time" step="900" value={editData.closes_at}
                        onChange={e => setEditData(p => ({ ...p, closes_at: e.target.value }))}
                        className="text-sm border rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Doors close</label>
                      <input type="time" step="900" value={editData.doors_close_time}
                        onChange={e => setEditData(p => ({ ...p, doors_close_time: e.target.value }))}
                        className="text-sm border rounded px-2 py-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Max covers</label>
                      <input type="number" placeholder="Unlimited" value={editData.default_max_covers}
                        onChange={e => setEditData(p => ({ ...p, default_max_covers: e.target.value }))}
                        className="text-sm border rounded px-2 py-1 w-24" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => saveEdit(sitting)} disabled={editSittingMutation.isPending}
                      className="text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50">
                      {editSittingMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingSittingId(null)} className="text-xs px-2.5 py-1 border rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between px-2 py-1.5">
                  <div className="text-sm">
                    <span className="font-medium">
                      {sitting.name && <span className="mr-1">{sitting.name}</span>}
                      {String(sitting.opens_at).slice(0, 5)} – {String(sitting.closes_at).slice(0, 5)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {sitting.default_max_covers != null ? `${sitting.default_max_covers} covers` : 'no cap'}
                      {sitting.doors_close_time && <span className="ml-1.5 text-orange-600">doors {String(sitting.doors_close_time).slice(0, 5)}</span>}
                    </span>
                  </div>
                  <div className="flex gap-0.5">
                    <button onClick={() => startEdit(sitting)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteSittingMutation.mutate(sitting.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {addingSitting ? (
            <div className="border rounded bg-background p-2 space-y-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Session name (optional)</label>
                <input
                  type="text"
                  value={newSitting.name ?? ''}
                  onChange={e => setNewSitting(p => ({ ...p, name: e.target.value || null }))}
                  placeholder="e.g. Lunch, Dinner, Brunch"
                  className="w-full text-sm border rounded-lg px-3 py-2 mt-1 outline-none focus:border-primary touch-manipulation"
                  maxLength={100}
                />
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Opens</label>
                  <input type="time" value={newSitting.opens_at}
                    onChange={e => setNewSitting(p => ({ ...p, opens_at: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Last order</label>
                  <input type="time" value={newSitting.closes_at}
                    onChange={e => setNewSitting(p => ({ ...p, closes_at: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Doors close</label>
                  <input type="time" value={newSitting.doors_close_time}
                    onChange={e => setNewSitting(p => ({ ...p, doors_close_time: e.target.value }))}
                    className="text-sm border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">Max covers</label>
                  <input type="number" placeholder="Unlimited" value={newSitting.default_max_covers}
                    onChange={e => setNewSitting(p => ({ ...p, default_max_covers: e.target.value }))}
                    className="text-sm border rounded px-2 py-1 w-24" />
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => addSittingMutation.mutate()} disabled={addSittingMutation.isPending}
                  className="text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50">
                  {addSittingMutation.isPending ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => setAddingSitting(false)} className="text-xs px-2.5 py-1 border rounded">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingSitting(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5">
              <Plus className="w-3 h-3" /> Add sitting
            </button>
          )}
        </div>
      )}
    </div>
  )
}
