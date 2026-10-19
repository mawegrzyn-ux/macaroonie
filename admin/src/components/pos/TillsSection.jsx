// src/components/pos/TillsSection.jsx
//
// Till setup > Tills: the tablets and PCs that run the till app. Devices are
// set up one way, the installer's (migration 184): open the device's address
// (pos.<domain> for tills) and it shows a code and a QR code; type the code
// here with a name and settings (Add a till), or scan the QR code with a
// phone (the installer app). Link a device puts a new device on a till that
// is already here; the old device stops. ShownCodeField, LinkDeviceModal and
// linkShownCode() are shared with the Kitchen screens and Kiosks tabs.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, MonitorSmartphone, Link2, Smartphone } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { installerHref } from '@/lib/hosts'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, ago } from './shared'

const MODES = [
  { value: 'table', label: 'Table service' },
  { value: 'counter', label: 'Counter' },
]

const KIND_WORDS = { terminal: 'till', kds: 'kitchen screen', kiosk: 'kiosk', hub: 'venue hub' }
const KIND_DEVICE = { terminal: 'tablet or PC', kds: 'kitchen screen', kiosk: 'kiosk screen', hub: 'PC' }

/** A code as the device shows it: ABC-DEF. */
export const tidyCode = v => {
  const raw = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return raw.length > 3 ? raw.slice(0, 3) + '-' + raw.slice(3) : raw
}
export const codeReady = c => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(c || '')

/**
 * The code the device shows, and how to get it: open the kind's address on
 * the device (it shows a six-letter code and a QR code), type the code here.
 * The same steps as the installer app; scanning the QR code with a phone
 * opens the installer instead.
 */
export function ShownCodeField({ setup, kind, value, onChange, autoFocus = false }) {
  const url = deviceUrl(setup, kind)
  const what = KIND_WORDS[kind]
  return (
    <div className="rounded-xl border bg-muted/40 p-3 space-y-3" data-testid="shown-code">
      {kind === 'hub' ? (
        <ol className="text-sm space-y-1.5 list-decimal pl-5">
          <li>On the PC by the printers, run <span className="font-mono font-semibold">node hub/bin/hub.js</span>. It shows a six-letter code.</li>
          <li>Type the code here.</li>
        </ol>
      ) : (
        <ol className="text-sm space-y-1.5 list-decimal pl-5">
          <li>On the {KIND_DEVICE[kind]}, open <span className="font-semibold break-all" data-testid="device-address">{url}</span> in Chrome. It shows a six-letter code and a QR code.</li>
          <li>Type the code here. Or scan the QR code with a phone to link it in the installer app instead.</li>
        </ol>
      )}
      <Field label={'Code on the ' + what}>
        <input className={cn(inputCls, 'text-center font-mono text-2xl font-bold tracking-widest uppercase')} value={value}
          onChange={e => onChange(tidyCode(e.target.value))} placeholder="ABC-DEF" autoComplete="off" spellCheck={false}
          autoFocus={autoFocus} aria-label={'Code on the ' + what} data-testid="shown-code-input" />
      </Field>
    </div>
  )
}

/** Links a code a device shows: a new device ({ name, settings }) or a new one for a device already here ({ device_id }). */
export function linkShownCode(api, venueId, kind, code, rest) {
  return api.post(`/pos/venues/${venueId}/link`, { code, kind, ...rest })
}

/**
 * Link a device to a till, kitchen screen or kiosk already here: one that
 * isn't linked (new, disconnected) or a replacement for a broken one. It
 * keeps its name and settings; the device it was on stops working.
 */
export function LinkDeviceModal({ venueId, setup, device, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const link = useMutation({
    mutationFn: () => linkShownCode(api, venueId, device.kind, code, { device_id: device.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); onClose() },
  })
  const what = KIND_WORDS[device.kind] || 'device'
  return (
    <Modal title={(device.paired ? 'New device for ' : 'Link a device to ') + device.name} onClose={onClose}
      footer={<>
        <Btn className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" className="flex-1" disabled={!codeReady(code) || link.isPending} onClick={() => link.mutate()} data-testid="link-device-submit">
          {link.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Link it
        </Btn>
      </>}>
      <p className="text-sm text-muted-foreground">
        {device.paired
          ? `For a broken or replaced ${what}: the new device keeps the name ${device.name} and its settings, and the device it is on now stops working.`
          : `The device keeps the name ${device.name} and its settings.`}
      </p>
      <ShownCodeField setup={setup} kind={device.kind} value={code} onChange={setCode} autoFocus />
      <ErrorNote error={link.error} />
    </Modal>
  )
}

/** The row button that opens LinkDeviceModal. */
export function LinkDeviceButton({ device, onClick }) {
  return (
    <Btn onClick={onClick} title={device.paired ? 'Put it on a new device' : 'Link a device showing a code'} data-testid="link-device">
      <Link2 className="w-4 h-4" /> <span className="hidden sm:inline">{device.paired ? 'New device' : 'Link a device'}</span>
    </Btn>
  )
}

/** One line pointing at the installer app (installer.<domain>, or /install where everything shares one address). */
export function InstallerLine({ setup }) {
  const href = installerHref('/install') || '/install'
  const label = setup?.installer_url ? setup.installer_url.replace(/^https?:\/\//, '') : 'the installer'
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
      <Smartphone className="w-3.5 h-3.5 shrink-0" />
      <span>Setting up at the venue? Open <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary break-all">{label}</a> on a phone: it links every till, kitchen screen, kiosk and menu screen by scanning the QR code they show, the same codes as here.</span>
    </p>
  )
}

function TillModal({ venueId, setup, device, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [code, setCode] = useState('')
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
      : linkShownCode(api, venueId, 'terminal', code, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/pos/devices/${device.id}`),
    onSuccess: () => { refresh(); onClose() },
  })
  const receiptPrinters = setup.printers.filter(p => p.is_active)
  return (
    <Modal title={device ? 'Edit ' + device.name : 'Add a till'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || (!device && !codeReady(code)) || save.isPending} onClick={() => save.mutate()} data-testid="device-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : 'Add the till'}
        </Btn>
        {device && <ConfirmDelete label="Remove till" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!device && <ShownCodeField setup={setup} kind="terminal" value={code} onChange={setCode} autoFocus />}
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
      <Field label="Receipt printer" hint="Bills and receipts from this till. With none, or one plugged into this till, it prints them through its own browser; a network printer prints through the venue hub (Printers tab).">
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
  if (d.paired) return { text: 'Linked · seen ' + ago(d.last_seen_at), tone: 'ok' }
  return { text: 'Not linked: no device is using it', tone: 'warn' }
}

export default function TillsSection({ venueId, setup }) {
  const [editing, setEditing] = useState(null) // device | 'new' | null
  const [linking, setLinking] = useState(null) // device
  const rcName = id => setup.revenue_streams.find(r => r.id === id)?.name
  // Kitchen screens and kiosks are listed on their own tabs, venue hubs on Printers.
  const isTill = d => d.kind === 'terminal'
  const live = setup.devices.filter(d => !d.revoked_at && isTill(d))
  const removed = setup.devices.filter(d => d.revoked_at && isTill(d))

  return (
    <Section title="Tills" hint="Each tablet or PC that runs the till. A till keeps working without the internet and catches up when it's back."
      actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add a till</Btn>}>
      {!live.length && (
        <div className="text-sm text-muted-foreground flex items-start gap-3">
          <MonitorSmartphone className="w-5 h-5 shrink-0 mt-0.5" />
          <p>No tills yet. Open <span className="font-medium text-foreground">{deviceUrl(setup, 'terminal')}</span> on the tablet: it shows a code. Press <span className="font-medium text-foreground">Add a till</span> and type it, or scan its QR code with a phone.</p>
        </div>
      )}
      {!!live.length && (
        <div className="rounded-xl border divide-y">
          {live.map(d => {
            const st = status(d)
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="till-row">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.settings?.mode === 'counter' ? 'Counter' : 'Table service'}
                    {rcName(d.settings?.revenue_stream_id) ? ' · ' + rcName(d.settings.revenue_stream_id) : ''}
                  </p>
                  <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : st.tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{st.text}</p>
                </div>
                <LinkDeviceButton device={d} onClick={() => setLinking(d)} />
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
      <InstallerLine setup={setup} />
      {editing && (
        <TillModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
    </Section>
  )
}
