// An order flow's prompt on the kiosk (migration 236, shared/pos/orderFlows.js):
// the question, a line under it and the dishes it offers, after the guest
// adds a dish or before paying (store.js promptNow()). Pick one: the first
// dish closes it; pick several: each tap adds one more. A dish with choices
// opens its own page, then the next prompt. No thanks (or Done once
// something is added) moves on; each prompt is asked once on the order.
//
// How it looks is the flow's look on kiosks (ask.look.kiosk, promptStyle()):
// the header (plain, a band of colour, or a picture across the top), the
// background (a colour, a picture under a veil of the prompt's colour), the
// dishes as cards (in the design's dish picture style) or rows, with or
// without pictures, and colours from the kiosk design's own (a theme colour
// follows each kiosk's design) or set codes. With no look of its own it is
// the kiosk's standard prompt.

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { TK } from '@shared/kiosk.js'
import { comboCtx } from '@shared/pos/offers.js'
import { promptStyle, promptBackground } from '@shared/pos/orderFlows.js'
import { useKiosk, textsFor, promptNow, promptPick, promptDone } from './store.js'
import { cx, Photo, Sheet } from './parts.jsx'
import { priceLabel } from './Builder.jsx'

/** The kiosk design's colours as a prompt's theme, and its own prompt colour. */
function designTheme(design) {
  const c = design?.brand?.colors || {}
  return {
    theme: { primary: c.primary, accent: c.accent, background: c.background, surface: c.surface, text: c.text, muted: c.muted },
    sheet: c.surface === 'transparent' ? c.background : c.surface,
  }
}

export default function FlowPrompt() {
  const s = useKiosk()
  const ctx = useMemo(() => (s.config ? comboCtx(s.config) : null), [s.config])
  const now = s.builder ? null : promptNow(s)
  const design = s.config?.design
  const look = useMemo(() => {
    if (!now) return null
    const { theme, sheet } = designTheme(design)
    const st = promptStyle(now.flow, 'kiosk', theme)
    return { st, background: promptBackground(st, sheet) }
  }, [now?.flow, design])
  if (!now || !ctx || !look) return null
  const texts = textsFor(s)
  const { ui } = texts
  const f = now.flow
  const { st, background } = look
  const title = texts.t(TK.flow(f.id, 'title'), f.ask.title)
  const message = f.ask.message ? texts.t(TK.flow(f.id, 'message'), f.ask.message) : ''
  const count = Object.values(now.added).reduce((n, x) => n + x, 0)
  const band = st.header.style === 'band'
  const picture = st.header.style === 'picture' && st.header.picture
  const rows = st.dishes === 'rows'
  const words = (
    <div className={cx('flex flex-col gap-[.3em]', st.header.align === 'center' ? 'text-center' : 'text-left')}>
      <div className="k-head text-[2em]" style={st.title ? { color: st.title } : undefined} data-testid="k-flow-title">{title}</div>
      {message && (
        <div className={cx('text-[1.1em]', !st.message && 'k-muted')} style={st.message ? { color: st.message, opacity: band ? 0.9 : undefined } : undefined}
          data-testid="k-flow-message">{message}</div>
      )}
    </div>
  )
  const cardStyle = st.cards ? { background: st.cards, color: st.cards_ink } : undefined
  return (
    <Sheet onClose={() => promptDone()} wide bare background={background}>
      <div data-testid="k-flow-prompt" data-flow={f.id} data-pick={f.ask.pick} data-look={st.own ? 'own' : 'standard'}
        data-header={st.header.style} data-dishes={st.dishes} data-pictures={st.pictures ? '1' : '0'}>
        {band && <div className="k-flow-band" style={{ background: st.band }} data-testid="k-flow-band">{words}</div>}
        {picture && <img src={picture} alt="" className="k-flow-picture" data-testid="k-flow-picture" />}
        <div className="k-flow-pad flex flex-col gap-[var(--k-pad)]">
          {!band && words}
          <div className={cx('grid gap-[var(--k-gap)]', rows ? 'grid-cols-1' : now.dishes.length > 2 ? 'grid-cols-3' : 'grid-cols-2')}>
            {now.dishes.map(it => {
              const n = now.added[it.id] || 0
              const name = texts.itemName(it)
              const price = <span className="k-price">{priceLabel(it, s.config, ctx, texts)}</span>
              const plus = n > 0
                ? <span className="k-plus k-flow-count" aria-label={ui('flow_picked', { n })} data-testid="k-flow-count">{n}</span>
                : <span className="k-plus"><Plus /></span>
              if (rows) {
                return (
                  <button key={it.id} className={cx('k-card k-flow-row', n > 0 && 'k-on')} onClick={() => promptPick(it.id)}
                    data-testid="k-flow-dish" data-item={it.id} aria-pressed={n > 0} style={cardStyle}>
                    {st.pictures && <Photo src={it.image_url} label={name} className="k-flow-row-img" phClassName="k-flow-row-img" />}
                    <span className="flex-1 min-w-0 flex flex-col gap-[.2em]">
                      <span className="k-head">{name}</span>
                      {price}
                    </span>
                    {plus}
                  </button>
                )
              }
              return (
                <button key={it.id} className={cx('k-card k-item', n > 0 && 'k-on', !st.pictures && 'k-flow-words')} onClick={() => promptPick(it.id)}
                  data-testid="k-flow-dish" data-item={it.id} aria-pressed={n > 0} style={cardStyle}>
                  {st.pictures && <Photo src={it.image_url} label={name} className="k-item-img" phClassName="k-item-ph" />}
                  <span className="k-item-body">
                    <span className="k-head">{name}</span>
                    <span className="flex items-center justify-between gap-[.4em]">{price}{plus}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex justify-center">
            <button className={cx('k-btn k-btn-big', count && !st.button ? 'k-btn-primary' : '')} onClick={() => promptDone()} data-testid="k-flow-done"
              style={st.button ? { background: st.button, color: st.button_ink, borderColor: st.button } : undefined}>
              {count ? ui('done') : ui('no_thanks')}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
