// src/components/pos/KitchenSection.jsx
//
// Till setup > Kitchen screens (docs/POS.md section 9):
//   - the kitchen screens: tablets or TVs paired like a till (one-time code at
//     the till address); each shows one or more stations
//   - stations: prep stations (Grill, Fryer, Bar ...) make dishes; the expo
//     (the pass) checks whole orders and marks them ready; runners take them
//     out; order ready boards show the numbers on menu screens. Timings
//     (amber / red), held courses, showing dishes before they arrive, and the
//     On order counts groups
//   - the kitchen flow: how dishes move between them (KitchenFlow.jsx)
//   - online orders: into the kitchen when accepted, ready when finished

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, KeyRound, Pencil, ChefHat, Trash2, Search, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle, SortableRows, ColourPick, ago,
} from './shared'
import KitchenFlow from './KitchenFlow'
import { PairingCode } from './TillsSection'
import { STATION_KINDS, KIND_LABELS } from '@shared/pos/kitchen.js'

const KINDS = STATION_KINDS.map(k => ({ value: k, label: { prep: 'Prep', expo: 'Expo (pass)', runner: 'Runner', board: 'Order ready board' }[k] }))
const KIND_HINTS = {
  prep: 'Makes dishes (Grill, Fryer, Bar...). Its bump sends them on to the next station in the kitchen flow.',
  expo: 'Checks whole orders before they go out (the pass). Its bump marks the order ready, and finishes dishes still at earlier stations.',
  runner: 'Takes orders out to tables or the counter. Last on a dish\'s way, its bump hands the order over.',
  board: 'An order ready board: shows order numbers on menu screens (Order status block). An order is ready there once every dish on its way to the board has arrived. Nothing to bump, no kitchen screen.',
}
const VIEWS = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'on_order', label: 'On order counts' },
]
const TEXT_SIZES = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
]

const newId = () => Math.random().toString(36).slice(2, 10)

// ── Kitchen screens (devices) ────────────────────────────────────

function ScreenModal({ venueId, setup, device, onClose, onPaired }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = device?.settings || {}
  const [form, setForm] = useState({
    name: device?.name || '',
    station_ids: s.station_ids || [],
    view: s.view || 'tickets',
    columns: s.columns ?? null,
    text_size: s.text_size || 'normal',
    sound: s.sound !== false,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const stations = setup.kds_stations.filter(x => x.is_active && x.kind !== 'board')
  const body = () => ({
    name: form.name.trim(),
    settings: { station_ids: form.station_ids, view: form.view, columns: form.columns || undefined, text_size: form.text_size, sound: form.sound },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const save = useMutation({
    mutationFn: () => device
      ? api.patch(`/pos/devices/${device.id}`, body())
      : api.post(`/pos/venues/${venueId}/devices`, { ...body(), kind: 'kds' }),
    onSuccess: out => { refresh(); if (!device) onPaired(out); else onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/devices/${device.id}`), onSuccess: () => { refresh(); onClose() } })
  const toggle = id => set({ station_ids: form.station_ids.includes(id) ? form.station_ids.filter(x => x !== id) : [...form.station_ids, id] })
  return (
    <Modal title={device ? 'Edit ' + device.name : 'Add a kitchen screen'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {device ? 'Save' : 'Add and get a pairing code'}
        </Btn>
        {device && <ConfirmDelete label="Remove screen" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
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
      <Toggle label="Beep for new orders" checked={form.sound} onChange={v => set({ sound: v })} />
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

function statusOf(d) {
  if (d.paired) return { text: 'Paired · seen ' + ago(d.last_seen_at), tone: 'ok' }
  if (d.pairing_open) return { text: 'Waiting to pair, code works until ' + new Date(d.pairing_expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), tone: 'warn' }
  return { text: 'Not paired', tone: 'muted' }
}

function ScreensCard({ venueId, setup }) {
  const screenStations = setup.kds_stations.filter(x => x.kind !== 'board')
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [pairing, setPairing] = useState(null)
  const newCode = useMutation({
    mutationFn: id => api.post(`/pos/devices/${id}/pairing-code`, {}),
    onSuccess: out => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); setPairing(out) },
  })
  const screens = setup.devices.filter(d => d.kind === 'kds' && !d.revoked_at)
  const stationName = id => setup.kds_stations.find(s => s.id === id)?.name
  return (
    <Section title="Kitchen screens" hint="Android tablets or TVs in the kitchen. Open the till address on the screen in Chrome, install it, and type the pairing code: it opens as a kitchen screen."
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
            const st = statusOf(d)
            const names = (d.settings?.station_ids || []).map(stationName).filter(Boolean)
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="kds-screen-row">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{d.short_code}</span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{names.length ? names.join(', ') : 'All stations'} · opens on {d.settings?.view === 'on_order' ? 'On order counts' : 'Tickets'}</p>
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
      <p className="text-xs text-muted-foreground">Address: <span className="font-medium text-foreground break-all">{setup.till_url}</span></p>
      <ErrorNote error={newCode.error} />
      {editing && (
        <ScreenModal venueId={venueId} setup={setup} device={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onPaired={out => { setEditing(null); setPairing(out) }} />
      )}
      {pairing && <PairingCode code={pairing.pairing_code} device={pairing.device} tillUrl={setup.till_url} what="kitchen screen" onClose={() => setPairing(null)} />}
    </Section>
  )
}

// ── Stations ─────────────────────────────────────────────────────

function GroupsEditor({ setup, groups, onChange }) {
  const [search, setSearch] = useState({})
  const update = (gi, patch) => onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  const updateMember = (gi, mi, patch) => update(gi, { members: groups[gi].members.map((m, i) => (i === mi ? { ...m, ...patch } : m)) })
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => {
        const q = (search[gi] || '').trim().toLowerCase()
        const matches = q.length >= 2 ? setup.items.filter(i => i.name.toLowerCase().includes(q) && !g.members.some(m => m.kind === 'dish' && m.id === i.id)).slice(0, 6) : []
        return (
          <div key={g.id} className="rounded-lg border p-3 space-y-2" data-testid="summary-group">
            <div className="flex items-center gap-2">
              <input className={cn(inputCls, 'flex-1')} value={g.name} maxLength={40} onChange={e => update(gi, { name: e.target.value })} placeholder="e.g. Wings" aria-label="Group name" />
              <button type="button" onClick={() => onChange(groups.filter((_, i) => i !== gi))} aria-label={'Remove ' + (g.name || 'group')}
                className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation"><Trash2 className="w-4 h-4" /></button>
            </div>
            {g.members.map((m, mi) => (
              <div key={mi} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{m.kind === 'dish' ? 'Dish: ' : 'Option: '}<b>{m.label}</b></span>
                <span className="text-xs text-muted-foreground">counts</span>
                <NumberBox value={m.qty} min={1} max={100} onChange={v => updateMember(gi, mi, { qty: v || 1 })} ariaLabel={'Count for ' + m.label} className="w-16" />
                <button type="button" onClick={() => update(gi, { members: g.members.filter((_, i) => i !== mi) })} aria-label={'Remove ' + m.label}
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
                <input className={cn(inputCls, 'pl-9')} value={search[gi] || ''} onChange={e => setSearch(s => ({ ...s, [gi]: e.target.value }))} placeholder="Add a dish" aria-label="Add a dish" />
                {matches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg divide-y">
                    {matches.map(i => (
                      <button key={i.id} type="button" onClick={() => { update(gi, { members: [...g.members, { kind: 'dish', id: i.id, label: i.name, qty: 1 }] }); setSearch(s => ({ ...s, [gi]: '' })) }}
                        className="w-full text-left px-3 min-h-[44px] text-sm hover:bg-muted touch-manipulation">{i.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <OptionAdd onAdd={label => update(gi, { members: [...g.members, { kind: 'option', label, qty: 1 }] })} />
            </div>
          </div>
        )
      })}
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

export function StationModal({ venueId, setup, station, kind: newKind, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const s = station?.settings || {}
  const startKind = station?.kind || newKind || 'prep'
  const [form, setForm] = useState({
    name: station?.name || '', kind: startKind, colour: station?.colour || null,
    target_mins: s.target_mins ?? 8, late_mins: s.late_mins ?? 12, show_held: s.show_held !== false,
    show_upcoming: s.show_upcoming ?? startKind === 'expo',
    summary_groups: s.summary_groups || [], is_active: station ? station.is_active : true,
  })
  const [upcomingSet, setUpcomingSet] = useState(!!station)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const setKind = k => set({ kind: k, ...(upcomingSet ? {} : { show_upcoming: k === 'expo' }) })
  const board = form.kind === 'board'
  const orderLevel = form.kind === 'expo' || form.kind === 'runner'
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({
    name: form.name.trim(), kind: form.kind, colour: form.colour, is_active: form.is_active,
    settings: {
      target_mins: form.target_mins || 8, late_mins: Math.max(form.late_mins || 12, form.target_mins || 8), show_held: form.show_held,
      show_upcoming: !!form.show_upcoming,
      summary_groups: form.summary_groups.filter(g => g.name.trim()).map(g => ({ ...g, name: g.name.trim() })),
    },
  })
  const save = useMutation({
    mutationFn: () => station ? api.patch(`/pos/kds-stations/${station.id}`, body()) : api.post(`/pos/venues/${venueId}/kds-stations`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/kds-stations/${station.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={station ? 'Edit ' + station.name : 'Add ' + (form.kind === 'expo' ? 'an expo' : form.kind === 'board' ? 'an order ready board' : 'a ' + KIND_LABELS[form.kind].toLowerCase())} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {station && <ConfirmDelete label="Delete station" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name" hint={board ? 'Menu screens pick a board by this name, so call it the same at every venue (e.g. ORB 1).' : undefined}>
        <input className={inputCls} value={form.name} maxLength={40} onChange={e => set({ name: e.target.value })}
          placeholder={board ? 'e.g. ORB 1' : form.kind === 'expo' ? 'e.g. Expo 1, Pass' : form.kind === 'runner' ? 'e.g. Runner' : 'e.g. Grill, Fryer, Prep 1'} />
      </Field>
      <Field group label="Kind" hint={KIND_HINTS[form.kind]}>
        <Segmented value={form.kind} options={KINDS} onChange={setKind} className="flex-wrap" />
      </Field>
      {!board && <>
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
    <Section title="Stations" hint="Prep stations make dishes, the expo checks orders before they go out, runners take them out, order ready boards show the numbers. The order here is the order of the tabs on a kitchen screen. With no expo, an order is ready once every station on its dishes' way has bumped it."
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
                    {st.kind !== 'board' && <> · amber {st.settings.target_mins} min, red {st.settings.late_mins} min</>}
                    {st.settings.summary_groups?.length ? ' · counts ' + st.settings.summary_groups.map(g => g.name).join(', ') : ''}
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

function OnlineCard({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const saved = { kds_online_orders: setup.settings.kds_online_orders !== false, kds_online_ready: setup.settings.kds_online_ready !== false }
  const [form, setForm] = useState(saved)
  useEffect(() => setForm(saved), [setup.settings.kds_online_orders, setup.settings.kds_online_ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = form.kds_online_orders !== saved.kds_online_orders || form.kds_online_ready !== saved.kds_online_ready
  const save = useMutation({
    mutationFn: () => api.patch(`/pos/venues/${venueId}/settings`, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  return (
    <Section title="Online orders" hint="Orders from your website's online ordering.">
      <Toggle label="Send online orders to the kitchen screens" hint="When an order is accepted (or straight away with automatic accept). Orders for a later collection time come on when it's time to start them (the collection time minus the ordering lead time)."
        checked={form.kds_online_orders} onChange={v => setForm(f => ({ ...f, kds_online_orders: v }))} />
      <Toggle label="Mark them ready when the kitchen finishes" hint="The guest gets the ready email. Marked collected at the pass, the order is completed too."
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

export default function KitchenSection({ venueId, setup, canManage = true }) {
  // { kind } = a new station of that kind, a station row = edit it
  const [editing, setEditing] = useState(null)
  return (
    <>
      <KitchenFlow venueId={venueId} setup={setup} canManage={canManage} onStation={setEditing} />
      <StationsCard venueId={venueId} setup={setup} onEdit={setEditing} />
      <ScreensCard venueId={venueId} setup={setup} />
      <OnlineCard venueId={venueId} setup={setup} />
      {editing && (
        <StationModal venueId={venueId} setup={setup} station={editing.id ? editing : null} kind={editing.kind}
          onClose={() => setEditing(null)} />
      )}
    </>
  )
}
