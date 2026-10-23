// src/components/pos/RevenueStreamsSection.jsx
//
// Store tech > Revenue streams (migration 170): groups of tills for
// recognising revenue by place and/or device (Restaurant, Bar, Kiosk). A
// stream doesn't decide tax. Each one picks its menus, an optional service
// charge, which order types it offers and, per type, whether to ask for a
// customer name and a tent number (off, ask, must have), and the type new
// checks start as.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Segmented, Btn, NumberBox, ColourPick, Toggle, pct,
} from './shared'

const PROMPTS = [
  { value: 'off', label: 'No' },
  { value: 'ask', label: 'Ask' },
  { value: 'required', label: 'Must' },
]
const PROMPT_WORD = { ask: 'asks', required: 'must have' }

/** A stream's type rows for every active order type (off when the stream has none). */
function typeRows(stream, orderTypes) {
  const byId = Object.fromEntries((stream?.order_types || []).map(x => [x.order_type_id, x]))
  return orderTypes.filter(t => t.is_active || byId[t.id]?.enabled).map(t => ({
    order_type_id: t.id,
    enabled: stream ? !!byId[t.id]?.enabled : true,
    ask_name: byId[t.id]?.ask_name || 'off',
    ask_tent: byId[t.id]?.ask_tent || 'off',
  }))
}

function StreamModal({ venueId, setup, stream, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const types = setup.order_types || []
  const [form, setForm] = useState({
    name: stream?.name || '',
    menu_ids: stream?.menu_ids || [],
    service_charge_percent: stream ? Number(stream.service_charge_percent) : 0,
    service_charge_min_covers: stream?.service_charge_min_covers ?? 0,
    colour: stream?.colour || null,
    is_active: stream ? stream.is_active : true,
    default_order_type_id: stream?.default_order_type_id || null,
    order_types: typeRows(stream, types),
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const setType = (id, patch) => set({ order_types: form.order_types.map(x => (x.order_type_id === id ? { ...x, ...patch } : x)) })
  const on = form.order_types.filter(x => x.enabled)
  const def = on.some(x => x.order_type_id === form.default_order_type_id) ? form.default_order_type_id : on[0]?.order_type_id || null
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({
    name: form.name.trim(), menu_ids: form.menu_ids, colour: form.colour, is_active: form.is_active,
    service_charge_percent: form.service_charge_percent || 0, service_charge_min_covers: form.service_charge_min_covers || 0,
    default_order_type_id: def, order_types: form.order_types,
  })
  const save = useMutation({
    mutationFn: () => stream ? api.patch(`/pos/revenue-streams/${stream.id}`, body()) : api.post(`/pos/venues/${venueId}/revenue-streams`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/pos/revenue-streams/${stream.id}`),
    onSuccess: () => { refresh(); onClose() },
  })
  const toggleMenu = id => set({ menu_ids: form.menu_ids.includes(id) ? form.menu_ids.filter(x => x !== id) : [...form.menu_ids, id] })
  const typeName = id => types.find(t => t.id === id)?.name || 'Removed'
  return (
    <Modal title={stream ? 'Edit ' + stream.name : 'Add a revenue stream'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || !on.length || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {stream && <ConfirmDelete label="Delete revenue stream" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Restaurant, Bar, Kiosk" /></Field>
      <Field group label="Order types" hint="Which order types tills in this stream offer, and what to ask for when one is picked: No, Ask (can be skipped) or Must (the check can't go to the kitchen or be paid without it).">
        <div className="rounded-xl border divide-y" data-testid="stream-types">
          {form.order_types.map(x => (
            <div key={x.order_type_id} className="p-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 min-h-[44px] flex-1 min-w-[140px] touch-manipulation">
                <input type="checkbox" className="w-5 h-5" checked={x.enabled} onChange={e => setType(x.order_type_id, { enabled: e.target.checked })} aria-label={'Offer ' + typeName(x.order_type_id)} />
                <span className="text-sm font-medium">{typeName(x.order_type_id)}</span>
              </label>
              {x.enabled && (
                <>
                  <div className="flex items-center gap-1" role="group" aria-label={'Name for ' + typeName(x.order_type_id)}>
                    <span className="text-xs text-muted-foreground w-11">Name</span>
                    <Segmented value={x.ask_name} options={PROMPTS} onChange={v => setType(x.order_type_id, { ask_name: v })} />
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={'Tent for ' + typeName(x.order_type_id)}>
                    <span className="text-xs text-muted-foreground w-11">Tent</span>
                    <Segmented value={x.ask_tent} options={PROMPTS} onChange={v => setType(x.order_type_id, { ask_tent: v })} />
                  </div>
                </>
              )}
            </div>
          ))}
          {!form.order_types.length && <p className="p-3 text-sm text-muted-foreground">No order types yet: add them on the Order types tab.</p>}
        </div>
      </Field>
      {on.length > 1 && (
        <Field label="New checks start as">
          <select className={inputCls} value={def || ''} onChange={e => set({ default_order_type_id: e.target.value })} aria-label="Default order type">
            {on.map(x => <option key={x.order_type_id} value={x.order_type_id}>{typeName(x.order_type_id)}</option>)}
          </select>
        </Field>
      )}
      <Field group label="Menus on the till" hint="None picked: every published menu.">
        <div className="flex flex-wrap gap-2">
          {setup.menus.map(m => {
            const picked = form.menu_ids.includes(m.id)
            return (
              <button key={m.id} type="button" onClick={() => toggleMenu(m.id)}
                className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', picked ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {m.name}{!m.is_published && ' (not published)'}
              </button>
            )
          })}
          {!setup.menus.length && <p className="text-sm text-muted-foreground">No menus yet: build one on the Menus page.</p>}
        </div>
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Service charge %" hint="Added to new checks. 0 for none.">
          <NumberBox value={form.service_charge_percent} decimals={2} max={50} onChange={v => set({ service_charge_percent: v ?? 0 })} ariaLabel="Service charge percent" />
        </Field>
        <Field label="From covers" hint="Only for tables of at least this many guests. 0 = always.">
          <NumberBox value={form.service_charge_min_covers} max={100} onChange={v => set({ service_charge_min_covers: v ?? 0 })} ariaLabel="Service charge from covers" />
        </Field>
      </div>
      <Field group label="Colour on the till"><ColourPick value={form.colour} onChange={v => set({ colour: v })} /></Field>
      {stream && <Toggle label="In use" hint="Off: the till doesn't offer it. Sales already in it stay in reports." checked={form.is_active} onChange={v => set({ is_active: v })} />}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function RevenueStreamsSection({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const reorder = useMutation({
    mutationFn: ids => api.put(`/pos/venues/${venueId}/revenue-streams/order`, { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const menuNames = ids => (ids || []).map(id => setup.menus.find(m => m.id === id)?.name).filter(Boolean)
  const typeName = id => (setup.order_types || []).find(t => t.id === id)?.name
  const typesText = rs => (rs.order_types || []).filter(x => x.enabled).map(x => {
    const asks = [x.ask_name !== 'off' && 'name ' + PROMPT_WORD[x.ask_name], x.ask_tent !== 'off' && 'tent ' + PROMPT_WORD[x.ask_tent]].filter(Boolean)
    return (typeName(x.order_type_id) || 'Removed') + (asks.length ? ' (' + asks.join(', ') + ')' : '')
  }).join(', ')
  return (
    <Section title="Revenue streams" hint="Groups of tills for recognising revenue by place or device: e.g. Restaurant, Bar, Kiosk. A till belongs to one (Tills tab); staff can change a check's stream on the till. Tax comes from Menus, Tax rates."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      {!setup.revenue_streams.length
        ? <p className="text-sm text-muted-foreground">No revenue streams yet. Add at least one before pairing a till.</p>
        : (
          <SortableRows items={setup.revenue_streams} onReorder={ids => reorder.mutate(ids)}
            renderItem={rs => (
              <div className="flex items-center gap-3" data-testid="stream-row">
                {rs.colour && <span className="w-3 h-8 rounded-full shrink-0" style={{ background: rs.colour }} />}
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', !rs.is_active && 'text-muted-foreground line-through')}>{rs.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {typesText(rs) || 'No order types'}
                    {rs.default_order_type_id && typeName(rs.default_order_type_id) && ' · starts as ' + typeName(rs.default_order_type_id)}
                    {Number(rs.service_charge_percent) > 0 && ' · service charge ' + pct(rs.service_charge_percent) + (rs.service_charge_min_covers ? ' from ' + rs.service_charge_min_covers + ' covers' : '')}
                    {' · '}{menuNames(rs.menu_ids).join(', ') || 'all menus'}
                  </p>
                </div>
                <Btn onClick={() => setEditing(rs)} title={'Edit ' + rs.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )} />
        )}
      <ErrorNote error={reorder.error} />
      {editing && <StreamModal venueId={venueId} setup={setup} stream={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}
