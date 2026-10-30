// src/components/pos/PrintersSection.jsx
//
// Store tech > Printers (migration 191): the venue's printers and who prints
// for them. A network printer (an address on the venue's network) is
// printed by the venue hub, a small program on a mini PC by the printers
// (hub/, installed by one command, linked by the code it shows). A USB
// printer plugged into the hub's own computer is printed by the hub too
// (migration 195: connection 'device', device_id = the hub, local_id = which
// of the printers it found). A printer plugged into a till, kitchen screen
// or kiosk is printed by that device's browser. Kitchen
// tickets go where the kitchen flow sends dishes: a Kitchen printer box in
// Kitchen screens > Kitchen flow. Bills and receipts go to each device's
// receipt printer (Tills > Edit), or print in the device's own browser.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, Server, RotateCcw, Printer, Copy, Check, Download, Usb, ExternalLink } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle, ago } from './shared'
import { ShownCodeField, LinkDeviceModal, LinkDeviceButton, linkShownCode, codeReady, status, ReusePick, defaultReuse, reuseLabel, RemovedDevices } from './TillsSection'

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
const liveHubs = setup => setup.devices.filter(d => d.kind === 'hub' && !d.revoked_at)
/** Is this printer plugged into a venue hub's computer? */
export const onHub = (p, setup) => p.connection === 'device' && setup.devices.find(d => d.id === p.device_id)?.kind === 'hub'
/** The hub a new USB printer starts on: one that found USB printers, else the first. */
const defaultHub = hubs => (hubs.find(h => h.info?.local_printers?.length) || hubs[0])?.id || ''
/** The hub has been heard from in the last few minutes. */
const hubOnline = d => !!d?.paired && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60_000

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
  if (!hubs.length) return ['Waiting for a venue hub: link one below', 'warn']
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

const TONE = { ok: 'text-green-700', warn: 'text-amber-700', bad: 'text-red-700', muted: 'text-muted-foreground' }

function PrinterModal({ venueId, setup, printer, preset, onClose }) {
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
          <p className="text-xs text-muted-foreground">An Epson (or other ESC/POS) printer with a network cable or Wi-Fi. The venue hub prints to it: link one under Venue hub.</p>
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
  if (!hubs.length) return <p className="text-sm text-amber-700">Link a venue hub first (Venue hub, below), then plug the printer into its computer.</p>
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

function HubModal({ venueId, setup, hub, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [reuseId, setReuseId] = useState(() => hub ? null : defaultReuse(setup, 'hub'))
  const [name, setName] = useState(hub?.name || 'Venue hub')
  const [autoUpdate, setAutoUpdate] = useState(hub ? hub.settings?.auto_update !== false : true)
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => hub
      ? api.patch(`/pos/devices/${hub.id}`, { name: name.trim(), settings: { ...(hub.settings || {}), auto_update: autoUpdate } })
      : linkShownCode(api, venueId, 'hub', code, reuseId ? { device_id: reuseId } : { name: name.trim(), settings: { auto_update: autoUpdate } }),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/devices/${hub.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={hub ? 'Edit ' + hub.name : 'Link a venue hub'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={(!reuseId && !name.trim()) || (!hub && !codeReady(code)) || save.isPending} onClick={() => save.mutate()} data-testid="hub-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {hub ? 'Save' : reuseId ? reuseLabel(setup, reuseId) : 'Link the hub'}
        </Btn>
        {hub && <ConfirmDelete label="Remove hub" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!hub && <ShownCodeField setup={setup} kind="hub" value={code} onChange={setCode} autoFocus />}
      {!hub && <p className="text-xs text-muted-foreground">The code shows when the installer finishes, and on the hub's own page (http://&lt;its address&gt;:9180) with a QR code for the installer app.</p>}
      {!hub && <ReusePick setup={setup} kind="hub" value={reuseId} onChange={setReuseId} />}
      {!reuseId && <>
        <Field label="Name"><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} data-testid="hub-name" /></Field>
        <Toggle label="Update by itself" hint="It installs a new version at a quiet moment (nothing printing), and goes back to the one before if the new one doesn't run. Off: it waits for Update now." checked={autoUpdate} onChange={setAutoUpdate} />
      </>}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** The command that installs (or updates) the hub on a mini PC, with Copy. */
/** A copy button that says Copied for two seconds. */
function CopyButton({ text, title, testid }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the text is on screen to copy by hand */ }
  }
  return <Btn onClick={copy} title={title} data-testid={testid}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</Btn>
}

function InstallCommands({ setup }) {
  const api = (setup.device_urls?.terminal || setup.till_url || '').replace(/\/+$/, '')
  const page = api + '/hub'
  const [os, setOs] = useState('windows')
  const cmd = os === 'linux'
    ? `curl -fsSL ${api}/pos-api/hub/install.sh | sudo sh`
    : `irm ${api}/pos-api/hub/install.ps1 | iex`
  const link = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border text-sm hover:bg-accent touch-manipulation'
  return (
    <div className="rounded-xl border p-3 space-y-3" data-testid="hub-install">
      <div className="flex items-center gap-3">
        <Download className="w-4 h-4 shrink-0" />
        <p className="text-sm font-medium flex-1">Set up a hub on a mini PC</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">On the mini PC, with the internet on, open this address in its browser and download the installer:</p>
        <div className="flex items-stretch gap-2">
          <code className="flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-sm font-mono font-semibold break-all select-all" data-testid="hub-install-page">{page.replace(/^https?:\/\//, '')}</code>
          <CopyButton text={page} title="Copy the address" testid="hub-install-page-copy" />
        </div>
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
          <span>On the mini PC already?</span>
          <a className={link} href={api + '/pos-api/hub/setup.cmd'} download data-testid="hub-download-windows"><Download className="w-4 h-4" /> Windows installer</a>
          <a className={link} href={api + '/pos-api/hub/setup.sh'} download data-testid="hub-download-linux"><Download className="w-4 h-4" /> Linux installer</a>
        </p>
      </div>
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer touch-manipulation min-h-[32px] flex items-center">Or run a command</summary>
        <div className="space-y-2 pt-1">
          <Segmented value={os} options={[{ value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }]} onChange={setOs} />
          <p className="text-xs text-muted-foreground">
            {os === 'linux'
              ? 'On the mini PC (Ubuntu or Debian), open a terminal and run:'
              : 'On the mini PC (Windows 10 or 11), open PowerShell as administrator and run:'}
          </p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-xs font-mono break-all select-all" data-testid="hub-install-command">{cmd}</code>
            <CopyButton text={cmd} title="Copy the command" testid="hub-install-copy" />
          </div>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">
        It installs the hub as a service that starts with the computer, then shows a code: link it here with Link a hub.
        Running it again updates the hub and keeps its link. Help → Till → Venue hub has the details.
      </p>
    </div>
  )
}

/** A hub's version and updates, in words: [text, tone]. */
function updateState(d, latest) {
  const u = d.info?.update || {}
  if (!d.app_version) return ['Version not known yet', 'muted']
  if (!latest || d.app_version === latest) return ['Up to date (' + d.app_version + ')', 'ok']
  if (u.updates === 'manual') return ['Version ' + d.app_version + ' · ' + latest + ' is out: this copy updates by hand (install it again)', 'warn']
  if (u.state === 'failed') return ['Update to ' + latest + ' failed: ' + (u.error || 'it tries again in half an hour'), 'bad']
  if (u.state === 'held_back') return ['Went back to ' + d.app_version + ': ' + latest + ' kept stopping. Update now tries it again', 'bad']
  if (d.update_requested_at) return ['Updating to ' + latest + ' at the next quiet moment', 'warn']
  if (d.settings?.auto_update === false) return ['Version ' + d.app_version + ' · ' + latest + ' is out', 'warn']
  return ['Version ' + d.app_version + ' · updating to ' + latest + ' at the next quiet moment', 'warn']
}

function HubRow({ venueId, setup, hub: d, canManage, onEdit, onLink, onAddPrinter }) {
  const api = useApi()
  const qc = useQueryClient()
  const st = status(d)
  const info = d.info || {}
  const latest = setup.hub_release?.version || null
  const [utext, utone] = updateState(d, latest)
  const update = useMutation({
    mutationFn: () => api.post(`/pos/devices/${d.id}/update`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const found = info.local_printers || []
  const setUp = new Set(setup.printers.filter(p => onHub(p, setup) && p.device_id === d.id).map(p => p.local_id))
  const pages = info.status_port ? (info.addresses || []).map(a => `http://${a}:${info.status_port}`) : []
  const canUpdate = latest && d.app_version && d.app_version !== latest && info.update?.updates !== 'manual' && !d.update_requested_at
  return (
    <div className="px-3 py-2 space-y-2" data-testid="hub-row">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
        <div className="flex-1 min-w-[160px]">
          <p className="text-sm font-medium">{d.name}</p>
          <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : 'text-amber-700')}>{st.text}</p>
          <p className={cn('text-xs', TONE[utone])} data-testid="hub-update">{utext}</p>
        </div>
        {canManage && canUpdate && (
          <Btn onClick={() => update.mutate()} disabled={update.isPending} data-testid="hub-update-now">
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Update now
          </Btn>
        )}
        <LinkDeviceButton device={d} onClick={onLink} />
        <Btn onClick={onEdit} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /></Btn>
      </div>
      {d.info && (
        <div className="pl-14 space-y-1 text-xs text-muted-foreground" data-testid="hub-info">
          <p>{[info.hostname, info.os, info.arch].filter(Boolean).join(' · ')}{d.info_at ? ' · reported ' + ago(d.info_at) : ''}</p>
          {!!pages.length && (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Its page (on the venue's network):</span>
              {pages.map(u => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline text-foreground" data-testid="hub-page">{u.replace('http://', '')}<ExternalLink className="w-3 h-3" /></a>)}
            </p>
          )}
          {info.mirror && <HubFirstLine m={info.mirror} hubFirst={setup.settings?.hub_first !== false} />}
          <p>{found.length ? 'USB printers plugged into it:' : 'No USB printers plugged into it.'}</p>
          {found.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-2" data-testid="hub-found-printer">
              <Usb className="w-3.5 h-3.5 shrink-0" />
              <span className="text-foreground">{p.name}</span>
              {setUp.has(p.id)
                ? <span className="text-green-700">set up</span>
                : canManage && <button type="button" onClick={() => onAddPrinter({ connection: 'hub_usb', device_id: d.id, local_id: p.id, name: p.name })}
                    className="h-9 px-3 rounded-lg border text-xs font-medium bg-background hover:bg-muted touch-manipulation" data-testid="hub-found-add">Add it</button>}
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={update.error} />
    </div>
  )
}

// Hub first (migration 218, docs/POS.md section 11): what the hub's copy of
// the venue is doing, from its last report.
function HubFirstLine({ m, hubFirst }) {
  // The switch wins: the hub's report may be up to a minute old.
  if (!hubFirst) return <p data-testid="hub-first-state">Hub first is off: devices send to the cloud, the hub only prints.</p>
  if (!m.on) return <p data-testid="hub-first-state">Hub first: standing by (another hub takes the venue&apos;s events, or it hasn&apos;t loaded the venue yet).</p>
  const parts = [
    m.devices + (m.devices === 1 ? ' device' : ' devices') + ' using it',
    m.to_send ? m.to_send + ' changes waiting to go to the cloud' : 'everything sent to the cloud',
  ]
  if (m.last_upload_at) parts.push('last sent ' + ago(m.last_upload_at))
  return (
    <>
      <p data-testid="hub-first-state" className="text-foreground">Hub first: takes the venue&apos;s events · {parts.join(' · ')}</p>
      {m.conflicts > 0 && <p className="text-red-700" data-testid="hub-first-conflicts">{m.conflicts} change{m.conflicts === 1 ? '' : 's'} the cloud refused: the till that made {m.conflicts === 1 ? 'it' : 'them'} lists {m.conflicts === 1 ? 'it' : 'them'} under Not saved.</p>}
      {m.error && <p className="text-amber-700">Last problem: {m.error}</p>}
    </>
  )
}

/** The location's Hub first switch, with its own Save. */
function HubFirstSetting({ venueId, setup, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const saved = setup.settings?.hub_first !== false
  const [on, setOn] = useState(saved)
  const save = useMutation({
    mutationFn: () => api.patch(`/pos/venues/${venueId}/settings`, { hub_first: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  return (
    <div className="rounded-xl border p-3 space-y-2" data-testid="hub-first">
      <Toggle checked={on} disabled={!canManage} onChange={setOn}
        label="Hub first: tills, kiosks, kitchen screens and order ready boards use the hub"
        hint="They send their orders to the hub on the venue network and the hub sends everything to the cloud, so the location keeps trading, printing and sharing orders between devices with the internet down. Needs the Macaroonie Android app on the devices (a browser can't call the hub from a secure page). Off: every device uses the cloud and the hub only prints." />
      {canManage && on !== saved && (
        <div className="flex gap-2">
          <Btn variant="primary" onClick={() => save.mutate()} disabled={save.isPending} data-testid="hub-first-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </Btn>
          <Btn onClick={() => setOn(saved)}>Cancel</Btn>
        </div>
      )}
      <ErrorNote error={save.error} />
    </div>
  )
}

export default function PrintersSection({ venueId, setup, canManage }) {
  const [editing, setEditing] = useState(null)
  const [preset, setPreset] = useState(null)
  const [tickets, setTickets] = useState(null)
  const [hubEditing, setHubEditing] = useState(null)
  const [linking, setLinking] = useState(null)
  const hubs = liveHubs(setup)
  const needsHub = setup.printers.some(p => p.is_active && p.connection !== 'device')
  const where = p => {
    if (onHub(p, setup)) return 'USB on ' + (setup.devices.find(d => d.id === p.device_id)?.name || 'the hub')
    if (p.connection === 'device') return 'plugged into ' + (setup.devices.find(d => d.id === p.device_id)?.name || 'a device')
    return p.host ? p.host + ':' + p.port : 'no address yet'
  }
  return (
    <>
      <Section title="Printers"
        hint="Kitchen tickets print where the kitchen flow sends dishes: add a Kitchen printer box in Kitchen screens > Kitchen flow. Bills and receipts print on each till's receipt printer (Tills > Edit), or in the till's own browser when it has none."
        actions={<Btn variant="primary" onClick={() => { setPreset(null); setEditing('new') }} data-testid="printer-add"><Plus className="w-4 h-4" /> Add</Btn>}>
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
                    <Btn onClick={() => { setPreset(null); setEditing(p) }} title={'Edit ' + p.name}><Pencil className="w-4 h-4" /></Btn>
                  </div>
                )
              })}
            </div>
          )}
        {editing && <PrinterModal venueId={venueId} setup={setup} printer={editing === 'new' ? null : editing} preset={preset} onClose={() => { setEditing(null); setPreset(null) }} />}
        {tickets && <TicketsModal venueId={venueId} printer={tickets} canManage={canManage} onClose={() => setTickets(null)} />}
      </Section>
      <Section title="Venue hub"
        hint="A small program on a mini PC on the venue's network, next to the printers. It prints to the network printers and the USB printers plugged into it, tells you how they are, and updates itself. With Hub first on, the location's devices also trade through it, so the venue keeps going with the internet down. Install it with the command below; it shows a six-letter code: link it here."
        actions={<Btn variant="primary" onClick={() => setHubEditing('new')} data-testid="hub-add"><Plus className="w-4 h-4" /> Link a hub</Btn>}>
        {!hubs.length && (
          <div className={cn('text-sm flex items-start gap-3', needsHub ? 'text-amber-700' : 'text-muted-foreground')}>
            <Server className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{needsHub ? 'Network printers print only through a venue hub: tickets for them wait until one is linked.' : 'No hub yet. Needed for network printers, and for USB printers by a mini PC.'}</p>
          </div>
        )}
        {!!hubs.length && (
          <div className="rounded-xl border divide-y">
            {hubs.map(d => (
              <HubRow key={d.id} venueId={venueId} setup={setup} hub={d} canManage={canManage}
                onEdit={() => setHubEditing(d)} onLink={() => setLinking(d)}
                onAddPrinter={p => { setPreset(p); setEditing('new') }} />
            ))}
          </div>
        )}
        <HubFirstSetting key={String(setup.settings?.hub_first !== false)} venueId={venueId} setup={setup} canManage={canManage} />
        <RemovedDevices devices={setup.devices.filter(d => d.kind === 'hub' && d.revoked_at)} onBringBack={setLinking} />
        <InstallCommands setup={setup} />
        {hubEditing && <HubModal venueId={venueId} setup={setup} hub={hubEditing === 'new' ? null : hubEditing} onClose={() => setHubEditing(null)} />}
        {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
      </Section>
    </>
  )
}
