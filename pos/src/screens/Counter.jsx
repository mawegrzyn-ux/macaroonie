// Counter service: a new order starts with the order prompt (the order type
// as the till's revenue stream offers them, then the name / tent number the
// type asks for; components/OrderPrompt.jsx, one screen or two steps), from
// New order or the first dish tapped. The first dish opens the order
// (numbered from this till's own range, #100, #101, ... going round; the
// check itself is T2-1, T2-2, ...); take payment, and the order goes to the
// kitchen as it is paid. Orders waiting (sent, not yet paid) are listed on
// the left. A till with a layout (Store tech > Till layouts) draws its zones,
// New order and the orders waiting in the Order zone; a dish's choices go in
// the Dish choices zones when the layout has them.

import { useMemo, useState } from 'react'
import { ShoppingBag, Plus, Pencil, X } from 'lucide-react'
import { checkLabel } from '@shared/pos/checks.js'
import { choiceZones } from '@shared/pos/tillLayout.js'
import { useTill, useChecks, toast, currentChecks, printBill } from '../lib/store.js'
import { tillLayoutOf, lastReceiptCheck } from '../lib/tillLayout.js'
import LayoutScreen from '../components/LayoutScreen.jsx'
import { cx } from '../components/ui.jsx'
import {
  openCheck, addItem, needsChoices, defaultStreamId, streamOf, streamTypes, defaultTypeId, promptsFor, typeOf,
  orderPromptOf, newOrderAsks,
} from '../lib/checkOps.js'
import MenuPanel from '../components/MenuPanel.jsx'
import ItemModal from '../components/ItemModal.jsx'
import OrderPrompt from '../components/OrderPrompt.jsx'
import CheckScreen from './Check.jsx'
import { CheckRow } from './Floor.jsx'
import { SoldOutModal, NoSale } from '../components/CheckActions.jsx'

export default function Counter() {
  const { config } = useTill()
  const checks = useChecks()
  const [current, setCurrent] = useState(null)
  // The prompt's answers for the next order: { typeId, name, tent } (null = not asked yet).
  const [answers, setAnswers] = useState(null)
  // The prompt on screen, and what happens after it: { then: 'hold' | 'start' | 'choose', item, opts }.
  const [prompt, setPrompt] = useState(null)
  const [item, setItem] = useState(null)        // the choices window: { item, initial }
  const [choosing, setChoosing] = useState(null) // a layout's Dish choices zones: { item, initial, key }
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [soldOutItem, setSoldOutItem] = useState(null)
  const [noSale, setNoSale] = useState(false)
  const layout = useMemo(() => tillLayoutOf(config), [config])
  const zones = layout ? choiceZones(layout) : null

  if (current && checks[current]?.status === 'open') {
    return <CheckScreen checkId={current} counter onBack={() => setCurrent(null)} onOpen={setCurrent} />
  }

  const waiting = Object.values(checks).filter(c => c.status === 'open' && c.mode === 'counter')
    .sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const streamId = defaultStreamId(config)
  const types = streamTypes(config, streamId)
  const asks = newOrderAsks(config, streamId)
  const typeId = answers?.typeId && types.some(x => x.type.id === answers.typeId) ? answers.typeId : defaultTypeId(config, streamId)

  const start = (it, opts = {}, a = answers) => {
    const tid = a?.typeId && types.some(x => x.type.id === a.typeId) ? a.typeId : defaultTypeId(config, streamId)
    const p = promptsFor(config, streamId, tid)
    const o = openCheck({
      mode: 'counter', revenue_stream_id: streamId, order_type_id: tid,
      tab_name: p.ask_name !== 'off' ? (a?.name || null) : null,
      tent: p.ask_tent !== 'off' ? (a?.tent || null) : null,
    })
    if (!o.ok) return toast(o.error, 'bad')
    const check = currentChecks()[o.checkId]
    const r = addItem(check, it, opts.selection || {}, { qty: opts.qty, seat: opts.seat, course: opts.course, note: opts.note, allergies: opts.allergies, unit_price: opts.unit_price })
    if (!r.ok) toast(r.error, 'bad')
    setAnswers(null)
    setItem(null)
    setChoosing(null)
    setCurrent(o.checkId)
  }
  // A dish's choices: in the layout's Dish choices zones, else the choices window.
  const choose = it => (zones?.required ? setChoosing({ item: it, key: Date.now() + ':' + it.id }) : setItem({ item: it }))
  // A dish tapped: the prompt first when this order hasn't been asked yet.
  const pick = it => {
    const needs = needsChoices(config, it)
    if (asks && !answers) return setPrompt({ then: needs ? 'choose' : 'start', item: it, opts: { seat, course } })
    return needs ? choose(it) : start(it, { seat, course })
  }
  const answered = a => {
    const then = prompt
    setAnswers(a)
    setPrompt(null)
    if (then?.then === 'start') start(then.item, then.opts, a)
    else if (then?.then === 'choose') choose(then.item)
  }
  // A layout's buttons before an order: dishes start one, the rest need an order
  // (LayoutScreen greys them) except Last receipt and No sale.
  const runButton = b => {
    if (b.action === 'last_receipt') {
      const last = lastReceiptCheck()
      if (!last) return toast('No receipt on this till yet today', 'bad')
      printBill(last)
      return toast('Receipt printed: ' + checkLabel(last), 'ok')
    }
    if (b.action === 'no_sale') return setNoSale(true)
    return toast('Start an order first', 'info')
  }
  const shown = answers && [typeOf(config, typeId)?.name, answers.name, answers.tent && 'Tent ' + answers.tent].filter(Boolean)

  const panel = cls => (
      <aside className={cx(cls, 'bg-white flex flex-col')} data-testid="counter-panel">
        <div className="p-3 border-b border-line space-y-2">
          <div className="flex items-center gap-2 font-bold"><ShoppingBag size={20} className="text-brand" /> New order</div>
          {answers ? (
            <div className="rounded-xl border border-brand bg-brand-soft p-3" data-testid="counter-answers">
              <div className="font-bold text-lg leading-tight">{shown[0]}</div>
              {shown.length > 1 && <div className="text-sm">{shown.slice(1).join(' · ')}</div>}
              <div className="flex gap-2 mt-2">
                <button className="btn flex-1" onClick={() => setPrompt({ then: 'hold' })} data-testid="counter-change"><Pencil size={16} /> Change</button>
                <button className="btn w-12 px-0" onClick={() => setAnswers(null)} aria-label="Clear" data-testid="counter-clear"><X size={18} /></button>
              </div>
            </div>
          ) : asks ? (
            <button className="btn btn-primary w-full h-16 text-lg" onClick={() => setPrompt({ then: 'hold' })} data-testid="counter-new"><Plus size={22} /> New order</button>
          ) : null}
          <div className="text-xs text-muted">
            {answers ? 'Tap a dish to start the order.' : asks ? 'Or tap a dish: the till asks first.' : 'Tap a dish to start.'}{' '}
            {[types.length === 1 ? types[0].type.name : null, streamOf(config, streamId)?.name].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="label px-1">Waiting to pay or collect</div>
          {!waiting.length && <div className="text-sm text-muted px-1">No open orders.</div>}
          {waiting.map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => setCurrent(c.id)} />)}
        </div>
      </aside>
  )

  return (
    <div className="h-full flex">
      {layout ? (
        <div className="flex-1 min-w-0">
          <LayoutScreen layout={layout} config={config} check={null} checkZone={panel('h-full')} menuIds={streamOf(config, streamId)?.menu_ids}
            seat={seat} setSeat={setSeat} course={course} setCourse={setCourse} canBack={false}
            onDish={pick} onHold={it => setSoldOutItem(it)} onButton={runButton}
            choosing={choosing} onChosen={o => start(choosing.item, { ...o, seat, course })} onCancelChoosing={() => setChoosing(null)}
            onMoreChoices={initial => setItem({ item: choosing.item, initial })} />
        </div>
      ) : (
        <>
          {panel('w-[300px] xl:w-[340px] shrink-0 border-r border-line')}
          <div className="flex-1 min-w-0">
            <MenuPanel config={config} menuIds={streamOf(config, streamId)?.menu_ids} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
              onPick={pick}
              onHold={it => setSoldOutItem(it)}
              onOpenItem={() => toast('Start the order with a dish first, then add an item not on the menu from More', 'info')} />
          </div>
        </>
      )}
      {item && <ItemModal item={item.item} config={config} defaults={{ seat, course }} initial={item.initial || null} onClose={() => setItem(null)} onAdd={o => start(item.item, o)} />}
      {noSale && <NoSale onClose={() => setNoSale(false)} />}
      {soldOutItem && <SoldOutModal item={soldOutItem} config={config} onClose={() => setSoldOutItem(null)} onAdd={pick} />}
      {prompt && (
        <OrderPrompt title="New order" types={types} typeId={typeId} promptsOf={id => promptsFor(config, streamId, id)}
          name={answers?.name || ''} tent={answers?.tent || ''} style={orderPromptOf(config)}
          doneLabel={prompt.then === 'hold' ? 'Done' : 'Start order'}
          onDone={answered} onClose={() => setPrompt(null)} />
      )}
    </div>
  )
}
