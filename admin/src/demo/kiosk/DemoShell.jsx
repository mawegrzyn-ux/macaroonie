// src/demo/kiosk/DemoShell.jsx
//
// What the kiosk designer demo adds round the real designer: a band saying
// what the demo is (nothing leaves the browser), Dish pictures (in the
// office a dish's picture is set on the Menus page, which isn't in the demo)
// and Start again; and the list of the visitor's designs that the
// designer's Designs button goes back to.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, RotateCcw, X, Info, ChevronRight } from 'lucide-react'
import { PicturePick } from '@/components/media/PicturePick'
import { Btn } from '@/components/pos/shared'
import { getDemo, subscribeDemo, setDemo, resetDemo, demoDishes } from './demoStore.js'

export function useDemo() { return useSyncExternalStore(subscribeDemo, getDemo) }

/** The band above the designer. */
export function DemoBar() {
  const demo = useDemo()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [dishes, setDishes] = useState(false)
  const [resetting, setResetting] = useState(false)
  function startAgain() {
    resetDemo()
    qc.clear()
    setResetting(false)
    navigate('/pos/kiosk-designs/' + getDemo().designs[0].id, { replace: true })
  }
  return (
    <div className="shrink-0 border-b bg-[#0b5d7a] text-white" data-testid="demo-bar">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <Info className="w-4 h-4 shrink-0" />
        <p className="text-xs sm:text-sm flex-1 min-w-[220px]">
          The real kiosk designer, with an invented menu. Your designs and pictures stay in this browser: nothing is sent to us.
        </p>
        <button type="button" onClick={() => setDishes(true)} data-testid="demo-dish-pictures"
          className="h-11 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium inline-flex items-center gap-2 touch-manipulation">
          <ImageIcon className="w-4 h-4" /> Dish pictures
        </button>
        {resetting ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs">Lose your designs and pictures?</span>
            <button type="button" onClick={startAgain} data-testid="demo-reset-yes"
              className="h-11 px-3 rounded-lg bg-white text-[#0b5d7a] text-sm font-semibold touch-manipulation">Start again</button>
            <button type="button" onClick={() => setResetting(false)}
              className="h-11 px-3 rounded-lg bg-white/15 text-sm touch-manipulation">Keep them</button>
          </span>
        ) : (
          <button type="button" onClick={() => setResetting(true)} data-testid="demo-reset"
            className="h-11 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium inline-flex items-center gap-2 touch-manipulation">
            <RotateCcw className="w-4 h-4" /> Start again
          </button>
        )}
      </div>
      {demo.note && <p className="px-4 pb-2 text-xs text-amber-200" data-testid="demo-note">{demo.note}</p>}
      {dishes && <DishPictures onClose={() => setDishes(false)} />}
      <RememberOpen />
    </div>
  )
}

/** The design open now, opened again after a reload. */
function RememberOpen() {
  const { pathname } = useLocation()
  useEffect(() => {
    const id = pathname.split('/')[3]
    if (id && getDemo().open !== id) setDemo({ open: id })
  }, [pathname])
  return null
}

/** Each dish's picture: the menu's, one of the built-in set or one of the visitor's own. */
function DishPictures({ onClose }) {
  const demo = useDemo()
  const qc = useQueryClient()
  const dishes = demoDishes()
  void demo // re-render on a change
  function setPic(id, url) {
    setDemo(s => ({ dishPics: { ...s.dishPics, [id]: url } }))
    qc.invalidateQueries({ queryKey: ['pos-setup'] })
  }
  const sections = [...new Set(dishes.map(d => d.section))]
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 text-foreground"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-background shadow-xl" role="dialog" aria-label="Dish pictures" data-testid="demo-dishes">
        <div className="section-head px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
          <ImageIcon className="w-4 h-4" />
          <h2 className="font-semibold text-sm flex-1">Dish pictures</h2>
          <button type="button" onClick={onClose} className="w-11 h-11 -m-2 flex items-center justify-center rounded-lg touch-manipulation" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            In Macaroonie a dish's picture is part of the menu (Menus). Here you can give any dish one of the demo's pictures, or one of your own:
            tap a picture to choose, or drop one from your computer on it. The preview shows it at once.
          </p>
          {sections.map(sec => (
            <div key={sec}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{sec}</h3>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                {dishes.filter(d => d.section === sec).map(d => (
                  <div key={d.id} className="flex items-center gap-3 min-w-0" data-testid={'demo-dish-' + d.id}>
                    <PicturePick url={d.image_url} onChange={url => setPic(d.id, url)} scope="kiosk" size="md" label={'picture of ' + d.name} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      {d.image_url !== d.menu_url && (
                        <button type="button" onClick={() => setPic(d.id, d.menu_url)} className="text-xs text-primary underline min-h-[32px] touch-manipulation">
                          Back to the menu's picture
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The visitor's designs (the designer's Designs button comes here). */
export function DemoDesigns() {
  const demo = useDemo()
  const navigate = useNavigate()
  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <section className="rounded-xl border bg-background overflow-hidden">
          <div className="px-4 py-3 section-head">
            <h2 className="text-sm font-semibold">Kiosk designs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">In Macaroonie each kiosk is given one of these (Store tech, Kiosks). Save as in the designer makes another.</p>
          </div>
          <ul className="divide-y" data-testid="demo-designs">
            {[...demo.designs].sort((a, b) => a.name.localeCompare(b.name)).map(d => (
              <li key={d.id}>
                <button type="button" onClick={() => navigate('/pos/kiosk-designs/' + d.id)}
                  className="w-full min-h-[56px] px-4 flex items-center gap-3 text-left hover:bg-muted touch-manipulation">
                  <span className="w-8 h-8 rounded-lg shrink-0 border" style={{ background: d.settings?.brand?.colors?.primary || '#ccc' }} />
                  <span className="flex-1 font-medium text-sm">{d.name}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <Btn onClick={() => navigate(-1)}>Back</Btn>
      </div>
    </div>
  )
}

const PHONE = '(max-width: 639px)'

/** A phone-sized window. */
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

export function PhoneDemo() {
  return null
}
