// src/components/pos/RolesSection.jsx
//
// Till setup > Till roles (company-wide): what each role may do on the
// till. Anything a role doesn't allow can still be done when someone whose
// role has "Approve for others" types their PIN. The permission list is
// shared/pos/permissions.js, the same one the till and the server check.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { POS_PERMISSIONS } from '@shared/pos/permissions.js'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Btn, NumberBox, Toggle } from './shared'

function RoleModal({ venueId, role, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(role?.name || '')
  const [perms, setPerms] = useState(role?.permissions || { discount_max_pct: 0 })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup'] })
  const save = useMutation({
    mutationFn: () => role
      ? api.patch(`/pos/roles/${role.id}`, { name: name.trim(), permissions: perms })
      : api.post('/pos/roles', { name: name.trim(), permissions: perms }),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/roles/${role.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={role ? 'Edit ' + role.name : 'Add a till role'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {role && <ConfirmDelete label="Delete role" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="e.g. Supervisor" /></Field>
      <Field label="Discounts up to (%)" hint="The biggest discount they can give without a manager. 0: none; 100: any.">
        <NumberBox value={perms.discount_max_pct ?? 0} max={100} onChange={v => setPerms(p => ({ ...p, discount_max_pct: v ?? 0 }))} ariaLabel="Discounts up to percent" />
      </Field>
      <div className="divide-y rounded-xl border px-3">
        {POS_PERMISSIONS.map(p => (
          <Toggle key={p.key} label={p.label} hint={p.hint} checked={!!perms[p.key]} onChange={v => setPerms(x => ({ ...x, [p.key]: v }))} />
        ))}
      </div>
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function RolesSection({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const defaults = useMutation({ mutationFn: () => api.post('/pos/roles/defaults', {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup'] }) })
  const summary = r => {
    const on = POS_PERMISSIONS.filter(p => r.permissions[p.key]).map(p => p.label.toLowerCase())
    const disc = r.permissions.discount_max_pct ? 'discounts up to ' + r.permissions.discount_max_pct + '%' : null
    return [disc, ...on].filter(Boolean).join(', ') || 'Orders and payments only'
  }
  return (
    <Section title="Till roles" hint="Shared by every venue. Something a role doesn't allow can still be done when a person allowed to approve types their PIN."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      {!setup.roles.length && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1">No till roles yet.</p>
          <Btn onClick={() => defaults.mutate()} disabled={defaults.isPending}>Add Server, Supervisor and Manager</Btn>
        </div>
      )}
      {!!setup.roles.length && (
        <div className="rounded-xl border divide-y">
          {setup.roles.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{summary(r)}</p>
              </div>
              <Btn onClick={() => setEditing(r)} title={'Edit ' + r.name}><Pencil className="w-4 h-4" /></Btn>
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={defaults.error} />
      {editing && <RoleModal venueId={venueId} role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}
