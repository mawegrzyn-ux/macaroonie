// src/components/pos/HubSection.jsx
//
// Store tech > Venue hub (/pos/hub): the venue's hubs, each a small program
// on a mini PC on the venue network (hub/; migrations 191, 195, 218). It
// prints the network printers and the USB printers plugged into it, updates
// itself, and with Hub first on (pos_settings.hub_first) the location's
// tills, kiosks, kitchen screens and order ready boards trade through it,
// with the internet down too (docs/POS.md section 11). Here: link a hub by
// the code it shows (or bring a removed one back), its state, version and
// updates, the USB printers it found (Add it opens the printer window from
// PrintersSection.jsx), the Hub first switch, and how to install one.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, Server, Copy, Check, Download, Usb, ExternalLink } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, Toggle, ago } from './shared'
import { ShownCodeField, LinkDeviceModal, LinkDeviceButton, linkShownCode, codeReady, status, ReusePick, defaultReuse, reuseLabel, RemovedDevices } from './TillsSection'
import { PrinterModal, liveHubs, onHub, TONE } from './PrintersSection'

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

/** A copy button that says Copied for two seconds. */
function CopyButton({ text, title, testid }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the text is on screen to copy by hand */ }
  }
  return <Btn onClick={copy} title={title} data-testid={testid}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</Btn>
}

/** How to set up a hub on a mini PC: the address, the downloads and the commands. */
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
        Running it again updates the hub and keeps its link. Help → Set up the venue hub on a mini PC has the details.
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

export default function HubSection({ venueId, setup, canManage }) {
  const [hubEditing, setHubEditing] = useState(null)
  const [linking, setLinking] = useState(null)
  const [printer, setPrinter] = useState(null)
  const hubs = liveHubs(setup)
  const needsHub = setup.printers.some(p => p.is_active && p.connection !== 'device')
  return (
    <Section title="Venue hub"
      hint="A small program on a mini PC on the venue's network. It prints to the network printers and the USB printers plugged into it, tells you how they are, and updates itself. With Hub first on, the location's tills, kiosks, kitchen screens and order ready boards also trade through it, so the venue keeps going with the internet down. Install it as shown below; it shows a six-letter code: link it here."
      actions={<Btn variant="primary" onClick={() => setHubEditing('new')} data-testid="hub-add"><Plus className="w-4 h-4" /> Link a hub</Btn>}>
      {!hubs.length && (
        <div className={cn('text-sm flex items-start gap-3', needsHub ? 'text-amber-700' : 'text-muted-foreground')}>
          <Server className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{needsHub ? 'Network printers print only through a venue hub: tickets for them wait until one is linked.' : 'No hub yet. Needed for network printers, USB printers by a mini PC, and for trading with the internet down (Hub first).'}</p>
        </div>
      )}
      {!!hubs.length && (
        <div className="rounded-xl border divide-y">
          {hubs.map(d => (
            <HubRow key={d.id} venueId={venueId} setup={setup} hub={d} canManage={canManage}
              onEdit={() => setHubEditing(d)} onLink={() => setLinking(d)}
              onAddPrinter={setPrinter} />
          ))}
        </div>
      )}
      <HubFirstSetting key={String(setup.settings?.hub_first !== false)} venueId={venueId} setup={setup} canManage={canManage} />
      <RemovedDevices devices={setup.devices.filter(d => d.kind === 'hub' && d.revoked_at)} onBringBack={setLinking} />
      <InstallCommands setup={setup} />
      {hubEditing && <HubModal venueId={venueId} setup={setup} hub={hubEditing === 'new' ? null : hubEditing} onClose={() => setHubEditing(null)} />}
      {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
      {printer && <PrinterModal venueId={venueId} setup={setup} printer={null} preset={printer} onClose={() => setPrinter(null)} />}
    </Section>
  )
}
