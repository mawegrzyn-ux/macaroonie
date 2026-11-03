// The prompt an order flow shows (Store tech > Order flows, kind ask;
// lib/orderFlows.js): its question, a line under it, the dishes it offers
// and No thanks. Pick one: a tap adds the dish and closes it. Any of them:
// each tap adds one more (the count shows on the dish), Done closes it. A
// dish with choices opens its choices window first (the host does that in
// onDish, which resolves to whether the dish went on; meanwhile the host
// passes paused, and the prompt hides, keeping its count). A tap outside or
// Escape closes it as No thanks (or Done). Answered, it is recorded on the
// check and not asked again.

import { useMemo, useState } from 'react'
import { MessageSquarePlus, Check } from 'lucide-react'
import { Modal, cx } from './ui.jsx'
import { dishPriceText } from './MenuPanel.jsx'
import { promptChoices } from '../lib/orderFlows.js'

export default function FlowPrompt({ prompt, config, shownIds = null, paused = false, onDish, onDone }) {
  const flow = prompt.flow
  const choices = useMemo(() => promptChoices(config, flow, shownIds), [config, flow, shownIds])
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
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
  return (
    <Modal title={undefined} onClose={finish}>
      <div className="space-y-4" data-testid="flow-prompt" data-flow={flow.id}>
        <div className="flex items-start gap-3">
          <span className="w-12 h-12 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><MessageSquarePlus size={24} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold leading-tight" data-testid="flow-prompt-title">{flow.ask.title}</div>
            {flow.ask.message && <div className="text-muted mt-1" data-testid="flow-prompt-message">{flow.ask.message}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3" data-testid="flow-prompt-dishes">
          {choices.map(it => (
            <button key={it.id} type="button" onClick={() => tap(it)} data-testid="flow-prompt-dish" data-item={it.id}
              className={cx('relative rounded-xl border-2 p-3 min-h-[84px] text-left flex flex-col justify-between touch-manipulation active:scale-[0.97] transition-transform',
                added[it.id] ? 'border-ok bg-ok-soft' : 'border-line bg-white')}>
              <span className="font-semibold leading-tight line-clamp-3">{it.name}</span>
              <span className="text-sm text-muted tabular-nums mt-1">{dishPriceText(config, it.id, comboRefs)}</span>
              {added[it.id] > 0 && (
                <span className="absolute top-2 right-2 min-w-[28px] h-7 px-2 rounded-full bg-ok text-white text-sm font-bold flex items-center justify-center gap-1" data-testid="flow-prompt-count">
                  <Check size={14} />{added[it.id]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button type="button" className={cx('btn flex-1 h-14 text-base', total && 'btn-ok')} onClick={finish} data-testid="flow-prompt-done">
            {total ? 'Done' : 'No thanks'}
          </button>
        </div>
        {several && <div className="text-xs text-muted text-center">Tap a dish for each one wanted.</div>}
      </div>
    </Modal>
  )
}
