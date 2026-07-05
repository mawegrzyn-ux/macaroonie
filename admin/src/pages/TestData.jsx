// src/pages/TestData.jsx
//
// Pre-prod QA tooling: generate dummy bookings across a date range at a
// target occupancy level, and bulk-clear bookings (by range or all) when
// a test run needs a clean slate. Destructive actions require the typed
// confirmation "DELETE" on top of the reveal-to-confirm pattern used
// elsewhere (e.g. Customers.jsx GDPR anonymise).

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { FlaskConical, Sparkles, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import { useApi } from '@/lib/api'

const STATUS_OPTIONS = [
  { value: 'confirmed',   label: 'Confirmed' },
  { value: 'unconfirmed', label: 'Unconfirmed' },
  { value: 'reconfirmed', label: 'Reconfirmed' },
  { value: 'arrived',     label: 'Arrived' },
  { value: 'seated',      label: 'Seated' },
  { value: 'checked_out', label: 'Checked out' },
]

function todayStr() { return new Date().toISOString().slice(0, 10) }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function TestData() {
  const api = useApi()
  const [selectedVenueId, setSelectedVenueId] = useState('')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })
  const venueId = selectedVenueId || venues[0]?.id || ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4" /> Test data
          </h1>
          <p className="text-xs text-muted-foreground">
            Generate dummy bookings for QA, or clear bookings for a venue. Pre-prod only.
          </p>
        </div>
        <select value={venueId} onChange={e => setSelectedVenueId(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-background min-h-[40px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {venueId ? (
          <>
            <SeedSection api={api} venueId={venueId} />
            <ClearSection api={api} venueId={venueId} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pick a venue to continue.</p>
        )}
      </div>
    </div>
  )
}

function SectionCard({ title, description, children }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full text-sm border rounded-md px-3 py-2 bg-background min-h-[40px] touch-manipulation'

function SeedSection({ api, venueId }) {
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo,   setDateTo]   = useState(addDays(todayStr(), 29))
  const [occupancy, setOccupancy] = useState(60)
  const [status, setStatus] = useState('confirmed')

  const seed = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/test-data/seed`, {
      date_from: dateFrom,
      date_to:   dateTo,
      occupancy_pct: Number(occupancy),
      status,
    }),
  })

  return (
    <SectionCard
      title="Generate dummy bookings"
      description="Fills a date range with synthetic bookings ('Test Guest N') targeting the occupancy level below. Skips days the venue is closed."
    >
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="From">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
        </FormRow>
        <FormRow label="To">
          <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className={inputCls} />
        </FormRow>
      </div>

      <FormRow label={`Occupancy target — ${occupancy}% of tables per sitting`}>
        <input type="number" inputMode="numeric" min={1} max={100} step={5}
          value={occupancy} onChange={e => setOccupancy(e.target.value)} className={inputCls} />
      </FormRow>

      <FormRow label="Booking status">
        <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FormRow>

      <button
        onClick={() => seed.mutate()}
        disabled={seed.isPending}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
      >
        {seed.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {seed.isPending ? 'Generating…' : 'Generate bookings'}
      </button>

      {seed.isError && (
        <p className="text-xs text-destructive">{seed.error?.message ?? 'Failed to generate bookings'}</p>
      )}
      {seed.isSuccess && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Created {seed.data.created} bookings across {seed.data.daysOpen} of {seed.data.daysTotal} days
          {seed.data.daysOpen < seed.data.daysTotal && ' (remaining days are closed)'}.
        </p>
      )}
    </SectionCard>
  )
}

function ClearSection({ api, venueId }) {
  const [mode, setMode] = useState('range')
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo,   setDateTo]   = useState(addDays(todayStr(), 29))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [typedConfirm, setTypedConfirm] = useState('')

  const preview = useQuery({
    queryKey: ['test-data-clear-preview', venueId, mode, dateFrom, dateTo],
    queryFn:  () => api.post(`/venues/${venueId}/test-data/clear`, {
      mode, date_from: dateFrom, date_to: dateTo, dry_run: true,
    }),
    enabled: confirmOpen,
  })

  const clear = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/test-data/clear`, {
      mode, date_from: dateFrom, date_to: dateTo, dry_run: false, confirm: true,
    }),
    onSuccess: () => { setConfirmOpen(false); setTypedConfirm('') },
  })

  useEffect(() => { setConfirmOpen(false); setTypedConfirm('') }, [mode, dateFrom, dateTo, venueId])

  return (
    <SectionCard
      title="Clear bookings"
      description="Permanently deletes bookings for this venue. Cannot be undone."
    >
      <div className="flex gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={mode === 'range'} onChange={() => setMode('range')} />
          Date range
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
          All bookings
        </label>
      </div>

      {mode === 'range' && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="From">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
          </FormRow>
          <FormRow label="To">
            <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className={inputCls} />
          </FormRow>
        </div>
      )}

      {!confirmOpen ? (
        <button
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 touch-manipulation"
        >
          <Trash2 className="w-4 h-4" />
          Clear bookings…
        </button>
      ) : (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">
            {mode === 'all' ? 'Delete ALL bookings for this venue?' : `Delete bookings from ${dateFrom} to ${dateTo}?`}
          </p>
          <p className="text-xs text-muted-foreground">
            {preview.isLoading
              ? 'Counting matching bookings…'
              : `This will permanently delete ${preview.data?.count ?? 0} booking(s), including any linked payment records. Cannot be undone.`}
          </p>

          <FormRow label='Type "DELETE" to confirm'>
            <input value={typedConfirm} onChange={e => setTypedConfirm(e.target.value)} className={inputCls} placeholder="DELETE" />
          </FormRow>

          <div className="flex gap-2">
            <button
              onClick={() => clear.mutate()}
              disabled={typedConfirm !== 'DELETE' || clear.isPending || preview.isLoading}
              className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
            >
              {clear.isPending ? 'Deleting…' : `Yes, delete ${preview.data?.count ?? ''} booking(s)`}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setTypedConfirm('') }}
              disabled={clear.isPending}
              className="flex-1 py-2 rounded-lg border text-sm touch-manipulation"
            >
              Cancel
            </button>
          </div>

          {clear.isError && (
            <p className="text-xs text-destructive">{clear.error?.message ?? 'Failed to clear bookings'}</p>
          )}
        </div>
      )}

      {clear.isSuccess && !confirmOpen && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Deleted {clear.data.deleted} booking(s).
        </p>
      )}
    </SectionCard>
  )
}
