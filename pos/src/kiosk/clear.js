// Pictures with see-through parts (cut-out PNGs and WebPs: a burger, a dip
// pot) are drawn without the kiosk's picture background, frame or badge, and
// whole (contain) rather than cropped: kiosk.css .k-clear. useClear(src) says
// whether a picture has any transparent pixel, read once per picture from a
// small copy on a canvas and kept for the session. A picture that can't be
// read (another site that doesn't allow it) counts as not see-through.

import { useEffect, useState } from 'react'

const known = new Map()   // src -> true | false | Promise<boolean>

const SIZE = 48           // enough to catch a cut-out's corners and edges

function sameOrigin(src) {
  try { return new URL(src, location.href).origin === location.origin } catch { return true }
}

function read(src) {
  return new Promise(resolve => {
    const img = new Image()
    if (!sameOrigin(src)) img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = SIZE; c.height = SIZE
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0, SIZE, SIZE)
        const px = g.getImageData(0, 0, SIZE, SIZE).data
        for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return resolve(true)
        resolve(false)
      } catch { resolve(false) }
    }
    img.onerror = () => resolve(false)
    img.src = src
  })
}

/** Whether src has see-through parts (cached); false while it isn't known yet. */
export function isClear(src) {
  if (!src) return Promise.resolve(false)
  const k = known.get(src)
  if (typeof k === 'boolean') return Promise.resolve(k)
  if (k) return k
  const p = read(src).then(v => { known.set(src, v); return v })
  known.set(src, p)
  return p
}

export function useClear(src) {
  const [clear, setClear] = useState(() => known.get(src) === true)
  useEffect(() => {
    let live = true
    if (!src) { setClear(false); return }
    const k = known.get(src)
    if (typeof k === 'boolean') { setClear(k); return }
    isClear(src).then(v => { if (live) setClear(v) })
    return () => { live = false }
  }, [src])
  return clear
}
