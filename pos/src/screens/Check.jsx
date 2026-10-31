// The order screen for one check: the check on the left, the menu on the
// right. Send goes to the kitchen (holding later courses), Bill prints the
// bill, Pay takes payment and closes the check.

import { useEffect, useState } from 'react'
import { ArrowLeft, Send, Printer, CreditCard, MoreHorizontal, Flame, Users, Eye, Flag, Star, Ban } from 'lucide-react'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { useTill, useChecks, dispatch, toast, setPresence, othersOn, serverName } from '../lib/store.js'
import { addItem, needsChoices, streamOf, typeOf, missingDetails, refreshPromotions, sendCheck, comboStartFrom, copyOfLine } from '../lib/checkOps.js'
import { cx, money, elapsed, useApproval } from '../components/ui.jsx'
import CheckPanel from '../components/CheckPanel.jsx'
import MenuPanel from '../components/MenuPanel.jsx'
import ItemModal from '../components/ItemModal.jsx'
import LineModal from '../components/LineModal.jsx'
import PayModal from '../components/PayModal.jsx'
import LoyaltyModal from '../components/LoyaltyModal.jsx'
import {
  ActionsMenu, SendModal, needsSendChoice, FireModal, DiscountModal, ServiceChargeModal, OffersModal, MoveModal,
  MergeModal, TableModal, NameModal, ServerModal, StreamModal, OrderTypeModal, GuestsModal, OpenItemModal, NoSale, SoldOutModal,
  CancelOrderModal,
} from '../components/CheckActions.jsx'

export default function CheckScreen({ checkId, onBack, onOpen, counter = false }) {
  const { config } = useTill()
  const checks = useChecks()
  const check = checks[checkId]
  const approve = useApproval()
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [modal, setModal] = useState(null)   // { kind, ... }

  useEffect(() => {
    setPresence(checkId)
    return () => setPresence(null)
  }, [checkId])

  useEffect(() => {
    if (check && check.status !== 'open' && modal?.kind !== 'pay') onBack()
  }, [check?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Automatic combos and offers follow the check's dishes as they change.
  const lineSig = check ? check.lines.map(l => l.id + ':' + l.qty + ':' + l.status + ':' + l.unit_price).join('|') : ''
  useEffect(() => {
    if (check && check.status === 'open' && check.lines.length) refreshPromotions(check.id)
  }, [lineSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new check whose order type needs a name or tent number asks for it first.
  useEffect(() => {
    if (check && !check.lines.length && missingDetails(check, config).length) setModal({ kind: 'type' })
  }, [checkId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!check) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted">
        <div>This check isn't open on this till.</div>
        <button className="btn" onClick={onBack}><ArrowLeft size={18} /> Back</button>
      </div>
    )
  }

  const table = check.table_id ? (config.tables || []).find(t => t.id === check.table_id) : null
  const stream = streamOf(config, check.revenue_stream_id)
  const type = typeOf(config, check.order_type_id)
  const t = checkTotals(check)
  const missing = missingDetails(check, config)
  // Required name / tent number: asked before the order goes to the kitchen or is paid.
  const needDetails = () => {
    if (!missing.length) return false
    toast('Enter ' + missing.map(m => (m === 'name' ? 'a customer name' : 'a tent number')).join(' and ') + ' first', 'bad')
    setModal({ kind: 'type' })
    return true
  }
  const unsent = check.lines.filter(l => l.status === 'new').length
  const held = heldCourses(check)
  const others = othersOn(check.id)
  const close = () => setModal(null)

  const pick = item => {
    if (needsChoices(config, item)) return setModal({ kind: 'item', item })
    const r = addItem(check, item, {}, { seat, course })
    if (!r.ok) toast(r.error, 'bad')
  }
  const added = (item, o, replace = null) => {
    const r = addItem(check, item, o.selection, { qty: o.qty, seat: o.seat, course: o.course, note: o.note, allergies: o.allergies, unit_price: o.unit_price })
    if (!r.ok) return toast(r.error, 'bad')
    // Make it a combo: the dish it started from comes off (it hasn't been
    // sent), swapped for the combo line, so no manager is needed for it.
    if (replace) {
      const e = r.events?.[0]
      const by = e?.type === 'line.added' ? e.payload.line.id : e?.payload?.line_id
      const d = dispatch('line.deleted', { line_id: replace, replaced_by: by }, { check_id: check.id })
      if (!d.ok) toast(d.error, 'bad')
    }
    close()
  }
  // A swipe's button: an item not sent yet comes off (Undo puts it back);
  // one the kitchen has opens the void window (a reason is needed).
  const swipeAction = async line => {
    if (line.status !== 'new') return setModal({ kind: 'line', line, initialMode: 'void' })
    const approver = await approve(null, null, 'Taking items off needs a manager here.', ['delete_unsent'])
    if (approver === false) return
    const r = dispatch('line.deleted', { line_id: line.id }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Took off ' + (line.qty > 1 ? line.qty + ' x ' : '') + line.name, 'ok', 5000, {
      label: 'Undo',
      run: () => {
        const back = dispatch('line.added', { line: copyOfLine(line) }, { check_id: check.id })
        if (!back.ok) toast(back.error, 'bad')
      },
    })
  }
  // Dragged to another course (or seat).
  const regroup = (line, to) => {
    const patch = to.by === 'seat' ? { seat: Number(to.id) || null } : { course_id: to.id || null }
    const r = dispatch('line.changed', { line_id: line.id, ...patch }, { check_id: check.id })
    if (!r.ok) toast(r.error, 'bad')
  }
  const send = () => {
    if (!unsent) return toast('Nothing new to send', 'bad')
    if (needDetails()) return
    if (needsSendChoice(check, config)) return setModal({ kind: 'send' })
    const r = sendCheck(check, [])
    if (!r.ok) return toast(r.error, 'bad')
    toast('Sent to the kitchen', 'ok')
    if (!counter) onBack()
  }
  const bill = () => {
    refreshPromotions(check.id)
    const r = dispatch('bill.printed', {}, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Bill printed', 'ok')
  }
  const pay = () => {
    if (needDetails()) return
    refreshPromotions(check.id)
    setModal({ kind: 'pay' })
  }
  const action = key => {
    if (key === 'bill') { close(); return bill() }
    if (key === 'void_check') {
      const r = dispatch('check.closed', {}, { check_id: check.id })
      if (!r.ok) return toast(r.error, 'bad')
      return onBack()
    }
    const map = { drawer: 'nosale' }
    setModal({ kind: map[key] || key })
  }

  const header = (
    <div className="flex items-center gap-2 px-2 py-2 border-b border-line">
      <button className="btn btn-ghost w-12 px-0" onClick={onBack} aria-label="Back"><ArrowLeft size={22} /></button>
      <button className="flex-1 min-w-0 text-left" onClick={() => setModal({ kind: 'actions' })}>
        <div className="font-bold text-lg truncate">
          {table ? 'Table ' + table.label : check.order_no != null ? 'Order #' + check.order_no : check.tab_name || 'Tab'}
          {check.order_no == null && <span className="text-muted font-normal text-sm ml-2">{checkLabel(check)}</span>}
        </div>
        <div className="text-xs text-muted truncate flex items-center gap-2">
          {check.covers ? <span className="flex items-center gap-1"><Users size={12} />{check.covers}</span> : null}
          <span>{serverName(config, check.server_id)}</span>
          {type && <span className="font-semibold text-ink" data-testid="check-type">{type.name}</span>}
          {check.tent && <span className="font-semibold text-brand flex items-center gap-0.5" data-testid="check-tent"><Flag size={12} />{check.tent}</span>}
          {check.loyalty && <span className="font-semibold text-brand flex items-center gap-0.5 truncate" data-testid="check-member"><Star size={12} />{check.loyalty.name || 'Member'}</span>}
          {stream && (config.revenue_streams || []).length > 1 && <span className="font-semibold text-brand">{stream.name}</span>}
          <span>{elapsed(check.opened_at)}</span>
        </div>
      </button>
      {check.tab_name && (table || check.order_no != null) && <div className="text-sm font-semibold truncate max-w-[140px]" data-testid="check-name">{check.tab_name}</div>}
      {check.lines.length > 0 && (
        <button className="btn btn-ghost text-bad px-3 shrink-0" onClick={() => setModal({ kind: 'cancel' })} data-testid="check-cancel" aria-label="Cancel order">
          <Ban size={20} /><span className="hidden xl:inline">Cancel order</span>
        </button>
      )}
    </div>
  )

  const footer = (
    <div className="p-2 grid grid-cols-4 gap-2 border-t border-line">
      <button className="btn h-16 flex-col gap-0" onClick={() => setModal({ kind: 'actions' })}><MoreHorizontal size={20} /><span className="text-xs">More</span></button>
      {held.length > 0 && !unsent
        ? <button className="btn h-16 flex-col gap-0 bg-held text-white border-held" onClick={() => setModal({ kind: 'fire' })}><Flame size={20} /><span className="text-xs">Fire</span></button>
        : <button className="btn btn-primary h-16 flex-col gap-0" disabled={!unsent} onClick={send}><Send size={20} /><span className="text-xs">Send{unsent ? ' ' + unsent : ''}</span></button>}
      <button className="btn h-16 flex-col gap-0" disabled={!check.lines.length} onClick={bill}><Printer size={20} /><span className="text-xs">Bill</span></button>
      <button className="btn btn-ok h-16 flex-col gap-0" disabled={t.total <= 0 && !check.lines.length} onClick={pay}><CreditCard size={20} /><span className="text-xs">Pay {money(Math.max(0, t.balance))}</span></button>
    </div>
  )

  return (
    <div className="h-full flex">
      <div className="w-[42%] max-w-[480px] min-w-[320px] shrink-0">
        <CheckPanel check={check} config={config} header={<>
          {header}
          {others.length > 0 && (
            <div className="px-3 py-1.5 bg-warn-soft text-warn text-sm font-semibold flex items-center gap-2"><Eye size={14} />Also open on {others.map(o => o.device_name).join(', ')}</div>
          )}
        </>} footer={footer} onLine={line => setModal({ kind: 'line', line })} onAction={swipeAction} onRegroup={regroup} />
      </div>
      <div className="flex-1 min-w-0">
        <MenuPanel config={config} menuIds={stream?.menu_ids} onPick={pick} onHold={item => setModal({ kind: 'sold_out', item })} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
          covers={check.covers} onOpenItem={() => setModal({ kind: 'open_item' })} />
      </div>

      {modal?.kind === 'item' && <ItemModal item={modal.item} config={config} defaults={{ seat: modal.seat ?? seat, course: modal.course ?? course, covers: check.covers }}
        initial={modal.initial || null} title={modal.title || null} onClose={close} onAdd={o => added(modal.item, o, modal.replace || null)} />}
      {modal?.kind === 'line' && (
        <LineModal check={check} line={check.lines.find(l => l.id === modal.line.id) || modal.line} config={config} onClose={close} initialMode={modal.initialMode || null}
          onDiscount={ids => setModal({ kind: 'discount', lineIds: ids })} onMove={ids => setModal({ kind: 'move', lineIds: ids })}
          onMakeCombo={(line, combo, start) => setModal({
            kind: 'item', item: combo, title: line.name + ' as ' + combo.name, replace: line.id, seat: line.seat ?? null, course: line.course_id ?? null,
            initial: { selection: comboStartFrom(line, start, combo, config), qty: line.qty },
          })} />
      )}
      {modal?.kind === 'actions' && <ActionsMenu check={check} config={config} onClose={close} onPick={action} />}
      {modal?.kind === 'send' && <SendModal check={check} config={config} onClose={close} onSent={() => { close(); toast('Sent to the kitchen', 'ok'); if (!counter) onBack() }} />}
      {modal?.kind === 'fire' && <FireModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'cancel' && <CancelOrderModal check={check} onClose={close} onCancelled={close} />}
      {modal?.kind === 'discount' && <DiscountModal check={check} config={config} lineIds={modal.lineIds || null} onClose={close} />}
      {modal?.kind === 'sc' && <ServiceChargeModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'offers' && <OffersModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'loyalty' && <LoyaltyModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'move' && <MoveModal check={check} config={config} preselect={modal.lineIds || []} onClose={close} onOpen={onOpen} />}
      {modal?.kind === 'merge' && <MergeModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'table' && <TableModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'name' && <NameModal check={check} onClose={close} />}
      {modal?.kind === 'server' && <ServerModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'stream' && <StreamModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'type' && <OrderTypeModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'tent' && <OrderTypeModal check={check} config={config} focus="tent" onClose={close} />}
      {modal?.kind === 'covers' && <GuestsModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'open_item' && <OpenItemModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'nosale' && <NoSale onClose={close} />}
      {modal?.kind === 'sold_out' && <SoldOutModal item={modal.item} config={config} onClose={close} onAdd={pick} />}
      {modal?.kind === 'pay' && <PayModal check={check} counter={counter || check.mode === 'counter'} onClose={close} onClosed={() => { close(); onBack() }} />}
    </div>
  )
}

export { cx }
