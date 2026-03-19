// src/pages/Schedule.jsx
// Weekly schedule editor + date overrides.
// Each day shows its sittings. Click a sitting to edit slot caps.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronDown, ChevronUp, Trash2, Save, Copy } from 'lucide-react'
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
    ;(sitting.caps ?? []).forEach(c => { existing[c.slot_time] = c.max_covers })
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
function DayCard({ dow, template, venueId }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [expandedSitting, setExpandedSitting] = useState(null)
  const [addingSitting,   setAddingSitting]   = useState(false)
  const [newSitting, setNewSitting] = useState({ opens_at: '12:00', closes_at: '15:00', default_max_covers: '' })

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
    }),
    onSuccess: () => { qc.invalidateQueries(['schedule', venueId]); setAddingSitting(false) },
  })

  const deleteSittingMutation = useMutation({
    mutationFn: (sittingId) => api.delete(`/venues/${venueId}/schedule/sittings/${sittingId}`),
    onSuccess: () => qc.invalidateQueries(['schedule', venueId]),
  })

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
              'relative w-9 h-5 rounded-full transition-colors',
              isOpen ? 'bg-primary' : 'bg-gray-300'
            )}
          >
            <span className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              isOpen ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </button>
          <span className="font-medium text-sm">{DAYS[dow]}</span>
        </div>

        {isOpen && (
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
        )}
      </div>

      {/* Sittings */}
      {isOpen && (
        <div className="p-3 space-y-2">
          {(template?.sittings ?? []).map(sitting => (
            <div key={sitting.id} className="border rounded-md overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-background">
                <button
                  onClick={() => setExpandedSitting(expandedSitting === sitting.id ? null : sitting.id)}
                  className="flex items-center gap-2 text-sm font-medium flex-1 text-left"
                >
                  {sitting.opens_at} – {sitting.closes_at}
                  <span className="text-xs text-muted-foreground font-normal">
                    {sitting.default_max_covers != null ? `default ${sitting.default_max_covers} covers` : 'no default cap'}
                  </span>
                  {expandedSitting === sitting.id
                    ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
                    : <ChevronDown className="w-3.5 h-3.5 ml-auto text-muted-foreground" />}
                </button>
                <button
                  onClick={() => deleteSittingMutation.mutate(sitting.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {expandedSitting === sitting.id && (
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
              <div className="flex gap-2 items-center">
                <input type="time" value={newSitting.opens_at}
                  onChange={e => setNewSitting(p => ({ ...p, opens_at: e.target.value }))}
                  className="text-sm border rounded px-2 py-1" />
                <span className="text-xs text-muted-foreground">to</span>
                <input type="time" value={newSitting.closes_at}
                  onChange={e => setNewSitting(p => ({ ...p, closes_at: e.target.value }))}
                  className="text-sm border rounded px-2 py-1" />
                <input
                  type="number" placeholder="Max covers"
                  value={newSitting.default_max_covers}
                  onChange={e => setNewSitting(p => ({ ...p, default_max_covers: e.target.value }))}
                  className="text-sm border rounded px-2 py-1 w-28"
                />
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
