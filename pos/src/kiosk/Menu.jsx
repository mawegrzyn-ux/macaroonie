// The kiosk's menu: sections down the side (photos or words), a home page
// with the design's banners and featured tiles, a section's dishes as cards
// (photo, name, "from" price, calories, dietary badges, sold out), and the
// order bar at the bottom. A dish with no choices goes straight in with +.

import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Globe, Plus, Home as HomeIcon, ShoppingBag, Accessibility } from 'lucide-react'
import { checkTotals } from '@shared/pos/pricing.js'
import { configItem, comboCtx } from '@shared/pos/offers.js'
import { TK, basketCheck } from '@shared/kiosk.js'
import {
  useKiosk, textsFor, kioskSections, hasHome, openSection, openBuilder, addToBasket, go, restart, setLang, setReach, soldOut,
} from './store.js'
import { cx, Photo, Sheet, Flag } from './parts.jsx'
import { priceLabel, DietaryBadges } from './Builder.jsx'
import { Languages } from './Start.jsx'

export function needsBuilder(item) {
  return item.kind === 'combo' || (item.pos_choices || []).length > 0
}

/** Tap on a dish: its builder, or straight into the order (with + on, no choices). */
export function tapItem(item, config, texts, { quick = false } = {}) {
  if (needsBuilder(item) || (!quick && !config.design.menu.quick_add)) openBuilder(item.id)
  else addToBasket({ item_id: item.id, selection: {}, qty: 1 })
}

export function useBasketTotals(s) {
  return useMemo(() => {
    if (!s.basket.length) return { count: 0, total: 0, check: null }
    const r = basketCheck(s.config, s.basket, { device: s.device, order_type_id: s.orderType })
    const count = s.basket.reduce((n, e) => n + e.qty, 0)
    return r.ok ? { count, total: r.totals.total, totals: r.totals, check: r.check } : { count, total: 0, error: r.error }
  }, [s.config, s.basket, s.device, s.orderType])
}

function ItemCard({ item, config, ctx, texts, sold }) {
  const name = texts.itemName(item)
  const d = config.design.menu
  const desc = item.description && d.show_descriptions ? texts.t(TK.item(item.id, 'description'), item.description) : null
  const quick = d.quick_add && !needsBuilder(item) && !sold
  return (
    <div className="relative">
      <button className="k-card k-item w-full" onClick={() => !sold && tapItem(item, config, texts)} disabled={sold} data-testid="k-item" data-item={item.id}>
        <Photo src={item.image_url} label={name} className="k-item-img" phClassName="k-item-ph" />
        <span className="k-item-body">
          <span className="k-head k-item-name">{name}</span>
          {d.show_tags && <DietaryBadges item={item} config={config} texts={texts} />}
          {desc && <span className="k-item-desc">{desc}</span>}
          <span className="flex items-baseline gap-[.6em] mt-auto flex-wrap">
            <span className="k-price">{priceLabel(item, config, ctx, texts)}</span>
            {d.show_calories && item.calories != null && <span className="k-muted text-[.8em]">{texts.ui('kcal', { n: item.calories })}</span>}
          </span>
        </span>
        {sold && <span className="k-sold"><span>{texts.ui('sold_out')}</span></span>}
      </button>
      {quick && (
        <button className="k-btn k-btn-round k-btn-primary k-quick shadow" onClick={() => tapItem(item, config, texts, { quick: true })} aria-label={texts.ui('add') + ' ' + name} data-testid="k-quick-add">
          <Plus />
        </button>
      )}
    </div>
  )
}

function linkTo(link, config, texts) {
  if (!link || link.kind === 'none') return
  if (link.kind === 'section') openSection(link.id)
  else if (link.kind === 'item') {
    const it = configItem(config, link.id)
    if (it) tapItem(it, config, texts)
  }
}

function Banners({ banners, secs, config, texts }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (banners.length < 2) return
    const id = setInterval(() => setI(n => (n + 1) % banners.length), secs * 1000)
    return () => clearInterval(id)
  }, [banners.length, secs])
  if (!banners.length) return null
  const b = banners[i % banners.length]
  const title = b.title ? texts.t(TK.design(config.design.id, 'banner:' + b.id), b.title) : null
  return (
    <div className="flex flex-col gap-[.5em]">
      <button className="relative w-full overflow-hidden rounded-[var(--k-radius)] border-0 p-0 k-fade" key={b.id} onClick={() => linkTo(b.link, config, texts)} data-testid="k-banner">
        <img src={b.image_url} alt="" className="w-full aspect-[16/7] max-h-[36vh] object-cover block" draggable={false} />
        {title && <span className="absolute left-0 bottom-0 m-[var(--k-gap)] k-head text-[1.5em] px-[.6em] py-[.2em] rounded-[calc(var(--k-radius)/1.5)] bg-[var(--k-accent)] text-[var(--k-accent-text)]">{title}</span>}
      </button>
      {banners.length > 1 && (
        <div className="flex justify-center gap-[.5em]">
          {banners.map((x, j) => <button key={x.id} onClick={() => setI(j)} aria-label={String(j + 1)} className={cx('w-[1em] h-[1em] rounded-full border-0 p-0', j === i % banners.length ? 'bg-[var(--k-primary)]' : 'bg-[var(--k-line)]')} />)}
        </div>
      )}
    </div>
  )
}

function Home({ config, texts }) {
  const m = config.design.menu
  return (
    <div className="flex flex-col gap-[var(--k-pad)]" data-testid="k-home">
      <Banners banners={m.banners} secs={m.banner_secs} config={config} texts={texts} />
      {m.featured.length > 0 && (
        <div className="grid gap-[var(--k-gap)] grid-cols-2">
          {m.featured.map(f => {
            const title = f.title ? texts.t(TK.design(config.design.id, 'featured:' + f.id + ':title'), f.title) : null
            const sub = f.subtitle ? texts.t(TK.design(config.design.id, 'featured:' + f.id + ':subtitle'), f.subtitle) : null
            return (
              <button key={f.id} className={cx('k-card relative overflow-hidden border-0 p-0 text-left min-h-[22vmin]', f.size === 'wide' && 'col-span-2')}
                onClick={() => linkTo(f.link, config, texts)} data-testid="k-featured">
                {f.image_url && <img src={f.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
                <span className="absolute inset-x-0 bottom-0 p-[.8em] flex flex-col" style={f.image_url ? { background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)', color: '#fff' } : null}>
                  {title && <span className="k-head text-[1.5em]">{title}</span>}
                  {sub && <span className="text-[.9em]">{sub}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TopBar({ texts, config, s }) {
  const d = config.design
  const [ask, setAsk] = useState(false)
  const [langs, setLangs] = useState(false)
  return (
    <div className="shrink-0 flex items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[calc(var(--k-gap)/1.2)] bg-[var(--k-surface)] border-b-2 border-[var(--k-line)]">
      <button className="k-btn k-btn-ghost" onClick={() => (s.basket.length ? setAsk(true) : restart())} data-testid="k-restart">
        <RotateCcw /> {texts.ui('start_again')}
      </button>
      <div className="flex-1 flex justify-center min-w-0">
        {d.brand.logo_url ? <img src={d.brand.logo_url} alt="" className="max-h-[3.4em] max-w-[50%] object-contain" draggable={false} />
          : <span className="k-head text-[1.4em] truncate">{config.venue?.name}</span>}
      </div>
      {d.languages.enabled.length > 1
        ? <button className="k-btn k-btn-ghost" onClick={() => setLangs(true)} aria-label={texts.ui('language')} data-testid="k-language"><Flag code={texts.lang} /><Globe /></button>
        : <span className="min-w-[4em]" />}
      {ask && (
        <Sheet onClose={() => setAsk(false)}>
          <div className="flex flex-col gap-[var(--k-pad)] items-center text-center" data-testid="k-restart-sheet">
            <div className="k-head text-[1.8em]">{texts.ui('start_again_title')}</div>
            <div>{texts.ui('start_again_body')}</div>
            <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
              <button className="k-btn k-btn-big" onClick={() => setAsk(false)}>{texts.ui('keep_ordering')}</button>
              <button className="k-btn k-btn-primary k-btn-big" onClick={restart} data-testid="k-restart-yes">{texts.ui('yes_start_again')}</button>
            </div>
          </div>
        </Sheet>
      )}
      {langs && (
        <Sheet onClose={() => setLangs(false)}>
          <div className="flex flex-col gap-[var(--k-pad)] items-center" data-testid="k-language-sheet">
            <div className="k-head text-[1.6em]">{texts.ui('language')}</div>
            <Languages design={d} lang={texts.lang} onPick={l => { setLang(l); setLangs(false) }} size="big" />
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function OrderBar({ s, texts, onView, label }) {
  const { count, total } = useBasketTotals(s)
  const d = s.config.design
  return (
    <div className="k-bar shrink-0" data-testid="k-order-bar">
      {d.behaviour.reach && (
        <button className="k-btn k-btn-icon" style={{ background: 'transparent', color: 'inherit', borderColor: 'color-mix(in srgb, var(--k-bg) 30%, transparent)' }}
          onClick={() => setReach(!s.reach)} aria-label={s.reach ? texts.ui('reach_back') : texts.ui('reach')} data-testid="k-reach">
          <Accessibility />
        </button>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="font-semibold">{count === 1 ? texts.ui('item_count_one') : texts.ui('item_count', { n: count })}</span>
        <span className="k-head text-[1.4em]" data-testid="k-bar-total">{texts.money(total)}</span>
      </div>
      <button key={s.added || 'none'} className={cx('k-btn k-btn-accent k-btn-big', s.added && Date.now() - s.added < 1000 && 'k-bump')} onClick={onView} disabled={!count} data-testid="k-view-order">
        <ShoppingBag /> {label || texts.ui('view_order')}
      </button>
    </div>
  )
}

export default function Menu() {
  const s = useKiosk()
  const { config } = s
  const texts = textsFor(s)
  const ctx = useMemo(() => comboCtx(config), [config])
  const sections = useMemo(() => kioskSections(config), [config])
  const home = hasHome(config)
  const sold = soldOut(config)
  const current = s.section === 'home' && home ? 'home' : sections.find(x => x.id === s.section)?.id || (home ? 'home' : sections[0]?.id)
  const section = sections.find(x => x.id === current)
  const rail = config.design.menu.rail
  const cols = config.design.menu.columns
  const sectionTitle = sec => texts.t(TK.section(sec.id, 'title'), sec.title)
  const railItem = sec => {
    const first = (sec.item_ids || []).map(id => config.items[id]).find(it => it?.image_url)
    return sec.image_url || first?.image_url || null
  }
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-menu">
      <TopBar texts={texts} config={config} s={s} />
      <div className="flex-1 min-h-0 flex">
        <nav className="shrink-0 w-[clamp(110px,19vmin,240px)] k-scroll bg-[var(--k-surface)] border-r-2 border-[var(--k-line)] flex flex-col gap-[.3em] p-[.4em]" data-testid="k-rail">
          {home && (
            <button className={cx('flex flex-col items-center gap-[.3em] p-[.5em] rounded-[calc(var(--k-radius)/1.5)] border-2', current === 'home' ? 'border-[var(--k-primary)] bg-[var(--k-soft)]' : 'border-transparent')}
              onClick={() => openSection('home')} data-testid="k-rail-home">
              <HomeIcon size={34} />
              <span className="k-head text-[.85em] text-center">{texts.ui('home')}</span>
            </button>
          )}
          {sections.map(sec => {
            const img = rail === 'images' ? railItem(sec) : null
            return (
              <button key={sec.id} className={cx('flex flex-col items-center gap-[.3em] p-[.5em] rounded-[calc(var(--k-radius)/1.5)] border-2', current === sec.id ? 'border-[var(--k-primary)] bg-[var(--k-soft)]' : 'border-transparent')}
                onClick={() => openSection(sec.id)} data-testid="k-rail-section" data-section={sec.id}>
                {img && <img src={img} alt="" className="w-[70%] aspect-square object-cover rounded-full" draggable={false} />}
                <span className={cx('k-head text-center', rail === 'images' ? 'text-[.85em]' : 'text-[1em] py-[.4em]')}>{sectionTitle(sec)}</span>
              </button>
            )
          })}
        </nav>
        <main className="flex-1 min-w-0 k-scroll p-[var(--k-pad)]" key={current}>
          {current === 'home' ? <Home config={config} texts={texts} /> : section && (
            <div className="flex flex-col gap-[var(--k-gap)] k-fade">
              <h2 className="k-head text-[2.1em] m-0">{sectionTitle(section)}</h2>
              {section.subtitle && <div className="k-muted">{texts.t(TK.section(section.id, 'subtitle'), section.subtitle)}</div>}
              <div className="k-grid" style={cols === 'auto' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(36vmin, 280px), 1fr))' } : { '--k-cols': cols }}>
                {section.item_ids.map(id => configItem(config, id)).filter(Boolean).map(it => (
                  <ItemCard key={it.id} item={it} config={config} ctx={ctx} texts={texts} sold={sold.has(it.id)} />
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
      <OrderBar s={s} texts={texts} onView={() => go('basket')} />
    </div>
  )
}

export { checkTotals }
