// Counter service: pick the order type (Eat in, Take out, ... as the till's
// revenue stream offers them, with the name / tent number the type asks
// for), tap a dish to start an order (numbered from this till's own range,
// #100, #101, ... going round; the check itself is T2-1, T2-2, ...),
// take payment, and the order goes to the kitchen as it is paid. Orders
// waiting (sent, not yet paid) are listed on the left.

import { useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useTill, useChecks, toast, currentChecks } from '../lib/store.js'
import { openCheck, addItem, needsChoices, defaultStreamId, streamOf, streamTypes, defaultTypeId, promptsFor } from '../lib/checkOps.js'
import { cx } from '../components/ui.jsx'
import MenuPanel from '../components/MenuPanel.jsx'
import ItemModal from '../components/ItemModal.jsx'
import CheckScreen from './Check.jsx'
import { CheckRow } from './Floor.jsx'
import { SoldOutModal, DetailFields, missingText } from '../components/CheckActions.jsx'

export default function Counter() {
  const { config } = useTill()
  const checks = useChecks()
  const [current, setCurrent] = useState(null)
  const [name, setName] = useState('')
  const [tent, setTent] = useState('')
  const [typeId, setTypeId] = useState(null)
  const [item, setItem] = useState(null)
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [soldOutItem, setSoldOutItem] = useState(null)

  if (current && checks[current]?.status === 'open') {
    return <CheckScreen checkId={current} counter onBack={() => setCurrent(null)} onOpen={setCurrent} />
  }

  const waiting = Object.values(checks).filter(c => c.status === 'open' && c.mode === 'counter')
    .sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const streamId = defaultStreamId(config)
  const types = streamTypes(config, streamId)
  const currentType = types.some(x => x.type.id === typeId) ? typeId : defaultTypeId(config, streamId)
  const prompts = promptsFor(config, streamId, currentType)

  const start = (it, opts = {}) => {
    const missing = missingText(prompts, name, tent)
    if (missing) { setItem(null); return toast(missing + ' first', 'bad') }
    const o = openCheck({
      mode: 'counter', revenue_stream_id: streamId, order_type_id: currentType,
      tab_name: prompts.ask_name !== 'off' ? (name.trim() || null) : null,
      tent: prompts.ask_tent !== 'off' ? (tent.trim() || null) : null,
    })
    if (!o.ok) return toast(o.error, 'bad')
    const check = currentChecks()[o.checkId]
    const r = addItem(check, it, opts.selection || {}, { qty: opts.qty, seat: opts.seat, course: opts.course, note: opts.note, allergies: opts.allergies, unit_price: opts.unit_price })
    if (!r.ok) toast(r.error, 'bad')
    setName('')
    setTent('')
    setTypeId(null)
    setItem(null)
    setCurrent(o.checkId)
  }

  return (
    <div className="h-full flex">
      <aside className="w-[300px] xl:w-[340px] shrink-0 border-r border-line bg-white flex flex-col">
        <div className="p-3 border-b border-line space-y-2">
          <div className="flex items-center gap-2 font-bold"><ShoppingBag size={20} className="text-brand" /> New order</div>
          {types.length > 1 && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order type">
              {types.map(({ type }) => (
                <button key={type.id} className={cx('btn h-12', type.id === currentType && 'btn-primary')} onClick={() => setTypeId(type.id)}>{type.name}</button>
              ))}
            </div>
          )}
          <DetailFields prompts={prompts} name={name} setName={setName} tent={tent} setTent={setTent} />
          <div className="text-xs text-muted">Tap a dish to start. {[types.length === 1 ? types[0].type.name : null, streamOf(config, streamId)?.name].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="label px-1">Waiting to pay or collect</div>
          {!waiting.length && <div className="text-sm text-muted px-1">No open orders.</div>}
          {waiting.map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => setCurrent(c.id)} />)}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <MenuPanel config={config} menuIds={streamOf(config, streamId)?.menu_ids} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
          onPick={it => (needsChoices(config, it) ? setItem(it) : start(it, { seat, course }))}
          onHold={it => setSoldOutItem(it)}
          onOpenItem={() => toast('Start the order with a dish first, then add an item not on the menu from More', 'info')} />
      </div>
      {item && <ItemModal item={item} config={config} defaults={{ seat, course }} onClose={() => setItem(null)} onAdd={o => start(item, o)} />}
      {soldOutItem && <SoldOutModal item={soldOutItem} config={config} onClose={() => setSoldOutItem(null)}
        onAdd={it => (needsChoices(config, it) ? setItem(it) : start(it, { seat, course }))} />}
    </div>
  )
}
