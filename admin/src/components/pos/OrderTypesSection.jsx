// src/components/pos/OrderTypesSection.jsx
//
// Store tech > Order types (company-wide, migration 170): Eat in, Take out,
// Delivery, Collection and any you add (Drive thru, Staff meal...). A
// revenue stream offers some of them and says what each asks for (customer
// name, tent number); a tax setting can charge another rate for some of them
// (Menus, Tax rates); the kitchen flow can send them different ways; tickets
// and receipts print the type. Removing one takes it off every list but keeps
// it on old checks and orders.
//
// Charges aren't set here any more (migration 231): the company's list and
// each location's matrix of revenue streams by order types are on Store tech
// > Charges (ChargesSection.jsx).

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Btn, ColourPick } from './shared'

function TypeModal({ type, onClose, onSaved }) {
  const api = useApi()
  const [form, setForm] = useState({ name: type?.name || '', colour: type?.colour || null })
  const body = () => ({ name: form.name.trim(), colour: form.colour })
  const save = useMutation({
    mutationFn: () => type ? api.patch(`/order-types/${type.id}`, body()) : api.post('/order-types', body()),
    onSuccess: () => { onSaved(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/order-types/${type.id}`), onSuccess: () => { onSaved(); onClose() } })
  return (
    <Modal title={type ? 'Edit ' + type.name : 'Add an order type'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {type && <ConfirmDelete label="Remove order type" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={40} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Drive thru" /></Field>
      <Field group label="Colour" hint="On the till's buttons and the kitchen screens' tickets."><ColourPick value={form.colour} onChange={v => setForm(f => ({ ...f, colour: v }))} /></Field>
      <p className="text-xs text-muted-foreground">Charges for this order type (a service charge, a packaging fee) are set per revenue stream on <Link to="/pos/charges" className="underline">Charges</Link>.</p>
      {type && <p className="text-xs text-muted-foreground">Removing it takes it off every till, stream and filter; checks and orders already taken keep it.</p>}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function OrderTypesSection({ canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: types = [] } = useQuery({ queryKey: ['order-types'], queryFn: () => api.get('/order-types') })
  const [editing, setEditing] = useState(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order-types'] })
    qc.invalidateQueries({ queryKey: ['pos-setup'] })
    qc.invalidateQueries({ queryKey: ['tax-rates'] })
  }
  const reorder = useMutation({ mutationFn: ids => api.put('/order-types/order', { ids }), onSettled: refresh })
  const restore = useMutation({ mutationFn: id => api.patch(`/order-types/${id}`, { is_active: true }), onSettled: refresh })
  const active = types.filter(t => t.is_active)
  const removed = types.filter(t => !t.is_active)
  return (
    <Section title="Order types" hint="Shared by every location: how an order is served. Each revenue stream picks the ones it offers and what each asks for (Revenue streams). The charges a check gets come from each location's revenue streams and order types (Charges). Tax can differ by order type (Menus, Tax rates)."
      actions={canManage && <Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      <SortableRows items={active} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
        renderItem={t => (
          <div className="flex items-center gap-3 min-h-[44px]" data-testid="order-type-row" data-name={t.name}>
            <span className="w-3 h-8 rounded-full shrink-0 border" style={{ background: t.colour || 'transparent' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t.name}</p>
            </div>
            {canManage && <Btn onClick={() => setEditing(t)} title={'Edit ' + t.name}><Pencil className="w-4 h-4" /></Btn>}
          </div>
        )} />
      {removed.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-1">Removed</p>
          <div className="flex flex-wrap gap-2">
            {removed.map(t => (
              <span key={t.id} className="inline-flex items-center gap-2 text-sm border rounded-lg pl-3">
                <span className="line-through text-muted-foreground">{t.name}</span>
                {canManage && <Btn onClick={() => restore.mutate(t.id)}>Put back</Btn>}
              </span>
            ))}
          </div>
        </div>
      )}
      <ErrorNote error={reorder.error || restore.error} />
      {editing && <TypeModal type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Section>
  )
}
