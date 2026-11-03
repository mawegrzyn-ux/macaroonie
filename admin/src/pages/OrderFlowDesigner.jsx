// src/pages/OrderFlowDesigner.jsx
//
// One order flow (/pos/flows/:id, migration 235; shared/pos/orderFlows.js),
// drawn as boxes in the order it works: Where it runs, When it acts, If the
// order matches, Then what it does. Tap a box to change it in the panel
// beside (below on a narrow screen); the boxes' words come from the same
// rules the list and the API use. A flow runs on tills, kiosks and online
// ordering, any of them (migration 236). A prompt has a Look box too: how
// it looks on each channel it runs on (components/pos/PromptLook.jsx). The
// preview shows the prompt in the look of the channel picked above it (a
// flow that suggests dishes) or the lines it puts on an order (one that
// adds by itself). Explicit Save; a flow switched on must be able to run
// (its problems listed), a flow switched off can be saved half done.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowDown, Loader2, Save, Workflow, MapPin, Clock, Filter, Sparkles, X, Plus, Minus,
  AlertTriangle, Info, Lock, Unlock, ListChecks, ReceiptText, Palette,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { PageHeader, Section, Field, Btn, Toggle, Segmented, ErrorNote, SortableRows, inputCls, money } from '@/components/pos/shared'
import { FLOW_KIND_OPTIONS, OnSwitch, KindIcon } from '@/components/pos/OrderFlowsSection'
import { DishPicker, DishPickerModal } from '@/components/menus/DishPicker'
import { LookPanel, PromptPreview, lookLines, lookApps } from '@/components/pos/PromptLook'
import {
  normaliseOrderFlow, newOrderFlow, flowProblems, flowWarnings, flowWhenText, flowIfLines, flowThenLines, flowWhereText,
  channelKey, FLOW_NAME_MAX, ASK_TITLE_MAX, ASK_MESSAGE_MAX, ASK_CHOICES_MAX, FLOW_ADDS_MAX, FLOW_ADD_QTY_MAX,
  FLOW_APPS, APP_NAMES,
} from '@shared/pos/orderFlows.js'
import { chargeValueText } from '@shared/pos/charges.js'

const TRIGGERS = [
  { value: 'dish_added', label: 'When a dish is added' },
  { value: 'checkout', label: 'At checkout' },
]
const PICKS = [
  { value: 'one', label: 'One of them' },
  { value: 'several', label: 'Any of them' },
]

/** A flow normalised, without its place in the list: what is checked and compared for changes. */
function cleanFlow(f) {
  const n = normaliseOrderFlow(f)
  if (!n) return null
  delete n.sort_order
  return n
}

/**
 * A flow as the designer edits it: normalised, but its words (the name, the
 * question, the line under it) as typed, since normalising trims them and
 * would eat a space typed at the end. Saving tidies them.
 */
function asDraft(f) {
  const n = cleanFlow(f)
  if (!n) return null
  const typed = (v, dflt) => (typeof v === 'string' ? v : dflt)
  return {
    ...n,
    name: typed(f.name, n.name),
    ask: n.ask ? { ...n.ask, title: typed(f.ask?.title, n.ask.title), message: typed(f.ask?.message, n.ask.message) } : n.ask,
  }
}

/** What every id is called, from the catalogue (GET /pos/order-flows/catalog). */
function namesOf(catalog) {
  const items = {}, sections = {}, prices = {}, images = {}
  for (const m of catalog?.menus || []) {
    for (const s of m.sections) {
      sections[s.id] = s.title
      for (const i of s.items) { items[i.id] = i.name; prices[i.id] = i.price_pence; if (i.image_url) images[i.id] = i.image_url }
    }
  }
  const by = (list, key = 'name') => Object.fromEntries((list || []).map(x => [x.id, x[key]]))
  return {
    items, sections, prices, images,
    types: by(catalog?.order_types), charges: by(catalog?.charges), venues: by(catalog?.venues),
    tills: by(catalog?.tills), kiosks: by(catalog?.kiosks),
  }
}

/**
 * What flowWarnings() needs to know about the company: channels by name,
 * where each till and kiosk is, the dishes with choices to make, the charges.
 */
function placesOf(catalog) {
  const channels = {}
  for (const c of catalog?.channels || []) channels[channelKey(c.name)] = c.venues.map(v => v.id)
  const at = list => Object.fromEntries((list || []).map(t => [t.id, t.venue_id]))
  const choices = new Set()
  for (const m of catalog?.menus || []) for (const sct of m.sections) for (const i of sct.items) if (i.needs_choices) choices.add(i.id)
  return {
    channels, tills: at(catalog?.tills), kiosks: at(catalog?.kiosks), choices,
    charges: Object.fromEntries((catalog?.charges || []).map(c => [c.id, c])),
  }
}

const TONES = {
  where: { box: 'border-slate-300 bg-slate-50', head: 'text-slate-700', ring: 'ring-slate-400' },
  when: { box: 'border-amber-300 bg-amber-50', head: 'text-amber-800', ring: 'ring-amber-400' },
  if: { box: 'border-sky-300 bg-sky-50', head: 'text-sky-800', ring: 'ring-sky-400' },
  then: { box: 'border-emerald-300 bg-emerald-50', head: 'text-emerald-800', ring: 'ring-emerald-500' },
  look: { box: 'border-rose-300 bg-rose-50', head: 'text-rose-800', ring: 'ring-rose-400' },
}

function FlowBox({ part, title, icon: Icon, lines, active, onClick, empty }) {
  const t = TONES[part]
  return (
    <button type="button" onClick={onClick} aria-pressed={active} data-testid={'box-' + part}
      className={cn('w-full text-left rounded-2xl border-2 px-4 py-3 min-h-[88px] touch-manipulation transition-shadow hover:shadow-md',
        t.box, active && cn('ring-4 ring-offset-2', t.ring))}>
      <span className={cn('flex items-center gap-2 text-xs font-bold uppercase tracking-wide', t.head)}>
        <Icon className="w-4 h-4" /> {title}
      </span>
      <span className="mt-1.5 block space-y-1">
        {lines.length
          ? lines.map((l, i) => <span key={i} className="block text-sm" data-testid={'box-' + part + '-line'}>{l}</span>)
          : <span className="block text-sm text-muted-foreground">{empty}</span>}
      </span>
    </button>
  )
}

const Arrow = () => <div className="flex justify-center py-1 text-muted-foreground" aria-hidden><ArrowDown className="w-5 h-5" /></div>

function Chip({ on, onClick, children, testid, warn }) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick} data-testid={testid}
      className={cn('min-h-[48px] px-4 rounded-full border text-sm touch-manipulation',
        on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted', warn && on && 'bg-amber-600 border-amber-700')}>
      {children}
    </button>
  )
}

const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

// ── The panels ───────────────────────────────────────────────

function WhenPanel({ f, set, setKind }) {
  return (
    <Section title="When" hint="What the flow does, and when.">
      <Field group label="What it does">
        <Segmented value={f.kind} options={FLOW_KIND_OPTIONS} onChange={v => v !== f.kind && setKind(v)} className="flex-wrap" />
      </Field>
      {f.kind === 'ask' ? (
        <>
          <Field group label="When it asks">
            <Segmented value={f.trigger} options={TRIGGERS} onChange={v => set({ trigger: v })} className="flex-wrap" />
          </Field>
          <p className="text-xs text-muted-foreground -mt-2" data-testid="when-hint">
            {f.trigger === 'checkout'
              ? 'Before payment starts (Pay, Exact cash or card, a Pay by button): the prompt shows once on the order, then payment carries on.'
              : 'As a dish is put on the order (from the menu, a button or a meal deal): the prompt shows straight after it.'}
          </p>
          {f.trigger === 'dish_added' && (
            <Toggle label="Ask every time a dish sets it off" checked={f.ask.every_time}
              onChange={v => set({ ask: { ...f.ask, every_time: v } })}
              hint="Off: once on an order. On: each time one of the dishes under If is added." />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="when-hint">
          As soon as the order matches what is under If, what is under Then goes on by itself; when the order stops matching it comes off again
          (a dish only until it is sent to the kitchen).
        </p>
      )}
    </Section>
  )
}

function IfPanel({ f, set, catalog }) {
  const m = f.match
  const setMatch = patch => set({ match: { ...m, ...patch } })
  const known = new Set((catalog?.channels || []).map(c => channelKey(c.name)))
  const strays = m.stream_names.filter(n => !known.has(channelKey(n)))
  const hasName = n => m.stream_names.some(x => channelKey(x) === channelKey(n))
  const flipName = n => setMatch({ stream_names: hasName(n) ? m.stream_names.filter(x => channelKey(x) !== channelKey(n)) : [...m.stream_names, n] })
  const types = (catalog?.order_types || []).filter(t => t.is_active || m.type_ids.includes(t.id))
  const strayTypes = m.type_ids.filter(id => !types.some(t => t.id === id))
  const dishAdded = f.kind === 'ask' && f.trigger === 'dish_added'
  return (
    <Section title="If" hint="What the order needs. Each kind you pick must hold; any one of its choices will do. Nothing picked: every order.">
      <Field group label="The channel is" hint="Channels are revenue streams, by name: every location's stream with that name.">
        <div className="flex flex-wrap gap-2" data-testid="if-channels">
          {(catalog?.channels || []).map(c => (
            <Chip key={channelKey(c.name)} on={hasName(c.name)} onClick={() => flipName(c.name)} testid="if-channel">
              {c.name} <span className="opacity-70 text-xs">({c.venues.length === 1 ? c.venues[0].name : c.venues.length + ' locations'})</span>
            </Chip>
          ))}
          {strays.map(n => (
            <Chip key={'stray' + n} on onClick={() => flipName(n)} warn testid="if-channel">{n} (no location has it)</Chip>
          ))}
          {!catalog?.channels?.length && !strays.length && <p className="text-xs text-muted-foreground">No revenue streams yet (Store tech → Revenue streams).</p>}
        </div>
      </Field>
      <Field group label="The order type is">
        <div className="flex flex-wrap gap-2" data-testid="if-types">
          {types.map(t => (
            <Chip key={t.id} on={m.type_ids.includes(t.id)} onClick={() => setMatch({ type_ids: toggle(m.type_ids, t.id) })} testid="if-type">
              {t.name}{!t.is_active && ' (switched off)'}
            </Chip>
          ))}
          {strayTypes.map(id => (
            <Chip key={id} on warn onClick={() => setMatch({ type_ids: toggle(m.type_ids, id) })} testid="if-type">An order type no longer there</Chip>
          ))}
        </div>
      </Field>
      <Field group label={dishAdded ? 'The dish added is' : 'The order has'}
        hint={dishAdded ? 'One of these dishes, or a dish from these sections, sets it off. Nothing picked: any dish.' : 'One of these dishes, or a dish from these sections. A whole section covers dishes added to it later too.'}>
        <div data-testid="if-dishes">
          <DishPicker catalog={catalog} allowSections itemIds={m.item_ids} sectionIds={m.section_ids} title={dishAdded ? 'The dish added is' : 'The order has'}
            emptyLabel="Pick dishes or sections" onChange={v => setMatch({ item_ids: v.item_ids, section_ids: v.section_ids })} />
        </div>
      </Field>
      <Field group label="Not when the order has" hint="One of these is enough to stop it.">
        <div data-testid="if-not-dishes">
          <DishPicker catalog={catalog} allowSections itemIds={m.not_item_ids} sectionIds={m.not_section_ids} title="Not when the order has"
            emptyLabel="Pick dishes or sections" onChange={v => setMatch({ not_item_ids: v.item_ids, not_section_ids: v.section_ids })} />
        </div>
      </Field>
      {f.kind === 'ask' && (
        <Toggle label="Not when the order has one of the dishes offered" checked={f.ask.skip_if_has}
          onChange={v => set({ ask: { ...f.ask, skip_if_has: v } })}
          hint="Someone who has a drink already isn't asked about drinks." />
      )}
      <p className="text-xs text-muted-foreground">Dishes a flow put on the order never count here, so one flow can't set off another (or itself).</p>
    </Section>
  )
}

function AskThen({ f, set, catalog, names, readOnly }) {
  const [picking, setPicking] = useState(false)
  const ids = f.ask.item_ids
  const setIds = next => set({ ask: { ...f.ask, item_ids: next.slice(0, ASK_CHOICES_MAX) } })
  return (
    <>
      <Field label="The question" hint="e.g. Add a drink? Make it a large?">
        <input className={inputCls} value={f.ask.title} maxLength={ASK_TITLE_MAX} data-testid="then-title"
          onChange={e => set({ ask: { ...f.ask, title: e.target.value } })} />
      </Field>
      <Field label="A line under it (optional)" hint="e.g. Our lemonade is made fresh every morning.">
        <input className={inputCls} value={f.ask.message} maxLength={ASK_MESSAGE_MAX} data-testid="then-message"
          onChange={e => set({ ask: { ...f.ask, message: e.target.value } })} />
      </Field>
      <Field group label="The dishes it offers" hint="In this order on the prompt (drag to change). Sold out ones, and ones on no menu the till shows now, are left out there.">
        <div className="space-y-2" data-testid="then-offered">
          {ids.length > 0 && (
            <SortableRows items={ids.map(id => ({ id }))} locked={readOnly} onReorder={setIds}
              renderItem={({ id }) => (
                <div className="flex items-center gap-2" data-testid="then-offered-row">
                  <span className="flex-1 min-w-0 text-sm">{names.items[id] || 'A dish no longer on the menu'}</span>
                  {names.prices[id] != null && <span className="text-xs text-muted-foreground tabular-nums">{money(names.prices[id])}</span>}
                  {!readOnly && (
                    <button type="button" onClick={() => setIds(ids.filter(x => x !== id))} aria-label={'Take out ' + (names.items[id] || 'the dish')}
                      className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )} />
          )}
          <button type="button" onClick={() => setPicking(true)} data-testid="then-offered-pick"
            className="inline-flex items-center gap-2 min-h-[48px] px-4 border rounded-lg text-sm bg-background touch-manipulation">
            <ListChecks className="w-4 h-4" /> {ids.length ? 'Change the dishes' : 'Pick the dishes'}
          </button>
          {ids.length >= ASK_CHOICES_MAX && <p className="text-xs text-muted-foreground">A prompt offers up to {ASK_CHOICES_MAX} dishes.</p>}
        </div>
      </Field>
      {ids.length > 1 && (
        <Field group label="Staff can pick">
          <Segmented value={f.ask.pick} options={PICKS} onChange={v => set({ ask: { ...f.ask, pick: v } })} />
        </Field>
      )}
      <p className="text-xs text-muted-foreground">No thanks is always on the prompt. A dish with choices opens its choices window when picked.</p>
      {picking && (
        <DishPickerModal catalog={catalog} title="Dishes the prompt offers" itemIds={ids} sectionIds={[]}
          onCancel={() => setPicking(false)}
          onDone={v => {
            // Keep the order of the ones already there; new ones go last.
            const picked = new Set(v.item_ids)
            setIds([...ids.filter(id => picked.has(id)), ...v.item_ids.filter(id => !ids.includes(id))])
            setPicking(false)
          }} />
      )}
    </>
  )
}

function AddThen({ f, set, catalog, names, readOnly }) {
  const [picking, setPicking] = useState(false)
  const adds = f.adds
  const setAdds = next => set({ adds: next.slice(0, FLOW_ADDS_MAX) })
  const patchAt = (i, patch) => setAdds(adds.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const charges = (catalog?.charges || []).filter(c => !adds.some(a => a.kind === 'charge' && a.charge_id === c.id))
  const full = adds.length >= FLOW_ADDS_MAX
  const chargeOf = id => (catalog?.charges || []).find(c => c.id === id)
  return (
    <>
      <div className="space-y-2" data-testid="then-adds">
        {adds.map((a, i) => (
          <div key={a.kind + (a.item_id || a.charge_id)} className="rounded-xl border bg-background p-3 space-y-2" data-testid="then-add">
            <div className="flex items-center gap-2">
              {a.kind === 'charge' ? <ReceiptText className="w-4 h-4 text-violet-700 shrink-0" /> : <Sparkles className="w-4 h-4 text-violet-700 shrink-0" />}
              <span className="flex-1 min-w-0 text-sm font-medium">
                {a.kind === 'charge'
                  ? (names.charges[a.charge_id] || 'A charge no longer on the list') + (chargeOf(a.charge_id) ? ' · ' + chargeValueText(chargeOf(a.charge_id)) : '')
                  : (names.items[a.item_id] || 'A dish no longer on the menu')}
              </span>
              {!readOnly && (
                <button type="button" onClick={() => setAdds(adds.filter((_, j) => j !== i))} aria-label="Take it out of the flow"
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {a.kind === 'dish' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">How many</span>
                <button type="button" aria-label="One fewer" disabled={a.qty <= 1} onClick={() => patchAt(i, { qty: a.qty - 1 })}
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg border touch-manipulation disabled:opacity-40"><Minus className="w-4 h-4" /></button>
                <span className="w-8 text-center text-sm tabular-nums" data-testid="then-add-qty">{a.qty}</span>
                <button type="button" aria-label="One more" disabled={a.qty >= FLOW_ADD_QTY_MAX} onClick={() => patchAt(i, { qty: a.qty + 1 })}
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg border touch-manipulation disabled:opacity-40"><Plus className="w-4 h-4" /></button>
                {names.prices[a.item_id] != null && <span className="text-xs text-muted-foreground ml-auto tabular-nums">{money(names.prices[a.item_id] * a.qty)}</span>}
              </div>
            )}
            <Toggle label="Staff can take it off" checked={a.removable} onChange={v => patchAt(i, { removable: v })}
              hint={a.removable
                ? 'Taken off, it stays off on that order.'
                : a.kind === 'charge' ? 'Taking it off needs a manager every time (whatever the Charges list says).' : 'Taking it off or voiding it needs a manager every time.'} />
          </div>
        ))}
        {!adds.length && <p className="text-sm text-muted-foreground">Nothing yet: add a dish or a charge.</p>}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => setPicking(true)} disabled={full} data-testid="then-add-dish"><Plus className="w-4 h-4" /> Add a dish</Btn>
          <select className={cn(inputCls, 'w-auto min-w-[200px] h-11')} value="" disabled={full || !charges.length} data-testid="then-add-charge"
            aria-label="Add a charge" onChange={e => e.target.value && setAdds([...adds, { kind: 'charge', charge_id: e.target.value, removable: true }])}>
            <option value="">{charges.length ? 'Add a charge…' : 'No more charges on the list'}</option>
            {charges.map(c => <option key={c.id} value={c.id}>{c.name} · {chargeValueText(c)}</option>)}
          </select>
        </div>
      )}
      {full && <p className="text-xs text-muted-foreground">A flow adds up to {FLOW_ADDS_MAX} things.</p>}
      <p className="text-xs text-muted-foreground">
        Charges come from Store tech → Charges. A charge the location's table already puts on the order isn't put on twice.
      </p>
      {picking && (
        <DishPickerModal catalog={catalog} title="Dishes it adds" itemIds={[]} sectionIds={[]}
          onCancel={() => setPicking(false)}
          onDone={v => {
            const fresh = v.item_ids.filter(id => !adds.some(a => a.kind === 'dish' && a.item_id === id))
            setAdds([...adds, ...fresh.map(id => ({ kind: 'dish', item_id: id, qty: 1, removable: true }))])
            setPicking(false)
          }} />
      )}
    </>
  )
}

function ThenPanel(props) {
  const { f } = props
  return (
    <Section title="Then" hint={f.kind === 'ask' ? 'The prompt staff see.' : 'What goes on the order by itself.'}>
      {f.kind === 'ask' ? <AskThen {...props} /> : <AddThen {...props} />}
    </Section>
  )
}

function WherePanel({ f, set, catalog }) {
  const venues = catalog?.venues || []
  return (
    <Section title="Where" hint="The locations it runs at, and on which tills, kiosks and online ordering.">
      <Field group label="Locations">
        <Segmented value={f.venue_ids == null ? 'all' : 'some'} onChange={v => set({ venue_ids: v === 'all' ? null : (f.venue_ids || []) })}
          options={[{ value: 'all', label: 'Every location' }, { value: 'some', label: 'These locations' }]} className="flex-wrap" />
      </Field>
      {f.venue_ids != null && (
        <div className="flex flex-wrap gap-2" data-testid="where-venues">
          {venues.map(v => <Chip key={v.id} on={f.venue_ids.includes(v.id)} onClick={() => set({ venue_ids: toggle(f.venue_ids, v.id) })} testid="where-venue">{v.name}</Chip>)}
        </div>
      )}
      <Field group label="Runs on">
        <div className="flex flex-wrap gap-2" data-testid="where-apps">
          {FLOW_APPS.map(a => (
            <Chip key={a} on={f.apps.includes(a)} testid={'where-app-' + a}
              onClick={() => set({ apps: FLOW_APPS.filter(x => (x === a ? !f.apps.includes(a) : f.apps.includes(x))) })}>
              {APP_NAMES[a]}
            </Chip>
          ))}
        </div>
      </Field>
      {f.apps.includes('till') && (
        <DevicePicks f={f} set={set} venues={venues} list={catalog?.tills || []} field="till_ids"
          word="till" words="tills" allLabel="Every till there" someLabel="These tills" testid="where-till" />
      )}
      {f.apps.includes('kiosk') && (
        <DevicePicks f={f} set={set} venues={venues} list={catalog?.kiosks || []} field="kiosk_ids"
          word="kiosk" words="kiosks" allLabel="Every kiosk there" someLabel="These kiosks" testid="where-kiosk" />
      )}
      {f.apps.includes('online') && (
        <p className="text-xs text-muted-foreground" data-testid="where-online-note">
          Online ordering: the order is checked again when it is placed, so a dish or charge it adds can&apos;t be left out by the guest unless it may be taken off.
        </p>
      )}
    </Section>
  )
}

/** Every till (or kiosk) at the locations, or the ones picked, by location. */
function DevicePicks({ f, set, venues, list, field, word, words, allLabel, someLabel, testid }) {
  const picked = f[field]
  const shown = list.filter(t => f.venue_ids == null || f.venue_ids.includes(t.venue_id) || picked?.includes(t.id))
  const byVenue = venues.map(v => ({ ...v, devices: shown.filter(t => t.venue_id === v.id) })).filter(v => v.devices.length)
  return (
    <>
      <Field group label={words[0].toUpperCase() + words.slice(1)}>
        <Segmented value={picked == null ? 'all' : 'some'} onChange={v => set({ [field]: v === 'all' ? null : (picked || []) })}
          options={[{ value: 'all', label: allLabel }, { value: 'some', label: someLabel }]} className="flex-wrap" />
      </Field>
      {picked != null && (
        <div className="space-y-3" data-testid={testid + 's'}>
          {byVenue.map(v => (
            <div key={v.id}>
              <p className="text-xs font-semibold text-muted-foreground mb-1">{v.name}</p>
              <div className="flex flex-wrap gap-2">
                {v.devices.map(t => (
                  <Chip key={t.id} on={picked.includes(t.id)} onClick={() => set({ [field]: toggle(picked, t.id) })} testid={testid}>
                    {t.name}{t.short_code ? ' (' + t.short_code + ')' : ''}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
          {!byVenue.length && <p className="text-xs text-muted-foreground">No {words} linked {f.venue_ids == null ? 'yet' : 'at these locations'}.</p>}
          {byVenue.length > 0 && !picked.length && <p className="text-xs text-amber-700">Pick at least one {word}.</p>}
        </div>
      )}
    </>
  )
}

// ── Preview ──────────────────────────────────────────────────

function Preview({ f, names, look }) {
  if (f.kind === 'ask') return <PromptPreview f={f} names={names} {...look} />
  return (
    <Section title="On the order" hint={f.apps.includes('kiosk') || f.apps.includes('online')
      ? 'What staff see on the order. Guests see them on their order too, with Remove on the ones they may take off.'
      : 'What staff see on the order.'}>
      <div className="rounded-xl border bg-background divide-y" data-testid="preview-order">
        <div className="px-3 py-2 text-sm text-muted-foreground">The dishes staff put on…</div>
        {f.adds.map(a => (
          <div key={a.kind + (a.item_id || a.charge_id)} className="px-3 py-2 flex items-center gap-2 bg-violet-50" data-testid="preview-line">
            {a.removable ? <Unlock className="w-4 h-4 text-violet-700 shrink-0" /> : <Lock className="w-4 h-4 text-violet-700 shrink-0" />}
            <span className="flex-1 min-w-0 text-sm">
              {a.kind === 'dish'
                ? (a.qty > 1 ? a.qty + ' x ' : '') + (names.items[a.item_id] || 'A dish no longer on the menu')
                : names.charges[a.charge_id] || 'A charge no longer on the list'}
              <span className="block text-xs text-violet-800">Added by {f.name || 'this flow'}{a.removable ? '' : ' · a manager to take off'}</span>
            </span>
            {a.kind === 'dish' && names.prices[a.item_id] != null && <span className="text-sm tabular-nums">{money(names.prices[a.item_id] * a.qty)}</span>}
          </div>
        ))}
        {!f.adds.length && <div className="px-3 py-2 text-sm text-muted-foreground">What the flow adds shows here.</div>}
      </div>
    </Section>
  )
}

// ── The page ─────────────────────────────────────────────────

export default function OrderFlowDesigner() {
  const { id } = useParams()
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canManage } = usePermission('pos_setup')
  const { data: saved, error, isLoading } = useQuery({ queryKey: ['order-flow', id], queryFn: () => api.get('/pos/order-flows/' + id) })
  const { data: catalog } = useQuery({ queryKey: ['order-flows-catalog'], queryFn: () => api.get('/pos/order-flows/catalog') })
  const [draft, setDraft] = useState(null)
  const [part, setPart] = useState('when')
  const [leaving, setLeaving] = useState(false)
  // The channel whose look is edited and previewed, and the kiosk design the kiosk look is shown in.
  const [lookApp, setLookApp] = useState('till')
  const [kioskId, setKioskId] = useState(null)
  // What the other kind had, so switching kind and back loses nothing.
  const stash = useRef({})

  useEffect(() => { if (saved) setDraft(asDraft(saved)) }, [saved])

  const save = useMutation({
    mutationFn: () => api.put('/pos/order-flows/' + id, { ...draft, name: draft.name.trim() || saved.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-flow', id] })
      qc.invalidateQueries({ queryKey: ['order-flows'] })
    },
  })

  const names = useMemo(() => namesOf(catalog), [catalog])
  const places = useMemo(() => placesOf(catalog), [catalog])

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={Workflow} title="Order flow" />
        <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}</div>
      </div>
    )
  }

  const f = draft
  const set = patch => setDraft(d => asDraft({ ...d, ...patch }))
  const setKind = kind => {
    if (kind !== 'ask' && part === 'look') setPart('then')
    stash.current[f.kind] = f.kind === 'ask' ? { ask: f.ask, trigger: f.trigger } : { adds: f.adds }
    const back = stash.current[kind]
    const fresh = newOrderFlow(f.id, kind)
    setDraft(asDraft({
      ...f, kind,
      trigger: kind === 'ask' ? (back?.trigger || 'dish_added') : 'match',
      ask: kind === 'ask' ? (back?.ask || fresh.ask) : null,
      adds: kind === 'add' ? (back?.adds || []) : [],
    }))
  }
  // Checked and compared tidied (the words trimmed), shown as typed.
  const clean = cleanFlow(f)
  const dirty = JSON.stringify(clean) !== JSON.stringify(cleanFlow(saved))
  const problems = flowProblems(clean)
  const warnings = flowWarnings(clean, { ...places, names })
  const blocked = f.on && problems.length > 0
  const back = () => (dirty ? setLeaving(true) : navigate('/pos/flows'))
  const ifLines = flowIfLines(clean, names)
  const thenLines = flowThenLines(clean, names)
  const panelProps = { f, set, setKind, catalog, names, readOnly: !canManage }
  const apps = lookApps(f)
  const look = {
    app: apps.includes(lookApp) ? lookApp : apps[0], setApp: setLookApp,
    themes: catalog?.themes, kioskId, setKioskId,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Workflow} title={'Order flow: ' + saved.name}>
        <Btn onClick={back} data-testid="of-back"><ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Order flows</span></Btn>
        {canManage && (
          <>
            <Btn disabled={!dirty || save.isPending} onClick={() => { setDraft(asDraft(saved)); save.reset() }} data-testid="of-discard">Discard</Btn>
            <Btn variant="primary" disabled={!dirty || save.isPending || blocked} onClick={() => save.mutate()} data-testid="of-save"
              title={blocked ? 'Fix the problems first, or switch it off to save it as it is' : undefined}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save' : 'Saved'}
            </Btn>
          </>
        )}
      </PageHeader>
      {leaving && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-amber-50 text-amber-900 text-sm" role="alert" data-testid="of-leave">
          <span className="flex-1 min-w-[200px]">Leave without saving your changes?</span>
          <Btn variant="danger" onClick={() => navigate('/pos/flows')}>Leave</Btn>
          <Btn onClick={() => setLeaving(false)}>Stay</Btn>
        </div>
      )}
      <div className="flex-1 overflow-y-auto" data-testid="of-scroller">
        <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start max-w-6xl mx-auto">
          <div className="space-y-4 min-w-0">
            {!canManage && <ReadOnlyNotice what="order flows" />}
            <ErrorNote error={save.error} />
            <ReadOnlyFieldset disabled={!canManage}>
              <div className="rounded-xl border bg-background p-4 flex flex-wrap items-end gap-3">
                <span className={cn('w-11 h-11 rounded-lg flex items-center justify-center shrink-0', f.kind === 'add' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800')}>
                  <KindIcon kind={f.kind} className="w-5 h-5" />
                </span>
                <label className="flex-1 min-w-[200px]">
                  <span className="block text-xs font-medium text-muted-foreground mb-1">Name</span>
                  <input className={inputCls} value={f.name} maxLength={FLOW_NAME_MAX} onChange={e => set({ name: e.target.value })} data-testid="of-name" />
                </label>
                <OnSwitch on={f.on} label={f.on ? 'Switch the flow off' : 'Switch the flow on'} onChange={v => set({ on: v })} testid="of-on" />
              </div>
            </ReadOnlyFieldset>

            <div className="rounded-xl border bg-background p-4" data-testid="of-canvas">
              <FlowBox part="where" title="Where" icon={MapPin} lines={[flowWhereText(clean, names)]} active={part === 'where'} onClick={() => setPart('where')} />
              <Arrow />
              <FlowBox part="when" title="When" icon={Clock} lines={[flowWhenText(clean)]} active={part === 'when'} onClick={() => setPart('when')} />
              <Arrow />
              <FlowBox part="if" title="If" icon={Filter} lines={ifLines} empty="Every order" active={part === 'if'} onClick={() => setPart('if')} />
              <Arrow />
              <FlowBox part="then" title="Then" icon={Sparkles} lines={thenLines} active={part === 'then'} onClick={() => setPart('then')} />
              {f.kind === 'ask' && (
                <div className="mt-3">
                  <FlowBox part="look" title="Look" icon={Palette} lines={lookLines(clean)} active={part === 'look'} onClick={() => setPart('look')} />
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">Tap a box to change it.</p>
            </div>

            {(problems.length > 0 || warnings.length > 0) && (
              <div className="space-y-2" data-testid="of-notes">
                {problems.map(p => (
                  <p key={p.code} className="flex items-start gap-2 text-sm text-destructive" data-testid="of-problem" data-code={p.code}>
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {p.message}
                  </p>
                ))}
                {problems.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="of-problem-note">
                    {f.on ? 'It can\'t be saved switched on until these are fixed: switch it off to save it as it is.' : 'Saved switched off: it runs once these are fixed and it is switched on.'}
                  </p>
                )}
                {warnings.map(w => (
                  <p key={w.code + w.message} className="flex items-start gap-2 text-sm text-amber-800" data-testid="of-warning" data-code={w.code}>
                    <Info className="w-4 h-4 mt-0.5 shrink-0" /> {w.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 min-w-0 lg:sticky lg:top-0" data-testid="of-panel">
            <ReadOnlyFieldset disabled={!canManage}>
              {part === 'where' && <WherePanel {...panelProps} />}
              {part === 'when' && <WhenPanel {...panelProps} />}
              {part === 'if' && <IfPanel {...panelProps} />}
              {part === 'then' && <ThenPanel {...panelProps} />}
            </ReadOnlyFieldset>
            {/* The look panel has its own read-only part: its channel switch stays usable for viewers. */}
            {part === 'look' && f.kind === 'ask' && <LookPanel f={f} set={set} readOnly={!canManage} {...look} />}
            <Preview f={f} names={names} look={look} />
          </div>
        </div>
      </div>
    </div>
  )
}
