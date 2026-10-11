// src/components/pos/RevenueCentresSection.jsx
//
// Till setup > Revenue centres: where sales are reported (Restaurant, Bar,
// Takeaway). Each one picks its menus, whether VAT is eat-in or takeaway,
// and an optional service charge added to new checks.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Segmented, Btn, NumberBox, ColourPick, Toggle, pct,
} from './shared'

const VAT_MODES = [
  { value: 'eat_in', label: 'Eat in' },
  { value: 'takeaway', label: 'Takeaway' },
]

function RcModal({ venueId, setup, rc, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: rc?.name || '',
    vat_mode: rc?.vat_mode || 'eat_in',
    menu_ids: rc?.menu_ids || [],
    service_charge_percent: rc ? Number(rc.service_charge_percent) : 0,
    service_charge_min_covers: rc?.service_charge_min_covers ?? 0,
    colour: rc?.colour || null,
    is_active: rc ? rc.is_active : true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({ ...form, name: form.name.trim(), service_charge_percent: form.service_charge_percent || 0, service_charge_min_covers: form.service_charge_min_covers || 0 })
  const save = useMutation({
    mutationFn: () => rc ? api.patch(`/pos/revenue-centres/${rc.id}`, body()) : api.post(`/pos/venues/${venueId}/revenue-centres`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/pos/revenue-centres/${rc.id}`),
    onSuccess: () => { refresh(); onClose() },
  })
  const toggleMenu = id => set({ menu_ids: form.menu_ids.includes(id) ? form.menu_ids.filter(x => x !== id) : [...form.menu_ids, id] })
  return (
    <Modal title={rc ? 'Edit ' + rc.name : 'Add a revenue centre'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {rc && <ConfirmDelete label="Delete revenue centre" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Restaurant" /></Field>
      <Field label="VAT" hint="Which VAT rate dishes use here: a dish or section rate first, else the venue default for eat in or takeaway.">
        <Segmented value={form.vat_mode} options={VAT_MODES} onChange={v => set({ vat_mode: v })} />
      </Field>
      <Field label="Menus on the till" hint="None picked: every published menu.">
        <div className="flex flex-wrap gap-2">
          {setup.menus.map(m => {
            const on = form.menu_ids.includes(m.id)
            return (
              <button key={m.id} type="button" onClick={() => toggleMenu(m.id)}
                className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
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
      <Field label="Colour on the till"><ColourPick value={form.colour} onChange={v => set({ colour: v })} /></Field>
      {rc && <Toggle label="In use" hint="Off: the till doesn't offer it. Sales already in it stay in reports." checked={form.is_active} onChange={v => set({ is_active: v })} />}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function RevenueCentresSection({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const reorder = useMutation({
    mutationFn: ids => api.put(`/pos/venues/${venueId}/revenue-centres/order`, { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const menuNames = ids => (ids || []).map(id => setup.menus.find(m => m.id === id)?.name).filter(Boolean)
  return (
    <Section title="Revenue centres" hint="Where sales are reported: e.g. Restaurant, Bar, Takeaway. Staff can change a check's revenue centre on the till."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
      {!setup.revenue_centres.length
        ? <p className="text-sm text-muted-foreground">No revenue centres yet. Add at least one before pairing a till.</p>
        : (
          <SortableRows items={setup.revenue_centres} onReorder={ids => reorder.mutate(ids)}
            renderItem={rc => (
              <div className="flex items-center gap-3">
                {rc.colour && <span className="w-3 h-8 rounded-full shrink-0" style={{ background: rc.colour }} />}
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', !rc.is_active && 'text-muted-foreground line-through')}>{rc.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {rc.vat_mode === 'takeaway' ? 'Takeaway VAT' : 'Eat-in VAT'}
                    {Number(rc.service_charge_percent) > 0 && ' · service charge ' + pct(rc.service_charge_percent) + (rc.service_charge_min_covers ? ' from ' + rc.service_charge_min_covers + ' covers' : '')}
                    {' · '}{menuNames(rc.menu_ids).join(', ') || 'all menus'}
                  </p>
                </div>
                <Btn onClick={() => setEditing(rc)} title={'Edit ' + rc.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )} />
        )}
      <ErrorNote error={reorder.error} />
      {editing && <RcModal venueId={venueId} setup={setup} rc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}
