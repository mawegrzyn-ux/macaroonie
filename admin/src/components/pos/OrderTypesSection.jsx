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
// Charges (migration 225, shared/pos/charges.js): each type has its own list
// (a service charge, a packaging fee...), a percent of the check after
// discounts or an amount, optional or not, from a number of guests, with or
// without VAT. A till check gets its type's charges when it opens and when
// its type changes; checks already open keep theirs.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useTaxLookups, rateLabel } from '@/components/menus/TaxBox'
import {
  CHARGE_PERCENT_MAX, CHARGE_AMOUNT_MAX, TYPE_CHARGES_MAX, MIN_COVERS_MAX, typeCharges, chargeSummary,
} from '@shared/pos/charges.js'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Btn, ColourPick, Segmented, NumberBox, Toggle } from './shared'

const KINDS = [{ value: 'percent', label: 'Percent' }, { value: 'amount', label: 'Amount' }]

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
}))

/** What is wrong with a charge in the form, in words, or null. */
function chargeIssue(x, all) {
  if (!x.name.trim()) return 'Give it a name'
  if (all.some(y => y !== x && y.name.trim().toLowerCase() === x.name.trim().toLowerCase())) return 'Two charges have this name'
  if (x.value == null || !(x.value > 0)) return x.kind === 'percent' ? 'Type the percent' : 'Type the amount'
  if (x.kind === 'percent' && x.value > CHARGE_PERCENT_MAX) return 'At most ' + CHARGE_PERCENT_MAX + '%'
  if (x.kind === 'amount' && x.value > CHARGE_AMOUNT_MAX) return 'At most £' + (CHARGE_AMOUNT_MAX / 100).toLocaleString('en-GB')
  return null
}

function ChargeRow({ x, all, rates, onChange, onRemove }) {
  const issue = chargeIssue(x, all)
  const known = rates.find(r => r.id === x.tax_rate_id)
  return (
    <div className="space-y-2 py-1.5" data-testid="charge-editor" data-name={x.name}>
      <div className="flex items-center gap-2">
        <input className={cn(inputCls, 'flex-1 min-w-0')} value={x.name} maxLength={60} aria-label="Charge name"
          placeholder="e.g. Service charge, Packaging" onChange={e => onChange({ name: e.target.value })} />
        <button type="button" onClick={onRemove} title={'Take ' + (x.name || 'this charge') + ' off the list'} aria-label={'Take ' + (x.name || 'this charge') + ' off the list'}
          data-testid="charge-remove"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={x.kind} options={KINDS} onChange={v => v !== x.kind && onChange({ kind: v, value: null })} />
        {x.kind === 'percent'
          ? <span className="inline-flex items-center gap-1">
              <NumberBox value={x.value} decimals={2} max={999} onChange={v => onChange({ value: v })} ariaLabel="Percent" placeholder="12.5" />
              <span className="text-sm text-muted-foreground">% of the check after discounts</span>
            </span>
          : <span className="inline-flex items-center gap-1">
              <span className="text-sm text-muted-foreground">£</span>
              <NumberBox value={x.value == null ? null : (x.value / 100).toFixed(2)} decimals={2} max={99999}
                onChange={v => onChange({ value: v == null ? null : Math.round(v * 100) })} ariaLabel="Amount in pounds" placeholder="0.50" />
              <span className="text-sm text-muted-foreground">per check</span>
            </span>}
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex-1 min-w-[12rem]">
          <Toggle label="Optional" checked={x.optional} onChange={v => onChange({ optional: v })}
            hint="Staff can take it off the bill. Not optional: taking it off needs a manager every time." />
        </div>
        <Field label="From guests" hint="0 = every check">
          <NumberBox value={x.min_covers} max={MIN_COVERS_MAX} onChange={v => onChange({ min_covers: v ?? 0 })} ariaLabel="From this many guests" className="w-20" />
        </Field>
        <Field label="VAT on it">
          <select className={cn(inputCls, 'w-48')} value={x.tax_rate_id || ''} aria-label="VAT on the charge"
            onChange={e => onChange({ tax_rate_id: e.target.value || null })}>
            <option value="">No VAT</option>
            {rates.filter(r => r.is_active || r.id === x.tax_rate_id).map(r => <option key={r.id} value={r.id}>{rateLabel(r)}</option>)}
            {x.tax_rate_id && !known && <option value={x.tax_rate_id}>A rate that was removed</option>}
          </select>
        </Field>
      </div>
      {issue && <p className="text-xs text-destructive" data-testid="charge-issue">{issue}</p>}
    </div>
  )
}

function ChargesEditor({ charges, onChange }) {
  const { rates } = useTaxLookups()
  const update = (id, patch) => onChange(charges.map(x => (x.id === id ? { ...x, ...patch } : x)))
  return (
    <div data-testid="type-charges">
      <p className="text-sm font-medium">Charges</p>
      <p className="text-xs text-muted-foreground mb-2">
        Added to every till check of this type, in this order: a service charge, a packaging or delivery fee.
        A percent is of the check after its discounts. Optional service charges usually carry no VAT in the UK; one
        guests must pay usually does: check with your accountant.
      </p>
      {charges.length > 0 && (
        <SortableRows items={charges} onReorder={ids => onChange(ids.map(id => charges.find(x => x.id === id)))}
          renderItem={x => <ChargeRow x={x} all={charges} rates={rates} onChange={patch => update(x.id, patch)}
            onRemove={() => onChange(charges.filter(y => y.id !== x.id))} />} />
      )}
      {charges.length < TYPE_CHARGES_MAX
        ? <Btn className="mt-2" data-testid="charge-add" onClick={() => onChange([...charges, { id: newId(), name: '', kind: 'percent', value: null, optional: true, min_covers: 0, tax_rate_id: null }])}>
            <Plus className="w-4 h-4" /> Add a charge
          </Btn>
        : <p className="text-xs text-muted-foreground mt-2">An order type can have up to {TYPE_CHARGES_MAX} charges.</p>}
    </div>
  )
}

function TypeModal({ type, onClose, onSaved }) {
  const api = useApi()
  const [form, setForm] = useState({ name: type?.name || '', colour: type?.colour || null, charges: typeCharges(type) })
  const problems = form.charges.some(x => chargeIssue(x, form.charges))
  const body = () => ({
    name: form.name.trim(), colour: form.colour,
    charges: form.charges.map(x => ({
      id: x.id, name: x.name.trim(), kind: x.kind, value: x.kind === 'amount' ? Math.round(x.value) : x.value,
      optional: x.optional, min_covers: x.min_covers || 0, tax_rate_id: x.tax_rate_id || null,
    })),
  })
  const save = useMutation({
    mutationFn: () => type ? api.patch(`/order-types/${type.id}`, body()) : api.post('/order-types', body()),
    onSuccess: () => { onSaved(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/order-types/${type.id}`), onSuccess: () => { onSaved(); onClose() } })
  return (
    <Modal title={type ? 'Edit ' + type.name : 'Add an order type'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || problems || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {type && <ConfirmDelete label="Remove order type" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={40} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Drive thru" /></Field>
      <Field group label="Colour" hint="On the till's buttons and the kitchen screens' tickets."><ColourPick value={form.colour} onChange={v => setForm(f => ({ ...f, colour: v }))} /></Field>
      <ChargesEditor charges={form.charges} onChange={charges => setForm(f => ({ ...f, charges }))} />
      <p className="text-xs text-muted-foreground">Checks already open keep the charges they have. New checks, and checks whose type is changed, get these.</p>
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
    <Section title="Order types" hint="Shared by every location: how an order is served, and the charges a till check of each type gets. Each revenue stream picks the ones it offers and what each asks for (Revenue streams tab). Tax can differ by order type (Menus, Tax rates)."
      actions={canManage && <Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      <SortableRows items={active} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
        renderItem={t => {
          const charges = typeCharges(t)
          return (
            <div className="flex items-center gap-3 min-h-[44px]" data-testid="order-type-row" data-name={t.name}>
              <span className="w-3 h-8 rounded-full shrink-0 border" style={{ background: t.colour || 'transparent' }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                {charges.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="order-type-charges">{charges.map(chargeSummary).join(' · ')}</p>
                )}
              </div>
              {canManage && <Btn onClick={() => setEditing(t)} title={'Edit ' + t.name}><Pencil className="w-4 h-4" /></Btn>}
            </div>
          )
        }} />
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
