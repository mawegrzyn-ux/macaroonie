// src/pages/mobile/MobileWages.jsx
//
// Phone-first Wages view — the same weekly wage report as CashRecon.jsx's
// WagesView, but narrowed to the three fields that matter away from a
// desk: staff name, what they're owed ("To be paid"), and what's actually
// been handed over in cash ("Paid"). Hours/rate/type/notes stay exactly as
// they were set on desktop — this page never touches them, it only edits
// total and cash_amount — same "hide the columns that don't fit, keep the
// data intact" idea as the food-safety temp-check tables' mobile layout.
// Reuses the exact same /venues/:id/cash-recon/wages/:week_start and
// /cash-recon/config endpoints as the desktop page (fmt/parseNum/getMonday/
// StatusBadge/SaveIndicator imported from CashRecon.jsx rather than
// duplicated).

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addWeeks, subWeeks, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Trash2, Star, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fmt, parseNum, getMonday, StatusBadge, SaveIndicator } from '@/pages/CashRecon'

function AmountField({ label, value, onChange, onBlur }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        placeholder="0.00"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full h-11 rounded-lg border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  )
}

export default function MobileWages() {
  const api = useApi()
  const qc  = useQueryClient()

  const [venueId,   setVenueId]   = useState('')
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))
  const [entries,   setEntries]   = useState([])
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [saveErr,   setSaveErr]   = useState(false)
  const saveTimerRef = useRef(null)

  const [addOpen,  setAddOpen]  = useState(false)
  const [addMode,  setAddMode]  = useState('template') // 'template' | 'adhoc'
  const [addStaff, setAddStaff] = useState('')
  const [addAdhoc, setAddAdhoc] = useState('')

  const [defaultSaved, setDefaultSaved] = useState(false)

  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  useEffect(() => { if (!venueId && venues.length) setVenueId(venues[0].id) }, [venues, venueId])

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })

  const { data: wagesData } = useQuery({
    queryKey: ['cash-recon-wages', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })

  const activeStaff  = useMemo(() => (config?.staff ?? []).filter(s => s.is_active), [config])
  const wageDefaults = useMemo(() => config?.wage_defaults ?? [], [config])

  // Keyed by venue+week so switching either re-initialises from server data
  // (or the default staff list) exactly once, without a later config
  // refetch wiping in-progress edits.
  const initializedKey = useRef(null)
  useEffect(() => {
    if (wagesData === undefined || !config || !venueId) return
    const key = `${venueId}|${weekStart}`
    if (initializedKey.current === key) return
    initializedKey.current = key

    const serverEntries = wagesData?.entries ?? []
    if (serverEntries.length > 0) {
      setEntries(serverEntries)
    } else if (wageDefaults.length > 0) {
      setEntries(wageDefaults.map(d => ({
        staff_id:    d.staff_id,
        name:        d.staff_name,
        entry_type:  d.entry_type ?? 'fixed',
        hours:       '',
        rate:        '',
        total:       d.entry_type !== 'hourly' && d.staff_default_rate != null ? String(d.staff_default_rate) : '',
        cash_amount: '',
        notes:       '',
      })))
    } else if (activeStaff.length > 0) {
      setEntries(activeStaff.map(s => ({
        staff_id:    s.id,
        name:        s.name,
        entry_type:  'fixed',
        hours:       '',
        rate:        '',
        total:       s.default_rate != null ? String(s.default_rate) : '',
        cash_amount: '',
        notes:       '',
      })))
    } else {
      setEntries([])
    }
  }, [wagesData, config, venueId, weekStart, activeStaff, wageDefaults])

  const totalWages     = useMemo(() => entries.reduce((s, e) => s + parseNum(e.total ?? (parseNum(e.hours) * parseNum(e.rate))), 0), [entries])
  const totalCashWages = useMemo(() => entries.reduce((s, e) => s + parseNum(e.cash_amount ?? 0), 0), [entries])

  // Preserves whatever hours/rate/notes an entry already had — this page
  // never edits them, only total and cash_amount. Takes an explicit list so
  // add/remove can save the NEW array immediately, before the next render.
  function buildPayload(list = entries) {
    return {
      entries: list.map(e => {
        const et = e.entry_type ?? 'fixed'
        return {
          staff_id:    e.staff_id ?? null,
          name:        e.name,
          entry_type:  et,
          hours:       et === 'fixed' ? null : parseNum(e.hours),
          rate:        et === 'fixed' ? null : parseNum(e.rate),
          total:       parseNum(e.total ?? (et === 'hourly' ? parseNum(e.hours) * parseNum(e.rate) : 0)),
          cash_amount: parseNum(e.cash_amount ?? 0),
          notes:       e.notes ?? '',
        }
      }),
      notes: wagesData?.notes ?? '',
    }
  }

  function triggerSave(data) {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true); setSaved(false); setSaveErr(false)
      try {
        await api.put(`/venues/${venueId}/cash-recon/wages/${weekStart}`, data)
        qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch {
        setSaveErr(true)
      } finally {
        setSaving(false)
      }
    }, 800)
  }

  function handleEntryBlur() {
    triggerSave(buildPayload())
  }

  function updateEntry(idx, field, value) {
    setEntries(p => p.map((e, i) => i === idx ? { ...e, [field]: value } : e))
  }

  function addFromTemplate() {
    const member = activeStaff.find(s => s.id === addStaff)
    if (!member) return
    const newEntry = {
      staff_id: member.id, name: member.name, entry_type: 'fixed',
      hours: '', rate: '', total: member.default_rate != null ? String(member.default_rate) : '', cash_amount: '', notes: '',
    }
    const next = [...entries, newEntry]
    setEntries(next)
    setAddStaff('')
    setAddOpen(false)
    triggerSave(buildPayload(next))
  }

  function addAdhocEntry() {
    if (!addAdhoc.trim()) return
    const newEntry = { staff_id: null, name: addAdhoc.trim(), entry_type: 'fixed', hours: '', rate: '', total: '', cash_amount: '', notes: '' }
    const next = [...entries, newEntry]
    setEntries(next)
    setAddAdhoc('')
    setAddOpen(false)
    triggerSave(buildPayload(next))
  }

  function removeEntry(idx) {
    const next = entries.filter((_, i) => i !== idx)
    setEntries(next)
    triggerSave(buildPayload(next))
  }

  const submitMutation = useMutation({
    mutationFn: (action) => api.post(`/venues/${venueId}/cash-recon/wages/${weekStart}/${action}`, buildPayload()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId, weekStart] }); qc.invalidateQueries({ queryKey: ['cash-recon-week'] }) },
  })

  const setDefaultMutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/cash-recon/wages/${weekStart}/set-default`, {
      entries: entries.map(e => ({ staff_id: e.staff_id ?? null, entry_type: e.entry_type ?? 'fixed' })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
      setDefaultSaved(true)
      setTimeout(() => setDefaultSaved(false), 2000)
    },
  })

  const currentStatus   = wagesData?.status ?? 'none'
  const isSubmitted     = currentStatus === 'submitted'
  const isThisWeek      = weekStart === getMonday(new Date())
  const staffEntryCount = entries.filter(e => e.staff_id).length

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 0 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setWeekStart(format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))}
          className="w-11 h-11 flex items-center justify-center rounded-lg border touch-manipulation" aria-label="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center text-sm font-medium">Week of {format(parseISO(weekStart), 'd MMM yyyy')}</div>
        <button type="button" onClick={() => setWeekStart(format(addWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))}
          className="w-11 h-11 flex items-center justify-center rounded-lg border touch-manipulation" aria-label="Next week">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {!isThisWeek && (
        <button type="button" onClick={() => setWeekStart(getMonday(new Date()))}
          className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
          This week
        </button>
      )}

      <div className="flex items-center gap-2">
        <StatusBadge status={currentStatus} />
        <SaveIndicator saving={saving} saved={saved} error={saveErr} />
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {activeStaff.length > 0 ? 'No staff entries yet — add staff below.' : 'No staff configured for this venue yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <div key={idx} className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate" title={entry.name}>{entry.name}</span>
                <button type="button" onClick={() => removeEntry(idx)}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 touch-manipulation"
                  aria-label={`Remove ${entry.name}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <AmountField label="To be paid (£)" value={entry.total} onChange={v => updateEntry(idx, 'total', v)} onBlur={handleEntryBlur} />
                <AmountField label="Paid (£)" value={entry.cash_amount} onChange={v => updateEntry(idx, 'cash_amount', v)} onBlur={handleEntryBlur} />
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen ? (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddMode('template')}
              className={cn('flex-1 h-10 rounded-lg text-sm touch-manipulation border transition-colors', addMode === 'template' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              From staff list
            </button>
            <button type="button" onClick={() => setAddMode('adhoc')}
              className={cn('flex-1 h-10 rounded-lg text-sm touch-manipulation border transition-colors', addMode === 'adhoc' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              Ad-hoc
            </button>
          </div>
          {addMode === 'template' ? (
            <>
              <select value={addStaff} onChange={e => setAddStaff(e.target.value)}
                className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="">Select staff member…</option>
                {activeStaff.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.default_rate ? ` (£${s.default_rate}/hr)` : ''}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={addFromTemplate} disabled={!addStaff}
                  className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
                <button type="button" onClick={() => setAddOpen(false)}
                  className="flex-1 h-11 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <input value={addAdhoc} onChange={e => setAddAdhoc(e.target.value)} placeholder="Name *"
                className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <div className="flex gap-2">
                <button type="button" onClick={addAdhocEntry} disabled={!addAdhoc.trim()}
                  className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
                <button type="button" onClick={() => setAddOpen(false)}
                  className="flex-1 h-11 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)}
          className="w-full h-12 rounded-xl border-2 border-dashed text-sm text-muted-foreground touch-manipulation hover:border-primary/60 hover:text-foreground transition-colors flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add staff member
        </button>
      )}

      {entries.length > 0 && (
        <button
          type="button"
          disabled={setDefaultMutation.isPending || staffEntryCount === 0}
          onClick={() => setDefaultMutation.mutate()}
          className="w-full flex items-center justify-center gap-1.5 text-sm text-primary touch-manipulation py-2 disabled:opacity-50"
        >
          {setDefaultMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Star className={cn('w-3.5 h-3.5', defaultSaved && 'fill-primary')} />}
          {defaultSaved ? 'Saved as default' : 'Set as default for future weeks'}
        </button>
      )}

      <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-2">
        <h3 className="text-sm font-semibold mb-1">Summary</h3>
        <div className="flex justify-between text-sm"><span>Total wages</span><span className="font-bold">{fmt(totalWages)}</span></div>
        <div className="flex justify-between text-sm"><span>Total cash paid</span><span className="font-bold">{fmt(totalCashWages)}</span></div>
      </div>

      {!isSubmitted ? (
        <button type="button" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate('submit')}
          className="w-full h-12 rounded-xl bg-green-600 text-white text-sm font-medium touch-manipulation hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
        </button>
      ) : (
        <button type="button" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate('unsubmit')}
          className="w-full h-12 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2">
          {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unsubmit'}
        </button>
      )}
    </div>
  )
}
