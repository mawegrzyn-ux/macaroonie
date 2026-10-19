// src/components/pos/KitchenFlow.jsx
//
// Till setup > Kitchen screens > Kitchen flows: a visual designer for how
// dishes move through the kitchen (docs/POS.md section 9; the rules are
// shared/pos/kitchen.js, the API PUT /pos/kds-flows/:id).
//
// A venue can have several flows (migration 177: a busy night, one cook,
// the grill down); one is in use. The flow bar picks the flow to look at or
// edit, makes a new one and orders them (the order of the kitchen screen's
// flow list); the This flow box puts the flow in use (a kitchen screen's
// flow button does the same), renames, copies or deletes it. Dishes follow
// the flow in use when they are sent and keep that way.
//
// Boxes are Orders in (the till and online orders) and the venue's stations:
// prep, expo, runner and order ready boards. A link says dishes go on from
// one box to the next; its filter (dishes, sections, revenue streams, order
// types) says which dishes take it. From each box a dish takes the links
// whose filter names it most closely, so a burger can go Prep 1 > Prep 2 >
// Expo 1 while the fries go Prep 1 > Expo 1.
//
// Drag a box to move it (always-visible grip). Drag a box's dot onto another
// box to link them, or tap the dot then tap the next box. Tap a link's label
// to choose which dishes take it or to remove it. Tap a station's box to take
// it out of this flow (off_station_ids, migration 182: not drawn, nothing
// links to it, no dish goes there while the flow is in use); Not in this
// flow puts it back. Check a dish shows the way one dish would take. Nothing
// is saved until Save flow.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Loader2, Pencil, Maximize2, Minimize2, Wand2, Route, X, Search, GripVertical, AlertTriangle, Info, Link2,
  ArrowUpDown, Copy, CheckCircle2, MinusCircle,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  flowProblems, flowWarnings, itemRoute, KIND_LABELS, START, isBumpKind,
} from '@shared/pos/kitchen.js'
import { Section, Btn, ErrorNote, ConfirmDelete, inputCls, Modal, Field, SortableRows } from './shared'

const NODE_W = 196
const NODE_H = 72
const COL = 350          // room between columns for the link labels
const ROW = 100
const PAD = 28

const KIND_STYLE = {
  start: 'border-zinc-500',
  prep: 'border-sky-500',
  expo: 'border-amber-500',
  runner: 'border-violet-500',
  board: 'border-emerald-600',
  balance: 'border-rose-500 border-dashed',
  printer: 'border-stone-600',
}
const KIND_STRIP = { start: '#71717a', prep: '#0ea5e9', expo: '#f59e0b', runner: '#8b5cf6', board: '#059669', balance: '#f43f5e', printer: '#57534e' }
const ADD_KINDS = ['prep', 'expo', 'runner', 'board', 'balance', 'printer']
// What a Balance box does, said the same way in the panels.
const BALANCE_RULE = 'each ticket\'s dishes go to one of them: the one with the fewest pieces still to cook, taking turns when they\'re level'

let keySeq = 0
const newKey = () => 'new-' + (++keySeq) + '-' + Math.random().toString(36).slice(2, 7)
const nodeKey = id => id || START

function seedDraft(setup, flow) {
  const ids = new Set(setup.kds_stations.map(s => s.id))
  // Stations this flow leaves out (deleted ones forgotten).
  const off = (flow?.off_station_ids || []).filter(id => ids.has(id))
  const here = id => ids.has(id) && !off.includes(id)
  const links = (flow?.links || [])
    .filter(l => here(l.to) && (!l.from || here(l.from)))
    .map(l => ({ key: l.id, from: l.from || null, to: l.to, targets: l.targets || [] }))
  const inFlow = setup.kds_stations.filter(s => !off.includes(s.id))
  return { links, off, layout: placeMissing({ ...(flow?.layout || {}) }, inFlow, links) }
}

/**
 * Gives every box without a place one (its Tidy place, moved down until it
 * overlaps nothing), so boxes stay put while links are added.
 */
function placeMissing(layout, stations, links) {
  const ids = [START, ...stations.map(s => s.id)]
  if (ids.every(id => layout[id])) return layout
  const tidy = tidyLayout(stations, links)
  const out = { ...layout }
  const clash = (p, id) => ids.some(o => o !== id && out[o] && Math.abs(out[o].x - p.x) < NODE_W + 20 && Math.abs(out[o].y - p.y) < NODE_H + 16)
  for (const id of ids) {
    if (out[id]) continue
    const p = { ...(tidy[id] || { x: PAD, y: PAD }) }
    for (let n = 0; n < 60 && clash(p, id); n++) p.y += ROW
    out[id] = p
  }
  return out
}

// Where a box on no dish's way yet goes: preps first, then expos, then runners and boards.
const KIND_COL = { prep: 1, expo: 2, runner: 3, board: 3 }

/** Columns by the longest way from Orders in; stations on no way yet by kind. */
export function tidyLayout(stations, links) {
  const depth = { [START]: 0 }
  for (let k = 0; k <= stations.length; k++) {
    let changed = false
    for (const l of links) {
      const f = nodeKey(l.from)
      if (depth[f] == null) continue
      const d = depth[f] + 1
      if ((depth[l.to] ?? -1) < d && d <= stations.length) { depth[l.to] = d; changed = true }
    }
    if (!changed) break
  }
  const cols = {}
  for (const s of stations) {
    const d = depth[s.id] ?? KIND_COL[s.kind] ?? 1
    ;(cols[d] = cols[d] || []).push(s.id)
  }
  const out = {}
  for (const [d, list] of Object.entries(cols)) list.forEach((id, i) => { out[id] = { x: PAD + Number(d) * COL, y: PAD + i * ROW } })
  out[START] = { x: PAD, y: PAD + (((cols[1] || []).length || 1) - 1) * ROW / 2 }
  return out
}

function bezier(a, b) {
  const dx = Math.max(48, Math.abs(b.x - a.x) / 2)
  const c1 = { x: a.x + dx, y: a.y }
  const c2 = { x: b.x - dx, y: b.y }
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
  }
}

function useLookups(setup) {
  return useMemo(() => {
    const menus = Object.fromEntries((setup.menus || []).map(m => [m.id, m]))
    const sections = Object.fromEntries((setup.sections || []).map(s => [s.id, { ...s, menu: menus[s.menu_id]?.name || '' }]))
    const items = Object.fromEntries((setup.items || []).map(i => [i.id, i]))
    const streams = Object.fromEntries((setup.revenue_streams || []).map(r => [r.id, r]))
    const types = Object.fromEntries((setup.order_types || []).map(t => [t.id, t]))
    return { sections, items, streams, types }
  }, [setup.menus, setup.sections, setup.items, setup.revenue_streams, setup.order_types])
}

function targetName(t, lk) {
  switch (t.kind) {
    case 'item': return lk.items[t.id]?.name || 'A removed dish'
    case 'section': return lk.sections[t.id]?.title || 'A removed section'
    case 'revenue_stream': return lk.streams[t.id]?.name || 'A removed revenue stream'
    case 'order_type': return lk.types[t.id]?.name || 'A removed order type'
    default: return 'Any dish'
  }
}
const KIND_WORD = { item: 'Dish', section: 'Section', revenue_stream: 'Revenue stream', order_type: 'Order type', default: '' }

function linkSummary(link, lk) {
  if (!link.targets.length) return 'Every dish'
  const names = link.targets.map(t => targetName(t, lk))
  return names.length <= 2 ? names.join(', ') : names[0] + ' +' + (names.length - 1)
}

export default function KitchenFlow({ venueId, setup, canManage, onStation }) {
  const api = useApi()
  const qc = useQueryClient()
  const flows = setup.kds_flows || []
  const activeId = setup.kds_active_flow_id
  const [flowId, setFlowId] = useState(activeId)
  const flow = flows.find(f => f.id === flowId) || flows.find(f => f.id === activeId) || flows[0] || null
  const [dirty, setDirty] = useState(false)
  const [full, setFull] = useState(false)
  const [modal, setModal] = useState(null)            // 'new' | 'copy' | 'rename' | 'order'
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const useNow = useMutation({
    mutationFn: id => api.put(`/pos/venues/${venueId}/kds-flows/active`, { flow_id: id }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: id => api.delete(`/pos/kds-flows/${id}`),
    onSuccess: () => { setFlowId(activeId); refresh() },
  })

  const bar = flow && (
    <FlowBar flows={flows} flow={flow} activeId={activeId} dirty={dirty} canManage={canManage}
      onPick={id => { setFlowId(id); useNow.reset(); remove.reset() }} onNew={() => setModal('new')} onOrder={() => setModal('order')} />
  )
  const flowBox = flow && (
    <ThisFlow flow={flow} active={flow.id === activeId} setup={setup} canManage={canManage} dirty={dirty}
      onUse={() => useNow.mutate(flow.id)} using={useNow.isPending} error={useNow.error || remove.error}
      onRename={() => setModal('rename')} onCopy={() => setModal('copy')} onDelete={() => remove.mutate(flow.id)} deleting={remove.isPending} />
  )

  return (
    <Section title="Kitchen flows" hint="How dishes move through the kitchen: from Orders in (the till and online orders) to the stations that make them, on to the expo, runners and order ready boards. Make more than one (a busy night, one cook, the grill down) and switch between them here or with the flow button on a kitchen screen. A change or a switch counts for dishes sent after it.">
      {flow
        ? <FlowDesigner key={flow.id} venueId={venueId} setup={setup} flow={flow} isActive={flow.id === activeId} canManage={canManage}
            onStation={onStation} bar={bar} flowBox={flowBox} full={full} setFull={setFull} onDirty={setDirty} />
        : <p className="text-sm text-muted-foreground">No kitchen flow yet.</p>}
      {(modal === 'new' || modal === 'copy' || modal === 'rename') && flow && (
        <FlowModal mode={modal} venueId={venueId} flow={flow} onClose={() => setModal(null)}
          onSaved={out => { setModal(null); if (modal !== 'rename') setFlowId(out.id); refresh() }} />
      )}
      {modal === 'order' && (
        <OrderFlowsModal venueId={venueId} flows={flows} activeId={activeId} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </Section>
  )
}

function FlowDesigner({ venueId, setup, flow, isActive, canManage, onStation, bar, flowBox, full, setFull, onDirty }) {
  const api = useApi()
  const qc = useQueryClient()
  const lk = useLookups(setup)
  const stations = setup.kds_stations
  const byId = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations])
  const nameOf = id => (id && id !== START ? byId[id]?.name || 'a removed station' : 'Orders in')
  const inFlowOf = off => stations.filter(s => !off.includes(s.id))

  const [draft, setDraft] = useState(() => seedDraft(setup, flow))
  const inFlow = useMemo(() => inFlowOf(draft.off), [stations, draft.off]) // eslint-disable-line react-hooks/exhaustive-deps
  const offStations = useMemo(() => stations.filter(s => draft.off.includes(s.id)), [stations, draft.off])
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState(null)     // { link: key } | { node: id }
  const [connectFrom, setConnectFrom] = useState(null)
  const [wire, setWire] = useState(null)              // { from, x, y } while dragging a new link
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(() => ({ item_id: '', order_type_id: (setup.order_types || []).find(t => t.is_active)?.id || '', revenue_stream_id: '' }))
  const [saved, setSaved] = useState(null)            // warnings after the last save
  // A flow that has never been laid out arranges itself as links are added,
  // until a box is moved by hand (or places are saved).
  const [autoTidy, setAutoTidy] = useState(() => !Object.keys(flow.layout || {}).length)
  // The flow bar can't open another flow while this one has unsaved changes.
  useEffect(() => { onDirty(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  // A change from elsewhere (station added, removed, saved flow): take it in,
  // keeping an unsaved draft but dropping links to stations that are gone.
  const flowKey = JSON.stringify({ links: flow.links, layout: flow.layout, off: flow.off_station_ids }) + '|' + stations.map(s => s.id).join(',')
  useEffect(() => {
    if (!dirty) { setDraft(seedDraft(setup, flow)); return }
    setDraft(d => {
      const off = d.off.filter(id => byId[id])
      const links = d.links.filter(l => byId[l.to] && (!l.from || byId[l.from]))
      return { links, off, layout: placeMissing(d.layout, inFlowOf(off), links) }
    })
  }, [flowKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!full) return
    const f = e => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [full])

  const pos = useMemo(() => {
    const out = {}
    for (const id of [START, ...inFlow.map(s => s.id)]) out[id] = draft.layout[id] || { x: PAD, y: PAD }
    return out
  }, [draft.layout, inFlow])
  const width = Math.max(720, ...Object.values(pos).map(p => p.x + NODE_W + PAD + 40))
  const height = Math.max(380, ...Object.values(pos).map(p => p.y + NODE_H + PAD))

  const problems = useMemo(() => flowProblems(stations, draft.links), [stations, draft.links])
  const warnings = useMemo(() => flowWarnings(inFlow, draft.links), [inFlow, draft.links])

  const change = fn => { setDraft(d => fn(d)); setDirty(true) }
  const changeLinks = fn => change(d => {
    const links = fn(d.links)
    return { ...d, links, layout: autoTidy ? tidyLayout(inFlowOf(d.off), links) : d.layout }
  })
  const addLink = (from, to) => {
    const f = from === START ? null : from
    if (!to || to === START || to === f) return
    if (f && byId[f]?.kind === 'board') return
    // A Balance box shares between stations that bump.
    if (f && byId[f]?.kind === 'balance' && !isBumpKind(byId[to]?.kind)) return
    const existing = draft.links.find(l => (l.from || null) === f && l.to === to)
    if (existing) { setSelected({ link: existing.key }); return }
    const key = newKey()
    changeLinks(links => [...links, { key, from: f, to, targets: [] }])
    setSelected({ link: key })
  }
  const updateLink = (key, patch) => change(d => ({ ...d, links: d.links.map(l => (l.key === key ? { ...l, ...patch } : l)) }))
  const removeLink = key => { changeLinks(links => links.filter(l => l.key !== key)); setSelected(null) }
  // Out of this flow: its links in this flow go; the station stays for the others.
  const takeOut = id => {
    change(d => ({ ...d, links: d.links.filter(l => l.to !== id && l.from !== id), off: [...d.off, id] }))
    setSelected(null)
  }
  const putBack = id => change(d => {
    const off = d.off.filter(x => x !== id)
    return { ...d, off, layout: placeMissing(d.layout, inFlowOf(off), d.links) }
  })

  // ── Pointer handling: move boxes, draw links ──
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const drag = useRef(null)
  // Dragging near the edge of the canvas scrolls it, so a link can reach a
  // box that is out of sight.
  const edgeScroll = e => {
    const w = wrapRef.current
    if (!w) return
    const r = w.getBoundingClientRect()
    const step = (d, lo, hi) => (d < lo + 40 ? -14 : d > hi - 40 ? 14 : 0)
    const dx = step(e.clientX, r.left, r.right)
    const dy = step(e.clientY, r.top, r.bottom)
    if (dx || dy) w.scrollBy(dx, dy)
  }
  const point = e => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onNodeDown = (e, id) => {
    if (e.button && e.button !== 0) return
    const pt = point(e)
    drag.current = { kind: 'node', id, off: { x: pt.x - pos[id].x, y: pt.y - pos[id].y }, start: pt, moved: false }
    if (canManage) e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onHandleDown = (e, id) => {
    e.stopPropagation()
    if (!canManage) return
    const pt = point(e)
    drag.current = { kind: 'wire', from: id, start: pt, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setWire({ from: id, x: pt.x, y: pt.y })
  }
  const onMove = e => {
    const g = drag.current
    if (!g) return
    const pt = point(e)
    if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) > 6) g.moved = true
    if (!g.moved) return
    if (canManage) edgeScroll(e)
    if (g.kind === 'node' && canManage) {
      setAutoTidy(false)
      const x = Math.max(6, Math.round(pt.x - g.off.x))
      const y = Math.max(6, Math.round(pt.y - g.off.y))
      change(d => ({ ...d, layout: { ...d.layout, [g.id]: { x, y } } }))
    } else if (g.kind === 'wire') {
      setWire({ from: g.from, x: pt.x, y: pt.y })
    }
  }
  const onUp = e => {
    const g = drag.current
    drag.current = null
    if (!g) return
    if (g.kind === 'wire') {
      setWire(null)
      if (!g.moved) { setConnectFrom(g.from); setSelected(null); return }
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node]')
      if (el) addLink(g.from, el.getAttribute('data-node'))
      return
    }
    if (!g.moved) {
      if (connectFrom) { addLink(connectFrom, g.id); setConnectFrom(null) } else setSelected({ node: g.id })
    }
  }
  const onCancel = () => { drag.current = null; setWire(null) }

  // ── Check a dish ──
  const checkItem = lk.items[check.item_id]
  const route = useMemo(() => {
    if (!checking || !checkItem) return null
    const live = Object.fromEntries(inFlow.filter(s => s.is_active).map(s => [s.id, s]))
    return itemRoute({
      item_id: checkItem.id, section_id: checkItem.section_id,
      revenue_stream_id: check.revenue_stream_id || null, order_type_id: check.order_type_id || null,
    }, { stations: live, flow: draft.links })
  }, [checking, checkItem, check.order_type_id, check.revenue_stream_id, inFlow, draft.links])
  const onRoute = (from, to) => !!route?.[to]?.includes(nodeKey(from))
  const inRoute = id => !!route && (id === START ? Object.keys(route).length > 0 : !!route[id])

  const save = useMutation({
    mutationFn: () => api.put(`/pos/kds-flows/${flow.id}`, {
      links: draft.links.map(l => ({ from: l.from, to: l.to, targets: l.targets })),
      layout: pos,
      off_station_ids: draft.off,
    }),
    onSuccess: out => {
      setSaved(out.warnings || [])
      setAutoTidy(false)
      setDirty(false)
      setDraft({ links: out.links.map(l => ({ key: l.id, from: l.from || null, to: l.to, targets: l.targets || [] })), off: out.off_station_ids || [], layout: out.layout })
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
    },
  })
  const discard = () => { setDraft(seedDraft(setup, flow)); setDirty(false); setSelected(null); setConnectFrom(null) }

  const selLink = selected?.link ? draft.links.find(l => l.key === selected.link) : null
  const selNode = selected?.node || null
  const nodes = [{ id: START, name: 'Orders in', kind: 'start', is_active: true }, ...inFlow]

  const canvas = (
    <div ref={wrapRef} className={cn('relative min-w-0 overflow-auto rounded-xl border bg-muted/40', full ? 'flex-1' : 'h-[460px] flex-1')}
      data-testid="flow-canvas-wrap">
      <div ref={canvasRef} className="relative" style={{ width, height }} data-testid="flow-canvas"
        onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setConnectFrom(null) } }}>
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="kf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#52525b" />
            </marker>
            <marker id="kf-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
            </marker>
          </defs>
          {draft.links.map(l => {
            const a = pos[nodeKey(l.from)], b = pos[l.to]
            if (!a || !b) return null
            const { d } = bezier({ x: a.x + NODE_W, y: a.y + NODE_H / 2 }, { x: b.x - 2, y: b.y + NODE_H / 2 })
            const on = onRoute(l.from, l.to)
            const sel = selLink?.key === l.key
            return (
              <path key={l.key} d={d} fill="none" strokeWidth={sel || on ? 3.5 : 2}
                stroke={on ? '#2563eb' : sel ? '#111827' : '#71717a'}
                markerEnd={on ? 'url(#kf-arrow-on)' : 'url(#kf-arrow)'} opacity={route && !on ? 0.35 : 1} />
            )
          })}
          {wire && pos[wire.from] && (
            <path d={bezier({ x: pos[wire.from].x + NODE_W, y: pos[wire.from].y + NODE_H / 2 }, { x: wire.x, y: wire.y }).d}
              fill="none" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="6 5" />
          )}
        </svg>

        {draft.links.map(l => {
          const a = pos[nodeKey(l.from)], b = pos[l.to]
          if (!a || !b) return null
          const { mid } = bezier({ x: a.x + NODE_W, y: a.y + NODE_H / 2 }, { x: b.x, y: b.y + NODE_H / 2 })
          const on = onRoute(l.from, l.to)
          const sel = selLink?.key === l.key
          return (
            <div key={l.key} role="button" tabIndex={0} data-testid="flow-link" data-from={nodeKey(l.from)} data-to={l.to}
              onClick={() => { setSelected({ link: l.key }); setConnectFrom(null) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected({ link: l.key }) } }}
              title={nameOf(l.from) + ' to ' + nameOf(l.to) + ': ' + (byId[l.from]?.kind === 'balance' ? 'shared' : linkSummary(l, lk))}
              className={cn('absolute z-10 -translate-x-1/2 -translate-y-1/2 h-10 max-w-[150px] px-3 rounded-full border text-xs font-medium flex items-center gap-1 cursor-pointer touch-manipulation shadow-sm',
                sel ? 'bg-zinc-900 text-white border-zinc-900' : on ? 'bg-blue-600 text-white border-blue-600' : l.targets.length ? 'bg-amber-50 border-amber-300' : 'bg-background',
                route && !on && !sel && 'opacity-50')}
              style={{ left: mid.x, top: mid.y }}>
              <span className="truncate">{byId[l.from]?.kind === 'balance' ? 'Shared' : linkSummary(l, lk)}</span>
            </div>
          )
        })}

        {nodes.map(n => {
          const p = pos[n.id]
          const kind = n.kind
          const sel = selNode === n.id
          const pickable = connectFrom && n.id !== START && n.id !== connectFrom
          return (
            <div key={n.id} data-node={n.id} data-testid="flow-node" data-kind={kind}
              onPointerDown={e => onNodeDown(e, n.id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, touchAction: canManage ? 'none' : 'auto' }}
              className={cn('absolute rounded-xl border-2 bg-background shadow-sm flex items-stretch select-none touch-manipulation',
                KIND_STYLE[kind], sel && 'ring-4 ring-primary/30', pickable && 'ring-4 ring-blue-400 cursor-pointer',
                connectFrom === n.id && 'ring-4 ring-blue-600', !n.is_active && 'opacity-50',
                route && !inRoute(n.id) && 'opacity-40', route && inRoute(n.id) && 'ring-4 ring-blue-500')}>
              <div className="w-2 rounded-l-[10px] shrink-0" style={{ background: n.colour || KIND_STRIP[kind] }} />
              {canManage && (
                <div className="w-7 shrink-0 flex items-center justify-center text-muted-foreground cursor-grab" aria-hidden="true">
                  <GripVertical className="w-4 h-4" />
                </div>
              )}
              <div className={cn('flex-1 min-w-0 py-1.5 pr-6', !canManage && 'pl-2')}>
                <p className="text-sm font-semibold truncate">{n.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {kind === 'start' ? 'The till and online orders' : KIND_LABELS[kind]}{!n.is_active ? ' · not in use' : ''}
                </p>
              </div>
              {kind !== 'start' && <span className="absolute -left-[7px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-zinc-400 border-2 border-background" aria-hidden="true" />}
              {canManage && kind !== 'board' && (
                <div role="button" tabIndex={0} aria-label={'Link ' + n.name + ' to the next station'} data-testid="flow-handle"
                  onPointerDown={e => onHandleDown(e, n.id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConnectFrom(n.id) } }}
                  style={{ touchAction: 'none' }}
                  className="absolute -right-[22px] top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center cursor-crosshair">
                  <span className={cn('w-5 h-5 rounded-full border-2 border-background shadow', connectFrom === n.id ? 'bg-blue-600' : 'bg-zinc-700')} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const panel = (
    <div className="lg:w-80 shrink-0 space-y-3 text-sm" data-testid="flow-panel">
      {connectFrom && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 p-3 space-y-2">
          <p className="font-medium">Tap the station dishes go to next from {nameOf(connectFrom)}.</p>
          <Btn onClick={() => setConnectFrom(null)}><X className="w-4 h-4" /> Cancel</Btn>
        </div>
      )}
      {checking && (
        <CheckPanel kindOf={id => byId[id]?.kind} setup={setup} lk={lk} check={check} setCheck={setCheck} route={route} nameOf={nameOf} onClose={() => setChecking(false)} />
      )}
      {selLink && (
        <LinkPanel link={selLink} lk={lk} setup={setup} canManage={canManage} nameOf={nameOf} fromBalance={byId[selLink.from]?.kind === 'balance'}
          siblings={draft.links.filter(l => (l.from || null) === (selLink.from || null) && l.key !== selLink.key)}
          onChange={patch => updateLink(selLink.key, patch)} onRemove={() => removeLink(selLink.key)} onClose={() => setSelected(null)} />
      )}
      {selNode && (
        <NodePanel key={selNode} id={selNode} station={byId[selNode]} setup={setup} links={draft.links} nameOf={nameOf} lk={lk} canManage={canManage}
          onEdit={() => onStation(byId[selNode])} onLink={() => { setConnectFrom(selNode); setSelected(null) }}
          onTakeOut={() => takeOut(selNode)}
          onPick={key => setSelected({ link: key })} onClose={() => setSelected(null)} />
      )}
      {!connectFrom && !checking && !selLink && !selNode && flowBox}
      {!connectFrom && !checking && !selLink && !selNode && (
        <div className="rounded-xl border bg-background p-3 space-y-2 text-muted-foreground">
          <p className="flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{canManage
              ? 'Drag a box by its grip to move it. Drag its dot onto another box (or tap the dot, then the box) to send dishes on to it. Tap a link to choose which dishes take it. Tap a box to take its station out of this flow.'
              : 'Tap a link to see which dishes take it, or a box to see its links.'}</span>
          </p>
          <p>From each box a dish takes the links that name it most closely: the dish itself, then its section, its revenue stream, its order type, then links for every dish. Links that tie all apply: e.g. from the expo to the board and to a runner at once.</p>
        </div>
      )}
    </div>
  )

  const body = (
    <>
      {bar}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && <AddStationMenu onPick={kind => onStation({ kind })} />}
        {canManage && (
          <Btn onClick={() => change(d => ({ ...d, layout: tidyLayout(inFlowOf(d.off), d.links) }))} title="Tidy the boxes into columns">
            <Wand2 className="w-4 h-4" /> Tidy
          </Btn>
        )}
        <Btn onClick={() => { setChecking(c => !c); setSelected(null) }} variant={checking ? 'primary' : 'default'}>
          <Route className="w-4 h-4" /> Check a dish
        </Btn>
        <Btn onClick={() => setFull(f => !f)} title={full ? 'Leave full screen' : 'Full screen'}>
          {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          <span className="hidden sm:inline">{full ? 'Leave full screen' : 'Full screen'}</span>
        </Btn>
        {dirty && <span className="text-xs font-medium text-amber-700">Changes not saved</span>}
      </div>
      {offStations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="flow-off">
          <span className="text-muted-foreground">Not in this flow:</span>
          {offStations.map(st => (
            <span key={st.id} className="inline-flex items-center gap-1 rounded-full border bg-background pl-3 pr-0.5 min-h-[48px]">
              <span className="font-medium">{st.name}</span>
              {canManage && (
                <button type="button" onClick={() => putBack(st.id)}
                  className="min-h-[44px] min-w-[48px] px-3 rounded-full text-xs font-medium text-primary hover:bg-muted touch-manipulation">Put back</button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className={cn('flex flex-col lg:flex-row gap-3', full && 'flex-1 min-h-0')}>
        {canvas}
        {panel}
      </div>
      {problems.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 space-y-1" data-testid="flow-problems">
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Fix these to save</p>
          {problems.map(p => <p key={p}>{p}</p>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-1" data-testid="flow-warnings">
          {warnings.map(w => <p key={w}>{w}</p>)}
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="primary" disabled={!dirty || problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save flow
          </Btn>
          {dirty && <Btn onClick={discard}>Discard changes</Btn>}
          {!dirty && saved && (
            <span className="text-xs text-green-700">
              {isActive ? 'Saved. The kitchen screens follow it for dishes sent from now on.' : 'Saved. It isn\'t in use: Use this flow now puts it in use.'}
            </span>
          )}
          <ErrorNote error={save.error} />
        </div>
      )}
    </>
  )

  return full
    ? <div className="fixed inset-0 z-50 bg-page p-3 flex flex-col gap-3 overflow-y-auto" data-testid="flow-full">{body}</div>
    : body
}

// ── Flows: the bar, This flow, new / copy / rename, order ─────────

// The tabs aren't <button>s: Till setup wraps a View user's page in a
// disabled fieldset, and they must still be able to look at each flow.
function FlowBar({ flows, flow, activeId, dirty, canManage, onPick, onNew, onOrder }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="flow-bar">
      <div role="tablist" aria-label="Kitchen flows" className="flex flex-wrap gap-1.5 min-w-0">
        {flows.map(f => {
          const on = f.id === flow.id
          const locked = dirty && !on
          const pick = () => { if (!locked && !on) onPick(f.id) }
          return (
            <div key={f.id} role="tab" tabIndex={locked ? -1 : 0} aria-selected={on} aria-disabled={locked || undefined}
              onClick={pick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}
              data-testid="flow-tab" data-locked={locked ? 'true' : undefined} title={locked ? 'Save or discard the changes first' : undefined}
              className={cn('min-h-[44px] max-w-full px-3 rounded-lg border text-sm font-medium flex items-center gap-2 touch-manipulation select-none',
                on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted cursor-pointer',
                locked && 'opacity-50 cursor-not-allowed hover:bg-background')}>
              {f.id === activeId && <span className="w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-white/70 shrink-0" aria-hidden="true" />}
              <span className="truncate max-w-[14rem]">{f.name}</span>
              {f.id === activeId && <span className="text-[11px] font-semibold opacity-80 shrink-0">In use</span>}
            </div>
          )
        })}
      </div>
      {canManage && <Btn onClick={onNew} disabled={dirty} title="New kitchen flow"><Plus className="w-4 h-4" /> <span>New flow</span></Btn>}
      {canManage && flows.length > 1 && (
        <Btn onClick={onOrder} disabled={dirty} title="Order the flows"><ArrowUpDown className="w-4 h-4" /> <span className="hidden sm:inline">Order</span></Btn>
      )}
    </div>
  )
}

const when = at => new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function ThisFlow({ flow, active, setup, canManage, dirty, onUse, using, error, onRename, onCopy, onDelete, deleting }) {
  const [asking, setAsking] = useState(false)
  useEffect(() => setAsking(false), [flow.id, active])
  return (
    <PanelBox title={flow.name} testid="flow-this">
      {active
        ? (
          <p className="flex items-start gap-2 text-green-800" data-testid="flow-in-use">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>In use: dishes follow this flow.{setup.kds_flow_switched_at
              ? ' Switched ' + when(setup.kds_flow_switched_at) + (setup.kds_flow_switched_by ? ' by ' + setup.kds_flow_switched_by : '') + '.'
              : ''}</span>
          </p>
        )
        : <p className="text-muted-foreground">Not in use. Put it in use here or with the flow button on a kitchen screen.</p>}
      {canManage && !active && (
        asking
          ? (
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 space-y-2" data-testid="flow-use-confirm">
              <p>Dishes sent from now follow {flow.name}. Dishes already in the kitchen keep their way.</p>
              <div className="flex flex-wrap gap-2">
                <Btn variant="primary" onClick={onUse} disabled={using}>{using && <Loader2 className="w-4 h-4 animate-spin" />} Yes, use it now</Btn>
                <Btn onClick={() => setAsking(false)}>Cancel</Btn>
              </div>
            </div>
          )
          : (
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" onClick={() => setAsking(true)} disabled={dirty}>
                <CheckCircle2 className="w-4 h-4" /> Use this flow now
              </Btn>
              {dirty && <span className="text-xs text-muted-foreground">Save or discard the changes first.</span>}
            </div>
          )
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
          <Btn onClick={onRename} disabled={dirty}><Pencil className="w-4 h-4" /> Rename</Btn>
          <Btn onClick={onCopy} disabled={dirty}><Copy className="w-4 h-4" /> Copy</Btn>
          <span className="flex-1" />
          {active
            ? <span className="text-xs text-muted-foreground">The flow in use can't be deleted.</span>
            : <ConfirmDelete label="Delete flow" confirmLabel="Yes, delete" onConfirm={onDelete} disabled={deleting || dirty} />}
        </div>
      )}
      <ErrorNote error={error} />
    </PanelBox>
  )
}

function FlowModal({ mode, venueId, flow, onClose, onSaved }) {
  const api = useApi()
  const [name, setName] = useState(mode === 'rename' ? flow.name : mode === 'copy' ? ('Copy of ' + flow.name).slice(0, 40) : '')
  const save = useMutation({
    mutationFn: () => mode === 'rename'
      ? api.patch(`/pos/kds-flows/${flow.id}`, { name: name.trim() })
      : api.post(`/pos/venues/${venueId}/kds-flows`, { name: name.trim(), copy_from: mode === 'copy' ? flow.id : null }),
    onSuccess: onSaved,
  })
  const title = mode === 'rename' ? 'Rename ' + flow.name : mode === 'copy' ? 'Copy ' + flow.name : 'New kitchen flow'
  return (
    <Modal title={title} onClose={onClose}
      footer={(
        <Btn variant="primary" className="flex-1" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {mode === 'rename' ? 'Save' : mode === 'copy' ? 'Make the copy' : 'Make the flow'}
        </Btn>
      )}>
      <Field label="Name" hint="Kitchen screens list the flows by name, e.g. Busy night, One cook, Grill down.">
        <input className={inputCls} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="e.g. Busy night"
          onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !save.isPending) save.mutate() }} />
      </Field>
      {mode === 'new' && <p className="text-sm text-muted-foreground">It starts empty: link Orders in to the stations, then on to the expo and boards. To start from this flow instead, use Copy.</p>}
      {mode === 'copy' && <p className="text-sm text-muted-foreground">With the same links and boxes as {flow.name}, ready to change. It isn't in use until you put it in use.</p>}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

function OrderFlowsModal({ venueId, flows, activeId, onClose, onSaved }) {
  const api = useApi()
  const reorder = useMutation({
    mutationFn: ids => api.put(`/pos/venues/${venueId}/kds-flows/order`, { ids }),
    onSuccess: onSaved,
  })
  return (
    <Modal title="Order the kitchen flows" onClose={onClose}>
      <p className="text-sm text-muted-foreground">Drag to change the order. Kitchen screens list the flows in this order.</p>
      <SortableRows items={flows} onReorder={ids => reorder.mutate(ids)}
        renderItem={f => (
          <div className="flex items-center gap-2 min-h-[44px]" data-testid="flow-order-row">
            <span className="flex-1 min-w-0 truncate text-sm font-medium">{f.name}</span>
            {f.id === activeId && <span className="text-[11px] font-semibold text-green-700 shrink-0">In use</span>}
          </div>
        )} />
      <ErrorNote error={reorder.error} />
    </Modal>
  )
}

function AddStationMenu({ onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Btn variant="primary" onClick={() => setOpen(o => !o)}><Plus className="w-4 h-4" /> Add to the flow</Btn>
      {open && (
        <div className="absolute z-20 mt-1 w-56 rounded-xl border bg-background shadow-lg divide-y" role="menu">
          {ADD_KINDS.map(k => (
            <button key={k} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(k) }}
              className="w-full text-left px-3 min-h-[48px] text-sm hover:bg-muted touch-manipulation flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: KIND_STRIP[k] }} />{KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PanelBox({ title, onClose, children, testid }) {
  return (
    <div className="rounded-xl border bg-background overflow-hidden" data-testid={testid}>
      <div className={cn('section-head px-3 flex items-center gap-2', onClose ? 'py-2' : 'py-2.5')}>
        <p className="font-semibold flex-1 min-w-0 truncate">{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -my-2 -mr-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation',
        on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
      {children}
    </button>
  )
}

function LinkPanel({ link, lk, setup, canManage, nameOf, fromBalance, siblings, onChange, onRemove, onClose }) {
  const [q, setQ] = useState('')
  const has = (kind, id) => link.targets.some(t => t.kind === kind && (t.id || null) === (id || null))
  const toggle = (kind, id) => onChange({
    targets: has(kind, id) ? link.targets.filter(t => !(t.kind === kind && (t.id || null) === (id || null))) : [...link.targets, kind === 'default' ? { kind } : { kind, id }],
  })
  const term = q.trim().toLowerCase()
  const matches = term.length >= 2 ? [
    ...(setup.sections || []).filter(s => s.title.toLowerCase().includes(term) && !has('section', s.id)).slice(0, 6).map(s => ({ kind: 'section', id: s.id, label: s.title, sub: lk.sections[s.id]?.menu })),
    ...(setup.items || []).filter(i => i.name.toLowerCase().includes(term) && !has('item', i.id)).slice(0, 8).map(i => ({ kind: 'item', id: i.id, label: i.name, sub: lk.sections[i.section_id]?.title })),
  ] : []
  const streams = (setup.revenue_streams || []).filter(r => r.is_active !== false)
  const types = (setup.order_types || []).filter(t => t.is_active !== false)
  if (fromBalance) {
    return (
      <PanelBox title={nameOf(link.from) + ' to ' + nameOf(link.to)} onClose={onClose} testid="flow-link-panel">
        <p>
          {nameOf(link.from)} shares its dishes between the stations it links to: {BALANCE_RULE}. Its links take every dish it
          gets, so they have no filters.
        </p>
        {canManage && (
          <div className="flex items-center gap-2 pt-1 border-t">
            <span className="flex-1 text-xs text-muted-foreground">Remove this link</span>
            <ConfirmDelete label="Remove link" confirmLabel="Yes, remove" onConfirm={onRemove} />
          </div>
        )}
      </PanelBox>
    )
  }
  return (
    <PanelBox title={nameOf(link.from) + ' to ' + nameOf(link.to)} onClose={onClose} testid="flow-link-panel">
      <div>
        <p className="font-medium">Which dishes go this way</p>
        {!link.targets.length
          ? <p className="text-muted-foreground">Every dish{siblings.length ? ' that no other link from ' + nameOf(link.from) + ' names more closely' : ''}.</p>
          : (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {link.targets.map(t => (
                <span key={t.kind + (t.id || '')} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 pl-3 pr-1 min-h-[36px] text-xs font-medium">
                  {KIND_WORD[t.kind] ? KIND_WORD[t.kind] + ': ' : ''}{targetName(t, lk)}
                  {canManage && (
                    <button type="button" onClick={() => toggle(t.kind, t.id)} aria-label={'Remove ' + targetName(t, lk)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-amber-200 touch-manipulation"><X className="w-3.5 h-3.5" /></button>
                  )}
                </span>
              ))}
            </div>
          )}
      </div>
      {canManage && (
        <>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Order type</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order type">
              {types.map(t => <Chip key={t.id} on={has('order_type', t.id)} onClick={() => toggle('order_type', t.id)}>{t.name}</Chip>)}
            </div>
          </div>
          {streams.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Revenue stream</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Revenue stream">
                {streams.map(r => <Chip key={r.id} on={has('revenue_stream', r.id)} onClick={() => toggle('revenue_stream', r.id)}>{r.name}</Chip>)}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Sections and dishes</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
              <input className={cn(inputCls, 'pl-9')} value={q} onChange={e => setQ(e.target.value)} placeholder="Find a section or dish" aria-label="Find a section or dish" />
            </div>
            {matches.length > 0 && (
              <div className="rounded-lg border divide-y max-h-60 overflow-y-auto">
                {matches.map(m => (
                  <button key={m.kind + m.id} type="button" onClick={() => { toggle(m.kind, m.id); setQ('') }}
                    className="w-full text-left px-3 min-h-[48px] hover:bg-muted touch-manipulation">
                    <span className="text-xs text-muted-foreground">{KIND_WORD[m.kind]}: </span>{m.label}
                    {m.sub && <span className="block text-xs text-muted-foreground">{m.sub}</span>}
                  </button>
                ))}
              </div>
            )}
            {term.length >= 2 && !matches.length && <p className="text-xs text-muted-foreground">Nothing found.</p>}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t">
            <span className="flex-1 text-xs text-muted-foreground">Remove this link</span>
            <ConfirmDelete label="Remove link" confirmLabel="Yes, remove" onConfirm={onRemove} />
          </div>
        </>
      )}
    </PanelBox>
  )
}

function NodePanel({ id, station, setup, links, nameOf, lk, canManage, onEdit, onLink, onTakeOut, onPick, onClose }) {
  const out = links.filter(l => (l.from || START) === id)
  const into = links.filter(l => l.to === id)
  const s = station?.settings || {}
  const [asking, setAsking] = useState(false)
  const linkCount = out.length + into.length
  return (
    <PanelBox title={nameOf(id)} onClose={onClose} testid="flow-node-panel">
      {station
        ? (
          <p className="text-muted-foreground">
            {KIND_LABELS[station.kind]}{!station.is_active ? ' · not in use (dishes pass straight through)' : ''}
            {isBumpKind(station.kind) && <> · amber {s.target_mins} min, red {s.late_mins} min{s.show_upcoming ? ' · shows dishes before they arrive' : ''}</>}
          </p>
        )
        : <p className="text-muted-foreground">Every dish sent from a till and every online order starts here.</p>}
      {station?.kind === 'board' && (
        <p className="text-xs text-muted-foreground">Shows on menu screens: add an Order status block to a board design and pick {station.name}. An order is ready there once every dish on its way to this board has arrived.</p>
      )}
      {station?.kind === 'balance' && (
        <p className="text-xs text-muted-foreground" data-testid="flow-balance-note">
          Shares work between the stations it goes on to: {BALANCE_RULE}.{' '}
          {(s.pieces || []).length
            ? 'Pieces: ' + s.pieces.map(m => m.label + ' counts ' + m.qty).join(', ') + '; any other dish counts its quantity.'
            : 'No pieces set yet (Edit station): each dish counts its quantity.'}{' '}
          {s.split_above != null
            ? 'Big tickets: a ticket with more than ' + s.split_above + ' pieces is shared out, dish line by dish line.'
            : 'Big tickets: each ticket stays on one station.'}
        </p>
      )}
      {station?.kind === 'printer' && (
        <p className="text-xs text-muted-foreground" data-testid="flow-printer-note">
          Prints a ticket of the dishes that reach it, once ({(setup.printers || []).find(p => p.id === s.printer_id)?.name || 'no printer picked yet: Edit station'}).
          Straight after the till and online orders it prints them when they are sent, held courses as HOLD then FIRE; after a kitchen screen, when that screen bumps them. It can go on to a kitchen screen.
        </p>
      )}
      {station?.kind === 'runner' && (
        <p className="text-xs text-muted-foreground">Takes orders out. When the runner is the end of a dish's way, its bump hands the order over (collected).</p>
      )}
      {[['Comes from', into, l => nameOf(l.from)], ['Goes on to', out, l => nameOf(l.to)]].map(([label, list, name]) => (
        <div key={label} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {!list.length && <p className="text-muted-foreground">Nothing yet.</p>}
          {list.map(l => (
            <button key={l.key} type="button" onClick={() => onPick(l.key)}
              className="w-full text-left rounded-lg border px-3 min-h-[44px] hover:bg-muted touch-manipulation">
              <span className="font-medium">{name(l)}</span>
              <span className="block text-xs text-muted-foreground truncate">{linkSummary(l, lk)}</span>
            </button>
          ))}
        </div>
      ))}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {station?.kind !== 'board' && <Btn onClick={onLink}><Link2 className="w-4 h-4" /> Link to...</Btn>}
          {station && <Btn onClick={onEdit}><Pencil className="w-4 h-4" /> Edit station</Btn>}
        </div>
      )}
      {canManage && station && (
        <div className="space-y-2 border-t pt-2">
          {asking ? (
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" onClick={onTakeOut}>
                Yes, take it out{linkCount ? ` (its ${linkCount} link${linkCount === 1 ? '' : 's'} go)` : ''}
              </Btn>
              <Btn onClick={() => setAsking(false)}>Keep</Btn>
            </div>
          ) : (
            <Btn onClick={() => setAsking(true)}><MinusCircle className="w-4 h-4" /> Take out of this flow</Btn>
          )}
          <p className="text-xs text-muted-foreground">
            No dish goes to {station.name} while this flow is in use. The station stays, with its screens, for your other flows;
            to remove it everywhere, delete it under Edit station.
          </p>
        </div>
      )}
    </PanelBox>
  )
}

function CheckPanel({ setup, lk, check, setCheck, route, nameOf, kindOf, onClose }) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const matches = term.length >= 2 ? (setup.items || []).filter(i => i.name.toLowerCase().includes(term)).slice(0, 8) : []
  const item = lk.items[check.item_id]
  // The way as steps: boxes at the same distance from Orders in side by side.
  const steps = useMemo(() => {
    if (!route) return []
    const depth = {}
    const d = (id, n = 0) => {
      if (depth[id] != null) return depth[id]
      const preds = (route[id] || []).filter(p => p !== START)
      depth[id] = !preds.length || n > 40 ? 1 : Math.max(...preds.map(p => d(p, n + 1))) + 1
      return depth[id]
    }
    const by = {}
    for (const id of Object.keys(route)) (by[d(id)] = by[d(id)] || []).push(id)
    return Object.keys(by).sort((a, b) => a - b).map(k => by[k])
  }, [route])
  return (
    <PanelBox title="Check a dish" onClose={onClose} testid="flow-check">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
        <input className={cn(inputCls, 'pl-9')} value={q} onChange={e => setQ(e.target.value)} placeholder={item ? item.name : 'Find a dish'} aria-label="Find a dish to check" />
      </div>
      {matches.length > 0 && (
        <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
          {matches.map(i => (
            <button key={i.id} type="button" onClick={() => { setCheck(c => ({ ...c, item_id: i.id })); setQ('') }}
              className="w-full text-left px-3 min-h-[48px] hover:bg-muted touch-manipulation">
              {i.name}<span className="block text-xs text-muted-foreground">{lk.sections[i.section_id]?.title}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order type">
        {(setup.order_types || []).filter(t => t.is_active !== false).map(t => (
          <Chip key={t.id} on={check.order_type_id === t.id} onClick={() => setCheck(c => ({ ...c, order_type_id: t.id }))}>{t.name}</Chip>
        ))}
      </div>
      {(setup.revenue_streams || []).length > 0 && (
        <select value={check.revenue_stream_id} onChange={e => setCheck(c => ({ ...c, revenue_stream_id: e.target.value }))}
          className={inputCls} aria-label="Revenue stream">
          <option value="">Any revenue stream</option>
          {setup.revenue_streams.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      {item && route && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3" data-testid="flow-check-result">
          <p className="font-medium">{item.name}</p>
          {!steps.length
            ? <p className="text-muted-foreground">No link takes this dish: it won't show on any kitchen screen.</p>
            : (
              <p className="mt-1 leading-7">
                Orders in{steps.map((ids, i) => {
                  // A Balance box's stations: one of them, not all.
                  const shared = ids.length > 1 && ids.every(id => (route[id] || []).some(p => kindOf(p) === 'balance'))
                  return <span key={i}> <span className="text-muted-foreground">&rarr;</span> <b>{ids.map(nameOf).join(shared ? ' or ' : ' + ')}</b></span>
                })}
              </p>
            )}
          {steps.some(ids => ids.some(id => kindOf(id) === 'balance')) && (
            <p className="text-xs text-muted-foreground mt-1">At a Balance box {BALANCE_RULE}.</p>
          )}
        </div>
      )}
      {!item && <p className="text-muted-foreground">Pick a dish to see its way through the kitchen highlighted.</p>}
    </PanelBox>
  )
}
