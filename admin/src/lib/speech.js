// src/lib/speech.js
//
// Speech for Pepper (OUTSTANDING 44 item 12, docs/PEPPER_FIRST.md 4.7):
// speech to text and reading answers aloud. Two ways, picked at run time:
//   - the Macaroonie Office app (office-app/): its native bridge,
//     window.MacaroonieOffice, which uses the phone's own recognition (web
//     views have none of their own) and its own voice
//   - a browser: SpeechRecognition (webkitSpeechRecognition) and
//     speechSynthesis, where the browser has them
// Nothing listens in the background: listening starts on a tap or a press
// and stops on the next one, the release, or a pause. No sound is kept,
// only the words, which go into Pepper's box or the chat as text.
//
//   canListen()                     whether this device can turn speech into text
//   listen({ onText, onEnd, onError, lang, continuous, hints })  starts; returns stop()
//   canSpeak(), speak(text), stopSpeaking()
//   spokenText(markdown)            an answer cleaned for reading aloud
//   readAloudOn() / setReadAloud()  this device's "read answers aloud" switch

const READ_ALOUD_KEY = 'maca_voice_read_aloud'

const bridge = () => (typeof window !== 'undefined' ? window.MacaroonieOffice : null)
const Recognition = () => (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null)

export function canListen() {
  return !!(bridge()?.speech?.listen || Recognition())
}

export function canSpeak() {
  return !!(bridge()?.speech?.speak || (typeof window !== 'undefined' && window.speechSynthesis))
}

/**
 * Starts listening. onText(text, final) gets the words so far (final when the
 * device is sure); onEnd() once it stops; onError(message). Returns stop().
 * continuous: keep listening through pauses until stop(), where the device
 * can (the Office app on Android 13 and up). Elsewhere listening still ends
 * on a pause, so a caller that wants to listen on starts again from onEnd.
 * hints: the venue's own words (components/ai/venueWords.js), given to the
 * Office app's recogniser as contextual strings; a browser's Web Speech API
 * takes none, so there they only serve the snap after it.
 */
export function listen({ onText, onEnd, onError, lang, continuous = false, hints } = {}) {
  const language = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-GB'
  const native = bridge()?.speech
  if (native?.listen) {
    // The app calls back with the same shape; it returns its own stop().
    return native.listen({ lang: language, continuous, hints: Array.isArray(hints) ? hints.slice(0, 300) : undefined, onText, onEnd, onError }) || (() => native.stop?.())
  }
  const R = Recognition()
  if (!R) { onError?.('This browser can\'t turn speech into text. Use the keyboard\'s microphone key instead.'); onEnd?.(); return () => {} }
  const rec = new R()
  rec.lang = language
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let said = ''
  rec.onresult = e => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) said += r[0].transcript
      else interim += r[0].transcript
    }
    onText?.((said + interim).trim(), !interim)
  }
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return
    onError?.(e.error === 'not-allowed' ? 'The microphone is blocked for this site. Allow it in the browser\'s settings.' : 'Couldn\'t hear that (' + e.error + ').')
  }
  rec.onend = () => onEnd?.()
  try { rec.start() } catch (e) { onError?.(e.message); onEnd?.() }
  return () => { try { rec.stop() } catch { /* already stopped */ } }
}

/** An answer as it should be read aloud: no markdown, no links, never a phone number or email. */
export function spokenText(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')                    // [label](link) -> label
    .replace(/https?:\/\/\S+/g, '')                              // bare links
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'the email on screen') // emails
    .replace(/(\+?\d[\d\s().-]{8,}\d)/g, m => (m.replace(/\D/g, '').length >= 9 ? 'the number on screen' : m))
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let speaking = null
/** Reads text aloud (cleaned with spokenText()); resolves when it is done. */
export function speak(text, { lang } = {}) {
  const words = spokenText(text)
  if (!words) return Promise.resolve()
  const language = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-GB'
  const native = bridge()?.speech
  if (native?.speak) return Promise.resolve(native.speak({ text: words, lang: language }))
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve()
  stopSpeaking()
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(words)
    u.lang = language
    u.onend = resolve
    u.onerror = resolve
    speaking = u
    window.speechSynthesis.speak(u)
  })
}

export function stopSpeaking() {
  const native = bridge()?.speech
  if (native?.stopSpeaking) { native.stopSpeaking(); return }
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  speaking = null
}

/** Whether answers to spoken questions are read aloud on this device (off until switched on). */
export function readAloudOn() {
  try { return localStorage.getItem(READ_ALOUD_KEY) === '1' } catch { return false }
}
export function setReadAloud(on) {
  try { localStorage.setItem(READ_ALOUD_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

/** What a spoken reply to a card means: 'yes', 'no' or null (anything else). */
export function yesOrNo(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim()
  if (/^(yes|yeah|yep|yup|confirm|confirmed|save|save it|do it|go ahead|ok|okay|correct|that s right)\b/.test(t)) return 'yes'
  if (/^(no|nope|cancel|stop|don t|do not|wrong)\b/.test(t)) return 'no'
  return null
}
