// The self-order kiosk (docs/POS.md section 10). A device paired as a kiosk
// opens this instead of the till; the design editor in Store tech opens it
// as a live preview. The design (shared/kiosk.js) sets every colour, font
// and corner through --k-* variables (kiosk.css).
//
//   start -> menu (+ item builder) -> basket -> name / table number ->
//   how to pay -> card reader -> sending -> order number -> start
// A guest who walks away is asked "Are you still there?", then the order is
// cleared. Five quick taps in the top-left corner of the start screen open a
// small staff panel.

import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Wifi, WifiOff, X, Accessibility } from 'lucide-react'
import { kioskFontsUrl, kioskFontStack } from '@shared/kiosk.js'
import { useKiosk, bootKiosk, bootPreview, bootShare, textsFor, restart, loadConfig, setReach, getState, disconnect, moveKiosk } from './store.js'
import { whenSafeToReload, idleFor } from '../lib/appUpdate.js'
import { belongsHere } from '../lib/appHost.js'
import { MoveNotice } from '../components/MoveNotice.jsx'
import Start, { Media } from './Start.jsx'
import Menu from './Menu.jsx'
import Builder from './Builder.jsx'
import Allergens from './Allergens.jsx'
import { Basket, Details, Pay, Card, Placing, Done, Failed } from './Checkout.jsx'
import { cx, Sheet } from './parts.jsx'
import './kiosk.css'

const IDLE_FREE = new Set(['start', 'done', 'placing'])

function useDesignStyle(design) {
  const style = useMemo(() => {
    if (!design) return {}
    const c = design.brand.colors
    return {
      '--k-bg': c.background, '--k-surface': c.surface, '--k-text': c.text, '--k-muted': c.muted,
      '--k-primary': c.primary, '--k-primary-text': c.primary_text, '--k-accent': c.accent, '--k-accent-text': c.accent_text,
      // Pop-up sheets stay solid when the cards are See-through.
      '--k-sheet': c.surface === 'transparent' ? c.background : c.surface,
      '--k-radius': design.brand.radius + 'px',
      '--k-font-head': kioskFontStack(design.brand.font_heading), '--k-font-body': kioskFontStack(design.brand.font_body),
    }
  }, [design])
  // The design's fonts, once per change.
  const url = design ? kioskFontsUrl(design) : null
  useEffect(() => {
    if (!url) return
    let link = document.getElementById('k-fonts')
    if (!link) {
      link = document.createElement('link')
      link.id = 'k-fonts'
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== url) link.href = url
  }, [url])
  return style
}

/** Keep the screen on while the kiosk is open (where the browser allows it; not the editor's preview). */
function useWakeLock(off) {
  useEffect(() => {
    if (off) return
    let lock = null
    const take = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch { /* not allowed */ } }
    take()
    const onVis = () => { if (!document.hidden) take() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release() } catch { /* gone */ } }
  }, [off])
}

function Idle({ s, texts }) {
  const last = useRef(Date.now())
  const warning = useRef(false)
  const [left, setLeft] = useState(null)
  const d = s.config.design.behaviour
  useEffect(() => {
    // Any touch counts, except while the warning is up: then only its own
    // button (or the background) answers it, on click, so the tap can't land
    // on the menu underneath.
    const touch = () => { if (!warning.current) last.current = Date.now() }
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('keydown', touch, true)
    return () => { window.removeEventListener('pointerdown', touch, true); window.removeEventListener('keydown', touch, true) }
  }, [])
  useEffect(() => {
    const id = setInterval(() => {
      const st = getState()
      if (IDLE_FREE.has(st.screen) || st.preview || st.card_waiting) { last.current = Date.now(); warning.current = false; setLeft(null); return }
      const idle = (Date.now() - last.current) / 1000
      if (idle < d.idle_secs) return
      const n = Math.ceil(d.idle_secs + d.warn_secs - idle)
      if (n <= 0) { last.current = Date.now(); warning.current = false; setLeft(null); restart(); return }
      warning.current = true
      setLeft(n)
    }, 500)
    return () => clearInterval(id)
  }, [d.idle_secs, d.warn_secs])
  const here = () => { last.current = Date.now(); warning.current = false; setLeft(null) }
  if (left == null || IDLE_FREE.has(s.screen)) return null
  return (
    <Sheet onClose={here}>
      <div className="flex flex-col items-center gap-[var(--k-pad)] text-center" data-testid="k-idle">
        <div className="k-head text-[2.2em]">{texts.ui('still_there')}</div>
        <div className="text-[1.2em]">{texts.ui('still_there_body', { n: left })}</div>
        <button className="k-btn k-btn-primary k-btn-big" onClick={here} data-testid="k-idle-here">{texts.ui('im_here')}</button>
      </div>
    </Sheet>
  )
}

// The menu's pictures kept on the device for when the internet is down (photos.js).
function photosText(p) {
  if (!p) return 'Checking…'
  if (!p.total) return 'None in the menu'
  if (p.saved == null) return 'Not kept on this screen (no offline storage)'
  if (p.busy) return 'Saving: ' + p.saved + ' of ' + p.total
  return p.saved === p.total ? 'All ' + p.total + ' saved' : p.saved + ' of ' + p.total + ' saved (the rest when the connection allows)'
}

function StaffPanel({ s, onClose }) {
  const c = s.config
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-[.8em]" data-testid="k-staff">
        <div className="flex items-center gap-2">
          <div className="k-head text-[1.4em] flex-1">{s.device?.name} ({s.device?.short_code})</div>
          <button className="k-btn k-btn-icon k-btn-ghost" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-[1em] gap-y-[.3em] text-[.9em]">
          <span className="k-muted">Venue</span><span>{c?.venue?.name}</span>
          <span className="k-muted">Revenue stream</span><span>{c?.stream?.name || 'None'}</span>
          <span className="k-muted">Design</span><span>{c?.design?.name}</span>
          <span className="k-muted">Card reader</span><span>{c?.device?.settings?.card_reader === 'test' ? 'Test (no money is taken)' : 'None'}</span>
          <span className="k-muted">Connection</span>
          <span className="flex items-center gap-1" data-testid="k-staff-link">
            {s.link === 'down' ? <><WifiOff size={16} /> Offline: ordering paused, trying every few seconds</>
              : s.link === 'checking' ? <><Wifi size={16} /> Checking the connection…</>
                : <><Wifi size={16} /> Online</>}
          </span>
          <span className="k-muted">Pictures on this kiosk</span><span data-testid="k-staff-photos">{photosText(s.photos)}</span>
          <span className="k-muted">Orders waiting to send</span><span>{s.outbox.length}</span>
          <span className="k-muted">Menu version</span><span>{c?.version}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="k-btn" onClick={() => loadConfig()}><RefreshCw /> Check for menu changes</button>
          <button className="k-btn" onClick={() => location.reload()}><RefreshCw /> Reload</button>
        </div>
        {!belongsHere(s.device?.kind || 'kiosk') && <MoveNotice kind="kiosk" onMove={moveKiosk} className="rounded-lg" />}
        <DisconnectBox waiting={s.outbox.length} />
      </div>
    </Sheet>
  )
}

/** Disconnect this kiosk: asked twice, never with paid orders still waiting. */
function DisconnectBox({ waiting }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const go = async () => {
    setBusy(true)
    setMsg(null)
    const r = await disconnect()
    if (!r.ok) { setMsg(r.error); setBusy(false); setStep(0); return }
    if (!r.told) setMsg('Disconnected here. Macaroonie couldn\'t be told (offline): remove the kiosk in Store tech, or link the code it shows next.')
  }
  return (
    <div className="flex flex-col gap-[.5em] pt-[.6em] border-t border-black/10" data-testid="k-disconnect">
      <div className="k-muted text-[.8em]">Disconnect: this screen stops being a kiosk and shows a code. Link that code in Store tech &gt; Kiosks (Link a device) or with the installer app to set it up again (it keeps its name and settings).</div>
      {step === 0
        ? <button className="k-btn self-start" onClick={() => setStep(1)}>Disconnect this kiosk</button>
        : (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="font-semibold">Disconnect this kiosk?{waiting ? ` ${waiting} paid ${waiting === 1 ? 'order is' : 'orders are'} sent first.` : ''}</span>
            <button className="k-btn k-btn-primary" disabled={busy} onClick={go} data-testid="k-disconnect-yes">{busy ? 'Disconnecting…' : 'Yes, disconnect'}</button>
            <button className="k-btn" onClick={() => setStep(0)}>Cancel</button>
          </div>
        )}
      {msg && <div className="text-[.9em] font-semibold" data-testid="k-disconnect-msg">{msg}</div>}
    </div>
  )
}

export default function KioskApp({ device = null, previewToken = null, shareToken = null }) {
  const preview = !!(previewToken || shareToken)
  useEffect(() => {
    if (previewToken) bootPreview(previewToken)
    else if (shareToken) bootShare(shareToken)
    else bootKiosk(device)
  }, [device, previewToken, shareToken])
  useWakeLock(preview)
  // A new copy of the app (lib/appUpdate.js) goes in on the start screen,
  // with nothing in the basket and nobody touching it.
  useEffect(() => {
    if (preview) return undefined
    return whenSafeToReload(() => {
      const k = getState()
      return k.screen === 'start' && !k.basket.length && !k.builder && idleFor(10000)
    })
  }, [preview])
  const s = useKiosk()
  const texts = textsFor(s)
  const design = s.config?.design
  const style = useDesignStyle(design)
  const [staff, setStaff] = useState(false)
  const taps = useRef([])
  const corner = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter(t => now - t < 3000), now]
    if (taps.current.length >= 5) { taps.current = []; setStaff(true) }
  }
  useEffect(() => { document.documentElement.lang = texts.lang }, [texts.lang])

  if (s.phase === 'loading') return <div className="fixed inset-0 bg-black" />
  if (!s.config) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-6 bg-[#111] text-white text-center">
        <div className="space-y-3">
          <WifiOff className="mx-auto" size={44} />
          <div className="text-xl font-bold">{s.preview ? s.error || 'The preview couldn\'t load' : 'This kiosk needs to download its menu once. Check the Wi-Fi.'}</div>
          {!s.preview && <button className="btn btn-primary" onClick={() => loadConfig()}><RefreshCw size={18} /> Try again</button>}
        </div>
      </div>
    )
  }
  const screen = {
    start: Start, menu: Menu, basket: Basket, details: Details, pay: Pay, card: Card, placing: Placing, done: Done, failed: Failed, allergens: Allergens,
  }[s.screen] || Start
  const Screen = screen
  return (
    <div className={cx('k-root', design.brand.heading_case === 'upper' && 'k-upper', s.reach && 'k-reach', 'k-tiles-' + design.layout.tiles, 'k-opts-' + design.layout.option_tiles, design.layout.icon_buttons && 'k-icons')}
      style={style} data-testid="kiosk" data-screen={s.screen} data-tiles={design.layout.tiles} data-option-tiles={design.layout.option_tiles}
      data-option-pictures={design.layout.option_pictures ? '1' : '0'} data-option-align={design.layout.option_align}
      data-hero={design.layout.hero} data-enter={design.options.entrance}>
      {s.reach && (
        <div className={cx('k-reach-band', design.behaviour.reach_media.length > 0 && 'k-reach-media')} data-testid="k-reach-band">
          {/* The design's pictures or videos fill the space above; the way back stays on top of them. */}
          {design.behaviour.reach_media.length > 0
            ? <Media media={design.behaviour.reach_media} secs={design.start.media_secs} />
            : <Accessibility size={48} />}
          <button className="k-btn k-btn-big relative" onClick={() => setReach(false)} data-testid="k-reach-back">{texts.ui('reach_back')}</button>
        </div>
      )}
      <div className="k-frame">
        <div className="relative flex-1 min-h-0">
          <Screen />
          {s.builder && s.screen !== 'start' && <Builder />}
        </div>
      </div>
      {s.screen === 'start' && <button aria-hidden="true" tabIndex={-1} className="absolute left-0 top-0 w-[70px] h-[70px] opacity-0 z-[70]" onClick={corner} data-testid="k-corner" />}
      {/* Paired on the till's address before kiosks had their own (lib/appHost.js). */}
      {s.screen === 'start' && !s.preview && s.device && !belongsHere(s.device.kind || 'kiosk') && (
        <div className="absolute inset-x-0 top-0 z-[65]"><MoveNotice kind="kiosk" onMove={moveKiosk} className="pl-[80px]" /></div>
      )}
      {s.preview && <div className="absolute right-2 top-2 z-[70] px-3 py-1 rounded-full bg-black/75 text-white text-[13px] font-semibold pointer-events-none">{texts.ui('preview')}</div>}
      {s.toast && <div key={s.toast.id} className="k-toast" data-testid="k-toast">{s.toast.text}</div>}
      <Idle s={s} texts={texts} />
      {staff && <StaffPanel s={s} onClose={() => setStaff(false)} />}
    </div>
  )
}
