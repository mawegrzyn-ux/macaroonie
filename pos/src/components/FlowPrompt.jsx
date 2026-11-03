// The prompt an order flow shows (Store tech > Order flows, kind ask;
// lib/orderFlows.js): its question, a line under it, the dishes it offers
// and No thanks. Pick one: a tap adds the dish and closes it. Any of them:
// each tap adds one more (the count shows on the dish), Done closes it. A
// dish with choices opens its choices window first (the host does that in
// onDish, which resolves to whether the dish went on; meanwhile the host
// passes paused, and the prompt hides, keeping its count). A tap outside or
// Escape closes it as No thanks (or Done). Answered, it is recorded on the
// check and not asked again.
//
// How it looks is the flow's look on tills (ask.look.till, shared/pos/
// orderFlows.js promptStyle()): the header (plain, a band of colour, or a
// picture across the top), the background (a colour, a picture under a
// veil), the dishes as cards or rows, with or without their pictures, and
// colours from the brand's theme (config.theme_colors) or set codes. With
// no look of its own it is the till's standard prompt.

import { useMemo, useState } from 'react'
import { MessageSquarePlus, Check } from 'lucide-react'
import { promptStyle, promptBackground } from '@shared/pos/orderFlows.js'
import { Modal, cx } from './ui.jsx'
import { dishPriceText } from './MenuPanel.jsx'
import { promptChoices } from '../lib/orderFlows.js'

export default function FlowPrompt({ prompt, config, shownIds = null, paused = false, onDish, onDone }) {
  const flow = prompt.flow
  const choices = useMemo(() => promptChoices(config, flow, shownIds), [config, flow, shownIds])
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
  const st = useMemo(() => promptStyle(flow, 'till', config.theme_colors), [flow, config.theme_colors])
  // Dishes added from this prompt so far ({ id: count }).
  const [added, setAdded] = useState({})
  const several = flow.ask.pick === 'several' && choices.length > 1
  const total = Object.values(added).reduce((a, b) => a + b, 0)
  const tap = async it => {
    const ok = await onDish(it)
    if (!ok) return
    const next = { ...added, [it.id]: (added[it.id] || 0) + 1 }
    setAdded(next)
    if (!several) onDone({ answer: 'added', itemIds: [it.id] })
  }
  const finish = () => onDone(total ? { answer: 'added', itemIds: Object.keys(added) } : { answer: 'declined', itemIds: [] })
  if (paused) return null
  const background = promptBackground(st, '#ffffff')
  const centre = st.header.align === 'center'
  const picture = st.header.style === 'picture' && st.header.picture
  const band = st.header.style === 'band'
  const rows = st.dishes === 'rows'
  const words = (
    <div className={cx('flex-1 min-w-0', centre && 'text-center')}>
      <div className="text-xl font-bold leading-tight" style={st.title ? { color: st.title } : undefined} data-testid="flow-prompt-title">{flow.ask.title}</div>
      {flow.ask.message && (
        <div className={cx('mt-1', !st.message && 'text-muted')} style={st.message ? { color: st.message, opacity: band ? 0.9 : undefined } : undefined}
          data-testid="flow-prompt-message">{flow.ask.message}</div>
      )}
    </div>
  )
  return (
    <Modal title={undefined} onClose={finish} bare panelStyle={background ? { background } : null}>
      <div data-testid="flow-prompt" data-flow={flow.id} data-look={st.own ? 'own' : 'standard'} data-header={st.header.style}
        data-dishes={st.dishes} data-pictures={st.pictures ? '1' : '0'}>
        {band && (
          <div className="px-5 py-4 flex items-start gap-3" style={{ background: st.band }} data-testid="flow-prompt-band">{words}</div>
        )}
        {picture && <img src={picture} alt="" className="block w-full aspect-[3/1] object-cover" data-testid="flow-prompt-picture" />}
        <div className="p-5 space-y-4">
          {!band && (
            <div className="flex items-start gap-3">
              {!picture && !centre && (
                <span className="w-12 h-12 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><MessageSquarePlus size={24} /></span>
              )}
              {words}
            </div>
          )}
          <div className={cx('grid gap-3', rows ? 'grid-cols-1' : 'grid-cols-2')} data-testid="flow-prompt-dishes">
            {choices.map(it => {
              const on = added[it.id] > 0
              const photo = st.pictures && it.image_url
              return (
                <button key={it.id} type="button" onClick={() => tap(it)} data-testid="flow-prompt-dish" data-item={it.id}
                  className={cx('relative rounded-xl border-2 text-left touch-manipulation active:scale-[0.97] transition-transform overflow-hidden',
                    rows ? 'min-h-[64px] flex items-center gap-3 p-2 pr-3' : 'min-h-[84px] flex flex-col',
                    on ? 'border-ok' : 'border-line', on && !st.cards ? 'bg-ok-soft' : !st.cards && 'bg-white')}
                  style={st.cards ? { background: st.cards, color: st.cards_ink } : undefined}>
                  {photo && (
                    <img src={it.image_url} alt="" data-testid="flow-prompt-photo"
                      className={rows ? 'w-14 h-14 rounded-lg object-cover shrink-0' : 'w-full aspect-[4/3] object-cover'} />
                  )}
                  <span className={cx('flex flex-col justify-between min-w-0', rows ? 'flex-1' : 'flex-1 p-3')}>
                    <span className="font-semibold leading-tight line-clamp-3">{it.name}</span>
                    <span className={cx('text-sm tabular-nums mt-1', !st.cards && 'text-muted')} style={st.cards ? { opacity: 0.8 } : undefined}>
                      {dishPriceText(config, it.id, comboRefs)}
                    </span>
                  </span>
                  {on && (
                    <span className="absolute top-2 right-2 min-w-[28px] h-7 px-2 rounded-full bg-ok text-white text-sm font-bold flex items-center justify-center gap-1" data-testid="flow-prompt-count">
                      <Check size={14} />{added[it.id]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex gap-3">
            <button type="button" className={cx('btn flex-1 h-14 text-base', total && !st.button && 'btn-ok')} onClick={finish} data-testid="flow-prompt-done"
              style={st.button ? { background: st.button, color: st.button_ink, borderColor: st.button } : undefined}>
              {total ? 'Done' : 'No thanks'}
            </button>
          </div>
          {several && (
            <div className={cx('text-xs text-center', !st.text && 'text-muted')} style={st.text ? { color: st.text } : undefined}>Tap a dish for each one wanted.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
