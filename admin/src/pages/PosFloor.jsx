// src/pages/PosFloor.jsx
//
// Floor plan (/pos/floor, pos_setup): the till's table map. A venue has
// floor areas (Restaurant, Terrace, ...), each a grid of width x height
// units. Tables come from the Tables page; here they're placed, sized,
// shaped and turned, with walls, a bar, plants and labels around them.
// Drag to move, the corner handle to resize, everything snaps to half a
// unit. One explicit Save per area (PUT /pos/floor-areas/:id/layout).
// The till draws the same plan (pos/src/screens/Floor.jsx): rotation 90 /
// 270 swaps width and height, x / y is the top-left of what's drawn.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutPanelTop, Loader2, Plus, Pencil, RotateCw, Square, Circle, Trash2, Type, Minus, Sprout, GlassWater } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import {
  PageHeader, VenueSelect, usePosVenue, usePosSetup, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Btn, NumberBox,
} from '@/components/pos/shared'

const SNAP = 0.5
const snap = v => Math.round(v / SNAP) * SNAP
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const turned = t => t.rotation === 90 || t.rotation === 270
const drawnSize = t => (turned(t) ? { w: t.h, h: t.w } : { w: t.w, h: t.h })
const newId = () => 'd' + Math.random().toString(36).slice(2, 10)

const DECOR = [
  { kind: 'wall', label: 'Wall', icon: Minus, w: 6, h: 0.5 },
  { kind: 'bar', label: 'Bar', icon: GlassWater, w: 6, h: 2, text: 'Bar' },
  { kind: 'plant', label: 'Plant', icon: Sprout, w: 1, h: 1 },
  { kind: 'label', label: 'Label', icon: Type, w: 4, h: 1, text: 'Label' },
]

function defaultSize(table) {
  const c = Number(table.max_covers) || 2
  if (c <= 2) return { w: 2, h: 2 }
  if (c <= 4) return { w: 3, h: 3 }
  if (c <= 6) return { w: 4, h: 3 }
  return { w: 6, h: 3 }
}

function overlaps(a, b) {
  const A = drawnSize(a), B = drawnSize(b)
  return a.x < b.x + B.w && b.x < a.x + A.w && a.y < b.y + B.h && b.y < a.y + A.h
}

/** First free spot for a new table on the area. */
function freeSpot(area, placed, size) {
  for (let y = 1; y + size.h <= area.height; y += 1) {
    for (let x = 1; x + size.w <= area.width; x += 1) {
      const probe = { x, y, ...size, rotation: 0 }
      if (!placed.some(p => overlaps(probe, p))) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

function fitInto(area, el) {
  const s = drawnSize(el)
  return { ...el, x: clamp(el.x, 0, Math.max(0, area.width - s.w)), y: clamp(el.y, 0, Math.max(0, area.height - s.h)) }
}

function draftFor(area, setup) {
  return {
    tables: setup.tables.filter(t => t.floor_area_id === area.id).map(t => fitInto(area, {
      id: t.id, x: Number(t.x) || 0, y: Number(t.y) || 0,
      w: Number(t.w) || defaultSize(t).w, h: Number(t.h) || defaultSize(t).h,
      shape: t.shape || 'rect', rotation: t.rotation || 0,
    })),
    decor: (area.decor || []).map(d => ({ ...d })),
  }
}

function AreaModal({ venueId, setup, area, onClose, onSaved }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: area?.name || '', width: area?.width ?? 24, height: area?.height ?? 16, revenue_centre_id: area?.revenue_centre_id || '',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({ name: form.name.trim(), width: form.width || 24, height: form.height || 16, revenue_centre_id: form.revenue_centre_id || null })
  const save = useMutation({
    mutationFn: () => area ? api.patch(`/pos/floor-areas/${area.id}`, body()) : api.post(`/pos/venues/${venueId}/floor-areas`, body()),
    onSuccess: row => { refresh(); onSaved?.(row); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/floor-areas/${area.id}`), onSuccess: () => { refresh(); onSaved?.(null); onClose() } })
  return (
    <Modal title={area ? 'Edit ' + area.name : 'Add an area'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {area && <ConfirmDelete label="Delete area" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Terrace" /></Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Width (units)" hint="6 to 80"><NumberBox value={form.width} min={6} max={80} onChange={v => set({ width: v })} ariaLabel="Width" /></Field>
        <Field label="Depth (units)" hint="4 to 60"><NumberBox value={form.height} min={4} max={60} onChange={v => set({ height: v })} ariaLabel="Depth" /></Field>
      </div>
      <p className="text-xs text-muted-foreground">A unit is roughly half a metre: a table for two is 2 x 2.</p>
      <Field label="Revenue centre" hint="Checks opened on these tables start in it. Empty: the till's own.">
        <select className={inputCls} value={form.revenue_centre_id} onChange={e => set({ revenue_centre_id: e.target.value })}>
          <option value="">The till's revenue centre</option>
          {setup.revenue_centres.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {area && <p className="text-xs text-muted-foreground">Deleting an area takes its tables off the plan; the tables themselves stay.</p>}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** The plan: tables and decor that drag and resize on a snap grid. */
function Plan({ area, draft, setDraft, selected, setSelected, labels, readOnly }) {
  const box = useRef(null)
  const [width, setWidth] = useState(800)
  const drag = useRef(null)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const scale = clamp(Math.floor(width / area.width), 10, 48)

  function update(kind, id, fn) {
    setDraft(d => ({ ...d, [kind]: d[kind].map(x => (x.id === id ? fn(x) : x)) }))
  }
  function start(e, kind, el, mode) {
    if (readOnly) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setSelected({ kind, id: el.id })
    drag.current = { kind, id: el.id, mode, sx: e.clientX, sy: e.clientY, orig: { ...el } }
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / scale
    const dy = (e.clientY - d.sy) / scale
    update(d.kind, d.id, el => {
      if (d.mode === 'move') return fitInto(area, { ...el, x: snap(d.orig.x + dx), y: snap(d.orig.y + dy) })
      // Resize: the drawn width/height change; map back through the rotation.
      const s = drawnSize(d.orig)
      const minSize = d.kind === 'tables' ? 1 : 0.5
      const dw = clamp(snap(s.w + dx), minSize, Math.min(d.kind === 'tables' ? 20 : 80, area.width - d.orig.x))
      const dh = clamp(snap(s.h + dy), minSize, Math.min(d.kind === 'tables' ? 20 : 60, area.height - d.orig.y))
      return turned(d.orig) ? { ...el, w: dh, h: dw } : { ...el, w: dw, h: dh }
    })
  }
  function end() { drag.current = null }

  const sel = (kind, id) => selected?.kind === kind && selected.id === id
  return (
    <div ref={box} className="w-full overflow-x-auto">
      <div className={cn('relative rounded-xl border bg-background select-none', !readOnly && 'touch-none')}
        style={{
          width: area.width * scale, height: area.height * scale,
          backgroundImage: 'linear-gradient(to right, hsl(var(--border) / .5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / .5) 1px, transparent 1px)',
          backgroundSize: `${scale}px ${scale}px`,
        }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onPointerDown={() => setSelected(null)}
        data-testid="floor-plan">
        {draft.decor.map(d => (
          <div key={d.id} onPointerDown={e => start(e, 'decor', d, 'move')}
            className={cn('absolute flex items-center justify-center text-xs font-semibold text-muted-foreground touch-none', !readOnly && 'cursor-move',
              d.kind === 'wall' ? 'bg-slate-400' : d.kind === 'bar' ? 'bg-amber-100 border border-amber-300 rounded-lg' : d.kind === 'plant' ? 'bg-green-100 rounded-full' : 'border border-dashed',
              sel('decor', d.id) && 'ring-2 ring-primary z-10')}
            style={{ left: d.x * scale, top: d.y * scale, width: d.w * scale, height: d.h * scale }}>
            {d.text}
            {sel('decor', d.id) && <Handle onPointerDown={e => start(e, 'decor', d, 'resize')} />}
          </div>
        ))}
        {draft.tables.map(t => {
          const s = drawnSize(t)
          return (
            <div key={t.id} onPointerDown={e => start(e, 'tables', t, 'move')} data-testid={'table-' + labels[t.id]}
              className={cn('absolute flex items-center justify-center bg-primary/10 border-2 border-primary/50 text-sm font-semibold touch-none', !readOnly && 'cursor-move',
                t.shape === 'round' ? 'rounded-full' : 'rounded-xl', sel('tables', t.id) && 'ring-2 ring-primary ring-offset-2 z-10')}
              style={{ left: t.x * scale, top: t.y * scale, width: s.w * scale, height: s.h * scale }}>
              {labels[t.id]}
              {sel('tables', t.id) && <Handle onPointerDown={e => start(e, 'tables', t, 'resize')} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Handle({ onPointerDown }) {
  return (
    <span onPointerDown={onPointerDown} aria-label="Resize" role="button"
      className="absolute -right-3 -bottom-3 w-7 h-7 rounded-full bg-primary border-2 border-white shadow cursor-nwse-resize touch-none" />
  )
}

export default function PosFloor() {
  const api = useApi()
  const qc = useQueryClient()
  const { venues, venueId, setVenueId, isLoading: venuesLoading } = usePosVenue()
  const { data: setup, isLoading, error } = usePosSetup(venueId)
  const { canManage } = usePermission('pos_setup')
  const [areaId, setAreaId] = useState(null)
  const [editingArea, setEditingArea] = useState(null) // area | 'new' | null
  const [selected, setSelected] = useState(null)
  const area = setup?.floor_areas.find(a => a.id === areaId) || setup?.floor_areas[0] || null
  const saved = useMemo(() => (area && setup ? draftFor(area, setup) : { tables: [], decor: [] }), [area, setup])
  const [draft, setDraft] = useState(saved)
  useEffect(() => { setDraft(saved); setSelected(null) }, [saved])
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const save = useMutation({
    mutationFn: () => api.put(`/pos/floor-areas/${area.id}/layout`, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })

  const labels = Object.fromEntries((setup?.tables || []).map(t => [t.id, t.label]))
  const areaName = id => setup?.floor_areas.find(a => a.id === id)?.name
  const offPlan = (setup?.tables || []).filter(t => !draft.tables.some(p => p.id === t.id))
  const selTable = selected?.kind === 'tables' ? draft.tables.find(t => t.id === selected.id) : null
  const selDecor = selected?.kind === 'decor' ? draft.decor.find(d => d.id === selected.id) : null

  function place(table) {
    const size = defaultSize(table)
    const spot = freeSpot(area, draft.tables, size)
    setDraft(d => ({ ...d, tables: [...d.tables, { id: table.id, ...spot, ...size, shape: 'rect', rotation: 0 }] }))
    setSelected({ kind: 'tables', id: table.id })
  }
  function addDecor(kind) {
    const def = DECOR.find(d => d.kind === kind)
    const el = fitInto(area, { id: newId(), kind, x: 1, y: 1, w: def.w, h: def.h, text: def.text || null })
    setDraft(d => ({ ...d, decor: [...d.decor, el] }))
    setSelected({ kind: 'decor', id: el.id })
  }
  const changeTable = patch => setDraft(d => ({ ...d, tables: d.tables.map(t => (t.id === selTable.id ? fitInto(area, { ...t, ...patch }) : t)) }))
  const changeDecor = patch => setDraft(d => ({ ...d, decor: d.decor.map(x => (x.id === selDecor.id ? fitInto(area, { ...x, ...patch }) : x)) }))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={LayoutPanelTop} title="Floor plan">
        <VenueSelect venues={venues} venueId={venueId} onChange={id => { if (!dirty) setVenueId(id) }} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4 max-w-6xl mx-auto">
          {!venuesLoading && !venues.length && <p className="text-sm text-muted-foreground">Add a venue first.</p>}
          <ErrorNote error={error} />
          {(isLoading || venuesLoading) && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {setup && (
            <>
              {!canManage && <ReadOnlyNotice what="the floor plan" />}
              <div className="flex flex-wrap items-center gap-1.5">
                {setup.floor_areas.map(a => (
                  <button key={a.id} type="button" disabled={dirty && a.id !== area?.id}
                    title={dirty && a.id !== area?.id ? 'Save or discard this area first' : undefined}
                    onClick={() => setAreaId(a.id)}
                    className={cn('min-h-[44px] px-3 rounded-lg border text-sm font-medium touch-manipulation disabled:opacity-40',
                      a.id === area?.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                    {a.name}
                  </button>
                ))}
                {canManage && <Btn onClick={() => setEditingArea('new')} disabled={dirty}><Plus className="w-4 h-4" /> Add an area</Btn>}
                {canManage && area && <Btn onClick={() => setEditingArea(area)} disabled={dirty} title={'Edit ' + area.name}><Pencil className="w-4 h-4" /></Btn>}
              </div>

              {!area && (
                <div className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
                  {canManage
                    ? 'No floor areas yet. Add one (e.g. Restaurant) and place the venue\'s tables on it. Tables are added on the Tables page.'
                    : 'No floor areas yet.'}
                </div>
              )}

              {area && (
                <div className="flex flex-col lg:flex-row gap-4 items-start">
                  <div className="flex-1 min-w-0 w-full space-y-3">
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        {DECOR.map(d => (
                          <Btn key={d.kind} onClick={() => addDecor(d.kind)}><d.icon className="w-4 h-4" /> {d.label}</Btn>
                        ))}
                      </div>
                    )}
                    <Plan area={area} draft={draft} setDraft={setDraft} selected={selected} setSelected={setSelected} labels={labels} readOnly={!canManage} />
                    {canManage && <div className="flex flex-wrap items-center gap-3">
                      <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                        {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save {area.name}
                      </Btn>
                      {dirty && <Btn onClick={() => { setDraft(saved); setSelected(null) }}>Discard</Btn>}
                      {!dirty && save.isSuccess && <span className="text-sm text-green-700">Saved. Tills update straight away.</span>}
                      <ErrorNote error={save.error} />
                    </div>}
                  </div>

                  {canManage && <aside className="w-full lg:w-72 shrink-0 space-y-4">
                    {selTable && (
                      <section className="rounded-xl border bg-background overflow-hidden">
                        <div className="px-4 py-3 section-head"><h2 className="text-sm font-semibold">Table {labels[selTable.id]}</h2></div>
                        <div className="p-4 space-y-3">
                          <div className="flex gap-2">
                            <Btn className={cn('flex-1', selTable.shape === 'rect' && 'ring-2 ring-primary')} onClick={() => changeTable({ shape: 'rect' })}><Square className="w-4 h-4" /> Square</Btn>
                            <Btn className={cn('flex-1', selTable.shape === 'round' && 'ring-2 ring-primary')} onClick={() => changeTable({ shape: 'round' })}><Circle className="w-4 h-4" /> Round</Btn>
                          </div>
                          <Btn className="w-full" onClick={() => changeTable({ rotation: (selTable.rotation + 90) % 360 })}><RotateCw className="w-4 h-4" /> Turn ({selTable.rotation}°)</Btn>
                          <div className="flex gap-3">
                            <Field label="Width"><NumberBox value={selTable.w} decimals={1} min={1} max={20} onChange={v => v && changeTable({ w: snap(v) })} ariaLabel="Table width" className="w-20" /></Field>
                            <Field label="Depth"><NumberBox value={selTable.h} decimals={1} min={1} max={20} onChange={v => v && changeTable({ h: snap(v) })} ariaLabel="Table depth" className="w-20" /></Field>
                          </div>
                          <Btn className="w-full" onClick={() => { setDraft(d => ({ ...d, tables: d.tables.filter(t => t.id !== selTable.id) })); setSelected(null) }}>
                            <Trash2 className="w-4 h-4" /> Take off the plan
                          </Btn>
                        </div>
                      </section>
                    )}
                    {selDecor && (
                      <section className="rounded-xl border bg-background overflow-hidden">
                        <div className="px-4 py-3 section-head"><h2 className="text-sm font-semibold">{DECOR.find(d => d.kind === selDecor.kind)?.label}</h2></div>
                        <div className="p-4 space-y-3">
                          {(selDecor.kind === 'label' || selDecor.kind === 'bar') && (
                            <Field label="Text"><input className={inputCls} value={selDecor.text || ''} maxLength={40} onChange={e => changeDecor({ text: e.target.value })} /></Field>
                          )}
                          <div className="flex gap-3">
                            <Field label="Width"><NumberBox value={selDecor.w} decimals={1} min={0.5} max={80} onChange={v => v && changeDecor({ w: snap(v) })} ariaLabel="Width" className="w-20" /></Field>
                            <Field label="Depth"><NumberBox value={selDecor.h} decimals={1} min={0.5} max={60} onChange={v => v && changeDecor({ h: snap(v) })} ariaLabel="Depth" className="w-20" /></Field>
                          </div>
                          <Btn className="w-full" onClick={() => { setDraft(d => ({ ...d, decor: d.decor.filter(x => x.id !== selDecor.id) })); setSelected(null) }}>
                            <Trash2 className="w-4 h-4" /> Remove
                          </Btn>
                        </div>
                      </section>
                    )}
                    <section className="rounded-xl border bg-background overflow-hidden">
                      <div className="px-4 py-3 section-head">
                        <h2 className="text-sm font-semibold">Tables not on {area.name}</h2>
                        <p className="text-xs text-muted-foreground">Tap one to put it on the plan.</p>
                      </div>
                      <div className="p-3 flex flex-wrap gap-2">
                        {!offPlan.length && <p className="text-sm text-muted-foreground px-1">Every table is on this plan.</p>}
                        {offPlan.map(t => (
                          <button key={t.id} type="button" onClick={() => place(t)}
                            className="min-h-[44px] px-3 rounded-lg border bg-background hover:bg-muted text-sm touch-manipulation text-left">
                            <span className="font-semibold">{t.label}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {t.max_covers ? 'up to ' + t.max_covers : ''}{t.floor_area_id && t.floor_area_id !== area.id ? ' · on ' + areaName(t.floor_area_id) : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </aside>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {canManage && editingArea && setup && (
        <AreaModal venueId={venueId} setup={setup} area={editingArea === 'new' ? null : editingArea}
          onClose={() => setEditingArea(null)} onSaved={row => setAreaId(row?.id || null)} />
      )}
    </div>
  )
}
