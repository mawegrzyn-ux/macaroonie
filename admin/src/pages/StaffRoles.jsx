// src/pages/StaffRoles.jsx
//
// Job titles / roles (/staff/roles, `staff` module). Tenant-wide: every
// venue of the company shares one list. Each role has a tip points
// multiplier (e.g. Manager x1.1, Pot wash x1.0) used by the rota's tip
// share calculation (services/rotaCalc.js in the API).

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Plus, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import {
  useRotaSetup, PageHeader, SortableRows, Modal, Field, inputCls, ConfirmDelete, ErrorNote,
} from '@/components/staff/shared'

function RoleEditor({ initial, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(initial?.name ?? '')
  const [multiplier, setMultiplier] = useState(String(initial?.points_multiplier ?? '1'))
  const [active, setActive] = useState(initial?.is_active ?? true)
  const done = () => { qc.invalidateQueries({ queryKey: ['rota-setup'] }); qc.invalidateQueries({ queryKey: ['rota-pay'] }); onClose() }

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), points_multiplier: Number(multiplier) || 0, is_active: active }
      return initial?.id ? api.patch(`/rota/roles/${initial.id}`, body) : api.post('/rota/roles', body)
    },
    onSuccess: done,
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/rota/roles/${initial.id}`), onSuccess: done })

  return (
    <Modal title={initial?.id ? `Edit ${initial.name}` : 'Add role'} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        {initial?.id && <ConfirmDelete onConfirm={() => remove.mutate()} disabled={remove.isPending} label="Delete role" />}
      </>}>
      <Field label="Job title / role">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="e.g. Manager" />
      </Field>
      <Field label="Tip points multiplier" hint="Shift points are multiplied by this. 1.0 = standard share, 1.1 = 10% more.">
        <input className={inputCls} inputMode="decimal" value={multiplier}
          onChange={e => setMultiplier(e.target.value.replace(/[^0-9.]/g, ''))} />
      </Field>
      {initial?.id && (
        <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
          <input type="checkbox" className="w-5 h-5" checked={active} onChange={e => setActive(e.target.checked)} />
          <span className="text-sm">Active (offered when editing staff)</span>
        </label>
      )}
      {initial?.id && (
        <p className="text-[11px] text-muted-foreground">Deleting a role removes it from anyone who has it.</p>
      )}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function StaffRoles() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: setup, isLoading } = useRotaSetup()
  const roles = setup?.roles ?? []
  const [editing, setEditing] = useState(null)

  const reorder = useMutation({
    mutationFn: ids => api.put('/rota/roles/reorder', { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rota-setup'] }),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={BadgeCheck} title="Roles">
        <button type="button" onClick={() => setEditing('new')}
          className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add role
        </button>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Roles are shared by every venue. The multiplier scales the tip points a person earns per shift.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No roles yet. Add one, e.g. Manager, Chef, Waiter, Pot wash.</p>
          ) : (
            <SortableRows items={roles} onReorder={ids => reorder.mutate(ids)} renderItem={r => (
              <button type="button" onClick={() => setEditing(r)}
                className={`w-full min-h-[48px] flex items-center gap-3 text-left rounded-lg px-2 hover:bg-muted touch-manipulation ${r.is_active ? '' : 'opacity-60'}`}>
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{r.name}</span>
                {!r.is_active && <span className="text-[11px] text-muted-foreground">Inactive</span>}
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted tabular-nums">×{Number(r.points_multiplier).toFixed(2)}</span>
              </button>
            )} />
          )}
        </div>
      </div>
      {editing && <RoleEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
