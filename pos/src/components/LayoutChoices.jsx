// A dish's choices drawn in a till layout's Dish choices zones (Store tech >
// Till layouts; shared/pos/tillLayout.js choiceZones()) instead of the
// choices window: the must-pick groups (a group or combo step that needs at
// least one pick) in one zone, the optional ones in the other, or both in a
// zone showing all choices. Each group is a heading across the zone, then a
// button per option; groups an option opens (Steak: Cooking) and a picked
// dish's own options in a meal deal follow. The zone holding the must-pick
// choices also has the dish's name and the Add bar; Note & more opens the
// choices window (note, allergies, seat, course, price) with the picks so far.
//
// The picking rules are the choices window's (ItemModal.jsx toggleChoice(),
// tapStep(), ...), and the price comes from priceItem() as there.
//
// A zone can leave out the dish's name, its description and the prices
// (show_name, show_description, show_prices). With auto_add on the zone
// holding the must-pick choices, a tap on a must-pick choice that takes one
// pick adds the dish at once when nothing else is left to pick (no Add tap):
// optional choices tapped before it go on with it. The words on the choices
// sit where the zone says (align, valign: buttonTextStyle()); the headings
// stay on the left.
//
// More picks, more dishes (split_picks on the zone holding the must-pick
// choices; never with auto_add): a group of the dish that takes one pick
// (a protein, a size) takes more, each tap one more dish (shared/pos/
// pricing.js splitPicks()): Pad Thai with Chicken and Prawn adds two Pad
// Thai, one of each. Add puts a line on the order for each dish.

import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, AlertTriangle, X, PenLine } from 'lucide-react'
import { priceItem, lineGross, PREFIXES, groupChoice, splitPicks, splitsPicks } from '@shared/pos/pricing.js'
import { resolveSteps, stepRule, askedChoices } from '@shared/combos.js'
import { dealItem } from '@shared/pos/offers.js'
import { buttonTextStyle } from '@shared/pos/tillLayout.js'
import { cx, money } from './ui.jsx'
import ZoneGrid from './ZoneGrid.jsx'
import { tillItem, comboCtx } from '../lib/checkOps.js'
import { toggleChoice, oneLess, choiceHint, tapStep, stepLess, fixedText } from './ItemModal.jsx'

/**
 * The dish being added: its picks, quantity and price, and every cell its
 * choices need ({ kind: head | option | open | note, need, ... }).
 * opts.onAutoAdd(result): set when the layout adds the dish on the tap that
 * completes it (a must-pick choice taking one pick, nothing left to pick).
 * opts.split: more picks, more dishes (the result then carries split: one
 * selection per dish when there is more than one). Returns ok, error, total
 * (every dish, the quantity each) and count (dishes) for the Add bar.
 */
export function useChoiceBuilder(item, config, initial = null, { onAutoAdd = null, split = false } = {}) {
  const it = useMemo(() => tillItem(config, item.id), [config, item.id])
  const ctx = useMemo(() => comboCtx(config), [config])
  const [sel, setSel] = useState(() => ({ choices: {}, combo: {}, ...(initial?.selection || {}) }))
  // Picks are worked out from the latest selection (two taps between renders
  // don't lose one), and the tap that completes the dish can add it at once.
  const latest = useRef(sel)
  latest.current = sel
  const commit = fn => {
    const next = fn(latest.current)
    latest.current = next
    setSel(next)
    return next
  }
  const [qty, setQty] = useState(initial?.qty || 1)
  const [opened, setOpened] = useState({})
  const [modes, setModes] = useState({})
  const priced = useMemo(() => priceItem(it, sel, ctx), [it, sel, ctx])
  // More picks, more dishes: a selection per dish, each priced on its own.
  const dishes = useMemo(() => (split ? splitPicks(it.pos_choices, sel) : null), [split, it, sel])
  const many = !!(dishes?.ok && dishes.selections.length > 1)
  const each = useMemo(() => (many ? dishes.selections.map(x => priceItem(it, x, ctx)) : null), [many, dishes, it, ctx])
  const ok = dishes && !dishes.ok ? false : many ? each.every(p => p.ok) : priced.ok
  const error = dishes && !dishes.ok ? dishes.error : many ? each.find(p => !p.ok)?.error || null : priced.error || null
  const total = !ok ? null : many ? each.reduce((n, p) => n + lineGross({ ...p, qty }), 0) : lineGross({ ...priced, qty })
  const isCombo = it.kind === 'combo'
  const steps = isCombo ? resolveSteps(it, sel.combo || {}, ctx) : null
  const groupsById = config.groups || {}
  const open = key => setOpened(o => ({ ...o, [key]: true }))
  // What Add puts on the check (as the choices window does).
  const resultOf = (s, st) => ({
    selection: { ...s, combo: isCombo ? (st ? st.picks : s.combo) : undefined },
    qty, seat: undefined, course: undefined, note: '', allergies: [], unit_price: null,
  })
  // A tap on a must-pick choice that takes one pick (rule: the group or
  // step), with the selection it made: added at once when it completes the dish.
  const quick = (next, rule) => {
    if (!onAutoAdd || !((rule?.min || 0) >= 1 && rule?.max === 1)) return
    if (!priceItem(it, next, ctx).ok) return
    onAutoAdd(resultOf(next, isCombo ? resolveSteps(it, next.combo || {}, ctx) : null))
  }

  const cells = []
  // One option group (and the groups its picked options open). top: one of
  // the dish's own groups (not a nested one or a meal deal part's): with
  // split on, one that takes one pick takes more, a dish each.
  const group = ({ choice, value, set, title, path, top = false }) => {
    const need = (choice.min || 0) >= 1
    if (choice.on_request && !opened[path] && !value.length) {
      cells.push({ kind: 'open', key: path + ':open', need, label: title, onTap: () => open(path) })
      return
    }
    const more = split && top && splitsPicks(choice)
    const mode = modes[path] || null
    const counted = value.filter(e => e.prefix !== 'no').length
    cells.push({
      kind: 'head', key: path + ':head', need, title,
      rule: choiceHint(choice) + (choice.repeat ? ' · tap again for more' : '') + (more ? ' · more picks, more dishes' : ''),
      bad: !!choice.min && counted < choice.min,
      prefixes: choice.prefixes ? { mode, set: m => setModes(x => ({ ...x, [path]: m })) } : null,
    })
    for (const o of choice.options) {
      const e = value.find(x => x.id === o.id)
      const n = value.filter(x => x.id === o.id).length
      const pre = PREFIXES.find(p => p.key === e?.prefix)
      cells.push({
        kind: 'option', key: path + ':' + o.id, need,
        label: ((choice.repeat || more) && n > 1 ? n + ' x ' : '') + (pre ? pre.label + ' ' : '') + o.label,
        price: o.price_pence ? (choice.mode === 'extra' ? '+' : '') + money(o.price_pence) : '',
        on: e ? (e.prefix === 'no' ? 'no' : 'on') : null,
        // More picks, more dishes: every tap is one more (a dish each).
        onTap: more
          ? () => set([...value, { id: o.id }])
          : () => { const next = toggleChoice(choice, value, o, mode); if (next !== value) quick(set(next), choice) },
        onLess: (choice.repeat || more) && n > 0 ? () => set(oneLess(value, o.id)) : null,
      })
    }
    value.filter(e => e.prefix !== 'no').forEach((e, idx) => {
      const o = choice.options.find(x => x.id === e.id)
      const child = o?.child_group_id && groupsById[o.child_group_id]
      if (!child) return
      const cc = groupChoice(child, { nested: true })
      // The same option picked twice (more dishes, repeats): Steak 1, Steak 2.
      const same = value.filter(x => x.id === e.id && x.prefix !== 'no')
      const nth = same.length > 1 ? ' ' + (same.indexOf(e) + 1) : ''
      group({
        choice: cc, title: o.label + nth + ': ' + cc.name, path: path + '/' + idx + '/' + cc.key,
        value: ((e.children || {})[cc.key]) || [],
        set: v => set(value.map(x => (x === e ? { ...x, children: { ...(x.children || {}), [cc.key]: v } } : x))),
      })
    })
  }

  if (isCombo && steps) {
    const setStep = (id, list) => commit(s => ({ ...s, combo: { ...(s.combo || {}), [id]: list } }))
    for (const { step, choices, auto } of steps.steps.filter(s => s.shown)) {
      const got = steps.picks[step.id] || []
      const need = (step.min || 0) >= 1
      const path = 'step:' + step.id
      if (step.ask === 'button' && !got.length && !opened[path]) {
        cells.push({ kind: 'open', key: path + ':open', need, label: step.name, onTap: () => open(path) })
        continue
      }
      const count = c => got.filter(e => e.option_id === c.option_id && (e.item_id || null) === c.item_id).length
      const autoCharge = auto ? choices.reduce((n, c) => n + count(c) * (c.price_pence || 0), 0) : 0
      cells.push({
        kind: 'head', key: path + ':head', need, title: step.name,
        rule: auto ? 'Included' : stepRule(step) + (step.repeat ? ' · tap again for more' : ''),
        charge: auto && autoCharge ? '+' + money(autoCharge) : '',
        bad: got.length < step.min,
      })
      if (!auto) {
        for (const c of choices) {
          const n = count(c)
          cells.push({
            kind: 'option', key: path + ':' + c.key, need,
            label: (step.repeat && n > 1 ? n + ' x ' : '') + c.label,
            price: c.sold_out ? 'Sold out' : c.price_pence ? '+' + money(c.price_pence) : '',
            on: n > 0 ? 'on' : null, disabled: !!c.sold_out,
            onTap: () => { const next = tapStep(step, got, c); if (next !== got) quick(setStep(step.id, next), step) },
            onLess: step.repeat && n > 0 ? () => setStep(step.id, stepLess(got, c)) : null,
          })
        }
      }
      got.forEach((e, idx) => {
        const choice = choices.find(c => c.option_id === e.option_id && (c.item_id || null) === (e.item_id || null))
        const part = e.item_id ? dealItem(config, e.item_id, choice?.groups) : null
        const asked = askedChoices(part?.pos_choices)
        const fixed = fixedText(part)
        const same = got.filter(x => x.item_id === e.item_id).length > 1
        const label = (choice?.label || '') + (same ? ' ' + got.slice(0, idx + 1).filter(x => x.item_id === e.item_id).length : '')
        if (fixed) cells.push({ kind: 'note', key: path + '/' + idx + ':fixed', need, text: label + ': ' + fixed })
        for (const c of asked) {
          group({
            choice: c, title: label + ': ' + c.name, path: path + '/' + idx + '/' + c.key,
            value: ((e.choices || {})[c.key]) || [],
            set: v => setStep(step.id, got.map((x, j) => (j === idx ? { ...x, choices: { ...(x.choices || {}), [c.key]: v } } : x))),
          })
        }
      })
    }
  }
  for (const c of it.pos_choices || []) {
    group({
      choice: c, title: c.name, path: 'g:' + c.key, top: true,
      value: (sel.choices || {})[c.key] || [],
      set: v => commit(s => ({ ...s, choices: { ...(s.choices || {}), [c.key]: v } })),
    })
  }

  const result = () => {
    const r = resultOf(sel, priced.ok ? steps : null)
    return many ? { ...r, split: dishes.selections.map(x => ({ ...x, combo: r.selection.combo })) } : r
  }
  return { it, sel, qty, setQty, priced, cells, result, ok, error, total, count: many ? dishes.selections.length : 1 }
}

function Cell({ c, zone }) {
  const prices = zone.show_prices !== false
  const place = buttonTextStyle(zone)
  if (c.kind === 'head') {
    return (
      <div className="h-full flex items-center gap-2 px-1 min-w-0" data-testid="choice-head" data-need={c.need ? '1' : '0'}>
        <div className="min-w-0 flex flex-col leading-tight">
          <span className="truncate">{c.title}</span>
          <span className={cx('text-xs font-semibold truncate', c.bad ? 'text-bad' : 'text-muted')} style={{ fontSize: Math.max(12, Math.round(zone.font * 0.72)) }}>{c.rule}{prices && c.charge ? ' · ' + c.charge : ''}</span>
        </div>
        {c.prefixes && (
          <div className="ml-auto flex gap-1 shrink-0">
            {[{ key: null, label: 'Add' }, ...PREFIXES].map(p => (
              <button key={p.label} className={cx('chip min-h-[40px] px-3 text-sm', c.prefixes.mode === p.key && 'chip-on')} onClick={() => c.prefixes.set(p.key)}>{p.label}</button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (c.kind === 'note') return <div className="h-full flex items-center px-1 text-muted truncate" data-testid="choice-fixed">{c.text}</div>
  if (c.kind === 'open') {
    return (
      <button className="w-full h-full rounded-xl border-2 border-dashed border-line flex flex-col px-2 py-1 touch-manipulation"
        style={place} onClick={c.onTap} data-testid="choice-open">
        <span className="inline-flex items-center gap-2 max-w-full" data-testid="button-words"><Plus size={18} className="shrink-0" /><span className="truncate">{c.label}</span></span>
      </button>
    )
  }
  // The one-less badge goes in the corner away from the words.
  const lessLeft = place.textAlign === 'right'
  return (
    <>
      <button onClick={c.onTap} disabled={c.disabled} data-testid="choice-option" data-on={c.on || ''}
        className={cx('w-full h-full rounded-xl border-2 px-2 py-1 flex flex-col leading-tight touch-manipulation active:scale-[0.98] transition-transform',
          c.on === 'on' ? 'bg-brand text-white border-brand' : c.on === 'no' ? 'bg-bad-soft border-bad text-bad' : 'bg-white border-line',
          c.disabled && 'line-through text-muted')}
        style={place}>
        <span className="line-clamp-3" data-testid="button-words">{c.label}</span>
        {c.price && (prices || c.disabled) ? <span className="text-sm opacity-90 font-semibold" data-testid="choice-price">{c.price}</span> : null}
      </button>
      {c.onLess && (
        <button onClick={c.onLess} aria-label={'One less ' + c.label} data-testid="choice-less"
          className={cx('absolute top-1 w-9 h-9 rounded-full bg-white border-2 border-brand text-brand flex items-center justify-center shadow', lessLeft ? 'left-1' : 'right-1')}>
          <Minus size={16} />
        </button>
      )}
    </>
  )
}

/**
 * One Dish choices zone while a dish is being added. cells: the choices it
 * shows; bar: this zone has the dish's name and the Add bar.
 */
export function ChoiceZone({ zone, build, cells, bar, buildKey, onAdd, onCancel, onMore }) {
  const { it, qty, setQty, ok, error, total, count } = build
  const gridCells = cells.map(c => ({
    key: c.key,
    w: c.kind === 'head' || c.kind === 'note' ? zone.cols : c.kind === 'open' ? Math.min(2, zone.cols) : 1,
    h: 1,
    node: <Cell c={c} zone={zone} />,
  }))
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="choice-zone" data-kind={zone.kind}>
      {bar && (zone.show_name !== false || (zone.show_description !== false && it.description)) && (
        <div className="shrink-0 px-3 pt-2 pb-1 flex items-baseline gap-2 min-w-0">
          {zone.show_name !== false && <div className="font-bold text-lg truncate" data-testid="choice-dish">{it.name}</div>}
          {zone.show_description !== false && it.description && <div className="text-sm text-muted truncate" data-testid="choice-description">{it.description}</div>}
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        <ZoneGrid zone={zone} cells={gridCells} memoKey={'choices:' + zone.id} resetKey={buildKey} moreTitle={it.name}
          empty={bar ? 'Nothing to pick here: add it, or Note & more.' : null} testid="choice-grid" />
      </div>
      {bar && (
        <div className="shrink-0 border-t border-line p-2 flex flex-wrap items-center gap-2" data-testid="choice-bar">
          {!ok && <div className="w-full flex items-center gap-2 text-bad font-semibold text-sm" data-testid="choice-problem"><AlertTriangle size={16} />{error}</div>}
          <div className="flex items-center gap-1">
            <button className="btn w-12 px-0" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="One fewer"><Minus size={18} /></button>
            <div className="w-9 text-center text-xl font-bold tabular-nums" data-testid="choice-qty">{qty}</div>
            <button className="btn w-12 px-0" onClick={() => setQty(q => Math.min(99, q + 1))} aria-label="One more"><Plus size={18} /></button>
          </div>
          {/* The choices window takes one dish: with more dishes picked, add them first. */}
          <button className="btn" onClick={onMore} disabled={count > 1} title={count > 1 ? 'Add these first, then change one on the order' : undefined} data-testid="choice-more"><PenLine size={18} /><span className="hidden xl:inline">Note &amp; more</span></button>
          <button className="btn" onClick={onCancel} data-testid="choice-cancel"><X size={18} /><span className="hidden xl:inline">Cancel</span></button>
          <button className="btn btn-primary flex-1 min-w-[140px] h-14 text-lg" disabled={!ok} onClick={onAdd} data-testid="choice-add" data-count={count}>
            Add {count > 1 ? count + ' dishes ' : ''}{total != null ? money(total) : ''}
          </button>
        </div>
      )}
    </div>
  )
}
