// src/components/pos/TechHoneycomb.jsx
//
// The Tech board as a honeycomb (28 Nov 2026), loaded only when it is shown
// (TechBoardSection.jsx, React.lazy): the hexagons drawn by shared/techHex.js
// from the tile model of shared/techBoard.js, the same drawing the menu
// screen Store status block uses. Each hexagon is a button (data-tile = the
// tile's key): tapping one opens TileSheet with its details and the link to
// where it is set up. FullBoard is the full screen view for a back office
// TV or tablet: the Fullscreen API on its own element, else a view over the
// whole window (iPhone and iPad Safari have no Fullscreen API for elements),
// dark, the venue's name and time, the platform's light, Escape or Close to leave.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { honeycomb, fitSize, honeycombHtml, legendHtml, iconSvg, markSvg, TECH_HEX_CSS } from '@shared/techHex.js'
import { TECH_KIND, TONE_LABELS, agoText } from '@shared/techBoard.js'

// The admin's colours for the labels around the hexagons (the fills are the
// states' own, shared/techHex.js HEX_COLOURS).
const ADMIN_CSS = `
.tech-hex { --hx-text: hsl(var(--foreground)); --hx-sub: hsl(var(--muted-foreground)); --hx-focus: hsl(var(--primary)); }
.tech-hex.is-dark { --hx-text: #e5e7eb; --hx-sub: #a3aebf; --hx-focus: #93c5fd; color: #e5e7eb; }
.tech-hex .hx-legend { font-size: 13px; }
.tech-full .hx-legend { font-size: clamp(13px, 1.1vw, 20px); }
`
export function HexStyles() {
  return <style>{TECH_HEX_CSS + ADMIN_CSS}</style>
}

/** The size of an element, kept up to date. */
function useBox(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const read = () => setBox(b => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

/**
 * The hexagons. fit: fill the element (full screen; it needs a height);
 * else wrap at its width at a comfortable size (the page scrolls).
 */
export function Honeycomb({ model, now, selected, onOpen, fit = false, dark = false }) {
  const ref = useRef(null)
  const box = useBox(ref)
  const html = useMemo(() => {
    if (!box.w || !model) return ''
    const base = box.w < 560 ? 54 : 66
    const layout = fit ? honeycomb(model, { aspect: box.w / Math.max(1, box.h) }) : honeycomb(model, { maxWidth: box.w / base })
    const size = fit ? fitSize(layout, box.w, box.h, 230) : Math.min(base, box.w / Math.max(1, layout.width))
    return honeycombHtml(model, layout, { size, now, interactive: true, selected, dark })
  }, [model, box.w, box.h, fit, now, selected, dark])
  const onClick = e => {
    const el = e.target.closest('[data-tile]')
    if (el && ref.current?.contains(el)) onOpen(el.dataset.tile, el)
  }
  return (
    <div ref={ref} onClick={onClick} data-testid="tech-hex"
      className={cn('w-full flex justify-center', fit && 'h-full items-center overflow-hidden')}
      dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** What each ring and fill means: only the kinds the venue has. */
export function Legend({ model }) {
  return <div data-testid="tech-legend" dangerouslySetInnerHTML={{ __html: legendHtml(model) }} />
}

function Chip({ tone, children, className }) {
  const fill = { ok: 'bg-[#15803d] text-white', warn: 'bg-[#fbbf24] text-[#1c1917]', bad: 'bg-[#b91c1c] text-white', muted: 'bg-[#cbd5e1] text-[#1e293b]' }[tone]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold', fill, className)} data-tone={tone}>
      <span className="inline-flex w-4 h-4 [&>svg]:w-4 [&>svg]:h-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-width:3]" dangerouslySetInnerHTML={{ __html: markSvg(tone, 'hx-chip') }} />
      {children}
    </span>
  )
}

/**
 * A tile's details (or the venue's health, key 'health'), over the page or
 * inside the full screen view (inside). Escape or Close closes it and gives
 * the focus back to the hexagon that opened it.
 */
export function TileSheet({ openKey, model, now, onClose, onOpen, inside = false, dark = false }) {
  const closeRef = useRef(null)
  const tile = openKey === 'health' ? null : model?.tiles.find(t => t.key === openKey)
  const show = openKey === 'health' || !!tile
  useEffect(() => {
    if (!show) return undefined
    closeRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [show, openKey, onClose])
  if (!show) return null
  const kind = tile ? TECH_KIND[tile.kind] : null
  const h = model.health
  return (
    <div className={cn(inside ? 'absolute' : 'fixed', 'inset-0 z-[70] flex justify-end')} data-testid="tech-sheet">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40 cursor-default" />
      <section role="dialog" aria-modal="true" aria-labelledby="tech-sheet-title"
        className={cn('relative w-full sm:max-w-sm h-full overflow-y-auto shadow-2xl', dark ? 'bg-[#111827] text-[#e5e7eb]' : 'bg-background text-foreground')}>
        <div className={cn('flex items-center gap-3 pl-4 pr-2 py-2', dark ? 'border-b border-white/10 bg-white/5' : 'section-head')}>
          <span className="inline-flex w-6 h-6 shrink-0 [&>svg]:w-6 [&>svg]:h-6 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-width:2]"
            dangerouslySetInnerHTML={{ __html: iconSvg(tile ? tile.icon : 'health', 'hx-sicon') }} />
          <div className="min-w-0 flex-1">
            <h3 id="tech-sheet-title" className="font-semibold text-base break-words">{tile ? tile.name : 'The venue overall'}</h3>
            <p className={cn('text-xs', dark ? 'text-[#a3aebf]' : 'text-muted-foreground')}>{kind ? kind.one : h.words}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close the details"
            className={cn('shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-lg touch-manipulation', dark ? 'hover:bg-white/10' : 'hover:bg-muted')}>
            <X className="w-5 h-5" />
          </button>
        </div>
        {tile ? (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <Chip tone={tile.tone}>{tile.word}</Chip>
              <p className="text-sm break-words" data-testid="tech-sheet-status">{tile.status}</p>
              {tile.detail && <p className={cn('text-sm break-words', dark ? 'text-[#a3aebf]' : 'text-muted-foreground')}>{tile.detail}</p>}
            </div>
            {tile.facts.length > 0 && (
              <dl className={cn('rounded-lg border divide-y text-sm', dark ? 'border-white/15 divide-white/10 bg-transparent' : '')}>
                {tile.facts.map(f => (
                  <div key={f.label} className="flex gap-3 px-3 py-2">
                    <dt className={cn('w-32 shrink-0', dark ? 'text-[#a3aebf]' : 'text-muted-foreground')}>{f.label}</dt>
                    <dd className="min-w-0 flex-1 break-words font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Link to={tile.link} onClick={onClose} data-testid="tech-sheet-link"
              className="flex items-center justify-between gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
              Open {kind.label} <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <Chip tone={h.tone}>{h.title}</Chip>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {['ok', 'bad', 'warn', 'muted'].map(t => (
                <li key={t} className={cn('rounded-lg border px-3 py-2', dark && 'border-white/15 bg-transparent')}>
                  <span className="block text-xl font-bold tabular-nums">{h.counts[t]}</span>{TONE_LABELS[t]}
                </li>
              ))}
            </ul>
            {h.platform && <p className="text-sm"><Chip tone={h.platform.tone} className="mr-2">Macaroonie {h.platform.word.toLowerCase()}</Chip></p>}
            {h.platform && <p className={cn('text-sm', dark ? 'text-[#a3aebf]' : 'text-muted-foreground')}>{h.platform.text}</p>}
            {model.attention.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-1">Needs attention</p>
                <ul className="space-y-1">
                  {model.attention.map(t => (
                    <li key={t.key}>
                      <button type="button" onClick={() => onOpen(t.key)}
                        className={cn('w-full text-left min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation', dark ? 'border-white/15 bg-transparent hover:bg-white/10' : 'hover:bg-muted')}>
                        <span className="font-medium">{t.name}</span>: {t.status}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Today's time at the venue, HH:MM. */
function clock(now, tz) {
  try { return new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }) } catch { return new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
}

/**
 * The board full screen. It asks the browser for full screen on its own
 * element; where that isn't offered it already covers the window. Leaving
 * full screen (Escape, the browser's own way out) or Close calls onClose.
 */
export function FullBoard({ model, now, venueName, timezone, checkedAt, fetching, onRefresh, onClose, openKey, setOpenKey, closeSheet, attention }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [time, setTime] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const el = ref.current
    let entered = false
    const onChange = () => {
      if (document.fullscreenElement === el) entered = true
      else if (entered) { entered = false; closeRef.current() }
    }
    document.addEventListener('fullscreenchange', onChange)
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => { /* not allowed here: the window-sized view stays */ })
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {})
    }
  }, [])
  const p = model?.health.platform
  return (
    <div ref={ref} className="tech-full tech-hex is-dark fixed inset-0 z-[60] flex flex-col overflow-hidden" style={{ background: '#0b1220', color: '#e5e7eb' }}
      data-testid="tech-full" role="region" aria-label="Tech board, full screen">
      <HexStyles />
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-[2vw] py-[1.2vh] border-b border-white/10">
        <div className="min-w-0">
          <h2 className="font-bold leading-tight" style={{ fontSize: 'clamp(20px, 2.2vw, 44px)' }}>{venueName || 'Tech board'}</h2>
          <p className="text-[#a3aebf]" style={{ fontSize: 'clamp(12px, 0.95vw, 18px)' }}>Checked {agoText(checkedAt, now)}; it checks again every 30 seconds.</p>
        </div>
        <span className="font-bold tabular-nums" style={{ fontSize: 'clamp(22px, 2.6vw, 52px)' }} data-testid="tech-full-clock">{clock(time, timezone)}</span>
        {p && (
          <span className="inline-flex items-center gap-2 font-semibold" style={{ fontSize: 'clamp(13px, 1.1vw, 22px)' }} data-testid="tech-full-platform">
            <Chip tone={p.tone}>Macaroonie {p.word.toLowerCase()}</Chip>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onRefresh} disabled={fetching} aria-label="Check now"
            className="inline-flex items-center justify-center w-12 h-12 rounded-lg border border-white/20 hover:bg-white/10 touch-manipulation disabled:opacity-50">
            <RefreshCw className={cn('w-5 h-5', fetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={onClose} data-testid="tech-full-close"
            className="inline-flex items-center gap-2 h-12 px-4 rounded-lg border border-white/20 hover:bg-white/10 text-sm font-medium touch-manipulation">
            <X className="w-5 h-5" /> Close
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 px-[2vw] py-[2vh]">
        <Honeycomb model={model} now={now} fit dark selected={openKey} onOpen={setOpenKey} />
      </main>
      <footer className="px-[2vw] pb-[1.6vh] space-y-2">
        {attention}
        <Legend model={model} />
      </footer>
      <TileSheet openKey={openKey} model={model} now={now} inside dark onClose={closeSheet} onOpen={setOpenKey} />
    </div>
  )
}

/** The honeycomb on the page: hexagons, the key, and the sheet. */
export default function HexBoard({ model, now, openKey, setOpenKey, closeSheet, dark }) {
  return (
    <div className={cn('tech-hex rounded-lg border overflow-hidden', dark ? 'is-dark' : 'bg-background')}
      style={dark ? { background: '#0f172a', borderColor: '#1e293b' } : undefined} data-testid="tech-hex-board" data-theme={dark ? 'dark' : 'light'}>
      <HexStyles />
      <div className="px-3 sm:px-4 pt-3 pb-4">
        <Honeycomb model={model} now={now} dark={dark} selected={openKey} onOpen={setOpenKey} />
      </div>
      <div className={cn('px-4 py-3 border-t', dark ? 'border-white/10' : '')}>
        <Legend model={model} />
      </div>
      <TileSheet openKey={openKey} model={model} now={now} dark={dark} onClose={closeSheet} onOpen={setOpenKey} />
    </div>
  )
}
