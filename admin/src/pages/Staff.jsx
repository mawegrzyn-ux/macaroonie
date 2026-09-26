// src/pages/Staff.jsx
//
// Staff list per venue (/staff, `staff` module): name, role, pay type and
// rates. Moved out of Cash Recon settings into its own menu entry. The
// staff rows are the same cash_staff records Cash Recon wages use.
//
// Pay model (see services/rotaCalc.js in the API):
//   Hourly  default hourly rate, optional different hourly rate per shift
//   Fixed   per week, per day, or per shift (optional amount per shift)

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersRound, Plus, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PAY_TYPES, staffRateLabel } from '@/pages/CashRecon'
import {
  useVenues, useVenueChoice, useRotaSetup, PageHeader, VenuePicker, Segmented,
  SortableRows, Modal, Field, inputCls, ConfirmDelete, ErrorNote, PAY_BASES, hhmm,
} from '@/components/staff/shared'

const EMPTY = { name: '', role_id: null, pay_type: 'fixed', pay_basis: 'week', default_rate: '', is_active: true, shift_rates: {} }

function rateLabel(payType, basis) {
  if (payType === 'hourly') return 'Hourly rate (£ per hour)'
  if (basis === 'day') return 'Amount per day worked (£)'
  if (basis === 'shift') return 'Default amount per shift (£)'
  return 'Amount per week worked (£)'
}

function StaffEditor({ venueId, initial, roles, shifts, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState(() => ({ ...EMPTY, ...initial, default_rate: initial?.default_rate ?? '' }))
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
      <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
        <input type="checkbox" className="w-5 h-5" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} />
        <span className="text-sm">Active (shown on the rota and new wage weeks)</span>
      </label>
      <ErrorNote error={save.error || remove.error} />
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

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['rota-staff', venueId],
    queryFn:  () => api.get(`/rota/venues/${venueId}/staff`),
    enabled:  !!venueId,
  })
  const roles = setup?.roles ?? []
  const shifts = setup?.shifts ?? []
  const roleById = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r])), [roles])

  const reorder = useMutation({
    mutationFn: ids => api.put(`/rota/venues/${venueId}/staff/reorder`, { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rota-staff', venueId] }),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={UsersRound} title="Staff">
        <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
        <button type="button" onClick={() => setEditing('new')} disabled={!venueId}
          className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add staff
        </button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Drag to change the order used on the rota and wages. Tap a person to edit their role and pay.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : staff.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No staff for this venue yet.</p>
          ) : (
            <SortableRows items={staff} onReorder={ids => reorder.mutate(ids)} renderItem={s => {
              const role = s.role_id ? roleById[s.role_id] : null
              const rate = staffRateLabel(s)
              const shiftRateCount = Object.keys(s.shift_rates ?? {}).length
              return (
                <button type="button" onClick={() => setEditing(s)}
                  className={cn('w-full min-h-[48px] flex flex-wrap items-center gap-x-3 gap-y-1 text-left rounded-lg px-2 py-1.5 hover:bg-muted touch-manipulation', !s.is_active && 'opacity-60')}>
                  <span className="flex-1 basis-32 min-w-0 truncate text-sm font-medium">{s.name}</span>
                  {role && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{role.name}</span>}
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {s.pay_type === 'hourly' ? 'Hourly' : `Fixed ${PAY_BASES.find(b => b.value === s.pay_basis)?.label.toLowerCase() ?? ''}`}
                    {rate ? ` · ${rate}` : ''}
                    {shiftRateCount > 0 ? ` · ${shiftRateCount} shift rate${shiftRateCount > 1 ? 's' : ''}` : ''}
                  </span>
                  {!s.is_active && <span className="text-[11px] text-muted-foreground">Inactive</span>}
                </button>
              )
            }} />
          )}
          {staff.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {staff.filter(s => s.is_active).length} active. Rates shown are each person's default; per-shift rates are set inside the person.
            </p>
          )}
        </div>
      </div>

      {editing && (
        <StaffEditor venueId={venueId} initial={editing === 'new' ? null : editing}
          roles={roles} shifts={shifts} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
