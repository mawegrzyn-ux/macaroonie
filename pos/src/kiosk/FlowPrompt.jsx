// An order flow's prompt on the kiosk (migration 236, shared/pos/orderFlows.js):
// the question, a line under it and the dishes it offers, after the guest
// adds a dish or before paying (store.js promptNow()). Pick one: the first
// dish closes it; pick several: each tap adds one more. A dish with choices
// opens its own page, then the next prompt. No thanks (or Done once
// something is added) moves on; each prompt is asked once on the order.

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { TK } from '@shared/kiosk.js'
import { comboCtx } from '@shared/pos/offers.js'
import { useKiosk, textsFor, promptNow, promptPick, promptDone } from './store.js'
import { cx, Photo, Sheet } from './parts.jsx'
import { priceLabel } from './Builder.jsx'

export default function FlowPrompt() {
  const s = useKiosk()
  const ctx = useMemo(() => (s.config ? comboCtx(s.config) : null), [s.config])
  const now = s.builder ? null : promptNow(s)
  if (!now || !ctx) return null
  const texts = textsFor(s)
  const { ui } = texts
  const f = now.flow
  const title = texts.t(TK.flow(f.id, 'title'), f.ask.title)
  const message = f.ask.message ? texts.t(TK.flow(f.id, 'message'), f.ask.message) : ''
  const count = Object.values(now.added).reduce((n, x) => n + x, 0)
  return (
    <Sheet onClose={() => promptDone()} wide>
      <div className="flex flex-col gap-[var(--k-pad)]" data-testid="k-flow-prompt" data-flow={f.id} data-pick={f.ask.pick}>
        <div className="flex flex-col gap-[.3em] text-center">
          <div className="k-head text-[2em]">{title}</div>
          {message && <div className="k-muted text-[1.1em]">{message}</div>}
        </div>
        <div className={cx('grid gap-[var(--k-gap)]', now.dishes.length > 2 ? 'grid-cols-3' : 'grid-cols-2')}>
          {now.dishes.map(it => {
            const n = now.added[it.id] || 0
            return (
              <button key={it.id} className={cx('k-card k-item', n > 0 && 'k-on')} onClick={() => promptPick(it.id)}
                data-testid="k-flow-dish" data-item={it.id} aria-pressed={n > 0}>
                <Photo src={it.image_url} label={texts.itemName(it)} className="k-item-img" phClassName="k-item-ph" />
                <span className="k-item-body">
                  <span className="k-head">{texts.itemName(it)}</span>
                  <span className="flex items-center justify-between gap-[.4em]">
                    <span className="k-price">{priceLabel(it, s.config, ctx, texts)}</span>
                    {n > 0
                      ? <span className="k-plus k-flow-count" aria-label={ui('flow_picked', { n })} data-testid="k-flow-count">{n}</span>
                      : <span className="k-plus"><Plus /></span>}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex justify-center">
          <button className={cx('k-btn k-btn-big', count ? 'k-btn-primary' : '')} onClick={() => promptDone()} data-testid="k-flow-done">
            {count ? ui('done') : ui('no_thanks')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
