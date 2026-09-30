// src/components/cashRecon/WagesTable.jsx
//
// WeekWagesEditor: the one editor for a venue week's Cash Recon wages
// (cash_wage_entries), used by the Cash Recon Wages page, both Cash
// Dashboard wage widgets (Week staff list, Wages paid) and /mobile/wages.
//
// Every place shows the same columns: Name, Total, Paid, Paid on, Notes.
// Pay type, hours and rate are not shown; they are kept as loaded and sent
// back unchanged, except that typing a Total makes the row a fixed amount.
// Wages are not submitted (days are): edits are held in a local draft and
// written by Save (the whole-list PUT), or dropped by Discard.
//
// Paid is the cash handed over from the till, on the Paid on day (that
// day's variance counts it). A row paid less than its total shows what's
// left; the Rota adds that to the person's pay next week ("Owed from last
// week", routes/rota.js). A row with nothing paid in cash isn't carried
// (bank transfer, or not paid yet).
//
// Layout follows the space it's given (ResizeObserver): a table row per
// person from 640px, a card per person below that.

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, subWeeks, parseISO } from 'date-fns'
import { Check, Loader2, Plus, Trash2, Copy, Star, X, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  fmt, parseNum, getMonday, isoWeekDates, staffRateLabel, wageEntryForStaff, defaultWageEntries, PaidDaySelect,
} from '@/pages/CashRecon'

const WIDE_MIN = 640

function round2(n) { return Math.round(n * 100) / 100 }

function hourlyTotal(e) {
  return round2(parseNum(e.hours) * parseNum(e.rate))
}

// One entry as the editor holds it: amounts as strings so a field can be
// cleared and retyped.
function toRow(e) {
  const hourly = e.entry_type === 'hourly'
  const hasTotal = e.total != null && e.total !== ''
  const total = hasTotal ? String(e.total) : (hourly && hourlyTotal(e) > 0 ? hourlyTotal(e).toFixed(2) : '')
  const cash = parseNum(e.cash_amount)
  return {
    id:          e.id ?? null,
    staff_id:    e.staff_id ?? null,
    name:        e.name,
    entry_type:  e.entry_type ?? 'fixed',
    hours:       e.hours ?? '',
    rate:        e.rate ?? '',
    total,
    cash_amount: cash > 0 ? String(e.cash_amount) : '',
    paid_date:   cash > 0 ? (e.paid_date ?? null) : null,
    notes:       e.notes ?? '',
  }
}

function toPayload(r) {
  const hourly = r.entry_type === 'hourly'
  const cash = parseNum(r.cash_amount)
  return {
    id:          r.id ?? undefined,
    staff_id:    r.staff_id ?? null,
    name:        r.name,
    entry_type:  hourly ? 'hourly' : 'fixed',
    hours:       hourly && r.hours !== '' ? parseNum(r.hours) : null,
    rate:        hourly && r.rate !== '' ? parseNum(r.rate) : null,
    total:       round2(parseNum(r.total)),
    cash_amount: round2(cash),
    paid_date:   cash > 0 ? (r.paid_date || null) : null,
    notes:       r.notes?.trim() ? r.notes.trim() : null,
  }
}

export function unpaidOf(r) {
  return round2(Math.max(0, parseNum(r.total) - parseNum(r.cash_amount)))
}

function MoneyField({ value, onChange, label, placeholder = '0.00', className }) {
  return (
    <label className={cn(
      'h-11 flex items-center gap-1 rounded-lg border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-primary/40',
      className,
    )}>
      <span className="text-muted-foreground">£</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none touch-manipulation"
      />
    </label>
  )
}

// Width of the element passed to the returned ref callback.
function useWidth() {
  const [el, setEl] = useState(null)
  const [width, setWidth] = useState(null)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

/**
 * @param venueId, weekStart  the venue week
 * @param defaultPaidDay      day a new payment is recorded on (the dashboard's
 *                            selected day); falls back to today when it's in
 *                            the week
 * @param showWeekNotes       show the week's own notes box (the Wages page)
 * @param layout              'auto' (by width) | 'cards'
 */
export function WeekWagesEditor({ venueId, weekStart, defaultPaidDay, showWeekNotes = false, layout = 'auto' }) {
  const api = useApi()
  const qc = useQueryClient()
  const [rootRef, width] = useWidth()
  const wide = layout === 'auto' && (width == null ? false : width >= WIDE_MIN)

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

  // null = showing what's saved (or the default list for a new week);
  // an array = unsaved edits. Reset whenever the venue or week changes.
  const [draft, setDraft] = useState(null)
  const [notesDraft, setNotesDraft] = useState(null)
  const [panel, setPanel] = useState(null)       // null | 'add' | 'copy'
  const [notice, setNotice] = useState(null)
  const [addStaffId, setAddStaffId] = useState('')
  const [addName, setAddName] = useState('')
  const [copyWeek, setCopyWeek] = useState('')
  const [copying, setCopying] = useState(false)
  const key = `${venueId}|${weekStart}`
  const [draftKey, setDraftKey] = useState(key)
  if (draftKey !== key) {
    setDraftKey(key); setDraft(null); setNotesDraft(null); setPanel(null); setNotice(null)
  }

  const savedEntries = wagesData?.entries
  const isNew = !savedEntries || savedEntries.length === 0
  const baseRows = useMemo(
    () => (isNew ? defaultWageEntries(config) : savedEntries).map(toRow),
    [isNew, config, savedEntries],
  )
  const rows = draft ?? baseRows
  const weekNotes = notesDraft ?? (wagesData?.notes ?? '')
  const dirty = draft !== null || notesDraft !== null
  const canSave = dirty || (isNew && rows.length > 0)
  const staffById = useMemo(() => Object.fromEntries((config?.staff ?? []).map(s => [s.id, s])), [config])

  const days = isoWeekDates(weekStart)
  const today = format(new Date(), 'yyyy-MM-dd')
  const payDay = (defaultPaidDay && days.includes(defaultPaidDay)) ? defaultPaidDay : (days.includes(today) ? today : null)

  const copyOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const wk = getMonday(subWeeks(parseISO(weekStart), i + 1))
    return { value: wk, label: `w/c ${format(parseISO(wk), 'd MMM yyyy')}${i === 0 ? ' (last week)' : ''}` }
  }), [weekStart])

  function edit(next) { setDraft(next); setNotice(null) }
  function update(idx, patch) { edit(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))) }

  // Typing a total makes the row a fixed amount (hours x rate no longer apply).
  function setTotal(idx, v) {
    update(idx, { total: v, entry_type: 'fixed', hours: '', rate: '' })
  }
  function setPaid(idx, v) {
    const r = rows[idx]
    const paid = parseNum(v) > 0
    update(idx, { cash_amount: v, paid_date: paid ? (r.paid_date || payDay) : null })
  }
  function payInFull(idx) {
    const r = rows[idx]
    update(idx, { cash_amount: r.total, paid_date: r.paid_date || payDay })
  }
  function payAllInFull() {
    edit(rows.map(r => (parseNum(r.total) > 0 ? { ...r, cash_amount: r.total, paid_date: r.paid_date || payDay } : r)))
  }
  function setAllPaidDays(day) {
    edit(rows.map(r => (parseNum(r.cash_amount) > 0 ? { ...r, paid_date: day } : r)))
  }

  const invalidateWeek = () => {
    qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
    // Part-paid rows carry into next week's rota pay.
    qc.invalidateQueries({ queryKey: ['rota-pay', venueId] })
  }

  const save = useMutation({
    mutationFn: () => api.put(`/venues/${venueId}/cash-recon/wages/${weekStart}`, {
      notes:   weekNotes.trim() ? weekNotes.trim() : null,
      entries: rows.map(toPayload),
    }),
    onSuccess: () => { setDraft(null); setNotesDraft(null); setNotice({ tone: 'ok', text: 'Saved' }); invalidateWeek() },
    onError: err => setNotice({ tone: 'error', text: err?.message || 'Save failed' }),
  })

  // The default list stores who's on it and each person's pay type from
  // their staff record (types aren't edited here).
  const setDefault = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/cash-recon/wages/${weekStart}/set-default`, {
      entries: rows.map(r => ({
        staff_id:   r.staff_id ?? null,
        entry_type: (r.staff_id && staffById[r.staff_id]?.pay_type) || r.entry_type || 'fixed',
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
      const adhoc = rows.some(r => !r.staff_id)
      setNotice({ tone: 'ok', text: adhoc ? 'Set as default (one-off names are not included)' : 'Set as the default list for new weeks' })
    },
    onError: err => setNotice({ tone: 'error', text: err?.message || 'Could not set default' }),
  })

  function addEntry() {
    if (addStaffId) {
      const member = staffById[addStaffId]
      if (member) edit([...rows, toRow(wageEntryForStaff(member))])
    } else if (addName.trim()) {
      edit([...rows, toRow({ staff_id: null, name: addName.trim(), entry_type: 'fixed', total: '', cash_amount: '' })])
    }
    setAddStaffId(''); setAddName(''); setPanel(null)
  }

  async function copyFrom() {
    const wk = copyWeek || copyOptions[0].value
    setCopying(true)
    try {
      const src = await qc.fetchQuery({
        queryKey: ['cash-recon-wages', venueId, wk],
        queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${wk}`),
      })
      const list = src?.entries ?? []
      const label = `w/c ${format(parseISO(wk), 'd MMM')}`
      if (list.length === 0) {
        setNotice({ tone: 'error', text: `No wages saved for ${label}` })
      } else {
        // Who and how much; nothing is paid yet in this week.
        edit(list.map(e => toRow({ ...e, id: null, cash_amount: '', paid_date: null, notes: '' })))
        setNotice({ tone: 'info', text: `Copied ${list.length} from ${label}. Save to keep it.` })
        setPanel(null)
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err?.message || 'Could not load that week' })
    } finally {
      setCopying(false)
    }
  }

  if (wagesData === undefined || !config) {
    return (
      <div ref={rootRef} className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const onList = new Set(rows.map(r => r.staff_id).filter(Boolean))
  const addable = (config.staff ?? []).filter(s => s.is_active && !onList.has(s.id))
  const total = round2(rows.reduce((s, r) => s + parseNum(r.total), 0))
  const paid = round2(rows.reduce((s, r) => s + parseNum(r.cash_amount), 0))
  const left = round2(rows.reduce((s, r) => s + unpaidOf(r), 0))
  const GRID = 'grid grid-cols-[minmax(7rem,1.2fr)_6.5rem_10rem_7rem_minmax(7rem,1fr)_2.75rem] gap-2 items-center'

  function unpaidNote(r) {
    const cash = parseNum(r.cash_amount), tot = parseNum(r.total)
    if (cash > 0 && cash < tot - 0.004) {
      return (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {fmt(unpaidOf(r))} not paid. {r.staff_id ? "Carries to next week's rota pay." : 'One-off names don\'t carry over.'}
        </p>
      )
    }
    if (cash > tot + 0.004) {
      return (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Paid {fmt(round2(cash - tot))} more than the total.
        </p>
      )
    }
    return null
  }

  function paidCell(r, idx) {
    const full = parseNum(r.total) > 0 && Math.abs(parseNum(r.cash_amount) - parseNum(r.total)) < 0.005
    return (
      <div className="flex items-center gap-1 min-w-0">
        <MoneyField label={`${r.name} paid`} value={r.cash_amount} onChange={v => setPaid(idx, v)} className="flex-1 min-w-0" />
        <button type="button" onClick={() => payInFull(idx)} disabled={parseNum(r.total) <= 0 || full}
          aria-label={`Pay ${r.name} in full`}
          className={cn(
            'h-11 px-2 shrink-0 rounded-lg border text-xs font-medium touch-manipulation transition-colors disabled:cursor-default',
            full ? 'bg-green-600 border-green-600 text-white disabled:opacity-100' : 'hover:bg-muted disabled:opacity-40',
          )}>
          {full ? <Check className="w-4 h-4" /> : 'Full'}
        </button>
      </div>
    )
  }

  function removeButton(r, idx) {
    return (
      <button type="button" aria-label={`Remove ${r.name}`}
        onClick={() => edit(rows.filter((_, i) => i !== idx))}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 touch-manipulation">
        <Trash2 className="w-4 h-4" />
      </button>
    )
  }

  function nameCell(r) {
    const staff = r.staff_id ? staffById[r.staff_id] : null
    return (
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" title={r.name}>{r.name}</span>
        {!r.staff_id && <span className="block text-[10px] text-muted-foreground">one-off</span>}
        {staff && staff.is_active === false && <span className="block text-[10px] text-muted-foreground">inactive</span>}
      </span>
    )
  }

  return (
    <div ref={rootRef} className="space-y-2">
      {isNew && draft === null && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing saved for this week yet. Filled from your {config.wage_defaults?.length ? 'default list' : 'active staff'}; Save to keep it.
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={payAllInFull}
            className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
            <Check className="w-4 h-4" /> Pay everyone in full
          </button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Paid on for all
            <PaidDaySelect weekStart={weekStart} value="" emptyLabel="Choose…" className="h-11"
              onChange={day => { if (day) setAllPaidDays(day) }} />
          </label>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No staff on this week yet.</p>
      )}

      {rows.length > 0 && wide && (
        <div className="rounded-xl border">
          <div className={cn(GRID, 'px-2 py-1.5 border-b text-[11px] font-medium uppercase tracking-wide text-muted-foreground')}>
            <span>Name</span><span>Total</span><span>Paid</span><span>Paid on</span><span>Notes</span><span />
          </div>
          <div className="divide-y">
            {rows.map((r, idx) => (
              <div key={r.id ?? `${r.staff_id ?? 'adhoc'}-${idx}`} className="px-2 py-1.5 space-y-1">
                <div className={GRID}>
                  {nameCell(r)}
                  <MoneyField label={`${r.name} total`} value={r.total} onChange={v => setTotal(idx, v)} />
                  {paidCell(r, idx)}
                  <PaidDaySelect weekStart={weekStart} value={r.paid_date} className="h-11 w-full min-w-0"
                    disabled={parseNum(r.cash_amount) <= 0}
                    onChange={day => update(idx, { paid_date: day })} />
                  <input type="text" value={r.notes} placeholder="Notes" aria-label={`${r.name} notes`}
                    onChange={ev => update(idx, { notes: ev.target.value })}
                    className="h-11 w-full min-w-0 rounded-lg border bg-background px-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  {removeButton(r, idx)}
                </div>
                {unpaidNote(r)}
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && !wide && (
        <div className="rounded-xl border divide-y">
          {rows.map((r, idx) => (
            <div key={r.id ?? `${r.staff_id ?? 'adhoc'}-${idx}`} className="p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">{nameCell(r)}</div>
                {removeButton(r, idx)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[11px] text-muted-foreground mb-0.5">Total</span>
                  <MoneyField label={`${r.name} total`} value={r.total} onChange={v => setTotal(idx, v)} />
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground mb-0.5">Paid</span>
                  {paidCell(r, idx)}
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground mb-0.5">Paid on</span>
                  <PaidDaySelect weekStart={weekStart} value={r.paid_date} className="h-11 w-full"
                    disabled={parseNum(r.cash_amount) <= 0}
                    onChange={day => update(idx, { paid_date: day })} />
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground mb-0.5">Notes</span>
                  <input type="text" value={r.notes} placeholder="Notes" aria-label={`${r.name} notes`}
                    onChange={ev => update(idx, { notes: ev.target.value })}
                    className="h-11 w-full min-w-0 rounded-lg border bg-background px-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
              </div>
              {unpaidNote(r)}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl bg-muted/30 px-3 py-2 space-y-0.5 text-sm">
          <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{fmt(total)}</span></div>
          <div className="flex justify-between"><span>Paid (cash)</span><span className="tabular-nums">{fmt(paid)}</span></div>
          <div className="flex justify-between font-semibold"><span>Left to pay</span><span className="tabular-nums">{fmt(left)}</span></div>
        </div>
      )}

      {panel === 'add' && (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
          {addable.length > 0 && (
            <select value={addStaffId} onChange={ev => { setAddStaffId(ev.target.value); setAddName('') }}
              className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation">
              <option value="">Pick from staff list…</option>
              {addable.map(s => (
                <option key={s.id} value={s.id}>{s.name}{staffRateLabel(s) ? ` (${staffRateLabel(s)})` : ''}</option>
              ))}
            </select>
          )}
          <input type="text" value={addName} placeholder={addable.length > 0 ? 'or type a one-off name' : 'Name'}
            onChange={ev => { setAddName(ev.target.value); setAddStaffId('') }}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation" />
          <div className="flex gap-2">
            <button type="button" onClick={addEntry} disabled={!addStaffId && !addName.trim()}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
            <button type="button" onClick={() => setPanel(null)}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {panel === 'copy' && (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
          <p className="text-xs text-muted-foreground">Replaces this week's list with the names and totals from:</p>
          <select value={copyWeek || copyOptions[0].value} onChange={ev => setCopyWeek(ev.target.value)}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation">
            {copyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={copyFrom} disabled={copying}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
              {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} Copy
            </button>
            <button type="button" onClick={() => setPanel(null)}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {showWeekNotes && (
        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1">Notes for the week</span>
          <textarea value={weekNotes} rows={2} placeholder="Any notes for this week's wages…"
            onChange={ev => { setNotesDraft(ev.target.value); setNotice(null) }}
            className="w-full rounded-xl border bg-background px-3 py-2.5 text-base touch-manipulation resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </label>
      )}

      {notice && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
          notice.tone === 'error' ? 'bg-red-50 text-red-700' : notice.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-muted text-foreground',
        )}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="shrink-0 touch-manipulation">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {panel === null && (
          <>
            <button type="button" onClick={() => setPanel('add')}
              className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Add staff
            </button>
            <button type="button" onClick={() => setPanel('copy')}
              className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <Copy className="w-4 h-4" /> Copy from…
            </button>
          </>
        )}
        <button type="button" onClick={() => setDefault.mutate()}
          disabled={setDefault.isPending || !rows.some(r => r.staff_id)}
          title="Use this list (who is on it) for new weeks"
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50 flex items-center gap-1.5">
          {setDefault.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />} Set as default
        </button>
      </div>

      {canSave && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
          {dirty && (
            <button type="button" onClick={() => { setDraft(null); setNotesDraft(null); setNotice(null) }} disabled={save.isPending}
              className="flex-1 h-11 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
              Discard changes
            </button>
          )}
        </div>
      )}
    </div>
  )
}
