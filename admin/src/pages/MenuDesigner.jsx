// src/pages/MenuDesigner.jsx
//
// Menu designer (/menus/:id/design). Hand-place a menu's printed layout:
// each page is a snap grid (columns x rows); the header, section titles,
// whole sections, single dishes, text, images, lines, footer notes, the
// allergen key and page numbers are blocks dropped on it, dragged to move
// and resized from the corner handle. Blocks set to "Show on every page"
// repeat on every page (menus.print_layout.master).
//
// Blocks stay linked to the menu: they store only a section / dish id and
// their place on the grid, and every block's content is drawn by
// renderBlockInner() from shared/menuLayout.js, the same renderer the
// printable page (GET /api/menus/:id/print) uses. Dishes added to the menu
// later show up in the "Not placed yet" tray.
//
// Dragging uses plain pointer events rather than @dnd-kit: this is a free
// 2D canvas with snap-to-grid, drag between pages and corner resizing, not
// an ordered list. Touch: the first tap selects a block, then it can be
// dragged (so an unselected block never blocks scrolling the canvas).
// Every tray entry also has a + button that adds it to the current page
// without dragging.
//
// Nothing saves until Save (PUT /api/menus/:id/print-layout).

import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Plus, Minus, Printer, Save, Settings as SettingsIcon, GripVertical,
  Trash2, Copy, ChevronUp, ChevronDown, X, Check, Maximize2, RotateCcw, Image as ImageIcon,
  LayoutTemplate, Repeat,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import {
  BLOCK_LABELS, FITTABLE, GRID_COLS, ROW_MM, MAX_PAGES, MENU_LAYOUT_CSS, MENU_LAYOUT_FONTS_URL,
  normalizeLayout, layoutGeometry, pageBlocks, pageStyle, contentStyle, blockStyle, blockClass,
  toReactStyle, buildContext, placementSummary, renderBlockInner,
} from '@shared/menuLayout.js'

const PX_PER_MM = 96 / 25.4

const DESIGNER_CSS = `
.md-block { outline: 1px dashed rgba(99, 8, 18, 0.28); outline-offset: -1px; cursor: grab; }
.md-block.md-sel { outline: 2px solid #2563eb; z-index: 5; touch-action: none; }
.md-block.md-overlap:not(.md-sel) { outline: 2px solid #f59e0b; }
.md-block.md-cut { box-shadow: inset 0 -3px 0 #dc2626; }
.md-block.md-dragging { opacity: 0.85; z-index: 10; cursor: grabbing; }
.md-block.md-master:not(.md-sel) { outline-style: dotted; outline-color: #7c3aed; }
.md-ph { font: 500 11px/1.35 Inter, sans-serif; color: #7a6b62; background: rgba(122, 107, 98, 0.1); padding: 4px 6px; border-radius: 3px; text-align: left; }
.md-missing { color: #b91c1c; background: #fee2e2; }
.md-handle { position: absolute; right: 0; bottom: 0; background: #2563eb; border-radius: 6px 0 0 0; touch-action: none; cursor: nwse-resize; z-index: 6; }
.md-handle::after { content: ''; position: absolute; right: 25%; bottom: 25%; width: 40%; height: 40%; border-right: 2px solid #fff; border-bottom: 2px solid #fff; }
.md-preview { position: absolute; border: 2px dashed #2563eb; background: rgba(37, 99, 235, 0.08); border-radius: 2px; pointer-events: none; z-index: 20; }
`

// Block sizes on a 12-column, 5mm-row grid; scaled to the layout's grid.
const BASE_SIZE = {
  header: [12, 6], intro: [12, 2], text: [4, 2], image: [3, 8], divider: [12, 1],
  callouts: [12, 6], key: [12, 2], footer: [12, 2], page_number: [3, 1],
  section_title: [3, 2], section_full: [3, 20], item: [3, 4],
}

const BOTTOM_TYPES = new Set(['footer', 'page_number', 'callouts', 'key'])

const uid = () => 'b' + crypto.randomUUID().replace(/-/g, '').slice(0, 10)

function sizeFor(kind, layout) {
  const g = layoutGeometry(layout)
  const [bw, bh] = BASE_SIZE[kind] || [3, 2]
  // A "column" block is a quarter of the width in landscape, half in portrait.
  const colW = normalizeLayout(layout).orientation === 'portrait' && bw === 3 ? 6 : bw
  return {
    w: Math.min(g.cols, Math.max(1, Math.round(colW * g.cols / 12))),
    h: Math.min(g.rows, Math.max(1, Math.round(bh * 5 / g.rowMm))),
  }
}

function templateFor(kind, ref = null) {
  if (kind === 'section_title') return { type: 'section', ref, opts: { mode: 'title' } }
  if (kind === 'section_full')  return { type: 'section', ref, opts: { mode: 'full', columns: 1 } }
  if (kind === 'item')          return { type: 'item', ref, opts: {} }
  if (kind === 'text')          return { type: 'text', ref: null, opts: { text: 'Your text', style: 'body' } }
  return { type: kind, ref: null, opts: {} }
}

function clampBlock(b, g) {
  const w = Math.min(Math.max(1, b.w), g.cols)
  const h = Math.min(Math.max(1, b.h), g.rows)
  return { ...b, w, h, x: Math.min(Math.max(0, b.x), g.cols - w), y: Math.min(Math.max(0, b.y), g.rows - h) }
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// First free spot, scanning top down (bottom up for footer-type blocks).
function findFreeSpot(blocks, w, h, g, fromBottom = false) {
  const ys = []
  for (let y = 0; y + h <= g.rows; y++) ys.push(y)
  if (fromBottom) ys.reverse()
  for (const y of ys) {
    for (let x = 0; x + w <= g.cols; x++) {
      const c = { x, y, w, h }
      if (!blocks.some(b => overlaps(b, c))) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

function newLayout(menu) {
  const base = normalizeLayout({
    paper_size: menu.print_paper_size, orientation: menu.print_orientation,
    font_scale: menu.print_settings?.font_scale,
  })
  const size = sizeFor('header', base)
  return { ...base, master: [], pages: [{ id: uid(), hide_master: false, blocks: [{ id: uid(), type: 'header', ref: null, x: 0, y: 0, ...size, opts: {} }] }] }
}

// Grid change: keep every block where it was on the page.
function regrid(layout, next) {
  const from = layoutGeometry(layout)
  const to = layoutGeometry(next)
  const fx = to.cols / from.cols
  const fy = from.rowMm / to.rowMm
  const conv = b => clampBlock({
    ...b,
    x: Math.round(b.x * fx), w: Math.max(1, Math.round(b.w * fx)),
    y: Math.round(b.y * fy), h: Math.max(1, Math.round(b.h * fy)),
  }, to)
  return {
    ...next,
    master: layout.master.map(conv),
    pages: layout.pages.map(p => ({ ...p, blocks: (p.blocks || []).map(conv) })),
  }
}

// ════════════════════════════════════════════════════════════
//  Page
// ════════════════════════════════════════════════════════════

export default function MenuDesigner() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const qc = useQueryClient()

  const { data: menu, isLoading, isError } = useQuery({
    queryKey: ['menu-design', id],
    queryFn: () => api.get(`/menus/${id}/design`),
  })

  const [layout, setLayout] = useState(null)
  const [savedJson, setSavedJson] = useState('null')
  const [sel, setSel] = useState(null)            // { scope: 'page'|'master', id }
  const [curPageId, setCurPageId] = useState(null)
  const [zoom, setZoom] = useState(null)          // null = fit to width
  const [fitZoom, setFitZoom] = useState(0.7)
  const [needsFit, setNeedsFit] = useState(() => new Set())
  const [drag, setDrag] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [fontsTick, setFontsTick] = useState(0)

  const canvasRef = useRef(null)
  const contentRefs = useRef({})
  const dragRef = useRef(null)
  const live = useRef({})

  // Load: the saved layout, or nothing (automatic layout) until started.
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!menu || loadedFor.current === menu.id) return
    loadedFor.current = menu.id
    const l = menu.print_layout ? normalizeLayout(menu.print_layout) : null
    setLayout(l)
    setSavedJson(JSON.stringify(l))
    setCurPageId(l?.pages[0]?.id ?? null)
  }, [menu])

  // Shared print styles + fonts, only while the designer is open.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = MENU_LAYOUT_CSS + DESIGNER_CSS
    document.head.appendChild(style)
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = MENU_LAYOUT_FONTS_URL
    document.head.appendChild(link)
    document.fonts?.ready?.then(() => setFontsTick(t => t + 1))
    link.onload = () => document.fonts?.ready?.then(() => setFontsTick(t => t + 1))
    return () => { style.remove(); link.remove() }
  }, [])

  const geo = useMemo(() => layout ? layoutGeometry(layout) : null, [layout])
  const ctx = useMemo(() => menu && layout ? buildContext(menu, layout) : null, [menu, layout])
  const scale = zoom ?? fitZoom
  const dirty = layout !== null && JSON.stringify(layout) !== savedJson || (layout === null && savedJson !== 'null')
  live.current = { layout, geo, scale }

  // Fit-to-width zoom follows the canvas width.
  useEffect(() => {
    const el = canvasRef.current
    if (!el || !geo) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 48
      setFitZoom(Math.max(0.3, Math.min(1.5, w / (geo.pageW * PX_PER_MM))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [geo?.pageW, !!layout])

  const save = useMutation({
    mutationFn: () => api.put(`/menus/${id}/print-layout`, { layout }),
    onSuccess: (row) => {
      // Take the server's copy (defaults filled in) so "Saved" compares like with like.
      const l = row.print_layout ? normalizeLayout(row.print_layout) : null
      setLayout(l)
      setSavedJson(JSON.stringify(l))
      qc.invalidateQueries({ queryKey: ['menu', id] })
      qc.invalidateQueries({ queryKey: ['menus'] })
    },
  })
  const reset = useMutation({
    mutationFn: () => api.put(`/menus/${id}/print-layout`, { layout: null }),
    onSuccess: () => {
      setLayout(null); setSavedJson('null'); setSel(null); setConfirmReset(false)
      qc.invalidateQueries({ queryKey: ['menu', id] })
      qc.invalidateQueries({ queryKey: ['menus'] })
    },
  })

  // ── Layout mutators ──────────────────────────────────────
  const mutate = useCallback(fn => setLayout(l => (l ? fn(l) : l)), [])

  const mapBlocks = (l, fn) => ({
    ...l,
    master: l.master.map(b => fn(b, 'master')).filter(Boolean),
    pages: l.pages.map(p => ({ ...p, blocks: (p.blocks || []).map(b => fn(b, 'page', p.id)).filter(Boolean) })),
  })

  const updateBlock = useCallback((blockId, patch) => mutate(l => {
    const g = layoutGeometry(l)
    return mapBlocks(l, b => b.id === blockId ? clampBlock({ ...b, ...patch }, g) : b)
  }), [mutate])

  const updateOpts = (blockId, patch) => mutate(l =>
    mapBlocks(l, b => b.id === blockId ? { ...b, opts: { ...(b.opts || {}), ...patch } } : b))

  const removeBlock = blockId => { mutate(l => mapBlocks(l, b => b.id === blockId ? null : b)); setSel(null) }

  function addBlock(pageId, tpl, at) {
    if (!layout) return
    const kind = tpl.type === 'section' ? (tpl.opts.mode === 'full' ? 'section_full' : 'section_title') : tpl.type
    const size = sizeFor(kind, layout)
    const page = layout.pages.find(p => p.id === pageId) || layout.pages[0]
    const spot = at || findFreeSpot(pageBlocks(layout, page), size.w, size.h, geo, BOTTOM_TYPES.has(tpl.type))
    const block = clampBlock({ id: uid(), ...tpl, ...size, ...spot }, geo)
    mutate(l => ({ ...l, pages: l.pages.map(p => p.id === page.id ? { ...p, blocks: [...(p.blocks || []), block] } : p) }))
    if (FITTABLE.has(block.type)) setNeedsFit(s => new Set(s).add(block.id))
    setSel({ scope: 'page', id: block.id })
    setCurPageId(page.id)
  }

  function duplicateBlock(blockId) {
    const found = findBlock(layout, blockId)
    if (!found) return
    const { block, scope, pageId } = found
    const targetPage = scope === 'master' ? (curPageId || layout.pages[0].id) : pageId
    const page = layout.pages.find(p => p.id === targetPage)
    const spot = findFreeSpot(pageBlocks(layout, page), block.w, block.h, geo)
    const copy = { ...block, id: uid(), ...spot }
    mutate(l => ({ ...l, pages: l.pages.map(p => p.id === targetPage ? { ...p, blocks: [...(p.blocks || []), copy] } : p) }))
    setSel({ scope: 'page', id: copy.id })
  }

  function setEveryPage(blockId, on) {
    const found = findBlock(layout, blockId)
    if (!found) return
    if (on && found.scope === 'page') {
      mutate(l => ({ ...l, master: [...l.master, found.block], pages: l.pages.map(p => ({ ...p, blocks: (p.blocks || []).filter(b => b.id !== blockId) })) }))
      setSel({ scope: 'master', id: blockId })
    } else if (!on && found.scope === 'master') {
      const target = curPageId || layout.pages[0].id
      mutate(l => ({ ...l, master: l.master.filter(b => b.id !== blockId), pages: l.pages.map(p => p.id === target ? { ...p, blocks: [...(p.blocks || []), found.block] } : p) }))
      setSel({ scope: 'page', id: blockId })
    }
  }

  function addPage() {
    if (layout.pages.length >= MAX_PAGES) return
    const page = { id: uid(), hide_master: false, blocks: [] }
    mutate(l => ({ ...l, pages: [...l.pages, page] }))
    setCurPageId(page.id)
    setSel(null)
    setTimeout(() => document.querySelector(`[data-page-wrap="${page.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const movePage = (pageId, dir) => mutate(l => {
    const i = l.pages.findIndex(p => p.id === pageId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= l.pages.length) return l
    const pages = l.pages.slice()
    ;[pages[i], pages[j]] = [pages[j], pages[i]]
    return { ...l, pages }
  })
  const deletePage = pageId => {
    mutate(l => l.pages.length > 1 ? { ...l, pages: l.pages.filter(p => p.id !== pageId) } : l)
    setCurPageId(null); setSel(null)
  }
  const patchPage = (pageId, patch) => mutate(l => ({ ...l, pages: l.pages.map(p => p.id === pageId ? { ...p, ...patch } : p) }))

  // Measured after render: fit newly dropped blocks to their content.
  const onFit = useCallback((blockId, rows) => {
    setNeedsFit(s => { if (!s.has(blockId)) return s; const n = new Set(s); n.delete(blockId); return n })
    updateBlock(blockId, { h: rows })
  }, [updateBlock])
  const fitNow = blockId => setNeedsFit(s => new Set(s).add(blockId))

  // ── Pointer dragging (move, resize, drop from the tray) ──
  function pageUnder(x, y) {
    const els = document.elementsFromPoint(x, y)
    const wrap = els.find(el => el.dataset && el.dataset.pageWrap)
    if (!wrap) return null
    const pageId = wrap.dataset.pageWrap
    const content = contentRefs.current[pageId]
    return content ? { pageId, rect: content.getBoundingClientRect() } : null
  }

  function cellAt(target, clientX, clientY, grabDx, grabDy, w, h) {
    const { geo: g, scale: s } = live.current
    const cw = g.colMm * PX_PER_MM * s
    const ch = g.rowMm * PX_PER_MM * s
    const x = Math.round((clientX - target.rect.left) / cw - grabDx)
    const y = Math.round((clientY - target.rect.top) / ch - grabDy)
    return clampBlock({ x, y, w, h }, g)
  }

  function autoScroll(clientY) {
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientY < r.top + 50) el.scrollBy(0, -18)
    else if (clientY > r.bottom - 50) el.scrollBy(0, 18)
  }

  function startDrag(d, e) {
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY, moved: false }
    const move = ev => {
      const cur = dragRef.current
      if (!cur) return
      if (!cur.moved && Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) < 4) return
      cur.moved = true
      ev.preventDefault()
      autoScroll(ev.clientY)
      const { geo: g, scale: s } = live.current
      if (cur.kind === 'resize') {
        const cw = g.colMm * PX_PER_MM * s
        const ch = g.rowMm * PX_PER_MM * s
        const w = Math.max(1, Math.min(g.cols - cur.x, cur.w0 + Math.round((ev.clientX - cur.startX) / cw)))
        const h = Math.max(1, Math.min(g.rows - cur.y, cur.h0 + Math.round((ev.clientY - cur.startY) / ch)))
        cur.target = { w, h }
        setDrag({ kind: 'resize', id: cur.id, w, h })
        return
      }
      const over = pageUnder(ev.clientX, ev.clientY)
      if (cur.kind === 'new') setDrag(dd => ({ ...(dd || {}), kind: 'new', label: cur.label, px: ev.clientX, py: ev.clientY, pageId: over?.pageId ?? null }))
      if (!over) { if (cur.kind === 'move') return; cur.target = null; return }
      const cell = cellAt(over, ev.clientX, ev.clientY, cur.grabDx, cur.grabDy, cur.w, cur.h)
      cur.target = { pageId: over.pageId, ...cell }
      setDrag({ kind: cur.kind, id: cur.id, label: cur.label, px: ev.clientX, py: ev.clientY, ...cur.target })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const cur = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!cur || !cur.moved || !cur.target) return
      if (cur.kind === 'resize') updateBlock(cur.id, cur.target)
      else if (cur.kind === 'new') addBlock(cur.target.pageId, cur.tpl, { x: cur.target.x, y: cur.target.y })
      else if (cur.kind === 'move') commitMove(cur.id, cur.scope, cur.target)
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  function commitMove(blockId, scope, t) {
    if (scope === 'master') { updateBlock(blockId, { x: t.x, y: t.y }); return }
    mutate(l => {
      let moving = null
      const pages = l.pages.map(p => {
        const b = (p.blocks || []).find(x => x.id === blockId)
        if (b) moving = { ...b, x: t.x, y: t.y }
        return b ? { ...p, blocks: p.blocks.filter(x => x.id !== blockId) } : p
      })
      if (!moving) return l
      return { ...l, pages: pages.map(p => p.id === t.pageId ? { ...p, blocks: [...p.blocks, moving] } : p) }
    })
    setCurPageId(t.pageId)
  }

  function onBlockPointerDown(e, block, scope, pageId) {
    if (e.button != null && e.button !== 0) return
    e.stopPropagation()
    const wasSelected = sel?.id === block.id
    setSel({ scope, id: block.id })
    setCurPageId(pageId)
    if (e.pointerType !== 'mouse' && !wasSelected) return
    const r = e.currentTarget.getBoundingClientRect()
    const cw = geo.colMm * PX_PER_MM * scale
    const ch = geo.rowMm * PX_PER_MM * scale
    startDrag({
      kind: 'move', id: block.id, scope, w: block.w, h: block.h,
      grabDx: (e.clientX - r.left) / cw, grabDy: (e.clientY - r.top) / ch,
    }, e)
  }

  function onResizePointerDown(e, block) {
    e.stopPropagation()
    e.preventDefault()
    startDrag({ kind: 'resize', id: block.id, x: block.x, y: block.y, w0: block.w, h0: block.h }, e)
  }

  function onTrayPointerDown(e, tpl, label) {
    if (!layout) return
    e.preventDefault()
    const kind = tpl.type === 'section' ? (tpl.opts.mode === 'full' ? 'section_full' : 'section_title') : tpl.type
    const size = sizeFor(kind, layout)
    startDrag({ kind: 'new', tpl, label, ...size, grabDx: 0.5, grabDy: 0.5 }, e)
  }

  // Keyboard: arrows nudge the selected block, Delete removes it.
  useEffect(() => {
    const onKey = e => {
      if (!sel || !layout) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      const found = findBlock(layout, sel.id)
      if (!found) return
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (d) { e.preventDefault(); updateBlock(sel.id, { x: found.block.x + d[0], y: found.block.y + d[1] }) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(sel.id) }
      else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Render ───────────────────────────────────────────────
  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (isError || !menu) {
    return <div className="p-6 text-sm text-destructive">Menu not found.</div>
  }

  const selected = sel && layout ? findBlock(layout, sel.id) : null
  const curPage = layout ? (layout.pages.find(p => p.id === curPageId) || layout.pages[0]) : null
  const curPageIndex = layout && curPage ? layout.pages.indexOf(curPage) : 0
  const printUrl = `/api/menus/${id}/print`

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Top bar */}
      <div className="shrink-0 h-14 border-b bg-background flex items-center gap-2 px-4 max-lg:notouch:pl-14">
        <button onClick={() => navigate(`/menus?edit=${id}`)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] px-2 touch-manipulation">
          <ArrowLeft className="w-4 h-4" /> Menu
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">Print design · {menu.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {layout ? `${layout.paper_size} ${layout.orientation} · ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'} · grid ${geo.cols} x ${geo.rows}` : 'Automatic layout'}
          </p>
        </div>
        {layout && (
          <>
            <div className="hidden md:flex items-center border rounded-md">
              <button onClick={() => setZoom(Math.max(0.3, +(scale - 0.1).toFixed(2)))} className="w-10 h-10 flex items-center justify-center touch-manipulation" title="Zoom out"><Minus className="w-4 h-4" /></button>
              <span className="text-xs w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
              <button onClick={() => setZoom(Math.min(2, +(scale + 0.1).toFixed(2)))} className="w-10 h-10 flex items-center justify-center touch-manipulation" title="Zoom in"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setZoom(null)} className={cn('w-10 h-10 flex items-center justify-center touch-manipulation', zoom === null && 'text-primary')} title="Fit to width"><Maximize2 className="w-4 h-4" /></button>
            </div>
            <button onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] touch-manipulation hover:bg-accent">
              <SettingsIcon className="w-4 h-4" /> <span className="hidden lg:inline">Page setup</span>
            </button>
          </>
        )}
        {dirty || !savedJson || savedJson === 'null' ? (
          <span title={savedJson === 'null' ? 'No designed layout saved yet' : 'Save first: the print page shows what is saved'}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/50 px-3 min-h-[44px] select-none">
            <Printer className="w-4 h-4" /> <span className="hidden lg:inline">Preview</span>
          </span>
        ) : (
          <a href={printUrl} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 min-h-[44px] touch-manipulation">
            <Printer className="w-4 h-4" /> <span className="hidden lg:inline">Preview</span>
          </a>
        )}
        <button disabled={!dirty || save.isPending || !layout} onClick={() => save.mutate()}
          className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 touch-manipulation">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {save.isError && (
        <div className="shrink-0 bg-destructive/10 text-destructive text-sm px-4 py-2 border-b">
          Save failed: {save.error?.body?.error || save.error?.message || 'Unknown error'}
        </div>
      )}

      {!layout ? (
        <StartScreen menu={menu} onStart={() => {
          const l = newLayout(menu)
          setLayout(l); setCurPageId(l.pages[0].id)
          setNeedsFit(new Set([l.pages[0].blocks[0].id]))
        }} />
      ) : (
        <div className="flex-1 min-h-0 flex">
          <Tray menu={menu} layout={layout} curPageIndex={curPageIndex}
            onAdd={(tpl) => addBlock(curPage.id, tpl)}
            onDragStart={onTrayPointerDown} />

          {/* Canvas */}
          <div ref={canvasRef} className="flex-1 min-w-0 overflow-auto py-6 px-6"
            onPointerDown={() => setSel(null)}>
            <div className="flex flex-col items-center gap-3">
              {layout.pages.map((page, pi) => (
                <DesignPage key={page.id}
                  page={page} pageIndex={pi} pageCount={layout.pages.length}
                  layout={layout} geo={geo} menu={menu} ctx={ctx} scale={scale}
                  current={page.id === curPage?.id}
                  sel={sel} drag={drag} needsFit={needsFit} fontsTick={fontsTick}
                  contentRef={el => { contentRefs.current[page.id] = el }}
                  onPick={() => setCurPageId(page.id)}
                  onBlockPointerDown={onBlockPointerDown}
                  onResizePointerDown={onResizePointerDown}
                  onFit={onFit}
                  onMove={dir => movePage(page.id, dir)}
                  onDelete={() => deletePage(page.id)} />
              ))}
              <button onClick={addPage} disabled={layout.pages.length >= MAX_PAGES}
                className="inline-flex items-center gap-1.5 text-sm border border-dashed rounded-lg px-5 min-h-[48px] bg-background hover:bg-accent touch-manipulation disabled:opacity-50">
                <Plus className="w-4 h-4" /> Add page
              </button>
            </div>
          </div>

          <aside className="w-72 shrink-0 border-l bg-background overflow-y-auto">
            {selected ? (
              <BlockInspector key={selected.block.id} found={selected} layout={layout} geo={geo} menu={menu}
                onUpdate={patch => updateBlock(selected.block.id, patch)}
                onOpts={patch => updateOpts(selected.block.id, patch)}
                onFit={() => fitNow(selected.block.id)}
                onEveryPage={on => setEveryPage(selected.block.id, on)}
                onDuplicate={() => duplicateBlock(selected.block.id)}
                onRemove={() => removeBlock(selected.block.id)}
                onClose={() => setSel(null)} />
            ) : (
              <PagePanel page={curPage} pageIndex={curPageIndex} layout={layout}
                onPatch={patch => patchPage(curPage.id, patch)}
                confirmReset={confirmReset} setConfirmReset={setConfirmReset}
                resetting={reset.isPending} onReset={() => reset.mutate()}
                savedExists={savedJson !== 'null'}
                onDiscardNew={() => { setLayout(null); setSel(null) }} />
            )}
          </aside>
        </div>
      )}

      {drag?.kind === 'new' && drag.px != null && (
        <div className="fixed z-[60] pointer-events-none px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium shadow-lg"
          style={{ left: drag.px + 12, top: drag.py + 12 }}>
          {drag.label}{drag.pageId ? '' : ' · drop on a page'}
        </div>
      )}

      {settingsOpen && layout && (
        <PageSetupModal layout={layout} onClose={() => setSettingsOpen(false)}
          onApply={next => { setLayout(l => regrid(l, next)); setSettingsOpen(false) }} />
      )}
    </div>
  )
}

function findBlock(layout, blockId) {
  if (!layout || !blockId) return null
  const m = layout.master.find(b => b.id === blockId)
  if (m) return { block: m, scope: 'master', pageId: null }
  for (const p of layout.pages) {
    const b = (p.blocks || []).find(x => x.id === blockId)
    if (b) return { block: b, scope: 'page', pageId: p.id }
  }
  return null
}

// ════════════════════════════════════════════════════════════
//  Canvas page + blocks
// ════════════════════════════════════════════════════════════

function DesignPage({
  page, pageIndex, pageCount, layout, geo, menu, ctx, scale, current, sel, drag, needsFit, fontsTick,
  contentRef, onPick, onBlockPointerDown, onResizePointerDown, onFit, onMove, onDelete,
}) {
  const [confirmDel, setConfirmDel] = useState(false)

  // Blocks as drawn right now: a block being moved or resized is shown at
  // its new place (moving to another page draws it there instead).
  const blocks = useMemo(() => {
    const list = [
      ...(page.hide_master ? [] : layout.master.map(b => ({ b, scope: 'master' }))),
      ...(page.blocks || []).map(b => ({ b, scope: 'page' })),
    ]
    if (drag?.kind === 'move') {
      const out = []
      for (const it of list) {
        if (it.b.id !== drag.id) { out.push(it); continue }
        if (it.scope === 'master' || drag.pageId === page.id) out.push({ ...it, b: { ...it.b, x: drag.x, y: drag.y }, dragging: true })
      }
      if (drag.pageId === page.id && !out.some(it => it.b.id === drag.id)) {
        const f = findBlock(layout, drag.id)
        if (f && f.scope === 'page') out.push({ b: { ...f.block, x: drag.x, y: drag.y }, scope: 'page', dragging: true })
      }
      return out
    }
    if (drag?.kind === 'resize') {
      return list.map(it => it.b.id === drag.id ? { ...it, b: { ...it.b, w: drag.w, h: drag.h }, dragging: true } : it)
    }
    return list
  }, [page, layout, drag])

  const overlapIds = useMemo(() => {
    const ids = new Set()
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (overlaps(blocks[i].b, blocks[j].b)) { ids.add(blocks[i].b.id); ids.add(blocks[j].b.id) }
      }
    }
    return ids
  }, [blocks])

  const w = geo.pageW * PX_PER_MM * scale
  const h = geo.pageH * PX_PER_MM * scale
  const handle = 22 / scale

  return (
    <div className="flex flex-col items-stretch" style={{ width: w }}>
      <div className="flex items-center gap-1 pb-1.5" onPointerDown={e => e.stopPropagation()}>
        <button onClick={onPick}
          className={cn('text-xs font-medium px-2.5 min-h-[36px] rounded-md touch-manipulation',
            current ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
          Page {pageIndex + 1}{current ? ' · adding here' : ''}
        </button>
        {page.hide_master && <span className="text-[11px] text-muted-foreground">repeated blocks hidden</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={pageIndex === 0} title="Move page up"
            className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-30 touch-manipulation"><ChevronUp className="w-4 h-4" /></button>
          <button onClick={() => onMove(1)} disabled={pageIndex === pageCount - 1} title="Move page down"
            className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-30 touch-manipulation"><ChevronDown className="w-4 h-4" /></button>
          {pageCount > 1 && (confirmDel ? (
            <>
              <button onClick={() => { setConfirmDel(false); onDelete() }}
                className="text-xs px-2.5 min-h-[36px] rounded-md bg-destructive text-destructive-foreground touch-manipulation">Delete page</button>
              <button onClick={() => setConfirmDel(false)} className="text-xs px-2.5 min-h-[36px] rounded-md border touch-manipulation">Cancel</button>
            </>
          ) : (
            <button onClick={() => (page.blocks || []).length ? setConfirmDel(true) : onDelete()} title="Delete page"
              className="w-9 h-9 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 touch-manipulation"><Trash2 className="w-4 h-4" /></button>
          ))}
        </div>
      </div>
      <div data-page-wrap={page.id} className={cn('relative shadow-md', current && 'ring-2 ring-primary/40')}
        style={{ width: w, height: h }} onPointerDown={onPick}>
        <div className="ml-page" style={{ ...toReactStyle(pageStyle(layout, menu)), position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div ref={contentRef} className="ml-content" style={{
            ...toReactStyle(contentStyle(layout)),
            backgroundImage: 'linear-gradient(to right, rgba(37,99,235,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.09) 1px, transparent 1px)',
            backgroundSize: `${geo.colMm}mm ${geo.rowMm}mm`,
            outline: '1px solid rgba(37,99,235,0.2)',
          }}>
            {blocks.map(({ b, scope, dragging }) => (
              <DesignBlock key={b.id + ':' + scope} block={b} scope={scope} pageId={page.id} pageIndex={pageIndex}
                layout={layout} ctx={ctx} geo={geo}
                selected={sel?.id === b.id} dragging={!!dragging} overlap={overlapIds.has(b.id)}
                needsFit={needsFit.has(b.id)} fontsTick={fontsTick} handle={handle}
                onPointerDown={onBlockPointerDown} onResizePointerDown={onResizePointerDown} onFit={onFit} />
            ))}
            {drag?.kind === 'new' && drag.pageId === page.id && drag.x != null && (
              <div className="md-preview" style={toReactStyle(blockStyle({ type: 'text', x: drag.x, y: drag.y, w: drag.w, h: drag.h }, layout))} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function placeholderFor(block) {
  switch (block.type) {
    case 'intro':    return 'Intro line: empty. Set it in the menu\'s Settings.'
    case 'text':     return 'Text: type it in the panel on the right.'
    case 'image':    return 'Image: pick one in the panel on the right.'
    case 'callouts': return 'Footer notes: none yet. Add them on the menu page.'
    case 'key':      return 'Allergen key: no dietary tags yet.'
    default:         return BLOCK_LABELS[block.type] || block.type
  }
}

function DesignBlock({
  block, scope, pageId, pageIndex, layout, ctx, geo, selected, dragging, overlap, needsFit, fontsTick, handle,
  onPointerDown, onResizePointerDown, onFit,
}) {
  const innerRef = useRef(null)
  const outerRef = useRef(null)
  const [cut, setCut] = useState(false)

  const inner = ctx ? renderBlockInner(block, ctx, pageIndex) : ''
  const html = inner == null
    ? '<div class="md-ph md-missing">This ' + (block.type === 'item' ? 'dish' : 'section') + ' was deleted from the menu. Remove this block.</div>'
    : inner === '' ? '<div class="md-ph">' + placeholderFor(block).replace(/</g, '&lt;') + '</div>' : inner

  useLayoutEffect(() => {
    const el = innerRef.current
    const box = outerRef.current
    if (!el || !box) return
    const contentH = el.offsetHeight
    setCut(inner != null && inner !== '' && contentH > box.clientHeight + 1)
    if (needsFit && !dragging) {
      const pad = box.offsetHeight - box.clientHeight
      onFit(block.id, Math.max(1, Math.ceil((contentH + pad) / (geo.rowMm * PX_PER_MM) - 0.02)))
    }
  }, [html, block.w, block.h, geo.rowMm, geo.colMm, needsFit, fontsTick, dragging])

  return (
    <div ref={outerRef}
      className={cn(blockClass(block), 'md-block', selected && 'md-sel', overlap && 'md-overlap', cut && 'md-cut',
        dragging && 'md-dragging', scope === 'master' && 'md-master')}
      style={toReactStyle(blockStyle(block, layout))}
      onPointerDown={e => onPointerDown(e, block, scope, pageId)}>
      <div ref={innerRef} className="ml-inner" dangerouslySetInnerHTML={{ __html: html }} />
      {selected && (
        <div className="md-handle" style={{ width: handle, height: handle }}
          onPointerDown={e => onResizePointerDown(e, block)} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
//  Tray: blocks to add + what is not placed yet
// ════════════════════════════════════════════════════════════

const STATIC_BLOCKS = ['header', 'intro', 'text', 'image', 'divider', 'callouts', 'key', 'footer', 'page_number']

function Tray({ menu, layout, curPageIndex, onAdd, onDragStart }) {
  const [showAll, setShowAll] = useState(false)
  const summary = useMemo(() => placementSummary(menu, layout), [menu, layout])
  const unplacedCount = summary.reduce((n, s) => n + s.items.filter(i => !i.placed).length, 0)

  return (
    <aside className="w-72 shrink-0 border-r bg-background overflow-y-auto">
      <div className="px-3 py-2 border-b text-xs text-muted-foreground">
        Drag onto a page, or tap + to add to page {curPageIndex + 1}.
      </div>

      <TrayHeading>Blocks</TrayHeading>
      <div className="px-2 pb-2">
        {STATIC_BLOCKS.map(t => (
          <TrayRow key={t} label={BLOCK_LABELS[t]} tpl={templateFor(t)} onAdd={onAdd} onDragStart={onDragStart} />
        ))}
      </div>

      <TrayHeading>
        <span>Not placed yet{unplacedCount ? ` (${unplacedCount})` : ''}</span>
        <label className="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal text-[11px] cursor-pointer min-h-[32px]">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="w-4 h-4" />
          Show placed
        </label>
      </TrayHeading>
      <div className="px-2 pb-6 space-y-3">
        {summary.length === 0 && <p className="text-xs text-muted-foreground px-1">This menu has no sections yet.</p>}
        {summary.map(({ section, placed, full, items }) => {
          const visibleItems = showAll ? items : items.filter(i => !i.placed)
          if (!showAll && placed && visibleItems.length === 0) return null
          return (
            <div key={section.id} className="border rounded-lg overflow-hidden">
              <div className="px-2.5 py-1.5 bg-muted/50 flex items-center gap-1.5">
                <p className="text-xs font-semibold truncate flex-1">{section.title}</p>
                {placed && <span className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5"><Check className="w-3 h-3" />{full ? 'whole' : 'title'}</span>}
              </div>
              <div className="px-1 py-1">
                <TrayRow label="Section title" hint="repeat it on later pages too" tpl={templateFor('section_title', section.id)} onAdd={onAdd} onDragStart={onDragStart} />
                <TrayRow label="Title and dishes" hint="dishes placed on their own are left out" tpl={templateFor('section_full', section.id)} onAdd={onAdd} onDragStart={onDragStart} />
                {visibleItems.map(({ item, placed: p }) => (
                  <TrayRow key={item.id} label={item.name} dim={p} indent
                    tpl={templateFor('item', item.id)} onAdd={onAdd} onDragStart={onDragStart} />
                ))}
                {!showAll && items.length > 0 && visibleItems.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">All dishes placed.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function TrayHeading({ children }) {
  return <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2">{children}</div>
}

function TrayRow({ label, hint, tpl, onAdd, onDragStart, dim, indent }) {
  return (
    <div className={cn('flex items-center gap-1 rounded-md', dim && 'opacity-50', indent && 'pl-2')}>
      <span onPointerDown={e => onDragStart(e, tpl, label)} style={{ touchAction: 'none' }}
        className="w-9 h-10 flex items-center justify-center text-muted-foreground cursor-grab hover:bg-accent rounded-md shrink-0" title="Drag onto a page">
        <GripVertical className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
      </div>
      <button onClick={() => onAdd(tpl)} title="Add to the current page"
        className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-accent text-primary shrink-0 touch-manipulation">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
//  Right panel
// ════════════════════════════════════════════════════════════

function PanelSection({ title, children }) {
  return (
    <div className="px-4 py-3 border-b space-y-2.5">
      {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
      {children}
    </div>
  )
}

function Stepper({ label, value, onChange, min, max }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <div className="flex items-center border rounded-md">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          className="w-10 h-10 flex items-center justify-center disabled:opacity-30 touch-manipulation"><Minus className="w-3.5 h-3.5" /></button>
        <span className="flex-1 text-center text-sm tabular-nums">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
          className="w-10 h-10 flex items-center justify-center disabled:opacity-30 touch-manipulation"><Plus className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex border rounded-md overflow-hidden">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn('flex-1 text-xs min-h-[40px] px-1 touch-manipulation', value === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
          {l}
        </button>
      ))}
    </div>
  )
}

function Check2({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm min-h-[36px] cursor-pointer touch-manipulation">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4" />
      {label}
    </label>
  )
}

function Select({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-sm border rounded-md px-2 min-h-[40px] bg-background touch-manipulation">
      {children}
    </select>
  )
}

const SCALES = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]

function BlockInspector({ found, layout, geo, menu, onUpdate, onOpts, onFit, onEveryPage, onDuplicate, onRemove, onClose }) {
  const { block, scope } = found
  const o = block.opts || {}
  const [mediaOpen, setMediaOpen] = useState(false)
  const sectionsById = Object.fromEntries((menu.sections || []).map(s => [s.id, s]))
  const itemsById = Object.fromEntries((menu.sections || []).flatMap(s => s.items || []).map(i => [i.id, i]))
  const refName = block.type === 'section' ? sectionsById[block.ref]?.title
    : block.type === 'item' ? itemsById[block.ref]?.name : null
  const title = block.type === 'section' ? (o.mode === 'full' ? 'Section, title and dishes' : 'Section title') : BLOCK_LABELS[block.type]
  const hasAlign = !['image', 'divider'].includes(block.type) && !(block.type === 'header' && o.variant !== 'compact')

  return (
    <div onPointerDown={e => e.stopPropagation()}>
      <div className="px-4 h-12 border-b flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          {refName && <p className="text-[11px] text-muted-foreground truncate">{refName}</p>}
        </div>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation"><X className="w-4 h-4" /></button>
      </div>

      <PanelSection title="Position (grid squares)">
        <div className="grid grid-cols-2 gap-2">
          <Stepper label="Across" value={block.x} min={0} max={geo.cols - block.w} onChange={v => onUpdate({ x: v })} />
          <Stepper label="Down" value={block.y} min={0} max={geo.rows - block.h} onChange={v => onUpdate({ y: v })} />
          <Stepper label="Width" value={block.w} min={1} max={geo.cols - block.x} onChange={v => onUpdate({ w: v })} />
          <Stepper label="Height" value={block.h} min={1} max={geo.rows - block.y} onChange={v => onUpdate({ h: v })} />
        </div>
        {FITTABLE.has(block.type) && (
          <button onClick={onFit} className="w-full text-sm border rounded-md min-h-[40px] hover:bg-accent touch-manipulation">
            Fit height to content
          </button>
        )}
        <label className="flex items-start gap-2 text-sm min-h-[36px] cursor-pointer touch-manipulation">
          <input type="checkbox" checked={scope === 'master'} onChange={e => onEveryPage(e.target.checked)} className="w-4 h-4 mt-0.5" />
          <span>Show on every page<span className="block text-[11px] text-muted-foreground">Same place on each page, e.g. a header, footer or page number.</span></span>
        </label>
      </PanelSection>

      <PanelSection title="Look">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Text size</p>
          <Select value={String(o.font_scale ?? 100)} onChange={v => onOpts({ font_scale: Number(v) })}>
            {SCALES.map(s => <option key={s} value={s}>{s}%</option>)}
          </Select>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Background</p>
          <Segmented value={o.box || 'none'} options={[['none', 'None'], ['tint', 'Tint'], ['outline', 'Outline']]} onChange={v => onOpts({ box: v })} />
        </div>
        {hasAlign && (
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">Align</p>
            <Segmented value={o.align || (block.type === 'footer' ? 'center' : block.type === 'page_number' ? 'right' : 'left')}
              options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={v => onOpts({ align: v })} />
          </div>
        )}
      </PanelSection>

      <TypeOptions block={block} o={o} menu={menu} layout={layout} onOpts={onOpts} openMedia={() => setMediaOpen(true)} />

      <PanelSection>
        {block.type !== 'item' && (
          <button onClick={onDuplicate} className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
            <Copy className="w-4 h-4" /> Duplicate
          </button>
        )}
        <button onClick={onRemove} className="w-full inline-flex items-center justify-center gap-1.5 text-sm rounded-md min-h-[44px] text-destructive bg-destructive/10 hover:bg-destructive/20 touch-manipulation">
          <Trash2 className="w-4 h-4" /> Remove from page
        </button>
        <p className="text-[11px] text-muted-foreground">Removing a block never changes the menu. Sections and dishes go back to the tray.</p>
      </PanelSection>

      <MediaLibraryModal open={mediaOpen} mode="picker" onClose={() => setMediaOpen(false)}
        onPick={url => { onOpts({ url }); setMediaOpen(false) }} />
    </div>
  )
}

// Variant options per row for one block; "Default" follows Page setup.
function VariantColumns({ o, layout, onOpts }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-0.5">Variant options per row</p>
      <Segmented value={o.variant_columns ? String(o.variant_columns) : 'default'}
        options={[['default', 'Default (' + (layout.variant_columns || 1) + ')'], ['1', '1'], ['2', '2'], ['3', '3']]}
        onChange={v => onOpts({ variant_columns: v === 'default' ? undefined : Number(v) })} />
    </div>
  )
}

function TypeOptions({ block, o, menu, layout, onOpts, openMedia }) {
  switch (block.type) {
    case 'header':
      return (
        <PanelSection title="Header">
          <Segmented value={o.variant || 'full'} options={[['full', 'Full'], ['compact', 'One line']]} onChange={v => onOpts({ variant: v })} />
          {o.variant !== 'compact' && <Check2 label="Show logo" checked={o.show_logo !== false} onChange={v => onOpts({ show_logo: v })} />}
          {o.variant !== 'compact' && <Check2 label="Line underneath" checked={o.show_rule !== false} onChange={v => onOpts({ show_rule: v })} />}
        </PanelSection>
      )
    case 'section':
      return (
        <PanelSection title="Section">
          <Segmented value={o.mode === 'full' ? 'full' : 'title'} options={[['title', 'Title only'], ['full', 'Title and dishes']]} onChange={v => onOpts({ mode: v })} />
          {o.mode === 'full' && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Dish columns inside the block</p>
              <Segmented value={String(o.columns || 1)} options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} onChange={v => onOpts({ columns: Number(v) })} />
            </div>
          )}
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">Text after the title</p>
            <input value={o.suffix || ''} maxLength={40} placeholder="e.g. (continued)"
              onChange={e => onOpts({ suffix: e.target.value })}
              className="w-full text-sm border rounded-md px-2 min-h-[40px]" />
          </div>
          <Check2 label="Show subtitle" checked={o.show_subtitle !== false} onChange={v => onOpts({ show_subtitle: v })} />
          <Check2 label="Show section image" checked={o.show_image !== false} onChange={v => onOpts({ show_image: v })} />
          <Check2 label="Line under the title" checked={o.show_rule !== false} onChange={v => onOpts({ show_rule: v })} />
          {o.mode === 'full' && <Check2 label="Show descriptions" checked={o.show_description !== false} onChange={v => onOpts({ show_description: v })} />}
          {o.mode === 'full' && <VariantColumns o={o} layout={layout} onOpts={onOpts} />}
        </PanelSection>
      )
    case 'item':
      return (
        <PanelSection title="Dish">
          <Check2 label="Show description" checked={o.show_description !== false} onChange={v => onOpts({ show_description: v })} />
          <Check2 label="Show photo" checked={o.show_image !== false} onChange={v => onOpts({ show_image: v })} />
          <VariantColumns o={o} layout={layout} onOpts={onOpts} />
          <p className="text-[11px] text-muted-foreground">Name, price and allergens come from the menu. Edit them there.</p>
        </PanelSection>
      )
    case 'text':
      return (
        <PanelSection title="Text">
          <textarea value={o.text || ''} maxLength={2000} rows={4} onChange={e => onOpts({ text: e.target.value })}
            className="w-full text-sm border rounded-md px-2 py-1.5" />
          <Select value={o.style || 'body'} onChange={v => onOpts({ style: v })}>
            <option value="heading">Heading</option>
            <option value="subheading">Small capitals heading</option>
            <option value="body">Body</option>
            <option value="script">Handwritten</option>
            <option value="small">Small print</option>
          </Select>
        </PanelSection>
      )
    case 'image':
      return (
        <PanelSection title="Image">
          <button onClick={openMedia} className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
            <ImageIcon className="w-4 h-4" /> {o.url ? 'Change image' : 'Pick an image'}
          </button>
          <Segmented value={o.fit || 'contain'} options={[['contain', 'Fit inside'], ['cover', 'Fill and crop']]} onChange={v => onOpts({ fit: v })} />
        </PanelSection>
      )
    case 'divider':
      return (
        <PanelSection title="Line">
          <Select value={o.style || 'thin'} onChange={v => onOpts({ style: v })}>
            <option value="thin">Thin</option>
            <option value="thick">Thick, brand colour</option>
            <option value="dotted">Dotted</option>
            <option value="double">Double</option>
          </Select>
        </PanelSection>
      )
    case 'callouts': {
      const n = (menu.callouts || []).length
      return (
        <PanelSection title="Footer notes">
          <p className="text-[11px] text-muted-foreground mb-0.5">Columns</p>
          <Segmented value={String(o.columns || Math.min(4, Math.max(1, n)))} options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} onChange={v => onOpts({ columns: Number(v) })} />
        </PanelSection>
      )
    }
    case 'footer':
      return (
        <PanelSection title="Footer line">
          <input value={o.text || ''} maxLength={200} placeholder={menu.footer_motto || 'The menu\'s footer line'}
            onChange={e => onOpts({ text: e.target.value })}
            className="w-full text-sm border rounded-md px-2 min-h-[40px]" />
        </PanelSection>
      )
    default:
      return null
  }
}

function PagePanel({ page, pageIndex, layout, onPatch, confirmReset, setConfirmReset, resetting, onReset, savedExists, onDiscardNew }) {
  if (!page) return null
  return (
    <div onPointerDown={e => e.stopPropagation()}>
      <div className="px-4 h-12 border-b flex items-center">
        <p className="text-sm font-semibold">Page {pageIndex + 1}</p>
      </div>
      <PanelSection>
        <Check2 label="Hide repeated blocks on this page" checked={!!page.hide_master} onChange={v => onPatch({ hide_master: v })} />
        <p className="text-[11px] text-muted-foreground">
          {layout.master.length
            ? `${layout.master.length} block${layout.master.length === 1 ? ' is' : 's are'} set to show on every page.`
            : 'No blocks are set to show on every page yet. Select a block and tick "Show on every page".'}
        </p>
      </PanelSection>
      <PanelSection title="How it works">
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
          <li>Drag anything from the left onto a page, or tap + to add it to the current page.</li>
          <li>Tap a block to select it, then drag it to move, or drag the blue corner to resize. Blocks snap to the grid.</li>
          <li>A red line along the bottom of a block means its text is cut off. Make it taller or tap "Fit height to content".</li>
          <li>Orange outline: two blocks overlap.</li>
          <li>Names, prices and allergens always come from the menu, so the design stays up to date.</li>
        </ul>
      </PanelSection>
      <PanelSection title="Automatic layout">
        {savedExists ? (
          confirmReset ? (
            <div className="space-y-2">
              <p className="text-xs">Delete this design? The print and the website link go back to the automatic layout.</p>
              <div className="flex gap-2">
                <button onClick={onReset} disabled={resetting}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm rounded-md min-h-[44px] bg-destructive text-destructive-foreground touch-manipulation disabled:opacity-50">
                  {resetting && <Loader2 className="w-4 h-4 animate-spin" />} Yes, delete
                </button>
                <button onClick={() => setConfirmReset(false)} className="flex-1 text-sm border rounded-md min-h-[44px] touch-manipulation">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] text-destructive hover:bg-destructive/10 touch-manipulation">
              <RotateCcw className="w-4 h-4" /> Use the automatic layout
            </button>
          )
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">This design is not saved yet. Until you save, printing uses the automatic layout.</p>
            <button onClick={onDiscardNew} className="w-full text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">Discard this design</button>
          </>
        )}
      </PanelSection>
    </div>
  )
}

function StartScreen({ menu, onStart }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md bg-background border rounded-xl p-6 space-y-3 text-center">
        <LayoutTemplate className="w-8 h-8 text-primary mx-auto" />
        <h2 className="font-semibold">Design this menu's print layout</h2>
        <p className="text-sm text-muted-foreground">
          "{menu.name}" prints with the automatic layout. Start a design to place the header, sections and
          dishes yourself on a grid, page by page. Until you save, nothing changes.
        </p>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Repeat className="w-3.5 h-3.5" /> Prices and names stay linked to the menu.
        </p>
        <div>
          <button onClick={onStart}
            className="inline-flex items-center gap-1.5 rounded-md px-5 min-h-[48px] text-sm font-medium bg-primary text-primary-foreground touch-manipulation">
            <Plus className="w-4 h-4" /> Start designing
          </button>
        </div>
      </div>
    </div>
  )
}

function PageSetupModal({ layout, onClose, onApply }) {
  const [f, setF] = useState({
    paper_size: layout.paper_size, orientation: layout.orientation, margin_mm: layout.margin_mm,
    cols: layout.cols, row_mm: layout.row_mm, font_scale: layout.font_scale,
    variant_columns: layout.variant_columns || 1,
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const next = normalizeLayout({ ...layout, ...f })
  const g = layoutGeometry(next)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Page setup</h2>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium mb-1">Paper</p>
              <Segmented value={f.paper_size} options={[['A4', 'A4'], ['A3', 'A3']]} onChange={v => set('paper_size', v)} />
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Orientation</p>
              <Segmented value={f.orientation} options={[['landscape', 'Landscape'], ['portrait', 'Portrait']]} onChange={v => set('orientation', v)} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Margin</p>
            <Select value={String(f.margin_mm)} onChange={v => set('margin_mm', Number(v))}>
              {[0, 3, 5, 8, 10, 12, 15, 20, 25].map(v => <option key={v} value={v}>{v} mm</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium mb-1">Grid columns</p>
              <Segmented value={String(f.cols)} options={GRID_COLS.map(c => [String(c), String(c)])} onChange={v => set('cols', Number(v))} />
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Row height</p>
              <Segmented value={String(f.row_mm)} options={ROW_MM.map(r => [String(r), r + 'mm'])} onChange={v => set('row_mm', Number(v))} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Text size (whole menu)</p>
            <Select value={String(f.font_scale)} onChange={v => set('font_scale', Number(v))}>
              {[70, 80, 90, 100, 110, 120, 130, 140, 150].map(v => <option key={v} value={v}>{v}%</option>)}
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Variant options per row</p>
            <Segmented value={String(f.variant_columns)} options={[['1', '1'], ['2', '2'], ['3', '3']]} onChange={v => set('variant_columns', Number(v))} />
            <p className="text-[11px] text-muted-foreground mt-1">Default for every dish. A dish or section block can use its own setting.</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Grid: {g.cols} columns x {g.rows} rows on {next.paper_size} {next.orientation}. Changing the grid keeps
            blocks where they are; a smaller page moves blocks that no longer fit back inside it.
          </p>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="text-sm border rounded-md px-4 min-h-[44px] touch-manipulation">Cancel</button>
          <button onClick={() => onApply(next)} className="text-sm rounded-md px-4 min-h-[44px] bg-primary text-primary-foreground touch-manipulation">Apply</button>
        </div>
      </div>
    </div>
  )
}
