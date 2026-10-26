// The kiosk's menu: sections down the side (photos or words), a home page
// with the design's banners and featured tiles, a section's dishes as cards
// (photo, name, "from" price, calories, dietary badges, sold out), and the
// order bar at the bottom. A dish with no choices goes straight in with +.
// The design can leave the side out (the menu opens on a page of section
// tiles), hide the bar along the top, and draw dishes as cards, round or oval
// photos, or hexagons that fit together (design.layout).

import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Globe, Plus, Home as HomeIcon, ShoppingBag, Accessibility } from 'lucide-react'
import { checkTotals } from '@shared/pos/pricing.js'
import { configItem, comboCtx } from '@shared/pos/offers.js'
import { TK, basketCheck, BANNER_RATIOS } from '@shared/kiosk.js'
import {
  useKiosk, textsFor, kioskSections, hasHome, openSection, openBuilder, addToBasket, go, restart, setLang, setReach, soldOut, fitOf, countFor, loyaltyForOrder,
} from './store.js'
import { cx, Pic, Photo, Sheet, Flag, BackButton, HexGrid, HexTile, FitPicture } from './parts.jsx'
import { priceLabel, DietaryBadges } from './Builder.jsx'
import { Languages } from './Start.jsx'
import { FitMark, FitNote, PrefsStrip, needsCheck } from './fit.jsx'
import { flyToBasket } from './fly.js'
import { useJourneyState } from './journey.js'
import { boxShort } from './viewport.js'


export function needsBuilder(item) {
  return item.kind === 'combo' || (item.pos_choices || []).length > 0
}

/**
 * Tap on a dish: its builder, or straight into the order (with + on, no
 * choices), its picture (from) flying into the order button (fly.js).
 */
export function tapItem(item, config, texts, { quick = false, from = null } = {}) {
  if (needsBuilder(item) || (!quick && !config.design.menu.quick_add)) openBuilder(item.id)
  else addToBasket({ item_id: item.id, selection: {}, qty: 1 }, null, { flew: flyToBasket(from) })
}

export function useBasketTotals(s) {
  return useMemo(() => {
    if (!s.basket.length) return { count: 0, total: 0, check: null }
    const r = basketCheck(s.config, s.basket, { device: s.device, order_type_id: s.orderType, loyalty: loyaltyForOrder(s) })
    const count = s.basket.reduce((n, e) => n + e.qty, 0)
    return r.ok ? { count, total: r.totals.total, totals: r.totals, check: r.check, skipped: r.skipped || [] } : { count, total: 0, error: r.error }
  }, [s.config, s.basket, s.device, s.orderType, s.loyalty])
}

/** A dish as a hexagon (design.layout.tiles 'hexagon'): photo, name, price; + beside it. */
function ItemHex({ item, config, ctx, texts, sold, fit }) {
  const name = texts.itemName(item)
  const d = config.design.menu
  const quick = d.quick_add && !needsBuilder(item) && !sold
  const check = needsCheck(fit)
  const top = (d.show_tags || check) ? <>{check && <FitMark fit={fit} texts={texts} className="k-fit-mark-hex" />}{d.show_tags && <DietaryBadges item={item} config={config} texts={texts} compact />}</> : null
  return (
    <HexTile src={item.image_url} label={name} off={sold} disabled={sold} onClick={e => !sold && tapItem(item, config, texts, { from: e.currentTarget })}
      testId="k-item" attrs={{ 'data-item': item.id, 'data-fit': fit ? (check ? 'check' : 'ok') : undefined }}
      top={top}
      extra={quick && (
        <button className="k-btn k-btn-round k-btn-primary k-hex-side" onClick={e => tapItem(item, config, texts, { quick: true, from: e.currentTarget.parentElement?.querySelector('.k-hex') })} aria-label={texts.ui('add') + ' ' + name} data-testid="k-quick-add">
          <Plus />
        </button>
      )}>
      <span className="k-head k-hex-name">{name}</span>
      <span className="k-hex-price">{sold ? texts.ui('sold_out') : priceLabel(item, config, ctx, texts)}</span>
    </HexTile>
  )
}

function ItemCard({ item, config, ctx, texts, sold, fit }) {
  const name = texts.itemName(item)
  const d = config.design.menu
  const desc = item.description && d.show_descriptions ? texts.t(TK.item(item.id, 'description'), item.description) : null
  const quick = d.quick_add && !needsBuilder(item) && !sold
  const check = needsCheck(fit)
  return (
    <div className="relative">
      <button className={cx('k-card k-item w-full', check && 'k-item-check')} onClick={e => !sold && tapItem(item, config, texts, { from: e.currentTarget.querySelector('.k-item-img') })} disabled={sold} data-testid="k-item" data-item={item.id}
        data-fit={fit ? (check ? 'check' : 'ok') : undefined}>
        <Photo src={item.image_url} label={name} className="k-item-img" phClassName="k-item-ph" />
        <FitMark fit={fit} texts={texts} className="k-fit-badge" />
        <span className="k-item-body">
          <span className="k-head k-item-name">{name}</span>
          {d.show_tags && <DietaryBadges item={item} config={config} texts={texts} />}
          <FitNote fit={fit} config={config} texts={texts} />
          {desc && <span className="k-item-desc">{desc}</span>}
          <span className="flex items-baseline gap-[.6em] mt-auto flex-wrap">
            <span className="k-price">{priceLabel(item, config, ctx, texts)}</span>
            {d.show_calories && item.calories != null && <span className="k-muted text-[.8em]">{texts.ui('kcal', { n: item.calories })}</span>}
          </span>
        </span>
        {sold && <span className="k-sold"><span>{texts.ui('sold_out')}</span></span>}
      </button>
      {quick && (
        <button className="k-btn k-btn-round k-btn-primary k-quick shadow" onClick={e => tapItem(item, config, texts, { quick: true, from: e.currentTarget.parentElement?.querySelector('.k-item-img') })} aria-label={texts.ui('add') + ' ' + name} data-testid="k-quick-add">
          <Plus />
        </button>
      )}
    </div>
  )
}

function linkTo(link, config, texts, from = null) {
  if (!link || link.kind === 'none') return
  if (link.kind === 'section') openSection(link.id)
  else if (link.kind === 'item') {
    const it = configItem(config, link.id)
    if (it) tapItem(it, config, texts, { from })
  }
}

function Banners({ banners, secs, shape, config, texts }) {
  const [i, setI] = useState(0)
  // Banners the shape of their own picture: each one's width to height, once loaded.
  const [ratios, setRatios] = useState({})
  useEffect(() => {
    if (banners.length < 2) return
    const id = setInterval(() => setI(n => (n + 1) % banners.length), secs * 1000)
    return () => clearInterval(id)
  }, [banners.length, secs])
  if (!banners.length) return null
  const b = banners[i % banners.length]
  const title = b.title ? texts.t(TK.design(config.design.id, 'banner:' + b.id), b.title) : null
  const own = shape === 'picture'
  const ratio = own ? ratios[b.id] || BANNER_RATIOS.wide : BANNER_RATIOS[shape] || BANNER_RATIOS.wide
  const measure = e => {
    const img = e.currentTarget
    if (img.naturalWidth && img.naturalHeight) setRatios(r => ({ ...r, [b.id]: img.naturalWidth / img.naturalHeight }))
  }
  return (
    <div className="flex flex-col gap-[.5em]">
      <button className="relative block w-full max-h-[36cqh] overflow-hidden rounded-[var(--k-radius)] border-0 p-0 k-fade" key={b.id} style={{ aspectRatio: String(ratio) }}
        onClick={e => linkTo(b.link, config, texts, e.currentTarget.querySelector('img'))} data-testid="k-banner" data-shape={shape}>
        <FitPicture src={b.image_url} fit={b.fit} onLoad={own ? measure : undefined} />
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
      <Banners banners={m.banners} secs={m.banner_secs} shape={m.banner_shape} config={config} texts={texts} />
      {m.featured.length > 0 && (
        <div className="grid gap-[var(--k-gap)] grid-cols-2">
          {m.featured.map(f => {
            const title = f.title ? texts.t(TK.design(config.design.id, 'featured:' + f.id + ':title'), f.title) : null
            const sub = f.subtitle ? texts.t(TK.design(config.design.id, 'featured:' + f.id + ':subtitle'), f.subtitle) : null
            return (
              <button key={f.id} className={cx('k-card relative overflow-hidden border-0 p-0 text-left min-h-[22cqmin]', f.size === 'wide' && 'col-span-2')}
                onClick={e => linkTo(f.link, config, texts, e.currentTarget.querySelector('img'))} data-testid="k-featured">
                {f.image_url && <FitPicture src={f.image_url} fit={f.fit} />}
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

/**
 * Start again: in the screen's bottom bar, after Back. Asks first when the
 * order has something in it. Icons only with the design's icon buttons.
 */
export function RestartButton({ s, texts }) {
  const [ask, setAsk] = useJourneyState('restart.ask', false)
  const label = texts.ui('start_again')
  return (
    <>
      <button className="k-btn k-btn-big k-btn-restart" onClick={() => (s.basket.length ? setAsk(true) : restart('guest'))} data-testid="k-restart" aria-label={label}>
        <RotateCcw /><span className="k-btn-label">{label}</span>
      </button>
      {ask && (
        <Sheet onClose={() => setAsk(false)}>
          <div className="flex flex-col gap-[var(--k-pad)] items-center text-center" data-testid="k-restart-sheet">
            <div className="k-head text-[1.8em]">{texts.ui('start_again_title')}</div>
            <div>{texts.ui('start_again_body')}</div>
            <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
              <button className="k-btn k-btn-big" onClick={() => setAsk(false)}>{texts.ui('keep_ordering')}</button>
              <button className="k-btn k-btn-primary k-btn-big" onClick={() => restart('guest')} data-testid="k-restart-yes">{texts.ui('yes_start_again')}</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  )
}

/** The guest's language (when the design offers more than one): in the top bar, or in the bottom bar when the top bar is hidden. */
export function LanguageButton({ config, texts, onBar = false }) {
  const d = config.design
  const [open, setOpen] = useJourneyState('lang.open', false)
  if (d.languages.enabled.length < 2) return null
  return (
    <>
      <button className={cx('k-btn', onBar ? 'k-btn-big k-btn-onbar' : 'k-btn-ghost')} onClick={() => setOpen(true)} aria-label={texts.ui('language')} data-testid="k-language">
        <Flag code={texts.lang} /><Globe />
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-[var(--k-pad)] items-center" data-testid="k-language-sheet">
            <div className="k-head text-[1.6em]">{texts.ui('language')}</div>
            <Languages design={d} lang={texts.lang} onPick={l => { setLang(l); setOpen(false) }} size="big" />
          </div>
        </Sheet>
      )}
    </>
  )
}

/** The bar along the top: logo (or the venue's name) and the language. Hidden by the design's layout. */
export function TopBar({ texts, config }) {
  const d = config.design
  if (!d.layout.header) return null
  const lang = d.languages.enabled.length > 1
  return (
    <div className="shrink-0 flex items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[calc(var(--k-gap)/1.2)] bg-[var(--k-surface)] border-b-2 border-[var(--k-line)] min-h-[max(64px,3.6em)]" data-testid="k-topbar">
      {lang && <span className="min-w-[6em]" />}
      <div className="flex-1 flex justify-center min-w-0">
        {d.brand.logo_url ? <img src={d.brand.logo_url} alt="" className="max-h-[3.4em] max-w-[50%] object-contain" draggable={false} />
          : <span className="k-head text-[1.4em] truncate">{config.venue?.name}</span>}
      </div>
      {lang && <span className="min-w-[6em] flex justify-end"><LanguageButton config={config} texts={texts} /></span>}
    </div>
  )
}

export function OrderBar({ s, texts, onView, label, onBack = null }) {
  const { count, total } = useBasketTotals(s)
  const d = s.config.design
  return (
    <div className="k-bar shrink-0" data-testid="k-order-bar">
      {onBack && <BackButton onClick={onBack} label={texts.ui('back')} testId="k-tiles-back" />}
      <RestartButton s={s} texts={texts} />
      {!d.layout.header && <LanguageButton config={s.config} texts={texts} onBar />}
      {d.behaviour.reach && (
        <button className="k-btn k-btn-icon k-btn-onbar"
          onClick={() => setReach(!s.reach)} aria-label={s.reach ? texts.ui('reach_back') : texts.ui('reach')} data-testid="k-reach">
          <Accessibility />
        </button>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="font-semibold">{count === 1 ? texts.ui('item_count_one') : texts.ui('item_count', { n: count })}</span>
        <span className="k-head text-[1.4em]" data-testid="k-bar-total">{texts.money(total)}</span>
      </div>
      <button key={s.added || 'none'} className={cx('k-btn k-btn-accent k-btn-big', s.added && Date.now() - s.added < 1000 && 'k-bump')} onClick={onView} disabled={!count} data-testid="k-view-order"
        data-fly-target="basket">
        <ShoppingBag /> {label || texts.ui('view_order')}
      </button>
    </div>
  )
}

/** A section's picture for the side and the tiles: its own, else its first dish's. */
function sectionImage(config, sec) {
  if (sec.image_url) return sec.image_url
  return (sec.item_ids || []).map(id => config.items[id]).find(it => it?.image_url)?.image_url || null
}

/**
 * The section tiles page (no sections down the side): the home page's
 * banners and tiles when it has them, then a tile per section in the
 * design's order (sections it doesn't list follow in menu order).
 */
function SectionTiles({ config, texts, sections, home }) {
  const d = config.design
  const tiles = d.layout.tiles
  const byId = new Map(d.menu.section_tiles.map(t => [t.section_id, t]))
  const listed = d.menu.section_tiles.map(t => sections.find(x => x.id === t.section_id)).filter(Boolean)
  const ordered = [...listed, ...sections.filter(x => !byId.has(x.id))]
  const title = sec => {
    const t = byId.get(sec.id)
    return t?.title ? texts.t(TK.design(d.id, 'tile:' + sec.id), t.title) : texts.t(TK.section(sec.id, 'title'), sec.title)
  }
  const image = sec => byId.get(sec.id)?.image_url || sectionImage(config, sec)
  const cols = d.menu.columns
  return (
    <div className="flex flex-col gap-[var(--k-pad)] k-fade" data-testid="k-tiles">
      {home && <Home config={config} texts={texts} />}
      {tiles === 'hexagon' ? (
        <HexGrid cols={cols} target={hexTarget()} testId="k-tiles-grid">
          {ordered.map(sec => (
            <HexTile key={sec.id} src={image(sec)} label={title(sec)} onClick={() => openSection(sec.id)} testId="k-section-tile" attrs={{ 'data-section': sec.id }}>
              <span className="k-head k-hex-name k-hex-title">{title(sec)}</span>
            </HexTile>
          ))}
        </HexGrid>
      ) : (
        <div className="k-grid" data-testid="k-tiles-grid" style={cols === 'auto' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(36cqmin, 280px), 1fr))' } : { '--k-cols': cols }}>
          {ordered.map(sec => {
            const wide = byId.get(sec.id)?.size === 'wide' && tiles !== 'round'
            return (
              <button key={sec.id} className={cx('k-card k-item k-tile w-full', wide && 'col-span-2 k-tile-wide')} onClick={() => openSection(sec.id)} data-testid="k-section-tile" data-section={sec.id}>
                <Photo src={image(sec)} label={title(sec)} className="k-item-img" phClassName="k-item-ph" />
                <span className="k-item-body"><span className="k-head k-tile-name">{title(sec)}</span></span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// A hexagon's width when dishes fit the screen: about 30% of the kiosk's shorter side, at most 260 px.
const hexTarget = () => Math.min(boxShort() * 0.3, 260)

export default function Menu() {
  const s = useKiosk()
  const { config } = s
  const texts = textsFor(s)
  const ctx = useMemo(() => comboCtx(config), [config])
  const sections = useMemo(() => kioskSections(config), [config])
  const home = hasHome(config)
  const sold = soldOut(config)
  const rail = config.design.menu.rail
  const tiles = config.design.layout.tiles
  // No sections down the side: the section tiles page, or a section opened from it.
  const tilesPage = rail === 'none'
  const current = tilesPage
    ? sections.find(x => x.id === s.section)?.id || 'tiles'
    : s.section === 'home' && home ? 'home' : sections.find(x => x.id === s.section)?.id || (home ? 'home' : sections[0]?.id)
  const section = sections.find(x => x.id === current)
  const cols = config.design.menu.columns
  const sectionTitle = sec => texts.t(TK.section(sec.id, 'title'), sec.title)
  const dishes = section ? section.item_ids.map(id => configItem(config, id)).filter(Boolean) : []
  // The guest's allergens and diets (the allergens screen): what to mark.
  const fitFor = it => fitOf(config, it, s.prefs)
  const count = useMemo(() => countFor(config, s.prefs), [config, s.prefs])
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-menu">
      <TopBar texts={texts} config={config} />
      <div className="flex-1 min-h-0 flex">
        {!tilesPage && (
          <nav className="k-rail shrink-0 w-[clamp(110px,19cqmin,240px)] k-scroll border-r-2 border-[var(--k-line)] flex flex-col gap-[.3em] p-[.4em]" data-testid="k-rail">
            {home && (
              <button className={cx('k-rail-item flex flex-col items-center gap-[.3em] p-[.5em] rounded-[calc(var(--k-radius)/1.5)] border-2', current === 'home' ? 'k-rail-on border-[var(--k-primary)]' : 'border-transparent')}
                onClick={() => openSection('home')} data-testid="k-rail-home">
                <HomeIcon size={34} />
                <span className="k-head text-[.85em] text-center">{texts.ui('home')}</span>
              </button>
            )}
            {sections.map(sec => {
              const img = rail === 'images' ? sectionImage(config, sec) : null
              return (
                <button key={sec.id} className={cx('k-rail-item flex flex-col items-center gap-[.3em] p-[.5em] rounded-[calc(var(--k-radius)/1.5)] border-2', current === sec.id ? 'k-rail-on border-[var(--k-primary)]' : 'border-transparent')}
                  onClick={() => openSection(sec.id)} data-testid="k-rail-section" data-section={sec.id}>
                  {img && <Pic src={img} className="k-rail-img w-[70%] aspect-square object-cover rounded-full" />}
                  <span className={cx('k-head text-center', rail === 'images' ? 'text-[.85em]' : 'text-[1em] py-[.4em]')}>{sectionTitle(sec)}</span>
                </button>
              )
            })}
          </nav>
        )}
        <main className="flex-1 min-w-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[var(--k-gap)]" key={current}>
          <PrefsStrip prefs={s.prefs} count={count} config={config} texts={texts} />
          {current === 'tiles' ? <SectionTiles config={config} texts={texts} sections={sections} home={home} />
            : current === 'home' ? <Home config={config} texts={texts} /> : section && (
              <div className="flex flex-col gap-[var(--k-gap)] k-fade">
                <h2 className="k-head text-[2.1em] m-0">{sectionTitle(section)}</h2>
                {section.subtitle && <div className="k-muted">{texts.t(TK.section(section.id, 'subtitle'), section.subtitle)}</div>}
                {tiles === 'hexagon' ? (
                  <HexGrid cols={cols} target={hexTarget()} testId="k-dishes">
                    {dishes.map(it => <ItemHex key={it.id} item={it} config={config} ctx={ctx} texts={texts} sold={sold.has(it.id)} fit={fitFor(it)} />)}
                  </HexGrid>
                ) : (
                  <div className="k-grid" data-testid="k-dishes" style={cols === 'auto' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(36cqmin, 280px), 1fr))' } : { '--k-cols': cols }}>
                    {dishes.map(it => <ItemCard key={it.id} item={it} config={config} ctx={ctx} texts={texts} sold={sold.has(it.id)} fit={fitFor(it)} />)}
                  </div>
                )}
              </div>
            )}
        </main>
      </div>
      <OrderBar s={s} texts={texts} onView={() => go('basket')} onBack={tilesPage && current !== 'tiles' ? () => openSection('tiles') : null} />
    </div>
  )
}

export { checkTotals }
