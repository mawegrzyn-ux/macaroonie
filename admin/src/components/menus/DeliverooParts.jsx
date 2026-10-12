// src/components/menus/DeliverooParts.jsx
//
// Pieces of the Deliveroo menu page (pages/MenuDeliveroo.jsx): the dish
// picker, the item editor (menu / Deliveroo's / typed value per column),
// the allergen and dietary code map, and the bulk price change.

import { useMemo, useState } from 'react'
import { Search, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, Segmented, Btn, NumberBox } from '@/components/pos/shared'
import { Drawer } from '@/components/purchasing/shared'
import {
  FILL_FIELDS, DELIVEROO_ALLERGENS, DELIVEROO_DIETARY, priceText, pricePence, priceRule, dishPrice,
} from '@shared/deliveroo.js'

export const FIELD_LABEL = Object.fromEntries(FILL_FIELDS.map(f => [f.key, f.label]))
export const money = p => (p == null ? '' : '£' + (Number(p) / 100).toFixed(2))
export const ROUND_OPTIONS = [
  { value: 1, label: '1p' }, { value: 5, label: '5p' }, { value: 10, label: '10p' },
  { value: 50, label: '50p' }, { value: 100, label: '£1' },
]

const STATE_BADGE = {
  linked:    { label: 'Matched',      cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  auto:      { label: 'Auto match',   cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  suggested: { label: 'Check',        cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  none:      { label: 'Not matched',  cls: 'bg-muted text-muted-foreground border-transparent' },
  missing:   { label: 'Dish gone',    cls: 'bg-red-50 text-red-800 border-red-200' },
  skipped:   { label: 'Left as is',   cls: 'bg-muted text-muted-foreground border-transparent' },
}

export function StateBadge({ state }) {
  const b = STATE_BADGE[state] || STATE_BADGE.none
  return <span className={cn('inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-medium whitespace-nowrap', b.cls)}>{b.label}</span>
}

export function dishLine(d) {
  if (!d) return ''
  const p = dishPrice(d)
  return [d.menu_name, d.section_title, p.pence != null ? money(p.pence) + (p.from ? ' (' + p.from + ')' : '') : 'no price'].filter(Boolean).join(' · ')
}

/** Pick the dish a Deliveroo item is filled from, or leave the item as it is. */
export function DishPicker({ row, match, dishes, onPick, onSkip, onAuto, onClose, canAuto }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = t ? dishes.filter(d => [d.name, d.native_name, d.kitchen_name, d.section_title].some(x => x && x.toLowerCase().includes(t))) : dishes
    return all.slice(0, 200)
  }, [q, dishes])
  const groups = useMemo(() => {
    const out = []
    for (const d of list) {
      const key = d.menu_name + ' · ' + d.section_title
      let g = out.find(x => x.key === key)
      if (!g) out.push(g = { key, dishes: [] })
      g.dishes.push(d)
    }
    return out
  }, [list])
  const current = match?.dish?.id
  const DishBtn = ({ d, score }) => (
    <button type="button" onClick={() => onPick(d)}
      className={cn('w-full text-left min-h-[48px] px-3 py-2 rounded-lg border bg-background hover:bg-muted touch-manipulation flex items-center gap-3',
        current === d.id && 'ring-2 ring-primary')}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{d.name}</span>
        <span className="block text-xs text-muted-foreground truncate">{dishLine(d)}</span>
      </span>
      {score != null && <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(score * 100)}%</span>}
      {current === d.id && <Check className="w-4 h-4 text-primary shrink-0" />}
    </button>
  )
  return (
    <Modal title={'Match "' + row.item_name + '"'} onClose={onClose}
      footer={<>
        <Btn onClick={onSkip}>Leave this item as it is</Btn>
        {canAuto && <Btn onClick={onAuto}>Back to automatic</Btn>}
      </>}>
      {match?.suggestions?.length > 0 && !q && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Closest names</p>
          {match.suggestions.map(s => <DishBtn key={s.dish.id} d={s.dish} score={s.score} />)}
        </div>
      )}
      <label className="relative block">
        <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes" aria-label="Search dishes"
          className={cn(inputCls, 'pl-9')} />
      </label>
      {groups.map(g => (
        <div key={g.key} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{g.key}</p>
          {g.dishes.map(d => <DishBtn key={d.id} d={d} />)}
        </div>
      ))}
      {!groups.length && <p className="text-sm text-muted-foreground">No dish matches that search.</p>}
    </Modal>
  )
}

/**
 * One item, column by column: Deliveroo's value, our menu's, and which is
 * used (or a typed value). Changes stay on the page until Save matches.
 */
export function ItemEditor({ row, built, ours, link, columns, fill, problems, onChange, onClose, onMatch, match }) {
  const keep = new Set(link.keep || [])
  const overrides = link.overrides || {}
  const fields = FILL_FIELDS.filter(f => columns.includes(f.key))
  function choose(field, mode) {
    const nextKeep = new Set(keep)
    const nextOv = { ...overrides }
    nextKeep.delete(field); delete nextOv[field]
    if (mode === 'keep') nextKeep.add(field)
    if (mode === 'edit') nextOv[field] = built.values[field] ?? ''
    onChange({ keep: [...nextKeep], overrides: nextOv })
  }
  function setText(field, text) {
    onChange({ keep: [...keep].filter(k => k !== field), overrides: { ...overrides, [field]: text } })
  }
  return (
    <Drawer wide title={row.item_name} subtitle={'Deliveroo item_id ' + row.item_id} onClose={onClose}
      footer={<>
        <Btn variant="primary" onClick={onClose}>Done</Btn>
        {(keep.size > 0 || Object.keys(overrides).length > 0) && (
          <Btn onClick={() => onChange({ keep: [], overrides: {} })}>Undo changes to this item</Btn>
        )}
      </>}>
      <section className="rounded-xl border bg-background p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex-1">Filled from</h3>
          <StateBadge state={match.state} />
        </div>
        <p className="text-sm">{match.dish ? match.dish.name : match.state === 'skipped' ? 'Nothing: this item is left as it is' : 'No dish yet'}</p>
        {match.dish && <p className="text-xs text-muted-foreground">{dishLine(match.dish)}</p>}
        <Btn onClick={onMatch}>Change</Btn>
      </section>
      {problems.length > 0 && (
        <ul className="space-y-1">
          {problems.map((p, i) => (
            <li key={i} className={cn('text-xs rounded-lg px-3 py-2 border', p.level === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900')}>
              <b>{FIELD_LABEL[p.field] || p.field}:</b> {p.text}
            </li>
          ))}
        </ul>
      )}
      {fields.map(f => {
        const theirs = row[f.key] ?? ''
        const mine = ours?.values?.[f.key]
        const mode = f.key in overrides ? 'edit' : keep.has(f.key) ? 'keep' : (match.dish && fill[f.key] && mine != null) ? 'menu' : 'keep'
        const options = [
          ...(match.dish && fill[f.key] && mine != null ? [{ value: 'menu', label: 'Our menu' }] : []),
          { value: 'keep', label: 'Deliveroo\'s' },
          { value: 'edit', label: 'Type it' },
        ]
        const long = f.key === 'item_description'
        return (
          <section key={f.key} className="rounded-xl border bg-background p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold flex-1 min-w-[8rem]">{f.label}</h3>
              <Segmented value={mode} options={options} onChange={m => choose(f.key, m === 'menu' ? null : m)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">On Deliveroo now</p>
                <p className={cn('whitespace-pre-wrap break-words', !theirs && 'text-muted-foreground italic')}>{theirs || 'empty'}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Our menu</p>
                <p className={cn('whitespace-pre-wrap break-words', mine == null && 'text-muted-foreground italic')}>
                  {!match.dish ? 'no dish' : !fill[f.key] ? 'not filled (switched off above)' : mine ?? 'nothing set'}
                </p>
                {ours?.notes?.[f.key] && <p className="text-xs text-muted-foreground">{ours.notes[f.key]}</p>}
              </div>
            </div>
            {mode === 'edit' && (long
              ? <textarea value={overrides[f.key] ?? ''} onChange={e => setText(f.key, e.target.value)} rows={4} aria-label={f.label}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
              : <input value={overrides[f.key] ?? ''} onChange={e => setText(f.key, e.target.value)} aria-label={f.label}
                  inputMode={/price|calories|kcal|tax/.test(f.key) ? 'decimal' : undefined} className={inputCls} />)}
            {mode === 'edit' && f.key === 'allergens' && (
              <p className="text-[11px] text-muted-foreground">Deliveroo codes separated by commas, e.g. eggs,milk,gluten_wheat. no_allergens on its own if there are none.</p>
            )}
          </section>
        )
      })}
    </Drawer>
  )
}

/** Our allergen and dietary tags -> Deliveroo codes. */
export function CodesModal({ tags, settings, onChange, onClose, usedCodes }) {
  const allergenTags = tags.filter(t => t.kind === 'allergen')
  const dietaryTags = tags.filter(t => t.kind !== 'allergen')
  const Row = ({ tag, mapKey, choices }) => {
    const chosen = settings[mapKey]?.[tag.code] || []
    const left = choices.filter(c => !chosen.includes(c))
    const needed = mapKey === 'allergen_map' && usedCodes.has(tag.code) && !chosen.length
    function set(list) { onChange({ ...settings, [mapKey]: { ...settings[mapKey], [tag.code]: list } }) }
    return (
      <div className={cn('rounded-lg border p-3 space-y-2', needed && 'border-red-300 bg-red-50/50')}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium flex-1">{tag.label}</span>
          {needed && <span className="text-[11px] text-red-700">On matched dishes: needs a code</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {chosen.map(c => (
            <button key={c} type="button" onClick={() => set(chosen.filter(x => x !== c))} aria-label={'Remove ' + c}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-primary/10 text-sm touch-manipulation">
              {c} <X className="w-3.5 h-3.5" />
            </button>
          ))}
          {!chosen.length && <span className="text-xs text-muted-foreground self-center">Not sent to Deliveroo</span>}
          {left.length > 0 && (
            <select value="" onChange={e => e.target.value && set([...chosen, e.target.value])} aria-label={'Add a code for ' + tag.label}
              className="h-9 rounded-full border bg-background px-3 text-sm touch-manipulation">
              <option value="">Add code</option>
              {left.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>
    )
  }
  return (
    <Modal title="Allergen and dietary codes" onClose={onClose} footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      <p className="text-sm text-muted-foreground">
        Deliveroo uses its own codes. Each of your tags is sent as the codes chosen here. Deliveroo lists nuts one by one
        (nuts_cashew, nuts_almond, ...), so pick the nuts your dishes have. Save the settings afterwards.
      </p>
      <h3 className="text-sm font-semibold">Allergens</h3>
      {allergenTags.map(t => <Row key={t.code} tag={t} mapKey="allergen_map" choices={DELIVEROO_ALLERGENS.filter(c => c !== 'no_allergens')} />)}
      <h3 className="text-sm font-semibold pt-2">Dietary</h3>
      {dietaryTags.map(t => <Row key={t.code} tag={t} mapKey="dietary_map" choices={DELIVEROO_DIETARY} />)}
      {!tags.length && <p className="text-sm text-muted-foreground">No tags yet. Add them under Menus, Allergens & dietary.</p>}
    </Modal>
  )
}

/** Raise / lower / set the delivery price of the items shown, as typed values. */
export function PriceModal({ rows, settings, onApply, onUndo, onClose }) {
  const [mode, setMode] = useState('pct')
  const [pct, setPct] = useState(10)
  const [amount, setAmount] = useState('')
  const [round, setRound] = useState(settings.price_round_pence || 1)
  const [roundMode, setRoundMode] = useState(settings.price_round_mode || 'up')
  const priced = rows.filter(r => pricePence(r.values.delivery_price) != null)
  const sample = priced[0]
  const preview = p => mode === 'pct' ? priceRule(p, pct, round, roundMode) : pricePence(amount)
  const ok = mode === 'pct' ? pct != null && pct !== 0 : (pricePence(amount) ?? 0) > 0
  return (
    <Modal title={'Delivery price of the ' + rows.length + ' items shown'} onClose={onClose}
      footer={<>
        <Btn variant="primary" disabled={!ok} onClick={() => onApply(r => priceText(preview(pricePence(r.values.delivery_price) ?? 0)))}>
          Apply to {mode === 'pct' ? priced.length : rows.length} items
        </Btn>
        <Btn onClick={onUndo}>Undo typed prices on these items</Btn>
      </>}>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'pct', label: 'Change by %' }, { value: 'set', label: 'Set a price' }]} />
      {mode === 'pct' ? (
        <>
          <Field label="Change (%)" hint="From the price each item has now on this page. Use a minus to lower.">
            <div className="flex items-center gap-2">
              <Segmented value={pct < 0 ? 'down' : 'up'} onChange={v => setPct(p => Math.abs(p || 0) * (v === 'down' ? -1 : 1))}
                options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} />
              <NumberBox value={Math.abs(pct ?? 0)} decimals={2} max={200} ariaLabel="Percent"
                onChange={v => setPct(p => (v == null ? null : (p < 0 ? -v : v)))} />
              <span className="text-sm">%</span>
            </div>
          </Field>
          <Field label="Round to">
            <div className="flex flex-wrap gap-2">
              <Segmented value={round} onChange={setRound} options={ROUND_OPTIONS} />
              <Segmented value={roundMode} onChange={setRoundMode} options={[{ value: 'up', label: 'Up' }, { value: 'nearest', label: 'Nearest' }]} />
            </div>
          </Field>
          {sample && <p className="text-sm text-muted-foreground">e.g. {sample.row.item_name}: £{sample.values.delivery_price} becomes {money(preview(pricePence(sample.values.delivery_price)))}</p>}
        </>
      ) : (
        <Field label="Delivery price (£)">
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className={inputCls} aria-label="Delivery price" />
        </Field>
      )}
      <p className="text-xs text-muted-foreground">The new prices are typed values on each item: they stay until you undo them, even if the menu price changes.</p>
    </Modal>
  )
}

