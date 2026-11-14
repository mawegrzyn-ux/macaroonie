// The order screen for one check: the check on the left, the menu on the
// right. Send goes to the kitchen (holding later courses), Bill prints the
// bill, Pay takes payment and closes the check. A till with a layout (Store
// tech > Till layouts) draws its zones instead (components/LayoutScreen.jsx):
// the check in the Order zone, the designer's buttons doing what they say
// (runButton), a dish's choices in the Dish choices zones when there are any.
// Order flows (Store tech > Order flows, lib/orderFlows.js): a prompt when a
// dish is added or before Pay opens (FlowPrompt, on top of everything), and
// the dishes and charges add flows put on, kept in line as the check changes.
// Counter orders (counter tills) have no guests, table, seats or courses, and
// no Send unless the till shows it (counter_send): they go to the kitchen as
// they are paid. Table service asks at Pay about what the kitchen hasn't been
// told yet, or sends it as the check closes (the till's unsent_at_pay).
// then: 'pay' | 'send' | 'fire' opens the check straight into that (the
// floor's list on a phone: swipe right to pay; left asks there, or opens the
// check when it needs its details or guests first).
// Leaving a table-service order with items not sent can ask first (the
// till's Leaving an order: leave()), and with the dish counts on, a dish
// comes off from its own button (the till's take-one-off: takeOneOff()).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Send, Printer, CreditCard, MoreHorizontal, Flame, Users, Eye, Flag, Star, Ban } from 'lucide-react'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { useTill, useChecks, dispatch, toast, setPresence, othersOn, serverName, printBill, signOut, currentChecks } from '../lib/store.js'
import { choiceZones } from '@shared/pos/tillLayout.js'
import { discountList, fitsScope } from '@shared/pos/discounts.js'
import { useTillLayout, lastReceiptCheck } from '../lib/tillLayout.js'
import LayoutScreen from '../components/LayoutScreen.jsx'
import {
  addItem, addChosen, needsChoices, streamOf, typeOf, missingDetails, refreshPromotions, sendCheck, needsSendChoice, comboStartFrom, copyOfLine,
  coversMissing, seatCourseParts, addListCharge, counterSends, unsentAtPay, notFired, tablesOn, itemCounts, showsItemCounts,
  leaveUnsent, takesOffCounted, lineToTakeOff, selectionFromLine, canChangeOptions, lineFields, changeLine,
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
import FlowPrompt from '../components/FlowPrompt.jsx'
import { useShownMenus } from '../lib/tillMenus.js'
import {
  useFlowPrompts, queueFlowPrompts, answerFlowPrompt, dropFlowPrompts, syncFlows, addedOf, offApproval, shownItemIds,
} from '../lib/orderFlows.js'
import {
  ActionsMenu, SendModal, FireModal, DiscountModal, ChargesModal, OffersModal, MoveModal,
  MergeModal, TableModal, NameModal, ServerModal, StreamModal, OrderTypeModal, GuestsModal, OpenItemModal, NoSale, SoldOutModal,
  CancelOrderModal, applyDiscountPreset, UnsentModal, LeaveModal,
} from '../components/CheckActions.jsx'

export default function CheckScreen({ checkId, onBack, onOpen, counter = false, then = null }) {
  const { config } = useTill()
  const checks = useChecks()
  const check = checks[checkId]
  const approve = useApproval()
  const [seat, setSeat] = useState(null)
  const [course, setCourse] = useState(null)
  const [modal, setModal] = useState(null)   // { kind, ... }
  // A till layout's Dish choices zones: the dish being added ({ item, initial, key }).
  const [choosing, setChoosing] = useState(null)
  const layout = useTillLayout(config)
  const zones = layout ? choiceZones(layout) : null
  const nav = useTillNav()
  // The layout's Order zone: which of its own buttons it shows, their colours, its text size.
  const orderZone = layout?.zones.find(z => z.type === 'check') || null
  const hidden = new Set(orderZone?.hide || [])
  const colourOf = key => orderZone?.colours?.[key] || null
  // The menus on now (the menu times, or what staff picked in More > Menus).
  const shownMenus = useShownMenus(config, check ? streamOf(config, check.revenue_stream_id)?.menu_ids : null)
  // Order flows: the prompts waiting for this check (the first one shows) and
  // the dishes on the menus shown now (a prompt offers only those).
  const prompts = useFlowPrompts(checkId)
  const shownIds = useMemo(() => shownItemIds(shownMenus.shown), [shownMenus.shown])
  useEffect(() => () => dropFlowPrompts(checkId), [checkId])

  useEffect(() => {
    setPresence(checkId)
    setChoosing(null)
    return () => setPresence(null)
  }, [checkId])

  useEffect(() => {
    if (check && check.status !== 'open' && modal?.kind !== 'pay') onBack()
  }, [check?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Automatic combos and offers follow the check's dishes as they change
  // (their picks too: Change options can make a dish fit a deal, or not).
  const picksOf = l => (l.modifiers || []).map(m => (m.option_id || m.name || '') + (m.prefix ? '/' + m.prefix : '')).join('.')
    + (l.combo || []).map(x => ';' + (x.option_id || '') + ':' + (x.item_id || '')).join('')
  const lineSig = check ? check.lines.map(l => l.id + ':' + l.qty + ':' + l.status + ':' + l.unit_price + ':' + picksOf(l)).join('|') : ''
  useEffect(() => {
    if (check && check.status === 'open' && check.lines.length) refreshPromotions(check.id)
  }, [lineSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // The dishes and charges add flows put on by themselves, kept in line with
  // the check as it changes (its dishes, order type, channel, charges, what
  // staff took off) and when the flows do (the config's version).
  const flowSig = check ? [
    check.status, check.order_type_id || '', check.revenue_stream_id || '',
    check.lines.map(l => l.id + ':' + l.qty + ':' + l.status + ':' + (l.flow?.key || '')).join(','),
    (check.charges || []).map(x => x.id + ':' + (x.removed ? 1 : 0)).join(','),
    Object.keys(check.flows_off || {}).join(','),
    config?.version || '',
  ].join('|') : ''
  useEffect(() => {
    if (check?.status === 'open') syncFlows(check.id)
  }, [flowSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new check whose order type needs a name or tent number asks for it first.
  useEffect(() => {
    if (check && !check.lines.length && missingDetails(check, config).length) setModal({ kind: 'type', start: 'details' })
  }, [checkId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opened straight into Pay, Send or Fire (then): once, when the check is
  // here. The actions are set as the screen draws (below the early return).
  const actions = useRef({})
  const thenDone = useRef(false)
  useEffect(() => {
    if (!then || thenDone.current || !check) return
    thenDone.current = true
    actions.current[then]?.()
  }, [check?.id, then]) // eslint-disable-line react-hooks/exhaustive-deps

  // The till's nav (the top bar's pages and Sign out, the till menu) asks
  // here before leaving the check (leave(), set below as the screen draws).
  const leaveRef = useRef(null)
  useEffect(() => nav.guardLeave(p => (leaveRef.current ? leaveRef.current(p) : p())), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!check) {
    leaveRef.current = null
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted">
        <div>This check isn't open on this till.</div>
        <button className="btn" onClick={onBack}><ArrowLeft size={18} /> Back</button>
      </div>
    )
  }

  // A counter order: no guests, table, seats or courses; paid first, sent as it is paid.
  const isCounter = counter || check.mode === 'counter'
  const table = check.table_id ? (config.tables || []).find(t => t.id === check.table_id) : null
  const stream = streamOf(config, check.revenue_stream_id)
  const type = typeOf(config, check.order_type_id)
  const t = checkTotals(check)
  const missing = missingDetails(check, config)
  // What the seat and course bar shows: the check's revenue stream may use
  // no seats (covers off) or no courses (lib/checkOps.js).
  const barParts = seatCourseParts(config, check.revenue_stream_id)
  // What a dish's windows (the choices window, an item's own) offer of seats
  // and courses: what the bar shows, and neither on a counter order.
  const lineParts = isCounter ? 'none' : barParts
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

  // Leaving the order with items not sent to the kitchen, on a table-service
  // till that asks (Store tech > Tills, Leaving an order: Ask): Stay, Leave
  // without sending, or Send and leave. Every way out comes through here:
  // Back, a layout's Back and Sign out buttons, and (through the till's nav)
  // the top bar's pages and Sign out and the till menu. proceed: where the
  // till was going.
  const leave = (proceed = onBack) => {
    if (isCounter || leaveUnsent(config) !== 'ask' || !unsent) return proceed()
    setModal({ kind: 'leave', proceed })
  }
  leaveRef.current = leave
  // Send and leave: what is new goes (the Send window first when courses
  // need choosing; the order's details or guests first when it needs them),
  // then the till goes where it was going.
  const sendAndLeave = proceed => {
    if (needDetails()) return
    if (needsSendChoice(check, config)) return setModal({ kind: 'send', then: proceed })
    const r = sendCheck(check, [])
    if (!r.ok) return toast(r.error, 'bad')
    close()
    toast('Sent to the kitchen', 'ok')
    proceed()
  }

  // One of a dish taken off from its own button (Store tech > Tills, with the
  // counts on): a swipe left on its row in a list, a long press on a button.
  // One not sent comes off (its line goes down by one, or goes; Undo puts it
  // back), asking a manager where taking items off needs one; one the kitchen
  // has opens the void window for one (a reason is needed).
  const takeOneOff = async item => {
    const now = currentChecks()[check.id] || check
    const line = lineToTakeOff(now, item.id)
    if (!line) return toast(item.name + ' isn\'t on the order', 'info')
    if (line.status !== 'new') return setModal({ kind: 'line', line, initialMode: 'void', voidQty: 1 })
    const [label, actions] = offApproval(line, 'Taking items off needs a manager here.', ['delete_unsent'])
    const approver = await approve(null, null, label, actions)
    if (approver === false) return
    const qty = Number(line.qty) || 1
    const r = qty > 1
      ? dispatch('line.changed', { line_id: line.id, qty: qty - 1 }, { check_id: check.id, approved_by: approver })
      : dispatch('line.deleted', { line_id: line.id }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Took off 1 x ' + line.name, 'ok', 5000, {
      label: 'Undo',
      run: () => {
        const cur = currentChecks()[check.id]?.lines.find(l => l.id === line.id)
        const back = cur && cur.status === 'new'
          ? dispatch('line.changed', { line_id: line.id, qty: (Number(cur.qty) || 0) + 1 }, { check_id: check.id })
          : dispatch('line.added', { line: copyOfLine({ ...line, qty: 1 }) }, { check_id: check.id })
        if (!back.ok) toast(back.error, 'bad')
      },
    })
  }

  const pick = item => {
    if (needsChoices(config, item)) {
      // A layout with Dish choices zones asks there; else the choices window.
      if (zones?.required) return setChoosing({ item, key: Date.now() + ':' + item.id })
      return setModal({ kind: 'item', item })
    }
    const r = addItem(check, item, {}, { seat, course })
    if (!r.ok) return toast(r.error, 'bad')
    askAfter(item, r)
  }
  // A dish added: the prompts flows ask then (never for a dish a prompt added).
  const askAfter = (item, r) => queueFlowPrompts(check.id, 'dish_added', { added: addedOf(item, r), shownIds })
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
    if (!replace) askAfter(item, r)
  }
  // Change options (the item window's button, a swipe right on a line): the
  // dish's options with the line's own picks, where dishes are picked (a
  // layout's Dish choices zones, else the choices window); Update changes
  // that line (lib/checkOps.js changeLine()).
  const changeOptions = line => {
    const now = currentChecks()[check.id] || check
    const cur = now.lines.find(l => l.id === line.id) || line
    if (!canChangeOptions(config, cur)) {
      return toast(cur.status !== 'new' ? 'This item was sent to the kitchen: void it instead of changing it' : 'This item\'s options can\'t be changed here', 'bad')
    }
    const item = config.items[cur.item_id]
    const initial = { selection: selectionFromLine(cur), qty: cur.qty }
    close()
    if (zones?.required) return setChoosing({ item, initial, edit: cur.id, key: Date.now() + ':' + cur.id })
    setModal({ kind: 'item', item, initial: { ...lineFields(cur), ...initial }, edit: cur.id, title: 'Change ' + cur.name })
  }
  // What Change options gave, onto the same line. Fewer than before asks a
  // manager where taking items off needs one.
  const changed = async (lineId, item, o) => {
    const now = currentChecks()[check.id] || check
    const line = now.lines.find(l => l.id === lineId)
    if (!line || line.status !== 'new') {
      setChoosing(null)
      close()
      return toast('This item was sent to the kitchen meanwhile: void it instead of changing it', 'bad')
    }
    let approver = null
    if (o.qty != null && o.qty < line.qty) {
      const [label, actions] = offApproval(line, 'Taking items off needs a manager here.', ['delete_unsent'])
      approver = await approve(null, null, label, actions)
      if (approver === false) return
    }
    const r = changeLine(now, line, item, o, { approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    setChoosing(null)
    close()
    toast('Changed ' + line.name, 'ok')
  }
  // A prompt's dish: on the order with the seat and course picked; a dish with
  // choices opens its choices window first (the prompt steps aside meanwhile).
  // Resolves to whether it went on.
  const flowDish = it => new Promise(resolve => {
    if (needsChoices(config, it)) return setModal({ kind: 'item', item: it, flowDone: resolve })
    const now = currentChecks()[check.id]
    const r = now ? addItem(now, it, {}, { seat, course }) : { ok: false, error: 'This check is no longer open' }
    if (!r.ok) toast(r.error, 'bad')
    resolve(r.ok)
  })
  const flowChosen = (m, o) => {
    const r = addChosen(check.id, m.item, o)
    if (!r.ok) return toast(r.error, 'bad')
    close()
    m.flowDone(true)
  }
  // A prompt answered: recorded on the check; Pay opens when it was the last
  // prompt asked at checkout.
  const answered = (p, a) => {
    const then = answerFlowPrompt(p, a)
    if (then?.kind === 'pay') pay({ ...then.opts, flowsAsked: true })
  }
  // A swipe's button: an item not sent yet comes off (Undo puts it back);
  // one the kitchen has opens the void window (a reason is needed).
  const swipeAction = async line => {
    if (line.status !== 'new') return setModal({ kind: 'line', line, initialMode: 'void' })
    // A dish a flow put on as one staff can't take off: a manager every time.
    const [label, actions] = offApproval(line, 'Taking items off needs a manager here.', ['delete_unsent'])
    const approver = await approve(null, null, label, actions)
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
  // { tender } opens Pay with that tender picked (a layout's buttons). The
  // prompts due at checkout come first (each once per order); Pay opens when
  // they are answered (flowsAsked).
  const pay = (opts = {}) => {
    if (needDetails()) return
    if (!opts.flowsAsked && queueFlowPrompts(check.id, 'checkout', { then: { kind: 'pay', opts }, shownIds })) return
    // What the kitchen hasn't been told yet (items not sent, courses
    // waiting): a table-service till that asks says so first; one set to
    // send does it as the check is paid (PayModal sendOnClose), as counter
    // tills always do.
    if (!opts.unsentAsked && !isCounter && unsentAtPay(config) === 'ask') {
      const nf = notFired(currentChecks()[check.id] || check)
      if (nf.unsent || nf.held.length) return setModal({ kind: 'unsent', opts: { ...opts, flowsAsked: true } })
    }
    refreshPromotions(check.id)
    setModal({ kind: 'pay', ...opts })
  }
  const fire = () => (held.length ? setModal({ kind: 'fire' }) : toast('No course is waiting to fire', 'bad'))
  actions.current = { pay, send, fire }
  // Send on a counter till only when its setting shows it (Store tech > Tills).
  const showSend = !isCounter || counterSends(config)
  // How many of each dish are on the order (the till's Item counts on buttons).
  const counts = showsItemCounts(config) ? itemCounts(check) : null
  // With the counts on, a dish on the order can come off from its own button.
  const takeOff = counts && takesOffCounted(config)
    ? { run: takeOneOff, label: item => (lineToTakeOff(check, item.id)?.status === 'new' ? 'Take one off' : 'Void one') }
    : null
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
      {!hidden.has('back') && <button className="btn btn-ghost w-12 px-0" onClick={() => leave()} aria-label="Back" data-testid="check-back"><ArrowLeft size={22} /></button>}
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
    !hidden.has('send') && showSend && (held.length > 0 && !unsent
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
    </>} footer={footer} font={orderZone?.font || null} onLine={line => setModal({ kind: 'line', line })} onAction={swipeAction} onEdit={changeOptions} onRegroup={regroup}
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
      case 'fire': return fire()
      case 'more': return setModal({ kind: 'actions' })
      case 'guests': return isCounter ? toast('Counter orders have no guests', 'bad') : setModal({ kind: 'covers' })
      case 'order_type': return setModal({ kind: 'type' })
      case 'name': return setModal({ kind: 'name' })
      case 'tent': return setModal({ kind: 'tent' })
      case 'allergy': return setModal({ kind: 'allergy' })
      case 'table': return isCounter ? toast('Counter orders don\'t go on a table', 'bad')
        : tablesOn(config) || check.table_id ? setModal({ kind: 'table' }) : toast('This till doesn\'t use tables', 'bad')
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
      case 'back': return leave()
      case 'menus': return setModal({ kind: 'menus' })
      case 'till_menu': return nav.openMenu()
      case 'sign_out': return leave(signOut)
      default: return null
    }
  }

  return (
    <div className="h-full flex">
      {layout ? (
        <div className="flex-1 min-w-0">
          <LayoutScreen layout={layout} config={config} check={check} checkZone={panel} menus={shownMenus.shown} tillMenus={shownMenus.menus} shownMenus={shownMenus} covers={check.covers} counts={counts}
            seat={seat} setSeat={setSeat} course={course} setCourse={setCourse}
            onDish={pick} onHold={item => setModal({ kind: 'sold_out', item })} takeOff={takeOff} onButton={runButton}
            choosing={choosing}
            onChosen={o => (choosing.edit ? changed(choosing.edit, choosing.item, { selection: o.selection, qty: o.qty }) : added(choosing.item, { ...o, seat, course }))}
            onCancelChoosing={() => setChoosing(null)}
            onMoreChoices={initial => {
              if (!choosing.edit) return setModal({ kind: 'item', item: choosing.item, initial })
              const line = (currentChecks()[check.id] || check).lines.find(l => l.id === choosing.edit)
              setChoosing(null)
              setModal({ kind: 'item', item: choosing.item, initial: { ...(line ? lineFields(line) : {}), ...initial }, edit: choosing.edit, title: line ? 'Change ' + line.name : null })
            }} />
        </div>
      ) : (
        <>
          <div className="w-[42%] max-w-[480px] min-w-[320px] shrink-0">{panel}</div>
          <div className="flex-1 min-w-0">
            <MenuPanel config={config} menus={shownMenus.shown} onPick={pick} onHold={item => setModal({ kind: 'sold_out', item })} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse} parts={barParts}
              covers={check.covers} counts={counts} takeOff={takeOff} onOpenItem={() => setModal({ kind: 'open_item' })} />
          </div>
        </>
      )}

      {modal?.kind === 'item' && <ItemModal item={modal.item} config={config} defaults={{ seat: modal.seat ?? seat, course: modal.course ?? course, covers: check.covers, parts: lineParts }}
        initial={modal.initial || null} title={modal.title || null} actionLabel={modal.edit ? 'Update' : 'Add'} onClose={() => { modal.flowDone?.(false); close() }}
        onAdd={o => (modal.edit ? changed(modal.edit, modal.item, o) : modal.flowDone ? flowChosen(modal, o) : added(modal.item, o, modal.replace || null))} />}
      {modal?.kind === 'line' && (
        <LineModal check={check} line={check.lines.find(l => l.id === modal.line.id) || modal.line} config={config} parts={lineParts} onClose={close} initialMode={modal.initialMode || null} initialVoidQty={modal.voidQty || null}
          onChangeOptions={changeOptions}
          onDiscount={ids => setModal({ kind: 'discount', lineIds: ids })} onMove={ids => setModal({ kind: 'move', lineIds: ids })}
          onMakeCombo={(line, combo, start) => setModal({
            kind: 'item', item: combo, title: line.name + ' as ' + combo.name, replace: line.id, seat: line.seat ?? null, course: line.course_id ?? null,
            initial: { selection: comboStartFrom(line, start, combo, config), qty: line.qty },
          })} />
      )}
      {modal?.kind === 'actions' && <ActionsMenu check={check} config={config} menus={shownMenus} onClose={close} onPick={action} />}
      {modal?.kind === 'menus' && <MenusModal shown={shownMenus} onClose={close} />}
      {modal?.kind === 'send' && <SendModal check={check} config={config} onClose={close} onSent={() => { close(); toast('Sent to the kitchen', 'ok'); if (modal.then) return modal.then(); if (!counter) onBack() }} />}
      {modal?.kind === 'leave' && <LeaveModal check={check} onClose={close} onLeave={() => { close(); modal.proceed() }} onSend={() => sendAndLeave(modal.proceed)} />}
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
      {modal?.kind === 'unsent' && <UnsentModal check={check} config={config} onClose={close} onPay={() => pay({ ...modal.opts, unsentAsked: true })} />}
      {modal?.kind === 'pay' && <PayModal check={check} sendOnClose={isCounter || unsentAtPay(config) === 'send'} autoExact={modal.autoExact || null} initialTender={modal.tender || null}
        onClose={close} onClosed={() => { close(); onBack() }} />}
      {/* An order flow's prompt, on top of everything; it steps aside while a
          dish it offers has its choices window open. */}
      {prompts[0] && (
        <FlowPrompt key={prompts[0].id} prompt={prompts[0]} config={config} shownIds={shownIds}
          paused={modal?.kind === 'item' && !!modal.flowDone}
          onDish={flowDish} onDone={a => answered(prompts[0], a)} />
      )}
    </div>
  )
}

export { cx }
