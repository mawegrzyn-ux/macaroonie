// The floor: rooms (floor areas) with their tables where Till setup placed
// them, coloured by what is happening there; open tabs and counter orders on
// the right. Tap a free table to open a check, a busy one to go to it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Users, Hourglass, ReceiptText } from 'lucide-react'
import { useTill, useChecks, toast } from '../lib/store.js'
import { openCheck, defaultRcId } from '../lib/checkOps.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { checkLabel, heldCourses } from '@shared/pos/checks.js'
import { Modal, Keypad, cx, money, elapsed, useTick } from '../components/ui.jsx'

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

  const open = useMemo(() => Object.values(checks).filter(c => c.status === 'open'), [checks])
  const byTable = useMemo(() => {
    const m = {}
    for (const c of open) if (c.table_id) (m[c.table_id] ||= []).push(c)
    return m
  }, [open])

  const startTable = (table, covers) => {
    const r = openCheck({ mode: 'table', table_id: table.id, covers, revenue_centre_id: defaultRcId(config, { areaId: table.floor_area_id }) })
    if (!r.ok) return toast(r.error, 'bad')
    setAsk(null)
    onOpen(r.checkId)
  }
  const tapTable = table => {
    const list = byTable[table.id] || []
    if (list.length === 1) return onOpen(list[0].id)
    if (list.length > 1) return setChoose({ table, checks: list })
    if (config.settings.require_covers) return setAsk({ table })
    startTable(table, null)
  }

  const area = areas.find(a => a.id === areaId)
  const tabs = open.filter(c => !c.table_id).sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
  const mine = open.filter(c => c.server_id === staff.id).length

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 p-3 scroll-x">
          {areas.map(a => (
            <button key={a.id} className={cx('chip shrink-0', areaId === a.id && 'chip-on')} onClick={() => setAreaId(a.id)}>{a.name}</button>
          ))}
          {(unplaced.length > 0 || !areas.length) && (
            <button className={cx('chip shrink-0', areaId === LIST && 'chip-on')} onClick={() => setAreaId(LIST)}>{areas.length ? 'Other tables' : 'Tables'}</button>
          )}
          <div className="ml-auto text-sm text-muted shrink-0 pr-1">{open.length} open · {mine} yours</div>
        </div>
        <div className="flex-1 min-h-0 px-3 pb-3">
          {area
            ? <Plan area={area} tables={(config.tables || []).filter(t => t.floor_area_id === area.id)} byTable={byTable} onTap={tapTable} />
            : <TableGrid tables={areas.length ? unplaced : config.tables || []} byTable={byTable} onTap={tapTable} />}
        </div>
      </div>
      <aside className="w-[300px] xl:w-[340px] shrink-0 border-l border-line bg-white flex flex-col">
        <div className="p-3 border-b border-line flex gap-2">
          <button className="btn btn-primary flex-1" onClick={() => setNewTab(true)}><Plus size={18} /> New tab</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="label px-1">Tabs and orders</div>
          {!tabs.length && <div className="text-sm text-muted px-1">No open tabs.</div>}
          {tabs.map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => onOpen(c.id)} />)}
          {open.some(c => c.table_id) && <div className="label px-1 pt-3">Tables</div>}
          {open.filter(c => c.table_id).map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => onOpen(c.id)} />)}
        </div>
      </aside>

      {ask && (
        <CoversModal title={'Table ' + ask.table.label} max={ask.table.max_covers} onClose={() => setAsk(null)} onDone={n => startTable(ask.table, n)} />
      )}
      {choose && (
        <Modal title={'Table ' + choose.table.label} onClose={() => setChoose(null)}>
          <div className="space-y-2">
            {choose.checks.map(c => <CheckRow key={c.id} check={c} config={config} onClick={() => { setChoose(null); onOpen(c.id) }} />)}
            <button className="btn w-full" onClick={() => { const t = choose.table; setChoose(null); config.settings.require_covers ? setAsk({ table: t }) : startTable(t, null) }}>
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

function TableGrid({ tables, byTable, onTap }) {
  if (!tables.length) {
    return <div className="card p-6 text-muted">No tables yet. Add tables in Macaroonie (Tables) and place them on the floor plan (Till setup, Floor plan).</div>
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {tables.map(t => <TableTile key={t.id} table={t} list={byTable[t.id]} onTap={onTap} style={{ height: 110 }} />)}
      </div>
    </div>
  )
}

export function CheckRow({ check, config, onClick, active = false }) {
  const t = checkTotals(check)
  const table = check.table_id ? (config.tables || []).find(x => x.id === check.table_id) : null
  const server = (config.staff || []).find(s => s.id === check.server_id)
  const held = heldCourses(check).length
  return (
    <button onClick={onClick} className={cx('w-full card p-3 flex items-center gap-3 text-left touch-manipulation active:bg-page', active && 'ring-2 ring-brand')}>
      <div className={cx('w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0',
        check.billed ? 'bg-warn text-white' : held ? 'bg-held text-white' : 'bg-brand-soft text-brand')}>
        {table ? table.label : check.order_no != null ? '#' + check.order_no : <ReceiptText size={20} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{table ? 'Table ' + table.label : check.tab_name || (check.order_no != null ? 'Order #' + check.order_no : 'Tab ' + checkLabel(check))}</div>
        <div className="text-xs text-muted truncate">
          {server?.name || ''}{check.covers ? ' · ' + check.covers + ' covers' : ''} · {elapsed(check.opened_at)}
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

export function CoversModal({ title, max, onClose, onDone, initial = '' }) {
  const [v, setV] = useState(String(initial || ''))
  const quick = [1, 2, 3, 4, 5, 6, 8].filter(n => !max || n <= Math.max(max, 6))
  return (
    <Modal title={title + ': how many guests?'} onClose={onClose}>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {quick.map(n => <button key={n} className="btn h-16 text-2xl font-bold" onClick={() => onDone(n)}>{n}</button>)}
      </div>
      <div className="text-center text-3xl font-bold h-10 tabular-nums">{v || ' '}</div>
      <Keypad value={v} onChange={setV} max={3} />
      <button className="btn btn-primary w-full mt-3 h-14" disabled={!Number(v)} onClick={() => onDone(Number(v))}>Open check</button>
    </Modal>
  )
}

function NewTabModal({ onClose, onOpen }) {
  const { config } = useTill()
  const [name, setName] = useState('')
  const start = () => {
    const r = openCheck({ mode: 'tab', tab_name: name.trim() || null })
    if (!r.ok) return toast(r.error, 'bad')
    onOpen(r.checkId)
  }
  return (
    <Modal title="New tab" onClose={onClose} footer={<button className="btn btn-primary" onClick={start}><Plus size={18} /> Open tab</button>}>
      <label className="block">
        <span className="label">Name (optional)</span>
        <input className="input mt-1" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith, bar stool 3" maxLength={80} />
      </label>
      <div className="text-sm text-muted mt-3">A tab is a check without a table: bar tabs, people waiting, collections.</div>
      {(config.revenue_centres || []).length > 1 && <div className="text-xs text-muted mt-2">It starts in this till's revenue centre; change it on the check.</div>}
    </Modal>
  )
}
