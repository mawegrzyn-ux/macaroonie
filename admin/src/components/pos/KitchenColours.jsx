// src/components/pos/KitchenColours.jsx
//
// Store tech > Kitchen screens > Ticket colours (migration 207): the
// background of a dish row and of a ticket's top in each state, the timer's
// amber and late colours, and dish names coloured by their menu section,
// for every kitchen screen of the venue. A colour not set keeps the standard
// look. The preview draws a ticket with the same colours the kitchen screen
// uses (shared/pos/kitchenColours.js). One Save for the whole card.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, X, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Btn, ErrorNote, inputCls } from './shared'
import { ColourMenuButton } from '@/components/ColourPicker'
import {
  KITCHEN_COLOURS, KITCHEN_COLOUR_GROUPS, SECTION_COLOURS_MAX, ticketColours, normaliseKitchenColours, sectionKey,
} from '@shared/pos/kitchenColours.js'

// A section colour to start from when a section is added (changed after).
const START_COLOURS = ['#facc15', '#fb923c', '#38bdf8', '#f472b6', '#a3e635', '#c084fc', '#2dd4bf', '#f87171']

/** One colour: the chip shows the colour in use (set, or the standard one); tap to change. */
function ColourRow({ label, hint, value, standard, onChange, clearable = true, testId }) {
  const shown = value || standard
  return (
    <div className="flex items-center gap-3 min-h-[52px]" data-testid={testId}>
      <ColourMenuButton title={label + ': colour'} onPick={onChange} onClear={value && clearable ? () => onChange(null) : undefined} clearLabel="Standard colour"
        className="w-12 h-12 p-1 rounded-lg border bg-background">
        <span className="block w-full h-full rounded-md border border-black/10" style={{ background: shown }} data-testid={testId ? testId + '-chip' : undefined} />
      </ColourMenuButton>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{value ? <span className="font-mono">{value}</span> : 'Standard'}{hint ? ' · ' + hint : ''}</p>
      </div>
    </div>
  )
}

/** A ticket drawn with these colours, as the kitchen screen draws it. */
export function TicketPreview({ colours }) {
  const c = ticketColours(colours)
  const named = colours.sections || []
  const row = (key, children, extra = {}) => (
    <div className="border-b border-black/60" style={{ background: c[key].bg, color: c[key].ink }} data-testid={'kc-row-' + key} {...extra}>
      <div style={c[key].dim < 1 ? { opacity: c[key].dim } : undefined}>{children}</div>
    </div>
  )
  const dish = (qty, name, { colour, tick, strike } = {}) => (
    <div className={cn('flex items-start gap-1.5 px-2 py-1 font-bold text-[14px]', strike && 'line-through')}>
      <span className="tabular-nums" style={colour ? { color: colour } : undefined}>{qty}</span>
      <span className="flex-1 min-w-0" style={colour ? { color: colour } : undefined}>{name}</span>
      {tick && <Check size={16} className="shrink-0" />}
      {strike && <span className="no-underline text-[10px] bg-red-600 text-white px-1 rounded">VOID</span>}
    </div>
  )
  const head = (key, title, word, timerKey) => (
    <div className="rounded-t px-2 py-1" style={{ background: c[key].bg, color: c[key].ink }} data-testid={'kc-head-' + key}>
      <div className="flex items-center gap-1.5 text-[13px] font-bold">
        <span className="flex-1 truncate">{title}</span>
        <span className="bg-white text-black font-black px-1.5 rounded text-[12px]">57</span>
        <span className="font-black px-1 rounded text-[12px] tabular-nums"
          style={timerKey ? { background: c[timerKey].bg, color: c[timerKey].ink } : { background: 'rgba(0,0,0,.3)', color: '#fff' }}
          data-testid={timerKey ? 'kc-timer-' + timerKey : undefined}>
          {timerKey === 'timer_late' ? '14:02' : timerKey === 'timer_warn' ? '9:30' : '3:12'}
        </span>
      </div>
      {word && <div className="text-[11px] font-black mt-0.5">{word}</div>}
    </div>
  )
  return (
    <div className="rounded-xl bg-black p-2 space-y-2 text-white select-none" data-testid="kc-preview">
      <div className="rounded overflow-hidden bg-[#0d0d0d]">
        {head('head', 'Tbl 4', null, null)}
        {row('todo', <>{dish(1, 'Cheeseburger')}
          <div className="pl-[22px] pr-2 py-0.5 text-[12px] bg-white text-red-600 font-bold">No onion</div>
          <div className="pl-[22px] pr-2 py-0.5 text-[12px] font-semibold">Medium rare</div></>)}
        {row('ticked', dish(2, 'Fries', { tick: true }))}
        {row('upcoming', <>{dish(1, 'Chicken wings')}<div className="px-2 pb-0.5 text-[11px] font-semibold opacity-80">At Grill</div></>)}
        <div className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-zinc-700 text-zinc-300">Hold · Desserts</div>
        {row('held', dish(1, 'Brownie'))}
        {row('voided', dish(1, 'Cola', { strike: true }))}
      </div>
      {named.length > 0 && (
        <div className="rounded overflow-hidden" data-testid="kc-names">
          {named.map(s => (
            <div key={s.name} className="border-b border-black/60" style={{ background: c.todo.bg }}>
              {dish(1, s.name, { colour: s.colour })}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {head('head_new', 'Tbl 9', 'NEW', null)}
        {head('head_rush', 'Counter', 'RUSH', 'timer_warn')}
        {head('head_prepared', 'Tbl 2', 'PREPARED', null)}
        {head('head_checked', 'Tbl 6', 'CHECKED', 'timer_late')}
      </div>
    </div>
  )
}

export default function TicketColoursCard({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const saved = normaliseKitchenColours(setup.settings?.kds_colours)
  const savedKey = JSON.stringify(saved)
  const [form, setForm] = useState(saved)
  useEffect(() => setForm(JSON.parse(savedKey)), [savedKey])
  const dirty = JSON.stringify(normaliseKitchenColours(form)) !== savedKey
  const save = useMutation({
    mutationFn: () => api.patch(`/pos/venues/${venueId}/settings`, { kds_colours: normaliseKitchenColours(form) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
  const setState = (key, v) => setForm(f => {
    const states = { ...f.states }
    if (v) states[key] = v
    else delete states[key]
    return { ...f, states }
  })
  // Section names on the venue's menus, once each (every menu's "Sides" is one).
  const names = useMemo(() => {
    const out = new Map()
    for (const s of setup.sections || []) {
      const k = sectionKey(s.title)
      if (k && !out.has(k)) out.set(k, String(s.title).trim().replace(/\s+/g, ' '))
    }
    return [...out.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [setup.sections])
  const onMenus = new Set(names.map(n => n.key))
  const used = new Set(form.sections.map(s => sectionKey(s.name)))
  const free = names.filter(n => !used.has(n.key))
  const addSection = key => {
    const n = names.find(x => x.key === key)
    if (!n) return
    setForm(f => ({ ...f, sections: [...f.sections, { name: n.name, colour: START_COLOURS[f.sections.length % START_COLOURS.length] }] }))
  }
  const setSection = (i, colour) => setForm(f => ({ ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, colour } : s)) }))
  const removeSection = i => setForm(f => ({ ...f, sections: f.sections.filter((_, j) => j !== i) }))

  return (
    <Section title="Ticket colours"
      hint="How tickets look on this venue's kitchen screens: the background of each dish and ticket top in each state, the timer, and dish names in a colour for their menu section. A colour not set keeps the standard look; words turn black or white to stay readable.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5 min-w-0">
          {KITCHEN_COLOUR_GROUPS.map(g => (
            <div key={g.key}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{g.label}</p>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {KITCHEN_COLOURS.filter(x => x.group === g.key).map(x => (
                  <ColourRow key={x.key} label={x.label} hint={x.hint} value={form.states[x.key] || null} standard={x.bg}
                    onChange={v => setState(x.key, v)} testId={'kc-' + x.key} />
                ))}
              </div>
            </div>
          ))}
          <div data-testid="kc-sections">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Dish names by section</p>
            <p className="text-xs text-muted-foreground mb-2">Dishes from a menu section show their name (and meal deal parts theirs) in its colour, on every state but voided. Sections go by name, so one colour covers that section in every menu.</p>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {form.sections.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2" data-testid="kc-section">
                  <div className="flex-1 min-w-0">
                    <ColourRow label={s.name} hint={onMenus.has(sectionKey(s.name)) ? null : 'no section with this name on this venue\'s menus'}
                      value={s.colour} standard={s.colour} clearable={false} onChange={v => v && setSection(i, v)} testId={'kc-section-' + i} />
                  </div>
                  <button type="button" onClick={() => removeSection(i)} aria-label={'Remove ' + s.name}
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            {form.sections.length < SECTION_COLOURS_MAX && (
              <select className={cn(inputCls, 'mt-2 sm:w-80')} value="" onChange={e => addSection(e.target.value)}
                aria-label="Colour a section's dishes" data-testid="kc-add-section" disabled={!free.length}>
                <option value="">{free.length ? 'Colour a section\'s dishes...' : names.length ? 'Every section has a colour' : 'No menu sections at this venue yet'}</option>
                {free.map(n => <option key={n.key} value={n.key}>{n.name}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</p>
          <TicketPreview colours={normaliseKitchenColours(form)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="kc-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {dirty && <Btn onClick={() => setForm(JSON.parse(savedKey))} data-testid="kc-undo">Undo changes</Btn>}
        <ErrorNote error={save.error} />
      </div>
    </Section>
  )
}
