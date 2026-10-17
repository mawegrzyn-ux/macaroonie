// src/components/screens/shared.jsx
//
// Pieces the Screens page and the board designer share (migration 166):
// the board renderer's styles and fonts, a scaled board preview, the menu
// data boards read, and small form helpers. The renderer itself is
// shared/screenLayout.js, the same file the screens' player runs.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ColourPicker } from '@/components/ColourPicker'
import { SCREEN_LAYOUT_CSS, boardContext, renderBoardHtml, screenFontsUrl, boardFonts } from '@shared/screenLayout.js'

export const errorText = e => e?.body?.error || e?.message || 'Something went wrong'

// The renderer's CSS, once, while any board is on the page.
let cssUsers = 0
let cssEl = null
export function useScreenCss() {
  useEffect(() => {
    cssUsers++
    if (!cssEl) {
      cssEl = document.createElement('style')
      cssEl.dataset.screenLayout = '1'
      cssEl.textContent = SCREEN_LAYOUT_CSS
      document.head.appendChild(cssEl)
    }
    return () => {
      cssUsers--
      if (!cssUsers && cssEl) { cssEl.remove(); cssEl = null }
    }
  }, [])
}

// Google Fonts for these boards (one stylesheet, kept while the page is open).
// `onLoaded` runs once the browser has the fonts, for re-measuring.
export function useBoardFonts(layouts, onLoaded) {
  const url = useMemo(() => screenFontsUrl([...new Set((layouts || []).flatMap(l => boardFonts(l)))]), [layouts])
  const cb = useRef(onLoaded)
  cb.current = onLoaded
  useEffect(() => {
    if (!url) return
    let link = document.querySelector(`link[data-screen-fonts="${CSS.escape(url)}"]`)
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = url; link.dataset.screenFonts = url
      document.head.appendChild(link)
    }
    const done = () => document.fonts?.ready?.then(() => cb.current?.())
    link.addEventListener('load', done)
    done()
    return () => link.removeEventListener('load', done)
  }, [url])
}

/** Menus, tags, allergen notice and (for a venue) sold out dishes, as boards read them. */
export function useScreenData({ version = 'live', venueId = '' } = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['screen-menu-data', version, venueId || null],
    queryFn: () => api.get(`/screens/menu-data?version=${version}${venueId ? `&venue_id=${venueId}` : ''}`),
    staleTime: 30_000,
  })
}

/** A board drawn small (the same HTML the screen shows), `width` px wide. */
export function BoardPreview({ design, data, width = 240, className }) {
  useScreenCss()
  useBoardFonts(useMemo(() => [design?.layout || {}], [design]))
  const W = design?.width || 1920
  const H = design?.height || 1080
  const s = width / W
  const html = useMemo(() => {
    if (!design) return ''
    try {
      // still: thumbnails show a frame of each video and nothing moves.
      const ctx = boardContext(design.layout || {}, { ...(data || {}), width: W, height: H, still: true })
      return renderBoardHtml(ctx)
    } catch { return '' }
  }, [design, data, W, H])
  return (
    <div className={cn('relative overflow-hidden rounded-md border bg-black shrink-0', className)} style={{ width, height: Math.round(H * s) }} aria-hidden>
      <div style={{ transform: `scale(${s})`, transformOrigin: '0 0', width: W, height: H, pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export function relTime(iso) {
  if (!iso) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Re-render every `ms` (online state, clocks). */
export function useTick(ms = 30_000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t) }, [ms])
}

export const ROTATIONS = [
  { value: 0, label: 'Upright' },
  { value: 90, label: 'Turned right' },
  { value: 180, label: 'Upside down' },
  { value: 270, label: 'Turned left' },
]

export const FITS = [
  { value: 'contain', label: 'Fit (bars if the shape differs)' },
  { value: 'cover', label: 'Fill (crop the edges)' },
  { value: 'stretch', label: 'Stretch' },
]

/** Colour picker with a hex box; `optional` adds "Board colour" (null). */
/** A board colour: the website theme's colours, then a custom one. */
export function ColourField({ label, value, onChange, optional = false, placeholder = 'Board colour' }) {
  return <ColourPicker label={label} value={value} onChange={onChange} optional={optional} placeholder={placeholder} />
}

/** Whole-number box that keeps what was typed while focused. */
export function PxBox({ label, value, onChange, min = 0, max = 10000, suffix = 'px', className }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value == null ? '' : String(value)) }, [value, focused])
  return (
    <label className={cn('block', className)}>
      {label && <span className="block text-[11px] text-muted-foreground mb-0.5">{label}</span>}
      <span className="flex items-center gap-1">
        <input inputMode="numeric" value={text}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={e => {
            const t = e.target.value.replace(/[^0-9-]/g, '')
            setText(t)
            const n = Number(t)
            if (t !== '' && t !== '-' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))))
          }}
          className="w-full min-w-0 h-10 rounded-md border bg-background px-2 text-sm tabular-nums touch-manipulation" />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  )
}
