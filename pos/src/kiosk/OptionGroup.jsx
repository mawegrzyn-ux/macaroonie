// One option group on the kiosk (a dish's own group, or a combo part's):
// the picking rules (how many, the same one more than once, a group that
// waits behind a button, a group an option opens: Steak -> Cooking) and the
// display the group or the design asks for (displays.jsx). The picks are in
// the till's shape ({ [groupKey]: [{ id, children }] }), so the shared
// pricing (shared/pos/pricing.js priceItem) prices them like the till does.

import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { groupChoice } from '@shared/pos/pricing.js'
import { optionPriceText } from '@shared/orderPricing.js'
import { TK } from '@shared/kiosk.js'
import { DISPLAYS } from './displays.jsx'
import { cx } from './parts.jsx'

/** "Choose 1", "Choose 1 to 3", "Choose up to 2", "Optional". */
export function ruleText(ui, min, max) {
  if (min === 0) return max === 1 ? ui('optional') : ui('up_to', { n: max })
  if (min === max) return ui('choose_n', { n: min })
  return ui('choose_range', { min, max })
}

/** The first group (nested included) still missing picks: its name, or null. */
export function missingIn(choices, value, config, names) {
  for (const c of choices) {
    const got = value?.[c.key] || []
    if (got.length < c.min) return names(c)
    for (const e of got) {
      const o = c.options.find(x => x.id === e.id)
      const lib = o?.child_group_id && config.groups?.[o.child_group_id]
      if (lib) {
        const child = groupChoice(lib, { nested: true })
        const miss = missingIn([child], e.children || {}, config, names)
        if (miss) return miss
      }
    }
  }
  return null
}

/** A group's name in the guest's language. */
export function groupName(choice, texts) {
  if (choice.key === 'variants') return texts.ui('choose')
  return texts.t(TK.group(choice.key, 'name'), choice.name)
}

export default function OptionGroup({ choice, value = [], onChange, config, texts, itemId, depth = 0 }) {
  const { t, ui, money } = texts
  const lib = config.groups?.[choice.key] || null
  const [open, setOpen] = useState(!choice.on_request || value.length > 0)
  const design = config.design
  const display = lib?.kiosk_display || design.options.display
  const Display = DISPLAYS[display] || DISPLAYS.grid
  const counted = value.length
  const name = depth > 0 ? choice.name : groupName(choice, texts)
  const libOption = id => lib?.options?.find(o => (o.option_id ?? o.id) === id)
  const options = choice.options.map(o => {
    const lo = libOption(o.id)
    return {
      id: o.id,
      label: choice.key === 'variants' ? t(TK.variant(itemId, o.label), o.label) : t(TK.option(o.id, 'label'), o.label),
      description: lo?.description ? t(TK.option(o.id, 'description'), lo.description) : null,
      image_url: lo?.image_url || null,
      level: lo?.level ?? null,
      priceText: optionPriceText(choice, o, money),
      sold_out: false,
    }
  })
  const scale = lib?.scale_low && lib?.scale_high
    ? { low: t(TK.group(lib.id, 'scale_low'), lib.scale_low), high: t(TK.group(lib.id, 'scale_high'), lib.scale_high) }
    : null
  const countOf = id => value.filter(e => e.id === id).length
  const full = choice.repeat ? counted >= choice.max : choice.max > 1 && counted >= choice.max
  const onTap = o => {
    const n = countOf(o.id)
    if (choice.repeat) {
      if (counted >= choice.max) return
      return onChange([...value, { id: o.id }])
    }
    if (n) return onChange(value.filter(e => e.id !== o.id))
    if (choice.max === 1) return onChange([{ id: o.id }])
    if (counted >= choice.max) return
    onChange([...value, { id: o.id }])
  }
  const onLess = o => {
    const i = value.map(e => e.id).lastIndexOf(o.id)
    if (i >= 0) onChange(value.filter((_, j) => j !== i))
  }
  const done = choice.min > 0 && counted >= choice.min

  if (!open) {
    return (
      <button className="k-btn w-full justify-start" onClick={() => setOpen(true)} data-testid="k-group-button">
        <Plus /> {name}
      </button>
    )
  }
  return (
    <section className={cx('flex flex-col gap-[var(--k-gap)]', depth > 0 && 'pl-[var(--k-gap)] border-l-[4px] border-[var(--k-soft)]')} data-testid="k-group" data-group={choice.key}
      data-missing={counted < choice.min ? '1' : undefined}>
      <header className="flex items-center gap-[.6em] flex-wrap">
        <h3 className="k-head text-[1.25em] m-0">{name}</h3>
        <span className={cx('k-chip min-h-0 py-[.15em] text-[.8em]', done && 'k-chip-on')}>
          {done && <Check size={14} strokeWidth={3} />}
          {ruleText(ui, choice.min, choice.max)}{choice.max > 1 ? ' · ' + counted + '/' + choice.max : ''}
        </span>
        {choice.repeat && <span className="k-muted text-[.8em]">{ui('tap_again')}</span>}
      </header>
      <Display options={options} countOf={countOf} onTap={onTap} onLess={onLess} repeat={choice.repeat} full={full}
        scale={scale} levelIcon={design.options.level_icon} ui={ui} />
      {value.map((e, idx) => {
        const o = choice.options.find(x => x.id === e.id)
        const childLib = o?.child_group_id && config.groups?.[o.child_group_id]
        if (!childLib) return null
        const child = groupChoice(childLib, { nested: true })
        const label = options.find(x => x.id === e.id)?.label
        return (
          <OptionGroup key={e.id + ':' + idx} depth={depth + 1} config={config} texts={texts} itemId={itemId}
            choice={{ ...child, name: label + ': ' + t(TK.group(child.key, 'name'), child.name) }}
            value={(e.children || {})[child.key] || []}
            onChange={v => onChange(value.map((x, j) => (j === idx ? { ...x, children: { ...(x.children || {}), [child.key]: v } } : x)))} />
        )
      })}
    </section>
  )
}
