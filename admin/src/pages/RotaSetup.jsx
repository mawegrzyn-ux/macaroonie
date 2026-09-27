// src/pages/RotaSetup.jsx
//
// Rota setup (/rota/setup, `staff` module). Tenant-wide:
//   - How the rota is entered: by day parts (tick ON/OFF per shift) or by
//     hours (start and end times at 15 / 30 / 60 minute precision).
//   - Day parts / shifts: name, start, end, tip points. A shift whose end is
//     at or before its start runs past midnight. Shifts are used in both
//     modes: in hourly mode they decide per-shift rates and tip points.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, Plus, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import {
  useRotaSetup, PageHeader, SortableRows, Modal, Field, inputCls, ConfirmDelete, ErrorNote,
  Segmented, TimeSelect, hhmm, rangeMinutes, fmtHours,
} from '@/components/staff/shared'

const MODES = [
  { value: 'day_parts', label: 'Day parts' },
  { value: 'hourly',    label: 'Hours' },
]
const SLOTS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
]

function SettingsCard({ settings }) {
  const api = useApi()
  const qc = useQueryClient()
  const [mode, setMode] = useState(settings.mode)
  const [slot, setSlot] = useState(settings.slot_minutes)
  useEffect(() => { setMode(settings.mode); setSlot(settings.slot_minutes) }, [settings.mode, settings.slot_minutes])
  const dirty = mode !== settings.mode || slot !== settings.slot_minutes

  const save = useMutation({
    mutationFn: () => api.patch('/rota/settings', { mode, slot_minutes: slot }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rota-setup'] })
      qc.invalidateQueries({ queryKey: ['rota-week'] })
    },
  })

  return (
    <section className="rounded-xl border overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">How the rota is entered</h2>
      </div>
      <div className="p-4 space-y-4">
        <Field label="Schedule by"
          hint={mode === 'day_parts'
            ? 'Each day is split into your shifts; each person is simply ON or OFF for a shift.'
            : 'Each person gets start and end times per day, as many periods as fit without overlapping.'}>
          <Segmented value={mode} options={MODES} onChange={setMode} />
        </Field>
        {mode === 'hourly' && (
          <Field label="Time precision" hint="The smallest step start and end times can be set in.">
            <Segmented value={slot} options={SLOTS} onChange={setSlot} />
          </Field>
        )}
        <p className="text-[11px] text-muted-foreground">
          Switching mode does not delete anything, but saving a week in the new mode replaces that week's entries from the other mode.
        </p>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
          {save.isSuccess && !dirty && <span className="text-xs text-green-700">Saved</span>}
        </div>
        <ErrorNote error={save.error} />
      </div>
    </section>
  )
}

function ShiftEditor({ initial, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:       initial?.name ?? '',
    start_time: hhmm(initial?.start_time) || '11:30',
    end_time:   hhmm(initial?.end_time) || '15:00',
    points:     String(initial?.points ?? '1'),
    is_active:  initial?.is_active ?? true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const zeroLength = form.start_time === form.end_time
  const overnight = !zeroLength && form.end_time < form.start_time
  const done = () => {
    qc.invalidateQueries({ queryKey: ['rota-setup'] })
    qc.invalidateQueries({ queryKey: ['rota-week'] })
    qc.invalidateQueries({ queryKey: ['rota-pay'] })
    onClose()
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: form.name.trim(), points: Number(form.points) || 0 }
      if (!initial?.id) delete body.is_active
      return initial?.id ? api.patch(`/rota/shifts/${initial.id}`, body) : api.post('/rota/shifts', body)
    },
    onSuccess: done,
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/rota/shifts/${initial.id}`), onSuccess: done })

  return (
    <Modal title={initial?.id ? `Edit ${initial.name}` : 'Add shift'} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={!form.name.trim() || zeroLength || save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        {initial?.id && <ConfirmDelete onConfirm={() => remove.mutate()} disabled={remove.isPending} label="Delete shift" />}
      </>}>
      <Field label="Name">
        <input className={inputCls} value={form.name} onChange={e => set({ name: e.target.value })} maxLength={100} placeholder="e.g. Lunch" />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Starts"><TimeSelect value={form.start_time} step={15} onChange={v => set({ start_time: v })} label="Starts" /></Field>
        <Field label="Ends"><TimeSelect value={form.end_time} step={15} onChange={v => set({ end_time: v })} label="Ends" /></Field>
        <span className="text-xs text-muted-foreground pb-3">
          {zeroLength ? 'Start and end must differ' : `${fmtHours(rangeMinutes(form.start_time, form.end_time) / 60)}${overnight ? ', ends next day' : ''}`}
        </span>
      </div>
      <Field label="Tip points" hint="Points a person earns for working the whole shift, before their role multiplier. e.g. Lunch 0.5, Dinner 1.">
        <input className={inputCls} inputMode="decimal" value={form.points}
          onChange={e => set({ points: e.target.value.replace(/[^0-9.]/g, '') })} />
      </Field>
      {initial?.id && (
        <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
          <input type="checkbox" className="w-5 h-5" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} />
          <span className="text-sm">Active (shown on the rota)</span>
        </label>
      )}
      {initial?.id && (
        <p className="text-[11px] text-muted-foreground">A shift already used on a rota is hidden rather than deleted, so past weeks keep their pay.</p>
      )}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function RotaSetup() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: setup, isLoading } = useRotaSetup()
  const shifts = setup?.shifts ?? []
  const [editing, setEditing] = useState(null)

  const reorder = useMutation({
    mutationFn: ids => api.put('/rota/shifts/reorder', { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rota-setup'] }),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Settings2} title="Rota setup" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-5">
          {isLoading || !setup ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <SettingsCard settings={setup.settings} />
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold flex-1">Day parts / shifts</h2>
                  <button type="button" onClick={() => setEditing('new')}
                    className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Add shift
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Shared by every venue. Drag to set the order the shifts appear on the rota.
                </p>
                {shifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No shifts yet. Add e.g. Lunch 11:30–15:00 and Dinner 18:00–23:00.</p>
                ) : (
                  <SortableRows items={shifts} onReorder={ids => reorder.mutate(ids)} renderItem={s => (
                    <button type="button" onClick={() => setEditing(s)}
                      className={`w-full min-h-[48px] flex flex-wrap items-center gap-x-3 gap-y-1 text-left rounded-lg px-2 py-1 hover:bg-muted touch-manipulation ${s.is_active ? '' : 'opacity-60'}`}>
                      <span className="flex-1 basis-24 min-w-0 truncate text-sm font-medium">{s.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted tabular-nums">{Number(s.points)} pt{Number(s.points) === 1 ? '' : 's'}</span>
                      {!s.is_active && <span className="text-[11px] text-muted-foreground">Hidden</span>}
                    </button>
                  )} />
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {editing && <ShiftEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
