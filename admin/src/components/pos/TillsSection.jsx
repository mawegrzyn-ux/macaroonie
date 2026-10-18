// src/components/pos/TillsSection.jsx
//
// Till setup > Tills: the tablets and PCs that run the till app. Adding one
// gives a one-time pairing code, typed on the device at the till address
// (pos.<domain>). A new code pairs the device again and stops the old one.
// A device that isn't set up also shows a code of its own (migration 184):
// LinkShownCode links it from here, the installer app from a phone.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, KeyRound, Pencil, MonitorSmartphone, Link2, Smartphone } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { installerHref } from '@/lib/hosts'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, ago } from './shared'

const MODES = [
  { value: 'table', label: 'Table service' },
  { value: 'counter', label: 'Counter' },
]

export function PairingCode({ code, device, tillUrl, onClose, what = 'till' }) {
  const until = device?.pairing_expires_at
    ? new Date(device.pairing_expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <Modal title={'Pair ' + (device?.name || 'the ' + what)} onClose={onClose}
      footer={<Btn variant="primary" className="flex-1" onClick={onClose}>Done</Btn>}>
      <ol className="text-sm space-y-2 list-decimal pl-5">
        <li>On the {what === 'till' ? 'tablet or PC' : what}, open <span className="font-semibold break-all" data-testid="pairing-address">{tillUrl || 'its address'}</span> in Chrome or Edge.</li>
        <li>Type this code and press Pair this device. The code only works at that address.</li>
      </ol>
      <p className="text-center font-mono text-3xl sm:text-4xl font-bold tracking-widest py-4 select-all" data-testid="pairing-code">{code}</p>
      <p className="text-xs text-muted-foreground">
        The code works once{until ? ', until ' + until : ''}. It isn't shown again: if it runs out, make a new one from the till's row.
        Pairing again later stops the old pairing on whatever device had it. A device can also be disconnected from its own settings: it then shows Not paired here.
      </p>
    </Modal>
  )
}

const KIND_WORDS = { terminal: 'till', kds: 'kitchen screen', kiosk: 'kiosk' }

/** "Link a code shown on the device": a new device from the code it shows (POST /pos/venues/:id/link). */
export function LinkShownCode({ venueId, kind }) {
  const api = useApi()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const tidy = v => {
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    return raw.length > 3 ? raw.slice(0, 3) + '-' + raw.slice(3) : raw
  }
  const link = useMutation({
    mutationFn: () => api.post(`/pos/venues/${venueId}/link`, { code, kind, name: name.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); setOpen(false); setCode(''); setName('') },
  })
  const what = KIND_WORDS[kind]
  return (
    <>
      <Btn onClick={() => setOpen(true)}><Link2 className="w-4 h-4" /> Link a code shown on the {what}</Btn>
      {open && (
        <Modal title={'Link a ' + what + ' showing a code'} onClose={() => setOpen(false)}
          footer={<>
            <Btn className="flex-1" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" className="flex-1" disabled={code.length !== 7 || !name.trim() || link.isPending} onClick={() => link.mutate()}>
              {link.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Link it
            </Btn>
          </>}>
          <p className="text-sm text-muted-foreground">A {what} that isn't set up shows a six-letter code and a QR code. Type the code here, or scan the QR code with a phone to use the installer.</p>
          <Field label="Code on the device">
            <input className={cn(inputCls, 'text-center font-mono text-2xl font-bold tracking-widest uppercase')} value={code}
              onChange={e => setCode(tidy(e.target.value))} placeholder="ABC-DEF" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Name">
            <input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder={'e.g. ' + (kind === 'kds' ? 'Grill screen' : kind === 'kiosk' ? 'Door kiosk' : 'Bar till')} />
          </Field>
          <ErrorNote error={link.error} />
        </Modal>
      )}
    </>
  )
}

/** One line pointing at the installer app (installer.<domain>, or /install where everything shares one address). */
export function InstallerLine({ setup }) {
  const href = installerHref('/install') || '/install'
  const label = setup?.installer_url ? setup.installer_url.replace(/^https?:\/\//, '') : 'the installer'
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
      <Smartphone className="w-3.5 h-3.5 shrink-0" />
      <span>Setting up at the venue? Open <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary break-all">{label}</a> on a phone: it links every till, kitchen screen, kiosk and menu screen by scanning the code they show.</span>
    </p>
  )
}

function TillModal({ venueId, setup, device, onClose, onPaired }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [form, setForm] = useState({
    name: device?.name || '',
    mode: s.mode || 'table',
    revenue_stream_id: s.revenue_stream_id || '',
    floor_area_id: s.floor_area_id || '',
    receipt_printer_id: s.receipt_printer_id || '',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const body = () => ({
    name: form.name.trim(),
    settings: {
      mode: form.mode,
      revenue_stream_id: form.revenue_stream_id || null,
      floor_area_id: form.mode === 'table' ? (form.floor_area_id || null) : null,
      receipt_printer_id: form.receipt_printer_id || null,
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => device
      ? api.patch(`/pos/devices/${device.id}`, body())
      : api.post(`/pos/venues/${venueId}/devices`, { ...body(), kind: 'terminal' }),
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
  const receiptPrinters = setup.printers.filter(p => p.is_active)
  return (
    <Modal title={device ? 'Edit ' + device.name : 'Add a till'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : 'Add and get a pairing code'}
        </Btn>
        {device && <ConfirmDelete label="Remove till" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint="Shown on the till and in reports, e.g. Front till, Bar.">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Front till" />
      </Field>
      <Field group label="Opens in">
        <Segmented value={form.mode} options={MODES} onChange={v => set({ mode: v })} />
      </Field>
      <Field label="Revenue stream" hint="Where its sales are counted unless staff pick another on the check. It also decides the order types the till offers.">
        <select className={inputCls} value={form.revenue_stream_id} onChange={e => set({ revenue_stream_id: e.target.value })}>
          <option value="">First one in the list</option>
          {setup.revenue_streams.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {form.mode === 'table' && (
        <Field label="Floor area" hint="The part of the floor plan it opens on.">
          <select className={inputCls} value={form.floor_area_id} onChange={e => set({ floor_area_id: e.target.value })}>
            <option value="">First area</option>
            {setup.floor_areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Receipt printer" hint="Bills and receipts from this till. Until the venue hub is set up, the till prints them through its own browser.">
        <select className={inputCls} value={form.receipt_printer_id} onChange={e => set({ receipt_printer_id: e.target.value })}>
          <option value="">None</option>
          {receiptPrinters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** The address a device of this kind opens (Till setup's device_urls). */
export const deviceUrl = (setup, kind) => setup.device_urls?.[kind] || setup.till_url

export function status(d) {
  if (d.paired) return { text: 'Paired · seen ' + ago(d.last_seen_at), tone: 'ok' }
  if (d.pairing_open) {
    const t = new Date(d.pairing_expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return { text: 'Waiting to pair, code works until ' + t, tone: 'warn' }
  }
  return { text: 'Not paired', tone: 'muted' }
}

export default function TillsSection({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // device | 'new' | null
  const [pairing, setPairing] = useState(null) // { device, pairing_code }
  const newCode = useMutation({
    mutationFn: id => api.post(`/pos/devices/${id}/pairing-code`, {}),
    onSuccess: out => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); setPairing(out) },
  })
  const rcName = id => setup.revenue_streams.find(r => r.id === id)?.name
  // Kitchen screens and kiosks are listed on their own tabs.
  const isTill = d => d.kind !== 'kds' && d.kind !== 'kiosk'
  const live = setup.devices.filter(d => !d.revoked_at && isTill(d))
  const removed = setup.devices.filter(d => d.revoked_at && isTill(d))

  return (
    <Section title="Tills" hint="Each tablet or PC that runs the till. A till keeps working without the internet and catches up when it's back."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add a till</Btn>}>
      {!live.length && (
        <div className="text-sm text-muted-foreground flex items-start gap-3">
          <MonitorSmartphone className="w-5 h-5 shrink-0 mt-0.5" />
          <p>No tills yet. Add one, then open <span className="font-medium text-foreground">{deviceUrl(setup, 'terminal')}</span> on the tablet and type the pairing code.</p>
        </div>
      )}
      {!!live.length && (
        <div className="rounded-xl border divide-y">
          {live.map(d => {
            const st = status(d)
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.settings?.mode === 'counter' ? 'Counter' : 'Table service'}
                    {rcName(d.settings?.revenue_stream_id) ? ' · ' + rcName(d.settings.revenue_stream_id) : ''}
                  </p>
                  <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : st.tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{st.text}</p>
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
      <p className="text-xs text-muted-foreground">Till address: <span className="font-medium text-foreground break-all">{deviceUrl(setup, 'terminal')}</span> (kitchen screens and kiosks have their own, on their tabs)</p>
      <div><LinkShownCode venueId={venueId} kind="terminal" /></div>
      <InstallerLine setup={setup} />
      <ErrorNote error={newCode.error} />
      {editing && (
        <TillModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onPaired={out => { setEditing(null); setPairing(out) }} />
      )}
      {pairing && <PairingCode code={pairing.pairing_code} device={pairing.device} tillUrl={deviceUrl(setup, 'terminal')} onClose={() => setPairing(null)} />}
    </Section>
  )
}
