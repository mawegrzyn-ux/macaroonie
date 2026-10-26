// src/components/pos/KitchenSection.jsx
//
// Store tech > Kitchen screens (docs/POS.md section 9):
//   - the kitchen screens: tablets or TVs set up like a till (open the
//     kitchen screen address on it, type the code it shows, or scan its QR
//     code with a phone); each shows one or more stations
//   - stations: prep stations (Grill, Fryer, Bar ...) make dishes; the expo
//     (the pass) checks whole orders and marks them ready; runners take them
//     out; order ready boards show the numbers on menu screens. Timings
//     (amber / red), held courses, showing dishes before they arrive, and the
//     On order counts groups
//   - the kitchen flows: how dishes move between them, one in use at a time,
//     switched here or from a kitchen screen (KitchenFlow.jsx)
//   - ticket colours: each state's background, the timer, dish names by
//     menu section (KitchenColours.jsx, migration 207); the pass and runners
//     tick dishes off, bumping on the last tick only when set to
//   - online orders: into the kitchen when accepted, ready when finished;
//     GloriaFood orders too when the venue is linked (migration 178)

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, ChefHat, Trash2, Search, X, MonitorPlay } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle, SortableRows, ColourPick,
} from './shared'
import KitchenFlow from './KitchenFlow'
import TicketColoursCard from './KitchenColours'
import { deviceUrl, InstallerLine, status, ShownCodeField, LinkDeviceModal, LinkDeviceButton, linkShownCode, codeReady } from './TillsSection'
import { STATION_KINDS, KIND_LABELS, isBumpKind, STATUS_LOOKS, STATUS_ANIMS, PACE_TICKETS, PACE_MINUTES, RUSH_COUNT_MAX, flowName } from '@shared/pos/kitchen.js'
import { ColourPicker } from '@/components/ColourPicker'
import { TYPE_LABELS as GF_TYPE_LABELS } from '@shared/gloriafood.js'

const KINDS = STATION_KINDS.map(k => ({ value: k, label: { prep: 'Prep', expo: 'Expo (pass)', runner: 'Runner', board: 'Order ready board', balance: 'Splitter', printer: 'Kitchen printer', sleeper: 'Sleeper', setter: 'Setter' }[k] }))
const KIND_HINTS = {
  prep: 'Makes dishes (Grill, Fryer, Bar...). Its bump sends them on to the next station in the kitchen flow.',
  expo: 'Checks whole orders before they go out (the pass). Its bump marks the order ready, and finishes dishes still at earlier stations.',
  runner: 'Takes orders out to tables or the counter. Last on a dish\'s way, its bump hands the order over.',
  board: 'An order ready board: shows order numbers on menu screens (Order status block). An order is ready there once every dish on its way to the board has arrived. Nothing to bump, no kitchen screen.',
  balance: 'Shares tickets between the stations it links to in the kitchen flow (e.g. two wingmen): each ticket\'s dishes that reach it go to the one with the fewest pieces still to cook, or (Smart) the one that should be done soonest, taking turns when they\'re level. Big tickets can be shared out, and a busy order type can get its own station. Nothing to bump, no kitchen screen.',
  sleeper: 'Holds the dishes that reach it for a set time, then sends them on by itself (e.g. delivery orders wait 10 minutes before the grill starts). Which dishes it holds is decided by the links into it in the kitchen flow: filter them by order type, revenue stream, till, dish or section, or leave them open for every dish. Nothing to bump, no kitchen screen; the pass\'s Bump sends them on at once.',
  setter: 'Sets the order\'s status as a dish passes it, for order ready boards: its name is the status (e.g. Cooking, Bagging, Out for delivery). Put it in the kitchen flow where the status should change; the last Setter an order\'s dishes reached is its status. Dishes go straight on. Nothing to bump, no kitchen screen.',
  printer: 'Prints a ticket of the dishes that reach it in the kitchen flow, once: straight from Orders in when they are sent (held courses as HOLD, then FIRE), or after a kitchen screen when it bumps them. Nothing to bump; it can go on to a kitchen screen. Dishes that only reach printers count as done there.',
}
const VIEWS = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'on_order', label: 'On order counts' },
]
const TICKET_TITLES = [
  { value: 'auto', label: 'Table or name' },
  { value: 'number', label: 'Order number' },
  { value: 'tent', label: 'Tent' },
  { value: 'table', label: 'Table' },
  { value: 'name', label: 'Name' },
]
const TEXT_SIZES = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
]

const newId = () => Math.random().toString(36).slice(2, 10)

// ── Kitchen screens (devices) ────────────────────────────────────

function ScreenModal({ venueId, setup, device, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [code, setCode] = useState('')
  const [form, setForm] = useState({
    name: device?.name || '',
    station_ids: s.station_ids || [],
    view: s.view || 'tickets',
    columns: s.columns ?? null,
    text_size: s.text_size || 'normal',
    sound: s.sound !== false,
    can_switch_flow: s.can_switch_flow !== false,
    ticket_main: s.ticket_main || 'auto',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const stations = setup.kds_stations.filter(x => x.is_active && isBumpKind(x.kind))
  const body = () => ({
    name: form.name.trim(),
    settings: {
      station_ids: form.station_ids, view: form.view, columns: form.columns || undefined, text_size: form.text_size, sound: form.sound,
      can_switch_flow: form.can_switch_flow, ticket_main: form.ticket_main,
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => device
      ? api.patch(`/pos/devices/${device.id}`, body())
      : linkShownCode(api, venueId, 'kds', code, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/devices/${device.id}`), onSuccess: () => { refresh(); onClose() } })
  const toggle = id => set({ station_ids: form.station_ids.includes(id) ? form.station_ids.filter(x => x !== id) : [...form.station_ids, id] })
  return (
    <Modal title={device ? 'Edit ' + device.name : 'Add a kitchen screen'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || (!device && !codeReady(code)) || save.isPending} onClick={() => save.mutate()} data-testid="device-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : 'Add the screen'}
        </Btn>
        {device && <ConfirmDelete label="Remove screen" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!device && <ShownCodeField setup={setup} kind="kds" value={code} onChange={setCode} autoFocus />}
      <Field label="Name" hint="e.g. Grill screen, Pass.">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Grill screen" />
      </Field>
      <Field group label="Stations it shows" hint="It opens on the first; staff can switch between the ones ticked here. None ticked: all of them.">
        {!stations.length
          ? <p className="text-sm text-muted-foreground">Add a station first (below).</p>
          : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stations">
              {stations.map(st => (
                <button key={st.id} type="button" onClick={() => toggle(st.id)} aria-pressed={form.station_ids.includes(st.id)}
                  className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation',
                    form.station_ids.includes(st.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                  {st.name}{st.kind === 'expo' ? ' (expo)' : st.kind === 'runner' ? ' (runner)' : ''}
                </button>
              ))}
            </div>
          )}
      </Field>
      <Field group label="Opens on"><Segmented value={form.view} options={VIEWS} onChange={v => set({ view: v })} /></Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Tickets across" hint="Empty: as many as fit.">
          <NumberBox value={form.columns} min={3} max={10} onChange={v => set({ columns: v })} ariaLabel="Tickets across" placeholder="Auto" />
        </Field>
        <Field group label="Text size"><Segmented value={form.text_size} options={TEXT_SIZES} onChange={v => set({ text_size: v })} /></Field>
      </div>
      <Field group label="Ticket title" hint={form.ticket_main === 'auto'
        ? 'The table, or the name typed on the till or kiosk, with the order number beside it.'
        : 'An order without one shows the table or name instead. The order number stays beside it (or the table or tent, when the title is the order number).'}>
        <Segmented value={form.ticket_main} options={TICKET_TITLES} onChange={v => set({ ticket_main: v })} />
      </Field>
      <Toggle label="Beep for new orders" checked={form.sound} onChange={v => set({ sound: v })} />
      <Toggle label="Can switch the kitchen flow"
        hint={(setup.kds_flows || []).length > 1
          ? 'The flow button at the top right of the screen puts another kitchen flow in use for the whole kitchen.'
          : 'With more than one kitchen flow, a flow button at the top right of the screen puts another one in use for the whole kitchen.'}
        checked={form.can_switch_flow} onChange={v => set({ can_switch_flow: v })} />
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

function ScreensCard({ venueId, setup }) {
  const screenStations = setup.kds_stations.filter(x => isBumpKind(x.kind))
  const [editing, setEditing] = useState(null)
  const [linking, setLinking] = useState(null) // device
  const screens = setup.devices.filter(d => d.kind === 'kds' && !d.revoked_at)
  const stationName = id => setup.kds_stations.find(s => s.id === id)?.name
  return (
    <Section title="Kitchen screens" hint="Android tablets or TVs in the kitchen. Open the kitchen screen address (below) on the screen in Chrome and install it: it shows a code. Press Add a screen and type it, or scan its QR code with a phone."
      actions={<Btn variant="primary" onClick={() => setEditing('new')} disabled={!screenStations.length}><Plus className="w-4 h-4" /> Add a screen</Btn>}>
      {!screens.length && (
        <div className="text-sm text-muted-foreground flex items-start gap-3">
          <ChefHat className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{screenStations.length ? 'No kitchen screens yet.' : 'Add your stations first (above), then add a screen for each.'}</p>
        </div>
      )}
      {!!screens.length && (
        <div className="rounded-xl border divide-y">
          {screens.map(d => {
            const st = status(d)
            const names = (d.settings?.station_ids || []).map(stationName).filter(Boolean)
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="kds-screen-row">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{names.length ? names.join(', ') : 'All stations'} · opens on {d.settings?.view === 'on_order' ? 'On order counts' : 'Tickets'}</p>
                  <p className={cn('text-xs', st.tone === 'ok' ? 'text-green-700' : st.tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{st.text}</p>
                </div>
                <LinkDeviceButton device={d} onClick={() => setLinking(d)} />
                <Btn onClick={() => setEditing(d)} title={'Edit ' + d.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Kitchen screen address: <span className="font-medium text-foreground break-all" data-testid="kds-address">{deviceUrl(setup, 'kds')}</span></p>
      <InstallerLine setup={setup} />
      {editing && (
        <ScreenModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {linking && <LinkDeviceModal venueId={venueId} setup={setup} device={linking} onClose={() => setLinking(null)} />}
    </Section>
  )
}

// ── Stations ─────────────────────────────────────────────────────

/** Dishes and options with what each counts (On order counts groups, a Splitter's pieces). */
function MembersEditor({ setup, members, onChange }) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const matches = q.length >= 2 ? setup.items.filter(i => i.name.toLowerCase().includes(q) && !members.some(m => m.kind === 'dish' && m.id === i.id)).slice(0, 6) : []
  const updateMember = (mi, patch) => onChange(members.map((m, i) => (i === mi ? { ...m, ...patch } : m)))
  return (
    <>
      {members.map((m, mi) => (
        <div key={mi} className="flex items-center gap-2 text-sm" data-testid="count-member">
          <span className="flex-1 min-w-0 truncate">{m.kind === 'dish' ? 'Dish: ' : 'Option: '}<b>{m.label}</b></span>
          <span className="text-xs text-muted-foreground">counts</span>
          <NumberBox value={m.qty} min={1} max={100} onChange={v => updateMember(mi, { qty: v || 1 })} ariaLabel={'Count for ' + m.label} className="w-16" />
          <button type="button" onClick={() => onChange(members.filter((_, i) => i !== mi))} aria-label={'Remove ' + m.label}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Add a dish" aria-label="Add a dish" />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg divide-y">
              {matches.map(i => (
                <button key={i.id} type="button" onClick={() => { onChange([...members, { kind: 'dish', id: i.id, label: i.name, qty: 1 }]); setSearch('') }}
                  className="w-full text-left px-3 min-h-[44px] text-sm hover:bg-muted touch-manipulation">{i.name}</button>
              ))}
            </div>
          )}
        </div>
        <OptionAdd onAdd={label => onChange([...members, { kind: 'option', label, qty: 1 }])} />
      </div>
    </>
  )
}

function GroupsEditor({ setup, groups, onChange }) {
  const update = (gi, patch) => onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => (
        <div key={g.id} className="rounded-lg border p-3 space-y-2" data-testid="summary-group">
          <div className="flex items-center gap-2">
            <input className={cn(inputCls, 'flex-1')} value={g.name} maxLength={40} onChange={e => update(gi, { name: e.target.value })} placeholder="e.g. Wings" aria-label="Group name" />
            <button type="button" onClick={() => onChange(groups.filter((_, i) => i !== gi))} aria-label={'Remove ' + (g.name || 'group')}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation"><Trash2 className="w-4 h-4" /></button>
          </div>
          <MembersEditor setup={setup} members={g.members} onChange={members => update(gi, { members })} />
        </div>
      ))}
      {groups.length < 12 && (
        <Btn onClick={() => onChange([...groups, { id: newId(), name: '', members: [] }])}><Plus className="w-4 h-4" /> Add a group</Btn>
      )}
    </div>
  )
}

function OptionAdd({ onAdd }) {
  const [text, setText] = useState('')
  return (
    <div className="flex gap-2">
      <input className={cn(inputCls, 'w-48')} value={text} maxLength={120} onChange={e => setText(e.target.value)} placeholder="Or an option's name" aria-label="Option name" />
      <Btn onClick={() => { if (text.trim()) { onAdd(text.trim()); setText('') } }} disabled={!text.trim()}>Add</Btn>
    </div>
  )
}

/** A Splitter's busy order type rule for the station list: "5+ waiting Delivery orders go to Wingman 2". */
function busyShort(s, setup) {
  const type = (setup.order_types || []).find(t => t.id === s.rush_type_id)?.name || 'an order type\'s'
  const to = setup.kds_stations.find(x => x.id === s.rush_station_id)?.name || 'its station'
  return (s.rush_count || 5) + '+ waiting ' + type + ' orders go to ' + to
}

/** The stations a Splitter links to in any of this location's flows (a shared flow's boxes by name). */
function linkedFrom(setup, station) {
  const ids = new Set()
  if (!station) return ids
  const byName = new Map(setup.kds_stations.map(s => [flowName(s.name), s.id]))
  for (const f of setup.kds_flows || []) {
    if (!f.shared) {
      for (const l of f.links || []) if (l.from === station.id) ids.add(l.to)
      continue
    }
    const boxes = Object.fromEntries((f.boxes || []).map(b => [b.id, b]))
    for (const l of f.links || []) {
      if (!l.from || flowName(boxes[l.from]?.name) !== flowName(station.name)) continue
      const to = byName.get(flowName(boxes[l.to]?.name))
      if (to) ids.add(to)
    }
  }
  return ids
}

/** A Splitter's busy order type rule: the type, the count and the station. */
function BusyTypeRule({ setup, station, form, set }) {
  const linked = linkedFrom(setup, station)
  const types = (setup.order_types || []).filter(t => t.is_active !== false || t.id === form.rush_type_id)
  const stations = setup.kds_stations
    .filter(x => isBumpKind(x.kind) && x.id !== station?.id && (x.is_active || x.id === form.rush_station_id))
    .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)))
  const type = types.find(t => t.id === form.rush_type_id)?.name || 'those'
  return (
    <div className="space-y-3" data-testid="balance-busy">
      <Segmented value={form.rush_on ? 'on' : 'off'} className="flex-wrap"
        options={[{ value: 'off', label: 'Share as usual' }, { value: 'on', label: 'Give it its own station' }]}
        onChange={v => set({ rush_on: v === 'on' })} />
      {form.rush_on && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          From
          <NumberBox value={form.rush_count} min={1} max={RUSH_COUNT_MAX} onChange={v => set({ rush_count: v })} ariaLabel="Waiting orders of that type" />
          waiting
          <select className={cn(inputCls, 'w-auto')} value={form.rush_type_id} onChange={e => set({ rush_type_id: e.target.value })}
            aria-label="Order type" data-testid="balance-busy-type">
            <option value="">Pick an order type</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          orders, send {type} orders to
          <select className={cn(inputCls, 'w-auto')} value={form.rush_station_id} onChange={e => set({ rush_station_id: e.target.value })}
            aria-label="Station for those orders" data-testid="balance-busy-station">
            <option value="">Pick a station</option>
            {stations.map(x => <option key={x.id} value={x.id}>{x.name}{linked.has(x.id) ? '' : ' (not linked to it yet)'}</option>)}
          </select>
          and every other order to the other stations.
        </div>
      )}
      {form.rush_on && form.rush_station_id && station && !linked.has(form.rush_station_id) && (
        <p className="text-xs text-amber-700">Link this Splitter to that station in the kitchen flow, or the rule never applies.</p>
      )}
    </div>
  )
}

export function StationModal({ venueId, setup, station, kind: newKind, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = station?.settings || {}
  const startKind = station?.kind || newKind || 'prep'
  const [form, setForm] = useState({
    name: station?.name || '', kind: startKind, colour: station?.colour || null,
    target_mins: s.target_mins ?? 8, late_mins: s.late_mins ?? 12, show_held: s.show_held !== false,
    show_upcoming: s.show_upcoming ?? startKind === 'expo',
    bump_when_checked: !!s.bump_when_checked,
    summary_groups: s.summary_groups || [], pieces: s.pieces || [], is_active: station ? station.is_active : true,
    share: s.split_above != null, split_above: s.split_above ?? 20,
    share_mode: s.share_mode === 'speed' ? 'speed' : 'pieces',
    rush_on: !!s.rush_type_id, rush_type_id: s.rush_type_id || '', rush_count: s.rush_count ?? 5, rush_station_id: s.rush_station_id || '',
    printer_id: s.printer_id || '',
    delay_mins: s.delay_mins ?? 5,
    status_look: s.status_look || 'text', status_colour: s.status_colour || '#f59e0b', status_text: s.status_text || '',
    status_anim: s.status_anim || 'none', status_lamp: s.status_lamp || 2,
  })
  const [upcomingSet, setUpcomingSet] = useState(!!station)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const setKind = k => set({ kind: k, ...(upcomingSet ? {} : { show_upcoming: k === 'expo' }) })
  const board = form.kind === 'board'
  const balance = form.kind === 'balance'
  const printerBox = form.kind === 'printer'
  const sleeper = form.kind === 'sleeper'
  const setter = form.kind === 'setter'
  const orderLevel = form.kind === 'expo' || form.kind === 'runner'
  // The busy order type rule needs its type and station before it can be saved.
  const busyUnfinished = balance && form.rush_on && (!form.rush_type_id || !form.rush_station_id)
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({
    name: form.name.trim(), kind: form.kind, colour: form.colour, is_active: form.is_active,
    settings: {
      target_mins: form.target_mins || 8, late_mins: Math.max(form.late_mins || 12, form.target_mins || 8), show_held: form.show_held,
      show_upcoming: !!form.show_upcoming,
      bump_when_checked: orderLevel && form.bump_when_checked,
      summary_groups: form.summary_groups.filter(g => g.name.trim()).map(g => ({ ...g, name: g.name.trim() })),
      pieces: balance ? form.pieces : [],
      split_above: balance && form.share ? (form.split_above ?? 20) : null,
      ...(balance ? {
        share_mode: form.share_mode,
        rush_type_id: form.rush_on ? form.rush_type_id || null : null,
        rush_station_id: form.rush_on ? form.rush_station_id || null : null,
        rush_count: Math.min(RUSH_COUNT_MAX, Math.max(1, form.rush_count || 5)),
      } : {}),
      ...(printerBox ? { printer_id: form.printer_id || null } : {}),
      ...(sleeper ? { delay_mins: Math.min(240, Math.max(1, form.delay_mins || 5)) } : {}),
      ...(setter ? {
        status_look: form.status_look, status_colour: form.status_colour, status_text: form.status_text.trim(),
        status_anim: form.status_anim, status_lamp: form.status_lamp,
      } : {}),
    },
  })
  const save = useMutation({
    mutationFn: () => station ? api.patch(`/pos/kds-stations/${station.id}`, body()) : api.post(`/pos/venues/${venueId}/kds-stations`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/kds-stations/${station.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={station ? 'Edit ' + station.name : 'Add ' + (form.kind === 'expo' ? 'an expo' : board ? 'an order ready board' : 'a ' + KIND_LABELS[form.kind].toLowerCase())} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending || busyUnfinished} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {station && <ConfirmDelete label="Delete station" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint={board ? 'Menu screens pick a board by this name, so call it the same at every venue (e.g. ORB 1).'
        : setter ? 'The status. Each Setter at a venue needs its own name; call it the same at every venue so menu screens can style it once.' : undefined}>
        <input className={inputCls} value={form.name} maxLength={40} onChange={e => set({ name: e.target.value })}
          placeholder={board ? 'e.g. ORB 1' : balance ? 'e.g. Wings' : sleeper ? 'e.g. Delivery wait' : setter ? 'e.g. Cooking, Bagging' : printerBox ? 'e.g. Grill tickets' : form.kind === 'expo' ? 'e.g. Expo 1, Pass' : form.kind === 'runner' ? 'e.g. Runner' : 'e.g. Grill, Fryer, Prep 1'} />
      </Field>
      <Field group label="Kind" hint={KIND_HINTS[form.kind]}>
        <Segmented value={form.kind} options={KINDS} onChange={setKind} className="flex-wrap" />
      </Field>
      {balance && (
        <Field group label="How it shares"
          hint={form.share_mode === 'speed'
            ? 'Each ticket goes where it should be done soonest: the pieces still to cook at each station, times how long that station has been taking a piece (its last ' + PACE_TICKETS + ' tickets in the last ' + PACE_MINUTES + ' minutes, not counting time a ticket waited behind others). A station falling behind gets fewer tickets until it catches up; with nothing to go on yet it shares by pieces.'
            : 'Each ticket goes to the station with the fewest pieces still to cook, taking turns when they\'re level.'}>
          <div data-testid="balance-mode">
            <Segmented value={form.share_mode} className="flex-wrap"
              options={[{ value: 'pieces', label: 'Fewest pieces' }, { value: 'speed', label: 'Smart: by speed' }]}
              onChange={v => set({ share_mode: v })} />
          </div>
        </Field>
      )}
      {balance && (
        <Field group label="Pieces" hint="What a dish counts when the box weighs up who has more to cook, e.g. the 10 Wings option counts 10, the 8pc Boneless dish counts 8. A dish not listed counts its quantity.">
          <div className="space-y-2" data-testid="balance-pieces"><MembersEditor setup={setup} members={form.pieces} onChange={pieces => set({ pieces })} /></div>
        </Field>
      )}
      {balance && (
        <Field group label="Big tickets"
          hint={form.share
            ? 'A ticket with more pieces than this is shared: each dish line goes, biggest first, to whichever station then has the fewest pieces. One dish line is never split.'
            : 'The whole ticket goes to one station, however many pieces it has.'}>
          <div className="space-y-3" data-testid="balance-big">
            <Segmented value={form.share ? 'share' : 'keep'} className="flex-wrap"
              options={[{ value: 'keep', label: 'Keep each ticket on one station' }, { value: 'share', label: 'Share big tickets' }]}
              onChange={v => set({ share: v === 'share' })} />
            {form.share && (
              <label className="flex flex-wrap items-center gap-2 text-sm">
                Share a ticket with more than
                <NumberBox value={form.split_above} min={0} max={999} onChange={v => set({ split_above: v })} ariaLabel="Share a ticket with more than this many pieces" />
                pieces
              </label>
            )}
          </div>
        </Field>
      )}
      {balance && (
        <Field group label="When one order type gets busy"
          hint={form.rush_on
            ? 'Waiting: with dishes still to cook at the stations it shares between (the new order counts too). Below that it shares as usual.'
            : 'Every order type is shared the same way.'}>
          <BusyTypeRule setup={setup} station={station} form={form} set={set} />
        </Field>
      )}
      {printerBox && (
        <Field label="Printer" hint="Kitchen tickets for this box print here. Add printers on the Printers tab.">
          <select className={inputCls} value={form.printer_id} onChange={e => set({ printer_id: e.target.value })} data-testid="station-printer">
            <option value="">Pick a printer</option>
            {setup.printers.filter(p => p.is_active && !(p.connection === 'device' && setup.devices.find(d => d.id === p.device_id)?.kind === 'kiosk')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {sleeper && (
        <Field label="Hold dishes for (minutes)" hint="Counted from when a dish reaches it. 1 to 240 minutes. Use one Sleeper per wait: a 10 minute and a 20 minute wait are two boxes.">
          <NumberBox value={form.delay_mins} min={1} max={240} onChange={v => set({ delay_mins: v })} ariaLabel="Hold dishes for minutes" />
        </Field>
      )}
      {setter && (
        <Field group label="On order ready boards" hint="How the status shows on each tile. A menu screen's Order status block can change this per status.">
          <div className="space-y-3" data-testid="setter-look">
            <Segmented value={form.status_look} className="flex-wrap" options={STATUS_LOOKS.map(x => ({ value: x.key, label: x.label }))}
              onChange={v => set({ status_look: v })} />
            <ColourPicker label="Colour" value={form.status_colour} onChange={v => set({ status_colour: v || '#f59e0b' })} testId="setter-colour" />
            {(form.status_look === 'text' || form.status_look === 'flag') && (
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground mb-1">Words (empty: the name)</span>
                <input className={inputCls} value={form.status_text} maxLength={40} placeholder={form.name || 'The name'}
                  onChange={e => set({ status_text: e.target.value })} data-testid="setter-text" />
              </label>
            )}
            {form.status_look === 'light' && (
              <div>
                <span className="block text-xs text-muted-foreground mb-1">Lamp lit</span>
                <Segmented value={form.status_lamp} options={[{ value: 1, label: 'Top' }, { value: 2, label: 'Middle' }, { value: 3, label: 'Bottom' }]}
                  onChange={v => set({ status_lamp: v })} />
              </div>
            )}
            <div>
              <span className="block text-xs text-muted-foreground mb-1">Movement</span>
              <Segmented value={form.status_anim} className="flex-wrap" options={STATUS_ANIMS.map(x => ({ value: x.key, label: x.label }))}
                onChange={v => set({ status_anim: v })} />
            </div>
          </div>
        </Field>
      )}
      {setter && station?.kind && station.kind !== 'setter' && (
        <p className="text-xs text-amber-700">As a Setter it leaves the kitchen screens, and links into it from a Splitter go.</p>
      )}
      {printerBox && !form.printer_id && <p className="text-xs text-amber-700">Until a printer is picked, nothing prints here.</p>}
      {balance && station?.kind && station.kind !== 'balance' && (
        <p className="text-xs text-amber-700">As a Splitter it leaves the kitchen screens, and its links out of every flow lose their filters (links to boards go).</p>
      )}
      {sleeper && station?.kind && station.kind !== 'sleeper' && (
        <p className="text-xs text-amber-700">As a Sleeper it leaves the kitchen screens, and links into it from a Splitter go.</p>
      )}
      {!board && !balance && !printerBox && !sleeper && !setter && <>
      <div className="flex flex-wrap gap-4">
        <Field label="Amber after (minutes)" hint="And the on-time target.">
          <NumberBox value={form.target_mins} min={1} max={120} onChange={v => set({ target_mins: v })} ariaLabel="Amber after minutes" />
        </Field>
        <Field label="Red after (minutes)">
          <NumberBox value={form.late_mins} min={1} max={240} onChange={v => set({ late_mins: v })} ariaLabel="Red after minutes" />
        </Field>
      </div>
      {form.late_mins != null && form.target_mins != null && form.late_mins < form.target_mins && (
        <p className="text-xs text-amber-700">Red comes after amber: it will be saved as {form.target_mins} minutes.</p>
      )}
      <Toggle label="Show held courses" hint="Dishes waiting for their course to be fired show greyed out at the bottom of the ticket." checked={form.show_held} onChange={v => set({ show_held: v })} />
      <Toggle label="Show orders before their dishes get here"
        hint={orderLevel
          ? 'Tickets come on as soon as the order is sent, with each dish marked where it is now (At Grill). Bumping finishes dishes still at earlier stations.'
          : 'Dishes still at an earlier station show greyed out (At Prep 1) so the station can get ready. They can only be bumped once they arrive.'}
        checked={form.show_upcoming} onChange={v => { setUpcomingSet(true); set({ show_upcoming: v }) }} />
      {orderLevel && (
        <Field group label="Ticking off dishes"
          hint={form.bump_when_checked
            ? 'Tap a dish to tick it off. Ticking off the last one ' + (form.kind === 'runner' ? 'hands the order over, as DONE does.' : 'marks the order ready, as READY does.')
            : 'Tap a dish to tick it off as it\'s checked or packed (a packing check). With every dish ticked the ticket shows CHECKED and stays until ' + (form.kind === 'runner' ? 'DONE' : 'READY') + ' is pressed.'}>
          <div data-testid="station-tick-mode">
            <Segmented value={form.bump_when_checked ? 'bump' : 'keep'} className="flex-wrap"
              options={[
                { value: 'keep', label: 'Keep the ticket until ' + (form.kind === 'runner' ? 'DONE' : 'READY') },
                { value: 'bump', label: 'Bump when every dish is ticked' },
              ]}
              onChange={v => set({ bump_when_checked: v === 'bump' })} />
          </div>
        </Field>
      )}
      <Field group label="On order counts" hint="Groups to count on the On order screen and the SUM panel, e.g. Wings: the 8pc Wings dish counts 8, the 6 Wings option counts 6. Without groups each dish is counted on its own.">
        <GroupsEditor setup={setup} groups={form.summary_groups} onChange={g => set({ summary_groups: g })} />
      </Field>
      </>}
      <Field group label="Colour"><ColourPick value={form.colour} onChange={v => set({ colour: v })} /></Field>
      {station && <Toggle label="In use" checked={form.is_active} onChange={v => set({ is_active: v })} />}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

function StationsCard({ venueId, setup, onEdit }) {
  const api = useApi()
  const qc = useQueryClient()
  const reorder = useMutation({
    mutationFn: ids => api.put(`/pos/venues/${venueId}/kds-stations/order`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  return (
    <Section title="Stations" hint="Prep stations make dishes, the expo checks orders before they go out, runners take them out, order ready boards show the numbers, Splitters share tickets between stations, Sleepers hold dishes for a set time, Setters set an order's status for the boards. The order here is the order of the tabs on a kitchen screen. With no expo, an order is ready once every station on its dishes' way has bumped it."
      actions={<Btn variant="primary" onClick={() => onEdit({ kind: 'prep' })}><Plus className="w-4 h-4" /> Add a station</Btn>}>
      {!setup.kds_stations.length
        ? <p className="text-sm text-muted-foreground">No stations yet. Kitchen screens start working once there is one.</p>
        : (
          <SortableRows items={setup.kds_stations} onReorder={ids => reorder.mutate(ids)}
            renderItem={st => (
              <div className="flex items-center gap-3" data-testid="kds-station-row">
                {st.colour && <span className="w-3 h-8 rounded-full shrink-0" style={{ background: st.colour }} />}
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', !st.is_active && 'text-muted-foreground line-through')}>{st.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {KIND_LABELS[st.kind]}
                    {isBumpKind(st.kind) && <> · amber {st.settings.target_mins} min, red {st.settings.late_mins} min</>}
                    {(st.kind === 'expo' || st.kind === 'runner') && (st.settings.bump_when_checked ? ' · ticking every dish bumps' : ' · packing check')}
                    {isBumpKind(st.kind) && st.settings.summary_groups?.length ? ' · counts ' + st.settings.summary_groups.map(g => g.name).join(', ') : ''}
                    {st.kind === 'balance' && (st.settings.pieces?.length ? ' · ' + st.settings.pieces.map(m => m.label + ' ' + m.qty).join(', ') : ' · each dish counts its quantity')}
                    {st.kind === 'balance' && (st.settings.share_mode === 'speed' ? ' · smart: by speed' : ' · by fewest pieces')}
                    {st.kind === 'balance' && (st.settings.split_above != null ? ' · shares tickets over ' + st.settings.split_above + ' pieces' : ' · each ticket on one station')}
                    {st.kind === 'balance' && st.settings.rush_type_id && ' · ' + busyShort(st.settings, setup)}
                    {st.kind === 'sleeper' && ' · holds dishes ' + st.settings.delay_mins + ' min'}
                    {st.kind === 'setter' && ' · status ' + (st.settings.status_text || st.name) + ', ' + (STATUS_LOOKS.find(x => x.key === st.settings.status_look)?.label || 'Words').toLowerCase()}
                    {st.kind === 'printer' && ' · ' + (setup.printers.find(p => p.id === st.settings.printer_id)?.name || 'no printer picked')}
                  </p>
                </div>
                <Btn onClick={() => onEdit(st)} title={'Edit ' + st.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            )} />
        )}
      <ErrorNote error={reorder.error} />
    </Section>
  )
}

// ── Online orders ────────────────────────────────────────────────

// GloriaFood order types (shared/gloriafood.js), in the order they're listed.
const GF_TYPES = Object.entries(GF_TYPE_LABELS)

function onlineForm(settings, gloriafood) {
  return {
    kds_online_orders: settings.kds_online_orders !== false,
    kds_online_ready: settings.kds_online_ready !== false,
    kds_gloriafood: !!settings.kds_gloriafood,
    kds_gloriafood_lead_mins: settings.kds_gloriafood_lead_mins ?? 20,
    // What each GloriaFood type goes to now (the server matched the ones
    // not picked yet by name), so Save keeps what is shown.
    kds_gloriafood_types: { ...(gloriafood?.types || {}) },
  }
}

function OnlineCard({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const gf = setup.gloriafood
  const saved = onlineForm(setup.settings, gf)
  const savedKey = JSON.stringify(saved)
  const [form, setForm] = useState(saved)
  useEffect(() => setForm(JSON.parse(savedKey)), [savedKey])
  const dirty = JSON.stringify(form) !== savedKey
  const save = useMutation({
    mutationFn: () => api.patch(`/pos/venues/${venueId}/settings`, gf ? form : {
      kds_online_orders: form.kds_online_orders, kds_online_ready: form.kds_online_ready,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const types = (setup.order_types || []).filter(t => t.is_active || Object.values(form.kds_gloriafood_types).includes(t.id))
  const setType = (k, v) => setForm(f => ({ ...f, kds_gloriafood_types: { ...f.kds_gloriafood_types, [k]: v || null } }))
  return (
    <Section title="Online orders" hint={gf ? 'Orders from your website\'s online ordering and from GloriaFood.' : 'Orders from your website\'s online ordering.'}>
      <Toggle label="Send online orders to the kitchen screens" hint="When an order is accepted (or straight away with automatic accept). Orders for a later collection time come on when it's time to start them (the collection time minus the ordering lead time)."
        checked={form.kds_online_orders} onChange={v => setForm(f => ({ ...f, kds_online_orders: v }))} />
      {gf && (
        <div className="rounded-lg border p-3 space-y-3" data-testid="kds-gloriafood">
          <Toggle label="Send GloriaFood orders to the kitchen screens"
            hint="Accepted GloriaFood orders, as they arrive. Dishes are matched to your menus by name, so dish and section links in the kitchen flow apply; a dish with no match follows the order type and default links. Orders cancelled in GloriaFood come off the screens."
            checked={form.kds_gloriafood} onChange={v => setForm(f => ({ ...f, kds_gloriafood: v }))} />
          {form.kds_gloriafood && (
            <>
              <Field label="Orders for later come on">
                <span className="flex items-center gap-2">
                  <NumberBox value={form.kds_gloriafood_lead_mins} min={0} max={240} ariaLabel="Minutes before the order's time"
                    onChange={v => setForm(f => ({ ...f, kds_gloriafood_lead_mins: v ?? 0 }))} />
                  <span className="text-sm text-muted-foreground">minutes before their time</span>
                </span>
              </Field>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Order types</p>
                <p className="text-[11px] text-muted-foreground mb-2">Which of your order types each GloriaFood order counts as on the kitchen screens and in the kitchen flow.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GF_TYPES.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2">
                      <span className="text-sm w-36 shrink-0">{label}</span>
                      <select className={inputCls} value={form.kds_gloriafood_types[k] || ''} aria-label={'GloriaFood ' + label}
                        onChange={e => setType(k, e.target.value)}>
                        <option value="">None</option>
                        {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      <Toggle label="Mark them ready when the kitchen finishes"
        hint={gf
          ? 'The guest gets the ready email. Marked collected at the pass, the order is completed too. GloriaFood orders move on the Online orders board (GloriaFood isn\'t told).'
          : 'The guest gets the ready email. Marked collected at the pass, the order is completed too.'}
        checked={form.kds_online_ready} onChange={v => setForm(f => ({ ...f, kds_online_ready: v }))} />
      <div className="flex items-center gap-3">
        <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        <ErrorNote error={save.error} />
      </div>
    </Section>
  )
}

// ── The kitchen test bench ───────────────────────────────────────

// Every kitchen screen of the venue on one page in a new window (the till
// app's /?kitchen_test=, pos/src/kitchen/Bench.jsx), with test orders that
// never reach the real screens. View is enough, so the button isn't a
// <button>: Store tech is a disabled fieldset for View users.
function TestCard({ venueId }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [link, setLink] = useState(null)
  async function open() {
    if (busy) return
    setBusy(true)
    setError(null)
    // Opened straight away, so the browser doesn't block it as a pop-up; the
    // address follows once the link is made.
    const win = window.open('', '_blank')
    try {
      const res = await api.post(`/pos/venues/${venueId}/kitchen-test`, {})
      if (win && !win.closed) { win.location.href = res.url; setLink(null) } else setLink(res.url)
    } catch (e) {
      if (win && !win.closed) win.close()
      setError(e.message || 'The test page couldn\'t be opened')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Test the kitchen"
      hint="Every kitchen screen of this venue side by side, scaled down. Send test orders, bump them on the screens, switch the kitchen flow and watch where each dish goes. Test orders stay on that page: the real kitchen screens, the till and the reports never see them.">
      <div className="flex flex-wrap items-center gap-3">
        <div role="button" tabIndex={0} aria-disabled={busy || undefined} data-testid="kitchen-test-open"
          onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer select-none touch-manipulation">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <MonitorPlay size={16} />} Open the kitchen test
        </div>
        {link && <a href={link} target="_blank" rel="noreferrer" className="text-sm font-medium underline">Your browser blocked the new window: open it here</a>}
      </div>
      <p className="text-xs text-muted-foreground">Opens in a new window. Changes made here afterwards show there after Reload setup.</p>
      <ErrorNote error={error} />
    </Section>
  )
}

export default function KitchenSection({ venueId, setup, canManage = true }) {
  // { kind } = a new station of that kind, a station row = edit it
  const [editing, setEditing] = useState(null)
  return (
    <>
      <TestCard venueId={venueId} />
      <KitchenFlow venueId={venueId} setup={setup} canManage={canManage} onStation={setEditing} />
      <StationsCard venueId={venueId} setup={setup} onEdit={setEditing} />
      <ScreensCard venueId={venueId} setup={setup} />
      <TicketColoursCard venueId={venueId} setup={setup} />
      <OnlineCard venueId={venueId} setup={setup} />
      {editing && (
        <StationModal venueId={venueId} setup={setup} station={editing.id ? editing : null} kind={editing.kind}
          onClose={() => setEditing(null)} />
      )}
    </>
  )
}
