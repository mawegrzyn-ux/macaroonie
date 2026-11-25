// src/demo/kiosk/PhoneDemo.jsx
//
// The kiosk designer demo on a phone (under 640 px): the designer and its
// media picker are made for a tablet or a computer (1015 px and up), so a
// phone gets the kiosk itself, as big as the screen allows, with a few of the
// designer's settings above it (a colour set, the headings font, the start
// screen's picture) and a note to try the whole designer on a bigger screen.
// The kiosk is the same demo kiosk app the designer previews in, sent the
// design the same way ('kiosk.design' once it says 'kiosk.ready', from its
// own window only); Save keeps the design as the designer's Save does.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Save, Upload } from 'lucide-react'
import { normaliseDesign, KIOSK_FONTS, SYSTEM_FONT } from '@shared/kiosk.js'
import { PRESETS } from '@/pages/KioskDesigner'
import { Btn } from '@/components/pos/shared'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import { getDemo, setDemo } from './demoStore.js'
import { BUILT_IN } from './pictures.js'
import { useDemo } from './DemoShell.jsx'

const KIOSK_APP = import.meta.env.VITE_DEMO_KIOSK_APP || '/site/demo/kiosk-app/demo-kiosk.html'
const STARTS = BUILT_IN.filter(m => m.id.startsWith('built-in-hero-'))

function openDesign() {
  const s = getDemo()
  return s.designs.find(d => d.id === s.open) || s.designs[0]
}

export default function PhoneDemo() {
  useDemo()
  const api = useApi()
  const row = openDesign()
  const [settings, setSettings] = useState(() => row.settings)
  const design = useMemo(() => normaliseDesign(settings), [settings])
  const dirty = JSON.stringify(design) !== JSON.stringify(normaliseDesign(openDesign().settings))
  const brand = patch => setSettings(x => ({ ...x, brand: { ...x.brand, ...patch } }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // The kiosk frame, as the designer's preview runs it.
  const frame = useRef(null)
  const frameOrigin = useRef(null)
  const latest = useRef(design)
  latest.current = design
  const [ready, setReady] = useState(false)
  useEffect(() => {
    function onMessage(e) {
      if (!frame.current || e.source !== frame.current.contentWindow || e.data?.type !== 'kiosk.ready') return
      frameOrigin.current = e.origin
      setReady(true)
      e.source.postMessage({ type: 'kiosk.design', design: latest.current }, e.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => {
    if (ready && frameOrigin.current) frame.current?.contentWindow?.postMessage({ type: 'kiosk.design', design }, frameOrigin.current)
  }, [design, ready])

  const box = useRef(null)
  const [scale, setScale] = useState(0.3)
  const W = design.screen.short
  const H = design.screen.long
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.max(0.1, Math.min((el.clientWidth - 16) / W, (el.clientHeight - 16) / H)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])

  function save() {
    const id = openDesign().id
    setDemo(s => ({ designs: s.designs.map(d => (d.id === id ? { ...d, settings: design } : d)) }))
  }
  async function ownPicture(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const item = await api.upload('/media/items/upload', file)
      setSettings(x => ({ ...x, start: { ...x.start, media: [{ type: 'image', url: item.url }] } }))
    } catch (e) {
      setError(e?.body?.error || e.message)
    } finally {
      setBusy(false)
    }
  }
  const startUrl = design.start.media[0]?.url || null
  const fonts = [SYSTEM_FONT, ...KIOSK_FONTS]

  return (
    <div className="h-full flex flex-col bg-page" data-testid="demo-phone">
      <p className="shrink-0 bg-[#0b5d7a] text-white text-xs px-4 py-2" data-testid="demo-phone-note">
        The kiosk designer is made for a tablet or computer: open this page on one to try all of it. Here are a few of its settings, and the kiosk itself to tap through. Nothing is sent to us.
      </p>
      <div className="shrink-0 bg-background border-b px-4 py-3 space-y-3">
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1" role="group" aria-label="Colours">
          {PRESETS.map(p => (
            <button key={p.name} type="button" onClick={() => brand({ colors: { ...p.colors } })} data-testid="demo-phone-preset"
              className={cn('h-11 pl-1.5 pr-3 rounded-lg border text-xs font-medium inline-flex items-center gap-2 shrink-0 touch-manipulation',
                design.brand.colors.primary === p.colors.primary ? 'border-primary ring-2 ring-primary/30' : 'bg-background')}>
              <span className="w-8 h-8 rounded-md overflow-hidden grid grid-cols-2 border shrink-0" aria-hidden="true">
                <span style={{ background: p.colors.primary }} /><span style={{ background: p.colors.accent }} />
                <span style={{ background: p.colors.background }} /><span style={{ background: p.colors.surface }} />
              </span>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium shrink-0" htmlFor="demo-phone-font">Headings</label>
          <select id="demo-phone-font" value={design.brand.font_heading} onChange={e => brand({ font_heading: e.target.value })}
            className="h-11 flex-1 min-w-0 rounded-lg border bg-background px-2 text-sm touch-manipulation" data-testid="demo-phone-font">
            {fonts.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Start screen picture">
          <span className="text-xs font-medium shrink-0">Start screen</span>
          {STARTS.map(m => (
            <button key={m.id} type="button" onClick={() => setSettings(x => ({ ...x, start: { ...x.start, media: [{ type: 'image', url: m.url }] } }))}
              aria-label={m.filename.replace(/\.svg$/, '')} aria-pressed={startUrl === m.url} data-testid="demo-phone-start"
              className={cn('w-11 h-11 rounded-md overflow-hidden border shrink-0 touch-manipulation', startUrl === m.url && 'ring-2 ring-primary')}>
              <img src={m.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          <label className="h-11 px-3 rounded-lg border bg-background text-xs font-medium inline-flex items-center gap-1.5 touch-manipulation cursor-pointer shrink-0">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Yours
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" data-testid="demo-phone-upload"
              onChange={e => { ownPicture(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <Btn variant="primary" className="ml-auto" disabled={!dirty} onClick={save} data-testid="demo-phone-save">
            <Save className="w-4 h-4" /> {dirty ? 'Save' : 'Saved'}
          </Btn>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div ref={box} className="flex-1 min-h-[420px] flex items-center justify-center overflow-hidden p-2">
        <div className="relative shrink-0 rounded-xl overflow-hidden bg-black ring-4 ring-neutral-800" style={{ width: W * scale, height: H * scale }}>
          <iframe ref={frame} src={KIOSK_APP} title="Kiosk" data-testid="kd-preview"
            className="absolute left-0 top-0 border-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
          {!ready && <div className="absolute inset-0 flex items-center justify-center bg-black/70"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>}
        </div>
      </div>
    </div>
  )
}

const PHONE = '(max-width: 639px)'

/** A phone-sized window (the frame on the page is as wide as the phone). */
export function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
