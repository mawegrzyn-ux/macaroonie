// src/pages/Suppliers.jsx
//
// Suppliers for purchasing (/suppliers, purchasing_setup): contact details,
// how purchase orders reach them (email with a PDF or Excel copy, or print /
// Excel / PDF for staff to send), order cutoff, days from order to delivery,
// delivery days, minimum order and delivery charge, with per-venue account
// numbers, delivery days and cutoffs. API: routes/suppliers.js.

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Plus, Search, Loader2, Mail, Printer, FileSpreadsheet, FileText } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useVenues, Field, inputCls, ErrorNote, Segmented, ConfirmDelete, PageHeader, TimeSelect, hhmm } from '@/components/staff/shared'
import {
  useSuppliers, usePurchasingMeta, NumInput, Drawer, Card, Toggle, DayPicker, daysLabel, btn, money, perUnit,
} from '@/components/purchasing/shared'
import { SEND_METHODS, packLabel } from '@shared/procurement.js'

const METHOD_ICON = { email: Mail, print: Printer, excel: FileSpreadsheet, pdf: FileText }
const METHOD_TEXT = {
  email: 'Emailed straight to the supplier when the order is placed',
  print: 'Staff print the order and hand or fax it over',
  excel: 'Staff download an Excel file to upload to the supplier\'s site',
  pdf: 'Staff download a PDF to send themselves',
}

export default function Suppliers() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [showOff, setShowOff] = useState(false)
  const openId = params.get('supplier')
  const setOpenId = id => setParams(id ? { supplier: id } : {}, { replace: true })
  const { data: meta } = usePurchasingMeta()
  const { data: suppliers = [], isLoading, error } = useSuppliers()
  const canEdit = !!meta?.can_setup

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter(s => (showOff || s.is_active) && (!q || s.name.toLowerCase().includes(q)
      || (s.email || '').toLowerCase().includes(q) || (s.contact_name || '').toLowerCase().includes(q)))
  }, [suppliers, search, showOff])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Truck} title="Suppliers">
        {canEdit && <button type="button" className={btn.primary} onClick={() => setOpenId('new')}><Plus className="w-4 h-4" />New supplier</button>}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3 max-w-6xl mx-auto">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers" className={cn(inputCls, 'pl-9')} />
            </div>
            <Toggle checked={showOff} onChange={setShowOff} label="Show switched off" />
          </div>
          <ErrorNote error={error} />
          {isLoading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !suppliers.length ? (
            <div className="rounded-xl border bg-background p-8 text-center space-y-3">
              <Truck className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="font-medium">No suppliers yet</p>
              <p className="text-sm text-muted-foreground">Add the companies you buy from, then their products and prices on the Inventory page.</p>
              {canEdit && <button type="button" className={btn.primary} onClick={() => setOpenId('new')}><Plus className="w-4 h-4" />New supplier</button>}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
              {rows.map(s => <SupplierCard key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}
            </div>
          )}
        </div>
      </div>
      {openId && <SupplierDrawer key={openId} id={openId === 'new' ? null : openId} canEdit={canEdit}
        onCreated={id => setOpenId(id)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function SupplierCard({ s, onOpen }) {
  const Icon = METHOD_ICON[s.send_method] || Mail
  return (
    <button type="button" onClick={onOpen}
      className={cn('text-left rounded-xl border bg-background p-4 space-y-2 hover:shadow-sm touch-manipulation', !s.is_active && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <span className="font-semibold flex-1 min-w-0 truncate">{s.name}</span>
        {!s.is_active && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">Off</span>}
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted">
          <Icon className="w-3.5 h-3.5" />{SEND_METHODS.find(m => m.key === s.send_method)?.label}
        </span>
      </div>
      <p className="text-sm text-muted-foreground truncate">{[s.contact_name, s.email || s.phone].filter(Boolean).join(' · ') || 'No contact details'}</p>
      <p className="text-sm">
        Delivers {daysLabel(s.delivery_days)}
        {s.cutoff_time && <> · order by {hhmm(s.cutoff_time)}</>}
        {' · '}{s.lead_days === 0 ? 'same day' : `${s.lead_days} day${s.lead_days === 1 ? '' : 's'} notice`}
      </p>
      <p className="text-xs text-muted-foreground">
        {s.quote_count} product{s.quote_count === 1 ? '' : 's'}
        {s.min_order ? ` · min order ${money(s.min_order)}` : ''}
        {s.venues?.length ? ` · ${s.venues.length} venue setting${s.venues.length === 1 ? '' : 's'}` : ''}
      </p>
    </button>
  )
}

const EMPTY = {
  name: '', contact_name: '', phone: '', email: '', cc_emails: '', website: '', account_ref: '', notes: '', is_active: true,
  send_method: 'email', email_attachment: 'pdf', delivery_days: [], cutoff_time: null, lead_days: 1,
  min_order: null, delivery_charge: null,
}

function SupplierDrawer({ id, canEdit, onCreated, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: s, isLoading } = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get(`/suppliers/${id}`), enabled: !!id })
  const { data: venues = [] } = useVenues()
  const refresh = saved => {
    if (saved?.id) qc.setQueryData(['supplier', saved.id], saved)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }
  const del = useMutation({ mutationFn: () => api.delete(`/suppliers/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose() } })

  if (id && (isLoading || !s)) {
    return <Drawer title="Supplier" onClose={onClose}><div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div></Drawer>
  }
  return (
    <Drawer title={s?.name || 'New supplier'} onClose={onClose}>
      <DetailsCard s={s} canEdit={canEdit} onSaved={saved => { refresh(saved); if (!s) onCreated(saved.id) }} />
      {s && (
        <>
          <OrderingCard s={s} canEdit={canEdit} onSaved={refresh} />
          {venues.length > 0 && <VenuesCard s={s} venues={venues} canEdit={canEdit} onSaved={refresh} />}
          <Card title={`Products (${s.quotes.length})`} bodyClass="p-0"
            actions={<Link to="/inventory" className={btn.ghost}>Inventory</Link>}>
            {!s.quotes.length ? (
              <p className="p-4 text-sm text-muted-foreground">No products yet. Add prices from this supplier on the Inventory page, or import their price list there.</p>
            ) : (
              <div className="divide-y">
                {s.quotes.map(q => (
                  <Link key={q.id} to={`/inventory?item=${q.item_id}`} className={cn('flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40', (!q.is_active || !q.item_active) && 'opacity-60')}>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium block truncate">{q.item_name}{q.product_name && <span className="font-normal text-muted-foreground"> · {q.product_name}</span>}</span>
                      <span className="text-xs text-muted-foreground">{packLabel(q)}{q.supplier_code ? ` · ${q.supplier_code}` : ''}</span>
                    </span>
                    <span className="text-right">
                      <span className="text-sm font-medium tabular-nums block">{money(q.price)}</span>
                      <span className="text-xs text-muted-foreground">{perUnit(q.price, q.pack_base_qty, q.base_unit)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          {canEdit && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                {s.po_count ? `${s.po_count} purchase order${s.po_count === 1 ? '' : 's'}: switch it off instead of deleting.` : 'Deleting also removes its prices.'}
              </span>
              <ConfirmDelete label="Delete supplier" disabled={s.po_count > 0 || del.isPending} onConfirm={() => del.mutate()} />
            </div>
          )}
          <ErrorNote error={del.error} />
        </>
      )}
    </Drawer>
  )
}

function useForm(initial) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return [form, set, setForm]
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function DetailsCard({ s, canEdit, onSaved }) {
  const api = useApi()
  const keys = ['name', 'contact_name', 'phone', 'email', 'cc_emails', 'website', 'account_ref', 'notes', 'is_active']
  const initial = Object.fromEntries(keys.map(k => [k, s ? (s[k] ?? (k === 'is_active' ? true : '')) : EMPTY[k]]))
  const [f, set] = useForm(initial)
  const dirty = keys.some(k => !same(f[k], initial[k]))
  const save = useMutation({
    mutationFn: () => s ? api.patch(`/suppliers/${s.id}`, f) : api.post('/suppliers', { ...EMPTY, ...f, min_order: null, delivery_charge: null }),
    onSuccess: onSaved,
  })
  return (
    <Card title="Supplier"
      actions={canEdit && <button type="button" className={btn.primary} disabled={!f.name.trim() || (s && !dirty) || save.isPending} onClick={() => save.mutate()}>{s ? 'Save' : 'Create'}</button>}>
      <div className="space-y-3">
        <Field label="Name"><input className={inputCls} value={f.name} disabled={!canEdit} onChange={e => set('name', e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Contact name"><input className={inputCls} value={f.contact_name} disabled={!canEdit} onChange={e => set('contact_name', e.target.value)} /></Field>
          <Field label="Phone"><input type="tel" inputMode="tel" className={inputCls} value={f.phone} disabled={!canEdit} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="Order email" hint="Where emailed orders go"><input type="email" className={inputCls} value={f.email} disabled={!canEdit} onChange={e => set('email', e.target.value)} /></Field>
          <Field label="Copy to" hint="Other addresses, separated by commas"><input className={inputCls} value={f.cc_emails} disabled={!canEdit} onChange={e => set('cc_emails', e.target.value)} /></Field>
          <Field label="Website / ordering portal"><input className={inputCls} value={f.website} disabled={!canEdit} onChange={e => set('website', e.target.value)} /></Field>
          <Field label="Account number" hint="Venues can have their own below"><input className={inputCls} value={f.account_ref} disabled={!canEdit} onChange={e => set('account_ref', e.target.value)} /></Field>
        </div>
        <Field label="Notes"><textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={f.notes} disabled={!canEdit} onChange={e => set('notes', e.target.value)} /></Field>
        {s && <Toggle checked={f.is_active} disabled={!canEdit} onChange={v => set('is_active', v)} label="In use (off = never ordered from)" />}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

function OrderingCard({ s, canEdit, onSaved }) {
  const api = useApi()
  const keys = ['send_method', 'email_attachment', 'delivery_days', 'cutoff_time', 'lead_days', 'min_order', 'delivery_charge']
  const initial = Object.fromEntries(keys.map(k => [k, k === 'cutoff_time' ? (s.cutoff_time ? hhmm(s.cutoff_time) : null) : s[k]]))
  const [f, set] = useForm(initial)
  const dirty = keys.some(k => !same(f[k], initial[k]))
  const save = useMutation({ mutationFn: () => api.patch(`/suppliers/${s.id}`, f), onSuccess: onSaved })
  return (
    <Card title="Ordering"
      actions={canEdit && <button type="button" className={btn.primary} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</button>}>
      <div className="space-y-3">
        <Field label="How orders are sent" hint={METHOD_TEXT[f.send_method]}>
          <Segmented value={f.send_method} disabled={!canEdit} onChange={v => set('send_method', v)}
            options={SEND_METHODS.map(m => ({ value: m.key, label: m.label }))} className="flex-wrap" />
        </Field>
        {f.send_method === 'email' && (
          <Field label="Attach to the email" hint={!s.email ? 'Add an order email address above first' : null}>
            <Segmented value={f.email_attachment} disabled={!canEdit} onChange={v => set('email_attachment', v)}
              options={[{ value: 'pdf', label: 'PDF' }, { value: 'excel', label: 'Excel' }, { value: 'none', label: 'Nothing' }]} />
          </Field>
        )}
        <Field label="Delivery days" hint="None picked = delivers any day">
          <DayPicker value={f.delivery_days} disabled={!canEdit} onChange={v => set('delivery_days', v)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Order cutoff" hint="Orders after this count as the next day's">
            <div className="flex gap-2">
              <Segmented value={f.cutoff_time ? 'on' : 'off'} disabled={!canEdit}
                onChange={v => set('cutoff_time', v === 'on' ? (initial.cutoff_time || '14:00') : null)}
                options={[{ value: 'off', label: 'None' }, { value: 'on', label: 'By' }]} />
              {f.cutoff_time && <TimeSelect value={f.cutoff_time} disabled={!canEdit} onChange={v => set('cutoff_time', v)} label="Cutoff time" />}
            </div>
          </Field>
          <Field label="Days from order to delivery" hint="0 = same day">
            <NumInput value={f.lead_days} disabled={!canEdit} onChange={v => set('lead_days', Math.min(30, Math.max(0, Math.round(v ?? 0))))} />
          </Field>
          <Field label="Minimum order, ex VAT (£)" hint="Optional: orders below it are flagged"><NumInput value={f.min_order} disabled={!canEdit} onChange={v => set('min_order', v)} /></Field>
          <Field label="Delivery charge (£)" hint="Optional: added to each order"><NumInput value={f.delivery_charge} disabled={!canEdit} onChange={v => set('delivery_charge', v)} /></Field>
        </div>
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

function VenuesCard({ s, venues, canEdit, onSaved }) {
  const api = useApi()
  const initial = Object.fromEntries(venues.map(v => {
    const row = s.venues.find(x => x.venue_id === v.id)
    return [v.id, { account_ref: row?.account_ref || '', delivery_days: row?.delivery_days ?? null, cutoff_time: row?.cutoff_time ? hhmm(row.cutoff_time) : null }]
  }))
  const [f, setF] = useState(initial)
  const set = (vid, k, val) => setF(x => ({ ...x, [vid]: { ...x[vid], [k]: val } }))
  const dirty = !same(f, initial)
  const save = useMutation({
    mutationFn: () => api.put(`/suppliers/${s.id}/venues`, { venues: venues.map(v => ({ venue_id: v.id, ...f[v.id] })) }),
    onSuccess: onSaved,
  })
  return (
    <Card title="Per venue"
      actions={canEdit && <button type="button" className={btn.primary} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</button>}>
      <p className="text-sm text-muted-foreground mb-3">Only where a venue differs: its own account number, delivery days or cutoff.</p>
      <div className="space-y-4">
        {venues.map(v => {
          const row = f[v.id]
          return (
            <div key={v.id} className="rounded-xl border p-3 space-y-2">
              <p className="font-medium text-sm">{v.name}</p>
              <Field label="Account number"><input className={inputCls} value={row.account_ref} disabled={!canEdit} placeholder={s.account_ref || ''}
                onChange={e => set(v.id, 'account_ref', e.target.value)} /></Field>
              <Field label="Delivery days">
                <div className="space-y-2">
                  <Segmented value={row.delivery_days ? 'own' : 'same'} disabled={!canEdit}
                    onChange={m => set(v.id, 'delivery_days', m === 'own' ? (s.delivery_days || []) : null)}
                    options={[{ value: 'same', label: `Same (${daysLabel(s.delivery_days)})` }, { value: 'own', label: 'Own days' }]} className="flex-wrap" />
                  {row.delivery_days && <DayPicker value={row.delivery_days} disabled={!canEdit} onChange={d => set(v.id, 'delivery_days', d)} />}
                </div>
              </Field>
              <Field label="Order cutoff">
                <div className="flex gap-2 flex-wrap">
                  <Segmented value={row.cutoff_time ? 'own' : 'same'} disabled={!canEdit}
                    onChange={m => set(v.id, 'cutoff_time', m === 'own' ? (s.cutoff_time ? hhmm(s.cutoff_time) : '14:00') : null)}
                    options={[{ value: 'same', label: s.cutoff_time ? `Same (${hhmm(s.cutoff_time)})` : 'Same (none)' }, { value: 'own', label: 'Own' }]} />
                  {row.cutoff_time && <TimeSelect value={row.cutoff_time} disabled={!canEdit} onChange={t => set(v.id, 'cutoff_time', t)} label="Cutoff time" />}
                </div>
              </Field>
            </div>
          )
        })}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}
