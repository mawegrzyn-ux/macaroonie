// Building one item on the kiosk. A dish shows its photo, words, allergens
// and option groups on one page. A combo goes one page at a time (like the
// till's steps, shared/combos.js): each step's choices in the step's display
// (grid, list, slider, wheel), then the picked dish's own options, then a
// last page with everything picked. The steps show down the side (or along
// the top on a portrait screen) with a tick when done.
// Pricing and the rules are the till's: shared/pos/pricing.js priceItem().
// With Split photo on for a group or step (shared/kiosk.js splitImages()),
// the dish's photo becomes the picks' pictures side by side as they're picked.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Info } from 'lucide-react'
import { priceItem, lineGross } from '@shared/pos/pricing.js'
import { resolveSteps } from '@shared/combos.js'
import { fromPrice, priceVaries } from '@shared/orderPricing.js'
import { configItem, comboCtx } from '@shared/pos/offers.js'
import { TK, allergenName, splitImages } from '@shared/kiosk.js'
import { useKiosk, textsFor, addToBasket, closeBuilder, soldOut, itemLevels, dishLevels, mergeLevels } from './store.js'
import OptionGroup, { missingIn, ruleText, groupName } from './OptionGroup.jsx'
import { DISPLAYS, choiceLook } from './displays.jsx'
import { cx, PickPhoto, Stepper, BackButton, bringIntoView, usePortrait } from './parts.jsx'

/**
 * Tags with their levels ({ code: level }) as names in the guest's language:
 * allergens by level, and the dietary tags (vegan...) unless left out.
 */
export function tagLists(levels, config, texts, { dietary: withDietary = true } = {}) {
  const allergens = { contains: [], may_contain: [], removable: [] }
  const dietary = []
  for (const tag of config.dietary_tags || []) {
    const lv = levels[tag.code]
    if (!lv) continue
    if (tag.kind === 'allergen') allergens[lv].push(allergenName(tag, texts.lang, texts.dict))
    else if (withDietary) dietary.push({ ...tag, name: texts.t(TK.tag(tag.code), tag.label) })
  }
  return { allergens, dietary }
}

/** An item's tags: a combo's allergens are every dish it can hold, and it gets no dietary badges (one vegan part doesn't make it vegan). */
export function itemTags(item, config, texts) {
  return tagLists(itemLevels(config, item), config, texts, { dietary: item?.kind !== 'combo' })
}

/** The allergen line: an item's (levels left out), or given levels (the dishes picked in a combo). */
export function AllergenLine({ item = null, levels = null, config, texts, className, depends = false }) {
  const { allergens } = levels ? tagLists(levels, config, texts, { dietary: false }) : itemTags(item, config, texts)
  const { ui } = texts
  const parts = []
  if (allergens.contains.length) parts.push(ui('contains') + ': ' + allergens.contains.join(', '))
  if (allergens.may_contain.length) parts.push(ui('may_contain') + ': ' + allergens.may_contain.join(', '))
  if (allergens.removable.length) parts.push(ui('can_be_removed') + ': ' + allergens.removable.join(', '))
  const combo = depends || (!levels && item?.kind === 'combo')
  return (
    <div className={cx('flex gap-[.4em] items-start text-[.85em]', className)} data-testid="k-allergens">
      <Info size={18} className="shrink-0 mt-[.1em]" />
      <span>{parts.length ? (combo ? ui('depends_on_choice') + '. ' : '') + parts.join(' · ') : ui('no_allergens')}</span>
    </div>
  )
}

export function DietaryBadges({ item, config, texts, compact = false }) {
  const { dietary } = itemTags(item, config, texts)
  if (!dietary.length) return null
  // On a hexagon: the marks only (the name is the badge's title).
  if (compact) {
    return dietary.map(d => (
      <span key={d.code} className="k-hex-mark" style={{ background: d.colour || 'var(--k-primary)' }} title={d.name} aria-label={d.name}>
        {d.glyph || d.name.slice(0, 1)}
      </span>
    ))
  }
  return (
    <span className="flex flex-wrap gap-[.3em]">
      {dietary.map(d => (
        <span key={d.code} className="inline-flex items-center gap-[.25em] px-[.5em] rounded-full text-[.72em] font-bold"
          style={{ background: d.colour || 'var(--k-soft)', color: '#fff' }} title={d.name}>
          {d.glyph}<span className="font-semibold">{d.name}</span>
        </span>
      ))}
    </span>
  )
}

/** The design's spin wheel settings, for the displays. */
export const wheelOf = config => ({ spin: config.design.options.wheel_spin, picks: config.design.options.wheel_spin_picks })

/** The price a card shows: "from £8.50" when choices change it. */
export function priceLabel(item, config, ctx, texts) {
  const p = fromPrice(item, item.pos_choices, ctx)
  if (p == null) return ''
  return (priceVaries(item, item.pos_choices, ctx) ? texts.ui('from') + ' ' : '') + texts.money(p)
}

export default function Builder() {
  const s = useKiosk()
  const texts = textsFor(s)
  const { config, builder } = s
  const item = configItem(config, builder.item_id)
  const ctx = useMemo(() => comboCtx(config), [config])
  if (!item) return null
  return item.kind === 'combo'
    ? <ComboBuilder key={builder.key || builder.item_id} item={item} config={config} ctx={ctx} texts={texts} builder={builder} />
    : <DishBuilder key={builder.key || builder.item_id} item={item} config={config} ctx={ctx} texts={texts} builder={builder} />
}

// The item's name (and a combo's running price). The way back is in the
// bottom bar (BackButton), beside the main button. Not shown when the design
// hides the bar along the top.
function TopBar({ title, right = null, config }) {
  if (!config.design.layout.header) return null
  return (
    <div className="flex items-center gap-[var(--k-gap)] px-[var(--k-pad)] min-h-[max(56px,3.2em)] py-[calc(var(--k-gap)/1.2)] bg-[var(--k-surface)] border-b-2 border-[var(--k-line)] shrink-0">
      {right && <div className="min-w-[6em]" />}
      <div className="k-head text-[1.3em] flex-1 min-w-0 truncate text-center">{title}</div>
      {right && <div className="min-w-[6em] flex justify-end">{right}</div>}
    </div>
  )
}

// Portrait: the photo sits beside the words, so the choices start on the
// first screen. Landscape (side): photo above the words in a column of their
// own, the choices beside them.
function Hero({ item, config, ctx, texts, side = false, split = [] }) {
  const name = texts.itemName(item)
  const desc = item.description ? texts.t(TK.item(item.id, 'description'), item.description) : null
  return (
    <div className={cx('flex gap-[var(--k-pad)]', side ? 'flex-col' : 'items-start')}>
      <div className={cx('k-hero-img shrink-0 overflow-hidden rounded-[var(--k-radius)]', side ? 'w-full' : 'w-[38%] max-w-[480px]')}>
        <PickPhoto srcs={split} src={item.image_url} label={name} className="w-full h-full object-cover aspect-[4/3]" phClassName="k-item-ph h-full"
          splitClassName="w-full h-full aspect-[4/3]" />
      </div>
      <div className="flex flex-col gap-[.5em] min-w-0 flex-1">
        <h2 className="k-head text-[1.9em] m-0">{name}</h2>
        <DietaryBadges item={item} config={config} texts={texts} />
        {desc && config.design.menu.show_descriptions && <p className="m-0 k-muted">{desc}</p>}
        <div className="flex items-center gap-[1em] flex-wrap">
          <span className="k-price text-[1.4em]">{priceLabel(item, config, ctx, texts)}</span>
          {config.design.menu.show_calories && item.calories != null && <span className="k-muted">{texts.ui('kcal', { n: item.calories })}</span>}
        </div>
        <AllergenLine item={item} config={config} texts={texts} className="k-muted" />
      </div>
    </div>
  )
}

/**
 * Scroll to the first group still waiting for a pick and make it flash. The
 * Add / Continue buttons stay tappable while something is missing: a tap
 * shows the guest where to look instead of doing nothing.
 */
function pointAtMissing() {
  const el = document.querySelector('[data-testid="k-builder"] [data-missing="1"]')
  if (!el) return
  bringIntoView(el)
  el.classList.remove('k-attn')
  void el.offsetWidth
  el.classList.add('k-attn')
}

function AddBar({ texts, qty, setQty, priced, missing, editing, onAdd, onBack, total }) {
  const { ui, money } = texts
  return (
    <div className="shrink-0 bg-[var(--k-surface)] border-t-2 border-[var(--k-line)] px-[var(--k-pad)] py-[var(--k-gap)] flex flex-col gap-[var(--k-gap)]">
      {missing && <span className="font-bold text-[var(--k-primary)] text-right" data-testid="k-missing">{ui('choose_first', { name: missing })}</span>}
      <div className="flex items-center gap-[var(--k-pad)]">
        <BackButton onClick={onBack} label={ui('back')} />
        <Stepper value={qty} onChange={setQty} labels={{ less: ui('one_less'), more: ui('one_more') }} />
        <button className={cx('k-btn k-btn-primary k-btn-big ml-auto', missing && 'k-btn-wait')} disabled={!missing && !priced.ok}
          onClick={() => (missing ? pointAtMissing() : onAdd())} data-testid="k-add" data-ready={missing ? '0' : '1'}>
          {editing ? ui('update_order') : ui('add_to_order')}{total != null ? ' · ' + money(total) : ''}
        </button>
      </div>
    </div>
  )
}

// ── A dish ───────────────────────────────────────────────────────

function DishBuilder({ item, config, ctx, texts, builder }) {
  const [sel, setSel] = useState(() => ({ choices: {}, ...builder.selection }))
  const [qty, setQty] = useState(builder.qty || 1)
  const priced = useMemo(() => priceItem(item, sel, ctx), [item, sel, ctx])
  const missing = missingIn(item.pos_choices || [], sel.choices, config, c => groupName(c, texts))
  const total = priced.ok ? lineGross({ ...priced, qty }) : null
  const portrait = usePortrait()
  const split = useMemo(() => splitImages(config, item, sel), [config, item, sel])
  const groups = (item.pos_choices || []).map(c => (
    <OptionGroup key={c.key} choice={c} config={config} texts={texts} itemId={item.id}
      value={sel.choices?.[c.key] || []} onChange={v => setSel(x => ({ ...x, choices: { ...(x.choices || {}), [c.key]: v } }))} />
  ))
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--k-bg)] k-fade" data-testid="k-builder">
      <TopBar title={texts.itemName(item)} config={config} />
      {portrait || !groups.length ? (
        <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[calc(var(--k-pad)*1.2)]">
          <Hero item={item} config={config} ctx={ctx} texts={texts} split={split} />
          {groups}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-[32%] max-w-[480px] shrink-0 k-scroll p-[var(--k-pad)] bg-[var(--k-surface)] border-r-2 border-[var(--k-line)]">
            <Hero item={item} config={config} ctx={ctx} texts={texts} side split={split} />
          </aside>
          <div className="flex-1 min-w-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[calc(var(--k-pad)*1.2)]">{groups}</div>
        </div>
      )}
      <AddBar texts={texts} qty={qty} setQty={setQty} priced={priced} missing={missing} editing={!!builder.key} total={total}
        onBack={closeBuilder} onAdd={() => addToBasket({ item_id: item.id, selection: { choices: sel.choices || {} }, qty }, builder.key)} />
    </div>
  )
}

// ── A combo ──────────────────────────────────────────────────────

const sameChoice = (e, c) => e.option_id === c.option_id && (e.item_id || null) === (c.item_id || null)

/** The combo's pages for the picks so far, and the optional steps waiting behind a button. */
function comboPages(item, sel, ctx, opened) {
  const { picks, steps } = resolveSteps(item, sel.combo || {}, ctx)
  const pages = []
  const buttons = []
  for (const st of steps) {
    if (!st.shown) continue
    const step = st.step
    const got = picks[step.id] || []
    if (step.ask === 'button' && !got.length && !opened.has(step.id)) { buttons.push(step); continue }
    if (!st.auto) pages.push({ key: 'step:' + step.id, kind: 'step', st })
    got.forEach((e, i) => {
      const part = e.item_id ? configItemFrom(ctx, e.item_id) : null
      if (part?.pos_choices?.length) pages.push({ key: 'part:' + step.id + ':' + i, kind: 'part', st, index: i, entry: e, part })
    })
  }
  if ((item.pos_choices || []).length) pages.push({ key: 'own', kind: 'own' })
  pages.push({ key: 'review', kind: 'review' })
  return { pages, buttons, picks, steps }
}
const configItemFrom = (ctx, id) => ctx.itemsById[id] || null

function ComboBuilder({ item, config, ctx, texts, builder }) {
  const { t, ui, money } = texts
  const [sel, setSel] = useState(() => ({ choices: {}, combo: {}, ...builder.selection }))
  const [qty, setQty] = useState(builder.qty || 1)
  const [opened, setOpened] = useState(() => new Set(Object.keys(builder.selection?.combo || {})))
  const { pages, buttons, picks } = useMemo(() => comboPages(item, sel, ctx, opened), [item, sel, ctx, opened])
  const [pageKey, setPageKey] = useState(() => (builder.key ? 'review' : pages[0]?.key))
  const advanceFrom = useRef(null)
  let index = pages.findIndex(p => p.key === pageKey)
  if (index < 0) index = Math.min(pages.length - 1, Math.max(0, pages.findIndex(p => p.kind === 'review')))
  const page = pages[index]
  const priced = useMemo(() => priceItem(item, { ...sel, combo: picks }, ctx), [item, sel, picks, ctx])
  const total = priced.ok ? lineGross({ ...priced, qty }) : null
  const sold = soldOut(config)
  const display = st => DISPLAYS[st.step.display || config.design.options.display] || DISPLAYS.grid
  const look = choiceLook(config.design)
  const stepName = step => t(TK.step(item.id, step.id), step.name)

  // A single pick on a one-choice step moves on by itself.
  useEffect(() => {
    if (!advanceFrom.current) return
    const from = pages.findIndex(p => p.key === advanceFrom.current)
    advanceFrom.current = null
    if (from >= 0 && pages[from + 1]) {
      const id = setTimeout(() => setPageKey(pages[from + 1].key), 320)
      return () => clearTimeout(id)
    }
  }, [pages])

  const setStep = (stepId, list) => setSel(x => ({ ...x, combo: { ...(x.combo || {}), [stepId]: list } }))
  const complete = p => {
    if (p.kind === 'step') { const got = picks[p.st.step.id] || []; return got.length >= p.st.step.min && got.length <= p.st.step.max }
    if (p.kind === 'part') return !missingIn(p.part.pos_choices, p.entry.choices || {}, config, c => groupName(c, texts))
    if (p.kind === 'own') return !missingIn(item.pos_choices, sel.choices || {}, config, c => groupName(c, texts))
    return priced.ok
  }
  const pageTitle = p => {
    if (p.kind === 'step') return stepName(p.st.step)
    if (p.kind === 'part') {
      const same = (picks[p.st.step.id] || []).filter(e => e.item_id === p.entry.item_id).length > 1
      return ui('options_for', { name: texts.itemName(p.part) + (same ? ' ' + (p.index + 1) : '') })
    }
    if (p.kind === 'own') return texts.itemName(item)
    return ui('your_choice')
  }
  const goNext = () => { if (pages[index + 1]) setPageKey(pages[index + 1].key) }
  const goBack = () => (index > 0 ? setPageKey(pages[index - 1].key) : closeBuilder())
  const add = () => addToBasket({ item_id: item.id, selection: { choices: sel.choices || {}, combo: picks }, qty }, builder.key)

  // Plain functions, not components: a component made inside this one would
  // be a new type on every render and lose its state (a slider's place).
  function stepPage(p) {
    const step = p.st.step
    const got = picks[step.id] || []
    const choices = p.st.choices.map(c => ({
      id: c.key,
      label: c.item ? texts.itemName(c.item) : t(TK.choice(item.id, c.option_id), c.label),
      description: c.item ? (c.item.description ? t(TK.item(c.item_id, 'description'), c.item.description) : null)
        : (c.description ? t(TK.choice(item.id, c.option_id, 'description'), c.description) : null),
      image_url: c.image_url, level: null,
      priceText: c.price_pence ? '+' + money(c.price_pence) : '',
      sold_out: c.sold_out || (c.item_id && sold.has(c.item_id)),
      c,
    }))
    const countOf = id => { const c = p.st.choices.find(x => x.key === id); return c ? got.filter(e => sameChoice(e, c)).length : 0 }
    const full = step.repeat ? got.length >= step.max : step.max > 1 && got.length >= step.max
    const onTap = o => {
      const c = o.c
      const entry = { option_id: c.option_id, item_id: c.item_id, choices: {} }
      const n = got.filter(e => sameChoice(e, c)).length
      if (step.repeat) { if (got.length < step.max) setStep(step.id, [...got, entry]); return }
      if (n) { setStep(step.id, got.filter(e => !sameChoice(e, c))); return }
      if (step.max === 1) {
        setStep(step.id, [entry])
        advanceFrom.current = p.key
        return
      }
      if (got.length < step.max) setStep(step.id, [...got, entry])
    }
    const onLess = o => {
      const c = o.c
      const i = got.map(e => sameChoice(e, c)).lastIndexOf(true)
      if (i >= 0) setStep(step.id, got.filter((_, j) => j !== i))
    }
    const Display = display(p.st)
    return (
      <div key={p.key} className="flex flex-col gap-[var(--k-gap)]" data-testid="k-step" data-step={step.id}
        data-missing={got.length < step.min ? '1' : undefined}>
        <div className={cx('k-muted font-semibold', look.center && 'text-center')}>{ruleText(ui, step.min, step.max)}{step.max > 1 ? ' · ' + got.length + '/' + step.max : ''}{step.repeat ? ' · ' + ui('tap_again') : ''}</div>
        <Display options={choices} countOf={countOf} onTap={onTap} onLess={onLess} repeat={step.repeat} full={full}
          scale={null} levelIcon={config.design.options.level_icon} ui={ui} {...look} wheel={wheelOf(config)} />
      </div>
    )
  }

  function partPage(p) {
    const entry = p.entry
    const setChoices = choices => setStep(p.st.step.id, (picks[p.st.step.id] || []).map((e, i) => (i === p.index ? { ...e, choices } : e)))
    return (
      <div key={p.key} className="flex flex-col gap-[calc(var(--k-pad)*1.2)]" data-testid="k-part">
        {p.part.pos_choices.map(c => (
          <OptionGroup key={c.key} choice={c} config={config} texts={texts} itemId={p.part.id}
            value={entry.choices?.[c.key] || []} onChange={v => setChoices({ ...(entry.choices || {}), [c.key]: v })} />
        ))}
      </div>
    )
  }

  function review() {
    return (
      <div className="flex flex-col gap-[var(--k-gap)]" data-testid="k-review">
        {pages.filter(x => x.kind === 'step').map(x => {
          const got = picks[x.st.step.id] || []
          return (
            <button key={x.key} className="k-card text-left p-[.8em] flex items-center gap-[.8em] border-0" onClick={() => setPageKey(x.key)}>
              <span className="w-[2em] h-[2em] rounded-full bg-[var(--k-primary)] text-[var(--k-primary-text)] flex items-center justify-center shrink-0"><Check size={18} strokeWidth={3} /></span>
              <span className="flex-1 min-w-0">
                <span className="k-head block">{stepName(x.st.step)}</span>
                <span className="k-muted">{got.length ? summary(got, x.st) : ui('skip')}</span>
              </span>
            </button>
          )
        })}
        {buttons.map(step => (
          <button key={step.id} className="k-btn justify-start" onClick={() => { setOpened(o => new Set([...o, step.id])); setPageKey('step:' + step.id) }} data-testid="k-step-button">
            <Plus /> {stepName(step)}
          </button>
        ))}
        <AllergenLine levels={pickedLevels()} config={config} texts={texts} className="k-card p-[.8em]" />
      </div>
    )
  }

  // The allergens of what is picked (the combo's own tags and each dish in it).
  function pickedLevels() {
    const ids = Object.values(picks).flat().map(e => e.item_id).filter(Boolean)
    return mergeLevels([dishLevels(item), ...ids.map(id => dishLevels(configItem(config, id)))])
  }

  // "2 x Ranch, Lemon pepper"
  function summary(got, st) {
    const counts = new Map()
    for (const e of got) {
      const c = st.choices.find(x => sameChoice(e, x))
      const label = c ? (c.item ? texts.itemName(c.item) : t(TK.choice(item.id, c.option_id), c.label)) : ''
      counts.set(label, (counts.get(label) || 0) + 1)
    }
    return [...counts].map(([l, n]) => (n > 1 ? n + ' x ' : '') + l).join(', ')
  }

  const portrait = usePortrait()
  const steps = pages
  const can = complete(page)
  const split = splitImages(config, item, { ...sel, combo: picks })
  const header = config.design.layout.header
  const priceNow = total != null ? money(total) : priceLabel(item, config, ctx, texts)
  // The step being shown stays in sight in the list of steps; the page itself starts at the top.
  const rail = useRef(null)
  const body = useRef(null)
  useEffect(() => {
    bringIntoView(rail.current?.querySelector('[data-active="1"]'), portrait ? 'x' : 'y')
    body.current?.scrollTo({ top: 0 })
  }, [index, portrait])
  const isStep = page.kind === 'step'
  const optionalEmpty = isStep && page.st.step.min === 0 && !(picks[page.st.step.id] || []).length
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--k-bg)] k-fade" data-testid="k-builder" data-combo="1">
      <TopBar title={texts.itemName(item)} config={config}
        right={<span className="k-price text-[1.2em]">{priceNow}</span>} />
      <div className="flex-1 min-h-0 flex landscape:flex-row flex-col">
        <aside ref={rail} className={cx('shrink-0 bg-[var(--k-surface)] flex', portrait ? 'flex-row items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[var(--k-gap)] k-hscroll border-b-2 border-[var(--k-line)]' : 'flex-col w-[30%] max-w-[420px] k-scroll p-[var(--k-pad)] gap-[var(--k-gap)] border-r-2 border-[var(--k-line)]')}>
          {!portrait && (
            <div className="flex flex-col gap-[.4em] mb-[.4em]">
              <div className="k-hero-img overflow-hidden rounded-[var(--k-radius)]">
                <PickPhoto srcs={split} src={item.image_url} label={texts.itemName(item)} className="w-full aspect-[4/3] object-cover" phClassName="k-item-ph"
                  splitClassName="w-full aspect-[4/3]" />
              </div>
              <div className="k-head text-[1.5em]">{texts.itemName(item)}</div>
              {!header && <div className="k-price text-[1.3em]" data-testid="k-combo-price">{priceNow}</div>}
              {item.description && <div className="k-muted text-[.85em]">{t(TK.item(item.id, 'description'), item.description)}</div>}
              <AllergenLine item={item} config={config} texts={texts} className="k-muted" />
            </div>
          )}
          {steps.map((x, i) => {
            const done = complete(x) && (x.kind !== 'step' || (picks[x.st.step.id] || []).length > 0 || x.st.step.min === 0)
            return (
              <button key={x.key} onClick={() => (i <= index || done ? setPageKey(x.key) : null)} data-testid="k-step-tab" data-active={i === index ? '1' : undefined}
                className={cx('flex items-center gap-[.5em] text-left rounded-[calc(var(--k-radius)/1.5)] border-2 shrink-0',
                  portrait ? 'px-[.8em] min-h-[2.8em]' : 'px-[.7em] min-h-[3em]',
                  i === index ? 'border-[var(--k-primary)] bg-[var(--k-soft)]' : 'border-transparent')}>
                <span className={cx('w-[1.7em] h-[1.7em] rounded-full flex items-center justify-center shrink-0 text-[.85em] font-bold',
                  done ? 'bg-[var(--k-primary)] text-[var(--k-primary-text)]' : 'border-2 border-[var(--k-line)]')}>
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={cx('font-semibold', portrait && 'whitespace-nowrap')}>{pageTitle(x)}</span>
              </button>
            )
          })}
        </aside>
        <main ref={body} className="flex-1 min-w-0 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[var(--k-gap)]">
          {/* No bar along the top: on an upright screen the combo's name and price go here. */}
          {!header && portrait && (
            <div className="flex items-center gap-[var(--k-gap)]" data-testid="k-combo-head">
              {split.length > 0 && <div className="k-hero-img w-[5.5em] shrink-0 overflow-hidden rounded-[calc(var(--k-radius)/1.5)]"><PickPhoto srcs={split} splitClassName="w-full aspect-[4/3]" /></div>}
              <span className="k-head text-[1.4em] flex-1 min-w-0">{texts.itemName(item)}</span>
              <span className="k-price text-[1.3em]" data-testid="k-combo-price">{priceNow}</span>
            </div>
          )}
          {header && portrait && split.length > 0 && page.kind === 'review' && (
            <div className="k-hero-img w-[min(60%,420px)] overflow-hidden rounded-[var(--k-radius)]"><PickPhoto srcs={split} splitClassName="w-full aspect-[4/3]" /></div>
          )}
          <div className="flex items-baseline gap-[.6em] flex-wrap">
            <span className="k-muted font-semibold">{ui('step_of', { n: index + 1, total: pages.length })}</span>
            <h2 className="k-head text-[1.8em] m-0">{pageTitle(page)}</h2>
          </div>
          {page.kind === 'step' && stepPage(page)}
          {page.kind === 'part' && partPage(page)}
          {page.kind === 'own' && (item.pos_choices || []).map(c => (
            <OptionGroup key={c.key} choice={c} config={config} texts={texts} itemId={item.id}
              value={sel.choices?.[c.key] || []} onChange={v => setSel(x => ({ ...x, choices: { ...(x.choices || {}), [c.key]: v } }))} />
          ))}
          {page.kind === 'review' && review()}
        </main>
      </div>
      <div className="shrink-0 bg-[var(--k-surface)] border-t-2 border-[var(--k-line)] px-[var(--k-pad)] py-[var(--k-gap)] flex items-center gap-[var(--k-pad)] flex-wrap">
        <BackButton onClick={goBack} label={ui('back')} testId="k-step-back" />
        {page.kind === 'review' && <Stepper value={qty} onChange={setQty} labels={{ less: ui('one_less'), more: ui('one_more') }} />}
        {page.kind === 'review' ? (
          <button className="k-btn k-btn-primary k-btn-big ml-auto" disabled={!priced.ok} onClick={add} data-testid="k-add">
            {builder.key ? ui('update_order') : ui('add_to_order')}{total != null ? ' · ' + money(total) : ''}
          </button>
        ) : (
          <button className={cx('k-btn k-btn-primary k-btn-big ml-auto', !can && 'k-btn-wait')} onClick={() => (can ? goNext() : pointAtMissing())}
            data-testid="k-continue" data-ready={can ? '1' : '0'}>
            {optionalEmpty ? ui('skip') : ui('continue')}
          </button>
        )}
      </div>
    </div>
  )
}
