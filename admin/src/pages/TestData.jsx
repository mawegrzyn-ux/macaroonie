// src/pages/TestData.jsx
//
// Pre-prod QA tooling: generate dummy bookings across a date range at a
// target occupancy level, and bulk-clear bookings (by range or all) when
// a test run needs a clean slate. Destructive actions require the typed
// confirmation "DELETE" on top of the reveal-to-confirm pattern used
// elsewhere (e.g. Customers.jsx GDPR anonymise).

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0 bg-background">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4" /> Test data
          </h1>
          <p className="text-xs text-muted-foreground">
            Generate dummy bookings and past H&amp;S logs for QA, or clear them. Pre-prod only.
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
            <HsSection api={api} venueId={venueId} />
            <HsClearSection api={api} venueId={venueId} />
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
    <div className="rounded-xl border bg-background overflow-hidden">
      <div className="px-4 py-3 section-head">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
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

// ── Health & safety logs for past dates ─────────────────────

const HS_KINDS = [
  { key: 'temps',      label: 'Fridge & freezer temperatures', hint: 'One reading per unit per check time' },
  { key: 'holds',      label: 'Hot & cold hold checks',        hint: 'One reading per station per hold check time' },
  { key: 'cooking',    label: 'Cooking checks',                hint: 'Each session\'s required checks, random dishes from published menus' },
  { key: 'orders',     label: 'Past order sheets',             hint: 'Placed orders on each template\'s delivery days, random quantities' },
  { key: 'deliveries', label: 'Delivery checks',               hint: 'One per placed order sheet: supplier, its items, temperature by category' },
  { key: 'checklists', label: 'Checklists & audits',           hint: 'Marked complete with every task ticked' },
]

const COUNT_LABELS = {
  temps: 'fridge/freezer readings', holds: 'hold checks', cooking: 'cooking checks',
  orders: 'order sheets', deliveries: 'delivery checks', checklists: 'checklists',
}

function yesterdayStr() { return addDays(todayStr(), -1) }

function KindPicker({ kinds, setKinds, withHints }) {
  const toggle = key => setKinds(kinds.includes(key) ? kinds.filter(k => k !== key) : [...kinds, key])
  return (
    <div className="space-y-1">
      {HS_KINDS.map(k => (
        <label key={k.key} className="flex items-start gap-3 min-h-[48px] py-2 px-2 rounded-md hover:bg-accent cursor-pointer touch-manipulation">
          <input type="checkbox" checked={kinds.includes(k.key)} onChange={() => toggle(k.key)} className="mt-1 w-4 h-4" />
          <span>
            <span className="text-sm block">{k.label}</span>
            {withHints && <span className="text-xs text-muted-foreground">{k.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

function CountList({ data }) {
  const parts = Object.keys(COUNT_LABELS)
    .filter(k => data[k] > 0)
    .map(k => `${data[k]} ${COUNT_LABELS[k]}`)
  return parts.length ? parts.join(', ') : 'nothing'
}

function HsSection({ api, venueId }) {
  const qc = useQueryClient()
  const [dateFrom, setDateFrom] = useState(addDays(todayStr(), -30))
  const [dateTo,   setDateTo]   = useState(yesterdayStr())
  const [kinds, setKinds] = useState(HS_KINDS.map(k => k.key))
  const [issuePct, setIssuePct] = useState('3')
  const [skipClosed, setSkipClosed] = useState(true)
  const [checklistIds, setChecklistIds] = useState(null) // null = all

  const { data: templates = [] } = useQuery({
    queryKey: ['checklist-templates', venueId],
    queryFn:  () => api.get(`/checklists/templates?venue_id=${venueId}`),
  })

  useEffect(() => { setChecklistIds(null) }, [venueId])

  const payload = dryRun => ({
    date_from: dateFrom, date_to: dateTo, kinds,
    issue_pct: Math.max(0, Math.min(30, Number(issuePct) || 0)),
    skip_closed: skipClosed,
    checklist_template_ids: checklistIds,
    dry_run: dryRun,
  })

  const preview = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/test-data/hs/generate`, payload(true)),
  })
  const generate = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/test-data/hs/generate`, payload(false)),
    onSuccess: () => { preview.reset(); qc.invalidateQueries() },
  })

  // Any change makes an earlier preview stale.
  useEffect(() => { preview.reset(); generate.reset() }, // eslint-disable-line react-hooks/exhaustive-deps
    [venueId, dateFrom, dateTo, kinds, issuePct, skipClosed, checklistIds])

  const chosen = checklistIds ?? templates.map(t => t.id)
  const toggleChecklist = id => {
    const next = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]
    setChecklistIds(next.length === templates.length ? null : next)
  }

  const busy = preview.isPending || generate.isPending
  const tooLate = dateTo > todayStr()

  return (
    <SectionCard
      title="Generate past health & safety logs"
      description="Fills past dates with believable records: readings inside each unit's limits, random dishes for cooking checks, delivery checks matched to order sheets, and checklists ticked off. Days that already have a reading are left alone. Everything made here is marked as generated, so it can be cleared below."
    >
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="From">
          <input type="date" value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
        </FormRow>
        <FormRow label="To">
          <input type="date" value={dateTo} min={dateFrom} max={todayStr()} onChange={e => setDateTo(e.target.value)} className={inputCls} />
        </FormRow>
      </div>
      {tooLate && <p className="text-xs text-destructive">Only past dates (up to today) can be filled.</p>}

      <KindPicker kinds={kinds} setKinds={setKinds} withHints />

      {kinds.includes('checklists') && templates.length > 0 && (
        <FormRow label="Checklists to complete">
          <div className="flex flex-wrap gap-2">
            {templates.map(t => {
              const on = chosen.includes(t.id)
              return (
                <button key={t.id} type="button" onClick={() => toggleChecklist(t.id)}
                  className={`min-h-[40px] px-3 rounded-full border text-sm touch-manipulation ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}>
                  {t.name} <span className="opacity-70 text-xs">({t.frequency})</span>
                </button>
              )
            })}
          </div>
        </FormRow>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Readings out of range (%)">
          <input type="number" inputMode="numeric" min={0} max={30}
            value={issuePct} onChange={e => setIssuePct(e.target.value)} className={inputCls} />
        </FormRow>
        <label className="flex items-center gap-3 min-h-[48px] mt-5 text-sm cursor-pointer touch-manipulation">
          <input type="checkbox" checked={skipClosed} onChange={e => setSkipClosed(e.target.checked)} className="w-4 h-4" />
          Skip days the venue is closed
        </label>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Out-of-range readings get a corrective action, as a real log would. 0 keeps every reading in range.
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => preview.mutate()}
          disabled={busy || !kinds.length || tooLate}
          className="flex-1 min-h-[44px] rounded-lg border text-sm font-medium disabled:opacity-50 touch-manipulation"
        >
          {preview.isPending ? 'Counting…' : 'Preview'}
        </button>
        <button
          onClick={() => generate.mutate()}
          disabled={busy || !kinds.length || tooLate}
          className="flex-1 flex items-center justify-center gap-2 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
        >
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generate.isPending ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {(preview.isError || generate.isError) && (
        <p className="text-xs text-destructive">{(preview.error ?? generate.error)?.message ?? 'Failed'}</p>
      )}
      {(preview.data || generate.data) && (
        <HsResult data={generate.data ?? preview.data} done={!!generate.data} />
      )}
    </SectionCard>
  )
}

function HsResult({ data, done }) {
  return (
    <div className={`rounded-lg border p-3 text-xs space-y-1 ${done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'bg-muted/40'}`}>
      <p className="flex items-center gap-1.5 font-medium">
        {done && <CheckCircle2 className="w-3.5 h-3.5" />}
        {done ? 'Created' : 'Would create about'} <CountList data={data} />
        {' '}over {data.days_filled} of {data.days_total} days.
      </p>
      {data.checklists_completed_existing > 0 && (
        <p>{done ? 'Completed' : 'Would complete'} {data.checklists_completed_existing} checklist(s) that had been started (they are kept by Clear).</p>
      )}
      {data.out_of_range > 0 && <p>{data.out_of_range} reading(s) out of range, each with a corrective action.</p>}
      {data.notes?.map(n => <p key={n} className="text-amber-700">{n}</p>)}
    </div>
  )
}

function HsClearSection({ api, venueId }) {
  const [dateFrom, setDateFrom] = useState(addDays(todayStr(), -30))
  const [dateTo,   setDateTo]   = useState(todayStr())
  const [kinds, setKinds] = useState(HS_KINDS.map(k => k.key))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [typedConfirm, setTypedConfirm] = useState('')
  const qc = useQueryClient()

  const preview = useQuery({
    queryKey: ['test-data-hs-clear-preview', venueId, dateFrom, dateTo, kinds],
    queryFn:  () => api.post(`/venues/${venueId}/test-data/hs/clear`, {
      date_from: dateFrom, date_to: dateTo, kinds, dry_run: true,
    }),
    enabled: confirmOpen && kinds.length > 0,
  })
  const total = preview.data ? Object.values(preview.data).reduce((a, b) => a + b, 0) : 0

  const clear = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/test-data/hs/clear`, {
      date_from: dateFrom, date_to: dateTo, kinds, confirm: true,
    }),
    onSuccess: () => { setConfirmOpen(false); setTypedConfirm(''); qc.invalidateQueries() },
  })

  useEffect(() => { setConfirmOpen(false); setTypedConfirm('') }, [dateFrom, dateTo, kinds, venueId])

  return (
    <SectionCard
      title="Clear generated health & safety logs"
      description="Deletes only records made by the generator above. Readings and checklists people entered are never touched."
    >
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="From">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
        </FormRow>
        <FormRow label="To">
          <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className={inputCls} />
        </FormRow>
      </div>

      <KindPicker kinds={kinds} setKinds={setKinds} />

      {!confirmOpen ? (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!kinds.length}
          className="flex items-center gap-2 min-h-[44px] text-sm text-destructive hover:text-destructive/80 disabled:opacity-50 touch-manipulation"
        >
          <Trash2 className="w-4 h-4" />
          Clear generated logs…
        </button>
      ) : (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">Delete generated logs from {dateFrom} to {dateTo}?</p>
          <p className="text-xs text-muted-foreground">
            {preview.isLoading
              ? 'Counting…'
              : <>This will permanently delete <CountList data={preview.data ?? {}} />. Cannot be undone.</>}
          </p>

          <FormRow label='Type "DELETE" to confirm'>
            <input value={typedConfirm} onChange={e => setTypedConfirm(e.target.value)} className={inputCls} placeholder="DELETE" />
          </FormRow>

          <div className="flex gap-2">
            <button
              onClick={() => clear.mutate()}
              disabled={typedConfirm !== 'DELETE' || clear.isPending || preview.isLoading || total === 0}
              className="flex-1 min-h-[44px] rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
            >
              {clear.isPending ? 'Deleting…' : `Yes, delete ${total} record(s)`}
            </button>
            <button
              onClick={() => { setConfirmOpen(false); setTypedConfirm('') }}
              disabled={clear.isPending}
              className="flex-1 min-h-[44px] rounded-lg border text-sm touch-manipulation"
            >
              Cancel
            </button>
          </div>

          {clear.isError && <p className="text-xs text-destructive">{clear.error?.message ?? 'Failed to clear'}</p>}
        </div>
      )}

      {clear.isSuccess && !confirmOpen && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Deleted <CountList data={clear.data} />.
        </p>
      )}
    </SectionCard>
  )
}
