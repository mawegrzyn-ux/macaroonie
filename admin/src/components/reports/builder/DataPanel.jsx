// src/components/reports/builder/DataPanel.jsx
//
// The report builder's Data panel (docs/REPORTS.md 9): everything a report
// about its subject can use. The subject's figures and fields first, then a
// folder for each linked thing. Tap a field for what it can be (a grouping,
// a value, a filter), or drag it onto a shelf by its grip.
//
// What each field can be comes from pathUses() in shared/reports/build.js
// (through dataTree()), the rules the engine runs by: a field that would
// count twice isn't offered as a total here.
//
//   tree      dataTree(catalogue, subject)
//   spec      the report as it is (what is in it already is ticked)
//   mode      null: everything a field can be. 'rows' | 'columns' | 'values'
//             | 'filters': only what goes on that shelf (the shelves' Add
//             buttons open the panel this way)
//   onAct     ({ type: 'row' | 'column' | 'value' | 'filter', node, ref?,
//             value? }) => { ok, text }: what happened, said for a moment
//             over the foot of the panel
//   drag      show the grips (inside the builder's drag context only)

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  Search, X, ChevronRight, ChevronDown, Check, GripVertical, Sigma, Type, Hash, PoundSterling, Percent,
  Calendar, Clock, ToggleLeft, List, Link2,
} from 'lucide-react'
import { searchTree } from '@shared/reports/build.js'
import { AGG_LABELS } from '@shared/reports/spec.js'
import { inputCls } from '@/components/staff/shared'
import { cn } from '@/lib/utils'

const ICONS = {
  text: Type, number: Hash, money: PoundSterling, percent: Percent, date: Calendar, moment: Calendar,
  time: Clock, duration: Clock, yesno: ToggleLeft, choice: List, id: Link2,
}
const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * What tapping a field offers, for the report's kind and the shelf asked
 * for: [{ key, label, act }]. A list takes columns and filters; a summary
 * groupings, values and filters.
 */
export function actionsFor(node, spec, mode = null) {
  const want = k => !mode || mode === k
  const out = []
  if (spec.kind === 'list') {
    if (node.uses.column && want('rows')) out.push({ key: 'row', label: 'Add as a column', act: { type: 'row', node, ref: { field: node.path } } })
  } else {
    if (node.uses.group && want('rows')) out.push({ key: 'row', label: 'Group by', act: { type: 'row', node, ref: { field: node.path } } })
    if (node.uses.group && want('columns')) out.push({ key: 'column', label: 'Across the top', act: { type: 'column', node, ref: { field: node.path } } })
    if (want('values')) {
      for (const v of node.uses.values) {
        out.push({ key: 'value:' + (v.measure ? 'figure' : v.agg), label: v.measure ? 'Add as a value' : AGG_LABELS[v.agg], act: { type: 'value', node, value: v } })
      }
    }
  }
  if (node.uses.filter && want('filters')) out.push({ key: 'filter', label: 'Filter', act: { type: 'filter', node } })
  return out
}

/** The paths a report already uses, for the ticks. */
export function usedPaths(spec) {
  const out = new Set()
  for (const r of [...spec.rows, ...spec.columns]) out.add(r.field)
  for (const v of spec.values) { if (v.measure) out.add(v.measure); if (v.field) out.add(v.field) }
  const walk = list => {
    for (const f of list || []) {
      if (f.any || f.all) walk(f.any || f.all)
      else if (f.field) out.add(f.field)
    }
  }
  walk(spec.filters)
  return out
}

function Grip({ node }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: 'node:' + node.path, data: { node } })
  return (
    <button type="button" ref={setNodeRef} {...attributes} {...listeners} aria-label={'Drag ' + node.full + ' onto a shelf'} data-testid="data-grip"
      className={cn('w-12 min-h-[48px] shrink-0 flex items-center justify-center text-muted-foreground/60 cursor-grab active:cursor-grabbing touch-none', isDragging && 'opacity-40')}>
      <GripVertical className="w-4 h-4" />
    </button>
  )
}

function NodeRow({ node, spec, mode, used, open, onToggle, onAct, drag, sub, name, from }) {
  const actions = actionsFor(node, spec, mode)
  if (!actions.length) return null
  const Icon = node.what === 'measure' ? Sigma : ICONS[node.type] || Type
  const tap = () => (actions.length === 1 ? onAct(actions[0].act) : onToggle(node.path))
  return (
    <div data-testid="data-node" data-path={node.path} data-open={open ? '1' : '0'}>
      <div className="flex items-stretch">
        {drag && <Grip node={node} />}
        <button type="button" onClick={tap} aria-expanded={actions.length > 1 ? open : undefined} data-testid="data-node-button"
          className={cn('flex-1 min-w-0 flex items-center gap-2 min-h-[48px] py-1.5 pr-2 text-left rounded-lg touch-manipulation hover:bg-muted', !drag && 'pl-2', open && 'bg-muted')}>
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-tight break-words">{name || node.label}</span>
            {(sub || node.pii) && (
              <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 break-words">
                {[sub, node.pii ? 'Personal details' : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          {used.has(node.path) && <Check className="w-4 h-4 text-emerald-600 shrink-0" aria-label="In the report" data-testid="data-node-used" />}
        </button>
      </div>
      {open && actions.length > 1 && (
        <div className={cn('pb-2 pr-2 space-y-2', drag ? 'pl-14' : 'pl-8')} data-testid="data-node-actions">
          {node.about && <p className="text-[11px] text-muted-foreground leading-snug">{node.about}</p>}
          {node.trail.length > 0 && (
            <p className="text-[11px] text-muted-foreground leading-snug" data-testid="data-linked">How this is linked: {[from, ...node.trail].join(' › ')}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {actions.map(a => (
              <button key={a.key} type="button" onClick={() => onAct(a.act)} data-testid="data-action" data-action={a.key}
                className="min-h-[48px] px-3 rounded-lg border bg-background text-xs font-medium touch-manipulation hover:bg-muted">
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DataPanel({ tree, spec, mode = null, onAct, drag = false, className, autoFocus = false }) {
  const [q, setQ] = useState('')
  const [openFolders, setOpenFolders] = useState(() => new Set())
  const [openNode, setOpenNode] = useState(null)
  const [said, setSaid] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const used = useMemo(() => usedPaths(spec), [spec])
  const found = useMemo(() => (q.trim() ? searchTree(tree, q) : null), [tree, q])
  const list = spec.kind === 'list'

  const act = a => {
    const result = onAct(a)
    if (!result) return
    clearTimeout(timer.current)
    setSaid({ path: a.node.path, name: a.node.full, ...result })
    timer.current = setTimeout(() => setSaid(null), 2600)
  }
  const toggleNode = path => setOpenNode(p => (p === path ? null : path))
  const toggleFolder = path => setOpenFolders(s => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const row = (node, more = {}) => (
    <NodeRow key={node.path} node={node} spec={spec} mode={mode} used={used} open={openNode === node.path} onToggle={toggleNode}
      onAct={act} drag={drag} from={tree.subject.label} {...more} />
  )
  const shows = node => actionsFor(node, spec, mode).length > 0
  // A folder is worth showing when something in it can be used.
  const any = part => part.figures.some(shows) || part.fields.some(shows) || (part.node && shows(part.node)) || part.folders.some(any)

  const folder = (f, depth) => {
    if (!any(f)) return null
    const open = openFolders.has(f.path)
    return (
      <div key={f.path} data-testid="data-folder" data-path={f.path} data-open={open ? '1' : '0'}>
        <button type="button" onClick={() => toggleFolder(f.path)} aria-expanded={open}
          className="w-full flex items-center gap-2 min-h-[48px] px-2 py-1.5 text-left rounded-lg touch-manipulation hover:bg-muted">
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-tight break-words">{f.label}</span>
            <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">
              {f.many ? 'Several for each ' + (tree.subject.one || 'row') + ': what adds up' : f.about || 'One for each ' + (tree.subject.one || 'row')}
            </span>
          </span>
        </button>
        {open && (
          <div className={cn('border-l ml-4 pl-1', depth > 0 && 'ml-3')}>
            {f.node && row(f.node, { name: 'The ' + lowerFirst(f.label) + ' itself', sub: f.node.uses.filter === 'venues' ? 'Count them, or pick which venues' : 'Count how many different' })}
            {f.figures.map(n => row(n))}
            {f.fields.map(n => row(n))}
            {f.folders.map(x => folder(x, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const figures = tree.figures.filter(shows)
  const fields = tree.fields.filter(shows)
  const folders = tree.folders.filter(any)

  return (
    <div className={cn('relative flex flex-col min-h-0', className)} data-testid="data-panel" data-mode={mode || 'all'}>
      <div className="p-2 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a field" aria-label="Find a field" autoFocus={autoFocus}
            data-testid="data-search" className={cn(inputCls, 'h-12 pl-9 pr-12')} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear the search"
              className="absolute right-0 top-0 w-12 h-12 flex items-center justify-center text-muted-foreground touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3" data-testid="data-list">
        {found && (
          <>
            {found.filter(shows).map(n => row(n, { name: n.full, sub: n.trail.length ? n.trail.join(' › ') : tree.subject.label }))}
            {!found.some(shows) && <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="data-none">Nothing matches “{q.trim()}”.</p>}
          </>
        )}

        {!found && (
          <>
            {list && !mode && tree.figures.length > 0 && (
              <p className="px-2 pb-2 text-[11px] text-muted-foreground leading-snug" data-testid="data-list-hint">
                A list shows one row for each {tree.subject.one || 'row'}. To add figures up, make it a summary in Set up.
              </p>
            )}
            {figures.length > 0 && (
              <section data-testid="data-figures">
                <h3 className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Figures</h3>
                {figures.map(n => row(n))}
              </section>
            )}
            {fields.length > 0 && (
              <section data-testid="data-fields">
                <h3 className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tree.subject.label}</h3>
                {fields.map(n => row(n))}
              </section>
            )}
            {folders.length > 0 && (
              <section data-testid="data-folders">
                <h3 className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Linked</h3>
                {folders.map(f => folder(f, 0))}
              </section>
            )}
            {!figures.length && !fields.length && !folders.length && (
              <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="data-none">Nothing here can go there.</p>
            )}
          </>
        )}
      </div>

      {/* What a tap did, said over the foot of the panel: nothing under it moves.
          On a phone it sits above the floating Mobile view button. */}
      {said && (
        <p className={cn('absolute left-2 right-2 bottom-2 touch:max-[700px]:bottom-[4.5rem] z-10 rounded-lg border px-3 py-2 text-xs shadow-md pointer-events-none',
          said.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900')}
          role="status" data-testid="data-said" data-path={said.path} data-ok={said.ok ? '1' : '0'}>
          <span className="block font-medium">{said.name}</span>
          <span className="block">{said.text}</span>
        </p>
      )}
    </div>
  )
}
