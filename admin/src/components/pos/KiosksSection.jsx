// src/components/pos/KiosksSection.jsx
//
// Till setup > Kiosks: self-order kiosks (docs/POS.md section 10). A kiosk
// is a till device of kind 'kiosk', paired like a till at the till address.
// Guests order and pay on it; its orders are counter checks in its revenue
// stream, so they reach the tills' Counter list, the kitchen, the reports and
// Cash Recon like any other. How it looks and behaves is a kiosk design:
// company-wide, edited on its own page (/pos/kiosk-designs/:id) with a live
// preview.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, KeyRound, Pencil, Copy, Tablet, Palette, AlertTriangle } from 'lucide-react'
import { designProblems } from '@shared/kiosk.js'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, ago } from './shared'
import { PairingCode, status } from './TillsSection'

const READERS = [
  { value: 'none', label: 'None' },
  { value: 'test', label: 'Test reader' },
]

/** The design a kiosk shows: its own pick, else the company's first design. */
export function kioskDesign(setup, device) {
  const designs = setup.kiosk_designs || []
  return designs.find(d => d.id === device?.settings?.design_id) || designs[0] || null
}

function KioskModal({ venueId, setup, device, onClose, onPaired }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [form, setForm] = useState({
    name: device?.name || '',
    revenue_stream_id: s.revenue_stream_id || '',
    design_id: s.design_id || '',
    card_reader: s.card_reader || 'none',
    receipt_printer_id: s.receipt_printer_id || '',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const body = () => ({
    name: form.name.trim(),
    settings: {
      mode: 'counter',
      revenue_stream_id: form.revenue_stream_id || null,
      design_id: form.design_id || null,
      card_reader: form.card_reader,
      receipt_printer_id: form.receipt_printer_id || null,
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => device
      ? api.patch(`/pos/devices/${device.id}`, body())
      : api.post(`/pos/venues/${venueId}/devices`, { ...body(), kind: 'kiosk' }),
    onSuccess: out => {
      refresh()
      if (!device) onPaired(out)
      else onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/pos/devices/${device.id}`),
    onSuccess: () => { refresh(); onClose() },
  })
  const design = kioskDesign(setup, { settings: { design_id: form.design_id } })
  const problems = design ? designProblems(design.settings, { card_reader: form.card_reader }) : []
  return (
    <Modal title={device ? 'Edit ' + device.name : 'Add a kiosk'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : 'Add and get a pairing code'}
        </Btn>
        {device && <ConfirmDelete label="Remove kiosk" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint="Shown in Till setup and on the tills' Counter list, e.g. Kiosk 1, Door kiosk.">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Kiosk 1" />
      </Field>
      <Field label="Revenue stream" hint="Where its sales are counted. The stream's order types are the ones the kiosk offers (Staying or going?), and the stream decides whether it asks for a name or a table number.">
        <select className={inputCls} value={form.revenue_stream_id} onChange={e => set({ revenue_stream_id: e.target.value })}>
          <option value="">First one in the list</option>
          {setup.revenue_streams.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Design" hint="Colours, start screen, languages, how choices are shown, ways to pay. Designs are listed below this.">
        <select className={inputCls} value={form.design_id} onChange={e => set({ design_id: e.target.value })}>
          <option value="">{setup.kiosk_designs?.length ? 'The first design (' + setup.kiosk_designs[0].name + ')' : 'The standard look (no designs yet)'}</option>
          {(setup.kiosk_designs || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field group label="Card reader" hint="Test reader: Approve and Decline buttons on the kiosk, no money is taken. Card terminals connect here later.">
        <Segmented value={form.card_reader} options={READERS} onChange={v => set({ card_reader: v })} />
      </Field>
      <Field label="Receipt printer" hint="Receipts the guest asks for. Until the venue hub is set up, the kiosk prints through its own browser.">
        <select className={inputCls} value={form.receipt_printer_id} onChange={e => set({ receipt_printer_id: e.target.value })}>
          <option value="">None</option>
          {setup.printers.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {problems.map(p => (
        <p key={p} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {p}</p>
      ))}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

function KioskDevices({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // device | 'new' | null
  const [pairing, setPairing] = useState(null) // { device, pairing_code }
  const newCode = useMutation({
    mutationFn: id => api.post(`/pos/devices/${id}/pairing-code`, {}),
    onSuccess: out => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); setPairing(out) },
  })
  const rcName = id => setup.revenue_streams.find(r => r.id === id)?.name
  const live = setup.devices.filter(d => !d.revoked_at && d.kind === 'kiosk')
  const removed = setup.devices.filter(d => d.revoked_at && d.kind === 'kiosk')
  return (
    <Section title="Kiosks" hint="Self-order screens: guests choose, pay and get an order number. Their orders go to the kitchen and show on the tills' Counter list like any counter order."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add a kiosk</Btn>}>
      {!live.length && (
        <div className="text-sm text-muted-foreground flex items-start gap-3">
          <Tablet className="w-5 h-5 shrink-0 mt-0.5" />
          <p>No kiosks yet. Add one, then open <span className="font-medium text-foreground">{setup.till_url}</span> on the kiosk screen in Chrome and type the pairing code. For a kiosk that guests can't leave, run Chrome in kiosk mode (or a kiosk browser such as Fully Kiosk).</p>
        </div>
      )}
      {!!live.length && (
        <div className="rounded-xl border divide-y">
          {live.map(d => {
            const st = status(d)
            const design = kioskDesign(setup, d)
            const problems = design ? designProblems(design.settings, d.settings || {}) : []
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="kiosk-row">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {design ? design.name : 'Standard look'}
                    {rcName(d.settings?.revenue_stream_id) ? ' · ' + rcName(d.settings.revenue_stream_id) : ''}
                    {' · '}{d.settings?.card_reader === 'test' ? 'Test card reader' : 'No card reader'}
                  </p>
                  <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : st.tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{st.text}</p>
                  {problems.map(p => <p key={p} className="text-xs text-amber-800 flex gap-1 items-start"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {p}</p>)}
                </div>
                <Btn onClick={() => newCode.mutate(d.id)} disabled={newCode.isPending} title="New pairing code">
                  <KeyRound className="w-4 h-4" /> <span className="hidden sm:inline">{d.paired ? 'Pair again' : 'New code'}</span>
                </Btn>
                <Btn onClick={() => setEditing(d)} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )
          })}
        </div>
      )}
      {!!removed.length && (
        <p className="text-xs text-muted-foreground">Removed: {removed.map(d => d.name + ' (' + d.short_code + ')').join(', ')}</p>
      )}
      <ErrorNote error={newCode.error} />
      {editing && (
        <KioskModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onPaired={out => { setEditing(null); setPairing(out) }} />
      )}
      {pairing && <PairingCode code={pairing.pairing_code} device={pairing.device} tillUrl={setup.till_url} what="kiosk" onClose={() => setPairing(null)} />}
    </Section>
  )
}

function KioskDesigns({ venueId, setup, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const designs = setup.kiosk_designs || []
  const kiosks = setup.devices.filter(d => !d.revoked_at && d.kind === 'kiosk')
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const create = useMutation({
    mutationFn: from => api.post('/pos/kiosk-designs', from
      ? { name: from.name.slice(0, 72) + ' (copy)', settings: {}, copy_from: from.id }
      : { name: designs.length ? 'Kiosk design ' + (designs.length + 1) : 'Kiosk design', settings: {} }),
    onSuccess: row => { refresh(); navigate('/pos/kiosk-designs/' + row.id) },
  })
  const remove = useMutation({
    mutationFn: id => api.delete('/pos/kiosk-designs/' + id),
    onSuccess: refresh,
  })
  return (
    <Section title="Kiosk designs" hint="Shared by every venue. Each kiosk picks one; a kiosk with none uses the first. Changes reach the kiosks when you save."
      actions={canManage && <Btn onClick={() => create.mutate(null)} disabled={create.isPending}><Plus className="w-4 h-4" /> New design</Btn>}>
      {!designs.length && (
        <div className="text-sm text-muted-foreground flex items-start gap-3">
          <Palette className="w-5 h-5 shrink-0 mt-0.5" />
          <p>No designs yet: kiosks use the standard look. Make a design to set your colours, fonts, start screen, languages and how choices are shown.</p>
        </div>
      )}
      {!!designs.length && (
        <div className="rounded-xl border divide-y">
          {designs.map((d, i) => {
            const using = kiosks.filter(k => kioskDesign(setup, k)?.id === d.id)
            const c = d.settings.brand.colors
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="design-row">
                <span className="w-11 h-11 rounded-lg overflow-hidden grid grid-cols-2 shrink-0 border" aria-hidden="true">
                  <span style={{ background: c.primary }} /><span style={{ background: c.accent }} />
                  <span style={{ background: c.background }} /><span style={{ background: c.surface }} />
                </span>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-medium">{d.name}{i === 0 && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(first: kiosks without a design use it)</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {using.length ? 'Here: ' + using.map(k => k.name).join(', ') : 'No kiosk here uses it'} · changed {ago(d.updated_at)}
                  </p>
                </div>
                <Btn onClick={() => navigate('/pos/kiosk-designs/' + d.id)} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /> <span className="hidden sm:inline">{canManage ? 'Edit' : 'Open'}</span></Btn>
                {canManage && <Btn onClick={() => create.mutate(d)} disabled={create.isPending} title={'Copy ' + d.name}><Copy className="w-4 h-4" /></Btn>}
                {canManage && <ConfirmDelete label="Delete" confirmLabel="Yes, delete" onConfirm={() => remove.mutate(d.id)} disabled={remove.isPending} />}
              </div>
            )
          })}
        </div>
      )}
      <ErrorNote error={create.error || remove.error} />
    </Section>
  )
}

export default function KiosksSection(props) {
  return (
    <div className="space-y-4">
      <KioskDevices {...props} />
      <KioskDesigns {...props} />
    </div>
  )
}
