// Choosing a dish's options before it goes on the check: option groups
// (with No / Light / Extra / On the side where the group allows it, and
// nested groups such as Steak -> Cooking), meal deal parts, quantity, seat,
// course, a note for the kitchen, allergies, and a price change.

import { useMemo, useState } from 'react'
import { Minus, Plus, AlertTriangle } from 'lucide-react'
import { priceItem, lineGross, PREFIXES, groupChoice } from '@shared/pos/pricing.js'
import { Modal, Keypad, cx, money, poundsToPence } from './ui.jsx'
import { tillItem, courseFor } from '../lib/checkOps.js'
import { can } from '../lib/store.js'

const entriesOf = (sel, key) => (sel[key] || [])

function ChoiceGroup({ choice, value, onChange, groupsById, depth = 0 }) {
  const [mode, setMode] = useState(null) // prefix for the next tap
  const picked = value || []
  const counted = picked.filter(e => e.prefix !== 'no').length
  const toggle = o => {
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
  const hint = choice.min && choice.max === choice.min ? 'Choose ' + choice.min
    : choice.min ? 'Choose ' + choice.min + ' to ' + choice.max : 'Up to ' + choice.max
  return (
    <div className={cx('space-y-2', depth && 'ml-4 pl-3 border-l-4 border-brand-soft')}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-bold">{choice.name}</div>
        <div className={cx('text-xs font-semibold', choice.min && counted < choice.min ? 'text-bad' : 'text-muted')}>{hint}</div>
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
          const pre = PREFIXES.find(p => p.key === e?.prefix)
          return (
            <button key={o.id} onClick={() => toggle(o)}
              className={cx('btn justify-between text-left h-auto min-h-[56px] py-2', e && (e.prefix === 'no' ? 'bg-bad-soft border-bad text-bad' : 'bg-brand text-white border-brand'))}>
              <span className="leading-tight">{pre ? pre.label + ' ' : ''}{o.label}</span>
              {o.price_pence ? <span className="text-sm opacity-90">{choice.mode === 'extra' ? '+' : ''}{money(o.price_pence)}</span> : null}
            </button>
          )
        })}
      </div>
      {picked.filter(e => e.prefix !== 'no').map(e => {
        const o = choice.options.find(x => x.id === e.id)
        const child = o?.child_group_id && groupsById[o.child_group_id]
        if (!child) return null
        const cc = groupChoice(child, { nested: true })
        return (
          <ChoiceGroup key={e.id} choice={{ ...cc, name: o.label + ': ' + cc.name }} depth={depth + 1} groupsById={groupsById}
            value={entriesOf(e.children || {}, cc.key)}
            onChange={v => onChange(picked.map(x => (x.id === e.id ? { ...x, children: { ...(x.children || {}), [cc.key]: v } } : x)))} />
        )
      })}
    </div>
  )
}

function ComboSlot({ slot, value, onChange, config }) {
  const picked = value || []
  const toggle = itemId => {
    if (picked.some(p => p.item_id === itemId)) return onChange(picked.filter(p => p.item_id !== itemId))
    if (slot.max === 1) return onChange([{ item_id: itemId, choices: {} }])
    if (picked.length >= slot.max) return
    onChange([...picked, { item_id: itemId, choices: {} }])
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="font-bold">{slot.name}</div>
        <div className={cx('text-xs font-semibold', picked.length < slot.min ? 'text-bad' : 'text-muted')}>
          {slot.min === slot.max ? 'Choose ' + slot.min : 'Choose ' + slot.min + ' to ' + slot.max}
        </div>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {slot.options.map(o => {
          const it = config.items[o.item_id]
          const on = picked.some(p => p.item_id === o.item_id)
          return (
            <button key={o.item_id} onClick={() => toggle(o.item_id)}
              className={cx('btn justify-between text-left h-auto min-h-[56px] py-2', on && 'bg-brand text-white border-brand')}>
              <span className="leading-tight">{it?.name}</span>
              {o.upcharge_pence ? <span className="text-sm">+{money(o.upcharge_pence)}</span> : null}
            </button>
          )
        })}
      </div>
      {picked.map(p => {
        const part = tillItem(config, p.item_id)
        if (!part?.pos_choices?.length) return null
        return (
          <div key={p.item_id} className="ml-4 pl-3 border-l-4 border-brand-soft space-y-3">
            <div className="text-sm font-semibold text-muted">{part.name}</div>
            {part.pos_choices.map(c => (
              <ChoiceGroup key={c.key} choice={c} groupsById={config.groups || {}} value={entriesOf(p.choices, c.key)}
                onChange={v => onChange(picked.map(x => (x.item_id === p.item_id ? { ...x, choices: { ...x.choices, [c.key]: v } } : x)))} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * onAdd({ selection, qty, seat, course, note, allergies, unit_price }) adds the dish.
 * defaults: { seat, course } from the check screen.
 */
export default function ItemModal({ item, config, defaults = {}, onClose, onAdd }) {
  const it = tillItem(config, item.id)
  const [sel, setSel] = useState({ choices: {}, combo: {} })
  const [qty, setQty] = useState(1)
  const [seat, setSeat] = useState(defaults.seat ?? null)
  const [course, setCourse] = useState(defaults.course ?? null)
  const [note, setNote] = useState('')
  const [allergies, setAllergies] = useState([])
  const [priceText, setPriceText] = useState(null)
  const priced = useMemo(() => priceItem(it, sel, { itemsById: config.items, groupsById: config.groups || {} }), [it, sel, config])
  const unit = priceText != null ? poundsToPence(priceText) : priced.ok ? priced.unit_price : null
  const total = priced.ok ? lineGross({ ...priced, unit_price: unit, qty }) : null
  const allergens = (config.dietary_tags || []).filter(t => t.kind === 'allergen')
  const courses = config.courses || []
  const autoCourse = courses.find(c => c.id === courseFor(it, null))

  return (
    <Modal title={it.name} onClose={onClose} wide
      footer={<>
        {!priced.ok && <div className="flex items-center gap-2 text-bad font-semibold mr-auto"><AlertTriangle size={18} />{priced.error}</div>}
        <div className="flex items-center gap-2 mr-auto">
          <button className="btn w-12 px-0" onClick={() => setQty(q => Math.max(1, q - 1))}><Minus size={18} /></button>
          <div className="w-10 text-center text-xl font-bold tabular-nums">{qty}</div>
          <button className="btn w-12 px-0" onClick={() => setQty(q => Math.min(99, q + 1))}><Plus size={18} /></button>
        </div>
        <button className="btn btn-primary min-w-[180px] h-14 text-lg" disabled={!priced.ok || unit == null}
          onClick={() => onAdd({ selection: sel, qty, seat, course, note: note.trim(), allergies, unit_price: priceText != null ? unit : null })}>
          Add {total != null ? money(total) : ''}
        </button>
      </>}>
      <div className="space-y-6">
        {it.description && <div className="text-sm text-muted -mt-2">{it.description}</div>}
        {(it.combo_slots || []).map(slot => (
          <ComboSlot key={slot.id} slot={slot} config={config} value={sel.combo[slot.id]} onChange={v => setSel(s => ({ ...s, combo: { ...s.combo, [slot.id]: v } }))} />
        ))}
        {(it.pos_choices || []).map(c => (
          <ChoiceGroup key={c.key} choice={c} groupsById={config.groups || {}} value={sel.choices[c.key]}
            onChange={v => setSel(s => ({ ...s, choices: { ...s.choices, [c.key]: v } }))} />
        ))}

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
