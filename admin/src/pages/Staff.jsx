// src/pages/Staff.jsx
//
// Staff list per venue (/staff, `staff` module): name, role, pay type and
// rates. Moved out of Cash Recon settings into its own menu entry. The
// staff rows are the same cash_staff records Cash Recon wages use.
//
// Pay model (see services/rotaCalc.js in the API):
//   Hourly  default hourly rate, optional different hourly rate per shift
//   Fixed   per week, per day, or per shift (optional amount per shift)
// Paid by (migration 140): cash in hand, bank transfer, or a split (a fixed
// amount by bank each week, the rest cash); see shared/payMethod.js.
// Leaving and off-rota periods (migration 164): a leaving date (last working
// day) or a period off takes the person off the rota for those days only;
// weeks outside them still show them. Each has its own button in the editor
// and saves straight away, after saying how many rota entries it clears.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { UsersRound, Plus, Loader2, LogOut, CalendarOff, ChevronDown } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { cn } from '@/lib/utils'
import { PAY_TYPES, staffRateLabel } from '@/pages/CashRecon'
import { PAY_METHODS, payMethodLabel } from '@shared/payMethod.js'
import {
  useVenues, useVenueChoice, useRotaSetup, PageHeader, VenuePicker, Segmented,
  SortableRows, Modal, Field, inputCls, ConfirmDelete, ErrorNote, PAY_BASES, hhmm,
  DateButton, fmtDay, addDay, staffStanding,
} from '@/components/staff/shared'

const todayStr = () => format(new Date(), 'yyyy-MM-dd')

/** Everything that shows who is on the rota, refreshed after a leaving / off-rota change. */
function useStaffInvalidate(venueId) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['rota-staff', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
    qc.invalidateQueries({ queryKey: ['rota-week'] })
    qc.invalidateQueries({ queryKey: ['rota-pay'] })
  }
}

const entriesText = n => `${n} rota entr${n === 1 ? 'y' : 'ies'}`

/** Inline "this clears N entries" confirm before a leaving date or period is saved. */
function ClearConfirm({ text, confirmLabel, onConfirm, onCancel, busy }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p className="text-xs text-amber-900">{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={busy}
          className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}
          className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
      </div>
    </div>
  )
}

/**
 * Leaving date (cash_staff.left_on = last working day). Setting it takes the
 * person's rota entries after that day off the rota; weeks up to it still
 * show them. Clearing it doesn't bring those entries back.
 */
function LeavingSection({ venueId, person }) {
  const api = useApi()
  const refresh = useStaffInvalidate(venueId)
  const today = todayStr()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(person.left_on ?? today)
  const [note, setNote] = useState(person.left_note ?? '')
  const [pending, setPending] = useState(null) // { entries } waiting for confirm
  const [askClear, setAskClear] = useState(false)
  const [done, setDone] = useState(null)

  const url = `/rota/venues/${venueId}/staff/${person.id}/leaving`
  const check = useMutation({
    mutationFn: () => api.put(url, { left_on: date, note: note.trim() || null, dry_run: true }),
    onSuccess: r => { if (r.entries > 0) setPending(r); else apply.mutate() },
  })
  const apply = useMutation({
    mutationFn: () => api.put(url, { left_on: date, note: note.trim() || null }),
    onSuccess: r => {
      setPending(null); setOpen(false); refresh()
      setDone(r.removed_entries > 0 ? `${entriesText(r.removed_entries)} after ${fmtDay(date)} taken off the rota.` : null)
    },
  })
  const clear = useMutation({
    mutationFn: () => api.put(url, { left_on: null }),
    onSuccess: () => { setAskClear(false); setDone(null); refresh() },
  })
  const busy = check.isPending || apply.isPending || clear.isPending

  function startEdit() {
    setDate(person.left_on ?? today); setNote(person.left_note ?? ''); setPending(null); setDone(null)
    check.reset(); apply.reset(); clear.reset(); setOpen(true)
  }

  return (
    <section className="rounded-xl border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <LogOut className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold flex-1">Leaving</h3>
      </div>
      {!open && (person.left_on ? (
        <div className="space-y-2">
          <p className="text-sm">
            Last working day <span className="font-medium">{fmtDay(person.left_on, true)}</span>
            {person.left_on < today
              ? <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Left</span>
              : <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Leaving</span>}
          </p>
          {person.left_note && <p className="text-xs text-muted-foreground">{person.left_note}</p>}
          <p className="text-xs text-muted-foreground">
            Off the rota from {fmtDay(addDay(person.left_on), true)}. Weeks up to their last day still show them.
          </p>
          {askClear ? (
            <ClearConfirm busy={busy} confirmLabel="Yes, clear leaving date" onConfirm={() => clear.mutate()} onCancel={() => setAskClear(false)}
              text={`${person.name} goes back on the rota from ${fmtDay(addDay(person.left_on))}. Rota entries taken off when the date was set are not put back.`} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startEdit}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Change date</button>
              <button type="button" onClick={() => setAskClear(true)}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Clear leaving date</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            For someone who has resigned or been let go. They stay on the rota up to their last working day, and earlier weeks keep showing them.
          </p>
          <button type="button" onClick={startEdit}
            className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Set a leaving date</button>
        </div>
      ))}
      {open && (
        <div className="space-y-3">
          <Field label="Last working day" hint={`Not on the rota from ${fmtDay(addDay(date), true)}.`}>
            <DateButton value={date} onChange={v => { setDate(v); setPending(null) }} label="Last working day" className="w-full" />
          </Field>
          <Field label="Reason (optional)">
            <input className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. Resigned, end of contract" />
          </Field>
          {pending ? (
            <ClearConfirm busy={busy} confirmLabel="Yes, set leaving date" onConfirm={() => apply.mutate()} onCancel={() => setPending(null)}
              text={`This takes ${entriesText(pending.entries)} after ${fmtDay(date)} off the rota. Clearing the date later doesn't put them back.`} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => check.mutate()} disabled={!date || busy}
                className="h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save leaving date
              </button>
              <button type="button" onClick={() => { setOpen(false); check.reset(); apply.reset() }}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
            </div>
          )}
        </div>
      )}
      {done && <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{done}</p>}
      <ErrorNote error={check.error || apply.error || clear.error} />
    </section>
  )
}

/**
 * Off-rota periods (staff_rota_off): days the person isn't on the rota, e.g.
 * long leave or a season away. Adding one takes their rota entries in it off.
 */
function OffPeriodsSection({ venueId, person }) {
  const api = useApi()
  const refresh = useStaffInvalidate(venueId)
  const today = todayStr()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const [done, setDone] = useState(null)

  const periods = person.off_periods ?? []
  const current = periods.filter(p => p.to_date >= today)
  const past = periods.filter(p => p.to_date < today).reverse()
  const url = `/rota/venues/${venueId}/staff/${person.id}/off-periods`
  const body = () => ({ from_date: from, to_date: to, note: note.trim() || null })

  const check = useMutation({
    mutationFn: () => api.post(url, { ...body(), dry_run: true }),
    onSuccess: r => { if (r.entries > 0) setPending(r); else add.mutate() },
  })
  const add = useMutation({
    mutationFn: () => api.post(url, body()),
    onSuccess: r => {
      setPending(null); setOpen(false); setNote(''); refresh()
      setDone(r.removed_entries > 0 ? `${entriesText(r.removed_entries)} in that period taken off the rota.` : null)
    },
  })
  const remove = useMutation({
    mutationFn: id => api.delete(`${url}/${id}`),
    onSuccess: () => { setDone(null); refresh() },
  })
  const busy = check.isPending || add.isPending
  const bad = !from || !to || to < from

  function row(p) {
    const now = p.from_date <= today && p.to_date >= today
    return (
      <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm">
            {fmtDay(p.from_date, true)} to {fmtDay(p.to_date, true)}
            {now && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Now</span>}
          </div>
          {p.note && <div className="text-xs text-muted-foreground truncate">{p.note}</div>}
        </div>
        <ConfirmDelete onConfirm={() => remove.mutate(p.id)} disabled={remove.isPending}
          label="Remove this period" confirmLabel="Yes, remove" />
      </div>
    )
  }

  return (
    <section className="rounded-xl border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarOff className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold flex-1">Off the rota</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Dates they can't be put on the rota, e.g. long leave or a season away. Paid holiday still goes on the rota as PTO.
      </p>
      {current.length > 0 && <div className="rounded-lg border divide-y">{current.map(row)}</div>}
      {past.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowPast(v => !v)}
            className="h-11 px-2 -ml-2 rounded-lg text-xs text-muted-foreground touch-manipulation hover:bg-muted flex items-center gap-1">
            <ChevronDown className={cn('w-4 h-4 transition-transform', showPast && 'rotate-180')} />
            {showPast ? 'Hide' : 'Show'} {past.length} past period{past.length === 1 ? '' : 's'}
          </button>
          {showPast && <div className="rounded-lg border divide-y">{past.map(row)}</div>}
        </div>
      )}
      {current.length > 0 && <p className="text-[11px] text-muted-foreground">Removing a period doesn't put back rota entries it took off.</p>}
      {open ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="From">
              <DateButton value={from} onChange={v => { setFrom(v); if (to < v) setTo(v); setPending(null) }} label="Off the rota from" className="w-full" />
            </Field>
            <Field label="To (included)">
              <DateButton value={to} min={from} onChange={v => { setTo(v); setPending(null) }} label="Off the rota until" className="w-full" />
            </Field>
          </div>
          <Field label="Reason (optional)">
            <input className={inputCls} value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="e.g. Maternity leave, back home for the summer" />
          </Field>
          {pending ? (
            <ClearConfirm busy={busy} confirmLabel="Yes, add period" onConfirm={() => add.mutate()} onCancel={() => setPending(null)}
              text={`This takes ${entriesText(pending.entries)} between ${fmtDay(from)} and ${fmtDay(to)} off the rota. Removing the period later doesn't put them back.`} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => check.mutate()} disabled={bad || busy}
                className="h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Add period
              </button>
              <button type="button" onClick={() => { setOpen(false); setPending(null); check.reset(); add.reset() }}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => { setFrom(today); setTo(today); setNote(''); setDone(null); check.reset(); add.reset(); setOpen(true) }}
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add a period off the rota
        </button>
      )}
      {done && <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{done}</p>}
      <ErrorNote error={check.error || add.error || remove.error} />
    </section>
  )
}

/** Small badges for the staff list: leaving / left and off-rota periods. */
function StandingBadges({ person, today }) {
  const s = staffStanding(person, today)
  return (
    <>
      {s.left && <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Left {fmtDay(s.leftOn)}</span>}
      {s.leaving && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Last day {fmtDay(s.leftOn)}</span>}
      {!s.left && s.offNow && (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Off rota until {fmtDay(s.offNow.to_date)}</span>
      )}
      {!s.left && !s.offNow && s.offNext && (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Off rota from {fmtDay(s.offNext.from_date)}</span>
      )}
    </>
  )
}

const EMPTY = {
  name: '', role_id: null, pay_type: 'fixed', pay_basis: 'week', default_rate: '',
  pay_method: 'cash', bank_amount: '', is_active: true, shift_rates: {},
}

function rateLabel(payType, basis) {
  if (payType === 'hourly') return 'Hourly rate (£ per hour)'
  if (basis === 'day') return 'Amount per day worked (£)'
  if (basis === 'shift') return 'Default amount per shift (£)'
  return 'Amount per week worked (£)'
}

function StaffEditor({ venueId, initial, live, roles, shifts, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...initial,
    default_rate: initial?.default_rate ?? '',
    pay_method:   initial?.pay_method ?? 'cash',
    bank_amount:  initial?.bank_amount ?? '',
  }))
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const perShift = form.pay_type === 'hourly' || form.pay_basis === 'shift'
  const activeShifts = shifts.filter(s => s.is_active || form.shift_rates[s.id] != null)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name:         form.name.trim(),
        role_id:      form.role_id || null,
        pay_type:     form.pay_type,
        pay_basis:    form.pay_basis,
        default_rate: form.default_rate === '' ? null : Number(form.default_rate),
        pay_method:   form.pay_method,
        bank_amount:  form.pay_method === 'split' && form.bank_amount !== '' ? Number(form.bank_amount) : null,
        is_active:    form.is_active,
        shift_rates:  perShift
          ? Object.entries(form.shift_rates)
              .filter(([, v]) => v !== '' && v != null)
              .map(([shift_id, rate]) => ({ shift_id, rate: Number(rate) }))
          : [],
      }
      return initial?.id
        ? api.patch(`/rota/venues/${venueId}/staff/${initial.id}`, body)
        : api.post(`/rota/venues/${venueId}/staff`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rota-staff', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
      qc.invalidateQueries({ queryKey: ['rota-week'] })
      qc.invalidateQueries({ queryKey: ['rota-pay'] })
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/rota/venues/${venueId}/staff/${initial.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rota-staff', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
      onClose()
    },
  })

  return (
    <Modal title={initial?.id ? `Edit ${initial.name}` : 'Add staff member'} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        {initial?.id && (
          <ConfirmDelete onConfirm={() => remove.mutate()} disabled={remove.isPending}
            label="Delete staff member" confirmLabel="Yes, delete" />
        )}
      </>}>
      <Field label="Name">
        <input className={inputCls} value={form.name} onChange={e => set({ name: e.target.value })} maxLength={200} />
      </Field>
      <Field label="Role" hint={roles.length ? 'The role sets the tip points multiplier.' : 'Add roles on the Roles page.'}>
        <select className={inputCls} value={form.role_id ?? ''} onChange={e => set({ role_id: e.target.value || null })}>
          <option value="">No role</option>
          {roles.filter(r => r.is_active || r.id === form.role_id).map(r => (
            <option key={r.id} value={r.id}>{r.name} (×{r.points_multiplier})</option>
          ))}
        </select>
      </Field>
      <Field label="Pay type">
        <Segmented value={form.pay_type} options={PAY_TYPES} onChange={v => set({ pay_type: v })} />
      </Field>
      {form.pay_type === 'fixed' && (
        <Field label="Fixed pay is">
          <Segmented value={form.pay_basis} options={PAY_BASES} onChange={v => set({ pay_basis: v })} />
        </Field>
      )}
      <Field label={rateLabel(form.pay_type, form.pay_basis)}>
        <input className={inputCls} inputMode="decimal" value={form.default_rate ?? ''}
          onChange={e => set({ default_rate: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" />
      </Field>
      {perShift && (
        <Field label={form.pay_type === 'hourly' ? 'Hourly rate per shift (blank = default rate)' : 'Amount per shift (blank = default amount)'}>
          {activeShifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No shifts yet. Add them on the Rota setup page.</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {activeShifts.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 min-w-0 text-sm truncate">
                    {s.name} <span className="text-xs text-muted-foreground">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">£</span>
                  <input className="h-11 w-24 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
                    inputMode="decimal" aria-label={`${s.name} rate`}
                    value={form.shift_rates[s.id] ?? ''} placeholder={form.default_rate || '0.00'}
                    onChange={e => set({ shift_rates: { ...form.shift_rates, [s.id]: e.target.value.replace(/[^0-9.]/g, '') } })} />
                </div>
              ))}
            </div>
          )}
        </Field>
      )}
      <Field label="Paid by" hint={form.pay_method === 'split'
        ? 'This amount goes by bank transfer each week; the rest is cash in hand. A week that pays less goes all to the bank.'
        : 'Shown on the rota pay and wages as bank transfer or cash in hand.'}>
        <Segmented value={form.pay_method} options={PAY_METHODS} onChange={v => set({ pay_method: v })} />
      </Field>
      {form.pay_method === 'split' && (
        <Field label="Bank transfer each week (£)">
          <input className={inputCls} inputMode="decimal" value={form.bank_amount ?? ''}
            onChange={e => set({ bank_amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" />
        </Field>
      )}
      <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
        <input type="checkbox" className="w-5 h-5" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} />
        <span className="text-sm">Active (shown on the rota and new wage weeks)</span>
      </label>
      {initial?.id && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Turning Active off hides them from every week. To keep earlier weeks, set a leaving date below instead.
        </p>
      )}
      <ErrorNote error={save.error || remove.error} />
      {live && (
        <div className="space-y-3 pt-1">
          <p className="text-[11px] text-muted-foreground">These save straight away, separately from Save below.</p>
          <LeavingSection venueId={venueId} person={live} />
          <OffPeriodsSection venueId={venueId} person={live} />
        </div>
      )}
    </Modal>
  )
}

export default function Staff() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const { data: setup } = useRotaSetup()
  const [editing, setEditing] = useState(null) // null | 'new' | staff row
  const [showLeft, setShowLeft] = useState(false)
  // Staff & rota setup = View: the list can be read, not changed.
  const { canManage } = usePermission('staff')

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['rota-staff', venueId],
    queryFn:  () => api.get(`/rota/venues/${venueId}/staff`),
    enabled:  !!venueId,
  })
  const roles = setup?.roles ?? []
  const shifts = setup?.shifts ?? []
  const roleById = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r])), [roles])
  // People past their last working day go in their own group under the list.
  const today = todayStr()
  const current = useMemo(() => staff.filter(s => !staffStanding(s, today).left), [staff, today])
  const left = useMemo(() => staff.filter(s => staffStanding(s, today).left), [staff, today])
  // The editor reads the person from the list, so leaving / off-rota changes show at once.
  const live = editing && editing !== 'new' ? staff.find(s => s.id === editing.id) ?? null : null

  const reorder = useMutation({
    // Left people keep their place after everyone current.
    mutationFn: ids => api.put(`/rota/venues/${venueId}/staff/reorder`, { ids: [...ids, ...left.map(s => s.id)] }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rota-staff', venueId] }),
  })

  function personRow(s) {
    const role = s.role_id ? roleById[s.role_id] : null
    const rate = staffRateLabel(s)
    const shiftRateCount = Object.keys(s.shift_rates ?? {}).length
    return (
      <button type="button" onClick={() => setEditing(s)} disabled={!canManage}
        className={cn('w-full min-h-[48px] flex flex-wrap items-center gap-x-3 gap-y-1 text-left rounded-lg px-2 py-1.5 hover:bg-muted disabled:hover:bg-transparent disabled:cursor-default touch-manipulation', !s.is_active && 'opacity-60')}>
        <span className="flex-1 basis-32 min-w-0 truncate text-sm font-medium">{s.name}</span>
        <StandingBadges person={s} today={today} />
        {role && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{role.name}</span>}
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {s.pay_type === 'hourly' ? 'Hourly' : `Fixed ${PAY_BASES.find(b => b.value === s.pay_basis)?.label.toLowerCase() ?? ''}`}
          {rate ? ` · ${rate}` : ''}
          {shiftRateCount > 0 ? ` · ${shiftRateCount} shift rate${shiftRateCount > 1 ? 's' : ''}` : ''}
        </span>
        {(s.pay_method ?? 'cash') !== 'cash' && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">{payMethodLabel(s.pay_method, s.bank_amount)}</span>
        )}
        {!s.is_active && <span className="text-[11px] text-muted-foreground">Inactive</span>}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={UsersRound} title="Staff">
        <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
        {canManage && (
          <button type="button" onClick={() => setEditing('new')} disabled={!venueId}
            className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add staff
          </button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-3">
          {canManage ? (
            <p className="text-xs text-muted-foreground">
              Drag to change the order used on the rota and wages. Tap a person to edit their role and pay.
            </p>
          ) : <ReadOnlyNotice what="the staff list" />}
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : staff.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No staff for this venue yet.</p>
          ) : current.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Everyone on this venue's staff has left.</p>
          ) : (
            <SortableRows items={current} locked={!canManage} onReorder={ids => reorder.mutate(ids)} renderItem={personRow} />
          )}
          {current.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {current.filter(s => s.is_active).length} active. Rates shown are each person's default; per-shift rates are set inside the person.
            </p>
          )}
          {left.length > 0 && (
            <div className="space-y-2 pt-2">
              <button type="button" onClick={() => setShowLeft(v => !v)} aria-expanded={showLeft}
                className="h-11 px-2 -ml-2 rounded-lg text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-1.5">
                <ChevronDown className={cn('w-4 h-4 transition-transform', showLeft && 'rotate-180')} />
                Left ({left.length})
              </button>
              {showLeft && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Past their last working day: not on the rota or new wage weeks. Weeks up to their last day still show them.
                  </p>
                  <div className="rounded-xl border divide-y overflow-hidden">
                    {left.map(s => <div key={s.id} className="px-2 py-1">{personRow(s)}</div>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <StaffEditor venueId={venueId} initial={editing === 'new' ? null : editing} live={live}
          roles={roles} shifts={shifts} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
