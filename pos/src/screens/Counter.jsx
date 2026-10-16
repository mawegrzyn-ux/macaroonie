// Counter service: tap a dish to start an order (numbered #1, #2, ... each
// trading day), take payment, and the order goes to the kitchen as it is
// paid. Orders waiting (sent, not yet paid) are listed on the left.

import { useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useTill, useChecks, toast, currentChecks } from '../lib/store.js'
import { openCheck, addItem, needsChoices, defaultRcId, rcOf } from '../lib/checkOps.js'
import MenuPanel from '../components/MenuPanel.jsx'
import ItemModal from '../components/ItemModal.jsx'
import CheckScreen from './Check.jsx'
import { CheckRow } from './Floor.jsx'
import { SoldOutModal } from '../components/CheckActions.jsx'

export default function Counter() {
  const { config } = useTill()
  const checks = useChecks()
  const [current, setCurrent] = useState(null)
  const [name, setName] = useState('')
  const [item, setItem] = useState(null)
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [soldOutItem, setSoldOutItem] = useState(null)

  if (current && checks[current]?.status === 'open') {
    return <CheckScreen checkId={current} counter onBack={() => setCurrent(null)} onOpen={setCurrent} />
  }

  const waiting = Object.values(checks).filter(c => c.status === 'open' && c.mode === 'counter')
    .sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const rcId = defaultRcId(config, { counter: true })

  const start = (it, opts = {}) => {
    const o = openCheck({ mode: 'counter', tab_name: name.trim() || null, revenue_centre_id: rcId })
    if (!o.ok) return toast(o.error, 'bad')
    const check = currentChecks()[o.checkId]
    const r = addItem(check, it, opts.selection || {}, { qty: opts.qty, seat: opts.seat, course: opts.course, note: opts.note, allergies: opts.allergies, unit_price: opts.unit_price })
    if (!r.ok) toast(r.error, 'bad')
    setName('')
    setItem(null)
    setCurrent(o.checkId)
  }

  return (
    <div className="h-full flex">
      <aside className="w-[300px] xl:w-[340px] shrink-0 border-r border-line bg-white flex flex-col">
        <div className="p-3 border-b border-line space-y-2">
          <div className="flex items-center gap-2 font-bold"><ShoppingBag size={20} className="text-brand" /> New order</div>
          <input className="input" placeholder="Name for the order (optional)" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
          <div className="text-xs text-muted">Tap a dish to start. {rcOf(config, rcId)?.name || ''}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="label px-1">Waiting to pay or collect</div>
          {!waiting.length && <div className="text-sm text-muted px-1">No open orders.</div>}
          {waiting.map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => setCurrent(c.id)} />)}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <MenuPanel config={config} menuIds={rcOf(config, rcId)?.menu_ids} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
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
