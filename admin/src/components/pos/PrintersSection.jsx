// src/components/pos/PrintersSection.jsx
//
// Store tech > Printers (migration 191): the venue's printers and who prints
// for them. A network printer (an address on the venue's network) is
// printed by the venue hub, a small program on a mini PC by the printers
// (hub/; installed, linked and watched on its own page, Store tech > Venue
// hub, HubSection.jsx). A USB
// printer plugged into the hub's own computer is printed by the hub too
// (migration 195: connection 'device', device_id = the hub, local_id = which
// of the printers it found). A printer plugged into a till, kitchen screen
// or kiosk is printed by that device's browser. Kitchen
// tickets go where the kitchen flow sends dishes: a Kitchen printer box in
// Kitchen screens > Kitchen flow. Bills and receipts go to each device's
// receipt printer (Tills > Edit), or print in the device's own browser.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, Server, RotateCcw, Printer, Usb, ChevronRight, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle, ago } from './shared'

const KINDS = [
  { value: 'station', label: 'Kitchen / bar' },
  { value: 'receipt', label: 'Receipts' },
]
// 'hub_usb' is the form's own word for connection 'device' + a venue hub.
const CONNECTIONS = [
  { value: 'hub', label: 'On the network' },
  { value: 'hub_usb', label: 'USB on the hub' },
  { value: 'device', label: 'Plugged into a till or screen' },
]
const DEVICE_KINDS = { terminal: 'Till', kds: 'Kitchen screen', kiosk: 'Kiosk' }

/** The devices a printer can be plugged into (the hub has its own option). */
const plugDevices = setup => setup.devices.filter(d => !d.revoked_at && DEVICE_KINDS[d.kind])
export const liveHubs = setup => setup.devices.filter(d => d.kind === 'hub' && !d.revoked_at)
/** Is this printer plugged into a venue hub's computer? */
export const onHub = (p, setup) => p.connection === 'device' && setup.devices.find(d => d.id === p.device_id)?.kind === 'hub'
/** The hub a new USB printer starts on: one that found USB printers, else the first. */
const defaultHub = hubs => (hubs.find(h => h.info?.local_printers?.length) || hubs[0])?.id || ''
/** The hub has been heard from in the last few minutes. */
export const hubOnline = d => !!d?.paired && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60_000

/** What we know about a printer, in a few words: [text, tone]. */
export function printerState(p, setup) {
  if (!p.is_active) return ['Switched off', 'muted']
  if (onHub(p, setup)) {
    const hub = setup.devices.find(d => d.id === p.device_id)
    if (hub.revoked_at) return [hub.name + ' was removed: pick another hub', 'warn']
    if (!p.local_id) return ['Pick which printer on the hub this is', 'warn']
    if (!hubOnline(hub)) return [hub.name + (hub.paired ? ' is offline (seen ' + ago(hub.last_seen_at) + ')' : ' isn\'t linked yet'), 'warn']
    return hubPrinterState(p)
  }
  if (p.connection === 'device') {
    const d = setup.devices.find(x => x.id === p.device_id)
    if (!d) return ['Pick the till, kitchen screen or kiosk it is plugged into', 'warn']
    if (d.revoked_at) return [d.name + ' was removed: pick another device', 'warn']
    return ['Printed by ' + d.name + (d.paired ? ', seen ' + ago(d.last_seen_at) : ' (not linked yet)'), d.paired ? 'ok' : 'warn']
  }
  const hubs = liveHubs(setup)
  if (!p.host) return ['Type its address on the network', 'warn']
  if (!hubs.length) return ['Waiting for a venue hub: link one on the Venue hub page', 'warn']
  return hubPrinterState(p)
}

/** What the hub last said about a printer it prints to. */
function hubPrinterState(p) {
  const s = p.status
  if (!s || !p.status_at) return ['The hub hasn\'t checked it yet', 'muted']
  const when = ' (' + ago(p.status_at) + ')'
  if (!s.online) return ['Not answering' + (s.error ? ': ' + s.error : '') + when, 'bad']
  if (s.paper_out) return ['Out of paper' + when, 'bad']
  if (s.cover_open) return ['Cover open' + when, 'bad']
  if (s.paper_low) return ['Paper running low' + when, 'warn']
  return ['Ready' + when, 'ok']
}

export const TONE = { ok: 'text-green-700', warn: 'text-amber-700', bad: 'text-red-700', muted: 'text-muted-foreground' }

export function PrinterModal({ venueId, setup, printer, preset, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const hubs = liveHubs(setup)
  const startOnHub = printer ? onHub(printer, setup) : preset?.connection === 'hub_usb'
  const [form, setForm] = useState({
    name: printer?.name || preset?.name || '', kind: printer?.kind || 'station',
    connection: startOnHub ? 'hub_usb' : (printer?.connection || 'hub'),
    device_id: printer?.device_id || preset?.device_id || (startOnHub ? defaultHub(hubs) : ''),
    local_id: printer?.local_id || preset?.local_id || '',
    host: printer?.host || '', port: printer?.port ?? 9100, columns: printer?.columns ?? 42,
    backup_printer_id: printer?.backup_printer_id || '', is_active: printer ? printer.is_active : true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const onNetwork = form.connection === 'hub'
  const usb = form.connection === 'hub_usb'
  const hubId = usb ? (form.device_id && hubs.some(h => h.id === form.device_id) ? form.device_id : defaultHub(hubs)) : ''
  const body = () => ({
    name: form.name.trim(), kind: form.kind, is_active: form.is_active,
    connection: onNetwork ? 'hub' : 'device',
    host: onNetwork ? (form.host.trim() || null) : null,
    device_id: onNetwork ? null : usb ? hubId || null : (form.device_id || null),
    local_id: usb ? form.local_id || null : null,
    port: form.port || 9100, columns: form.columns || 42,
    backup_printer_id: onNetwork || usb ? (form.backup_printer_id || null) : null,
  })
  const save = useMutation({
    mutationFn: () => printer ? api.patch(`/pos/printers/${printer.id}`, body()) : api.post(`/pos/venues/${venueId}/printers`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/printers/${printer.id}`), onSuccess: () => { refresh(); onClose() } })
  const devices = plugDevices(setup)
  const ready = form.name.trim() && (onNetwork || (usb ? hubId && form.local_id : form.device_id))
  // Backups: printers the hub prints (network, or USB on a hub).
  const backups = setup.printers.filter(p => p.id !== printer?.id && (p.connection !== 'device' || onHub(p, setup)))
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
        <Segmented value={form.connection} options={CONNECTIONS} onChange={v => set({ connection: v, ...(v === 'hub_usb' && !hubs.some(h => h.id === form.device_id) ? { device_id: defaultHub(hubs) } : {}) })} />
      </Field>
      {onNetwork && (
        <>
          <p className="text-xs text-muted-foreground">An Epson (or other ESC/POS) printer with a network cable or Wi-Fi. The venue hub prints to it: link one on the Venue hub page (Store tech).</p>
          <div className="flex flex-wrap gap-4">
            <Field label="IP address" hint="Give the printer a fixed address on the router.">
              <input className={cn(inputCls, 'w-48')} value={form.host} maxLength={120} onChange={e => set({ host: e.target.value })} placeholder="192.168.1.50" inputMode="decimal" data-testid="printer-host" />
            </Field>
            <Field label="Port"><NumberBox value={form.port} max={65535} min={1} onChange={v => set({ port: v })} ariaLabel="Port" /></Field>
          </div>
        </>
      )}
      {usb && <HubPrinterPick setup={setup} hubs={hubs} hubId={hubId} localId={form.local_id}
        selfId={printer?.id} onHub={id => set({ device_id: id, local_id: '' })} onPick={(id, name) => set({ local_id: id, ...(!form.name.trim() && name ? { name } : {}) })} />}
      {(onNetwork || usb) && (
        <Field label="Backup printer" hint="The hub prints here when this one doesn't answer.">
          <select className={inputCls} value={form.backup_printer_id} onChange={e => set({ backup_printer_id: e.target.value })}>
            <option value="">None</option>
            {backups.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {form.connection === 'device' && (
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

/** Which hub, and which of the USB printers it found (from its last report). */
function HubPrinterPick({ setup, hubs, hubId, localId, selfId, onHub: pickHub, onPick }) {
  const hub = hubs.find(h => h.id === hubId)
  if (!hubs.length) return <p className="text-sm text-amber-700">Link a venue hub first (Store tech → Venue hub), then plug the printer into its computer.</p>
  const found = hub?.info?.local_printers || []
  const missing = localId && !found.some(p => p.id === localId)
  const used = new Map(setup.printers.filter(p => p.id !== selfId && onHub(p, setup) && p.device_id === hubId).map(p => [p.local_id, p.name]))
  return (
    <>
      {hubs.length > 1 && (
        <Field label="Which hub">
          <select className={inputCls} value={hubId} onChange={e => pickHub(e.target.value)} data-testid="printer-hub">
            {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
      )}
      <Field group label="Which printer" hint="The printers plugged into the hub's computer, as it last said (every minute). Switch the printer on and plug it in: it shows here within a minute.">
        <div className="space-y-2" data-testid="hub-usb-printers">
          {found.map(p => (
            <button key={p.id} type="button" onClick={() => onPick(p.id, p.name)} data-testid="hub-usb-printer" aria-pressed={localId === p.id}
              className={cn('w-full text-left rounded-lg border px-3 py-2 min-h-[48px] touch-manipulation flex items-center gap-3',
                localId === p.id ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-muted')}>
              <Usb className="w-4 h-4 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{p.name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {[p.path, p.escpos === false ? 'may not be a receipt printer' : null, used.has(p.id) ? 'set up as ' + used.get(p.id) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {localId === p.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
          ))}
          {!found.length && (
            <p className="text-sm text-muted-foreground">
              {hub?.info ? 'The hub hasn\'t found any USB printers.' : 'The hub hasn\'t reported yet: it does once a minute when it is running.'}
            </p>
          )}
          {missing && <p className="text-xs text-amber-700" data-testid="hub-usb-missing">The printer saved here isn't plugged in now ({localId}).</p>}
        </div>
      </Field>
    </>
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

export default function PrintersSection({ venueId, setup, canManage }) {
  const [editing, setEditing] = useState(null)
  const [tickets, setTickets] = useState(null)
  const hubs = liveHubs(setup)
  const needsHub = setup.printers.some(p => p.is_active && p.connection !== 'device')
  const where = p => {
    if (onHub(p, setup)) return 'USB on ' + (setup.devices.find(d => d.id === p.device_id)?.name || 'the hub')
    if (p.connection === 'device') return 'plugged into ' + (setup.devices.find(d => d.id === p.device_id)?.name || 'a device')
    return p.host ? p.host + ':' + p.port : 'no address yet'
  }
  return (
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
                  <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">{onHub(p, setup) ? <Usb className="w-5 h-5" /> : <Printer className="w-5 h-5" />}</span>
                  <div className="flex-1 min-w-[160px]">
                    <p className={cn('text-sm font-medium', !p.is_active && 'line-through text-muted-foreground')}>{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.kind === 'receipt' ? 'Receipts' : 'Kitchen / bar'} · {where(p)} · {p.columns} characters
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
                  {/* A span: the Store tech page is a disabled fieldset for View users, who may still look. */}
                  <span role="button" tabIndex={0} onClick={() => setTickets(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTickets(p) } }}
                    className="h-12 px-3 rounded-lg border text-sm font-medium inline-flex items-center touch-manipulation cursor-pointer hover:bg-accent"
                    title={'Tickets for ' + p.name} data-testid="printer-tickets-open">Tickets</span>
                  <Btn onClick={() => setEditing(p)} title={'Edit ' + p.name}><Pencil className="w-4 h-4" /></Btn>
                </div>
              )
            })}
          </div>
        )}
      <HubNote hubs={hubs} needsHub={needsHub} />
      {editing && <PrinterModal venueId={venueId} setup={setup} printer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {tickets && <TicketsModal venueId={venueId} printer={tickets} canManage={canManage} onClose={() => setTickets(null)} />}
    </Section>
  )
}

/** Who prints the network and USB-on-hub printers, with a link to the Venue hub page. */
function HubNote({ hubs, needsHub }) {
  const online = hubs.filter(hubOnline)
  const text = !hubs.length
    ? (needsHub ? 'Network printers print only through a venue hub: tickets for them wait until one is linked.' : 'Network printers, and USB printers by a mini PC, are printed by a venue hub.')
    : hubs.length === 1
      ? 'Network printers are printed by ' + hubs[0].name + (online.length ? '.' : ', which is offline.')
      : 'Network printers are printed by the venue hub (' + online.length + ' of ' + hubs.length + ' online).'
  const warn = (!hubs.length && needsHub) || (hubs.length && !online.length)
  // A link, not a button: the page is a disabled fieldset for View users, who may still go there.
  return (
    <Link to="/pos/hub" data-testid="printers-hub-link"
      className={cn('flex items-center gap-3 rounded-xl border p-3 min-h-[48px] text-sm hover:bg-accent touch-manipulation', warn ? 'text-amber-700' : 'text-muted-foreground')}>
      <Server className="w-5 h-5 shrink-0" />
      <span className="flex-1">{text}</span>
      <span className="font-medium text-foreground shrink-0 inline-flex items-center">Venue hub <ChevronRight className="w-4 h-4" /></span>
    </Link>
  )
}
