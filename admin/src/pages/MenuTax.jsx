// src/pages/MenuTax.jsx
//
// Menus > Tax rates (/menus/tax, migration 170): the tenant's tax rates
// (Standard 20%, Zero 0%, ...), each with its own % at a location if it
// differs, one of them the default; and a check showing every dish's rate
// per order type at a location and revenue stream (shared/tax.js, the same
// rule the till, online ordering and the Deliveroo file use).
// Rates change with Menus manage; reading is open.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Percent, Plus, Star, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Card, Field, Input, Btn } from '@/components/menus/shared'
import { SortableRows, Modal, ConfirmDelete } from '@/components/staff/shared'

const errText = e => e?.body?.error || e?.message || 'Something went wrong'

// A % box that keeps what is typed while focused.
function PctInput({ value, onChange, placeholder, ...rest }) {
  return (
    <Input type="text" inputMode="decimal" value={value ?? ''} placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, '').slice(0, 6))} {...rest} />
  )
}
const pctOk = v => v !== '' && v != null && !Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100

function RateModal({ rate, venues, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(rate?.name || '')
  const [pct, setPct] = useState(rate ? String(rate.rate) : '')
  const [values, setValues] = useState(() => Object.fromEntries(venues.map(v => [v.id, rate?.values?.[v.id] != null ? String(rate.values[v.id]) : ''])))
  const save = useMutation({
    mutationFn: async () => {
      const id = rate ? rate.id : (await api.post('/tax-rates', { name: name.trim(), rate: Number(pct) })).id
      if (rate) await api.patch('/tax-rates/' + id, { name: name.trim(), rate: Number(pct) })
      const changed = Object.fromEntries(venues
        .filter(v => (values[v.id] || '') !== (rate?.values?.[v.id] != null ? String(rate.values[v.id]) : ''))
        .map(v => [v.id, values[v.id] === '' ? null : Number(values[v.id])]))
      if (Object.keys(changed).length) await api.put('/tax-rates/' + id + '/values', { values: changed })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tax-rates'] }); onClose() },
  })
  const bad = !name.trim() || !pctOk(pct) || venues.some(v => values[v.id] !== '' && !pctOk(values[v.id]))
  return (
    <Modal title={rate ? 'Edit ' + rate.name : 'New tax rate'} onClose={onClose}
      footer={<Btn disabled={bad || save.isPending} onClick={() => save.mutate()} data-testid="rate-save">{save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</Btn>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Reduced" autoFocus /></Field>
        <Field label="%"><PctInput value={pct} onChange={setPct} placeholder="e.g. 5" aria-label="Rate %" /></Field>
      </div>
      {venues.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">A different % at a location</p>
          <p className="text-[11px] text-muted-foreground">Leave empty to use {pctOk(pct) ? Number(pct) + '%' : 'the rate above'} there.</p>
          {venues.map(v => (
            <div key={v.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{v.name}</span>
              <div className="w-28"><PctInput value={values[v.id]} onChange={x => setValues(s => ({ ...s, [v.id]: x }))} placeholder={pctOk(pct) ? String(Number(pct)) : ''} aria-label={'% at ' + v.name} /></div>
            </div>
          ))}
        </div>
      )}
      {save.isError && <p className="text-sm text-destructive">{errText(save.error)}</p>}
    </Modal>
  )
}

function RatesCard({ data, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)   // rate | 'new'
  const [error, setError] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tax-rates'] })
  const act = fn => async () => {
    setError(null)
    try { await fn(); refresh() } catch (e) { setError(errText(e)) }
  }
  const active = data.rates.filter(r => r.is_active)
  return (
    <Card title="Tax rates" action={canManage && (
      <Btn onClick={() => setEditing('new')} data-testid="rate-add"><Plus className="w-3.5 h-3.5" /> Add rate</Btn>
    )} description="Menus, sections and dishes pick a rate from this list. The default is used where nothing is set.">
      <SortableRows items={active} locked={!canManage}
        onReorder={ids => api.put('/tax-rates/order', { ids }).then(refresh)}
        renderItem={r => {
          const local = data.venues.filter(v => r.values?.[v.id] != null)
          return (
            <div className="flex items-center gap-2 min-h-[48px]" data-testid="rate-row">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  {r.name} <span className="text-muted-foreground font-normal">{Number(r.rate)}%</span>
                  {r.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary inline-flex items-center gap-0.5"><Star className="w-3 h-3" /> Default</span>}
                </p>
                {local.length > 0 && <p className="text-xs text-muted-foreground truncate">{local.map(v => v.name + ' ' + Number(r.values[v.id]) + '%').join(' · ')}</p>}
              </div>
              {canManage && !r.is_default && (
                <button type="button" onClick={act(() => api.patch('/tax-rates/' + r.id, { is_default: true }))}
                  className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Make default</button>
              )}
              {canManage && (
                <button type="button" onClick={() => setEditing(r)} aria-label={'Edit ' + r.name}
                  className="h-11 w-11 inline-flex items-center justify-center rounded-lg border touch-manipulation hover:bg-muted"><Pencil className="w-4 h-4" /></button>
              )}
              {canManage && !r.is_default && <ConfirmDelete label="Remove" confirmLabel="Yes, remove" onConfirm={act(() => api.delete('/tax-rates/' + r.id))} />}
            </div>
          )
        }} />
      {error && <p className="text-sm text-destructive mt-2" data-testid="rate-error">{error}</p>}
      {editing && <RateModal rate={editing === 'new' ? null : editing} venues={data.venues} onClose={() => setEditing(null)} />}
    </Card>
  )
}

const FROM = { dish: 'dish', section: 'section', menu: 'menu', default: 'default' }

function CheckCard({ data }) {
  const api = useApi()
  const [venueId, setVenueId] = useState(data.venues[0]?.id || '')
  const [streamId, setStreamId] = useState('')
  const [menuId, setMenuId] = useState('')
  const streams = data.streams.filter(s => s.venue_id === venueId && s.is_active)
  const { data: menus = [] } = useQuery({ queryKey: ['menus'], queryFn: () => api.get('/menus') })
  const q = useQuery({
    queryKey: ['tax-check', venueId, streamId, menuId],
    queryFn: () => api.get('/tax-rates/check?venue_id=' + venueId + (streamId ? '&stream_id=' + streamId : '') + (menuId ? '&menu_id=' + menuId : '')),
    enabled: !!venueId,
  })
  const rateName = id => data.rates.find(r => r.id === id)?.name || ''
  const types = q.data?.order_types || []
  return (
    <Card title="Check" description="Every dish's rate for each order type, as the till, online ordering and the Deliveroo file work it out (draft menus, so check before publishing).">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <Field label="Location">
          <select value={venueId} onChange={e => { setVenueId(e.target.value); setStreamId('') }} aria-label="Check location"
            className="w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation">
            {data.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Revenue stream">
          <select value={streamId} onChange={e => setStreamId(e.target.value)} aria-label="Check revenue stream"
            className="w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation">
            <option value="">None (online ordering, Deliveroo)</option>
            {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Menu">
          <select value={menuId} onChange={e => setMenuId(e.target.value)} aria-label="Check menu"
            className="w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation">
            <option value="">Every menu here</option>
            {menus.filter(m => !m.venue_id || m.venue_id === venueId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && (
        <div className="overflow-x-auto border rounded-lg max-h-[60vh] overflow-y-auto" data-testid="tax-check">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Dish</th>
                {types.map(t => <th key={t.id} className="text-left px-3 py-2 font-medium whitespace-nowrap">{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {q.data.menus.map(m => (
                <MenuRows key={m.id} menu={m} types={types} rateName={rateName} />
              ))}
            </tbody>
          </table>
          {!q.data.menus.length && <p className="text-sm text-muted-foreground p-3">No menus at this location.</p>}
        </div>
      )}
    </Card>
  )
}

function MenuRows({ menu, types, rateName }) {
  return (
    <>
      <tr className="bg-muted/50"><td colSpan={types.length + 1} className="px-3 py-1.5 font-semibold">{menu.name}</td></tr>
      {menu.sections.map(s => (
        <SectionRows key={s.id} section={s} types={types} rateName={rateName} />
      ))}
    </>
  )
}

function SectionRows({ section, types, rateName }) {
  return (
    <>
      <tr><td colSpan={types.length + 1} className="px-3 pt-2 pb-1 text-xs text-muted-foreground uppercase tracking-wide">{section.title}</td></tr>
      {section.items.map(i => (
        <tr key={i.id} className="border-t" data-testid="tax-check-row">
          <td className="px-3 py-1.5">{i.name}</td>
          {types.map(t => {
            const r = i.rates[t.id]
            return (
              <td key={t.id} className="px-3 py-1.5 whitespace-nowrap">
                <span className="font-medium tabular-nums">{r.vat_rate}%</span>{' '}
                <span className="text-xs text-muted-foreground">{rateName(r.rate_id)} · {FROM[r.from]}</span>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

export default function MenuTax() {
  const api = useApi()
  const { canManage } = usePermission('menus')
  const { data, isLoading } = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get('/tax-rates') })
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-lg:notouch:pl-14 max-w-5xl mx-auto space-y-4">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 flex items-center gap-2"><Percent className="w-5 h-5 text-primary" /> Tax rates</h1>
          <p className="text-sm text-muted-foreground">
            A dish's rate comes from its own Tax setting, else its section's, else its menu's, else the default rate.
            Each setting can have exceptions for order types (e.g. Take out at 0%), locations or revenue streams.
          </p>
        </div>
        {!canManage && <ReadOnlyNotice what="tax rates" />}
        {isLoading || !data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <RatesCard data={data} canManage={canManage} />
            <CheckCard data={data} />
          </>
        )}
      </div>
    </div>
  )
}
