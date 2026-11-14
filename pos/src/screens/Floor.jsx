// The floor of a table-service till: rooms (floor areas) with their tables
// where Store tech placed them, coloured by what is happening there; open
// tabs on the right. Tap a free table to open a check, a busy one to go to
// it. Counter orders belong to counter tills and aren't listed here (Store
// tech > Tills: a till is table service or counter service, never both).
//
// A till set to show no tables (Store tech > Tills, Tables: off) has only the
// list: tabs and orders.
//
// On a phone-sized screen (useNarrow()) the two halves are two tabs, Tables
// and Tabs and orders, each the full width, and a room shows its tables as
// tiles in the order of their names instead of the plan (a plan scaled to a
// phone's width leaves tables too small to tap). With the till's On a phone:
// List (phoneTablesList), tables are rows instead, and the row of any check
// can be swiped: left sends what is new to the kitchen (or fires the course
// waiting), right pays.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Users, Hourglass, ReceiptText, Send, Flame, CreditCard } from 'lucide-react'
import { useTill, useChecks, toast, serverName, dispatch } from '../lib/store.js'
import {
  openCheck, defaultStreamId, typeOf, streamTypes, defaultTypeId, promptsFor, orderPromptOf, coversOf,
  tablesOn, phoneTablesList, notFired, sendCheck, needsSendChoice, missingDetails, coversMissing,
} from '../lib/checkOps.js'
import { useNarrow } from '../lib/tillLayout.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { Modal, Keypad, cx, money, elapsed, useTick } from '../components/ui.jsx'
import OrderPrompt from '../components/OrderPrompt.jsx'

const LIST = '__list'
const SWIPE_START = 12 // px sideways before a press counts as a swipe

export default function Floor({ onOpen }) {
  const { config, staff } = useTill()
  const checks = useChecks()
  useTick(30000)
  const areas = config.floor_areas || []
  const placed = new Set((config.tables || []).filter(t => t.floor_area_id && areas.some(a => a.id === t.floor_area_id)).map(t => t.id))
  const unplaced = (config.tables || []).filter(t => !placed.has(t.id))
  const defaultArea = config.device?.settings?.floor_area_id
  const [areaId, setAreaId] = useState(areas.some(a => a.id === defaultArea) ? defaultArea : areas[0]?.id || LIST)
  const [ask, setAsk] = useState(null)       // { table } covers / new check
  const [choose, setChoose] = useState(null) // { table, checks }
  const [newTab, setNewTab] = useState(false)
  // A phone: one half at a time.
  const narrow = useNarrow()
  const [pane, setPane] = useState('tables')
  // The till shows its tables (Store tech > Tills); off = tabs and orders only.
  const tables = tablesOn(config)
  // On a phone: rows to swipe instead of tiles (Store tech > Tills, On a phone).
  const rows = narrow && phoneTablesList(config)
  const swipe = useRowSwipe()

  // Counter orders are a counter till's: never on a table-service till's floor.
  const open = useMemo(() => Object.values(checks).filter(c => c.status === 'open' && c.mode !== 'counter'), [checks])
  const byTable = useMemo(() => {
    const m = {}
    for (const c of open) if (c.table_id) (m[c.table_id] ||= []).push(c)
    return m
  }, [open])

  const startTable = (table, covers) => {
    const r = openCheck({ mode: 'table', table_id: table.id, covers, revenue_stream_id: defaultStreamId(config, { areaId: table.floor_area_id }) })
    if (!r.ok) return toast(r.error, 'bad')
    setAsk(null)
    onOpen(r.checkId)
  }
  // A new check on a table: the guests asked first as its revenue stream
  // says (Store tech > Revenue streams, or the till's own choice): never,
  // with a Skip, or without one.
  const newOnTable = table => {
    const rule = coversOf(config, defaultStreamId(config, { areaId: table.floor_area_id }))
    if (rule === 'off') return startTable(table, null)
    setAsk({ table, skip: rule === 'ask' })
  }
  const tapTable = table => {
    const list = byTable[table.id] || []
    if (list.length === 1) return onOpen(list[0].id)
    if (list.length > 1) return setChoose({ table, checks: list })
    newOnTable(table)
  }

  // A row swiped left: what is new goes to the kitchen, else the course
  // waiting is fired. When the check needs something first (its details,
  // its guests, which courses wait, several courses to choose from) it opens
  // and does that, as its own Send or Fire button would.
  const swipeLeft = c => {
    const nf = notFired(c)
    if (nf.unsent) {
      if (missingDetails(c, config).length || coversMissing(c, config) || needsSendChoice(c, config)) return onOpen(c.id, 'send')
      const r = sendCheck(c, [])
      if (!r.ok) return toast(r.error, 'bad')
      return toast('Sent to the kitchen: ' + rowTitle(c, config), 'ok')
    }
    if (nf.held.length === 1) {
      const r = dispatch('course.fired', { course_id: nf.held[0] }, { check_id: c.id })
      if (!r.ok) return toast(r.error, 'bad')
      const course = (config.courses || []).find(x => x.id === nf.held[0])
      return toast('Fired ' + (course?.name || 'the course') + ': ' + rowTitle(c, config), 'ok')
    }
    if (nf.held.length > 1) return onOpen(c.id, 'fire')
    toast('Nothing to send or fire', 'info')
  }
  // Swiped right: the check opens straight into Pay (with what Pay asks first).
  const swipeRight = c => onOpen(c.id, 'pay')
  // A check's row: swipeable on a phone set to rows.
  const checkRow = (c, onClick) => (rows
    ? <SwipeCheckRow key={c.id} check={c} config={config} swipe={swipe} onClick={onClick} onLeft={() => swipeLeft(c)} onRight={() => swipeRight(c)} />
    : <CheckRow key={c.id} check={c} config={config} onClick={onClick} />)

  const area = areas.find(a => a.id === areaId)
  const tabs = open.filter(c => !c.table_id).sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const mine = open.filter(c => c.server_id === staff.id).length

  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true })
  const roomTables = area ? (config.tables || []).filter(t => t.floor_area_id === area.id).sort(byLabel) : areas.length ? unplaced : config.tables || []
  const tablesPane = (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="floor-tables">
      <div className="flex items-center gap-2 p-3 scroll-x">
        {areas.map(a => (
          <button key={a.id} className={cx('chip shrink-0', areaId === a.id && 'chip-on')} onClick={() => setAreaId(a.id)}>{a.name}</button>
        ))}
        {(unplaced.length > 0 || !areas.length) && (
          <button className={cx('chip shrink-0', areaId === LIST && 'chip-on')} onClick={() => setAreaId(LIST)}>{areas.length ? 'Other tables' : 'Tables'}</button>
        )}
        {!narrow && <div className="ml-auto text-sm text-muted shrink-0 pr-1">{open.length} open · {mine} yours</div>}
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3">
        {rows
          ? <TableRows tables={roomTables} byTable={byTable} config={config} onTap={tapTable} checkRow={checkRow} empty={area ? 'No tables in this room yet.' : null} />
          : area && !narrow
            ? <Plan area={area} tables={(config.tables || []).filter(t => t.floor_area_id === area.id)} byTable={byTable} onTap={tapTable} />
            : <TableGrid tables={roomTables} byTable={byTable} onTap={tapTable} empty={area ? 'No tables in this room yet.' : null} />}
      </div>
    </div>
  )
  const listPane = (
    <aside className={cx('bg-white flex flex-col min-h-0', narrow || !tables ? 'flex-1 min-w-0' : 'w-[300px] xl:w-[340px] shrink-0 border-l border-line')} data-testid="floor-list">
      <div className="p-3 border-b border-line flex items-center gap-2">
        <button className={cx('btn btn-primary', narrow || !tables ? 'flex-1 max-w-md' : 'flex-1')} onClick={() => setNewTab(true)} data-testid="new-tab"><Plus size={18} /> New tab</button>
        {!tables && !narrow && <div className="ml-auto text-sm text-muted shrink-0 pr-1">{open.length} open · {mine} yours</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {rows && open.length > 0 && <SwipeHint />}
        <div className="label px-1">Tabs and orders</div>
        {!tabs.length && <div className="text-sm text-muted px-1">No open tabs.</div>}
        {tabs.map(c => checkRow(c, () => onOpen(c.id)))}
        {open.some(c => c.table_id) && <div className="label px-1 pt-3">Tables</div>}
        {open.filter(c => c.table_id).map(c => checkRow(c, () => onOpen(c.id)))}
      </div>
    </aside>
  )

  return (
    <div className={cx('h-full flex', narrow && 'flex-col')} data-testid="floor" data-narrow={narrow ? '1' : '0'} data-tables={tables ? '1' : '0'} data-rows={rows ? '1' : '0'}>
      {!tables ? listPane : narrow ? (
        <>
          <div className="shrink-0 flex gap-2 p-2 bg-white border-b border-line" role="tablist">
            {[{ key: 'tables', label: 'Tables' }, { key: 'list', label: 'Tabs and orders' + (open.length ? ' (' + open.length + ')' : '') }].map(t => (
              <button key={t.key} role="tab" aria-selected={pane === t.key} onClick={() => setPane(t.key)} data-testid={'floor-tab-' + t.key}
                className={cx('flex-1 h-12 rounded-xl font-semibold touch-manipulation', pane === t.key ? 'bg-brand text-white' : 'bg-page')}>{t.label}</button>
            ))}
          </div>
          {pane === 'tables' ? tablesPane : listPane}
        </>
      ) : (
        <>{tablesPane}{listPane}</>
      )}

      {ask && (
        <CoversModal title={'Table ' + ask.table.label} max={ask.table.max_covers} onClose={() => setAsk(null)} onDone={n => startTable(ask.table, n)}
          onSkip={ask.skip ? () => startTable(ask.table, null) : null} />
      )}
      {choose && (
        <Modal title={'Table ' + choose.table.label} onClose={() => setChoose(null)}>
          <div className="space-y-2">
            {choose.checks.map(c => checkRow(c, () => { setChoose(null); onOpen(c.id) }))}
            <button className="btn w-full" onClick={() => { const t = choose.table; setChoose(null); newOnTable(t) }}>
              <Plus size={18} /> Another check on this table
            </button>
          </div>
        </Modal>
      )}
      {newTab && <NewTabModal onClose={() => setNewTab(false)} onOpen={id => { setNewTab(false); onOpen(id) }} />}
    </div>
  )
}

function tableState(list) {
  if (!list?.length) return 'free'
  if (list.some(c => c.billed)) return 'billed'
  if (list.some(c => heldCourses(c).length)) return 'held'
  return 'open'
}
const STATE_STYLE = {
  free:   'bg-white border-line text-ink',
  open:   'bg-brand text-white border-brand-dark',
  held:   'bg-held text-white border-held',
  billed: 'bg-warn text-white border-warn',
}

function TableTile({ table, list, style, onTap, compact = false }) {
  const state = tableState(list)
  const c = list?.[0]
  const total = (list || []).reduce((s, x) => s + checkTotals(x).total, 0)
  const covers = (list || []).reduce((s, x) => s + (Number(x.covers) || 0), 0)
  return (
    <button onClick={() => onTap(table)} style={style}
      className={cx('border-2 flex flex-col items-center justify-center text-center touch-manipulation active:scale-[0.97] transition-transform shadow-sm overflow-hidden',
        table.shape === 'round' ? 'rounded-full' : 'rounded-2xl', STATE_STYLE[state])}>
      <div className={cx('font-bold leading-none', compact ? 'text-lg' : 'text-xl')}>{table.label}</div>
      {c ? (
        <div className="text-[12px] leading-tight mt-1 opacity-95 font-semibold">
          <div>{money(total)}</div>
          <div className="flex items-center justify-center gap-1">{covers ? <><Users size={11} />{covers}</> : null} {elapsed(c.opened_at)}</div>
          {list.length > 1 && <div>{list.length} checks</div>}
        </div>
      ) : (
        <div className="text-[12px] text-muted mt-1">{table.max_covers} seats</div>
      )}
    </button>
  )
}

function Plan({ area, tables, byTable, onTap }) {
  const box = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const scale = Math.max(8, Math.min(size.w / area.width, size.h / area.height))
  return (
    <div ref={box} className="w-full h-full">
      <div className="relative mx-auto rounded-2xl bg-white border border-line" style={{ width: area.width * scale, height: area.height * scale }}>
        {(area.decor || []).map(d => (
          <div key={d.id} className={cx('absolute flex items-center justify-center text-xs font-semibold text-muted pointer-events-none',
            d.kind === 'wall' ? 'bg-slate-400' : d.kind === 'bar' ? 'bg-amber-100 border border-amber-300 rounded-lg' : d.kind === 'plant' ? 'bg-green-100 rounded-full' : '')}
            style={{ left: d.x * scale, top: d.y * scale, width: d.w * scale, height: d.h * scale }}>{d.text}</div>
        ))}
        {tables.map(t => {
          const turned = t.rotation === 90 || t.rotation === 270
          const w = (turned ? t.h : t.w) || 3, h = (turned ? t.w : t.h) || 3
          return (
            <TableTile key={t.id} table={t} list={byTable[t.id]} onTap={onTap}
              compact={Math.min(w, h) * scale < 70}
              style={{ position: 'absolute', left: (t.x || 0) * scale, top: (t.y || 0) * scale, width: w * scale, height: h * scale }} />
          )
        })}
      </div>
    </div>
  )
}

const NO_TABLES = 'No tables yet. Add tables in Macaroonie (Tables) and place them on the floor plan (Store tech, Floor plan).'

function TableGrid({ tables, byTable, onTap, empty = null }) {
  if (!tables.length) return <div className="card p-6 text-muted">{empty || NO_TABLES}</div>
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {tables.map(t => <TableTile key={t.id} table={t} list={byTable[t.id]} onTap={onTap} style={{ height: 110 }} />)}
      </div>
    </div>
  )
}

/**
 * A phone's tables as rows (the till's On a phone: List), in the order of
 * their names: a free table opens a check when tapped; a table with one
 * check is that check's row, which swipes; one with several says so and,
 * tapped, lists them (each of those swipes too).
 */
function TableRows({ tables, byTable, config, onTap, checkRow, empty = null }) {
  if (!tables.length) return <div className="card p-6 text-muted">{empty || NO_TABLES}</div>
  return (
    <div className="h-full overflow-y-auto space-y-2" data-testid="table-rows">
      {tables.map(t => {
        const list = byTable[t.id] || []
        if (list.length === 1) return checkRow(list[0], () => onTap(t))
        const total = list.reduce((s, x) => s + checkTotals(x).total, 0)
        const state = tableState(list)
        return (
          <button key={t.id} onClick={() => onTap(t)} data-testid="table-row" data-table={t.id} data-state={state}
            className="w-full card p-3 flex items-center gap-3 text-left touch-manipulation active:bg-page">
            <div className={cx('w-12 h-12 border-2 flex items-center justify-center font-bold shrink-0', t.shape === 'round' ? 'rounded-full' : 'rounded-xl', STATE_STYLE[state])}>{t.label}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">Table {t.label}</div>
              <div className="text-xs text-muted truncate">{list.length ? list.length + ' checks' : 'Free · ' + t.max_covers + ' seats'}</div>
            </div>
            {list.length > 0 && <div className="font-bold tabular-nums shrink-0">{money(total)}</div>}
          </button>
        )
      })}
    </div>
  )
}

/** What a check's row is called: its table, its name, its order number, else Tab T2-4. */
export function rowTitle(check, config) {
  const table = check.table_id ? (config.tables || []).find(x => x.id === check.table_id) : null
  if (table) return 'Table ' + table.label
  return check.tab_name || (check.order_no != null ? 'Order #' + check.order_no : 'Tab ' + checkLabel(check))
}

/**
 * A check in a list: what it is (table, name, order number), its order type,
 * tent, server, guests and age, its total and what is paid. buttonProps go on
 * the row's button (a swipe's pointer events and its shift).
 */
export function CheckRow({ check, config, onClick, active = false, buttonProps = null }) {
  const t = checkTotals(check)
  const table = check.table_id ? (config.tables || []).find(x => x.id === check.table_id) : null
  const server = { name: serverName(config, check.server_id) }
  const held = heldCourses(check).length
  return (
    <button onClick={onClick} {...buttonProps} data-testid="check-row" data-check={check.id}
      className={cx('w-full card p-3 flex items-center gap-3 text-left touch-manipulation active:bg-page', active && 'ring-2 ring-brand', buttonProps?.className)}>
      <div className={cx('w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0',
        check.billed ? 'bg-warn text-white' : held ? 'bg-held text-white' : 'bg-brand-soft text-brand')}>
        {table ? table.label : check.order_no != null ? '#' + check.order_no : <ReceiptText size={20} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{rowTitle(check, config)}</div>
        <div className="text-xs text-muted truncate">
          {[typeOf(config, check.order_type_id)?.name, check.tent ? 'Tent ' + check.tent : null, server?.name, check.covers ? check.covers + ' covers' : null, elapsed(check.opened_at)].filter(Boolean).join(' · ')}
          {held ? <span className="text-held font-semibold"> · <Hourglass size={11} className="inline" /> waiting</span> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold tabular-nums">{money(t.total)}</div>
        {t.paid > 0 && <div className="text-xs text-ok font-semibold">{money(t.paid)} paid</div>}
      </div>
    </button>
  )
}

/** One line above swipeable rows saying what a swipe does. */
function SwipeHint() {
  return (
    <div className="text-xs text-muted px-1 flex items-center gap-3 flex-wrap" data-testid="swipe-hint">
      <span className="inline-flex items-center gap-1"><CreditCard size={13} /> Swipe right to pay</span>
      <span className="inline-flex items-center gap-1"><Send size={13} /> Swipe left to send or fire</span>
    </div>
  )
}

/**
 * A check's row that swipes (a phone set to rows): drag it right to pay,
 * left to send what is new (or fire the course waiting). What a swipe will do
 * shows behind the row as it moves; let go past the line to do it. A tap
 * still opens the check.
 */
function SwipeCheckRow({ check, config, swipe, onClick, onLeft, onRight }) {
  const nf = notFired(check)
  const left = nf.unsent ? 'send' : nf.held.length ? 'fire' : null
  const dx = swipe.shiftOf(check.id)
  return (
    <div className="relative rounded-2xl overflow-hidden" data-row={check.id} data-testid="swipe-row" data-left={left || 'none'}>
      {dx > 0 && (
        <div className="absolute inset-0 bg-ok text-white flex items-center gap-2 pl-5 font-bold" aria-hidden data-testid="swipe-pay">
          <CreditCard size={22} /> Pay
        </div>
      )}
      {dx < 0 && (
        <div className={cx('absolute inset-0 flex items-center justify-end gap-2 pr-5 font-bold', left ? 'bg-brand text-white' : 'bg-line text-muted')} aria-hidden data-testid="swipe-send">
          {left === 'fire' ? <><Flame size={22} /> Fire</> : left === 'send' ? <><Send size={22} /> Send</> : 'Nothing to send'}
        </div>
      )}
      <CheckRow check={check} config={config}
        onClick={() => { if (swipe.swallow(check.id)) return; onClick() }}
        buttonProps={{
          onPointerDown: e => swipe.down(e, check.id, { left: left ? onLeft : null, right: onRight }),
          style: { transform: dx ? `translateX(${dx}px)` : undefined, transition: swipe.isMoving(check.id) ? 'none' : 'transform 160ms ease-out', touchAction: 'pan-y' },
          className: 'relative select-none',
        }} />
    </div>
  )
}

/**
 * Swiping rows both ways, one row at a time: let go past the line (35% of
 * the row, at most 160 px) and the side's action runs; short of it, the row
 * springs back. A side with no action only gives a little.
 */
function useRowSwipe() {
  const [moving, setMoving] = useState(null) // { key, dx } while a finger moves a row
  const g = useRef(null)
  const swallowed = useRef(null)
  const end = useRef(null)
  useEffect(() => () => end.current?.(), [])

  const down = (e, key, act) => {
    if (e.button > 0) return
    const row = e.currentTarget.closest('[data-row]')
    const s = { key, x: e.clientX, y: e.clientY, pid: e.pointerId, swiping: false, width: row?.offsetWidth || 360, target: e.currentTarget }
    g.current = s
    const clamp = dx => {
      const lim = s.width * 0.9
      let v = Math.max(-lim, Math.min(lim, dx))
      if (v < 0 && !act.left) v = Math.max(v, -24)
      if (v > 0 && !act.right) v = Math.min(v, 24)
      return v
    }
    const move = ev => {
      if (ev.pointerId !== s.pid || g.current !== s) return
      const dx = ev.clientX - s.x
      const dy = ev.clientY - s.y
      if (!s.swiping) {
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) >= Math.abs(dx)) return finish()
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.2) return
        s.swiping = true
        try { s.target.setPointerCapture(s.pid) } catch { /* not every pointer can be captured */ }
      }
      setMoving({ key, dx: clamp(dx) })
    }
    const up = ev => {
      if (ev.pointerId !== s.pid) return
      if (s.swiping) {
        // The click this swipe ends with isn't a tap on the row.
        swallowed.current = key
        const dx = clamp(ev.clientX - s.x)
        const need = Math.min(s.width * 0.35, 160)
        setMoving(null)
        if (dx <= -need && act.left) act.left()
        else if (dx >= need && act.right) act.right()
      }
      finish()
    }
    const cancel = ev => { if (ev.pointerId === s.pid) { setMoving(null); finish() } }
    function finish() {
      if (g.current === s) g.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      end.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    end.current = finish
  }
  return {
    down,
    shiftOf: key => (moving?.key === key ? moving.dx : 0),
    isMoving: key => moving?.key === key,
    swallow: key => { if (swallowed.current === key) { swallowed.current = null; return true } return false },
  }
}

/**
 * How many guests: quick numbers or the keypad. onSkip: a Skip button (the
 * stream's covers are 'ask'; with 'must' there is none). doneLabel: the big
 * button's words.
 */
export function CoversModal({ title, max, onClose, onDone, onSkip = null, initial = '', doneLabel = 'Open check' }) {
  const [v, setV] = useState(String(initial || ''))
  const quick = [1, 2, 3, 4, 5, 6, 8].filter(n => !max || n <= Math.max(max, 6))
  return (
    <Modal title={title + ': how many guests?'} onClose={onClose}>
      <div className="grid grid-cols-4 gap-2 mb-4" data-testid="covers-quick">
        {quick.map(n => <button key={n} className="btn h-16 text-2xl font-bold" onClick={() => onDone(n)}>{n}</button>)}
      </div>
      <div className="text-center text-3xl font-bold h-10 tabular-nums">{v || ' '}</div>
      <Keypad value={v} onChange={setV} max={3} />
      <div className="flex gap-2 mt-3">
        {onSkip && <button className="btn h-14 flex-1" onClick={onSkip} data-testid="covers-skip">Skip</button>}
        <button className="btn btn-primary h-14 flex-[2]" disabled={!Number(v)} onClick={() => onDone(Number(v))} data-testid="covers-done">{doneLabel}</button>
      </div>
    </Modal>
  )
}

// A tab: a check without a table (bar tabs, people waiting, collections). It
// starts in the till's revenue stream; the order prompt asks its order type,
// its name (always offered: it is how the tab is found) and the tent number
// when the type asks for one; then how many guests, as a new table's check
// does (coversOf: never, with a Skip, or without one).
function NewTabModal({ onClose, onOpen }) {
  const { config } = useTill()
  const streamId = defaultStreamId(config)
  const types = streamTypes(config, streamId)
  const coversRule = coversOf(config, streamId)
  const [details, setDetails] = useState(null) // the prompt's answers, while the guests are asked
  const promptsOf = id => {
    const p = promptsFor(config, streamId, id)
    return { ask_name: p.ask_name === 'off' ? 'ask' : p.ask_name, ask_tent: p.ask_tent }
  }
  const start = ({ typeId, name, tent }, covers = null) => {
    const r = openCheck({ mode: 'tab', tab_name: name || null, revenue_stream_id: streamId, order_type_id: typeId, tent: tent || null, covers })
    if (!r.ok) return toast(r.error, 'bad')
    onOpen(r.checkId)
  }
  const answered = a => (coversRule === 'off' ? start(a) : setDetails(a))
  if (details) {
    return (
      <CoversModal title={details.name || 'New tab'} onClose={onClose} doneLabel="Open tab"
        onDone={n => start(details, n)} onSkip={coversRule === 'ask' ? () => start(details) : null} />
    )
  }
  return (
    <OrderPrompt title="New tab" types={types} typeId={defaultTypeId(config, streamId)} promptsOf={promptsOf}
      style={orderPromptOf(config)} doneLabel={coversRule === 'off' ? 'Open tab' : 'Next'} onDone={answered} onClose={onClose}
      noteFor={() => 'A tab is a check without a table: bar tabs, people waiting, collections.'} />
  )
}
