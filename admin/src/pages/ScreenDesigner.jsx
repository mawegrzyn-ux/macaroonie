// src/pages/ScreenDesigner.jsx
//
// The board designer (/screens/boards/:id, module `screens`, migration 166).
// A board is a fixed-size canvas in pixels; blocks sit anywhere on it:
// headings and text, a menu section (or picked dishes) with prices, a
// featured dish, a lone price for a photo design, images, boxes and lines,
// a clock, the allergen key. Drag to move, corner to resize, snapping to
// the board's grid; the right panel holds the selected block's options or
// the board's own settings. Explicit Save.
//
// What the canvas draws comes from shared/screenLayout.js, the renderer the
// screens' player runs, with the same menu data (the LIVE menus by default,
// or the drafts with "Draft prices"); the designer only adds the selection
// box, the handles, placeholders for empty blocks and a wall's guide lines.
// Videos play, scrolling text and block animations move only on Play
// (startBoardMotion(), the player's own code), so blocks can be placed
// where they end up.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Save, Plus, Minus, Maximize2, Trash2, Copy, ChevronsUp, ChevronsDown, ChevronUp, ChevronDown,
  Image as ImageIcon, Type, Heading, ListOrdered, Star, PoundSterling, Square, Clock, Tag, X, Grid3x3, Film, ScrollText,
  Play, Pause, ClipboardCheck,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { FileDropArea } from '@/components/FileDropArea'
import { useFileDrop, uploadMedia, mediaSize, isVideoFile, noImageDrag } from '@/lib/fileDrop'
import { FontPicker } from '@/components/website-builder/FontPicker'
import {
  useScreenCss, useBoardFonts, useScreenData, ColourField, PxBox, errorText, useTick,
} from '@/components/screens/shared'
import {
  BLOCK_TYPES, BLOCK_LABELS, BLOCK_HINTS, BLOCK_DEFAULTS, BOARD_SIZES, SCREEN_FONT_OPTIONS, ANIM_IN, ANIM_LOOP,
  normalizeBoard, boardContext, renderBlockInner, blockStyle, boardStyle, toReactStyle, dishOptionLabels,
  wrapMotion, startBoardMotion, wallRegion, ORDER_CHANGE_ANIMS,
} from '@shared/screenLayout.js'
import { ORDER_FIELDS, MAIN_FIELDS, normaliseOrderInfo } from '@shared/orderInfo.js'
import { boardFromKit } from '@shared/themeKit.js'
import { ThemeMakerButton } from '@/components/themes/ThemeMaker'

const ICONS = {
  heading: Heading, text: Type, menu: ListOrdered, dish: Star, price: PoundSterling,
  image: ImageIcon, video: Film, ticker: ScrollText, box: Square, clock: Clock, allergen_key: Tag,
  order_status: ClipboardCheck,
}

const DESIGNER_CSS = `
.sd-board .sl-block { cursor: move; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.sd-board img, .sd-board video { -webkit-user-drag: none; }
.sd-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center;
  border: calc(2px / var(--sd-scale, 1)) dashed rgba(255,255,255,0.45); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.75);
  font-family: system-ui, sans-serif; font-size: calc(13px / var(--sd-scale, 1)); line-height: 1.3; padding: calc(6px / var(--sd-scale, 1)); }
.sd-gl { stroke: rgba(96, 165, 250, 0.35); stroke-width: 1; }
.sd-gl5 { stroke: rgba(96, 165, 250, 0.7); stroke-width: 1; }
`

const uid = () => 'b' + crypto.randomUUID().replace(/-/g, '').slice(0, 10)

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Where a new block goes: the first free place, row by row, else cascaded from the top left.
function freeSpot(blocks, w, h, W, H, grid) {
  const step = Math.max(grid, Math.round(Math.min(W, H) / 40))
  const margin = snapTo(Math.round(Math.min(W, H) * 0.03), grid)
  for (let y = margin; y + h <= H - margin; y += step) {
    for (let x = margin; x + w <= W - margin; x += step) {
      const r = { x, y, w, h }
      if (!blocks.some(b => overlaps(r, b))) return { x, y }
    }
  }
  const n = blocks.length % 10
  return { x: margin + n * grid * 3, y: margin + n * grid * 3 }
}
const snapTo = (v, g) => (g > 1 ? Math.round(v / g) * g : Math.round(v))

const GRID_KEY = 'maca_screen_grid'

// Grid lines over the board, drawn in screen pixels so they stay one pixel
// wide at any zoom (inside the scaled board a 1px line shrinks to nothing).
// A line every snap step, or every few steps when they'd be under 10px
// apart; every fifth line darker. Above the blocks, so a full-board picture
// doesn't hide it; it takes no taps.
function GridLines({ W, H, grid, scale }) {
  const step = Math.max(1, grid) * Math.max(1, Math.ceil(10 / (Math.max(1, grid) * scale)))
  const lines = []
  const at = v => Math.round(v * scale) + 0.5
  for (let i = 1, x = step; x < W; i++, x += step) lines.push(<line key={'x' + i} x1={at(x)} x2={at(x)} y1={0} y2={H * scale} className={i % 5 ? 'sd-gl' : 'sd-gl5'} />)
  for (let i = 1, y = step; y < H; i++, y += step) lines.push(<line key={'y' + i} y1={at(y)} y2={at(y)} x1={0} x2={W * scale} className={i % 5 ? 'sd-gl' : 'sd-gl5'} />)
  return (
    <svg className="absolute left-0 top-0 pointer-events-none" width={W * scale} height={H * scale} style={{ zIndex: 3 }}
      shapeRendering="crispEdges" aria-hidden="true" data-testid="board-grid-lines" data-step={step}>
      {lines}
    </svg>
  )
}

// A dropped picture's block: its own shape, at most 40% of the board wide and half of it high.
function fitSize(iw, ih, W, H) {
  if (!(iw > 0) || !(ih > 0)) return null
  const s = Math.min((W * 0.4) / iw, (H * 0.5) / ih)
  return { w: Math.max(40, Math.round(iw * s)), h: Math.max(40, Math.round(ih * s)) }
}

// A video's length in seconds (to offer "show it for the video's length" in playlists).
function readVideoSeconds(url) {
  return new Promise(resolve => {
    const v = document.createElement('video')
    let done = false
    const finish = d => {
      if (done) return
      done = true
      v.removeAttribute('src')
      try { v.load() } catch { /* gone */ }
      resolve(d)
    }
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null)
    v.onerror = () => finish(null)
    setTimeout(() => finish(null), 15000)
    v.src = url
  })
}

function useVenues() {
  const api = useApi()
  return useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') }).data || []
}

export default function ScreenDesigner() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('screens')
  useScreenCss()
  useTick(30_000)

  const { data: design, isLoading, isError } = useQuery({
    queryKey: ['screen-design', id], queryFn: () => api.get(`/screens/designs/${id}`),
  })
  const venues = useVenues()
  const [version, setVersion] = useState('live')
  const [venueId, setVenueId] = useState('')
  const { data: menuData } = useScreenData({ version, venueId })

  const [name, setName] = useState('')
  const [layout, setLayout] = useState(null)
  const [savedJson, setSavedJson] = useState('')
  const [sel, setSel] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [fitZoom, setFitZoom] = useState(0.5)
  const [drag, setDrag] = useState(null)
  const [showGrid, setShowGrid] = useState(() => { try { return localStorage.getItem(GRID_KEY) === '1' } catch { return false } })
  const toggleGrid = () => setShowGrid(g => {
    try { localStorage.setItem(GRID_KEY, g ? '0' : '1') } catch { /* private window */ }
    return !g
  })
  const [playing, setPlaying] = useState(false)
  const [, setFontsTick] = useState(0)

  const canvasRef = useRef(null)
  const boardRef = useRef(null)
  const dragRef = useRef(null)
  const live = useRef({})

  // Load once per board; a refetch never replaces what is being edited.
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!design || loadedFor.current === design.id) return
    loadedFor.current = design.id
    const l = normalizeBoard(design.layout, design.width, design.height)
    setName(design.name)
    setLayout(l)
    setSavedJson(JSON.stringify({ name: design.name, l }))
  }, [design])

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = DESIGNER_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
  useBoardFonts(useMemo(() => (layout ? [layout] : []), [layout?.font_body, layout?.font_heading, layout?.font_script, layout?.blocks]),
    () => setFontsTick(t => t + 1))

  const W = layout?.width || 1920
  const H = layout?.height || 1080
  const scale = zoom ?? fitZoom
  const grid = layout?.grid || 10
  live.current = { scale, grid, W, H }
  const dirty = !!layout && JSON.stringify({ name, l: layout }) !== savedJson

  // Fit the whole board in the canvas.
  useEffect(() => {
    const el = canvasRef.current
    if (!el || !layout) return
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientWidth - 48) / W, (el.clientHeight - 48) / H)
      setFitZoom(Math.max(0.05, Math.min(2, s)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H, !!layout])

  // Videos show a still frame while you edit and play only after Play is pressed.
  const ctx = useMemo(() => {
    if (!layout) return null
    return boardContext(layout, { ...(menuData || {}), width: W, height: H, now: new Date(), still: !playing })
  }, [layout, menuData, W, H, playing])

  // Play: the board moves as on a screen (from the start each time it is pressed).
  const playStart = useRef(0)
  useEffect(() => {
    if (!playing || !boardRef.current) return
    const t = Date.now()
    playStart.current = t
    startBoardMotion(boardRef.current, { startMs: t, nowMs: t })
  }, [playing])

  const save = useMutation({
    mutationFn: () => api.put(`/screens/designs/${id}`, { name: name.trim() || 'Board', width: W, height: H, layout }),
    onSuccess: row => {
      const l = normalizeBoard(row.layout, row.width, row.height)
      setLayout(l)
      setName(row.name)
      setSavedJson(JSON.stringify({ name: row.name, l }))
      qc.invalidateQueries({ queryKey: ['screen-designs'] })
      qc.setQueryData(['screen-design', id], row)
    },
  })

  // ── Layout changes ─────────────────────────────────────────────
  const mutate = useCallback(fn => setLayout(l => (l ? fn(l) : l)), [])
  const patchBoard = patch => mutate(l => ({ ...l, ...patch }))
  const updateBlock = useCallback((bid, patch) => mutate(l => ({
    ...l, blocks: l.blocks.map(b => (b.id === bid ? { ...b, ...patch } : b)),
  })), [mutate])
  const updateOpts = (bid, patch) => mutate(l => ({
    ...l, blocks: l.blocks.map(b => (b.id === bid ? { ...b, opts: { ...b.opts, ...patch } } : b)),
  }))
  const removeBlock = bid => { mutate(l => ({ ...l, blocks: l.blocks.filter(b => b.id !== bid) })); setSel(null) }

  function addBlock(type, at = null, opts = {}, size = null) {
    if (!layout) return
    const d = BLOCK_DEFAULTS[type]
    const w = Math.max(grid, snapTo(size?.w ?? Math.round(W * d.w), grid))
    const h = Math.max(grid, snapTo(size?.h ?? Math.round(H * d.h), grid))
    const spot = at ? { x: at.x - w / 2, y: at.y - h / 2 } : freeSpot(layout.blocks, w, h, W, H, grid)
    const { x, y } = spot
    const block = {
      id: uid(), type,
      x: Math.max(0, Math.min(W - w, snapTo(x, grid))), y: Math.max(0, Math.min(H - h, snapTo(y, grid))), w, h,
      opts: { ...structuredClone(d.opts), ...opts },
    }
    mutate(l => ({ ...l, blocks: [...l.blocks, block] }))
    setSel(block.id)
  }

  function duplicate(bid) {
    const b = layout.blocks.find(x => x.id === bid)
    if (!b) return
    const copy = { ...structuredClone(b), id: uid(), x: Math.min(W - b.w, b.x + grid * 2), y: Math.min(H - b.h, b.y + grid * 2) }
    mutate(l => ({ ...l, blocks: [...l.blocks, copy] }))
    setSel(copy.id)
  }

  function restack(bid, to) {
    mutate(l => {
      const i = l.blocks.findIndex(b => b.id === bid)
      if (i < 0) return l
      const list = l.blocks.slice()
      const [b] = list.splice(i, 1)
      const j = to === 'front' ? list.length : to === 'back' ? 0 : to === 'up' ? Math.min(list.length, i + 1) : Math.max(0, i - 1)
      list.splice(j, 0, b)
      return { ...l, blocks: list }
    })
  }

  // ── Pointer: move, resize, drop from the tray ──────────────────
  function boardPoint(clientX, clientY) {
    const r = boardRef.current?.getBoundingClientRect()
    if (!r) return null
    const { scale: s } = live.current
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s, inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom }
  }

  function startDrag(d, e) {
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY, moved: false }
    const move = ev => {
      const cur = dragRef.current
      if (!cur) return
      if (!cur.moved && Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) < 4) return
      cur.moved = true
      ev.preventDefault()
      const { scale: s, grid: g } = live.current
      const snap = v => (ev.altKey ? Math.round(v) : snapTo(v, g))
      const dx = (ev.clientX - cur.startX) / s
      const dy = (ev.clientY - cur.startY) / s
      if (cur.kind === 'move') {
        cur.target = { x: snap(cur.x + dx), y: snap(cur.y + dy) }
        setDrag({ id: cur.id, ...cur.target })
      } else if (cur.kind === 'resize') {
        cur.target = { w: Math.max(8, snap(cur.w + dx)), h: Math.max(8, snap(cur.h + dy)) }
        setDrag({ id: cur.id, ...cur.target })
      } else if (cur.kind === 'new') {
        const p = boardPoint(ev.clientX, ev.clientY)
        cur.target = p?.inside ? p : null
        setDrag({ kind: 'new', label: cur.label, px: ev.clientX, py: ev.clientY, over: !!cur.target })
      }
    }
    const end = commit => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const cur = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!commit || !cur || !cur.moved || !cur.target) return
      if (cur.kind === 'new') addBlock(cur.type, cur.target, cur.opts)
      else updateBlock(cur.id, cur.target)
    }
    const up = end(true)
    const cancel = end(false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  function onBlockPointerDown(e, b) {
    if (e.button != null && e.button !== 0) return
    e.stopPropagation()
    const was = sel === b.id
    setSel(b.id)
    if (!canManage) return
    if (e.pointerType !== 'mouse' && !was) return
    startDrag({ kind: 'move', id: b.id, x: b.x, y: b.y }, e)
  }
  function onResizePointerDown(e, b) {
    e.stopPropagation()
    e.preventDefault()
    startDrag({ kind: 'resize', id: b.id, w: b.w, h: b.h }, e)
  }
  function onTrayPointerDown(e, type, label, opts) {
    if (!canManage) return
    e.preventDefault()
    startDrag({ kind: 'new', type, label, opts }, e)
  }

  // Pictures and videos dropped from the computer: into Media, then onto
  // the picture (or video) block they were dropped on, else a new block
  // there, the file's own shape.
  const [dropNote, setDropNote] = useState(null)   // { busy } | { error }
  async function dropFiles(files, e) {
    if (!layout) return
    const p = boardPoint(e.clientX, e.clientY)
    const at = p?.inside ? { x: p.x, y: p.y } : null
    const hit = at ? [...layout.blocks].reverse().find(b => at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h) : null
    const list = files.slice(0, 10)
    setDropNote({ busy: list.length > 1 ? `Adding ${list.length} files…` : 'Adding…' })
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const type = isVideoFile(file) ? 'video' : 'image'
        const [item, size] = await Promise.all([uploadMedia(api, file, 'screens'), mediaSize(file)])
        const extra = type === 'video' ? { duration: size.duration ?? null } : {}
        if (i === 0 && hit && hit.type === type) {
          updateOpts(hit.id, { url: item.url, ...extra })
          setSel(hit.id)
        } else {
          const spot = at ? { x: at.x + i * grid * 4, y: at.y + i * grid * 4 } : null
          addBlock(type, spot, { url: item.url, ...extra }, fitSize(size.width, size.height, W, H))
        }
      }
      setDropNote(null)
    } catch (err) {
      setDropNote({ error: 'Couldn\'t add that file: ' + errorText(err) })
    }
  }
  const fileDrop = useFileDrop({
    kinds: ['image', 'video'], disabled: !canManage || !!dropNote?.busy,
    onFiles: dropFiles, onRefused: msg => setDropNote({ error: msg }),
  })

  // Keys: arrows nudge (Shift: one grid step), Delete removes, Escape lets go.
  useEffect(() => {
    const onKey = e => {
      if (!sel || !layout || !canManage) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      const b = layout.blocks.find(x => x.id === sel)
      if (!b) return
      const step = e.shiftKey ? grid : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (d) { e.preventDefault(); updateBlock(sel, { x: b.x + d[0], y: b.y + d[1] }) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(sel) }
      else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Render ─────────────────────────────────────────────────────
  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (isError || !design) return <div className="p-6 text-sm text-destructive">Board not found.</div>
  if (!layout || !ctx) return null

  const selected = layout.blocks.find(b => b.id === sel) || null
  const shown = b => (drag && drag.id === b.id ? { ...b, ...drag } : b)

  return (
    <div className="h-full flex flex-col bg-muted/30">
      <div className="shrink-0 h-14 border-b bg-background flex items-center gap-2 px-4 max-lg:notouch:pl-14">
        <button onClick={() => navigate('/screens?tab=boards')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] px-2 touch-manipulation">
          <ArrowLeft className="w-4 h-4" /> Boards
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{name || 'Board'}</p>
          <p className="text-[11px] text-muted-foreground truncate">{W} x {H} · {layout.blocks.length} block{layout.blocks.length === 1 ? '' : 's'}</p>
        </div>
        <div className="hidden md:flex items-center border rounded-md" role="group" aria-label="Prices shown">
          {[['live', 'Live prices'], ['draft', 'Draft prices']].map(([v, l]) => (
            <button key={v} onClick={() => setVersion(v)} title={v === 'live' ? 'What screens show now' : 'The menus as saved, before publishing'}
              className={cn('h-10 px-2.5 text-xs touch-manipulation', version === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>{l}</button>
          ))}
        </div>
        {venues.length > 0 && (
          <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Show sold out for"
            className="hidden lg:block h-10 rounded-md border bg-background px-2 text-xs touch-manipulation max-w-[170px]">
            <option value="">No sold out shown</option>
            {venues.map(v => <option key={v.id} value={v.id}>Sold out at {v.name}</option>)}
          </select>
        )}
        <button onClick={() => setPlaying(p => !p)} data-testid="board-play"
          title={playing ? 'Stop: show blocks where they end up' : 'Play the animations and scrolling text'}
          className={cn('inline-flex items-center gap-1.5 h-10 px-3 rounded-md border text-xs font-medium touch-manipulation',
            playing ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent')}>
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          <span className="hidden sm:inline">{playing ? 'Stop' : 'Play'}</span>
        </button>
        <div className="hidden md:flex items-center border rounded-md">
          <button onClick={() => setZoom(Math.max(0.05, +(scale * 0.8).toFixed(3)))} className="w-10 h-10 flex items-center justify-center touch-manipulation" title="Zoom out"><Minus className="w-4 h-4" /></button>
          <span className="text-xs w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={() => setZoom(Math.min(2, +(scale * 1.25).toFixed(3)))} className="w-10 h-10 flex items-center justify-center touch-manipulation" title="Zoom in"><Plus className="w-4 h-4" /></button>
          <button onClick={() => setZoom(null)} className={cn('w-10 h-10 flex items-center justify-center touch-manipulation', zoom === null && 'text-primary')} title="Fit"><Maximize2 className="w-4 h-4" /></button>
          <button onClick={toggleGrid} aria-pressed={showGrid} data-testid="board-grid"
            className={cn('w-10 h-10 flex items-center justify-center rounded-r-md touch-manipulation', showGrid ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            title={showGrid ? 'Hide the grid' : 'Show the grid'}><Grid3x3 className="w-4 h-4" /></button>
        </div>
        {canManage ? (
          <button disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="board-save"
            className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 touch-manipulation">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {dirty ? 'Save' : 'Saved'}
          </button>
        ) : <span className="text-xs text-muted-foreground px-2">View only</span>}
      </div>
      {save.isError && <div className="shrink-0 bg-destructive/10 text-destructive text-sm px-4 py-2 border-b">Save failed: {errorText(save.error)}</div>}
      {(fileDrop.over || dropNote) && (
        <div role="status" data-testid="drop-note"
          className={cn('fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] rounded-lg shadow-lg px-4 py-2.5 text-sm flex items-center gap-2',
            dropNote?.error ? 'bg-destructive text-destructive-foreground' : 'bg-foreground text-background')}>
          {dropNote?.busy && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          <span>{dropNote?.error || dropNote?.busy || 'Drop onto a picture or video to replace it, anywhere else to add it.'}</span>
          {dropNote?.error && (
            <button type="button" onClick={() => setDropNote(null)} aria-label="Close" className="w-8 h-8 -mr-2 flex items-center justify-center rounded touch-manipulation"><X className="w-4 h-4" /></button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {canManage && <Tray menus={menuData?.menus || []} onAdd={addBlock} onDragStart={onTrayPointerDown} />}

        <div ref={canvasRef} className={cn('flex-1 min-w-0 overflow-auto p-6 flex', fileDrop.over && 'ring-4 ring-inset ring-primary/50 bg-primary/5')}
          onPointerDown={() => setSel(null)} onDragStart={noImageDrag} {...fileDrop.dropProps} data-testid="board-canvas">
          <div className="relative m-auto shrink-0" style={{ width: W * scale, height: H * scale }}>
            <div ref={boardRef} className={'sl-board sd-board absolute left-0 top-0 shadow-lg' + (playing ? ' sl-play' : '')}
              style={{ ...toReactStyle(boardStyle(layout)), transform: `scale(${scale})`, transformOrigin: '0 0', '--sd-scale': scale }}>
              {layout.blocks.map((b0, i) => {
                const b = shown(b0)
                const inner = renderBlockInner(b, ctx)
                const empty = inner == null || inner === ''
                return (
                  <div key={b.id} className={'sl-block sl-t-' + b.type} data-block={b.id}
                    style={toReactStyle(blockStyle(b, i))}
                    onPointerDown={e => onBlockPointerDown(e, b)}>
                    {empty
                      ? <div className="sd-empty">{placeholder(b, inner, menuData)}</div>
                      : <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: wrapMotion(b, inner) }} />}
                  </div>
                )
              })}
            </div>
            {showGrid && <GridLines W={W} H={H} grid={grid} scale={scale} />}
            {/* Where a wall's screens meet (looks only): each screen's part, the gaps shaded. */}
            {(layout.guide_cols > 1 || layout.guide_rows > 1) && (
              <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }} data-testid="wall-guides">
                {Array.from({ length: layout.guide_rows }).flatMap((_, row) => Array.from({ length: layout.guide_cols }).map((__, col) => {
                  const r = wallRegion(W, H, { cols: layout.guide_cols, rows: layout.guide_rows, col, row, gap: layout.guide_gap })
                  return (
                    <div key={col + ':' + row} className="absolute" style={{
                      left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale,
                      outline: '2px dashed rgba(255, 196, 0, 0.85)', outlineOffset: -1,
                      boxShadow: layout.guide_gap ? '0 0 0 ' + Math.max(1, layout.guide_gap * scale / 2) + 'px rgba(0,0,0,0.45)' : undefined,
                    }}>
                      <span className="absolute left-1 top-1 rounded bg-black/70 text-[10px] text-amber-300 px-1">Screen {row * layout.guide_cols + col + 1}</span>
                    </div>
                  )
                }))}
              </div>
            )}
            {/* Selection box and resize handle, on top of the board (not clipped by it). */}
            {selected && (() => {
              const b = shown(selected)
              return (
                <div className="absolute pointer-events-none" style={{
                  left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale,
                  outline: '2px solid #3b82f6', outlineOffset: 1, zIndex: 5,
                }}>
                  {canManage && (
                    <span onPointerDown={e => onResizePointerDown(e, selected)} title="Drag to resize"
                      className="absolute pointer-events-auto bg-white border-2 border-blue-500 rounded-sm"
                      style={{ right: -9, bottom: -9, width: 18, height: 18, cursor: 'nwse-resize', touchAction: 'none' }} />
                  )}
                </div>
              )
            })()}
          </div>
        </div>

        <aside className="w-80 shrink-0 border-l bg-background overflow-y-auto" onPointerDown={e => e.stopPropagation()}>
          {selected ? (
            <BlockPanel key={selected.id} block={selected} board={layout} data={menuData} canManage={canManage}
              onUpdate={patch => updateBlock(selected.id, patch)}
              onOpts={patch => updateOpts(selected.id, patch)}
              onDuplicate={() => duplicate(selected.id)} onRemove={() => removeBlock(selected.id)}
              onRestack={to => restack(selected.id, to)} onClose={() => setSel(null)} />
          ) : (
            <BoardPanel board={layout} name={name} setName={setName} canManage={canManage}
              onPatch={patchBoard} venues={venues} version={version} setVersion={setVersion}
              venueId={venueId} setVenueId={setVenueId} />
          )}
        </aside>
      </div>

      {drag?.kind === 'new' && drag.px != null && (
        <div className="fixed z-[60] pointer-events-none px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium shadow-lg"
          style={{ left: drag.px + 12, top: drag.py + 12 }}>
          {drag.label}{drag.over ? '' : ' · drop on the board'}
        </div>
      )}
    </div>
  )
}

// What an empty block shows in the designer only.
function placeholder(b, inner, data) {
  const o = b.opts || {}
  const unpublished = new Set((data?.unpublished || []).map(m => m.id))
  if (b.type === 'menu') {
    if (!o.menu_id) return 'Menu list: pick a menu'
    if (unpublished.has(o.menu_id)) return 'This menu isn\'t published yet'
    if (inner == null) return o.source === 'dishes' ? 'Pick dishes' : 'Pick a section (or it isn\'t in the published menu)'
    return 'No dishes to show'
  }
  if (b.type === 'dish' || b.type === 'price') {
    if (!o.menu_id || !o.item_id) return BLOCK_LABELS[b.type] + ': pick a dish'
    if (unpublished.has(o.menu_id)) return 'This menu isn\'t published yet'
    if (inner == null) return 'This dish isn\'t in the published menu'
    return 'Sold out: hidden on the screen'
  }
  if (b.type === 'image') return 'Pick an image'
  if (b.type === 'video') return 'Pick a video'
  if (b.type === 'ticker') return 'Scrolling text: type some text'
  if (b.type === 'allergen_key') return 'Allergen key: no tags on this board\'s dishes'
  if (b.type === 'heading' || b.type === 'text') return 'Type some text'
  return BLOCK_LABELS[b.type]
}

// ── Tray ─────────────────────────────────────────────────────────

function Tray({ menus, onAdd, onDragStart }) {
  const [menuId, setMenuId] = useState('')
  const menu = menus.find(m => m.id === menuId) || menus[0]
  return (
    <aside className="w-56 shrink-0 border-r bg-background overflow-y-auto hidden md:block" onPointerDown={e => e.stopPropagation()}>
      <div className="p-3 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1">Add a block</p>
        {BLOCK_TYPES.map(t => {
          const Icon = ICONS[t]
          return (
            <TrayRow key={t} label={BLOCK_LABELS[t]} hint={BLOCK_HINTS[t]} icon={Icon}
              onAdd={() => onAdd(t)} onDragStart={e => onDragStart(e, t, BLOCK_LABELS[t])} />
          )
        })}
      </div>
      {menus.length > 0 && (
        <div className="p-3 border-t space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1">Menu sections</p>
          {menus.length > 1 && (
            <select value={menu?.id || ''} onChange={e => setMenuId(e.target.value)} aria-label="Menu"
              className="w-full h-10 rounded-md border bg-background px-2 text-sm touch-manipulation mb-1">
              {menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {(menu?.sections || []).map(s => (
            <TrayRow key={s.id} label={s.title} hint={`${s.items.length} dish${s.items.length === 1 ? '' : 'es'}`} icon={ListOrdered}
              onAdd={() => onAdd('menu', null, { menu_id: menu.id, section_id: s.id })}
              onDragStart={e => onDragStart(e, 'menu', s.title, { menu_id: menu.id, section_id: s.id })} />
          ))}
        </div>
      )}
      <p className="px-4 pb-4 text-[11px] text-muted-foreground">Tap + to add, or drag onto the board. Pictures and videos from your computer can be dropped straight onto the board.</p>
    </aside>
  )
}

function TrayRow({ label, hint, icon: Icon, onAdd, onDragStart }) {
  return (
    <div className="flex items-center gap-1 rounded-md hover:bg-muted">
      <span onPointerDown={onDragStart} style={{ touchAction: 'none' }} title={hint}
        className="flex-1 min-w-0 flex items-center gap-2 px-2 min-h-[44px] cursor-grab select-none">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="text-sm truncate">{label}</span>
      </span>
      <button onClick={onAdd} aria-label={'Add ' + label} className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md hover:bg-background touch-manipulation">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Panels ───────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="px-4 py-3 border-b space-y-2.5">
      {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
      {children}
    </div>
  )
}

function Seg({ value, options, onChange }) {
  return (
    <div className="flex border rounded-md overflow-hidden">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={cn('flex-1 text-xs min-h-[40px] px-1 touch-manipulation', value === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
          {l}
        </button>
      ))}
    </div>
  )
}

// What each order status tile shows (shared/orderInfo.js): a big value and
// small lines under it, in the fields' own order.
function TileSection({ o, onOpts }) {
  const info = normaliseOrderInfo(o.tile_main, o.tile_lines)
  const toggle = key => {
    const on = info.lines.includes(key)
    const next = ORDER_FIELDS.map(f => f.key).filter(k => k !== info.main && (k === key ? !on : info.lines.includes(k)))
    onOpts({ tile_lines: next })
  }
  const mainLabel = ORDER_FIELDS.find(f => f.key === info.main)?.label.toLowerCase()
  return (
    <Section title="Each tile">
      <Sel label="Big text" value={info.main} onChange={v => onOpts({ tile_main: v, tile_lines: info.lines.filter(k => k !== v) })}>
        {MAIN_FIELDS.map(k => <option key={k} value={k}>{ORDER_FIELDS.find(f => f.key === k).label}</option>)}
      </Sel>
      {info.main !== 'number' && (
        <p className="text-[11px] text-muted-foreground">An order with no {mainLabel} shows its order number instead.</p>
      )}
      <div className="text-xs font-medium">Under it</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Under it" data-testid="tile-lines">
        {ORDER_FIELDS.filter(f => f.key !== info.main).map(f => (
          <button key={f.key} type="button" onClick={() => toggle(f.key)} aria-pressed={info.lines.includes(f.key)} data-k={f.key}
            className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation',
              info.lines.includes(f.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        A line shows only when the order has it. Tent numbers come from counter tills and kiosks that ask for one (Till setup &gt; Revenue streams);
        names are the name typed on a till or kiosk, or an online guest's first name, and show on a public screen.
      </p>
    </Section>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm min-h-[36px] cursor-pointer touch-manipulation">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4" />
      {label}
    </label>
  )
}

function Sel({ label, value, onChange, children }) {
  return (
    <label className="block">
      {label && <span className="block text-[11px] text-muted-foreground mb-0.5">{label}</span>}
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full text-sm border rounded-md px-2 min-h-[40px] bg-background touch-manipulation">
        {children}
      </select>
    </label>
  )
}

const FONT_ROLE_LABEL = [['body', 'Body'], ['heading', 'Heading'], ['script', 'Script']]

function FontChoice({ value, onChange }) {
  const role = ['body', 'heading', 'script'].includes(value) ? value : null
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">Font</p>
      <Seg value={role} options={FONT_ROLE_LABEL} onChange={onChange} />
      <FontPicker fonts={SCREEN_FONT_OPTIONS} value={role ? '' : value || ''} placeholder="Or another font" onChange={onChange} />
    </div>
  )
}

function TextStyle({ o, onOpts, dflt }) {
  return (
    <>
      <FontChoice value={o.font || dflt.font} onChange={v => onOpts({ font: v })} />
      <div className="grid grid-cols-2 gap-2">
        <PxBox label="Size" value={o.size ?? dflt.size} min={6} max={1200} onChange={v => onOpts({ size: v })} />
        <Sel label="Weight" value={String(o.weight ?? dflt.weight)} onChange={v => onOpts({ weight: Number(v) })}>
          {[300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
        </Sel>
      </div>
      <ColourField label="Colour" value={o.color || null} optional onChange={v => onOpts({ color: v })} />
      <Seg value={o.align || 'left'} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={v => onOpts({ align: v })} />
      <Seg value={o.valign || 'top'} options={[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]} onChange={v => onOpts({ valign: v })} />
      <div className="flex gap-4">
        <Check label="Italic" checked={o.italic} onChange={v => onOpts({ italic: v })} />
        <Check label="Capitals" checked={o.upper} onChange={v => onOpts({ upper: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PxBox label="Letter spacing" suffix="%" value={o.spacing ?? 0} min={-20} max={100} onChange={v => onOpts({ spacing: v })} />
        <PxBox label="Line height" suffix="%" value={Math.round((o.line_height ?? 1.2) * 100)} min={60} max={300} onChange={v => onOpts({ line_height: v / 100 })} />
      </div>
    </>
  )
}

function MenuPick({ data, o, onOpts }) {
  const menus = data?.menus || []
  const unpublished = data?.unpublished || []
  return (
    <Sel label="Menu" value={o.menu_id || ''} onChange={v => onOpts({ menu_id: v || null, section_id: null, item_id: null, item_ids: [] })}>
      <option value="">Pick a menu</option>
      {menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      {unpublished.map(m => <option key={m.id} value={m.id}>{m.name} (not published yet)</option>)}
    </Sel>
  )
}

function DishPick({ menu, value, onChange, label = 'Dish', exclude }) {
  return (
    <Sel label={label} value={value || ''} onChange={v => onChange(v || null)}>
      <option value="">Pick a dish</option>
      {(menu?.sections || []).map(s => (
        <optgroup key={s.id} label={s.title}>
          {s.items.filter(it => !exclude || !exclude.has(it.id)).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
        </optgroup>
      ))}
    </Sel>
  )
}

// The picture / video part of a block's panel: a file dropped on it goes
// into Media and onto the block.
function PanelDrop({ kind, disabled, onUploaded, children }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function onFiles(files) {
    setBusy(true); setError(null)
    try {
      const [item, size] = await Promise.all([uploadMedia(api, files[0], 'screens'), mediaSize(files[0])])
      onUploaded(item, size)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FileDropArea kinds={[kind]} disabled={disabled || busy} onFiles={onFiles} onRefused={setError}
      label={kind === 'video' ? 'Drop to use this video' : 'Drop to use this picture'} className="space-y-2.5">
      {children}
      <p className="text-[11px] text-muted-foreground">
        {busy ? 'Adding…' : `Or drop ${kind === 'video' ? 'a video' : 'a picture'} from your computer here, or onto the board.`}
      </p>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </FileDropArea>
  )
}

function BlockPanel({ block, board, data, canManage, onUpdate, onOpts, onDuplicate, onRemove, onRestack, onClose }) {
  const o = block.opts || {}
  const [mediaOpen, setMediaOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const menu = (data?.menus || []).find(m => m.id === o.menu_id)
  const itemsById = Object.fromEntries((menu?.sections || []).flatMap(s => s.items).map(i => [i.id, i]))
  const W = board.width, H = board.height

  return (
    <fieldset disabled={!canManage} className="min-w-0 m-0 p-0 border-0">
      <div className="flex items-center gap-2 px-4 h-12 border-b">
        <p className="flex-1 text-sm font-semibold">{BLOCK_LABELS[block.type]}</p>
        <button type="button" onClick={onClose} aria-label="Done" className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
      </div>

      {(block.type === 'heading' || block.type === 'text') && (
        <Section title="Text">
          <textarea value={o.text || ''} onChange={e => onOpts({ text: e.target.value })} rows={block.type === 'text' ? 5 : 2}
            className="w-full text-sm border rounded-md px-2 py-2 bg-background" aria-label="Text" />
          <TextStyle o={o} onOpts={onOpts} dflt={block.type === 'heading' ? { font: 'heading', size: 96, weight: 700 } : { font: 'body', size: 36, weight: 400 }} />
        </Section>
      )}

      {block.type === 'menu' && (
        <>
          <Section title="Dishes">
            <Seg value={o.source === 'dishes' ? 'dishes' : 'section'} options={[['section', 'A section'], ['dishes', 'Pick dishes']]}
              onChange={v => onOpts({ source: v })} />
            <MenuPick data={data} o={o} onOpts={onOpts} />
            {menu && o.source !== 'dishes' && (
              <Sel label="Section" value={o.section_id || ''} onChange={v => onOpts({ section_id: v || null })}>
                <option value="">Pick a section</option>
                {menu.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </Sel>
            )}
            {menu && o.source === 'dishes' && (
              <div className="space-y-1.5">
                {(o.item_ids || []).map((iid, i, arr) => (
                  <div key={iid} className="flex items-center gap-1 text-sm">
                    <span className="flex-1 min-w-0 truncate">{itemsById[iid]?.name || 'Not in this menu'}</span>
                    <button type="button" disabled={i === 0} onClick={() => { const n = arr.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; onOpts({ item_ids: n }) }}
                      className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-30" aria-label="Up"><ChevronUp className="w-4 h-4" /></button>
                    <button type="button" disabled={i === arr.length - 1} onClick={() => { const n = arr.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; onOpts({ item_ids: n }) }}
                      className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-30" aria-label="Down"><ChevronDown className="w-4 h-4" /></button>
                    <button type="button" onClick={() => onOpts({ item_ids: arr.filter(x => x !== iid) })}
                      className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-muted" aria-label="Remove"><X className="w-4 h-4" /></button>
                  </div>
                ))}
                <DishPick menu={menu} value="" label="Add a dish" exclude={new Set(o.item_ids || [])}
                  onChange={v => v && onOpts({ item_ids: [...(o.item_ids || []), v] })} />
              </div>
            )}
            <Check label="Show the title" checked={o.show_title !== false} onChange={v => onOpts({ show_title: v })} />
            {o.show_title !== false && (
              <input value={o.title || ''} onChange={e => onOpts({ title: e.target.value })} placeholder={o.source === 'dishes' ? 'Title' : 'The section\'s name'}
                className="w-full h-10 text-sm border rounded-md px-2 bg-background" aria-label="Title" />
            )}
          </Section>
          <Section title="Show">
            <Check label="Descriptions" checked={o.show_desc !== false} onChange={v => onOpts({ show_desc: v })} />
            <Check label="Calories" checked={!!o.show_cal} onChange={v => onOpts({ show_cal: v })} />
            <Check label="Allergen and diet tags" checked={o.show_tags !== false} onChange={v => onOpts({ show_tags: v })} />
            <Check label="Options with their prices" checked={o.show_options !== false} onChange={v => onOpts({ show_options: v })} />
            <Check label="Dotted line to the price" checked={!!o.leaders} onChange={v => onOpts({ leaders: v })} />
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Combos</p>
              <Seg value={o.combo_view === 'steps' ? 'steps' : 'menu'} options={[['menu', 'Like the menu'], ['steps', 'How to order (steps)']]} onChange={v => onOpts({ combo_view: v })} />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Columns</p>
              <Seg value={Number(o.columns) || 1} options={[[1, '1'], [2, '2'], [3, '3'], [4, '4']]} onChange={v => onOpts({ columns: v })} />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Sold out dishes</p>
              <Seg value={o.sold_out === 'hide' ? 'hide' : 'mark'} options={[['mark', 'Cross out'], ['hide', 'Leave out']]} onChange={v => onOpts({ sold_out: v })} />
            </div>
          </Section>
          <Section title="Sizes and colours">
            <div className="grid grid-cols-2 gap-2">
              <PxBox label="Title" value={o.title_size ?? 56} min={6} max={600} onChange={v => onOpts({ title_size: v })} />
              <PxBox label="Dish name" value={o.name_size ?? 36} min={6} max={400} onChange={v => onOpts({ name_size: v })} />
              <PxBox label="Price" value={o.price_size ?? 36} min={6} max={400} onChange={v => onOpts({ price_size: v })} />
              <PxBox label="Description" value={o.desc_size ?? 22} min={6} max={300} onChange={v => onOpts({ desc_size: v })} />
              <PxBox label="Space between" value={o.gap ?? 18} min={0} max={400} onChange={v => onOpts({ gap: v })} />
            </div>
            <ColourField label="Title" value={o.title_color || null} optional onChange={v => onOpts({ title_color: v })} />
            <ColourField label="Dish names" value={o.name_color || null} optional onChange={v => onOpts({ name_color: v })} />
            <ColourField label="Prices" value={o.price_color || null} optional onChange={v => onOpts({ price_color: v })} />
            <ColourField label="Descriptions" value={o.desc_color || null} optional onChange={v => onOpts({ desc_color: v })} />
          </Section>
        </>
      )}

      {block.type === 'dish' && (
        <>
          <Section title="Dish">
            <MenuPick data={data} o={o} onOpts={onOpts} />
            {menu && <DishPick menu={menu} value={o.item_id} onChange={v => onOpts({ item_id: v })} />}
            <Seg value={o.layout === 'side' ? 'side' : 'stack'} options={[['stack', 'Photo on top'], ['side', 'Photo beside']]} onChange={v => onOpts({ layout: v })} />
            <Check label="Photo (from the dish)" checked={o.show_image !== false} onChange={v => onOpts({ show_image: v })} />
            {o.show_image !== false && (
              <div className="grid grid-cols-2 gap-2">
                <PxBox label="Photo share" suffix="%" value={o.image_share ?? 60} min={10} max={90} onChange={v => onOpts({ image_share: v })} />
                <Sel label="Photo fit" value={o.image_fit || 'cover'} onChange={v => onOpts({ image_fit: v })}>
                  <option value="cover">Fill</option><option value="contain">Whole photo</option>
                </Sel>
              </div>
            )}
            <Check label="Description" checked={o.show_desc !== false} onChange={v => onOpts({ show_desc: v })} />
            <Check label="Allergen and diet tags" checked={o.show_tags !== false} onChange={v => onOpts({ show_tags: v })} />
            <Check label="Price" checked={o.show_price !== false} onChange={v => onOpts({ show_price: v })} />
            {menu && (menu.sections || []).some(sec => (sec.items || []).some(i => i.id === o.item_id && i.kind === 'combo')) && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">This combo</p>
                <Seg value={o.combo_view === 'steps' ? 'steps' : 'menu'} options={[['menu', 'Like the menu'], ['steps', 'How to order (steps)']]} onChange={v => onOpts({ combo_view: v })} />
              </div>
            )}
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">When sold out</p>
              <Seg value={o.sold_out === 'hide' ? 'hide' : 'mark'} options={[['mark', 'Say sold out'], ['hide', 'Hide it']]} onChange={v => onOpts({ sold_out: v })} />
            </div>
          </Section>
          <Section title="Sizes and colours">
            <div className="grid grid-cols-3 gap-2">
              <PxBox label="Name" value={o.name_size ?? 56} min={6} max={600} onChange={v => onOpts({ name_size: v })} />
              <PxBox label="Price" value={o.price_size ?? 64} min={6} max={600} onChange={v => onOpts({ price_size: v })} />
              <PxBox label="Text" value={o.desc_size ?? 26} min={6} max={300} onChange={v => onOpts({ desc_size: v })} />
            </div>
            <ColourField label="Name" value={o.name_color || null} optional onChange={v => onOpts({ name_color: v })} />
            <ColourField label="Price" value={o.price_color || null} optional onChange={v => onOpts({ price_color: v })} />
            <ColourField label="Description" value={o.desc_color || null} optional onChange={v => onOpts({ desc_color: v })} />
          </Section>
        </>
      )}

      {block.type === 'price' && (
        <>
          <Section title="Price of">
            <MenuPick data={data} o={o} onOpts={onOpts} />
            {menu && <DishPick menu={menu} value={o.item_id} onChange={v => onOpts({ item_id: v, option: '' })} />}
            {menu && itemsById[o.item_id] && dishOptionLabels(itemsById[o.item_id], menu).length > 0 && (
              <Sel label="Option" value={o.option || ''} onChange={v => onOpts({ option: v })}>
                <option value="">Lowest price (from ...)</option>
                {dishOptionLabels(itemsById[o.item_id], menu).map(l => <option key={l} value={l}>{l}</option>)}
              </Sel>
            )}
            {!o.option && (
              <label className="block">
                <span className="block text-[11px] text-muted-foreground mb-0.5">Before a lowest price</span>
                <input value={o.from_text ?? 'from'} onChange={e => onOpts({ from_text: e.target.value })} maxLength={20}
                  className="w-full h-10 text-sm border rounded-md px-2 bg-background" />
              </label>
            )}
            <Check label="Show the dish name above" checked={!!o.show_name} onChange={v => onOpts({ show_name: v })} />
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">When sold out</p>
              <Seg value={o.sold_out === 'hide' ? 'hide' : 'mark'} options={[['mark', 'Say sold out'], ['hide', 'Hide it']]} onChange={v => onOpts({ sold_out: v })} />
            </div>
          </Section>
          <Section title="Style">
            <TextStyle o={o} onOpts={onOpts} dflt={{ font: 'heading', size: 80, weight: 700 }} />
          </Section>
        </>
      )}

      {block.type === 'image' && (
        <Section title="Image">
          <PanelDrop kind="image" disabled={!canManage} onUploaded={item => onOpts({ url: item.url })}>
            {o.url && <img src={o.url} alt="" draggable={false} className="w-full max-h-40 object-contain rounded-md border bg-muted" />}
            <button type="button" onClick={() => setMediaOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
              <ImageIcon className="w-4 h-4" /> {o.url ? 'Change image' : 'Pick from Media'}
            </button>
          </PanelDrop>
          <Sel label="Fit" value={o.fit || 'cover'} onChange={v => onOpts({ fit: v })}>
            <option value="cover">Fill the block (crop)</option>
            <option value="contain">Whole image</option>
            <option value="fill">Stretch</option>
          </Sel>
          <PxBox label="Rounded corners" value={o.radius ?? 0} min={0} max={2000} onChange={v => onOpts({ radius: v })} />
        </Section>
      )}

      {block.type === 'video' && (
        <Section title="Video">
          <PanelDrop kind="video" disabled={!canManage} onUploaded={(item, size) => onOpts({ url: item.url, duration: size.duration ?? null })}>
            {o.url && <video src={o.url} muted playsInline controls preload="metadata" className="w-full max-h-40 rounded-md border bg-black" />}
            <button type="button" onClick={() => setVideoOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
              <Film className="w-4 h-4" /> {o.url ? 'Change video' : 'Pick from Media'}
            </button>
          </PanelDrop>
          {o.duration > 0 && <p className="text-[11px] text-muted-foreground">{o.duration} seconds long.</p>}
          <Sel label="Fit" value={o.fit || 'cover'} onChange={v => onOpts({ fit: v })}>
            <option value="cover">Fill the block (crop)</option>
            <option value="contain">Whole video</option>
            <option value="fill">Stretch</option>
          </Sel>
          <PxBox label="Rounded corners" value={o.radius ?? 0} min={0} max={2000} onChange={v => onOpts({ radius: v })} />
          <Check label="Play again from the start when it ends" checked={o.loop !== false} onChange={v => onOpts({ loop: v })} />
          <Check label="With sound (where the screen allows it)" checked={!!o.sound} onChange={v => onOpts({ sound: v })} />
          <p className="text-[11px] text-muted-foreground">MP4 (H.264) plays on every screen. Videos are kept on each screen, so they play without the internet once loaded. On a wall, every screen plays the same moment of the video.</p>
        </Section>
      )}

      {block.type === 'ticker' && (
        <>
          <Section title="Scrolling text">
            <textarea value={o.text || ''} onChange={e => onOpts({ text: e.target.value })} rows={2}
              className="w-full text-sm border rounded-md px-2 py-2 bg-background" aria-label="Text" />
            <div className="grid grid-cols-2 gap-2">
              <PxBox label="Speed" suffix="px/s" value={o.speed ?? 120} min={10} max={2000} onChange={v => onOpts({ speed: v })} />
              <PxBox label="Space between" value={o.gap ?? 160} min={0} max={4000} onChange={v => onOpts({ gap: v })} />
            </div>
            <Seg value={o.direction === 'right' ? 'right' : 'left'} options={[['left', 'Moves left'], ['right', 'Moves right']]} onChange={v => onOpts({ direction: v })} />
            <ColourField label="Background" value={o.bg || null} optional placeholder="None" onChange={v => onOpts({ bg: v })} />
            {o.bg && <PxBox label="Background solid" suffix="%" value={o.bg_alpha ?? 100} min={0} max={100} onChange={v => onOpts({ bg_alpha: v })} />}
            <p className="text-[11px] text-muted-foreground">It moves on the screens and when you press Play. Across a wall it runs from one screen onto the next.</p>
          </Section>
          <Section title="Style">
            <TextStyle o={o} onOpts={onOpts} dflt={{ font: 'heading', size: 48, weight: 600 }} />
          </Section>
        </>
      )}

      {block.type === 'box' && (
        <Section title="Box or line">
          <ColourField label="Colour" value={o.color || '#000000'} onChange={v => onOpts({ color: v })} />
          <PxBox label="Solid" suffix="%" value={o.alpha ?? 100} min={0} max={100} onChange={v => onOpts({ alpha: v })} />
          <PxBox label="Rounded corners" value={o.radius ?? 0} min={0} max={4000} onChange={v => onOpts({ radius: v })} />
          <div className="grid grid-cols-2 gap-2">
            <PxBox label="Border" value={o.border_width ?? 0} min={0} max={200} onChange={v => onOpts({ border_width: v })} />
          </div>
          {Number(o.border_width) > 0 && <ColourField label="Border colour" value={o.border_color || '#ffffff'} onChange={v => onOpts({ border_color: v })} />}
          <p className="text-[11px] text-muted-foreground">For a line, make the block a few pixels high (or wide).</p>
        </Section>
      )}

      {block.type === 'clock' && (
        <Section title="Clock">
          <Seg value={o.format === '12' ? '12' : '24'} options={[['24', '14:30'], ['12', '2:30 pm']]} onChange={v => onOpts({ format: v })} />
          <Check label="Show the date" checked={!!o.show_date} onChange={v => onOpts({ show_date: v })} />
          <TextStyle o={o} onOpts={onOpts} dflt={{ font: 'body', size: 48, weight: 600 }} />
          <p className="text-[11px] text-muted-foreground">The venue's time, on each screen.</p>
        </Section>
      )}

      {block.type === 'allergen_key' && (
        <Section title="Allergen key">
          <p className="text-xs text-muted-foreground">Lists the tags used by the dishes on this board, as set in Menus &gt; Allergens &amp; dietary (allergen notice).</p>
          <Check label="Show the notice's words too" checked={!!o.show_notice} onChange={v => onOpts({ show_notice: v })} />
          <PxBox label="Size" value={o.size ?? 22} min={6} max={200} onChange={v => onOpts({ size: v })} />
          <ColourField label="Colour" value={o.color || null} optional onChange={v => onOpts({ color: v })} />
        </Section>
      )}

      {block.type === 'order_status' && (
        <>
          <Section title="Order status">
            <p className="text-xs text-muted-foreground">Order numbers from the kitchen screens (Till setup &gt; Kitchen screens). The designer shows example numbers.</p>
            <Sel label="Which orders" value={o.board || ''} onChange={v => onOpts({ board: v })}>
              <option value="">Every counter and online order</option>
              {[...new Set([...(data?.order_boards || []), ...(o.board ? [o.board] : [])])].map(n => (
                <option key={n} value={n}>Order ready board: {n}</option>
              ))}
            </Sel>
            <p className="text-[11px] text-muted-foreground">
              {o.board
                ? <>Orders on their way to the board station named &ldquo;{o.board}&rdquo; in the kitchen flow, ready once every dish has reached it. A screen at a venue without a board of that name shows none.</>
                : <>Ready once the kitchen has finished the whole order. Add an order ready board to the kitchen flow (Till setup &gt; Kitchen screens) to show only the orders that come to it.</>}
            </p>
            <Check label="Show orders being prepared" checked={o.show_preparing !== false} onChange={v => onOpts({ show_preparing: v })} />
            {o.show_preparing !== false && (
              <label className="block text-xs font-medium">Preparing title
                <input value={o.preparing_title ?? 'Preparing'} maxLength={40} onChange={e => onOpts({ preparing_title: e.target.value })}
                  className="mt-1 w-full h-11 text-sm border rounded-md px-2 bg-background" />
              </label>
            )}
            <label className="block text-xs font-medium">Ready title
              <input value={o.ready_title ?? 'Ready'} maxLength={40} onChange={e => onOpts({ ready_title: e.target.value })}
                className="mt-1 w-full h-11 text-sm border rounded-md px-2 bg-background" />
            </label>
            <Sel label="Layout" value={o.layout === 'stacked' ? 'stacked' : 'side'} onChange={v => onOpts({ layout: v })}>
              <option value="side">Side by side</option>
              <option value="stacked">One above the other</option>
            </Sel>
            {o.show_preparing !== false && (
              <Check label={o.layout === 'stacked' ? 'Ready at the top' : 'Ready on the left'} checked={!!o.ready_first} onChange={v => onOpts({ ready_first: v })} />
            )}
            <div className="grid grid-cols-2 gap-2">
              <PxBox label="Numbers per row" suffix="" value={o.columns ?? 1} min={1} max={6} onChange={v => onOpts({ columns: v })} />
              <PxBox label="Most shown" suffix="" value={o.max ?? 12} min={1} max={60} onChange={v => onOpts({ max: v })} />
            </div>
            <PxBox label="Ready numbers stay for" suffix="min" value={o.clear_mins ?? 10} min={0} max={120} onChange={v => onOpts({ clear_mins: v })} />
            <p className="text-[11px] text-muted-foreground">Or until the pass marks the order collected. 0: until collected.</p>
          </Section>
          <TileSection o={o} onOpts={onOpts} />
          <Section title="Style">
            <div className="grid grid-cols-2 gap-2">
              <PxBox label="Title size" value={o.title_size ?? 56} min={6} max={400} onChange={v => onOpts({ title_size: v })} />
              <PxBox label="Number size" value={o.number_size ?? 72} min={6} max={600} onChange={v => onOpts({ number_size: v })} />
            </div>
            <ColourField label="Titles" value={o.title_color || null} optional onChange={v => onOpts({ title_color: v })} />
            <ColourField label="Ready box" value={o.ready_bg || '#2e8b57'} onChange={v => onOpts({ ready_bg: v })} />
            <ColourField label="Ready number" value={o.ready_color || '#ffffff'} onChange={v => onOpts({ ready_color: v })} />
            <ColourField label="Preparing number" value={o.preparing_color || null} optional onChange={v => onOpts({ preparing_color: v })} />
            <ColourField label="Preparing box" value={o.preparing_bg || null} optional onChange={v => onOpts({ preparing_bg: v })} />
          </Section>
          <Section title="When a number changes">
            <Sel label="Animation" value={o.change_anim || 'none'} onChange={v => onOpts({ change_anim: v })}>
              {ORDER_CHANGE_ANIMS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </Sel>
            {o.change_anim && o.change_anim !== 'none' && (
              <PxBox label="Taking" suffix="ms" value={o.change_ms ?? 900} min={200} max={3000} onChange={v => onOpts({ change_ms: v })} />
            )}
            <p className="text-[11px] text-muted-foreground">Plays on the screens when an order moves to Ready, comes in or is collected. Press Play to see it here.</p>
          </Section>
        </>
      )}

      <Section title="Animation">
        <Sel label="Comes on" value={o.anim_in || 'none'} onChange={v => onOpts({ anim_in: v })}>
          {ANIM_IN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
        </Sel>
        {o.anim_in && o.anim_in !== 'none' && (
          <div className="grid grid-cols-2 gap-2">
            <PxBox label="Taking" suffix="ms" value={o.anim_in_ms ?? 800} min={100} max={10000} onChange={v => onOpts({ anim_in_ms: v })} />
            <PxBox label="After" suffix="ms" value={o.anim_in_delay ?? 0} min={0} max={60000} onChange={v => onOpts({ anim_in_delay: v })} />
          </div>
        )}
        <Sel label="While on" value={o.anim_loop || 'none'} onChange={v => onOpts({ anim_loop: v, anim_loop_ms: undefined })}>
          {ANIM_LOOP.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
        </Sel>
        {o.anim_loop && o.anim_loop !== 'none' && (
          <PxBox label="Each round takes" suffix="ms" value={o.anim_loop_ms ?? (ANIM_LOOP.find(a => a.key === o.anim_loop)?.ms || 3000)}
            min={300} max={120000} onChange={v => onOpts({ anim_loop_ms: v })} />
        )}
        <p className="text-[11px] text-muted-foreground">"Comes on" plays each time the board comes on (stagger blocks with After). Press Play to see it.</p>
      </Section>

      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <PxBox label="Left" value={block.x} min={-W} max={W} onChange={v => onUpdate({ x: v })} />
          <PxBox label="Top" value={block.y} min={-H} max={H} onChange={v => onUpdate({ y: v })} />
          <PxBox label="Width" value={block.w} min={4} max={W} onChange={v => onUpdate({ w: v })} />
          <PxBox label="Height" value={block.h} min={4} max={H} onChange={v => onUpdate({ h: v })} />
          <PxBox label="See-through" suffix="%" value={100 - (o.opacity ?? 100)} min={0} max={100} onChange={v => onOpts({ opacity: 100 - v })} />
          <PxBox label="Turn" suffix="°" value={o.rotate ?? 0} min={-180} max={180} onChange={v => onOpts({ rotate: v })} />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <button type="button" onClick={() => onRestack('front')} title="To the front" className="h-10 border rounded-md flex items-center justify-center hover:bg-muted touch-manipulation"><ChevronsUp className="w-4 h-4" /></button>
          <button type="button" onClick={() => onRestack('up')} title="Forward" className="h-10 border rounded-md flex items-center justify-center hover:bg-muted touch-manipulation"><ChevronUp className="w-4 h-4" /></button>
          <button type="button" onClick={() => onRestack('down')} title="Back" className="h-10 border rounded-md flex items-center justify-center hover:bg-muted touch-manipulation"><ChevronDown className="w-4 h-4" /></button>
          <button type="button" onClick={() => onRestack('back')} title="To the back" className="h-10 border rounded-md flex items-center justify-center hover:bg-muted touch-manipulation"><ChevronsDown className="w-4 h-4" /></button>
        </div>
      </Section>
      <Section>
        <button type="button" onClick={onDuplicate}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
          <Copy className="w-4 h-4" /> Duplicate
        </button>
        <button type="button" onClick={onRemove}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm rounded-md min-h-[44px] text-destructive bg-destructive/10 hover:bg-destructive/20 touch-manipulation">
          <Trash2 className="w-4 h-4" /> Remove from the board
        </button>
        <p className="text-[11px] text-muted-foreground">Removing a block never changes the menu.</p>
      </Section>
      <MediaLibraryModal open={mediaOpen} mode="picker" onClose={() => setMediaOpen(false)}
        onPick={url => { onOpts({ url }); setMediaOpen(false) }} />
      <MediaLibraryModal open={videoOpen} mode="picker" kind="video" scope="screens" onClose={() => setVideoOpen(false)}
        onPick={url => {
          onOpts({ url, duration: null })
          setVideoOpen(false)
          readVideoSeconds(url).then(d => { if (d) onOpts({ url, duration: d }) })
        }} />
    </fieldset>
  )
}

function BoardPanel({ board, name, setName, canManage, onPatch, venues, version, setVersion, venueId, setVenueId }) {
  const [mediaOpen, setMediaOpen] = useState(false)
  const preset = BOARD_SIZES.find(s => s.width === board.width && s.height === board.height)?.key || 'custom'
  return (
    <div>
      <fieldset disabled={!canManage} className="min-w-0 m-0 p-0 border-0">
        <Section title="Board">
          <label className="block">
            <span className="block text-[11px] text-muted-foreground mb-0.5">Name</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120} className="w-full h-10 text-sm border rounded-md px-2 bg-background" />
          </label>
          <Sel label="Size" value={preset} onChange={v => { const p = BOARD_SIZES.find(s => s.key === v); if (p) onPatch({ width: p.width, height: p.height }) }}>
            {BOARD_SIZES.map(s => <option key={s.key} value={s.key}>{s.label} ({s.width} x {s.height})</option>)}
            <option value="custom">Other size</option>
          </Sel>
          <div className="grid grid-cols-2 gap-2">
            <PxBox label="Width" value={board.width} min={240} max={8192} onChange={v => onPatch({ width: v })} />
            <PxBox label="Height" value={board.height} min={240} max={8192} onChange={v => onPatch({ height: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">Blocks keep their place in pixels when the size changes.</p>
        </Section>
        <Section title="Background">
          <ColourField label="Colour" value={board.background} onChange={v => onPatch({ background: v })} />
          {board.background_image && <img src={board.background_image} alt="" className="w-full max-h-32 object-cover rounded-md border" />}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMediaOpen(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm border rounded-md min-h-[44px] hover:bg-accent touch-manipulation">
              <ImageIcon className="w-4 h-4" /> {board.background_image ? 'Change image' : 'Background image'}
            </button>
            {board.background_image && (
              <button type="button" onClick={() => onPatch({ background_image: '' })} className="h-11 px-3 text-sm border rounded-md hover:bg-muted touch-manipulation">Remove</button>
            )}
          </div>
          {board.background_image && (
            <Seg value={board.background_fit} options={[['cover', 'Fill'], ['contain', 'Whole'], ['fill', 'Stretch']]} onChange={v => onPatch({ background_fit: v })} />
          )}
        </Section>
        {canManage && (
          <Section title="Theme maker">
            <ThemeMakerButton target="board" current={board} onApply={kit => onPatch(boardFromKit(kit, {}))} />
            <p className="text-[11px] text-muted-foreground">Background, colours and fonts from your logo or a photo and a few words.</p>
          </Section>
        )}
        <Section title="Colours">
          <ColourField label="Text" value={board.text_color} onChange={v => onPatch({ text_color: v })} />
          <ColourField label="Accent (section titles, prices)" value={board.accent_color} onChange={v => onPatch({ accent_color: v })} />
          <ColourField label="Muted (descriptions)" value={board.muted_color} onChange={v => onPatch({ muted_color: v })} />
        </Section>
        <Section title="Fonts">
          {[['font_body', 'Body'], ['font_heading', 'Headings and prices'], ['font_script', 'Script']].map(([k, l]) => (
            <div key={k}>
              <p className="text-[11px] text-muted-foreground mb-0.5">{l}</p>
              <FontPicker fonts={SCREEN_FONT_OPTIONS} value={board[k]} onChange={v => onPatch({ [k]: v })} />
            </div>
          ))}
        </Section>
        <Section title="Prices and sold out">
          <Check label="£ sign before prices" checked={board.price_symbol} onChange={v => onPatch({ price_symbol: v })} />
          <Check label="Whole pounds without .00 (£8)" checked={board.price_whole} onChange={v => onPatch({ price_whole: v })} />
          <label className="block">
            <span className="block text-[11px] text-muted-foreground mb-0.5">Sold out wording</span>
            <input value={board.sold_out_text} onChange={e => onPatch({ sold_out_text: e.target.value })} maxLength={40}
              className="w-full h-10 text-sm border rounded-md px-2 bg-background" />
          </label>
        </Section>
        <Section title="Animations">
          <PxBox label="Play the blocks' animations again every" suffix="s" value={board.replay_secs || 0} min={0} max={3600}
            onChange={v => onPatch({ replay_secs: v })} />
          <p className="text-[11px] text-muted-foreground">0: once, when the board comes on. On a wall (or several screens) they replay together.</p>
        </Section>
        <Section title="Wall guides">
          <div className="grid grid-cols-3 gap-2">
            <Sel label="Screens across" value={String(board.guide_cols || 1)} onChange={v => onPatch({ guide_cols: Number(v) })}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </Sel>
            <Sel label="Down" value={String(board.guide_rows || 1)} onChange={v => onPatch({ guide_rows: Number(v) })}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </Sel>
            <PxBox label="Gap" value={board.guide_gap || 0} min={0} max={400} onChange={v => onPatch({ guide_gap: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">For a board shown across several screens (Screens &gt; Walls): dashed lines show each screen's part, so nothing important sits where two screens meet. The gap is hidden behind the screens' frames.</p>
        </Section>
        <Section title="Snap">
          <PxBox label="Snap blocks to every" value={board.grid} min={1} max={200} onChange={v => onPatch({ grid: v })} />
          <p className="text-[11px] text-muted-foreground">Hold Alt while dragging to place freely. Arrow keys nudge a block (Shift: one snap step).</p>
        </Section>
      </fieldset>
      <Section title="Preview">
        <Seg value={version} options={[['live', 'Live prices'], ['draft', 'Draft prices']]} onChange={setVersion} />
        {venues.length > 0 && (
          <Sel label="Sold out" value={venueId} onChange={setVenueId}>
            <option value="">Don't show sold out</option>
            {venues.map(v => <option key={v.id} value={v.id}>As at {v.name}</option>)}
          </Sel>
        )}
        <p className="text-[11px] text-muted-foreground">Screens always show the published (live) menus. Draft prices show what a screen will show once the menus are published.</p>
      </Section>
      <MediaLibraryModal open={mediaOpen} mode="picker" onClose={() => setMediaOpen(false)}
        onPick={url => { onPatch({ background_image: url }); setMediaOpen(false) }} />
    </div>
  )
}
