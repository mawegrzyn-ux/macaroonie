// Choosing a dish's options before it goes on the check: option groups
// (with No / Light / Extra / On the side where the group allows it, nested
// groups such as Steak -> Cooking, the same option more than once where the
// group allows it, and optional groups that wait behind a button), combo
// steps (shared/combos.js), quantity, seat, course, a note for the kitchen,
// allergies, and a price change.

import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, AlertTriangle, Check } from 'lucide-react'
import { priceItem, lineGross, PREFIXES, groupChoice } from '@shared/pos/pricing.js'
import { resolveSteps, stepRule } from '@shared/combos.js'
import { Modal, Keypad, cx, money, poundsToPence } from './ui.jsx'
import { tillItem, courseFor, comboCtx } from '../lib/checkOps.js'
import { dealItem } from '@shared/pos/offers.js'
import { can } from '../lib/store.js'

const entriesOf = (sel, key) => ((sel || {})[key] || [])

/**
 * One option group. A repeat group adds a pick on every tap (with a minus to
 * take one off); an optional group with on_request waits behind a button.
 */
export function ChoiceGroup({ choice, value, onChange, groupsById, depth = 0 }) {
  const [mode, setMode] = useState(null) // prefix for the next tap
  const picked = value || []
  const [open, setOpen] = useState(!choice.on_request || picked.length > 0)
  const counted = picked.filter(e => e.prefix !== 'no').length
  const countOf = id => picked.filter(e => e.id === id).length
  const toggle = o => {
    if (choice.repeat && !mode) {
      if (counted >= choice.max) return
      return onChange([...picked, { id: o.id, prefix: null }])
    }
    const has = picked.find(e => e.id === o.id)
    if (has && (has.prefix || null) === (mode || null)) return onChange(picked.filter(e => e.id !== o.id))
    if (has) return onChange(picked.map(e => (e.id === o.id ? { ...e, prefix: mode } : e)))
    if (choice.max === 1 && !mode) return onChange([{ id: o.id, prefix: null }])
    if (mode !== 'no' && counted >= choice.max) {
      if (choice.max === 1) return onChange([...picked.filter(e => e.prefix === 'no'), { id: o.id, prefix: mode }])
      return
    }
    onChange([...picked, { id: o.id, prefix: mode }])
  }
  const takeOne = o => {
    const i = picked.map(e => e.id).lastIndexOf(o.id)
    if (i >= 0) onChange(picked.filter((_, j) => j !== i))
  }
  const hint = choice.min && choice.max === choice.min ? 'Choose ' + choice.min
    : choice.min ? 'Choose ' + choice.min + ' to ' + choice.max : 'Up to ' + choice.max
  if (!open) {
    return (
      <button className={cx('btn justify-start gap-2 w-full', depth && 'ml-4')} onClick={() => setOpen(true)} data-testid="group-button">
        <Plus size={18} /> {choice.name}
      </button>
    )
  }
  return (
    <div className={cx('space-y-2', depth && 'ml-4 pl-3 border-l-4 border-brand-soft')}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-bold">{choice.name}</div>
        <div className={cx('text-xs font-semibold', choice.min && counted < choice.min ? 'text-bad' : 'text-muted')}>{hint}{choice.repeat ? ' · tap again for more' : ''}</div>
        {choice.prefixes && (
          <div className="ml-auto flex gap-1">
            {[{ key: null, label: 'Add' }, ...PREFIXES].map(p => (
              <button key={p.label} className={cx('chip min-h-[40px] px-3', mode === p.key && 'chip-on')} onClick={() => setMode(p.key)}>{p.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {choice.options.map(o => {
          const e = picked.find(x => x.id === o.id)
          const n = countOf(o.id)
          const pre = PREFIXES.find(p => p.key === e?.prefix)
          return (
            <div key={o.id} className="relative">
              <button onClick={() => toggle(o)} data-testid="option"
                className={cx('btn w-full justify-between text-left h-auto min-h-[56px] py-2', e && (e.prefix === 'no' ? 'bg-bad-soft border-bad text-bad' : 'bg-brand text-white border-brand'))}>
                <span className="leading-tight">{choice.repeat && n > 1 ? n + ' x ' : ''}{pre ? pre.label + ' ' : ''}{o.label}</span>
                {o.price_pence ? <span className="text-sm opacity-90">{choice.mode === 'extra' ? '+' : ''}{money(o.price_pence)}</span> : null}
              </button>
              {choice.repeat && n > 0 && (
                <button onClick={() => takeOne(o)} aria-label={'One less ' + o.label}
                  className="absolute -top-2 -right-2 w-9 h-9 rounded-full bg-white border-2 border-brand text-brand flex items-center justify-center shadow">
                  <Minus size={16} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {picked.filter(e => e.prefix !== 'no').map((e, idx) => {
        const o = choice.options.find(x => x.id === e.id)
        const child = o?.child_group_id && groupsById[o.child_group_id]
        if (!child) return null
        const cc = groupChoice(child, { nested: true })
        return (
          <ChoiceGroup key={e.id + ':' + idx} choice={{ ...cc, name: o.label + ': ' + cc.name }} depth={depth + 1} groupsById={groupsById}
            value={entriesOf(e.children, cc.key)}
            onChange={v => onChange(picked.map(x => (x === e ? { ...x, children: { ...(x.children || {}), [cc.key]: v } } : x)))} />
        )
      })}
    </div>
  )
}

/** A dish's own option groups. */
function Choices({ item, value, onChange, groupsById }) {
  return (item.pos_choices || []).map(c => (
    <ChoiceGroup key={c.key} choice={c} groupsById={groupsById} value={entriesOf(value, c.key)}
      onChange={v => onChange({ ...(value || {}), [c.key]: v })} />
  ))
}

/** A combo's steps, one after another; steps that are done show a tick at the top. */
function ComboSteps({ item, config, picks, onChange, ctx, stepRefs }) {
  const { steps, picks: resolved } = resolveSteps(item, picks, ctx)
  const [opened, setOpened] = useState({})
  const groupsById = config.groups || {}
  const set = (stepId, list) => onChange({ ...picks, [stepId]: list })
  return steps.filter(s => s.shown).map(({ step, choices, auto }) => {
    const got = resolved[step.id] || []
    const count = (c) => got.filter(e => e.option_id === c.option_id && (e.item_id || null) === c.item_id).length
    const tap = c => {
      const entry = { option_id: c.option_id, item_id: c.item_id, choices: {} }
      const n = count(c)
      if (step.repeat) {
        if (got.length >= step.max) return
        return set(step.id, [...got, entry])
      }
      if (n) return set(step.id, got.filter(e => !(e.option_id === c.option_id && (e.item_id || null) === c.item_id)))
      if (step.max === 1) return set(step.id, [entry])
      if (got.length >= step.max) return
      set(step.id, [...got, entry])
    }
    const takeOne = c => {
      const i = got.map(e => e.option_id + ':' + (e.item_id || '')).lastIndexOf(c.option_id + ':' + (c.item_id || ''))
      if (i >= 0) set(step.id, got.filter((_, j) => j !== i))
    }
    const done = got.length >= step.min
    const hidden = step.ask === 'button' && !got.length && !opened[step.id]
    return (
      <div key={step.id} ref={el => { stepRefs.current[step.id] = el }} className="space-y-2 scroll-mt-4" data-testid="combo-step">
        {hidden ? (
          <button className="btn justify-start gap-2 w-full" onClick={() => setOpened(o => ({ ...o, [step.id]: true }))} data-testid="step-button">
            <Plus size={18} /> {step.name}
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="font-bold">{step.name}</div>
              <div className={cx('text-xs font-semibold', !done ? 'text-bad' : 'text-muted')}>
                {auto ? 'Included' : stepRule(step)}{step.repeat && !auto ? ' · tap again for more' : ''}
              </div>
            </div>
            {!auto && (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {choices.map(c => {
                  const n = count(c)
                  return (
                    <div key={c.key} className="relative">
                      <button onClick={() => tap(c)} disabled={c.sold_out} data-testid="combo-choice"
                        className={cx('btn w-full justify-between text-left h-auto min-h-[56px] py-2', n > 0 && 'bg-brand text-white border-brand', c.sold_out && 'line-through text-muted')}>
                        <span className="leading-tight">{step.repeat && n > 1 ? n + ' x ' : ''}{c.label}</span>
                        {c.sold_out ? <span className="text-xs font-bold uppercase">Sold out</span>
                          : c.price_pence ? <span className="text-sm">+{money(c.price_pence)}</span> : null}
                      </button>
                      {step.repeat && n > 0 && (
                        <button onClick={() => takeOne(c)} aria-label={'One less ' + c.label}
                          className="absolute -top-2 -right-2 w-9 h-9 rounded-full bg-white border-2 border-brand text-brand flex items-center justify-center shadow">
                          <Minus size={16} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {got.map((e, idx) => {
              const choice = choices.find(c => c.option_id === e.option_id && (c.item_id || null) === (e.item_id || null))
              // The dish's options as the deal asks them (some left out, only some offered, another group instead).
              const part = e.item_id ? dealItem(config, e.item_id, choice?.groups) : null
              const label = choice?.label
              if (auto && !part?.pos_choices?.length) return <div key={idx} className="text-sm text-muted">{label}</div>
              if (!part?.pos_choices?.length) return null
              const same = got.filter(x => x.item_id === e.item_id).length > 1
              return (
                <div key={idx} className="ml-4 pl-3 border-l-4 border-brand-soft space-y-3">
                  <div className="text-sm font-semibold text-muted">{label}{same ? ' ' + (got.slice(0, idx + 1).filter(x => x.item_id === e.item_id).length) : ''}</div>
                  <Choices item={part} groupsById={groupsById} value={e.choices}
                    onChange={ch => set(step.id, got.map((x, j) => (j === idx ? { ...x, choices: ch } : x)))} />
                </div>
              )
            })}
          </>
        )}
      </div>
    )
  })
}

/**
 * onAdd({ selection, qty, seat, course, note, allergies, unit_price }) adds the dish.
 * defaults: { seat, course } from the check screen.
 * initial: { selection, qty } to start from (e.g. "Make it a combo").
 */
export default function ItemModal({ item, config, defaults = {}, initial = null, title = null, onClose, onAdd }) {
  const it = tillItem(config, item.id)
  const ctx = useMemo(() => comboCtx(config), [config])
  const [sel, setSel] = useState(() => ({ choices: {}, combo: {}, ...(initial?.selection || {}) }))
  const [qty, setQty] = useState(initial?.qty || 1)
  const [seat, setSeat] = useState(defaults.seat ?? null)
  const [course, setCourse] = useState(defaults.course ?? null)
  const [note, setNote] = useState('')
  const [allergies, setAllergies] = useState([])
  const [priceText, setPriceText] = useState(null)
  const stepRefs = useRef({})
  const priced = useMemo(() => priceItem(it, sel, ctx), [it, sel, ctx])
  const unit = priceText != null ? poundsToPence(priceText) : priced.ok ? priced.unit_price : null
  const total = priced.ok ? lineGross({ ...priced, unit_price: unit, qty }) : null
  const allergens = (config.dietary_tags || []).filter(t => t.kind === 'allergen')
  const courses = config.courses || []
  const autoCourse = courses.find(c => c.id === courseFor(it, null))
  const isCombo = it.kind === 'combo'
  const steps = isCombo ? resolveSteps(it, sel.combo || {}, ctx) : null

  return (
    <Modal title={title || it.name} onClose={onClose} wide
      footer={<>
        {!priced.ok && <div className="flex items-center gap-2 text-bad font-semibold mr-auto"><AlertTriangle size={18} />{priced.error}</div>}
        <div className="flex items-center gap-2 mr-auto">
          <button className="btn w-12 px-0" onClick={() => setQty(q => Math.max(1, q - 1))}><Minus size={18} /></button>
          <div className="w-10 text-center text-xl font-bold tabular-nums">{qty}</div>
          <button className="btn w-12 px-0" onClick={() => setQty(q => Math.min(99, q + 1))}><Plus size={18} /></button>
        </div>
        <button className="btn btn-primary min-w-[180px] h-14 text-lg" disabled={!priced.ok || unit == null} data-testid="add"
          onClick={() => onAdd({ selection: { ...sel, combo: isCombo ? priced.ok && steps ? steps.picks : sel.combo : undefined }, qty, seat, course, note: note.trim(), allergies, unit_price: priceText != null ? unit : null })}>
          Add {total != null ? money(total) : ''}
        </button>
      </>}>
      <div className="space-y-6">
        {it.description && <div className="text-sm text-muted -mt-2">{it.description}</div>}
        {isCombo && steps && (
          <div className="flex flex-wrap gap-2 -mt-1" aria-label="Steps">
            {steps.steps.filter(s => s.shown && !(s.step.ask === 'button' && !(steps.picks[s.step.id] || []).length)).map(({ step }) => {
              const done = (steps.picks[step.id] || []).length >= step.min
              return (
                <button key={step.id} className={cx('chip min-h-[40px] gap-1', done ? 'chip-on' : 'border-bad text-bad')}
                  onClick={() => stepRefs.current[step.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {done && <Check size={14} />}{step.name}
                </button>
              )
            })}
          </div>
        )}
        {isCombo && (
          <ComboSteps item={it} config={config} ctx={ctx} picks={sel.combo || {}} stepRefs={stepRefs}
            onChange={combo => setSel(s => ({ ...s, combo }))} />
        )}
        <Choices item={it} groupsById={config.groups || {}} value={sel.choices}
          onChange={choices => setSel(s => ({ ...s, choices }))} />

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="label mb-2">Seat</div>
            <div className="flex flex-wrap gap-2">
              <button className={cx('chip', seat == null && 'chip-on')} onClick={() => setSeat(null)}>Shared</button>
              {Array.from({ length: Math.max(4, defaults.covers || 0) }).map((_, i) => (
                <button key={i} className={cx('chip w-12', seat === i + 1 && 'chip-on')} onClick={() => setSeat(i + 1)}>{i + 1}</button>
              ))}
            </div>
          </div>
          {courses.length > 0 && (
            <div>
              <div className="label mb-2">Course</div>
              <div className="flex flex-wrap gap-2">
                <button className={cx('chip', course == null && 'chip-on')} onClick={() => setCourse(null)}>Usual{autoCourse ? ' (' + autoCourse.name + ')' : ''}</button>
                {courses.map(c => <button key={c.id} className={cx('chip', course === c.id && 'chip-on')} onClick={() => setCourse(c.id)}>{c.name}</button>)}
                <button className={cx('chip', course === 'none' && 'chip-on')} onClick={() => setCourse('none')}>None</button>
              </div>
            </div>
          )}
        </div>

        <label className="block">
          <span className="label">Note for the kitchen</span>
          <input className="input mt-1" value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. sauce on the side" />
        </label>

        {allergens.length > 0 && (
          <div>
            <div className="label mb-2">Allergies (printed in a black box on the kitchen ticket)</div>
            <div className="flex flex-wrap gap-2">
              {allergens.map(a => {
                const on = allergies.includes(a.label)
                return <button key={a.code} className={cx('chip', on && 'bg-bad text-white border-bad')} onClick={() => setAllergies(x => (on ? x.filter(y => y !== a.label) : [...x, a.label]))}>{a.label}</button>
              })}
            </div>
          </div>
        )}

        {can('price_override') && (
          <div>
            <div className="flex items-center gap-2">
              <span className="label">Price each</span>
              {priceText == null
                ? <button className="chip" onClick={() => setPriceText(priced.ok ? (priced.unit_price / 100).toFixed(2) : '')}>Change price</button>
                : <button className="chip" onClick={() => setPriceText(null)}>Use menu price</button>}
            </div>
            {priceText != null && (
              <div className="mt-2 max-w-xs">
                <div className="text-3xl font-bold text-center mb-2 tabular-nums">£{priceText || '0'}</div>
                <Keypad value={priceText} onChange={setPriceText} decimal max={7} />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
