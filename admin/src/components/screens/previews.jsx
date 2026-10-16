// src/components/screens/previews.jsx
//
// Previews on the Screens page (migration 167):
//   PlaylistPreview  the playlist's boards taking turns in a small box, each
//                    coming on with its transition (the player's own
//                    keyframes, transitionFrames()) and moving as on a
//                    screen (startBoardMotion()); each board for up to five
//                    seconds, so a long playlist can be seen quickly
//   WallPreview      a wall's board with the part each screen shows marked
// Both draw with shared/screenLayout.js, the renderer the screens run.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Pause, SkipForward, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  boardContext, renderBoardHtml, transitionFrames, startBoardMotion, wallRegion, TRANSITIONS, DEFAULT_TRANSITION_MS,
} from '@shared/screenLayout.js'
import { useScreenCss, useBoardFonts, useScreenData, BoardPreview } from './shared'

const PREVIEW_SECS = 5

/** Whole boards (with their layouts) by id. */
export function useFullDesigns(ids) {
  const api = useApi()
  const list = [...new Set((ids || []).filter(Boolean))].sort()
  return useQuery({
    queryKey: ['screen-designs-by-id', list.join(',')],
    queryFn: () => Promise.all(list.map(id => api.get(`/screens/designs/${id}`).catch(() => null))),
    enabled: list.length > 0,
    staleTime: 15_000,
  })
}

export function PlaylistPreview({ items, width = 360 }) {
  useScreenCss()
  const { data: designs, isLoading } = useFullDesigns(items.map(i => i.design_id))
  const { data } = useScreenData()
  const byId = useMemo(() => Object.fromEntries((designs || []).filter(Boolean).map(d => [d.id, d])), [designs])
  useBoardFonts(useMemo(() => (designs || []).filter(Boolean).map(d => d.layout || {}), [designs]))
  const boxRef = useRef(null)
  const lastStep = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(0)
  const index = items.length ? step % items.length : 0
  const item = items[index]
  const first = byId[items[0]?.design_id]
  const boxW = width
  const boxH = Math.round(boxW * (first?.height || 1080) / (first?.width || 1920))

  // Draw the board for this step (with its transition when the step moved on).
  useEffect(() => {
    const box = boxRef.current
    const d = item && byId[item.design_id]
    if (!box || !d) return
    const animate = lastStep.current !== null && lastStep.current !== step
    lastStep.current = step
    const W = d.width, H = d.height
    const s = Math.min(boxW / W, boxH / H)
    const layer = document.createElement('div')
    layer.style.cssText = `position:absolute;left:${(boxW - W * s) / 2}px;top:${(boxH - H * s) / 2}px;width:${W}px;height:${H}px;` +
      `transform:scale(${s});transform-origin:0 0;pointer-events:none`
    try {
      layer.innerHTML = renderBoardHtml(boardContext(d.layout || {}, { ...(data || {}), width: W, height: H }))
    } catch { return }
    const olds = [...box.children]
    box.appendChild(layer)
    const board = layer.querySelector('.sl-board')
    const t = Date.now()
    startBoardMotion(board, { startMs: t, nowMs: t })
    const frames = animate ? transitionFrames(item.transition || 'fade', W, H) : null
    const ms = Number(item.transition_ms ?? DEFAULT_TRANSITION_MS)
    if (frames && ms > 0 && board?.animate) {
      const opts = { duration: ms, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' }
      const a = board.animate(frames.in, opts)
      if (frames.out) for (const o of olds) o.querySelector('.sl-board')?.animate(frames.out, opts)
      const done = () => olds.forEach(o => o.remove())
      a.finished.then(done, done)
    } else {
      olds.forEach(o => o.remove())
    }
  }, [step, item, byId, data, boxW, boxH])

  useEffect(() => {
    if (!playing || items.length < 2) return
    const secs = Math.min(PREVIEW_SECS, Math.max(1, Number(item?.duration_secs) || PREVIEW_SECS))
    const t = setTimeout(() => setStep(x => x + 1), secs * 1000)
    return () => clearTimeout(t)
  }, [playing, step, items.length, item?.duration_secs])

  const transitionLabel = TRANSITIONS.find(t => t.key === (item?.transition || 'fade'))?.label
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid="playlist-preview">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium flex-1 min-w-[140px]">Preview</p>
        <button type="button" onClick={() => setPlaying(p => !p)} disabled={items.length < 2}
          className={cn('inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border text-sm touch-manipulation disabled:opacity-50',
            playing ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />} {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => setStep(x => x + 1)} disabled={items.length < 2} title="Next board"
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border text-sm hover:bg-muted touch-manipulation disabled:opacity-50">
          <SkipForward className="w-4 h-4" /> Next
        </button>
      </div>
      <div className="flex justify-center">
        <div ref={boxRef} className="relative overflow-hidden rounded-md bg-black" style={{ width: boxW, height: boxH }} aria-hidden>
          {isLoading && <div className="absolute inset-0 flex items-center justify-center text-white/60"><Loader2 className="w-4 h-4 animate-spin" /></div>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="playlist-preview-label">
        Board {index + 1} of {items.length}{byId[item?.design_id] ? `: ${byId[item.design_id].name}` : ''}
        {step > 0 && transitionLabel ? ` · came on with ${transitionLabel.toLowerCase()}` : ''}.
        {' '}The preview shows each board for up to {PREVIEW_SECS} seconds; screens use the times you set.
      </p>
    </div>
  )
}

/** A wall's board with each screen's part marked. labels: { 'col:row': 'S1 Counter left' }. */
export function WallPreview({ design, cols, rows, gap, labels = {}, width = 520 }) {
  const { data } = useScreenData()
  if (!design) return null
  const W = design.width, H = design.height
  const s = width / W
  return (
    <div className="relative shrink-0" style={{ width, height: Math.round(H * s) }} data-testid="wall-preview">
      <BoardPreview design={design} data={data} width={width} />
      {Array.from({ length: rows }).flatMap((_, row) => Array.from({ length: cols }).map((__, col) => {
        const r = wallRegion(W, H, { cols, rows, col, row, gap })
        const label = labels[col + ':' + row]
        return (
          <div key={col + ':' + row} className="absolute flex items-start justify-start p-1"
            style={{ left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s, outline: '2px dashed rgba(255,196,0,0.9)', outlineOffset: -1 }}>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', label ? 'bg-black/75 text-amber-300' : 'bg-black/50 text-white/70')}>
              {label || 'No screen'}
            </span>
          </div>
        )
      }))}
    </div>
  )
}
