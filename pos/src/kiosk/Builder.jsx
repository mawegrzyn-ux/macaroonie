// Building one item on the kiosk. A dish shows its photo, words, allergens
// and option groups on one page. A combo goes one page at a time (like the
// till's steps, shared/combos.js): each step's choices in the step's display
// (grid, list, slider, wheel), then the picked dish's options as the deal
// asks them (dealItem()), then a last page with everything picked. The steps show down the side (or along
// the top on a portrait screen), each done one with its pick's picture and
// name; how far along shows beside Continue. Every combo page has the big
// picture a dish's page has (Hero, following the design's dish page
// layout): the picked dish's own photo and words on its options page, else
// the deal's picture: put together from the picks as they're made
// (design.layout.combo_build: shared/kiosk.js bundleParts(), parts.jsx
// BundlePhoto), or the deal's own photo with the picks each step puts on it.
// Pricing and the rules are the till's: shared/pos/pricing.js priceItem().
// Each group or step says where its picks' pictures go on the dish's photo
// as they're picked (shared/kiosk.js pickImages()): side by side (one pick:
// its picture instead), or small in its corner (parts.jsx PickPhoto).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Info, AlertCircle } from 'lucide-react'
import { priceItem, lineGross } from '@shared/pos/pricing.js'
import { resolveSteps } from '@shared/combos.js'
import { fromPrice, priceVaries } from '@shared/orderPricing.js'
import { configItem, dealItem, comboCtx } from '@shared/pos/offers.js'
import { TK, allergenName, pickImages, bundleParts } from '@shared/kiosk.js'
import { useKiosk, textsFor, addToBasket, closeBuilder, soldOut, itemLevels, dishLevels, mergeLevels, fitOf } from './store.js'
import OptionGroup, { missingIn, groupName } from './OptionGroup.jsx'
import { DISPLAYS, choiceLook } from './displays.jsx'
import { cx, Pic, PickPhoto, BundlePhoto, Stepper, BackButton, bringIntoView, usePortrait } from './parts.jsx'
import { FitMark, FitNote, needsCheck } from './fit.jsx'

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
    if (tag.kind === 'allergen') allergens[lv].push({ code: tag.code, name: allergenName(tag, texts.lang, texts.dict) })
    else if (withDietary) dietary.push({ ...tag, name: texts.t(TK.tag(tag.code), tag.label) })
  }
  return { allergens, dietary }
}

/** An item's tags: a combo's allergens are every dish it can hold, and it gets no dietary badges (one vegan part doesn't make it vegan). */
export function itemTags(item, config, texts) {
  return tagLists(itemLevels(config, item), config, texts, { dietary: item?.kind !== 'combo' })
}

/**
 * The allergen line: an item's (levels left out), or given levels (the
 * dishes picked in a combo). The allergens the guest avoids (the allergens
 * screen) are highlighted.
 */
export function AllergenLine({ item = null, levels = null, config, texts, className, depends = false }) {
  const { prefs } = useKiosk()
  const { allergens } = levels ? tagLists(levels, config, texts, { dietary: false }) : itemTags(item, config, texts)
  const { ui } = texts
  const parts = [['contains', allergens.contains], ['may_contain', allergens.may_contain], ['can_be_removed', allergens.removable]].filter(([, list]) => list.length)
  const combo = depends || (!levels && item?.kind === 'combo')
  const hit = parts.some(([, list]) => list.some(a => prefs.avoid.includes(a.code)))
  return (
    <div className={cx('flex gap-[.4em] items-start text-[.85em]', className)} data-testid="k-allergens">
      {hit ? <span className="k-fit-mark k-fit-mark-sm shrink-0" aria-hidden="true"><AlertCircle strokeWidth={2.6} /></span> : <Info size={18} className="shrink-0 mt-[.1em]" />}
      <span>
        {!parts.length && ui('no_allergens')}
        {parts.length > 0 && combo && ui('depends_on_choice') + '. '}
        {parts.map(([key, list], i) => (
          <span key={key}>
            {i > 0 && ' · '}{ui(key)}: {list.map((a, j) => (
              <span key={a.code}>{j > 0 && ', '}{prefs.avoid.includes(a.code) ? <mark className="k-fit-hl">{a.name}</mark> : a.name}</span>
            ))}
          </span>
        ))}
      </span>
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

// Lining up a column of words (k-align-<left|center|right>: text and the rows in it).
const alignCls = a => 'k-align-' + (a || 'left')
// A picture's place across the width.
const SELF = { left: 'self-start', center: 'self-center', right: 'self-end' }

/**
 * The words lined up as the design's dish page says (layout.hero_text_align),
 * for a dish page or a combo's side column on a wide screen, when the design
 * puts the photo on top of the words; else from the left.
 */
export function heroTextAlign(design) {
  return design.layout.hero === 'stacked' ? design.layout.hero_text_align : 'left'
}

// The photo at the top of a dish's page (or a meal deal's picture), sized for
// where it sits (Hero). bundle (with seen): the deal's picture put together
// from its picks, in place of the photo (BundlePhoto).
function HeroPhoto({ item, config, texts, side = false, split = null, bundle = null, seen = null }) {
  const y = config.design.layout
  const stacked = !side && y.hero === 'stacked'
  return (
    <div className={cx('k-hero-img shrink-0 overflow-hidden rounded-[var(--k-radius)]', side ? 'w-full' : stacked ? 'w-[min(64%,560px)] ' + SELF[y.hero_image_align] : 'w-[38%] max-w-[480px]')}
      data-testid="k-hero-img">
      {bundle ? (
        <BundlePhoto parts={bundle} tiles={y.tiles} seen={seen} className="w-full h-full aspect-[4/3]" />
      ) : (
        <PickPhoto picks={split} src={item.image_url} label={texts.itemName(item)} className="w-full h-full object-cover aspect-[4/3]" phClassName="k-item-ph h-full"
          splitClassName="w-full h-full aspect-[4/3]" />
      )}
    </div>
  )
}

// The top of a dish's page (design.layout.hero). Beside (portrait): the photo
// sits beside the words, so the choices start on the first screen. Stacked
// (portrait): the photo on top, lined up left, centre or right
// (hero_image_align), the words under it (hero_text_align). Landscape (side):
// the photo above the words in a column of their own, the choices beside them.
// A combo's pages use it too: price = null leaves the price out (the running
// price is in the top bar), a price node shows that instead of the dish's
// own, note is a line under the name ("In Burger meal"), bundle and seen go
// to HeroPhoto, and photo = false leaves the photo to the page (a combo's
// side column keeps it in sight on its own).
function Hero({ item, config, ctx, texts, side = false, split = null, bundle = null, seen = null, price, note = null, photo = true }) {
  const name = texts.itemName(item)
  const desc = item.description ? texts.t(TK.item(item.id, 'description'), item.description) : null
  const y = config.design.layout
  const stacked = !side && y.hero === 'stacked'
  const align = heroTextAlign(config.design)
  const shownPrice = price === undefined ? priceLabel(item, config, ctx, texts) : price
  const calories = config.design.menu.show_calories && item.calories != null
  return (
    <div className={cx('flex gap-[var(--k-pad)]', side || stacked ? 'flex-col' : 'items-start')} data-testid="k-hero" data-item={item.id}
      data-hero={side ? 'side' : y.hero} data-image-align={stacked ? y.hero_image_align : undefined} data-text-align={align}>
      {photo && <HeroPhoto item={item} config={config} texts={texts} side={side} split={split} bundle={bundle} seen={seen} />}
      <div className={cx('flex flex-col gap-[.5em] min-w-0 flex-1', alignCls(align))} data-testid="k-hero-words">
        <h2 className="k-head text-[1.9em] m-0">{name}</h2>
        {note && <div className="k-muted font-semibold" data-testid="k-hero-note">{note}</div>}
        <DietaryBadges item={item} config={config} texts={texts} />
        {desc && config.design.menu.show_descriptions && <p className="m-0 k-muted">{desc}</p>}
        {(shownPrice || calories) && (
          <div className="flex items-center gap-[1em] flex-wrap">
            {shownPrice && <span className="k-price text-[1.4em]">{shownPrice}</span>}
            {calories && <span className="k-muted">{texts.ui('kcal', { n: item.calories })}</span>}
          </div>
        )}
        <AllergenLine item={item} config={config} texts={texts} className="k-muted" />
        <HeroFit item={item} config={config} texts={texts} />
      </div>
    </div>
  )
}

// The dish against the guest's allergens and diets: the mark and why, when there is something to check.
function HeroFit({ item, config, texts }) {
  const { prefs } = useKiosk()
  const fit = fitOf(config, item, prefs)
  if (!fit || (fit.ok && !fit.removable.length && !fit.some)) return null
  return (
    <div className="k-fit-box flex items-start gap-[.6em]" data-testid="k-hero-fit">
      <FitMark fit={fit} texts={texts} />
      <FitNote fit={fit} config={config} texts={texts} className="text-[1em]" />
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
      {/* Everything picked and still no price (a dish with no price set): say
          so, never a greyed-out button with no reason. */}
      {!missing && !priced.ok && <span className="font-bold text-[var(--k-primary)] text-right" data-testid="k-cant-order">{ui('cant_order')}</span>}
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
  const split = useMemo(() => pickImages(config, item, sel), [config, item, sel])
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

/**
 * The combo's pages for the picks so far, and the optional steps waiting
 * behind a button. A picked dish's page asks its options as the deal does
 * (shared/pos/offers.js dealItem(): some left out, only some offered,
 * another group instead), so its pages, pictures and tabs show what prices.
 */
function comboPages(item, sel, ctx, opened, config) {
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
      const c = e.item_id ? st.choices.find(x => sameChoice(e, x)) : null
      const part = e.item_id ? dealItem(config, e.item_id, c?.groups) : null
      if (part?.pos_choices?.length) pages.push({ key: 'part:' + step.id + ':' + i, kind: 'part', st, index: i, entry: e, part })
    })
  }
  if ((item.pos_choices || []).length) pages.push({ key: 'own', kind: 'own' })
  pages.push({ key: 'review', kind: 'review' })
  return { pages, buttons, picks, steps }
}

function ComboBuilder({ item, config, ctx, texts, builder }) {
  const { t, ui, money } = texts
  const { prefs } = useKiosk()
  const [sel, setSel] = useState(() => ({ choices: {}, combo: {}, ...builder.selection }))
  const [qty, setQty] = useState(builder.qty || 1)
  const [opened, setOpened] = useState(() => new Set(Object.keys(builder.selection?.combo || {})))
  // When each part of the deal's picture first showed (BundlePhoto), kept
  // across the pages: back on the deal's picture, only what's new pops in.
  const bundleSeen = useRef(new Map())
  const { pages, buttons, picks } = useMemo(() => comboPages(item, sel, ctx, opened, config), [item, sel, ctx, opened, config])
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
    })).map(o => {
      // A dish choice against the guest's allergens and diets (a typed-in one
      // has no tags): the displays show the mark and the note as given.
      const fit = o.c.item ? fitOf(config, o.c.item, prefs) : null
      return fit ? { ...o, mark: <FitMark fit={fit} texts={texts} className="k-fit-badge" />, note: <FitNote fit={fit} config={config} texts={texts} />, check: needsCheck(fit) } : o
    })
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
    // The step's name (the page's heading, just above) says what to pick: no
    // "Choose 1" line between it and the choices.
    return (
      <div key={p.key} className={'flex flex-col gap-[var(--k-gap)] k-choices k-opts-' + look.tiles} data-testid="k-step" data-step={step.id}
        data-tiles={look.tiles} data-missing={got.length < step.min ? '1' : undefined}>
        <Display options={choices} countOf={countOf} onTap={onTap} onLess={onLess} repeat={step.repeat} full={full}
          scale={null} levelIcon={config.design.options.level_icon} ui={ui} {...look} wheel={wheelOf(config)} />
      </div>
    )
  }

  // What a page's picks are, for its tab once done: { label: "2 x Ranch,
  // Lemon pepper", images: the picks' pictures, each once, up to three,
  // tiles: their picture style (a step's: the design's; a dish's groups: the
  // first group with a picture's look) }, or null when nothing is picked there.
  function pickedOf(p) {
    let list = []
    if (p.kind === 'step') {
      list = (picks[p.st.step.id] || []).map(e => {
        const c = p.st.choices.find(x => sameChoice(e, x))
        return c ? { label: c.item ? texts.itemName(c.item) : t(TK.choice(item.id, c.option_id), c.label), image: c.image_url || null, tiles: look.tiles } : null
      }).filter(Boolean)
    } else if (p.kind === 'part') list = groupPicks(p.part.pos_choices, p.entry.choices, p.part.id)
    else if (p.kind === 'own') list = groupPicks(item.pos_choices, sel.choices, item.id)
    if (!list.length) return null
    const counts = new Map()
    for (const x of list) counts.set(x.label, (counts.get(x.label) || 0) + 1)
    return {
      label: [...counts].map(([l, n]) => (n > 1 ? n + ' x ' : '') + l).join(', '),
      images: [...new Set(list.map(x => x.image).filter(Boolean))].slice(0, 3),
      tiles: list.find(x => x.image)?.tiles || look.tiles,
    }
  }

  // The picks in a dish's option groups (not the groups an option opens), as { label, image, tiles }.
  function groupPicks(choices, value, itemId) {
    const out = []
    for (const c of choices || []) {
      const lib = config.groups?.[c.key]
      const tiles = choiceLook(config.design, lib).tiles
      for (const e of value?.[c.key] || []) {
        const o = c.options.find(x => x.id === e.id)
        if (!o) continue
        const lo = lib?.options?.find(x => (x.option_id ?? x.id) === e.id)
        out.push({ label: c.key === 'variants' ? t(TK.variant(itemId, o.label), o.label) : t(TK.option(o.id, 'label'), o.label), image: lo?.image_url || null, tiles })
      }
    }
    return out
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
  const split = pickImages(config, item, { ...sel, combo: picks })
  const header = config.design.layout.header
  const priceNow = total != null ? money(total) : priceLabel(item, config, ctx, texts)
  // The big picture on this page, drawn as a dish's page draws its own
  // (Hero: beside or on top of the words upright, its own column on a wide
  // screen): the picked dish on its options page, with its own picks on its
  // photo; else the deal: its picture put together from the picks so far
  // (design.layout.combo_build, from the first pick with a picture on), or
  // its own photo with the picks each step puts on it. The running price
  // shows once: in the top bar, or with the header off in the deal's hero,
  // or above a picked dish's hero (k-combo-head).
  const comboPrice = header ? null : <span data-testid="k-combo-price">{priceNow}</span>
  const bundle = config.design.layout.combo_build ? bundleParts(config, item, picks, sel.choices) : []
  const subject = page.kind === 'part'
    ? { item: page.part, split: pickImages(config, page.part, { choices: page.entry.choices || {} }), price: null, note: ui('in_deal', { name: texts.itemName(item) }) }
    : { item, split, price: comboPrice, note: null, bundle: bundle.length ? bundle : null }
  const hero = (side, photo = true) => <Hero item={subject.item} config={config} ctx={ctx} texts={texts} side={side} split={subject.split} price={subject.price} note={subject.note}
    bundle={subject.bundle || null} seen={bundleSeen} photo={photo} />
  const comboHead = !header && subject.item !== item && (
    <div className="flex items-center gap-[var(--k-gap)]" data-testid="k-combo-head">
      <span className="k-head text-[1.3em] flex-1 min-w-0 truncate">{texts.itemName(item)}</span>
      <span className="k-price text-[1.3em]" data-testid="k-combo-price">{priceNow}</span>
    </div>
  )
  // The step being shown stays in sight in the list of steps (on a wide
  // screen below the picture, which stays at the top of the column as the
  // steps scroll under it, moving the list no further than needed); the page
  // itself starts at the top.
  const rail = useRef(null)
  const body = useRef(null)
  // A pick can change the tab's size (its pictures once done).
  const pickCount = Object.values(picks).reduce((n, l) => n + l.length, 0)
  useEffect(() => {
    const tab = rail.current?.querySelector('[data-active="1"]')
    if (portrait) bringIntoView(tab, 'x')
    else if (tab) {
      const r = rail.current.getBoundingClientRect()
      const b = tab.getBoundingClientRect()
      const top = r.top + (rail.current.querySelector('[data-testid="k-combo-photo"]')?.offsetHeight || 0) + 8
      if (b.top < top) rail.current.scrollBy({ top: b.top - top, behavior: 'smooth' })
      else if (b.bottom > r.bottom - 8) rail.current.scrollBy({ top: b.bottom - r.bottom + 8, behavior: 'smooth' })
    }
  }, [index, portrait, pickCount])
  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [index, portrait])
  const isStep = page.kind === 'step'
  const optionalEmpty = isStep && page.st.step.min === 0 && !(picks[page.st.step.id] || []).length
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--k-bg)] k-fade" data-testid="k-builder" data-combo="1">
      <TopBar title={texts.itemName(item)} config={config}
        right={<span className="k-price text-[1.2em]">{priceNow}</span>} />
      <div className="flex-1 min-h-0 flex landscape:flex-row flex-col">
        <aside ref={rail} className={cx('shrink-0 bg-[var(--k-surface)] flex', portrait ? 'flex-row items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[var(--k-gap)] k-hscroll border-b-2 border-[var(--k-line)]' : 'flex-col w-[30%] max-w-[420px] k-scroll p-[var(--k-pad)] gap-[var(--k-gap)] border-r-2 border-[var(--k-line)]')}>
          {!portrait && (
            <>
              <div className="sticky z-[10] top-[calc(var(--k-pad)*-1)] -mt-[var(--k-pad)] pt-[var(--k-pad)] pb-[.4em] bg-[var(--k-surface)]" data-testid="k-combo-photo" data-item={subject.item.id}>
                <HeroPhoto item={subject.item} config={config} texts={texts} side split={subject.split} bundle={subject.bundle || null} seen={bundleSeen} />
              </div>
              <div className="mb-[.4em]">{hero(true, false)}</div>
            </>
          )}
          {steps.map((x, i) => {
            const done = complete(x) && (x.kind !== 'step' || (picks[x.st.step.id] || []).length > 0 || x.st.step.min === 0)
            const tab = cx('flex text-left rounded-[calc(var(--k-radius)/1.5)] border-2 shrink-0',
              i === index ? 'border-[var(--k-primary)] bg-[var(--k-soft)]' : 'border-transparent')
            const open = () => (i <= index || done ? setPageKey(x.key) : null)
            // Done with something picked: the pick's picture, its name under it.
            const pk = done ? pickedOf(x) : null
            if (pk) {
              return (
                <button key={x.key} onClick={open} data-testid="k-step-tab" data-active={i === index ? '1' : undefined} data-picked="1"
                  aria-label={pageTitle(x) + ': ' + pk.label}
                  className={cx(tab, 'k-step-pick', portrait ? 'flex-col items-center gap-[.25em] p-[.35em] w-[clamp(6.5em,20vmin,9em)]' : 'items-center gap-[.6em] px-[.5em] py-[.35em] min-h-[3em]')}>
                  <span className={'relative flex shrink-0 k-opts-' + pk.tiles} data-testid="k-step-pics" data-tiles={pk.tiles}>
                    {pk.images.length ? pk.images.map((src, j) => (
                      <span key={src} className={cx('k-opt-thumb k-step-thumb overflow-hidden rounded-[calc(var(--k-radius)/1.5)]', portrait ? 'w-[3.6em] h-[3.6em]' : 'w-[3em] h-[3em]', j > 0 && '-ml-[1.6em]')}
                        style={{ zIndex: 3 - j }}>
                        <Pic src={src} className="w-full h-full object-cover" />
                      </span>
                    )) : (
                      <span className={cx('rounded-full flex items-center justify-center bg-[var(--k-primary)] text-[var(--k-primary-text)]', portrait ? 'w-[3.6em] h-[3.6em]' : 'w-[3em] h-[3em]')}>
                        <Check size={22} strokeWidth={3} />
                      </span>
                    )}
                    {pk.images.length > 0 && <span className="k-step-tick"><Check size={12} strokeWidth={3} /></span>}
                  </span>
                  {portrait ? (
                    <span className="k-step-pick-name text-center" data-testid="k-step-pick">{pk.label}</span>
                  ) : (
                    <span className="flex flex-col min-w-0">
                      <span className="k-muted text-[.8em] font-semibold">{pageTitle(x)}</span>
                      <span className="k-step-pick-name" data-testid="k-step-pick">{pk.label}</span>
                    </span>
                  )}
                </button>
              )
            }
            return (
              <button key={x.key} onClick={open} data-testid="k-step-tab" data-active={i === index ? '1' : undefined}
                className={cx(tab, 'items-center gap-[.5em]', portrait ? 'px-[.8em] min-h-[2.8em]' : 'px-[.7em] min-h-[3em]')}>
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
          {comboHead}
          {portrait && <div className="mb-[calc(var(--k-pad)*0.4)]">{hero(false)}</div>}
          {/* The page's name just above its choices; how far along shows beside Continue. */}
          <div className={cx('flex items-baseline gap-[.6em] flex-wrap', isStep && look.center && 'justify-center text-center')} data-testid="k-page-head">
            <h2 className="k-head text-[1.8em] m-0" data-testid="k-page-title">{pageTitle(page)}</h2>
            {isStep && page.st.step.max > 1 && (
              <span className="k-chip min-h-0 py-[.15em] text-[.8em]" data-testid="k-step-picked">{(picks[page.st.step.id] || []).length + '/' + page.st.step.max}</span>
            )}
            {isStep && page.st.step.repeat && <span className="k-muted text-[.8em]">{ui('tap_again')}</span>}
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
        {page.kind === 'review' && !priced.ok && <span className="ml-auto font-bold text-[var(--k-primary)] text-right" data-testid="k-cant-order">{ui('cant_order')}</span>}
        {page.kind === 'review' ? (
          <button className="k-btn k-btn-primary k-btn-big ml-auto" disabled={!priced.ok} onClick={add} data-testid="k-add">
            {builder.key ? ui('update_order') : ui('add_to_order')}{total != null ? ' · ' + money(total) : ''}
          </button>
        ) : (
          <>
            {/* At the button's size, so it reads with it. */}
            <span className="ml-auto k-step-count" data-testid="k-step-count">{ui('step_of', { n: index + 1, total: pages.length })}</span>
            <button className={cx('k-btn k-btn-primary k-btn-big', !can && 'k-btn-wait')} onClick={() => (can ? goNext() : pointAtMissing())}
              data-testid="k-continue" data-ready={can ? '1' : '0'}>
              {optionalEmpty ? ui('skip') : ui('continue')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
