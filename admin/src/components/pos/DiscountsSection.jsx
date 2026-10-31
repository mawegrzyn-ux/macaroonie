// src/components/pos/DiscountsSection.jsx
//
// Store tech > Discounts (company-wide, migration 225, shared/pos/discounts.js):
// the discounts the till offers by name (Staff meal 50%, NHS 10%, £5 off),
// in the order set here. Each is a percent or an amount, on the whole check,
// on items or either, and says whether it needs a manager every time. One
// without that flag can be used by anyone signed in on a till; discounts
// typed in on the till follow the till role's limit and the venue's
// "Discounts typed in" switch (Receipts and payments).

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Loader2, Pencil, ShieldCheck } from 'lucide-react'
import { useApi } from '@/lib/api'
import { DISCOUNTS_MAX, DISCOUNT_AMOUNT_MAX, discountValueText } from '@shared/pos/discounts.js'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Btn, Segmented, NumberBox, Toggle } from './shared'

const KINDS = [{ value: 'percent', label: 'Percent' }, { value: 'amount', label: 'Amount' }]
const SCOPES = [
  { value: 'any', label: 'Check or items' },
  { value: 'check', label: 'Whole check' },
  { value: 'line', label: 'Items only' },
]
const SCOPE_TEXT = { any: 'on the check or on items', check: 'on the whole check', line: 'on items' }

function DiscountModal({ discount, onClose, onSaved }) {
  const api = useApi()
  const [form, setForm] = useState({
    name: discount?.name || '',
    kind: discount?.kind || 'percent',
    value: discount ? Number(discount.value) : null,
    scope: discount?.scope || 'any',
    needs_manager: !!discount?.needs_manager,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const issue = !form.name.trim() ? 'Give it a name'
    : form.value == null || !(form.value > 0) ? (form.kind === 'percent' ? 'Type the percent' : 'Type the amount')
      : form.kind === 'percent' && form.value > 100 ? 'At most 100%'
        : form.kind === 'amount' && form.value > DISCOUNT_AMOUNT_MAX ? 'At most £' + (DISCOUNT_AMOUNT_MAX / 100).toLocaleString('en-GB')
          : null
  const body = () => ({
    name: form.name.trim(), kind: form.kind, value: form.kind === 'amount' ? Math.round(form.value) : form.value,
    scope: form.scope, needs_manager: form.needs_manager,
  })
  const save = useMutation({
    mutationFn: () => discount ? api.patch(`/pos/discounts/${discount.id}`, body()) : api.post('/pos/discounts', body()),
    onSuccess: () => { onSaved(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/discounts/${discount.id}`), onSuccess: () => { onSaved(); onClose() } })
  return (
    <Modal title={discount ? 'Edit ' + discount.name : 'Add a discount'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!!issue || save.isPending} onClick={() => save.mutate()} data-testid="discount-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {discount && <ConfirmDelete label="Delete discount" confirmLabel="Yes, delete" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint="As the till shows it and the bill prints it.">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Staff meal, NHS" data-testid="discount-name" />
      </Field>
      <Field group label="How much">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={form.kind} options={KINDS} onChange={v => v !== form.kind && set({ kind: v, value: null })} />
          {form.kind === 'percent'
            ? <span className="inline-flex items-center gap-1">
                <NumberBox value={form.value} decimals={2} max={999} onChange={v => set({ value: v })} ariaLabel="Percent off" placeholder="10" />
                <span className="text-sm text-muted-foreground">% off</span>
              </span>
            : <span className="inline-flex items-center gap-1">
                <span className="text-sm text-muted-foreground">£</span>
                <NumberBox value={form.value == null ? null : (form.value / 100).toFixed(2)} decimals={2} max={99999}
                  onChange={v => set({ value: v == null ? null : Math.round(v * 100) })} ariaLabel="Amount off in pounds" placeholder="5.00" />
                <span className="text-sm text-muted-foreground">off</span>
              </span>}
        </div>
      </Field>
      <Field group label="On" hint="Items only: staff pick the items on the till. An amount off items never takes more than they come to.">
        <Segmented value={form.scope} options={SCOPES} onChange={v => set({ scope: v })} className="flex-wrap" />
      </Field>
      <Toggle label="Needs a manager every time" checked={form.needs_manager} onChange={v => set({ needs_manager: v })}
        hint="Someone whose till role has Approve for others types their PIN. Off: anyone signed in on a till can use it." />
      {issue && <p className="text-xs text-destructive" data-testid="discount-issue">{issue}</p>}
      <p className="text-xs text-muted-foreground">Checks that already have it keep it as it was. Changes reach the tills straight away.</p>
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function DiscountsSection({ canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: list = [], isLoading } = useQuery({ queryKey: ['pos-discounts'], queryFn: () => api.get('/pos/discounts') })
  const [editing, setEditing] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-discounts'] })
  const reorder = useMutation({ mutationFn: ids => api.put('/pos/discounts/order', { ids }), onSettled: refresh })
  return (
    <Section title="Discounts" hint="Shared by every location: the discounts the till offers by name, in this order. Staff can still type in a discount of their own when their till role allows it."
      actions={canManage && list.length < DISCOUNTS_MAX && <Btn variant="primary" onClick={() => setEditing('new')} data-testid="discount-add"><Plus className="w-4 h-4" /> Add</Btn>}>
      {isLoading && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {!isLoading && !list.length && <p className="text-sm text-muted-foreground">No discounts yet. Add the ones staff give often, e.g. Staff meal 50% or NHS 10%.</p>}
      {list.length > 0 && (
        <SortableRows items={list} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
          renderItem={d => (
            <div className="flex items-center gap-3 min-h-[44px]" data-testid="discount-row" data-name={d.name}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{d.name} <span className="font-normal text-muted-foreground">{discountValueText(d)}</span></p>
                <p className="text-xs text-muted-foreground">{SCOPE_TEXT[d.scope] || SCOPE_TEXT.any}</p>
              </div>
              {d.needs_manager && (
                <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-2 py-1 shrink-0" data-testid="discount-manager">
                  <ShieldCheck className="w-3.5 h-3.5" /> Manager
                </span>
              )}
              {canManage && <Btn onClick={() => setEditing(d)} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /></Btn>}
            </div>
          )} />
      )}
      {list.length >= DISCOUNTS_MAX && <p className="text-xs text-muted-foreground">The list has as many discounts as it can take ({DISCOUNTS_MAX}).</p>}
      <p className="text-xs text-muted-foreground">
        Discounts typed in on the till follow each till role's discount limit (
        <Link to="/pos/roles" className="font-medium text-foreground underline">Till roles</Link>), and can be made to need a manager
        every time under <Link to="/pos/receipts" className="font-medium text-foreground underline">Receipts and payments</Link>.
      </p>
      <ErrorNote error={reorder.error} />
      {editing && <DiscountModal discount={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Section>
  )
}
