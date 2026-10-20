// src/components/themes/ThemeMaker.jsx
//
// The theme maker: themes made from a picture (a logo, a photo of the
// restaurant or the food, a mood board) and a few words, for the website's
// Brand & theme, kiosk designs, menu screen boards and printed menu designs.
//
//   <ThemeMakerButton target="website" current={theme} onApply={kit => ...} />
//
// The picture is read here: shrunk on a canvas, its main colours measured
// (extractPalette() in shared/themeKit.js), which gives three themes at once
// without any AI (kitsFromPalette()). With Pepper on, the picture, the
// measured colours and the words go to POST /api/ai/themes for themes made
// to suit. Every theme previews on any of the four places; Use this hands the
// kit to the designer (onApply), which fills its form for the person to save.
// Themes used are kept on this device (maca_theme_kits) to use elsewhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Image as ImageIcon, Loader2, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FileDropArea } from '@/components/FileDropArea'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { useAiStatus } from '@/components/ai/ChatView'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import {
  extractPalette, kitsFromPalette, normaliseKit, kitFontsUrl, kitFromCurrent,
  websiteThemeFromKit, kioskBrandFromKit, boardFromKit, printFromKit, PRINT_PAPER,
} from '@shared/themeKit.js'

const MAX_SIDE = 1024
const RECENT_KEY = 'maca_theme_kits'
const RECENT_MAX = 8

export const TARGET_NAMES = { website: 'Website', kiosk: 'Kiosk', board: 'Menu screen', print: 'Printed menu' }

const EXAMPLES = [
  'Warm and family-run',
  'Bold street food',
  'Calm and elegant',
  'Bright and fresh',
  'Dark and moody',
  'Make it warmer',
]

const stack = name => "'" + name + "', system-ui, sans-serif"

/** A Google Fonts stylesheet in the page while mounted. */
export function useFontLink(url) {
  useEffect(() => {
    if (!url) return undefined
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
    return () => link.remove()
  }, [url])
}

// ── Reading a picture ───────────────────────────────────────────

/** A picture file as { preview, data, media_type, palette }: at most 1024 px, JPEG. */
async function readPicture(blob) {
  if (!/^image\//.test(blob?.type || '')) throw new Error('That isn\'t a picture: use a JPEG, PNG, WebP, GIF or SVG.')
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('That picture couldn\'t be read. Try another one.'))
      i.src = url
    })
    const w0 = img.naturalWidth || img.width || MAX_SIDE
    const h0 = img.naturalHeight || img.height || MAX_SIDE
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)
    // Measured before the white backing, so a logo's see-through background doesn't count.
    const palette = extractPalette(ctx.getImageData(0, 0, w, h).data, { count: 8 })
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    const preview = canvas.toDataURL('image/jpeg', 0.85)
    return { preview, data: preview.slice(preview.indexOf(',') + 1), media_type: 'image/jpeg', palette }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function readPictureUrl(url) {
  let res
  try { res = await fetch(url) } catch { res = null }
  if (!res?.ok) throw new Error('That picture couldn\'t be opened here. Save it to the computer and upload it.')
  return readPicture(await res.blob())
}

// ── Themes used before (this device) ────────────────────────────

const kitKey = k => JSON.stringify([k.colors, k.fonts, k.shape, k.heading_case])

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list.slice(0, RECENT_MAX).map(k => normaliseKit(k, { source: 'recent' })) : []
  } catch { return [] }
}

function rememberKit(kit) {
  try {
    const k = normaliseKit(kit, { source: 'recent' })
    const list = [k, ...loadRecent().filter(r => kitKey(r) !== kitKey(k))].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* storage full or blocked: nothing to remember */ }
}

// ── Previews: what the kit becomes in each place ────────────────

function WebsitePreview({ kit, name }) {
  const t = websiteThemeFromKit(kit, {})
  const c = t.colors
  return (
    <div className="h-full p-3 flex flex-col gap-2" style={{ background: c.background, color: c.text, fontFamily: stack(t.typography.body_font) }}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold truncate" style={{ color: c.primary, fontFamily: stack(t.typography.heading_font) }}>{name}</span>
        <span style={{ color: c.muted }}>Menu · Book · Find us</span>
      </div>
      <div className="text-lg leading-tight font-bold" style={{ fontFamily: stack(t.typography.heading_font), color: c.primary }}>Seasonal food, all day</div>
      <div className="text-[11px]" style={{ color: c.muted }}>Fresh dishes in the heart of the neighbourhood.</div>
      <div className="mt-auto flex items-end gap-2">
        <div className="flex-1 p-2 text-[11px] min-w-0" style={{ background: c.surface, border: '1px solid ' + c.border, borderRadius: t.radii.md_px }}>
          <span className="block font-semibold truncate" style={{ fontFamily: stack(t.typography.heading_font) }}>Today&apos;s special</span>
          <span className="block truncate" style={{ color: c.muted }}>Ask the team</span>
        </div>
        <span className="px-3 py-2 text-[11px] font-semibold shrink-0" style={{ background: c.primary, color: '#ffffff', borderRadius: t.buttons.radius_px }}>Book a table</span>
      </div>
    </div>
  )
}

function KioskPreview({ kit }) {
  const b = kioskBrandFromKit(kit, {})
  const c = b.colors
  const caps = b.heading_case === 'upper' ? 'uppercase' : 'none'
  const r = Math.round(b.radius / 2)
  return (
    <div className="h-full p-2.5 flex flex-col gap-2" style={{ background: c.background, color: c.text, fontFamily: stack(b.font_body) }}>
      <div className="text-base font-bold leading-none" style={{ fontFamily: stack(b.font_heading), textTransform: caps }}>Burgers</div>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        {['Classic', 'Spicy'].map((d, i) => (
          <div key={d} className="p-1.5 flex flex-col text-[11px] min-w-0" style={{ background: c.surface, borderRadius: r }}>
            <div className="flex-1 min-h-[22px] relative" style={{ background: c.accent, opacity: 0.35, borderRadius: Math.max(2, r - 4) }} />
            <span className="font-semibold mt-1 truncate" style={{ fontFamily: stack(b.font_heading), textTransform: caps }}>{d}</span>
            <span className="flex items-center justify-between gap-1">
              <span style={{ color: c.muted }}>£{i ? '9.50' : '8.50'}</span>
              {i === 1 && <span className="px-1 rounded text-[9px] font-bold" style={{ background: c.accent, color: c.accent_text }}>NEW</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="py-2 text-center text-xs font-bold" style={{ background: c.primary, color: c.primary_text, borderRadius: r, fontFamily: stack(b.font_heading), textTransform: caps }}>Add to order</div>
    </div>
  )
}

function BoardPreview({ kit }) {
  const l = boardFromKit(kit, {})
  const rows = [['Classic burger', '£8.50'], ['Chicken wings', '£6.95'], ['Loaded fries', '£4.50']]
  return (
    <div className="h-full p-3 flex flex-col gap-1.5" style={{ background: l.background, color: l.text_color, fontFamily: stack(l.font_body) }}>
      <div className="text-lg font-bold uppercase leading-none" style={{ color: l.accent_color, fontFamily: stack(l.font_heading) }}>Burgers</div>
      {rows.map(([n, p]) => (
        <div key={n} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-semibold" style={{ fontFamily: stack(l.font_heading) }}>{n}</span>
          <span className="font-bold shrink-0" style={{ color: l.accent_color }}>{p}</span>
        </div>
      ))}
      <div className="text-[11px]" style={{ color: l.muted_color }}>All served with salad</div>
      <div className="mt-auto text-base" style={{ color: l.accent_color, fontFamily: stack(l.font_script) }}>Made fresh every day</div>
    </div>
  )
}

function PrintPreview({ kit }) {
  const p = printFromKit(kit, {})
  return (
    <div className="h-full p-3 flex flex-col gap-1" style={{ background: PRINT_PAPER, color: p.ink_color, fontFamily: stack(p.font_body) }}>
      <div className="text-center text-lg font-semibold leading-none" style={{ fontFamily: stack(p.font_heading) }}>Dinner</div>
      <div className="text-center text-sm leading-none" style={{ color: p.accent_color, fontFamily: stack(p.font_script) }}>from the kitchen</div>
      {[['Pan-fried sea bass', '18'], ['Wild mushroom risotto', '15']].map(([n, pr]) => (
        <div key={n} className="mt-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold truncate" style={{ fontFamily: stack(p.font_heading) }}>{n}</span>
            <span className="font-semibold shrink-0" style={{ color: p.accent_color }}>{pr}</span>
          </div>
          <div className="text-[10px] truncate" style={{ color: p.muted_color }}>Seasonal greens, lemon butter</div>
        </div>
      ))}
    </div>
  )
}

export function KitPreview({ kit, target, name = 'Your restaurant', className }) {
  return (
    <div className={cn('h-40 overflow-hidden rounded-md border', className)} data-preview={target}>
      {target === 'kiosk' ? <KioskPreview kit={kit} />
        : target === 'board' ? <BoardPreview kit={kit} />
        : target === 'print' ? <PrintPreview kit={kit} />
        : <WebsitePreview kit={kit} name={name} />}
    </div>
  )
}

export function KitSwatches({ kit, className }) {
  const c = kit.colors
  return (
    <span className={cn('inline-flex rounded overflow-hidden border', className)} aria-hidden="true">
      {[c.background, c.surface, c.text, c.primary, c.accent].map((x, i) => (
        <span key={i} className="w-4 h-4" style={{ background: x }} />
      ))}
    </span>
  )
}

function KitCard({ kit, view, name, onUse, onMore, canMore, busy }) {
  return (
    <div className="border rounded-lg p-2 flex flex-col gap-2 bg-background" data-testid="tm-kit" data-kit-name={kit.name}>
      <KitPreview kit={kit} target={view} name={name} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate flex-1">{kit.name}</p>
          <KitSwatches kit={kit} />
        </div>
        {kit.about && <p className="text-xs text-muted-foreground mt-0.5">{kit.about}</p>}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {kit.fonts.display ? kit.fonts.display + ' / ' : ''}{kit.fonts.heading} / {kit.fonts.body}
        </p>
      </div>
      <div className="flex gap-2 mt-auto">
        <button type="button" onClick={() => onUse(kit)} data-testid="tm-use"
          className="flex-1 min-h-[44px] px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium touch-manipulation">Use this</button>
        {canMore && (
          <button type="button" onClick={() => onMore(kit)} disabled={busy} data-testid="tm-more"
            className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation disabled:opacity-50">More like this</button>
        )}
      </div>
    </div>
  )
}

function KitGroup({ title, note, children, testId }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

// ── The window ──────────────────────────────────────────────────

export function ThemeMaker({ target, current, onApply, onClose }) {
  const api = useApi()
  const { data: ai } = useAiStatus()
  const canAi = !!ai?.can_chat
  const { data: site } = useQuery({ queryKey: ['tenant-site'], queryFn: () => api.get('/website/tenant-site'), staleTime: 60_000 })
  const brandName = site?.brand_name || site?.site_name || 'Your restaurant'

  const [picture, setPicture] = useState(null)       // { preview, data, media_type, palette }
  const [reading, setReading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [view, setView] = useState(target)
  const [aiKits, setAiKits] = useState([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [recent] = useState(loadRecent)
  const fileRef = useRef(null)
  const resultsRef = useRef(null)
  const asked = useRef(0)

  const pictureKits = useMemo(() => kitsFromPalette(picture?.palette || []), [picture])
  const fontsUrl = useMemo(() => kitFontsUrl([...aiKits, ...pictureKits, ...recent]), [aiKits, pictureKits, recent])
  useFontLink(fontsUrl)

  useEffect(() => {
    // The Media window answers its own Escape.
    const onKey = e => { if (e.key === 'Escape' && !mediaOpen) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mediaOpen])

  async function takePicture(load) {
    setReading(true)
    setError(null)
    try {
      setPicture(await load())
    } catch (e) {
      setError(e.message || 'That picture couldn\'t be read.')
    } finally {
      setReading(false)
    }
  }

  async function make({ like = null } = {}) {
    if (!canAi) return
    if (!picture && !prompt.trim() && !like) { setError('Add a picture or say what look you want.'); return }
    const n = ++asked.current
    setBusy(true)
    setError(null)
    try {
      const res = await api.post('/ai/themes', {
        target,
        prompt: prompt.trim(),
        // A variation needs the theme it starts from, not the picture again.
        image: picture && !like ? { media_type: picture.media_type, data: picture.data } : null,
        palette: (picture?.palette || []).map(p => ({ hex: p.hex, share: p.share })),
        current: current ? kitFromCurrent(target, current) : null,
        like,
        count: 3,
      })
      if (n !== asked.current) return
      setAiKits((res?.kits || []).map(k => normaliseKit(k, { source: 'ai' })))
      setNotes(res?.notes || '')
      // On a phone the themes are below the form.
      if (window.innerWidth < 1024) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    } catch (e) {
      if (n === asked.current) setError(e?.body?.error || e.message || 'Themes couldn\'t be made. Try again.')
    } finally {
      if (n === asked.current) setBusy(false)
    }
  }

  function use(kit) {
    rememberKit(kit)
    onApply(normaliseKit(kit, { source: kit.source }))
    onClose()
  }

  const canMake = canAi && (!!picture || !!prompt.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label="Theme maker" data-testid="theme-maker">
      <div className="w-full sm:max-w-6xl bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[90vh]">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Wand2 className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Theme maker</h2>
            <p className="text-xs text-muted-foreground truncate">For the {TARGET_NAMES[target].toLowerCase()}. Nothing changes until you save.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="h-11 w-11 -mr-2 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[85vh]">
          <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-0">
            {/* Start from */}
            <div className="p-4 space-y-4 lg:border-r">
              <div>
                <p className="text-sm font-semibold">A picture</p>
                <p className="text-xs text-muted-foreground mb-2">Your logo, a photo of the restaurant or the food, or anything with the look you want.</p>
                <FileDropArea onFiles={files => takePicture(() => readPicture(files[0]))} onRefused={setError} disabled={reading || busy}>
                  <div className="rounded-lg border border-dashed bg-muted/20 p-2">
                    {picture ? (
                      <div className="space-y-2">
                        <div className="relative">
                          <img src={picture.preview} alt="Your picture" draggable={false} className="w-full h-36 object-contain rounded bg-background" />
                          <button type="button" onClick={() => { setPicture(null); setError(null) }} aria-label="Remove the picture"
                            className="absolute top-1 right-1 w-9 h-9 rounded-full bg-background/90 border flex items-center justify-center touch-manipulation">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div data-testid="tm-palette">
                          <p className="text-[11px] text-muted-foreground mb-1">Its main colours</p>
                          <div className="flex h-6 rounded overflow-hidden border">
                            {picture.palette.map(p => (
                              <span key={p.hex} title={p.hex} data-hex={p.hex} style={{ background: p.hex, flexGrow: Math.max(p.share, 0.04) }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-28 flex flex-col items-center justify-center text-center text-xs text-muted-foreground gap-1">
                        {reading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                        <span>{reading ? 'Reading the picture…' : 'Drop a picture here'}</span>
                      </div>
                    )}
                  </div>
                </FileDropArea>
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" data-testid="tm-file"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) takePicture(() => readPicture(f)) }} />
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={reading}
                    className="min-h-[44px] px-3 rounded-md border text-sm inline-flex items-center gap-1.5 touch-manipulation disabled:opacity-50">
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  <button type="button" onClick={() => setMediaOpen(true)} disabled={reading} data-testid="tm-media"
                    className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation disabled:opacity-50">From Media</button>
                  {site?.logo_url && (
                    <button type="button" onClick={() => takePicture(() => readPictureUrl(site.logo_url))} disabled={reading} data-testid="tm-logo"
                      className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation disabled:opacity-50">Use my logo</button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="tm-prompt" className="text-sm font-semibold block">The look you want</label>
                <p className="text-xs text-muted-foreground mb-2">In your own words. Optional with a picture.</p>
                <textarea id="tm-prompt" value={prompt} onChange={e => setPrompt(e.target.value.slice(0, 1000))} rows={3}
                  data-testid="tm-prompt" disabled={!canAi}
                  placeholder={canAi ? 'e.g. Relaxed Italian, terracotta and olive, handwritten touches' : ASSISTANT_NAME + ' isn\'t available'}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60" />
                {canAi && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {EXAMPLES.map(x => (
                      <button key={x} type="button" onClick={() => setPrompt(p => (p.trim() ? p.trim() + ', ' : '') + x.toLowerCase())}
                        className="min-h-[36px] px-2.5 rounded-full border text-xs touch-manipulation hover:bg-muted">{x}</button>
                    ))}
                  </div>
                )}
              </div>

              {canAi ? (
                <button type="button" onClick={() => make()} disabled={!canMake || busy} data-testid="tm-make"
                  className="w-full min-h-[48px] rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2 touch-manipulation disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {busy ? ASSISTANT_NAME + ' is making themes…' : aiKits.length ? 'Make new themes' : 'Make themes'}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2" data-testid="tm-no-ai">
                  {ASSISTANT_NAME} isn&apos;t available{ai?.configured === false ? ' on this server' : ai && !ai.enabled ? ' (switched off for your group)' : ''}, so themes come from the picture&apos;s colours only.
                </p>
              )}
              {error && <p className="text-sm text-destructive" role="alert" data-testid="tm-error">{error}</p>}
            </div>

            {/* Themes */}
            <div className="p-4 space-y-5 min-w-0" ref={resultsRef}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Show on</span>
                <div className="inline-flex rounded-md border overflow-hidden" role="group" aria-label="Show on">
                  {Object.entries(TARGET_NAMES).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k} data-testid={'tm-view-' + k}
                      className={cn('min-h-[40px] px-3 text-xs touch-manipulation', view === k ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {(busy || aiKits.length > 0) && (
                <KitGroup title={'From ' + ASSISTANT_NAME} note={notes} testId="tm-ai-kits">
                  {busy
                    ? [0, 1, 2].map(i => <div key={i} className="h-64 rounded-lg border bg-muted/30 animate-pulse" />)
                    : aiKits.map((k, i) => (
                      <KitCard key={'ai' + i} kit={k} view={view} name={brandName} onUse={use} canMore={canAi} busy={busy}
                        onMore={kit => make({ like: kit })} />
                    ))}
                </KitGroup>
              )}
              {aiKits.length > 0 && !busy && (
                <button type="button" onClick={() => make()} disabled={!canMake}
                  className="min-h-[44px] px-3 rounded-md border text-sm inline-flex items-center gap-1.5 touch-manipulation disabled:opacity-50">
                  <RefreshCw className="w-3.5 h-3.5" /> Try again
                </button>
              )}

              {pictureKits.length > 0 && (
                <KitGroup title="From the picture's colours" note="Made straight from the colours measured in your picture." testId="tm-picture-kits">
                  {pictureKits.map((k, i) => (
                    <KitCard key={'p' + i} kit={k} view={view} name={brandName} onUse={use} canMore={canAi} busy={busy}
                      onMore={kit => make({ like: kit })} />
                  ))}
                </KitGroup>
              )}

              {recent.length > 0 && (
                <KitGroup title="Themes you used" note="On this device, so one theme can go on the website, kiosks, screens and print." testId="tm-recent-kits">
                  {recent.map((k, i) => (
                    <KitCard key={'r' + i} kit={k} view={view} name={brandName} onUse={use} canMore={canAi} busy={busy}
                      onMore={kit => make({ like: kit })} />
                  ))}
                </KitGroup>
              )}

              {!busy && !aiKits.length && !pictureKits.length && !recent.length && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {canAi
                    ? 'Add a picture or describe the look, then Make themes. Themes from the picture\'s colours show at once.'
                    : 'Add a picture: themes from its colours show here.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {mediaOpen && (
        <MediaLibraryModal open mode="picker" kind="image" onClose={() => setMediaOpen(false)}
          onPick={url => { setMediaOpen(false); takePicture(() => readPictureUrl(url)) }} />
      )}
    </div>
  )
}

/**
 * The button a designer shows (people who can change the design only). After
 * a theme is used it says so until the next one, as the form still needs Save.
 */
export function ThemeMakerButton({ target, current, onApply, className, label = 'Make a theme' }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(null)
  return (
    <>
      <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
        <button type="button" onClick={() => setOpen(true)} data-testid="theme-maker-open"
          className="min-h-[44px] px-3 rounded-md border bg-background text-sm font-medium inline-flex items-center gap-1.5 touch-manipulation hover:bg-muted">
          <Wand2 className="w-4 h-4 text-primary" /> {label}
        </button>
        {used && (
          <span className="text-xs text-muted-foreground" data-testid="theme-maker-used">
            Filled in from &ldquo;{used}&rdquo;. Check it, then save.
          </span>
        )}
      </span>
      {/* In <body>: designers sit in fieldsets and scrolled panels. */}
      {open && createPortal(
        <ThemeMaker target={target} current={current} onClose={() => setOpen(false)}
          onApply={kit => { setUsed(kit.name); onApply(kit) }} />,
        document.body,
      )}
    </>
  )
}
