// src/components/pos/ChargesSection.jsx
//
// Store tech > Charges (migration 231, shared/pos/charges.js).
//
// The company's list (shared by every location): a service charge, a
// packaging or delivery fee, a cup deposit... Each is a percent or an
// amount; optional or not; from a number of guests; with a VAT rate or none;
// on the whole check, or only on the dishes and menu sections it names (a cup
// deposit on hot drinks: an amount for each one, or once while there is
// one); in the order set here.
//
// Below, this location's matrix: for each revenue stream, the order types it
// offers, and on each the charges a till check of that stream and type gets
// when it opens (and when its order type or stream changes to them). One
// Save for the whole matrix. Staff can also put a charge from the list on
// one check (the Charges window on the till, or a till layout button).

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Loader2, Pencil, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useTaxLookups, rateLabel } from '@/components/menus/TaxBox'
import { DishPicker, catalogNames } from '@/components/menus/DishPicker'
import {
  CHARGES_MAX, CHARGE_PERCENT_MAX, CHARGE_AMOUNT_MAX, MIN_COVERS_MAX, chargeValueText, chargeOnText, onDishes,
} from '@shared/pos/charges.js'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Btn, Segmented, NumberBox, Toggle } from './shared'

const KINDS = [{ value: 'percent', label: 'Percent' }, { value: 'amount', label: 'Amount' }]
const BASES = [{ value: 'check', label: 'The whole check' }, { value: 'dishes', label: 'Some dishes' }]
const PERS = [{ value: 'check', label: 'Once' }, { value: 'dish', label: 'For each dish' }]

/** What is wrong with the form, in words, or null. */
function chargeIssue(f) {
  if (!f.name.trim()) return 'Give it a name'
  if (f.value == null || !(f.value > 0)) return f.kind === 'percent' ? 'Type the percent' : 'Type the amount'
  if (f.kind === 'percent' && f.value > CHARGE_PERCENT_MAX) return 'At most ' + CHARGE_PERCENT_MAX + '%'
  if (f.kind === 'amount' && f.value > CHARGE_AMOUNT_MAX) return 'At most £' + (CHARGE_AMOUNT_MAX / 100).toLocaleString('en-GB')
  if (f.basis === 'dishes' && !f.item_ids.length && !f.section_ids.length) return 'Pick the dishes or sections it is on'
  return null
}

function ChargeModal({ charge, list, catalog, onClose, onSaved }) {
  const api = useApi()
  const { rates } = useTaxLookups()
  const [form, setForm] = useState({
    name: charge?.name || '',
    kind: charge?.kind || 'percent',
    value: charge ? Number(charge.value) : null,
    optional: charge ? !!charge.optional : true,
    min_covers: charge?.min_covers || 0,
    tax_rate_id: charge?.tax_rate_id || null,
    basis: charge?.basis || 'check',
    per: charge?.per || 'check',
    item_ids: charge?.item_ids || [],
    section_ids: charge?.section_ids || [],
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const issue = chargeIssue(form)
  // Allowed, but Cash Recon and the reports count charges with one name together.
  const twin = list.some(y => y.id !== charge?.id && y.name.trim().toLowerCase() === form.name.trim().toLowerCase())
  const known = rates.find(r => r.id === form.tax_rate_id)
  const body = () => ({
    name: form.name.trim(), kind: form.kind, value: form.kind === 'amount' ? Math.round(form.value) : form.value,
    optional: form.optional, min_covers: form.min_covers || 0, tax_rate_id: form.tax_rate_id || null,
    basis: form.basis, per: form.kind === 'amount' ? form.per : 'check',
    item_ids: form.basis === 'dishes' ? form.item_ids : [], section_ids: form.basis === 'dishes' ? form.section_ids : [],
  })
  const save = useMutation({
    mutationFn: () => charge ? api.patch(`/pos/charges/${charge.id}`, body()) : api.post('/pos/charges', body()),
    onSuccess: () => { onSaved(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/charges/${charge.id}`), onSuccess: () => { onSaved(); onClose() } })
  const perWords = form.basis === 'dishes' ? 'for each of those dishes on the check' : 'for each dish on the check'
  return (
    <Modal title={charge ? 'Edit ' + charge.name : 'Add a charge'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!!issue || save.isPending} onClick={() => save.mutate()} data-testid="charge-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {charge && <ConfirmDelete label="Delete charge" confirmLabel="Yes, delete" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint="As the till, the bill and the reports show it.">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })}
          placeholder="e.g. Service charge, Packaging, Cup deposit" data-testid="charge-name" />
      </Field>
      {twin && <p className="text-xs text-amber-700" data-testid="charge-twin">Another charge has this name: Cash Recon and the reports count them together.</p>}
      <Field group label="How much">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={form.kind} options={KINDS} onChange={v => v !== form.kind && set({ kind: v, value: null })} />
          {form.kind === 'percent'
            ? <span className="inline-flex items-center gap-1">
                <NumberBox value={form.value} decimals={2} max={999} onChange={v => set({ value: v })} ariaLabel="Percent" placeholder="12.5" />
                <span className="text-sm text-muted-foreground">% of {form.basis === 'dishes' ? 'those dishes' : 'the check'} after discounts</span>
              </span>
            : <span className="inline-flex items-center gap-1">
                <span className="text-sm text-muted-foreground">£</span>
                <NumberBox value={form.value == null ? null : (form.value / 100).toFixed(2)} decimals={2} max={99999}
                  onChange={v => set({ value: v == null ? null : Math.round(v * 100) })} ariaLabel="Amount in pounds" placeholder="0.50" />
              </span>}
        </div>
      </Field>
      <Field group label="On" hint="Some dishes: only checks with one of them get it, e.g. a cup deposit on hot drinks. A whole menu section covers dishes added to it later too.">
        <Segmented value={form.basis} options={BASES} onChange={v => set({ basis: v })} className="flex-wrap" />
      </Field>
      {form.basis === 'dishes' && (
        <div data-testid="charge-dishes">
          {catalog
            ? <DishPicker catalog={catalog} allowSections itemIds={form.item_ids} sectionIds={form.section_ids} title="Dishes it is on"
                emptyLabel="Pick dishes or sections" onChange={v => set(v)} />
            : <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
        </div>
      )}
      {form.kind === 'amount' && (
        <Field group label="How often" hint={'Once: the amount while the check has ' + (form.basis === 'dishes' ? 'one of those dishes' : 'a dish') + '. For each dish: the amount ' + perWords + ' (2 coffees, 2 deposits).'}>
          <Segmented value={form.per} options={PERS} onChange={v => set({ per: v })} />
        </Field>
      )}
      <Toggle label="Optional" checked={form.optional} onChange={v => set({ optional: v })}
        hint="Staff can take it off the bill. Not optional: taking it off needs a manager every time." />
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Field label="From guests" hint="0 = every check">
          <NumberBox value={form.min_covers} max={MIN_COVERS_MAX} onChange={v => set({ min_covers: v ?? 0 })} ariaLabel="From this many guests" className="w-20" />
        </Field>
        <Field label="VAT on it" hint="An optional service charge usually carries none in the UK; one guests must pay usually does: check with your accountant.">
          <select className={cn(inputCls, 'w-56')} value={form.tax_rate_id || ''} aria-label="VAT on the charge" data-testid="charge-vat"
            onChange={e => set({ tax_rate_id: e.target.value || null })}>
            <option value="">No VAT</option>
            {rates.filter(r => r.is_active || r.id === form.tax_rate_id).map(r => <option key={r.id} value={r.id}>{rateLabel(r)}</option>)}
            {form.tax_rate_id && !known && <option value={form.tax_rate_id}>A rate that was removed</option>}
          </select>
        </Field>
      </div>
      {issue && <p className="text-xs text-destructive" data-testid="charge-issue">{issue}</p>}
      <p className="text-xs text-muted-foreground">
        Checks that already have it keep it as it was. Where checks get it by themselves: each location's table on this page.
      </p>
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** "streamId|typeId" -> Set of charge ids, from the charges' `where` at this venue. */
function matrixOf(charges) {
  const m = new Map()
  for (const x of charges || []) {
    for (const w of x.where || []) {
      const k = w.stream + '|' + w.type
      if (!m.has(k)) m.set(k, new Set())
      m.get(k).add(x.id)
    }
  }
  return m
}
const matrixKey = m => [...m.entries()].flatMap(([k, ids]) => [...ids].map(id => k + '|' + id)).sort().join(',')

/**
 * The location's matrix: per revenue stream, the order types it offers
 * (and any it no longer offers that still have charges here), each with the
 * charges as chips to switch on or off.
 */
function ChargeMatrix({ venueId, setup, charges, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const saved = useMemo(() => matrixOf(charges), [charges])
  const [draft, setDraft] = useState(null)
  const m = draft || saved
  const dirty = !!draft && matrixKey(draft) !== matrixKey(saved)
  const types = setup.order_types || []
  const typeName = id => types.find(t => t.id === id)?.name || 'Removed order type'
  const streams = (setup.revenue_streams || []).filter(s => s.is_active)
  const toggle = (k, id) => {
    const next = new Map([...m.entries()].map(([key, set]) => [key, new Set(set)]))
    const set = next.get(k) || new Set()
    if (set.has(id)) set.delete(id)
    else set.add(id)
    next.set(k, set)
    setDraft(next)
  }
  const save = useMutation({
    mutationFn: () => api.put(`/pos/venues/${venueId}/charge-rules`, {
      rules: [...m.entries()].flatMap(([k, ids]) => {
        const [stream, type] = k.split('|')
        return [...ids].map(id => ({ charge_id: id, revenue_stream_id: stream, order_type_id: type }))
      }),
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
      setDraft(null)
    },
  })
  // A type the stream offers, and still on the list (the till offers no removed type).
  const live = id => !!types.find(t => t.id === id && t.is_active)
  const rowsOf = s => {
    const offered = (s.order_types || []).filter(x => x.enabled && live(x.order_type_id)).map(x => x.order_type_id)
    const leftOver = [...m.keys()].filter(k => k.startsWith(s.id + '|') && m.get(k).size).map(k => k.split('|')[1]).filter(t => !offered.includes(t))
    return [...offered.map(t => ({ type: t, offered: true })), ...leftOver.map(t => ({ type: t, offered: false }))]
  }
  return (
    <Section title={'Which checks get them at ' + (setup.venue?.name || 'this location')}
      hint="A till check of a revenue stream and order type gets the charges switched on there when it opens, and when its order type or stream changes to it. Checks already open keep theirs.">
      {!streams.length && <p className="text-sm text-muted-foreground">No revenue streams here yet (<Link to="/pos/streams" className="underline">Revenue streams</Link>).</p>}
      <div className="space-y-3" data-testid="charge-matrix">
        {streams.map(s => (
          <div key={s.id} className="rounded-xl border" data-testid="matrix-stream" data-name={s.name}>
            <div className="px-3 py-2 border-b text-sm font-semibold flex items-center gap-2">
              {s.colour && <span className="w-2.5 h-5 rounded-full" style={{ background: s.colour }} />}{s.name}
            </div>
            <div className="divide-y">
              {rowsOf(s).map(({ type, offered }) => {
                const k = s.id + '|' + type
                const on = m.get(k) || new Set()
                return (
                  <div key={type} className="p-2 flex flex-wrap items-center gap-2" data-testid="matrix-row" data-type={typeName(type)}>
                    <div className="w-36 shrink-0 text-sm">
                      {typeName(type)}
                      {!offered && <span className="block text-xs text-amber-700">{live(type) ? 'not offered by this stream' : 'order type removed'}</span>}
                    </div>
                    <div className="flex-1 flex flex-wrap gap-1.5">
                      {charges.map(x => {
                        const lit = on.has(x.id)
                        return (
                          <button key={x.id} type="button" disabled={!canManage} onClick={() => toggle(k, x.id)} aria-pressed={lit}
                            data-testid="matrix-cell" data-charge={x.name}
                            className={cn('min-h-[44px] px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 touch-manipulation',
                              lit ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted text-muted-foreground')}>
                            {lit && <Check className="w-4 h-4" />}{x.name} <span className={cn('text-xs', lit ? 'opacity-90' : '')}>{chargeValueText(x)}</span>
                          </button>
                        )
                      })}
                      {!charges.length && <span className="text-sm text-muted-foreground">Add charges to the list above first.</span>}
                    </div>
                  </div>
                )
              })}
              {!rowsOf(s).length && <p className="p-3 text-sm text-muted-foreground">This stream offers no order types.</p>}
            </div>
          </div>
        ))}
      </div>
      {canManage && (dirty || save.isPending) && (
        <div className="flex gap-2 pt-3">
          <Btn variant="primary" className="flex-1" disabled={save.isPending} onClick={() => save.mutate()} data-testid="matrix-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </Btn>
          <Btn onClick={() => setDraft(null)} disabled={save.isPending}>Discard</Btn>
        </div>
      )}
      <ErrorNote error={save.error} />
    </Section>
  )
}

export default function ChargesSection({ venueId, setup, canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const charges = setup.charges || []
  const { data: catalog } = useQuery({ queryKey: ['pos-charges-catalog'], queryFn: () => api.get('/pos/charges/catalog') })
  const names = useMemo(() => catalogNames(catalog), [catalog])
  const { rates } = useTaxLookups()
  const [editing, setEditing] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup'] })
  const reorder = useMutation({ mutationFn: ids => api.put('/pos/charges/order', { ids }), onSettled: refresh })
  const typeName = id => (setup.order_types || []).find(t => t.id === id)?.name
  // "on Hot drinks, optional, from 6 guests, VAT Standard (20%)"
  const detail = x => [
    onDishes(x) ? 'on ' + chargeOnText(x, names) : 'on the whole check',
    x.optional ? 'optional' : 'not optional',
    x.min_covers ? 'from ' + x.min_covers + ' guests' : null,
    x.tax_rate_id ? 'VAT ' + (rateLabel(rates.find(r => r.id === x.tax_rate_id)) || 'rate removed') : 'no VAT',
  ].filter(Boolean).join(', ')
  // "Restaurant: Eat in, Take out · Bar: Eat in"
  // In the streams' order and the order types' (the matrix's), not the rules'.
  const whereText = x => {
    const types = setup.order_types || []
    const typeAt = id => { const i = types.findIndex(t => t.id === id); return i < 0 ? types.length : i }
    return (setup.revenue_streams || []).map(s => {
      const list = (x.where || []).filter(w => w.stream === s.id).map(w => w.type).sort((a, b) => typeAt(a) - typeAt(b))
      return list.length ? s.name + ': ' + list.map(t => typeName(t) || 'removed order type').join(', ') : null
    }).filter(Boolean).join(' · ')
  }
  return (
    <>
      <Section title="Charges" hint="Shared by every location: the charges a till check can have, in this order. Which checks get them by themselves is set per location below; staff can add one from the list to any check on the till."
        actions={canManage && charges.length < CHARGES_MAX && <Btn variant="primary" onClick={() => setEditing('new')} data-testid="charge-new"><Plus className="w-4 h-4" /> Add</Btn>}>
        {!charges.length && <p className="text-sm text-muted-foreground">No charges yet. Add the ones checks get: a service charge, a packaging fee, a cup deposit on hot drinks.</p>}
        {charges.length > 0 && (
          <SortableRows items={charges} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
            renderItem={x => (
              <div className="flex items-center gap-3 min-h-[44px]" data-testid="charge-list-row" data-name={x.name}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{x.name} <span className="font-normal text-muted-foreground">{chargeValueText(x)}</span></p>
                  <p className="text-xs text-muted-foreground" data-testid="charge-detail">{detail(x)}</p>
                  <p className="text-xs text-muted-foreground break-words" data-testid="charge-where">{whereText(x) ? 'Here: ' + whereText(x) : 'Not on any checks here by themselves'}</p>
                </div>
                {canManage && <Btn onClick={() => setEditing(x)} title={'Edit ' + x.name}><Pencil className="w-4 h-4" /></Btn>}
              </div>
            )} />
        )}
        {charges.length >= CHARGES_MAX && <p className="text-xs text-muted-foreground">The list has as many charges as it can take ({CHARGES_MAX}).</p>}
        <p className="text-xs text-muted-foreground">
          A till layout can have a button for one charge (<Link to="/pos/layouts" className="font-medium text-foreground underline">Till layouts</Link>).
          Cash Recon can take charges by name (<Link to="/pos/recon" className="font-medium text-foreground underline">Cash Recon link</Link>).
        </p>
        <ErrorNote error={reorder.error} />
        {editing && <ChargeModal charge={editing === 'new' ? null : editing} list={charges} catalog={catalog} onClose={() => setEditing(null)} onSaved={refresh} />}
      </Section>
      <ChargeMatrix key={venueId} venueId={venueId} setup={setup} charges={charges} canManage={canManage} />
    </>
  )
}
