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
// can be swiped: left sends what is new to the kitchen or fires the course
// waiting (the till's Swipe left says which comes first), always asking
// first in the Send or Fire window, so a swipe made by mistake does nothing;
// right pays.
//
// Combined tables (shared/pos/tables.js): a party across several tables is
// one check. Its tables show as one party: the same colour, a ring and a
// link mark with "4 + 5" on each, a line between them on the plan, and the
// total, guests and timer on the main table only; a tap on any of them opens
// the check. In the lists it is one entry, "Tables 4 + 5". Combine tables
// (above the tables) is a mode: tap the party's tables, then Combine. Free
// tables open one check holding them all; a table with an open order takes
// the others, and a second order among them is merged in after one question.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Users, Hourglass, ReceiptText, Send, Flame, CreditCard, Link2, X } from 'lucide-react'
import { useTill, useChecks, toast, serverName } from '../lib/store.js'
import {
  openCheck, defaultStreamId, typeOf, streamTypes, defaultTypeId, promptsFor, orderPromptOf, coversOf,
  tablesOn, phoneTablesList, swipeLeftAction, missingDetails, coversMissing,
  checksByTable, combineChanges, combinationsWith, tableTitleOf,
} from '../lib/checkOps.js'
import { useNarrow } from '../lib/tillLayout.js'
import { useRowSwipe } from '../lib/rowSwipe.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { joinedTables, tablesOf, tableLabel } from '@shared/pos/tables.js'
import { Modal, Keypad, cx, money, elapsed, useTick, useApproval } from '../components/ui.jsx'
import { CombineConfirm, runCombine } from '../components/CombineModal.jsx'
import OrderPrompt from '../components/OrderPrompt.jsx'
import { SendModal, FireModal } from '../components/CheckActions.jsx'

const LIST = '__list'

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
  const [confirm, setConfirm] = useState(null) // { kind: 'send' | 'fire', checkId }: a row swiped left asks first
  // Combine tables: the tables tapped so far, in order (null = not combining),
  // and the question before another order is merged in.
  const [combine, setCombine] = useState(null)
  const [merging, setMerging] = useState(null) // { check, changes }
  const approve = useApproval()
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
  // By every table a check holds: a joined table shows its party's check.
  const byTable = useMemo(() => checksByTable(open), [open])

  // join: more tables for the new check to hold (free tables combined before ordering).
  const startTable = (table, covers, join = []) => {
    const r = openCheck({ mode: 'table', table_id: table.id, covers, revenue_stream_id: defaultStreamId(config, { areaId: table.floor_area_id }), join_table_ids: join })
    if (!r.ok) return toast(r.error, 'bad')
    setAsk(null)
    onOpen(r.checkId)
  }
  // A new check on a table: the guests asked first as its revenue stream
  // says (Store tech > Revenue streams, or the till's own choice): never,
  // with a Skip, or without one.
  const newOnTable = (table, join = []) => {
    const rule = coversOf(config, defaultStreamId(config, { areaId: table.floor_area_id }))
    if (rule === 'off') return startTable(table, null, join)
    setAsk({ table, skip: rule === 'ask', join })
  }

  // Combine tables: a tap picks a table, or lets it go. A table of a party
  // already combined brings its party's other tables with it.
  const pickTable = table => {
    const party = [...new Set([table.id, ...(byTable[table.id] || []).flatMap(tablesOf)])]
    setCombine(c => (c.includes(table.id) ? c.filter(id => !party.includes(id)) : [...c, ...party.filter(id => !c.includes(id))]))
  }
  // Combine: the first table picked with an open order keeps its order and
  // takes the other tables (their orders merged in, after the question);
  // with no order among them, one new check opens on the first table and
  // holds the rest.
  const finishCombine = async () => {
    const ids = combine || []
    if (ids.length < 2) return toast('Tap two or more tables to combine', 'info')
    const holders = []
    for (const id of ids) for (const c of byTable[id] || []) if (!holders.includes(c)) holders.push(c)
    if (!holders.length) {
      const table = (config.tables || []).find(t => t.id === ids[0])
      setCombine(null)
      return newOnTable(table, ids.slice(1))
    }
    const check = holders[0]
    const changes = combineChanges(check, [...joinedTables(check), ...ids], checks)
    if (!changes.join.length) return toast('Those tables are one party already', 'info')
    if (changes.blocked.length) return toast((tableTitleOf(changes.blocked[0], config) || 'A table') + ' is part paid: move its items instead', 'bad')
    if (changes.merge.length) return setMerging({ check, changes })
    if (await runCombine(check, changes, config, approve)) setCombine(null)
  }

  const tapTable = table => {
    if (combine) return pickTable(table)
    const list = byTable[table.id] || []
    if (list.length === 1) return onOpen(list[0].id)
    if (list.length > 1) return setChoose({ table, checks: list })
    newOnTable(table)
  }

  // A row swiped left asks first, always (a swipe is easy to make by
  // mistake): the Send window for what is new, the Fire window for a course
  // waiting, even when there is only one. The till's Swipe left says which
  // comes first when a check has both. When the check needs something before
  // it can go (its details, its guests) it opens and does that, as its own
  // Send button would.
  const swipeLeft = c => {
    const act = swipeLeftAction(c, config)
    if (!act) return toast('Nothing to send or fire', 'info')
    if (act === 'send' && (missingDetails(c, config).length || coversMissing(c, config))) return onOpen(c.id, 'send')
    setConfirm({ kind: act, checkId: c.id })
  }
  // Swiped right: the check opens straight into Pay (with what Pay asks first).
  const swipeRight = c => onOpen(c.id, 'pay')
  // A check's row: swipeable on a phone set to rows.
  const checkRow = (c, onClick) => (rows
    ? <SwipeCheckRow key={c.id} check={c} config={config} swipe={swipe} onClick={onClick} onLeft={() => swipeLeft(c)} onRight={() => swipeRight(c)} />
    : <CheckRow key={c.id} check={c} config={config} onClick={onClick} />)

  // The swiped check as it is now (another till may change it while the
  // window is up); closed or gone, the window goes.
  const confirmCheck = confirm ? open.find(c => c.id === confirm.checkId) || null : null
  useEffect(() => { if (confirm && !confirmCheck) setConfirm(null) }, [confirm, confirmCheck])

  const area = areas.find(a => a.id === areaId)
  const tabs = open.filter(c => !c.table_id).sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const mine = open.filter(c => c.server_id === staff.id).length

  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true })
  const roomTables = area ? (config.tables || []).filter(t => t.floor_area_id === area.id).sort(byLabel) : areas.length ? unplaced : config.tables || []
  const allTables = config.tables || []
  const picked = combine || []
  // While combining: bookings' combinations with a table picked, not picked whole yet.
  const suggested = [...new Map(picked.flatMap(id => combinationsWith(config, id)).map(x => [x.id, x])).values()].filter(x => x.table_ids.some(id => !picked.includes(id)))
  const canCombine = allTables.length > 1
  const tablesPane = (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="floor-tables" data-combining={combine ? '1' : '0'}>
      <div className="flex items-center gap-2 p-3 scroll-x">
        {areas.map(a => (
          <button key={a.id} className={cx('chip shrink-0', areaId === a.id && 'chip-on')} onClick={() => setAreaId(a.id)}>{a.name}</button>
        ))}
        {(unplaced.length > 0 || !areas.length) && (
          <button className={cx('chip shrink-0', areaId === LIST && 'chip-on')} onClick={() => setAreaId(LIST)}>{areas.length ? 'Other tables' : 'Tables'}</button>
        )}
        {canCombine && !combine && (
          <button className="chip shrink-0 ml-auto inline-flex items-center gap-1.5" onClick={() => setCombine([])} data-testid="combine-start"><Link2 size={16} /> Combine tables</button>
        )}
        {!narrow && <div className={cx('text-sm text-muted shrink-0 pr-1', (!canCombine || combine) && 'ml-auto')}>{open.length} open · {mine} yours</div>}
      </div>
      {combine && (
        <div className="mx-3 mb-3 rounded-2xl bg-ink text-white p-3 flex items-center gap-2 flex-wrap" data-testid="combine-bar">
          <Link2 size={20} className="shrink-0" />
          <div className="flex-1 min-w-[160px]">
            <div className="font-semibold" data-testid="combine-picked">
              {picked.length ? 'Tables ' + picked.map(id => allTables.find(t => t.id === id)?.label).filter(Boolean).join(' + ') : 'Combine tables'}
            </div>
            <div className="text-xs opacity-80">Tap the tables one party sits at, then Combine.</div>
          </div>
          {suggested.map(x => (
            <button key={x.id} className="chip shrink-0 text-ink" data-testid="combine-suggestion"
              onClick={() => setCombine(c => [...c, ...x.table_ids.filter(id => !c.includes(id))])}>{x.name}</button>
          ))}
          <div className="flex gap-2 shrink-0 ml-auto">
            <button className="btn h-12" onClick={() => setCombine(null)} data-testid="combine-cancel"><X size={18} /> Cancel</button>
            <button className="btn btn-primary h-12" disabled={picked.length < 2} onClick={finishCombine} data-testid="combine-go">Combine</button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 px-3 pb-3">
        {rows
          ? <TableRows tables={roomTables} byTable={byTable} config={config} onTap={tapTable} checkRow={checkRow} picked={combine} empty={area ? 'No tables in this room yet.' : null} />
          : area && !narrow
            ? <Plan area={area} tables={allTables.filter(t => t.floor_area_id === area.id)} allTables={allTables} byTable={byTable} open={open} onTap={tapTable} picked={combine} />
            : <TableGrid tables={roomTables} allTables={allTables} byTable={byTable} onTap={tapTable} picked={combine} empty={area ? 'No tables in this room yet.' : null} />}
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
        {rows && open.length > 0 && <SwipeHint fireFirst={config.device?.settings?.swipe_left === 'fire'} />}
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
        <CoversModal title={tableTitleOf({ table_id: ask.table.id, joined_table_ids: ask.join || [] }, config)} max={ask.join?.length ? null : ask.table.max_covers}
          onClose={() => setAsk(null)} onDone={n => startTable(ask.table, n, ask.join)}
          onSkip={ask.skip ? () => startTable(ask.table, null, ask.join) : null} />
      )}
      {merging && (
        <CombineConfirm check={merging.check} changes={merging.changes} config={config} onClose={() => setMerging(null)}
          onConfirm={async () => { if (await runCombine(merging.check, merging.changes, config, approve)) { setMerging(null); setCombine(null) } }} />
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
      {confirmCheck && confirm.kind === 'send' && (
        <SendModal check={confirmCheck} config={config} cancel title={'Send to the kitchen: ' + rowTitle(confirmCheck, config)}
          onClose={() => setConfirm(null)}
          onSent={() => { setConfirm(null); toast('Sent to the kitchen: ' + rowTitle(confirmCheck, config), 'ok') }} />
      )}
      {confirmCheck && confirm.kind === 'fire' && (
        <FireModal check={confirmCheck} config={config} cancel title={'Fire a course: ' + rowTitle(confirmCheck, config)}
          where={rowTitle(confirmCheck, config)} onClose={() => setConfirm(null)} />
      )}
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

// The ring round every table of a combined party, in its state's colour.
const PARTY_RING = { open: 'ring-brand', held: 'ring-held', billed: 'ring-warn' }

/**
 * A table on the floor. list: the open checks holding it. A table joined to
 * a party (not its main table) says who it is with and leaves the total,
 * guests and timer to the main table. picked: its place among the tables
 * tapped in Combine tables (0 = not picked), or null when not combining.
 */
function TableTile({ table, list, allTables, style, onTap, compact = false, picked = null }) {
  const state = tableState(list)
  // Checks whose main table this is, and the party it is joined to.
  const own = (list || []).filter(x => x.table_id === table.id)
  const c = own[0]
  const party = (list || []).find(x => joinedTables(x).length)
  const total = own.reduce((s, x) => s + checkTotals(x).total, 0)
  const covers = own.reduce((s, x) => s + (Number(x.covers) || 0), 0)
  return (
    <button onClick={() => onTap(table)} style={style} data-testid="table-tile" data-table={table.id} data-label={table.label} data-state={state}
      data-party={party ? tableLabel(party, allTables) : ''} data-main={party ? (party.table_id === table.id ? '1' : '0') : ''} data-picked={picked ? String(picked) : ''}
      className={cx('relative border-2 flex flex-col items-center justify-center text-center touch-manipulation active:scale-[0.97] transition-transform shadow-sm',
        table.shape === 'round' ? 'rounded-full' : 'rounded-2xl', STATE_STYLE[state],
        picked ? 'ring-4 ring-offset-2 ring-ink' : party && 'ring-2 ring-offset-2 ' + PARTY_RING[state])}>
      {picked ? <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-ink text-white text-sm font-bold flex items-center justify-center shadow">{picked}</span> : null}
      <div className={cx('font-bold leading-none', compact ? 'text-lg' : 'text-xl')}>{table.label}</div>
      {party && (
        <div className="text-[11px] leading-tight mt-1 font-semibold inline-flex items-center gap-0.5 max-w-full px-1" data-testid="table-party">
          <Link2 size={11} className="shrink-0" /><span className="truncate">{tableLabel(party, allTables)}</span>
        </div>
      )}
      {c ? (
        <div className="text-[12px] leading-tight mt-0.5 opacity-95 font-semibold">
          <div>{money(total)}</div>
          <div className="flex items-center justify-center gap-1">{covers ? <><Users size={11} />{covers}</> : null} {elapsed(c.opened_at)}</div>
          {own.length > 1 && <div>{own.length} checks</div>}
        </div>
      ) : !list?.length ? (
        <div className="text-[12px] text-muted mt-1">{table.max_covers} seats</div>
      ) : null}
    </button>
  )
}

const placeOf = (picked, id) => (picked ? picked.indexOf(id) + 1 : null)

function Plan({ area, tables, allTables, byTable, open, onTap, picked = null }) {
  const box = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const scale = Math.max(8, Math.min(size.w / area.width, size.h / area.height))
  const boxOf = t => {
    const turned = t.rotation === 90 || t.rotation === 270
    const w = (turned ? t.h : t.w) || 3, h = (turned ? t.w : t.h) || 3
    return { left: (t.x || 0) * scale, top: (t.y || 0) * scale, width: w * scale, height: h * scale, small: Math.min(w, h) * scale < 70 }
  }
  // A line from a combined party's main table to each table joined to it
  // (the ones in this room), in the party's colour.
  const here = new Map(tables.map(t => [t.id, boxOf(t)]))
  const mid = b => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 })
  const links = (open || []).flatMap(c => {
    const from = here.get(c.table_id)
    if (!from) return []
    const state = tableState(byTable[c.table_id])
    return joinedTables(c).filter(id => here.has(id)).map(id => ({ key: c.id + id, a: mid(from), b: mid(here.get(id)), state }))
  })
  return (
    <div ref={box} className="w-full h-full">
      <div className="relative mx-auto rounded-2xl bg-white border border-line" style={{ width: area.width * scale, height: area.height * scale }} data-testid="floor-plan">
        {(area.decor || []).map(d => (
          <div key={d.id} className={cx('absolute flex items-center justify-center text-xs font-semibold text-muted pointer-events-none',
            d.kind === 'wall' ? 'bg-slate-400' : d.kind === 'bar' ? 'bg-amber-100 border border-amber-300 rounded-lg' : d.kind === 'plant' ? 'bg-green-100 rounded-full' : '')}
            style={{ left: d.x * scale, top: d.y * scale, width: d.w * scale, height: d.h * scale }}>{d.text}</div>
        ))}
        {links.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
            {links.map(l => (
              <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="currentColor" strokeWidth="8" strokeLinecap="round" data-testid="table-link"
                className={l.state === 'billed' ? 'text-warn' : l.state === 'held' ? 'text-held' : 'text-brand'} />
            ))}
          </svg>
        )}
        {tables.map(t => {
          const b = boxOf(t)
          return (
            <TableTile key={t.id} table={t} list={byTable[t.id]} allTables={allTables} onTap={onTap} picked={placeOf(picked, t.id)}
              compact={b.small}
              style={{ position: 'absolute', left: b.left, top: b.top, width: b.width, height: b.height }} />
          )
        })}
      </div>
    </div>
  )
}

const NO_TABLES = 'No tables yet. Add tables in Macaroonie (Tables) and place them on the floor plan (Store tech, Floor plan).'

function TableGrid({ tables, allTables, byTable, onTap, picked = null, empty = null }) {
  if (!tables.length) return <div className="card p-6 text-muted">{empty || NO_TABLES}</div>
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-3 p-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
        {tables.map(t => <TableTile key={t.id} table={t} list={byTable[t.id]} allTables={allTables} onTap={onTap} picked={placeOf(picked, t.id)} style={{ height: 110 }} />)}
      </div>
    </div>
  )
}

/**
 * A phone's tables as rows (the till's On a phone: List), in the order of
 * their names: a free table opens a check when tapped; a table with one
 * check is that check's row, which swipes; one with several says so and,
 * tapped, lists them (each of those swipes too). A combined party is one
 * row, at its main table ("Tables 4 + 5"): its joined tables have no row of
 * their own. picked: the tables tapped in Combine tables (null = not
 * combining); a picked row is ringed.
 */
function TableRows({ tables, byTable, config, onTap, checkRow, picked = null, empty = null }) {
  if (!tables.length) return <div className="card p-6 text-muted">{empty || NO_TABLES}</div>
  const ring = id => (picked?.includes(id) ? 'rounded-2xl ring-4 ring-ink' : '')
  return (
    <div className="h-full overflow-y-auto space-y-2 p-1" data-testid="table-rows">
      {tables.map(t => {
        const list = byTable[t.id] || []
        // Joined to a party whose row is at its main table.
        if (list.length && list.every(c => c.table_id !== t.id)) return null
        if (list.length === 1) return <div key={t.id} className={ring(t.id)} data-picked={picked?.includes(t.id) ? '1' : ''}>{checkRow(list[0], () => onTap(t))}</div>
        const total = list.reduce((s, x) => s + checkTotals(x).total, 0)
        const state = tableState(list)
        return (
          <button key={t.id} onClick={() => onTap(t)} data-testid="table-row" data-table={t.id} data-label={t.label} data-state={state} data-picked={picked?.includes(t.id) ? '1' : ''}
            className={cx('w-full card p-3 flex items-center gap-3 text-left touch-manipulation active:bg-page', ring(t.id))}>
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

/** What a check's row is called: its table ("Tables 4 + 5" when combined), its name, its order number, else Tab T2-4. */
export function rowTitle(check, config) {
  const tables = tableTitleOf(check, config)
  if (tables) return tables
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
    <button onClick={onClick} {...buttonProps} data-testid="check-row" data-check={check.id} data-title={rowTitle(check, config)}
      className={cx('w-full card p-3 flex items-center gap-3 text-left touch-manipulation active:bg-page', active && 'ring-2 ring-brand', buttonProps?.className)}>
      <div className={cx('w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0',
        check.billed ? 'bg-warn text-white' : held ? 'bg-held text-white' : 'bg-brand-soft text-brand')}>
        {table ? (
          <span className="flex flex-col items-center leading-none">
            <span>{table.label}</span>
            {joinedTables(check).length > 0 && <span className="text-[10px] mt-0.5">+{joinedTables(check).length}</span>}
          </span>
        ) : check.order_no != null ? '#' + check.order_no : <ReceiptText size={20} />}
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

/** One line above swipeable rows saying what a swipe does (fireFirst: the till's Swipe left fires first). */
function SwipeHint({ fireFirst = false }) {
  return (
    <div className="text-xs text-muted px-1 flex items-center gap-3 flex-wrap" data-testid="swipe-hint">
      <span className="inline-flex items-center gap-1"><CreditCard size={13} /> Swipe right to pay</span>
      <span className="inline-flex items-center gap-1">{fireFirst ? <Flame size={13} /> : <Send size={13} />} Swipe left to {fireFirst ? 'fire or send' : 'send or fire'}</span>
    </div>
  )
}

/**
 * A check's row that swipes (a phone set to rows): drag it right to pay,
 * left to send what is new or fire the course waiting (swipeLeftAction(),
 * then the Send or Fire window asks). What a swipe will do shows behind the
 * row as it moves; let go past the line to do it. A tap still opens the
 * check.
 */
function SwipeCheckRow({ check, config, swipe, onClick, onLeft, onRight }) {
  const left = swipeLeftAction(check, config)
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
      style={orderPromptOf(config, streamId)} doneLabel={coversRule === 'off' ? 'Open tab' : 'Next'} onDone={answered} onClose={onClose}
      noteFor={() => 'A tab is a check without a table: bar tabs, people waiting, collections.'} />
  )
}
