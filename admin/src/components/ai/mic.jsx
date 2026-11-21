// src/components/ai/mic.jsx
//
// Pepper's microphone button (OUTSTANDING 44 item 12), the one way to talk to
// Pepper: Pepper's message box (ChatView) and the Pepper bar on the phone's
// home (AskPepperBar) both use it. It takes a tap or a hold:
//   tap   dictation: a tap starts, the next tap stops (a browser also stops on
//         a pause); the words go into the box after what is typed, for the
//         person to read and send
//   hold  record while held, through pauses; let go to send it as a spoken turn
// Listening starts on the press either way, so no words are lost while the
// press is still too short to tell which it is (MIC_HOLD_MS). It asks for
// continuous listening (the Office app keeps one listening open through
// pauses); where listening still ends on a pause, it starts again while the
// button is down. A press the browser takes away (a scroll, a call) stops and
// sends nothing; a failure keeps the words in the box. The button is
// touch-none with pointer capture, so a web view never takes a hold for a
// scroll.
//
//   const mic = useMic({ draft, setDraft, onSend, onError, onStart, blocked })
//   <MicButton mic={mic} disabled={...} prominent />
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listen, stopSpeaking } from '@/lib/speech'

// How long a press on the mic must last to be a hold (record, let go to send) rather than a tap (dictation).
export const MIC_HOLD_MS = 350

/**
 * draft / setDraft: the message box. onSend(text): a hold was let go of with
 * words. onError(message): listening failed. onStart(): a press began (clear
 * an old error). blocked: presses do nothing (Pepper is working, or listening
 * for something else). Returns { state: null | 'dictate' | 'hold', handlers, stop }.
 */
export function useMic({ draft, setDraft, onSend, onError, onStart, blocked = false }) {
  const [state, setState] = useState(null)
  const stopHearing = useRef(null)
  const mic = useRef({ down: false, hold: false, failed: false, stopOnUp: false, text: '', timer: null })

  function micListen(base) {
    stopHearing.current = listen({
      continuous: true,
      onText: t => { const text = (base ? base + ' ' : '') + t; mic.current.text = text; setDraft(text) },
      onEnd: () => {
        stopHearing.current = null
        const m = mic.current
        // A pause while the button is still pressed (a hold, or a press not
        // yet long enough to be one): listen on, after the words so far.
        if (m.down && !m.failed) { micListen(m.text.trim()); return }
        if (m.hold) { micSend(); return }
        setState(null)
      },
      onError: e => { mic.current.failed = true; onError?.(e) },
    })
  }
  function micSend() {
    const text = mic.current.text.trim()
    mic.current.hold = false
    setState(null)
    if (text && !mic.current.failed) onSend?.(text)
  }
  function begin(down) {
    stopSpeaking()
    mic.current = { down, hold: false, failed: false, stopOnUp: false, text: draft.trim(), timer: null }
    setState('dictate'); onStart?.()
    micListen(draft.trim())
  }
  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    if (blocked) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not every pointer */ }
    // Dictating already: this tap stops it (on its release).
    if (state === 'dictate') { mic.current.stopOnUp = true; return }
    begin(true)
    mic.current.timer = setTimeout(() => { mic.current.hold = true; setState('hold') }, MIC_HOLD_MS)
  }
  function onPointerUp() {
    const m = mic.current
    m.down = false
    clearTimeout(m.timer)
    if (m.stopOnUp) { m.stopOnUp = false; stopHearing.current?.(); return }
    if (!m.hold) {
      // A tap: dictation carries on until the next tap (or a pause), unless
      // the recognition already ended while the button was down.
      if (!stopHearing.current) setState(null)
      return
    }
    if (stopHearing.current) stopHearing.current()   // its end sends
    else micSend()
  }
  // A press the browser took away (a scroll, a call): stop, keep the words in the box, send nothing.
  function onPointerCancel() {
    const m = mic.current
    clearTimeout(m.timer)
    m.down = false; m.hold = false; m.stopOnUp = false
    stopHearing.current?.()
  }
  // Enter or Space on the focused mic: dictation on and off, as a tap.
  function onClick(e) {
    if (e.detail !== 0) return   // a pointer's click: handled by down and up
    if (state === 'dictate') { stopHearing.current?.(); return }
    if (state || blocked) return
    begin(false)
  }
  useEffect(() => () => { mic.current.down = false; mic.current.hold = false; stopHearing.current?.() }, [])

  return {
    state,
    handlers: { onPointerDown, onPointerUp, onPointerCancel, onClick, onContextMenu: e => e.preventDefault() },
    stop: () => stopHearing.current?.(),
  }
}

/** The button for useMic(). prominent: filled, for a page where talking is the main way in (the phone). */
export function MicButton({ mic, disabled = false, prominent = false, testId = 'chat-mic', className }) {
  const on = mic.state === 'dictate' || mic.state === 'hold'
  const label = mic.state === 'hold' ? 'Recording: let go to send' : mic.state === 'dictate' ? 'Stop dictating' : 'Dictate (tap), or hold to talk and let go to send'
  return (
    <button type="button" disabled={disabled} {...mic.handlers} style={{ WebkitTouchCallout: 'none' }}
      aria-pressed={on} data-testid={testId} data-state={mic.state || 'off'}
      aria-label={label}
      title={mic.state ? label : 'Tap to dictate into the box; hold to talk and let go to send'}
      className={cn('w-12 h-12 shrink-0 rounded-md border flex items-center justify-center touch-none select-none disabled:opacity-40',
        on ? 'bg-red-600 text-white border-red-600'
          : prominent ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground',
        className)}>
      {mic.state === 'dictate' ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </button>
  )
}
