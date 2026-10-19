// A kiosk design's shared preview page (kiosk.<domain>/?kiosk_share=<token>,
// migration 187): the link a group gives people outside it (a brand team, a
// franchise partner, a designer). The kiosk itself runs in a frame at a real
// kiosk's size (&frame=1, the design as saved), scaled to fit the window, so
// it looks the same on a laptop, a tablet or a phone. Nothing is ordered or
// paid in it.

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, RectangleVertical, RectangleHorizontal, Maximize2, Loader2, Link2Off } from 'lucide-react'

const SIZE = { portrait: [1080, 1920], landscape: [1920, 1080] }

export default function SharePage({ token }) {
  const [shape, setShape] = useState(() => (new URLSearchParams(location.search).get('shape') === 'wide' ? 'landscape' : 'portrait'))
  const [info, setInfo] = useState(null)   // { design, venue, company, expires_at } once the kiosk says it's ready
  const [error, setError] = useState(null)
  const frame = useRef(null)
  const box = useRef(null)
  const [scale, setScale] = useState(0.3)
  const [W, H] = SIZE[shape]
  const src = '/?kiosk_share=' + encodeURIComponent(token) + '&frame=1'

  useEffect(() => {
    function onMessage(e) {
      if (!frame.current || e.source !== frame.current.contentWindow || e.origin !== location.origin) return
      if (e.data?.type !== 'kiosk.ready') return
      if (e.data.error) setError(e.data.error)
      else setInfo(e.data.share || {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.max(0.1, Math.min(1, (el.clientWidth - 24) / W, (el.clientHeight - 24) / H)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])

  useEffect(() => {
    document.title = info?.design ? info.design + ' kiosk preview' : 'Kiosk preview'
  }, [info])

  const post = msg => frame.current?.contentWindow?.postMessage(msg, location.origin)
  const btn = 'inline-flex items-center gap-1.5 h-11 px-3 rounded-lg text-sm font-medium touch-manipulation'

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-neutral-900 text-white p-6" data-testid="share-error">
        <div className="max-w-sm text-center space-y-3">
          <Link2Off className="mx-auto" size={40} />
          <p className="text-lg font-semibold">{error}</p>
          <p className="text-sm text-neutral-400">Kiosk previews are shared by the restaurant group. Ask whoever sent you the link for a new one.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-neutral-900 text-white" data-testid="share-page">
      <header className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-white/10">
        <div className="flex-1 min-w-[180px]">
          <p className="font-semibold leading-tight" data-testid="share-title">{info?.design || 'Kiosk preview'}</p>
          <p className="text-xs text-neutral-400 leading-tight">
            {info ? [info.company, info.venue ? 'menu and prices at ' + info.venue : null].filter(Boolean).join(' · ') : 'Loading…'}
          </p>
        </div>
        <div className="inline-flex rounded-lg overflow-hidden border border-white/15" role="group" aria-label="Screen shape">
          {[['portrait', RectangleVertical, 'Upright'], ['landscape', RectangleHorizontal, 'Wide']].map(([o, Icon, label]) => (
            <button key={o} type="button" onClick={() => setShape(o)} aria-pressed={shape === o} data-testid={'share-shape-' + o}
              className={'h-11 px-3 text-sm inline-flex items-center gap-1.5 touch-manipulation ' + (shape === o ? 'bg-white text-neutral-900' : 'hover:bg-white/10')}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <button type="button" className={btn + ' border border-white/15 hover:bg-white/10'} onClick={() => post({ type: 'kiosk.restart' })} data-testid="share-restart">
          <RotateCcw size={16} /> Start again
        </button>
        <a className={btn + ' border border-white/15 hover:bg-white/10'} href={src} target="_blank" rel="noopener" data-testid="share-full">
          <Maximize2 size={16} /> Full screen
        </a>
      </header>
      <div ref={box} className="flex-1 min-h-0 flex items-center justify-center overflow-hidden p-3">
        <div className="relative shrink-0 rounded-2xl overflow-hidden bg-black ring-[6px] ring-neutral-700 shadow-2xl" style={{ width: W * scale, height: H * scale }}>
          <iframe ref={frame} src={src} title="Kiosk preview" data-testid="share-frame"
            className="absolute left-0 top-0 border-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
          {!info && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="animate-spin" size={28} />
            </div>
          )}
        </div>
      </div>
      <footer className="shrink-0 px-4 py-2 text-[12px] text-neutral-400 text-center border-t border-white/10">
        A preview: use it like the kiosk. Nothing is ordered or paid.
        {info?.expires_at ? ' This link works until ' + new Date(info.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '.' : ''}
      </footer>
    </div>
  )
}
