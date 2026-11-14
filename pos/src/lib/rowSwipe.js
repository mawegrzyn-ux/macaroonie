// Rows that swipe sideways, one at a time: the phone floor's check rows
// (Floor.jsx: left sends or fires, right pays) and the dish rows of a list
// that take one off (MenuPanel.jsx, LayoutScreen.jsx). A press only becomes
// a swipe once it has moved SWIPE_START px sideways (more sideways than
// down), so a tap and an up-and-down scroll stay what they were.

import { useEffect, useRef, useState } from 'react'

export const SWIPE_START = 12 // px sideways before a press counts as a swipe

/**
 * Swiping rows both ways: let go past the line (35% of the row, at most
 * 160 px) and that side's action runs; short of it, the row springs back.
 * A side with no action only gives a little (24 px).
 *
 * down(e, key, { left, right, start }) on the row's pointerdown: left /
 * right are the actions (null = none that way), start runs once when the
 * press becomes a swipe (to stop a long press under the same finger). The
 * row's width is that of the closest [data-row] (else the element pressed).
 * swallow(key) after a swipe drops the click it ends with.
 */
export function useRowSwipe() {
  const [moving, setMoving] = useState(null) // { key, dx } while a finger moves a row
  const g = useRef(null)
  const swallowed = useRef(null)
  const end = useRef(null)
  useEffect(() => () => end.current?.(), [])

  const down = (e, key, act) => {
    // A new press: the click of an earlier swipe never came (its row went
    // away under the finger, as the last of a dish coming off does), so it
    // mustn't eat this press's click.
    swallowed.current = null
    if (e.button > 0) return
    const row = e.currentTarget.closest('[data-row]') || e.currentTarget
    const s = { key, x: e.clientX, y: e.clientY, pid: e.pointerId, swiping: false, width: row?.offsetWidth || 360, target: e.currentTarget }
    g.current = s
    const clamp = dx => {
      const lim = s.width * 0.9
      let v = Math.max(-lim, Math.min(lim, dx))
      if (v < 0 && !act.left) v = Math.max(v, -24)
      if (v > 0 && !act.right) v = Math.min(v, 24)
      return v
    }
    const move = ev => {
      if (ev.pointerId !== s.pid || g.current !== s) return
      const dx = ev.clientX - s.x
      const dy = ev.clientY - s.y
      if (!s.swiping) {
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) >= Math.abs(dx)) return finish()
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.2) return
        s.swiping = true
        act.start?.()
        try { s.target.setPointerCapture(s.pid) } catch { /* not every pointer can be captured */ }
      }
      setMoving({ key, dx: clamp(dx) })
    }
    const up = ev => {
      if (ev.pointerId !== s.pid) return
      if (s.swiping) {
        // The click this swipe ends with isn't a tap on the row.
        swallowed.current = key
        const dx = clamp(ev.clientX - s.x)
        const need = Math.min(s.width * 0.35, 160)
        setMoving(null)
        if (dx <= -need && act.left) act.left()
        else if (dx >= need && act.right) act.right()
      }
      finish()
    }
    const cancel = ev => { if (ev.pointerId === s.pid) { setMoving(null); finish() } }
    function finish() {
      if (g.current === s) g.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      end.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    end.current = finish
  }
  return {
    down,
    shiftOf: key => (moving?.key === key ? moving.dx : 0),
    isMoving: key => moving?.key === key,
    swallow: key => { if (swallowed.current === key) { swallowed.current = null; return true } return false },
  }
}
