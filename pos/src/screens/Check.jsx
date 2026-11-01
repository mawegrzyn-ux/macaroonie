// The order screen for one check: the check on the left, the menu on the
// right. Send goes to the kitchen (holding later courses), Bill prints the
// bill, Pay takes payment and closes the check. A till with a layout (Store
// tech > Till layouts) draws its zones instead (components/LayoutScreen.jsx):
// the check in the Order zone, the designer's buttons doing what they say
// (runButton), a dish's choices in the Dish choices zones when there are any.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Send, Printer, CreditCard, MoreHorizontal, Flame, Users, Eye, Flag, Star, Ban } from 'lucide-react'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { useTill, useChecks, dispatch, toast, setPresence, othersOn, serverName, printBill, signOut } from '../lib/store.js'
import { choiceZones } from '@shared/pos/tillLayout.js'
import { discountList, fitsScope } from '@shared/pos/discounts.js'
import { tillLayoutOf, lastReceiptCheck } from '../lib/tillLayout.js'
import LayoutScreen from '../components/LayoutScreen.jsx'
import {
  addItem, addChosen, needsChoices, streamOf, typeOf, missingDetails, refreshPromotions, sendCheck, comboStartFrom, copyOfLine,
  coversMissing, seatCourseParts, addListCharge,
} from '../lib/checkOps.js'
import { cx, money, elapsed, useApproval, fillStyle } from '../components/ui.jsx'
import { useTillNav } from '../components/TillMenu.jsx'
import CheckPanel from '../components/CheckPanel.jsx'
import MenuPanel from '../components/MenuPanel.jsx'
import ItemModal from '../components/ItemModal.jsx'
import LineModal from '../components/LineModal.jsx'
import PayModal from '../components/PayModal.jsx'
import LoyaltyModal from '../components/LoyaltyModal.jsx'
import AllergyModal from '../components/AllergyModal.jsx'
import MenusModal from '../components/MenusModal.jsx'
import { useShownMenus } from '../lib/tillMenus.js'
import {
  ActionsMenu, SendModal, needsSendChoice, FireModal, DiscountModal, ChargesModal, OffersModal, MoveModal,
  MergeModal, TableModal, NameModal, ServerModal, StreamModal, OrderTypeModal, GuestsModal, OpenItemModal, NoSale, SoldOutModal,
  CancelOrderModal, applyDiscountPreset,
} from '../components/CheckActions.jsx'

export default function CheckScreen({ checkId, onBack, onOpen, counter = false }) {
  const { config } = useTill()
  const checks = useChecks()
  const check = checks[checkId]
  const approve = useApproval()
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [modal, setModal] = useState(null)   // { kind, ... }
  // A till layout's Dish choices zones: the dish being added ({ item, initial, key }).
  const [choosing, setChoosing] = useState(null)
  const layout = useMemo(() => tillLayoutOf(config), [config])
  const zones = layout ? choiceZones(layout) : null
  const nav = useTillNav()
  // The layout's Order zone: which of its own buttons it shows, their colours, its text size.
  const orderZone = layout?.zones.find(z => z.type === 'check') || null
  const hidden = new Set(orderZone?.hide || [])
  const colourOf = key => orderZone?.colours?.[key] || null
  // The menus on now (the menu times, or what staff picked in More > Menus).
  const shownMenus = useShownMenus(config, check ? streamOf(config, check.revenue_stream_id)?.menu_ids : null)

  useEffect(() => {
    setPresence(checkId)
    setChoosing(null)
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
    if (check && !check.lines.length && missingDetails(check, config).length) setModal({ kind: 'type', start: 'details' })
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
  // What the seat and course bar shows: the check's revenue stream may use
  // no seats (covers off) or no courses (lib/checkOps.js).
  const barParts = seatCourseParts(config, check.revenue_stream_id)
  // Required name / tent number, and the number of guests at a table whose
  // stream must have them: asked before the order goes to the kitchen or is paid.
  const needDetails = () => {
    if (missing.length) {
      toast('Enter ' + missing.map(m => (m === 'name' ? 'a customer name' : 'a tent number')).join(' and ') + ' first', 'bad')
      setModal({ kind: 'type', start: 'details' })
      return true
    }
    if (coversMissing(check, config)) {
      toast('How many guests? This table needs them first', 'bad')
      setModal({ kind: 'covers' })
      return true
    }
    return false
  }
  const unsent = check.lines.filter(l => l.status === 'new').length
  const held = heldCourses(check)
  const others = othersOn(check.id)
  const close = () => setModal(null)

  const pick = item => {
    if (needsChoices(config, item)) {
      // A layout with Dish choices zones asks there; else the choices window.
      if (zones?.required) return setChoosing({ item, key: Date.now() + ':' + item.id })
      return setModal({ kind: 'item', item })
    }
    const r = addItem(check, item, {}, { seat, course })
    if (!r.ok) toast(r.error, 'bad')
  }
  const added = (item, o, replace = null) => {
    // One line, or one for each dish (more picks, more dishes).
    const r = addChosen(check.id, item, o)
    if (!r.ok) return toast(r.error, 'bad')
    setChoosing(null)
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
  // opts: { autoExact: 'cash' | 'card' } pays the amount left in one tap;
  // { tender } opens Pay with that tender picked (a layout's buttons).
  const pay = (opts = {}) => {
    if (needDetails()) return
    refreshPromotions(check.id)
    setModal({ kind: 'pay', ...opts })
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
    <div className={cx('flex items-center gap-2 py-2 border-b border-line', hidden.has('back') ? 'px-3' : 'px-2')}>
      {!hidden.has('back') && <button className="btn btn-ghost w-12 px-0" onClick={onBack} aria-label="Back" data-testid="check-back"><ArrowLeft size={22} /></button>}
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
      {check.lines.length > 0 && !hidden.has('cancel') && (
        <button className={cx('btn px-3 shrink-0', colourOf('cancel') ? '' : 'btn-ghost text-bad')} style={fillStyle(colourOf('cancel'))}
          onClick={() => setModal({ kind: 'cancel' })} data-testid="check-cancel" aria-label="Cancel order">
          <Ban size={20} /><span className="hidden xl:inline">Cancel order</span>
        </button>
      )}
    </div>
  )

  // The Order zone's own buttons a layout keeps (all four on the standard screen).
  const foot = [
    !hidden.has('more') && (
      <button key="more" className="btn h-16 flex-col gap-0" style={fillStyle(colourOf('more'))} onClick={() => setModal({ kind: 'actions' })} data-testid="check-more">
        <MoreHorizontal size={20} /><span className="text-xs">More</span>
      </button>
    ),
    !hidden.has('send') && (held.length > 0 && !unsent
      ? <button key="send" className="btn h-16 flex-col gap-0 bg-held text-white border-held" onClick={() => setModal({ kind: 'fire' })} data-testid="check-fire"><Flame size={20} /><span className="text-xs">Fire</span></button>
      : <button key="send" className={cx('btn h-16 flex-col gap-0', !colourOf('send') && 'btn-primary')} style={fillStyle(colourOf('send'))} disabled={!unsent} onClick={send} data-testid="check-send">
          <Send size={20} /><span className="text-xs">Send{unsent ? ' ' + unsent : ''}</span>
        </button>),
    !hidden.has('bill') && (
      <button key="bill" className="btn h-16 flex-col gap-0" style={fillStyle(colourOf('bill'))} disabled={!check.lines.length} onClick={bill} data-testid="check-bill">
        <Printer size={20} /><span className="text-xs">Bill</span>
      </button>
    ),
    !hidden.has('pay') && (
      <button key="pay" className={cx('btn h-16 flex-col gap-0', !colourOf('pay') && 'btn-ok')} style={fillStyle(colourOf('pay'))} disabled={t.total <= 0 && !check.lines.length} onClick={() => pay()} data-testid="check-pay">
        <CreditCard size={20} /><span className="text-xs">Pay {money(Math.max(0, t.balance))}</span>
      </button>
    ),
  ].filter(Boolean)
  const footer = foot.length > 0 && (
    <div className="p-2 grid gap-2 border-t border-line" style={{ gridTemplateColumns: `repeat(${foot.length}, minmax(0, 1fr))` }} data-testid="check-footer">
      {foot}
    </div>
  )

  const panel = (
    <CheckPanel check={check} config={config} header={<>
      {header}
      {others.length > 0 && (
        <div className="px-3 py-1.5 bg-warn-soft text-warn text-sm font-semibold flex items-center gap-2"><Eye size={14} />Also open on {others.map(o => o.device_name).join(', ')}</div>
      )}
    </>} footer={footer} font={orderZone?.font || null} onLine={line => setModal({ kind: 'line', line })} onAction={swipeAction} onRegroup={regroup}
      onAllergy={() => setModal({ kind: 'allergy' })} />
  )

  // A till layout's button (shared/pos/tillLayout.js BUTTON_ACTIONS). Dishes
  // come through pick() (LayoutScreen calls it).
  const runButton = async b => {
    const items = () => (check.lines.length ? true : (toast('Nothing on the order yet', 'bad'), false))
    switch (b.action) {
      case 'exact_cash': return items() && pay({ autoExact: 'cash' })
      case 'exact_card': return items() && pay({ autoExact: 'card' })
      case 'tender': return items() && pay({ tender: b.tender })
      case 'pay': return items() && pay()
      case 'bill': return items() && bill()
      case 'last_receipt': {
        const last = lastReceiptCheck()
        if (!last) return toast('No receipt on this till yet today', 'bad')
        printBill(last)
        return toast('Receipt printed: ' + checkLabel(last), 'ok')
      }
      case 'discount_preset': {
        const p = discountList(config.settings).find(x => x.id === b.preset_id)
        if (!p) return toast('That discount is no longer on the list', 'bad')
        if (!fitsScope(p, 'check')) return toast(p.name + ' is for items: tap an item, then Discount', 'bad')
        if (!items()) return
        const r = await applyDiscountPreset(check, p, approve)
        if (r.cancelled) return
        return r.ok ? toast(p.name + ' taken off', 'ok') : toast(r.error, 'bad')
      }
      case 'discount': return setModal({ kind: 'discount' })
      case 'send': return send()
      case 'fire': return held.length ? setModal({ kind: 'fire' }) : toast('No course is waiting to fire', 'bad')
      case 'more': return setModal({ kind: 'actions' })
      case 'guests': return setModal({ kind: 'covers' })
      case 'order_type': return setModal({ kind: 'type' })
      case 'name': return setModal({ kind: 'name' })
      case 'tent': return setModal({ kind: 'tent' })
      case 'allergy': return setModal({ kind: 'allergy' })
      case 'table': return setModal({ kind: 'table' })
      case 'move': return setModal({ kind: 'move' })
      case 'merge': return setModal({ kind: 'merge' })
      case 'charges': return setModal({ kind: 'sc' })
      case 'charge': {
        // One charge from the company's list (Store tech > Charges): on, or
        // back on when it was taken off.
        const r = addListCharge(check, b.charge_id)
        if (!r.ok) return toast(r.error, 'bad')
        return toast(r.name + (r.already ? ' is on this order already' : r.restored ? ' is back on' : ' added'), r.already ? 'info' : 'ok')
      }
      case 'offers': return (config.promotions || []).length ? setModal({ kind: 'offers' }) : toast('No offers are on', 'bad')
      case 'loyalty': return config.loyalty ? setModal({ kind: 'loyalty' }) : toast('Loyalty isn\'t switched on', 'bad')
      case 'open_item': return setModal({ kind: 'open_item' })
      case 'cancel_order': return check.lines.length ? setModal({ kind: 'cancel' }) : toast('Nothing on the order to cancel', 'bad')
      case 'no_sale': return setModal({ kind: 'nosale' })
      case 'back': return onBack()
      case 'menus': return setModal({ kind: 'menus' })
      case 'till_menu': return nav.openMenu()
      case 'sign_out': return signOut()
      default: return null
    }
  }

  return (
    <div className="h-full flex">
      {layout ? (
        <div className="flex-1 min-w-0">
          <LayoutScreen layout={layout} config={config} check={check} checkZone={panel} menus={shownMenus.shown} tillMenus={shownMenus.menus} shownMenus={shownMenus} covers={check.covers}
            seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
            onDish={pick} onHold={item => setModal({ kind: 'sold_out', item })} onButton={runButton}
            choosing={choosing} onChosen={o => added(choosing.item, { ...o, seat, course })} onCancelChoosing={() => setChoosing(null)}
            onMoreChoices={initial => setModal({ kind: 'item', item: choosing.item, initial })} />
        </div>
      ) : (
        <>
          <div className="w-[42%] max-w-[480px] min-w-[320px] shrink-0">{panel}</div>
          <div className="flex-1 min-w-0">
            <MenuPanel config={config} menus={shownMenus.shown} onPick={pick} onHold={item => setModal({ kind: 'sold_out', item })} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse} parts={barParts}
              covers={check.covers} onOpenItem={() => setModal({ kind: 'open_item' })} />
          </div>
        </>
      )}

      {modal?.kind === 'item' && <ItemModal item={modal.item} config={config} defaults={{ seat: modal.seat ?? seat, course: modal.course ?? course, covers: check.covers, parts: barParts }}
        initial={modal.initial || null} title={modal.title || null} onClose={close} onAdd={o => added(modal.item, o, modal.replace || null)} />}
      {modal?.kind === 'line' && (
        <LineModal check={check} line={check.lines.find(l => l.id === modal.line.id) || modal.line} config={config} onClose={close} initialMode={modal.initialMode || null}
          onDiscount={ids => setModal({ kind: 'discount', lineIds: ids })} onMove={ids => setModal({ kind: 'move', lineIds: ids })}
          onMakeCombo={(line, combo, start) => setModal({
            kind: 'item', item: combo, title: line.name + ' as ' + combo.name, replace: line.id, seat: line.seat ?? null, course: line.course_id ?? null,
            initial: { selection: comboStartFrom(line, start, combo, config), qty: line.qty },
          })} />
      )}
      {modal?.kind === 'actions' && <ActionsMenu check={check} config={config} menus={shownMenus} onClose={close} onPick={action} />}
      {modal?.kind === 'menus' && <MenusModal shown={shownMenus} onClose={close} />}
      {modal?.kind === 'send' && <SendModal check={check} config={config} onClose={close} onSent={() => { close(); toast('Sent to the kitchen', 'ok'); if (!counter) onBack() }} />}
      {modal?.kind === 'fire' && <FireModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'cancel' && <CancelOrderModal check={check} onClose={close} onCancelled={close} />}
      {modal?.kind === 'discount' && <DiscountModal check={check} config={config} lineIds={modal.lineIds || null} onClose={close} />}
      {modal?.kind === 'sc' && <ChargesModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'offers' && <OffersModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'loyalty' && <LoyaltyModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'allergy' && <AllergyModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'move' && <MoveModal check={check} config={config} preselect={modal.lineIds || []} onClose={close} onOpen={onOpen} />}
      {modal?.kind === 'merge' && <MergeModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'table' && <TableModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'name' && <NameModal check={check} onClose={close} />}
      {modal?.kind === 'server' && <ServerModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'stream' && <StreamModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'type' && <OrderTypeModal check={check} config={config} start={modal.start} onClose={close} />}
      {modal?.kind === 'tent' && <OrderTypeModal check={check} config={config} focus="tent" onClose={close} />}
      {modal?.kind === 'covers' && <GuestsModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'open_item' && <OpenItemModal check={check} config={config} onClose={close} />}
      {modal?.kind === 'nosale' && <NoSale onClose={close} />}
      {modal?.kind === 'sold_out' && <SoldOutModal item={modal.item} config={config} onClose={close} onAdd={pick} />}
      {modal?.kind === 'pay' && <PayModal check={check} counter={counter || check.mode === 'counter'} autoExact={modal.autoExact || null} initialTender={modal.tender || null}
        onClose={close} onClosed={() => { close(); onBack() }} />}
    </div>
  )
}

export { cx }
