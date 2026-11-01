// src/components/pos/TillsSection.jsx
//
// Store tech > Tills: the tablets and PCs that run the till app. Devices are
// set up one way, the installer's (migration 184): open the device's address
// (pos.<domain> for tills) and it shows a code and a QR code; type the code
// here with a name and settings (Add a till), or scan the QR code with a
// phone (the installer app). Link a device puts a new device on a till that
// is already here; the old device stops. ShownCodeField, LinkDeviceModal and
// linkShownCode() are shared with the Kitchen screens and Kiosks tabs.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, MonitorSmartphone, Link2, Smartphone, RotateCcw } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { installerHref } from '@/lib/hosts'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, ago, NumberBox } from './shared'
import { CardMachinePick, useCardReaders } from './CardMachinesSection'

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

// The kind's devices a code can go on instead of making a new one: not
// linked first (disconnected, never set up), then linked, then removed.
const REUSE_RANK = d => d.revoked_at ? 2 : d.paired ? 1 : 0
export function reusable(setup, kind) {
  return setup.devices.filter(d => d.kind === kind).sort((a, b) => REUSE_RANK(a) - REUSE_RANK(b))
}

/** What an Add window starts on: the kind's one device that isn't linked, when there is exactly one; else a new one. */
export function defaultReuse(setup, kind) {
  const open = setup.devices.filter(d => d.kind === kind && !d.revoked_at && !d.paired)
  return open.length === 1 ? open[0].id : null
}

/** The Add window's save button when the code goes on a device already here. */
export function reuseLabel(setup, id) {
  const d = setup.devices.find(x => x.id === id)
  return d?.revoked_at ? 'Bring back ' + d.name : 'Link as ' + (d?.name || 'it')
}

const reuseState = d => d.revoked_at
  ? { text: 'Removed: comes back with its settings', tone: 'muted' }
  : d.paired ? { text: (d.last_seen_at ? 'Linked · seen ' + ago(d.last_seen_at) : 'Linked') + ': that device stops', tone: 'ok' }
    : { text: 'Not linked', tone: 'warn' }

/**
 * In an Add window, under the code: a new till (kitchen screen, kiosk, hub)
 * or one already here, which then keeps its name, settings and short code.
 * value = the device's id, or null for a new one.
 */
export function ReusePick({ setup, kind, value, onChange }) {
  const list = reusable(setup, kind)
  if (!list.length) return null
  const what = KIND_WORDS[kind]
  const picked = list.find(d => d.id === value)
  return (
    <div className="space-y-2" data-testid="reuse-pick">
      <Field group label="Link it as">
        <Segmented value={value ? 'reuse' : 'new'} onChange={v => onChange(v === 'new' ? null : list[0].id)} options={[
          { value: 'new', label: 'A new ' + what },
          { value: 'reuse', label: 'One already here' },
        ]} />
      </Field>
      {value && (
        <div className="rounded-xl border divide-y" role="group" aria-label={'Which ' + what}>
          {list.map(d => {
            const st = reuseState(d)
            return (
              <button key={d.id} type="button" onClick={() => onChange(d.id)} aria-pressed={d.id === value} data-testid="reuse-row"
                className={cn('w-full flex items-center gap-3 px-3 min-h-[52px] text-left touch-manipulation',
                  d.id === value ? 'bg-primary/10 ring-2 ring-inset ring-primary' : 'bg-background hover:bg-muted')}>
                <span className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{d.name}</span>
                  <span className={cn('block text-xs', st.tone === 'ok' ? 'text-green-700' : st.tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{st.text}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {picked && (
        <p className="text-xs text-muted-foreground" data-testid="reuse-note">
          {picked.revoked_at
            ? `${picked.name} comes back with its name, short code and settings; any setting pointing at something deleted since (a printer, a card machine, a station) is cleared.`
            : picked.paired
              ? `It keeps the name ${picked.name} and its settings. The device ${picked.name} is on now stops working.`
              : `It keeps the name ${picked.name} and its settings.`}
        </p>
      )}
    </div>
  )
}

/** The removed devices of a list, each with Bring back (a code it then shows links it again). */
export function RemovedDevices({ devices, onBringBack }) {
  if (!devices.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="removed-devices">
      <span>Removed:</span>
      {devices.map(d => (
        <button key={d.id} type="button" onClick={() => onBringBack(d)} data-testid="bring-back"
          className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg border bg-background hover:bg-muted touch-manipulation text-foreground">
          <RotateCcw className="w-3.5 h-3.5" /> {d.name} ({d.short_code})
        </button>
      ))}
    </div>
  )
}

/**
 * Link a device to a till, kitchen screen or kiosk already here: one that
 * isn't linked (new, disconnected), a replacement for a broken one, or one
 * removed earlier (brought back). It keeps its name and settings; the device
 * it was on stops working.
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
    <Modal title={(device.revoked_at ? 'Bring back ' : device.paired ? 'New device for ' : 'Link a device to ') + device.name} onClose={onClose}
      footer={<>
        <Btn className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" className="flex-1" disabled={!codeReady(code) || link.isPending} onClick={() => link.mutate()} data-testid="link-device-submit">
          {link.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device.revoked_at ? 'Bring it back' : 'Link it'}
        </Btn>
      </>}>
      <p className="text-sm text-muted-foreground">
        {device.revoked_at
          ? `${device.name} comes back with its name, short code and settings on the device showing the code; any setting pointing at something deleted since (a printer, a card machine, a station) is cleared.`
          : device.paired
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

/**
 * A till's or kiosk's own counter order numbers (migration 217): every device
 * numbers its own orders from its range, so two never give out the same
 * number, even offline. A device being added gets the next free block of a
 * hundred; afterwards it can be changed here. The API refuses a range another
 * device of the location uses.
 */
export function orderRangeOf(device) {
  const r = device?.settings?.order_numbers
  return { from: r?.from ?? null, to: r?.to ?? null }
}
export const orderRangeReady = r => Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 1 && r.from <= r.to
export function OrderNumbersField({ setup, device, value, onChange }) {
  if (!device) {
    return <p className="text-xs text-muted-foreground" data-testid="order-numbers-new">It gets its own block of counter order numbers (the next free one, e.g. 100-199). You can change it here afterwards.</p>
  }
  const clash = orderRangeReady(value) && setup.devices.find(d => d.id !== device.id && !d.revoked_at
    && (d.kind === 'terminal' || d.kind === 'kiosk') && d.settings?.order_numbers
    && d.settings.order_numbers.from <= value.to && value.from <= d.settings.order_numbers.to)
  return (
    <Field group label="Order numbers" hint={'Counter orders from this ' + (device.kind === 'kiosk' ? 'kiosk' : 'till') + ' get these numbers, going round. Its checks are numbered ' + (device.short_code || 'T1') + '-1, ' + (device.short_code || 'T1') + '-2, ... each trading day.'}>
      <div className="flex items-center gap-2" data-testid="order-numbers">
        <NumberBox value={value.from} min={1} max={9999} onChange={v => onChange({ ...value, from: v })} ariaLabel="Order numbers from" />
        <span className="text-sm text-muted-foreground">to</span>
        <NumberBox value={value.to} min={1} max={9999} onChange={v => onChange({ ...value, to: v })} ariaLabel="Order numbers to" />
      </div>
      {!orderRangeReady(value) && <p className="text-xs text-destructive mt-1">Type two numbers from 1 to 9999, the first no bigger than the second.</p>}
      {clash && <p className="text-xs text-destructive mt-1" data-testid="order-numbers-clash">{clash.name} uses {clash.settings.order_numbers.from}-{clash.settings.order_numbers.to}. Pick numbers no other till or kiosk here uses.</p>}
    </Field>
  )
}

function TillModal({ venueId, setup, device, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [code, setCode] = useState('')
  const [reuseId, setReuseId] = useState(() => device ? null : defaultReuse(setup, 'terminal'))
  const [form, setForm] = useState({
    name: device?.name || '',
    mode: s.mode || 'table',
    revenue_stream_id: s.revenue_stream_id || '',
    floor_area_id: s.floor_area_id || '',
    receipt_printer_id: s.receipt_printer_id || '',
    card_reader: s.card_reader || 'none',
    order_numbers: orderRangeOf(device),
    receipt_mode: s.receipt_mode || 'venue',
    order_prompt: s.order_prompt || 'venue',
    till_layout: s.till_layout || 'venue',
    covers: s.covers || 'stream',
    courses: s.courses || 'stream',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const body = () => ({
    name: form.name.trim(),
    settings: {
      mode: form.mode,
      revenue_stream_id: form.revenue_stream_id || null,
      floor_area_id: form.mode === 'table' ? (form.floor_area_id || null) : null,
      receipt_printer_id: form.receipt_printer_id || null,
      card_reader: form.card_reader,
      receipt_mode: form.receipt_mode,
      order_prompt: form.order_prompt,
      till_layout: form.till_layout,
      covers: form.covers,
      courses: form.courses,
      ...(device && orderRangeReady(form.order_numbers) ? { order_numbers: form.order_numbers } : {}),
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => device
      ? api.patch(`/pos/devices/${device.id}`, body())
      : linkShownCode(api, venueId, 'terminal', code, reuseId ? { device_id: reuseId } : body()),
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
        <Btn variant="primary" className="flex-1" disabled={(!reuseId && !form.name.trim()) || (!device && !codeReady(code)) || (device && !orderRangeReady(form.order_numbers)) || save.isPending} onClick={() => save.mutate()} data-testid="device-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : reuseId ? reuseLabel(setup, reuseId) : 'Add the till'}
        </Btn>
        {device && <ConfirmDelete label="Remove till" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!device && <ShownCodeField setup={setup} kind="terminal" value={code} onChange={setCode} autoFocus />}
      {!device && <ReusePick setup={setup} kind="terminal" value={reuseId} onChange={setReuseId} />}
      {!reuseId && <>
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
        <Field label="Receipt when a check is paid" hint={'Venue setting: ' + (RECEIPT_MODES.find(m => m.value === (setup.settings.receipt_mode || 'ask'))?.label || 'Ask') + ' (Receipts and payments).'}>
          <select className={inputCls} value={form.receipt_mode} onChange={e => set({ receipt_mode: e.target.value })} data-testid="till-receipt-mode">
            <option value="venue">As the venue</option>
            {RECEIPT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Asking for the order type, name and tent number" hint={'Venue setting: ' + (ORDER_PROMPTS.find(m => m.value === (setup.settings.order_prompt || 'one'))?.label || 'One screen') + ' (Receipts and payments).'}>
          <select className={inputCls} value={form.order_prompt} onChange={e => set({ order_prompt: e.target.value })} data-testid="till-order-prompt">
            <option value="venue">As the venue</option>
            {ORDER_PROMPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Screen layout" hint={'Venue setting: ' + layoutName(setup, setup.settings.till_layout_id) + ' (Store tech → Till layouts).'}>
          <select className={inputCls} value={form.till_layout} onChange={e => set({ till_layout: e.target.value })} data-testid="till-layout">
            <option value="venue">As the venue</option>
            <option value="standard">The standard screen</option>
            {(setup.till_layouts || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Guests (covers)" hint={'As the stream: ' + coversWord(streamFor(setup, form.revenue_stream_id)?.covers) + ' (Revenue streams). Off also leaves out seat numbers.'}>
          <select className={inputCls} value={form.covers} onChange={e => set({ covers: e.target.value })} data-testid="till-covers">
            <option value="stream">As the revenue stream</option>
            {COVERS_RULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Courses" hint={'As the stream: ' + (streamFor(setup, form.revenue_stream_id)?.courses === false ? 'no courses' : 'courses') + ' (Revenue streams).'}>
          <select className={inputCls} value={form.courses} onChange={e => set({ courses: e.target.value })} data-testid="till-courses">
            <option value="stream">As the revenue stream</option>
            <option value="on">Use courses</option>
            <option value="off">No courses</option>
          </select>
        </Field>
        <CardMachinePick venueId={venueId} value={form.card_reader} onChange={v => set({ card_reader: v })} />
        <OrderNumbersField setup={setup} device={device} value={form.order_numbers} onChange={v => set({ order_numbers: v })} />
      </>}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/**
 * A till layout's name (Store tech → Till layouts, migration 228), or the
 * standard screen when none (or one deleted since) is set.
 */
export const layoutName = (setup, id) => (setup.till_layouts || []).find(l => l.id === id)?.name || 'The standard screen'

/**
 * Whether the till asks how many guests a table's check has (migration 231):
 * a revenue stream's covers, or a till's own.
 */
export const COVERS_RULES = [
  { value: 'off', label: 'Don\'t ask' },
  { value: 'ask', label: 'Ask, can be skipped' },
  { value: 'must', label: 'Must have' },
]
export const coversWord = v => (COVERS_RULES.find(m => m.value === (v || 'ask')) || COVERS_RULES[1]).label.toLowerCase()
/** The stream a till is in: its own, else the first active one (as the till does). */
const streamFor = (setup, id) => setup.revenue_streams.find(r => r.id === id) || setup.revenue_streams.find(r => r.is_active) || null

/** What happens to the receipt when a check is paid (pos_settings.receipt_mode, migration 224). */
export const RECEIPT_MODES = [
  { value: 'ask', label: 'Ask each time' },
  { value: 'always', label: 'Always print' },
  { value: 'never', label: 'Don\'t print' },
]

/**
 * How the till asks for a new order's order type, name and tent number
 * (pos_settings.order_prompt, migration 226): both take over the screen with
 * the till's own keys.
 */
export const ORDER_PROMPTS = [
  { value: 'one', label: 'One screen' },
  { value: 'two', label: 'Two steps' },
]

/** The address a device of this kind opens (Store tech's device_urls). */
export const deviceUrl = (setup, kind) => setup.device_urls?.[kind] || setup.till_url

export function status(d) {
  if (d.paired) return { text: 'Linked · seen ' + ago(d.last_seen_at), tone: 'ok' }
  return { text: 'Not linked: no device is using it', tone: 'warn' }
}

export default function TillsSection({ venueId, setup }) {
  const [editing, setEditing] = useState(null) // device | 'new' | null
  const [linking, setLinking] = useState(null) // device
  const rcName = id => setup.revenue_streams.find(r => r.id === id)?.name
  const { data: readers = [] } = useCardReaders(venueId)
  const machineName = id => readers.find(r => r.id === id)?.name
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
                    {machineName(d.settings?.card_reader) ? ' · Card machine: ' + machineName(d.settings.card_reader) : ''}
                    {d.settings?.mode === 'counter' && d.settings?.order_numbers ? ' · Orders ' + d.settings.order_numbers.from + '-' + d.settings.order_numbers.to : ''}
                    {d.settings?.till_layout && d.settings.till_layout !== 'venue' ? ' · Screen: ' + (d.settings.till_layout === 'standard' ? 'standard' : layoutName(setup, d.settings.till_layout)) : ''}
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
      <RemovedDevices devices={removed} onBringBack={setLinking} />
      <p className="text-xs text-muted-foreground">Till address: <span className="font-medium text-foreground break-all">{deviceUrl(setup, 'terminal')}</span> (kitchen screens and kiosks have their own, on their tabs)</p>
      <InstallerLine setup={setup} />
      {editing && (
        <TillModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
    </Section>
  )
}
