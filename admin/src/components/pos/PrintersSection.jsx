// src/components/pos/PrintersSection.jsx
//
// Till setup > Printers (migration 191): the venue's printers and who prints
// for them. A network printer (an address on the venue's network) is
// printed by the venue hub, a small program on a PC by the printers (hub/,
// linked by the code it shows, like a till). A printer plugged into a till,
// kitchen screen or kiosk is printed by that device's browser. Kitchen
// tickets go where the kitchen flow sends dishes: a Kitchen printer box in
// Kitchen screens > Kitchen flow. Bills and receipts go to each device's
// receipt printer (Tills > Edit), or print in the device's own browser.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, Server, RotateCcw, Printer } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle, ago } from './shared'
import { ShownCodeField, LinkDeviceModal, LinkDeviceButton, linkShownCode, codeReady, status } from './TillsSection'

const KINDS = [
  { value: 'station', label: 'Kitchen / bar' },
  { value: 'receipt', label: 'Receipts' },
]
const CONNECTIONS = [
  { value: 'hub', label: 'On the network' },
  { value: 'device', label: 'Plugged into a device' },
]
const DEVICE_KINDS = { terminal: 'Till', kds: 'Kitchen screen', kiosk: 'Kiosk' }

/** The devices a printer can be plugged into. */
const plugDevices = setup => setup.devices.filter(d => !d.revoked_at && DEVICE_KINDS[d.kind])

/** What we know about a printer, in a few words: [text, tone]. */
export function printerState(p, setup) {
  if (!p.is_active) return ['Switched off', 'muted']
  if (p.connection === 'device') {
    const d = setup.devices.find(x => x.id === p.device_id)
    if (!d) return ['Pick the till, kitchen screen or kiosk it is plugged into', 'warn']
    if (d.revoked_at) return [d.name + ' was removed: pick another device', 'warn']
    return ['Printed by ' + d.name + (d.paired ? ', seen ' + ago(d.last_seen_at) : ' (not linked yet)'), d.paired ? 'ok' : 'warn']
  }
  const hubs = setup.devices.filter(d => d.kind === 'hub' && !d.revoked_at)
  if (!p.host) return ['Type its address on the network', 'warn']
  if (!hubs.length) return ['Waiting for a venue hub: link one below', 'warn']
  const s = p.status
  if (!s || !p.status_at) return ['The hub hasn\'t checked it yet', 'muted']
  const when = ' (' + ago(p.status_at) + ')'
  if (!s.online) return ['Not answering' + (s.error ? ': ' + s.error : '') + when, 'bad']
  if (s.paper_out) return ['Out of paper' + when, 'bad']
  if (s.cover_open) return ['Cover open' + when, 'bad']
  if (s.paper_low) return ['Paper running low' + when, 'warn']
  return ['Ready' + when, 'ok']
}

const TONE = { ok: 'text-green-700', warn: 'text-amber-700', bad: 'text-red-700', muted: 'text-muted-foreground' }

function PrinterModal({ venueId, setup, printer, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: printer?.name || '', kind: printer?.kind || 'station',
    connection: printer?.connection || 'hub', device_id: printer?.device_id || '',
    host: printer?.host || '', port: printer?.port ?? 9100, columns: printer?.columns ?? 42,
    backup_printer_id: printer?.backup_printer_id || '', is_active: printer ? printer.is_active : true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const onNetwork = form.connection === 'hub'
  const body = () => ({
    ...form, name: form.name.trim(), host: onNetwork ? (form.host.trim() || null) : null,
    device_id: onNetwork ? null : (form.device_id || null),
    port: form.port || 9100, columns: form.columns || 42,
    backup_printer_id: onNetwork ? (form.backup_printer_id || null) : null,
  })
  const save = useMutation({
    mutationFn: () => printer ? api.patch(`/pos/printers/${printer.id}`, body()) : api.post(`/pos/venues/${venueId}/printers`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/printers/${printer.id}`), onSuccess: () => { refresh(); onClose() } })
  const devices = plugDevices(setup)
  const ready = form.name.trim() && (onNetwork || form.device_id)
  return (
    <Modal title={printer ? 'Edit ' + printer.name : 'Add a printer'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="printer-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {printer && <ConfirmDelete label="Delete printer" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Grill printer" data-testid="printer-name" /></Field>
      <Field group label="Used for"><Segmented value={form.kind} options={KINDS} onChange={v => set({ kind: v })} /></Field>
      <Field group label="How it is connected">
        <Segmented value={form.connection} options={CONNECTIONS} onChange={v => set({ connection: v })} />
      </Field>
      {onNetwork ? (
        <>
          <p className="text-xs text-muted-foreground">An Epson (or other ESC/POS) printer with a network cable or Wi-Fi. The venue hub prints to it: link one under Venue hub.</p>
          <div className="flex flex-wrap gap-4">
            <Field label="IP address" hint="Give the printer a fixed address on the router.">
              <input className={cn(inputCls, 'w-48')} value={form.host} maxLength={120} onChange={e => set({ host: e.target.value })} placeholder="192.168.1.50" inputMode="decimal" data-testid="printer-host" />
            </Field>
            <Field label="Port"><NumberBox value={form.port} max={65535} min={1} onChange={v => set({ port: v })} ariaLabel="Port" /></Field>
          </div>
          <Field label="Backup printer" hint="The hub prints here when this one doesn't answer.">
            <select className={inputCls} value={form.backup_printer_id} onChange={e => set({ backup_printer_id: e.target.value })}>
              <option value="">None</option>
              {setup.printers.filter(p => p.id !== printer?.id && p.connection !== 'device').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field label="Plugged into" hint="USB or Bluetooth, set up as the device's printer. That device prints its tickets through Chrome: start Chrome with --kiosk-printing so it prints without asking.">
            <select className={inputCls} value={form.device_id} onChange={e => set({ device_id: e.target.value })} data-testid="printer-device">
              <option value="">Pick a device</option>
              {devices.map(d => <option key={d.id} value={d.id}>{DEVICE_KINDS[d.kind]}: {d.name}</option>)}
            </select>
          </Field>
          {!devices.length && <p className="text-xs text-amber-700">Add the till or kitchen screen first (Tills or Kitchen screens tab).</p>}
          {setup.devices.find(d => d.id === form.device_id)?.kind === 'kiosk' && (
            <p className="text-xs text-muted-foreground">A kiosk's printer prints that kiosk's receipts only.</p>
          )}
        </>
      )}
      <Field label="Characters per line" hint="80mm paper: 42 (48 on some); 58mm: 32.">
        <NumberBox value={form.columns} min={24} max={64} onChange={v => set({ columns: v })} ariaLabel="Characters per line" />
      </Field>
      {printer && <Toggle label="In use" checked={form.is_active} onChange={v => set({ is_active: v })} />}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** The last day's tickets for a printer, with Print again for those that didn't print. */
function TicketsModal({ venueId, printer, canManage, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const jobs = useQuery({
    queryKey: ['pos-print-jobs', venueId],
    queryFn: () => api.get(`/pos/venues/${venueId}/print-jobs`),
    refetchInterval: 5000,
  })
  const again = useMutation({
    mutationFn: id => api.post(`/pos/print-jobs/${id}/again`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos-print-jobs', venueId] }); qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }) },
  })
  const list = (jobs.data || []).filter(j => j.printer_id === printer.id).slice(0, 40)
  const WORDS = { queued: 'Waiting', printing: 'Printing', printed: 'Printed', failed: 'Didn\'t print', cancelled: 'Cancelled' }
  return (
    <Modal title={'Tickets for ' + printer.name} onClose={onClose} footer={<Btn className="flex-1" onClick={onClose}>Close</Btn>}>
      {jobs.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {jobs.error && <ErrorNote error={jobs.error} />}
      {!jobs.isLoading && !list.length && !jobs.error && <p className="text-sm text-muted-foreground">No tickets yet.</p>}
      {!!list.length && (
        <div className="rounded-xl border divide-y" data-testid="printer-tickets">
          {list.map(j => (
            <div key={j.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{j.title || j.kind}</p>
                <p className={cn('text-xs', j.status === 'failed' ? 'text-red-700' : 'text-muted-foreground')}>
                  {WORDS[j.status] || j.status} · {ago(j.created_at)}{j.error ? ' · ' + j.error : ''}
                </p>
              </div>
              {canManage && ['failed', 'cancelled'].includes(j.status) && (
                <Btn onClick={() => again.mutate(j.id)} disabled={again.isPending} data-testid="print-again"><RotateCcw className="w-4 h-4" /> Print again</Btn>
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={again.error} />
    </Modal>
  )
}

function HubModal({ venueId, setup, hub, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState(hub?.name || 'Venue hub')
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => hub ? api.patch(`/pos/devices/${hub.id}`, { name: name.trim() }) : linkShownCode(api, venueId, 'hub', code, { name: name.trim() }),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/devices/${hub.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={hub ? 'Edit ' + hub.name : 'Link a venue hub'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!name.trim() || (!hub && !codeReady(code)) || save.isPending} onClick={() => save.mutate()} data-testid="hub-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {hub ? 'Save' : 'Link the hub'}
        </Btn>
        {hub && <ConfirmDelete label="Remove hub" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!hub && <ShownCodeField setup={setup} kind="hub" value={code} onChange={setCode} autoFocus />}
      <Field label="Name"><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} data-testid="hub-name" /></Field>
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export default function PrintersSection({ venueId, setup, canManage }) {
  const [editing, setEditing] = useState(null)
  const [tickets, setTickets] = useState(null)
  const [hubEditing, setHubEditing] = useState(null)
  const [linking, setLinking] = useState(null)
  const hubs = setup.devices.filter(d => d.kind === 'hub' && !d.revoked_at)
  const needsHub = setup.printers.some(p => p.is_active && p.connection !== 'device')
  return (
    <>
      <Section title="Printers"
        hint="Kitchen tickets print where the kitchen flow sends dishes: add a Kitchen printer box in Kitchen screens > Kitchen flow. Bills and receipts print on each till's receipt printer (Tills > Edit), or in the till's own browser when it has none."
        actions={<Btn variant="primary" onClick={() => setEditing('new')} data-testid="printer-add"><Plus className="w-4 h-4" /> Add</Btn>}>
        {!setup.printers.length
          ? <p className="text-sm text-muted-foreground">No printers yet.</p>
          : (
            <div className="rounded-xl border divide-y">
              {setup.printers.map(p => {
                const [text, tone] = printerState(p, setup)
                const jobs = p.jobs || { waiting: 0, failed: 0 }
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="printer-row">
                    <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0"><Printer className="w-5 h-5" /></span>
                    <div className="flex-1 min-w-[160px]">
                      <p className={cn('text-sm font-medium', !p.is_active && 'line-through text-muted-foreground')}>{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.kind === 'receipt' ? 'Receipts' : 'Kitchen / bar'} · {p.connection === 'device' ? 'plugged into a device' : (p.host ? p.host + ':' + p.port : 'no address yet')} · {p.columns} characters
                        {p.backup_printer_id && ' · backup ' + (setup.printers.find(x => x.id === p.backup_printer_id)?.name || '')}
                      </p>
                      <p className={cn('text-xs', TONE[tone])} data-testid="printer-state">{text}</p>
                      {(jobs.waiting > 0 || jobs.failed > 0) && (
                        <p className="text-xs" data-testid="printer-jobs">
                          {jobs.waiting > 0 && <span className="text-amber-700">{jobs.waiting} waiting to print</span>}
                          {jobs.waiting > 0 && jobs.failed > 0 && ' · '}
                          {jobs.failed > 0 && <span className="text-red-700">{jobs.failed} didn&apos;t print</span>}
                        </p>
                      )}
                    </div>
                    {/* A span: the Till setup page is a disabled fieldset for View users, who may still look. */}
                    <span role="button" tabIndex={0} onClick={() => setTickets(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTickets(p) } }}
                      className="h-12 px-3 rounded-lg border text-sm font-medium inline-flex items-center touch-manipulation cursor-pointer hover:bg-accent"
                      title={'Tickets for ' + p.name} data-testid="printer-tickets-open">Tickets</span>
                    <Btn onClick={() => setEditing(p)} title={'Edit ' + p.name}><Pencil className="w-4 h-4" /></Btn>
                  </div>
                )
              })}
            </div>
          )}
        {editing && <PrinterModal venueId={venueId} setup={setup} printer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
        {tickets && <TicketsModal venueId={venueId} printer={tickets} canManage={canManage} onClose={() => setTickets(null)} />}
      </Section>
      <Section title="Venue hub"
        hint="A small program on a PC (or a mini PC) on the venue's network, next to the printers. It prints to the network printers and tells you how they are. Run it, and it shows a six-letter code: link it here."
        actions={<Btn variant="primary" onClick={() => setHubEditing('new')} data-testid="hub-add"><Plus className="w-4 h-4" /> Link a hub</Btn>}>
        {!hubs.length && (
          <div className={cn('text-sm flex items-start gap-3', needsHub ? 'text-amber-700' : 'text-muted-foreground')}>
            <Server className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{needsHub ? 'Network printers print only through a venue hub: tickets for them wait until one is linked.' : 'No hub yet. Only needed for printers on the network.'}</p>
          </div>
        )}
        {!!hubs.length && (
          <div className="rounded-xl border divide-y">
            {hubs.map(d => {
              const st = status(d)
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="hub-row">
                  <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : 'text-amber-700')}>{st.text}{d.app_version ? ' · version ' + d.app_version : ''}</p>
                  </div>
                  <LinkDeviceButton device={d} onClick={() => setLinking(d)} />
                  <Btn onClick={() => setHubEditing(d)} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /></Btn>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">To run it: install Node.js 22 on the PC, copy the hub folder onto it and run <span className="font-mono">node hub/bin/hub.js</span> (it starts again by itself if set up as a service). It needs the internet and the printers&apos; network.</p>
        {hubEditing && <HubModal venueId={venueId} setup={setup} hub={hubEditing === 'new' ? null : hubEditing} onClose={() => setHubEditing(null)} />}
        {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
      </Section>
    </>
  )
}
