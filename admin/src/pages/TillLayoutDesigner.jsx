// src/pages/TillLayoutDesigner.jsx
//
// A till layout (/pos/layouts/:id, migration 228; shared/pos/tillLayout.js):
// the till's order screen as a grid of cells holding zones (the order,
// categories, dishes, your own buttons, a dish's choices, seats). Drag a zone
// to move it and its corner to resize it, or set its place with the steps
// in the panel; each zone has its own grid of buttons, text size and what
// happens when more than fits. The canvas draws each zone's buttons with
// packCells(), as the till does, using the dishes, discounts and tenders of
// the venue picked at the top. Explicit Save; a layout with problems (no
// Order zone, zones overlapping) can't be saved.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Save, PanelsTopLeft, Plus, Minus, Eye, EyeOff, AlertTriangle, Info, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import {
  PageHeader, Section, Field, Btn, Toggle, Segmented, ErrorNote, ConfirmDelete, SortableRows, inputCls,
  usePosVenue, usePosSetup, VenueSelect, ColourPick,
} from '@/components/pos/shared'
import { usedByText } from '@/components/pos/TillLayoutsSection'
import {
  ZONE_TYPES, zoneLabel, GRID_ZONES, OVERFLOWS, CHOICE_KINDS, COVERS, BUTTON_ACTIONS, actionOf,
  normaliseTillLayout, layoutProblems, layoutWarnings, packCells, buttonLabel, choiceZones, overlaps,
  LAYOUT_COLS, LAYOUT_ROWS, ZONE_GRID, FONT, MAX_ZONES, MAX_BUTTONS, LABEL_MAX,
} from '@shared/pos/tillLayout.js'

// Screens to preview on: the till's top bar takes 64 px, the layout the rest.
const SCREENS = [
  { key: '1280x800', w: 1280, h: 800, label: 'Tablet, 1280 x 800' },
  { key: '1024x768', w: 1024, h: 768, label: 'Tablet, 1024 x 768' },
  { key: '1920x1080', w: 1920, h: 1080, label: 'Screen, 1920 x 1080' },
  { key: '800x1280', w: 800, h: 1280, label: 'Upright tablet, 800 x 1280' },
]
const TOP_BAR = 64
const TINTS = { check: '#e0e7ff', categories: '#dcfce7', items: '#fef3c7', buttons: '#fce7f3', modifiers: '#e0f2fe', seats: '#ede9fe' }
const NEEDS_TARGET = { item: 'item_id', discount_preset: 'preset_id', tender: 'tender' }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function freshId(taken, base) {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(base + n)) return base + n
}
const ZONE_BASE = { check: 'order', categories: 'cats', items: 'dishes', buttons: 'buttons', modifiers: 'choices', seats: 'seats' }

/** Where a new zone goes: a free rectangle as near the wanted size as there is. */
function placeZone(layout, type) {
  const { cols, rows, zones } = layout
  const solid = zones.filter(z => z.type !== 'modifiers')
  if (type === 'modifiers') {
    const over = zones.find(z => z.type === 'items') || zones.find(z => z.type === 'categories')
    if (over) return { x: over.x, y: over.y, w: over.w, h: over.h }
  }
  const want = {
    check: { w: Math.round(cols / 3), h: rows },
    categories: { w: Math.round(cols / 2), h: 1 },
    items: { w: Math.round(cols / 2), h: Math.max(2, rows - 2) },
    buttons: { w: Math.round(cols / 2), h: 2 },
    modifiers: { w: Math.round(cols / 2), h: Math.round(rows / 2) },
    seats: { w: Math.round(cols / 2), h: 1 },
  }[type]
  const free = r => type === 'modifiers' || !solid.some(z => overlaps(z, r))
  for (let h = Math.min(rows, want.h); h >= 1; h--) {
    for (let w = Math.min(cols, want.w); w >= 1; w--) {
      for (let y = 0; y + h <= rows; y++) for (let x = 0; x + w <= cols; x++) if (free({ x, y, w, h })) return { x, y, w, h }
    }
  }
  return { x: 0, y: 0, w: 1, h: 1 }
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export default function TillLayoutDesigner() {
  const { id } = useParams()
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canManage } = usePermission('pos_setup')
  const { venues, venueId, setVenueId } = usePosVenue()
  const { data: setup } = usePosSetup(venueId)
  const { data: discounts = [] } = useQuery({ queryKey: ['pos-discounts'], queryFn: () => api.get('/pos/discounts') })
  const { data: saved, error, isLoading } = useQuery({ queryKey: ['till-layout', id], queryFn: () => api.get('/pos/till-layouts/' + id) })
  const [draft, setDraft] = useState(null)
  const [selId, setSelId] = useState(null)
  // The button being edited in the selected zone: its page shows in the preview.
  const [selB, setSelB] = useState(null)
  // Dish choices zones start hidden: the screen as the till shows it between dishes.
  const [showChoices, setShowChoices] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [screenKey, setScreenKey] = useState(() => { try { return localStorage.getItem('maca_layout_screen') || SCREENS[0].key } catch { return SCREENS[0].key } })

  useEffect(() => { if (saved) setDraft({ name: saved.name, layout: normaliseTillLayout(saved.layout) }) }, [saved])
  useEffect(() => setSelB(null), [selId])

  const save = useMutation({
    mutationFn: () => api.put('/pos/till-layouts/' + id, { name: draft.name.trim() || saved.name, layout: draft.layout }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['till-layout', id] })
      qc.invalidateQueries({ queryKey: ['till-layouts'] })
      qc.invalidateQueries({ queryKey: ['pos-setup'] })
    },
  })

  // The venue's sections and dishes by id, for the preview and the pickers.
  const names = useMemo(() => {
    const sections = new Map((setup?.sections || []).map(s => [s.id, s]))
    const items = Object.fromEntries((setup?.items || []).map(i => [i.id, i]))
    return { sections, items }
  }, [setup])

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={PanelsTopLeft} title="Till layout" />
        <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}</div>
      </div>
    )
  }

  const layout = draft.layout
  const dirty = JSON.stringify(draft) !== JSON.stringify({ name: saved.name, layout: normaliseTillLayout(saved.layout) })
  const problems = layoutProblems(layout)
  const warnings = layoutWarnings(layout)
  const sel = layout.zones.find(z => z.id === selId) || null
  const setLayout = fn => setDraft(d => ({ ...d, layout: normaliseTillLayout(fn(d.layout)) }))
  const patchZone = (zid, patch) => setLayout(l => ({ ...l, zones: l.zones.map(z => (z.id === zid ? { ...z, ...patch } : z)) }))
  const addZone = type => {
    const taken = new Set(layout.zones.map(z => z.id))
    const zid = freshId(taken, ZONE_BASE[type])
    const base = { id: zid, type, ...placeZone(layout, type) }
    if (type === 'modifiers') {
      const kinds = layout.zones.filter(z => z.type === 'modifiers').map(z => z.kind)
      base.kind = kinds.includes('required') ? 'optional' : kinds.includes('optional') ? 'required' : kinds.includes('all') ? 'optional' : 'all'
    }
    setLayout(l => ({ ...l, zones: [...l.zones, base] }))
    setSelId(zid)
  }
  const removeZone = zid => { setLayout(l => ({ ...l, zones: l.zones.filter(z => z.id !== zid) })); setSelId(null) }
  const screen = SCREENS.find(s => s.key === screenKey) || SCREENS[0]
  const pickScreen = k => { setScreenKey(k); try { localStorage.setItem('maca_layout_screen', k) } catch { /* private mode */ } }
  const back = () => (dirty ? setLeaving(true) : navigate('/pos/layouts'))
  const tenders = setup?.settings?.tenders || []
  const ctx = { setup, names, discounts, tenders, layout }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={PanelsTopLeft} title={'Till layout: ' + saved.name}>
        <Btn onClick={back} data-testid="tl-back"><ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Till layouts</span></Btn>
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
        {canManage && (
          <>
            <Btn disabled={!dirty || save.isPending} onClick={() => { setDraft({ name: saved.name, layout: normaliseTillLayout(saved.layout) }); save.reset() }} data-testid="tl-discard">Discard</Btn>
            <Btn variant="primary" disabled={!dirty || save.isPending || problems.length > 0} onClick={() => save.mutate()} data-testid="tl-save"
              title={problems.length ? 'Fix the problems first' : undefined}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save' : 'Saved'}
            </Btn>
          </>
        )}
      </PageHeader>
      {leaving && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-amber-50 text-amber-900 text-sm" role="alert" data-testid="tl-leave">
          <span className="flex-1 min-w-[200px]">Leave without saving your changes?</span>
          <Btn variant="danger" onClick={() => navigate('/pos/layouts')}>Leave</Btn>
          <Btn onClick={() => setLeaving(false)}>Stay</Btn>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start max-w-[1600px] mx-auto">
          <div className="space-y-3 min-w-0">
            {!canManage && <ReadOnlyNotice what="till layouts" />}
            <ErrorNote error={save.error} />
            <div className="flex flex-wrap items-center gap-2">
              <select value={screen.key} onChange={e => pickScreen(e.target.value)} aria-label="Screen to preview on" data-testid="tl-screen"
                className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation">
                {SCREENS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {layout.zones.some(z => z.type === 'modifiers') && (
                <Btn onClick={() => setShowChoices(v => !v)} aria-pressed={showChoices} data-testid="tl-show-choices">
                  {showChoices ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showChoices ? 'Hide dish choices zones' : 'Show dish choices zones'}
                </Btn>
              )}
              <span className="text-xs text-muted-foreground">Dishes, discounts and tenders from {setup?.venue?.name || 'the venue'}.</span>
            </div>
            <Canvas layout={layout} screen={screen} selId={selId} onSelect={setSelId} showChoices={showChoices}
              canEdit={canManage} onMove={patchZone} ctx={ctx} focus={selB}
              bad={new Set(problems.flatMap(p => p.zones))} />
            <p className="text-xs text-muted-foreground">
              Tap a zone to change it. {canManage ? 'Drag it to move it, its corner to resize it. ' : ''}Dish choices zones show only while a dish is being added, over the zones under them.
            </p>
          </div>

          <div className="space-y-4 min-w-0 lg:sticky lg:top-0" data-testid="tl-panel">
            {sel
              ? <ZonePanel zone={sel} ctx={ctx} canManage={canManage} onBack={() => setSelId(null)} selB={selB} setSelB={setSelB}
                  onChange={patch => patchZone(sel.id, patch)} onRemove={() => removeZone(sel.id)} />
              : (
                <>
                  <ReadOnlyFieldset disabled={!canManage}>
                    <Section title="Layout">
                      <Field label="Name">
                        <input className={inputCls} value={draft.name} maxLength={60} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="tl-name" />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Stepper label="Cells across" value={layout.cols} min={LAYOUT_COLS.min} max={LAYOUT_COLS.max} testid="tl-cols"
                          onChange={v => setLayout(l => ({ ...l, cols: v }))} />
                        <Stepper label="Cells down" value={layout.rows} min={LAYOUT_ROWS.min} max={LAYOUT_ROWS.max} testid="tl-rows"
                          onChange={v => setLayout(l => ({ ...l, rows: v }))} />
                      </div>
                      <p className="text-xs text-muted-foreground">The screen is split into this grid; each zone takes a block of its cells.</p>
                    </Section>
                  </ReadOnlyFieldset>
                  <Section title="Zones" hint="Tap one to change it.">
                    <div className="space-y-1.5" data-testid="tl-zones">
                      {layout.zones.map(z => (
                        <button key={z.id} type="button" onClick={() => setSelId(z.id)} data-testid="tl-zone-row" data-zone-id={z.id}
                          className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-lg border bg-background hover:bg-muted text-left touch-manipulation">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: TINTS[z.type] }} />
                          <span className="text-sm font-medium flex-1 min-w-0 truncate">{zoneLabel(z.type)}{z.type === 'modifiers' ? ': ' + CHOICE_KINDS.find(k => k.key === z.kind)?.label : ''}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{z.w} x {z.h}</span>
                        </button>
                      ))}
                    </div>
                    {canManage && (
                      <label className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                        <select className={cn(inputCls, 'flex-1')} value="" disabled={layout.zones.length >= MAX_ZONES}
                          onChange={e => e.target.value && addZone(e.target.value)} aria-label="Add a zone" data-testid="tl-add-zone">
                          <option value="">Add a zone…</option>
                          {ZONE_TYPES.map(t => {
                            const full = layout.zones.filter(z => z.type === t.key).length >= t.max
                            return <option key={t.key} value={t.key} disabled={full}>{t.label}{full ? ' (has one)' : ''}</option>
                          })}
                        </select>
                      </label>
                    )}
                  </Section>
                  <Notes problems={problems} warnings={warnings} onPick={setSelId} />
                  <p className="text-xs text-muted-foreground" data-testid="tl-used-by">{usedByText(saved.used_by, venues)}.</p>
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** What stops a save (red) and what is worth knowing (amber). */
function Notes({ problems, warnings, onPick }) {
  if (!problems.length && !warnings.length) return null
  return (
    <div className="space-y-2" data-testid="tl-notes">
      {problems.map((p, i) => (
        <button key={'p' + i} type="button" onClick={() => p.zones[0] && onPick(p.zones[0])} data-testid="tl-problem" data-code={p.code}
          className="w-full text-left flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm touch-manipulation">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {p.message}
        </button>
      ))}
      {warnings.map((w, i) => (
        <button key={'w' + i} type="button" onClick={() => w.zones[0] && onPick(w.zones[0])} data-testid="tl-warning" data-code={w.code}
          className="w-full text-left flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm touch-manipulation">
          <Info className="w-4 h-4 shrink-0 mt-0.5" /> {w.message}
        </button>
      ))}
    </div>
  )
}

/** A number with − and + (48 px), for places, sizes and grids. */
function Stepper({ label, value, min, max, step = 1, onChange, testid }) {
  return (
    <Field group label={label}>
      <div className="flex items-center gap-1" data-testid={testid}>
        <button type="button" className="w-12 h-12 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation disabled:opacity-40"
          disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))} aria-label={label + ': less'}><Minus className="w-4 h-4" /></button>
        <span className="w-10 text-center text-sm font-semibold tabular-nums" data-value={value}>{value}</span>
        <button type="button" className="w-12 h-12 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation disabled:opacity-40"
          disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))} aria-label={label + ': more'}><Plus className="w-4 h-4" /></button>
      </div>
    </Field>
  )
}

// ── The canvas ─────────────────────────────────────────────────────

function Canvas({ layout, screen, selId, onSelect, showChoices, canEdit, onMove, ctx, bad, focus = null }) {
  const ref = useRef(null)
  const width = useWidth(ref)
  const scale = width ? width / screen.w : 0
  const barH = TOP_BAR * scale
  const height = (screen.h - TOP_BAR) * scale
  const cw = width / layout.cols
  const rh = height / layout.rows
  const drag = useRef(null)
  const [ghost, setGhost] = useState(null)
  const ghostRef = useRef(null)
  const setG = g => { ghostRef.current = g; setGhost(g) }

  const start = (e, z, mode) => {
    e.stopPropagation()
    onSelect(z.id)
    if (!canEdit) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { z, mode, sx: e.clientX, sy: e.clientY }
    setG({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })
  }
  const move = e => {
    const d = drag.current
    if (!d || !cw || !rh) return
    const dx = Math.round((e.clientX - d.sx) / cw)
    const dy = Math.round((e.clientY - d.sy) / rh)
    if (d.mode === 'move') {
      setG({ id: d.z.id, w: d.z.w, h: d.z.h, x: clamp(d.z.x + dx, 0, layout.cols - d.z.w), y: clamp(d.z.y + dy, 0, layout.rows - d.z.h) })
    } else {
      setG({ id: d.z.id, x: d.z.x, y: d.z.y, w: clamp(d.z.w + dx, 1, layout.cols - d.z.x), h: clamp(d.z.h + dy, 1, layout.rows - d.z.y) })
    }
  }
  const end = () => {
    const d = drag.current
    const g = ghostRef.current
    drag.current = null
    setG(null)
    if (d && g && (g.x !== d.z.x || g.y !== d.z.y || g.w !== d.z.w || g.h !== d.z.h)) onMove(d.z.id, { x: g.x, y: g.y, w: g.w, h: g.h })
  }

  const at = z => (ghost?.id === z.id ? { ...z, ...ghost } : z)
  const solid = layout.zones.filter(z => z.type !== 'modifiers')
  const mods = layout.zones.filter(z => z.type === 'modifiers')
  const bar = choiceZones(layout).required
  const drawn = [...solid, ...(showChoices ? mods : mods.filter(m => m.id === selId))]
  // The selected zone on top, so its handle can always be reached.
  drawn.sort((a, b) => (a.id === selId) - (b.id === selId))

  return (
    <div ref={ref} className="w-full rounded-xl border bg-white overflow-hidden select-none" data-testid="tl-canvas"
      style={{ touchAction: 'none' }} onPointerDown={() => onSelect(null)}>
      <div style={{ height: barH }} className="bg-slate-800 text-white/70 flex items-center px-2 overflow-hidden"
        aria-hidden="true"><span style={{ fontSize: Math.max(8, 14 * scale) }}>The till's top bar</span></div>
      <div className="relative" style={{ height }}>
        {/* The cells. */}
        <div className="absolute inset-0 grid" aria-hidden="true"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}>
          {Array.from({ length: layout.cols * layout.rows }).map((_, i) => <div key={i} className="border border-dashed border-slate-200" />)}
        </div>
        {width > 0 && drawn.map(z0 => {
          const z = at(z0)
          const isSel = z.id === selId
          const isMod = z.type === 'modifiers'
          const clash = ghost?.id === z.id && !isMod && solid.some(o => o.id !== z.id && overlaps(o, z))
          return (
            <div key={z.id} data-testid="tl-zone" data-zone-id={z.id} data-type={z.type} data-selected={isSel ? '1' : '0'}
              data-x={z.x} data-y={z.y} data-w={z.w} data-h={z.h}
              onPointerDown={e => start(e, z0, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              className={cn('absolute rounded-md overflow-hidden', canEdit ? 'cursor-move' : 'cursor-pointer',
                isSel ? 'ring-4 ring-primary z-30' : isMod ? 'z-20' : 'z-10',
                (bad.has(z.id) || clash) && 'ring-4 ring-red-500')}
              style={{
                left: z.x * cw + 2, top: z.y * rh + 2, width: z.w * cw - 4, height: z.h * rh - 4,
                background: isMod ? 'rgba(224, 242, 254, 0.88)' : TINTS[z.type],
                border: isMod ? '2px dashed #0284c7' : '1px solid rgba(15, 23, 42, 0.15)',
              }}>
              <span className="absolute left-1 top-1 z-10 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 pointer-events-none">
                {zoneLabel(z.type)}{isMod ? ' · ' + CHOICE_KINDS.find(k => k.key === z.kind)?.label + (z.cover === 'screen' ? ' · whole screen' : '') : ''}
              </span>
              <div className="absolute inset-0 p-1 pt-6 pointer-events-none">
                <ZonePreview zone={z} scale={scale} ctx={ctx} hasBar={bar?.id === z.id} focus={isSel ? focus : null} />
              </div>
              {isSel && canEdit && (
                <span onPointerDown={e => start(e, z0, 'size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                  data-testid="tl-resize" aria-label={'Resize ' + zoneLabel(z.type)}
                  className="absolute right-0 bottom-0 w-11 h-11 flex items-end justify-end cursor-nwse-resize touch-none">
                  <span className="w-5 h-5 m-1 rounded-sm bg-primary border-2 border-white shadow" />
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// What a zone shows, drawn small: the same packing as the till.
function ZonePreview({ zone, scale, ctx, hasBar, focus = null }) {
  const font = Math.max(7, (zone.font || FONT.default) * scale)
  if (zone.type === 'check') return <CheckPreview scale={scale} />
  if (zone.type === 'seats') {
    return (
      <div className="h-full flex items-center gap-1 overflow-hidden" style={{ fontSize: font }}>
        <span className="opacity-60">Seat</span>
        {['Shared', '1', '2', '3', '4'].map((s, i) => <span key={s} className={cn('rounded border px-1.5 bg-white', i === 0 && 'bg-slate-800 text-white')}>{s}</span>)}
        <span className="opacity-60 ml-1">Course</span>
        <span className="rounded border px-1.5 bg-slate-800 text-white">Usual</span>
      </div>
    )
  }
  const cells = previewCells(zone, ctx)
  return (
    <div className="h-full flex flex-col min-h-0">
      {zone.type === 'items' && zone.search && <div className="shrink-0 rounded border bg-white px-1 mb-0.5 text-slate-400" style={{ fontSize: Math.max(7, 12 * scale) }}>Find a dish</div>}
      {zone.type === 'modifiers' && hasBar && <div className="shrink-0 font-bold truncate" style={{ fontSize: Math.max(7, 16 * scale) }}>A dish's name</div>}
      <div className="flex-1 min-h-0"><GridPreview zone={zone} cells={cells} font={font} focus={focus} /></div>
      {zone.type === 'modifiers' && hasBar && (
        <div className="shrink-0 flex gap-0.5 mt-0.5" style={{ fontSize: Math.max(7, 12 * scale) }}>
          <span className="rounded border bg-white px-1">− 1 +</span>
          <span className="rounded border bg-white px-1">Cancel</span>
          <span className="flex-1 rounded bg-primary text-primary-foreground text-center">Add</span>
        </div>
      )}
    </div>
  )
}

function CheckPreview({ scale }) {
  const f = Math.max(7, 13 * scale)
  return (
    <div className="h-full flex flex-col bg-white rounded" style={{ fontSize: f }}>
      <div className="border-b px-1 font-bold">Order #101</div>
      <div className="flex-1 px-1 space-y-0.5 overflow-hidden">
        {['Pad Thai', 'Spring rolls', 'Cola'].map(n => <div key={n} className="flex justify-between"><span>1 {n}</span><span>£6.50</span></div>)}
      </div>
      <div className="grid grid-cols-4 gap-0.5 p-0.5">
        {['More', 'Send', 'Bill', 'Pay'].map(b => <span key={b} className={cn('rounded border text-center', b === 'Pay' && 'bg-green-600 text-white')}>{b}</span>)}
      </div>
    </div>
  )
}

/** The cells a zone holds, from the venue's menus and the zone's buttons. */
function previewCells(zone, { setup, names, discounts, tenders, layout }) {
  if (zone.type === 'categories') {
    const ids = zone.sections || (setup?.sections || []).map(s => s.id)
    return ids.map(sid => names.sections.get(sid)).filter(Boolean).map(s => ({ key: s.id, label: s.title }))
  }
  if (zone.type === 'items') {
    const cats = layout.zones.find(z => z.type === 'categories')
    const first = cats?.sections?.[0] || (setup?.sections || [])[0]?.id
    const list = cats ? (setup?.items || []).filter(i => i.section_id === first) : (setup?.items || [])
    return list.map(i => ({ key: i.id, label: i.name, sub: zone.price ? '£' : null }))
  }
  if (zone.type === 'buttons') {
    return zone.buttons.map(b => ({
      key: b.id, w: b.w, h: b.h, colour: b.colour,
      label: buttonLabel(b, { items: names.items, presets: discounts, tenders }),
    }))
  }
  if (zone.type === 'modifiers') {
    const head = t => ({ key: t, label: t, w: zone.cols, head: true })
    const opts = (p, n) => Array.from({ length: n }).map((_, i) => ({ key: p + i, label: 'Choice ' + (i + 1) }))
    if (zone.kind === 'required') return [head('Must pick'), ...opts('r', 4)]
    if (zone.kind === 'optional') return [head('Optional'), ...opts('o', 4)]
    return [head('Must pick'), ...opts('r', 3), head('Optional'), ...opts('o', 3)]
  }
  return []
}

function inkOn(hex) {
  const n = parseInt(String(hex).slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#ffffff'
}

function GridPreview({ zone, cells, font, focus = null }) {
  const packed = packCells(cells.map(c => ({ w: c.w || 1, h: c.h || 1 })), zone)
  // The button being edited: the page that holds it, outlined; behind More, More is.
  const fi = focus ? cells.findIndex(c => c.key === focus) : -1
  const at = fi < 0 ? 0 : Math.max(0, packed.pages.findIndex(pg => pg.some(p => p.i === fi)))
  const inMore = fi >= 0 && packed.rest.includes(fi)
  const page = (packed.pages[at] || []).filter(p => p.x < zone.cols && p.y < zone.rows)
  const scrolls = zone.overflow === 'scroll' && (packed.rows > zone.rows || packed.cols > zone.cols)
  if (!cells.length) return <div className="h-full flex items-center justify-center text-center text-slate-500 text-[10px]">Nothing here yet</div>
  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontSize: font, fontWeight: zone.bold === false ? 500 : 700 }} data-testid="tl-grid"
      data-pages={packed.pages.length} data-rest={packed.rest.length} data-hidden={packed.hidden} data-scrolls={scrolls ? '1' : '0'}>
      <div className="flex-1 min-h-0 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${zone.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${zone.rows}, minmax(0, 1fr))` }}>
        {page.map(p => {
          const c = cells[p.i]
          return (
            <div key={c.key} className={cn('min-w-0 min-h-0 rounded-sm overflow-hidden px-0.5 leading-tight', c.head ? 'text-slate-600' : 'border bg-white')}
              style={{
                gridColumn: `${p.x + 1} / span ${Math.min(p.w, zone.cols - p.x)}`, gridRow: `${p.y + 1} / span ${Math.min(p.h, zone.rows - p.y)}`,
                ...(c.colour ? { background: c.colour, color: inkOn(c.colour), borderColor: c.colour } : {}),
                ...(p.i === fi ? { outline: '2px solid #0284c7', outlineOffset: '-2px' } : {}),
              }}
              data-testid="tl-cell" data-focus={p.i === fi ? '1' : undefined}>
              <span className="line-clamp-2 break-words">{c.label}</span>
            </div>
          )
        })}
        {packed.rest.length > 0 && (
          <div className="rounded-sm border border-dashed border-primary text-primary flex items-center justify-center text-center" data-focus={inMore ? '1' : undefined}
            style={{ gridColumn: `${zone.cols} / span 1`, gridRow: `${zone.rows} / span 1`, ...(inMore ? { outline: '2px solid #0284c7', outlineOffset: '-2px' } : {}) }}>
            More ({packed.rest.length})
          </div>
        )}
      </div>
      {(packed.pages.length > 1 || scrolls || packed.hidden > 0) && (
        <div className="shrink-0 text-center text-[9px] font-semibold text-slate-600 leading-tight">
          {packed.pages.length > 1 ? '‹ ' + (at + 1) + ' / ' + packed.pages.length + ' ›' : scrolls ? (packed.cols > zone.cols ? 'scrolls across' : 'scrolls down') : packed.hidden + ' left out'}
        </div>
      )}
    </div>
  )
}

// ── A zone's settings ──────────────────────────────────────────────

function ZonePanel({ zone, ctx, canManage, onBack, onChange, onRemove, selB = null, setSelB = () => {} }) {
  const t = ZONE_TYPES.find(x => x.key === zone.type)
  const { layout } = ctx
  return (
    <Section title={t.label} hint={t.hint}
      actions={<Btn onClick={onBack} data-testid="tl-zone-back"><ArrowLeft className="w-4 h-4" /> Layout</Btn>}>
      <ReadOnlyFieldset disabled={!canManage}>
        <div className="space-y-4" data-testid="tl-zone-panel" data-zone-id={zone.id} data-type={zone.type}>
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="From the left" value={zone.x} min={0} max={layout.cols - zone.w} onChange={v => onChange({ x: v })} testid="tl-x" />
            <Stepper label="From the top" value={zone.y} min={0} max={layout.rows - zone.h} onChange={v => onChange({ y: v })} testid="tl-y" />
            <Stepper label="Wide" value={zone.w} min={1} max={layout.cols - zone.x} onChange={v => onChange({ w: v })} testid="tl-w" />
            <Stepper label="High" value={zone.h} min={1} max={layout.rows - zone.y} onChange={v => onChange({ h: v })} testid="tl-h" />
          </div>
          {GRID_ZONES.includes(zone.type) && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stepper label="Buttons across" value={zone.cols} min={ZONE_GRID.min} max={ZONE_GRID.max} onChange={v => onChange({ cols: v })} testid="tl-zone-cols" />
                <Stepper label="Buttons down" value={zone.rows} min={ZONE_GRID.min} max={ZONE_GRID.max} onChange={v => onChange({ rows: v })} testid="tl-zone-rows" />
              </div>
              <p className="text-xs text-muted-foreground -mt-2">The buttons take their size from these: fewer across and down makes them bigger.</p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <Stepper label="Text size" value={zone.font} min={FONT.min} max={FONT.max} onChange={v => onChange({ font: v })} testid="tl-font" />
                <Toggle label="Bold" checked={zone.bold} onChange={v => onChange({ bold: v })} />
              </div>
              <Field group label="When more than fits">
                <div className="grid grid-cols-2 gap-2" data-testid="tl-overflow">
                  {OVERFLOWS.map(o => (
                    <button key={o.key} type="button" aria-pressed={zone.overflow === o.key} data-k={o.key} onClick={() => onChange({ overflow: o.key })}
                      className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', zone.overflow === o.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">{OVERFLOW_HINTS[zone.overflow]}</p>
            </>
          )}
          {zone.type === 'categories' && <CategoriesPicker zone={zone} ctx={ctx} onChange={onChange} />}
          {zone.type === 'items' && (
            <div className="space-y-1">
              <Toggle label="Search box on top" checked={zone.search} onChange={v => onChange({ search: v })} />
              <Toggle label="Prices on the buttons" checked={zone.price} onChange={v => onChange({ price: v })} />
            </div>
          )}
          {zone.type === 'buttons' && <ButtonsEditor zone={zone} ctx={ctx} canManage={canManage} onChange={onChange} selB={selB} setSelB={setSelB} />}
          {zone.type === 'modifiers' && (
            <>
              <Field group label="Shows">
                <Segmented value={zone.kind} options={CHOICE_KINDS.map(k => ({ value: k.key, label: k.label }))} onChange={v => onChange({ kind: v })} />
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                Must pick: the choices a dish needs (a size, a sauce). Optional: the extras. With one zone for each, the till splits them; the Add button goes with the must-pick ones.
              </p>
              <Field group label="Draws over">
                <Segmented value={zone.cover} options={COVERS.map(c => ({ value: c.key, label: c.label }))} onChange={v => onChange({ cover: v })} />
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                {zone.cover === 'screen' ? 'Over the whole screen while a dish is being added: every choice shows here.' : 'Over the zones under its own space while a dish is being added.'}
              </p>
            </>
          )}
          {zone.type === 'seats' && (
            <Stepper label="Text size" value={zone.font} min={FONT.min} max={FONT.max} onChange={v => onChange({ font: v })} testid="tl-font" />
          )}
        </div>
      </ReadOnlyFieldset>
      {canManage && (
        <div className="pt-2 border-t">
          <ConfirmDelete label={'Take out the ' + t.label + ' zone'} confirmLabel="Yes, take it out" onConfirm={onRemove} />
        </div>
      )}
    </Section>
  )
}

const OVERFLOW_HINTS = {
  scroll: 'The rest carries on: down, or across in a zone one button high.',
  pages: 'The rest goes on more pages, with arrows under the zone.',
  more: 'The last button becomes More: it opens a window with the rest.',
  hide: 'The rest isn\'t shown.',
}

function CategoriesPicker({ zone, ctx, onChange }) {
  const { setup, names } = ctx
  const sections = setup?.sections || []
  const menus = setup?.menus || []
  const picked = zone.sections
  const rest = sections.filter(s => !(picked || []).includes(s.id))
  const menuName = mid => menus.find(m => m.id === mid)?.name || ''
  return (
    <div className="space-y-3" data-testid="tl-sections">
      <Field group label="Which categories">
        <Segmented value={picked ? 'pick' : 'all'} options={[{ value: 'all', label: 'All of the till\'s menus' }, { value: 'pick', label: 'Pick them' }]}
          onChange={v => onChange({ sections: v === 'pick' ? sections.map(s => s.id) : null })} />
      </Field>
      {!picked && <p className="text-xs text-muted-foreground">Every section of the menus the till's revenue stream offers, in menu order.</p>}
      {picked && (
        <>
          <p className="text-xs text-muted-foreground">In this order on the till. Drag to change it. A section that isn't on a till's menus doesn't show there.</p>
          <SortableRows items={picked.map(sid => ({ id: sid }))} onReorder={ids => onChange({ sections: ids })}
            renderItem={r => (
              <div className="flex items-center gap-2 min-h-[44px]" data-testid="tl-section" data-id={r.id}>
                <span className="flex-1 min-w-0 text-sm truncate">
                  {names.sections.get(r.id)?.title || 'A section on another venue\'s menus'}
                  {names.sections.get(r.id) && <span className="text-xs text-muted-foreground"> · {menuName(names.sections.get(r.id).menu_id)}</span>}
                </span>
                <button type="button" onClick={() => onChange({ sections: picked.filter(x => x !== r.id) })} aria-label={'Take out ' + (names.sections.get(r.id)?.title || 'section')}
                  className="w-11 h-11 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation"><X className="w-4 h-4" /></button>
              </div>
            )} />
          {rest.length > 0 && (
            <label className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
              <select className={cn(inputCls, 'flex-1')} value="" onChange={e => e.target.value && onChange({ sections: [...picked, e.target.value] })} aria-label="Add a category" data-testid="tl-add-section">
                <option value="">Add a category…</option>
                {menus.map(m => (
                  <optgroup key={m.id} label={m.name}>
                    {rest.filter(s => s.menu_id === m.id).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  )
}

const ACTION_GROUPS = [...new Set(BUTTON_ACTIONS.map(a => a.group))]

/** The dish, discount or tender a button points at. */
function TargetPick({ action, value, ctx, onChange }) {
  const { setup, discounts, tenders } = ctx
  if (action === 'item') {
    const sections = setup?.sections || []
    return (
      <Field label="Dish">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a dish…</option>
          {sections.map(s => (
            <optgroup key={s.id} label={s.title}>
              {(setup?.items || []).filter(i => i.section_id === s.id).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
    )
  }
  if (action === 'discount_preset') {
    return (
      <Field label="Discount" hint="From the company's list (Store tech → Discounts). One that needs a manager still asks for one.">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a discount…</option>
          {discounts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
    )
  }
  if (action === 'tender') {
    return (
      <Field label="Pays by" hint="Opens Pay with this one picked.">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a tender…</option>
          {tenders.map(t => <option key={t.key} value={t.key} disabled={!t.enabled}>{t.label}{t.enabled ? '' : ' (switched off)'}</option>)}
        </select>
      </Field>
    )
  }
  return null
}

function ButtonsEditor({ zone, ctx, canManage, onChange, selB, setSelB }) {
  const [adding, setAdding] = useState(null)   // { action, target }
  const { names, discounts, tenders } = ctx
  const b = zone.buttons.find(x => x.id === selB) || null
  const label = x => buttonLabel(x, { items: names.items, presets: discounts, tenders })
  const setButtons = list => onChange({ buttons: list })
  const patchB = (bid, patch) => setButtons(zone.buttons.map(x => (x.id === bid ? { ...x, ...patch } : x)))
  const addButton = (action, target = null) => {
    const taken = new Set(zone.buttons.map(x => x.id))
    const bid = freshId(taken, 'b' + (zone.buttons.length + 1))
    const nb = { id: bid, action, w: 1, h: 1 }
    if (NEEDS_TARGET[action]) nb[NEEDS_TARGET[action]] = target
    setButtons([...zone.buttons, nb])
    setAdding(null)
    setSelB(bid)
  }
  return (
    <div className="space-y-3" data-testid="tl-buttons">
      <p className="text-xs font-medium text-muted-foreground">Buttons, in order (drag to change it)</p>
      {!zone.buttons.length && <p className="text-sm text-muted-foreground">No buttons yet.</p>}
      <SortableRows items={zone.buttons} locked={!canManage} onReorder={ids => setButtons(ids.map(i => zone.buttons.find(x => x.id === i)))}
        renderItem={x => (
          <button type="button" onClick={() => setSelB(selB === x.id ? null : x.id)} aria-pressed={selB === x.id} data-testid="tl-button" data-id={x.id} data-action={x.action}
            className={cn('w-full min-h-[44px] flex items-center gap-2 px-2 rounded-lg text-left touch-manipulation', selB === x.id ? 'bg-primary/10 ring-2 ring-primary/40' : 'hover:bg-muted')}>
            <span className="w-4 h-4 rounded shrink-0 border" style={{ background: x.colour || '#fff' }} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate">{label(x)}</span>
              <span className="block text-xs text-muted-foreground truncate">{actionOf(x.action)?.label}{x.w > 1 || x.h > 1 ? ' · ' + x.w + ' x ' + x.h : ''}</span>
            </span>
          </button>
        )} />
      {b && (
        <div className="rounded-xl border p-3 space-y-3" data-testid="tl-button-edit" data-id={b.id}>
          <Field label="Does">
            <select className={inputCls} value={b.action} data-testid="tl-button-action"
              onChange={e => {
                const action = e.target.value
                const keep = { id: b.id, action, label: b.label, colour: b.colour, w: b.w, h: b.h }
                // A function that needs a dish, discount or tender keeps the old one only if it is the same kind.
                if (NEEDS_TARGET[action]) keep[NEEDS_TARGET[action]] = action === b.action ? b[NEEDS_TARGET[action]] : null
                if (NEEDS_TARGET[action] && !keep[NEEDS_TARGET[action]]) return setAdding({ action, target: null, replace: b.id })
                setButtons(zone.buttons.map(x => (x.id === b.id ? keep : x)))
              }}>
              {ACTION_GROUPS.map(g => (
                <optgroup key={g} label={g}>
                  {BUTTON_ACTIONS.filter(a => a.group === g).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          {NEEDS_TARGET[b.action] && (
            <TargetPick action={b.action} value={b[NEEDS_TARGET[b.action]]} ctx={ctx}
              onChange={v => v && patchB(b.id, { [NEEDS_TARGET[b.action]]: v })} />
          )}
          <Field label="Words on the button" hint="Empty: the dish's or discount's name, or what it does.">
            <input className={inputCls} value={b.label || ''} maxLength={LABEL_MAX} placeholder={label({ ...b, label: null })} data-testid="tl-button-label"
              onChange={e => patchB(b.id, { label: e.target.value || null })} />
          </Field>
          <Field group label="Colour"><ColourPick value={b.colour} onChange={v => patchB(b.id, { colour: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Wide (buttons)" value={b.w} min={1} max={zone.cols} onChange={v => patchB(b.id, { w: v })} testid="tl-button-w" />
            <Stepper label="High (buttons)" value={b.h} min={1} max={zone.rows} onChange={v => patchB(b.id, { h: v })} testid="tl-button-h" />
          </div>
          {canManage && <ConfirmDelete label="Take this button out" confirmLabel="Yes, take it out" onConfirm={() => { setButtons(zone.buttons.filter(x => x.id !== b.id)); setSelB(null) }} />}
        </div>
      )}
      {canManage && !adding && zone.buttons.length < MAX_BUTTONS && (
        <label className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
          <select className={cn(inputCls, 'flex-1')} value="" aria-label="Add a button" data-testid="tl-add-button"
            onChange={e => { const a = e.target.value; if (!a) return; if (NEEDS_TARGET[a]) setAdding({ action: a, target: null }); else addButton(a) }}>
            <option value="">Add a button…</option>
            {ACTION_GROUPS.map(g => (
              <optgroup key={g} label={g}>
                {BUTTON_ACTIONS.filter(a => a.group === g).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {adding && (
        <div className="rounded-xl border border-primary/40 p-3 space-y-3" data-testid="tl-adding">
          <p className="text-sm font-medium">{adding.replace ? 'Change to: ' : 'New button: '}{actionOf(adding.action)?.label}</p>
          {NEEDS_TARGET[adding.action] && <TargetPick action={adding.action} value={adding.target} ctx={ctx} onChange={v => setAdding(a => ({ ...a, target: v }))} />}
          <div className="flex gap-2">
            <Btn variant="primary" className="flex-1" disabled={!!NEEDS_TARGET[adding.action] && !adding.target} data-testid="tl-adding-ok"
              onClick={() => {
                if (adding.replace) {
                  setButtons(zone.buttons.map(x => (x.id === adding.replace ? { id: x.id, action: adding.action, label: x.label, colour: x.colour, w: x.w, h: x.h, [NEEDS_TARGET[adding.action]]: adding.target } : x)))
                  setAdding(null)
                } else addButton(adding.action, adding.target)
              }}>
              {adding.replace ? 'Change it' : 'Add it'}
            </Btn>
            <Btn onClick={() => setAdding(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
