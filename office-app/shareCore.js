// Sharing to Macaroonie Office from another app (the gallery's Share, a
// link or a note): the rules, kept apart from App.js (no React Native here)
// so the tests can run them in Node. The app is an Android share target
// (expo-share-intent's config plugin in app.json: SEND image/* and
// text/plain, SEND_MULTIPLE image/*); App.js reads what arrived, shrinks a
// picture natively (expo-image-manipulator) and keeps one item here until the
// page takes it (MacaroonieOffice.share.take(), bridge.js), which opens it in
// Capture (admin/src/lib/officeApp.jsx). Only in memory, never on disk, and
// dropped after SHARE_KEEP_MS.

/** How long a shared item waits for the page to take it. */
export const SHARE_KEEP_MS = 10 * 60 * 1000
/** A shared picture's longest side after shrinking, and its JPEG quality (then a second try). */
export const SHARE_MAX_EDGE = 2000
export const SHARE_QUALITIES = [0.8, 0.6]
/** The most a shared picture may be once shrunk (the server's photo limit, api/src/ai/attachments.js). */
export const SHARE_MAX_BYTES = 5 * 1024 * 1024
/** Shared words are cut to a capture's note (api/src/routes/captures.js NOTE_MAX). */
export const SHARE_TEXT_MAX = 2000

export const NOT_A_PICTURE = 'Capture keeps a photo or a few words. That was another kind of file, so it wasn\'t kept.'
export const UNREADABLE = 'Macaroonie Office couldn\'t read that picture. Try Photo or From phone in Capture instead.'
export const TOO_BIG = 'That picture is too big to keep, even made smaller.'

/**
 * One shared item waiting for the page. put() replaces what was waiting;
 * take() gives it once (null when nothing waits or it waited too long).
 * The timer drops it after keepMs even if the page never asks.
 */
export function createShareInbox({ now = () => Date.now(), keepMs = SHARE_KEEP_MS, timers = globalThis } = {}) {
  let held = null
  let timer = null
  const clear = () => { held = null; if (timer) { timers.clearTimeout(timer); timer = null } }
  return {
    put(item) {
      clear()
      if (!item) return
      held = { item, at: now() }
      timer = timers.setTimeout(clear, keepMs)
      timer?.unref?.()   // Node (the tests): a waiting item doesn't keep the process alive
    },
    take() {
      const h = held
      clear()
      if (!h || now() - h.at > keepMs) return null
      return h.item
    },
    waiting: () => !!held && now() - held.at <= keepMs,
    clear,
  }
}

const isImage = f => typeof f?.mimeType === 'string' && f.mimeType.toLowerCase().startsWith('image/')

/**
 * What arrived, from expo-share-intent's Android module (its onChange value):
 *   { kind: 'image', uris, name, more }  the first picture (more: how many others were left out)
 *   { kind: 'text', text }               a link or a note
 *   { kind: 'refused', message }         something Capture doesn't keep
 *   null                                 nothing
 * uris: the content address first (it carries the read grant), then the copy
 * the module made in the app's cache.
 */
export function whatWasShared(raw) {
  if (!raw || typeof raw !== 'object') return null
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .filter(f => f && typeof f === 'object' && !Array.isArray(f) && (f.contentUri || f.filePath || f.path))
  if (files.length) {
    const first = files.find(isImage)
    if (!first) return { kind: 'refused', message: NOT_A_PICTURE }
    const uris = [first.contentUri, first.path, first.filePath ? (String(first.filePath).startsWith('file://') ? first.filePath : 'file://' + first.filePath) : null]
      .filter(u => typeof u === 'string' && u)
    return { kind: 'image', uris: [...new Set(uris)], name: pictureName(first.fileName), more: files.length - 1 }
  }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text) return { kind: 'text', text: text.slice(0, SHARE_TEXT_MAX) }
  return null
}

/** The shared picture's name as a JPEG: letters, digits, dots, dashes and spaces, 80 at most. */
export function pictureName(name) {
  const last = String(name || '').split(/[\\/]/).pop()
  const base = last.replace(/\.[^.]*$/, '').replace(/[^\w .-]+/g, '').replace(/^[.\s]+/, '').trim().slice(0, 80)
  return (base || 'shared-picture') + '.jpg'
}

/** The size to shrink to so the longest side is at most max, or null when it already fits. */
export function fitWithin(width, height, max = SHARE_MAX_EDGE) {
  const w = Number(width) || 0, h = Number(height) || 0
  if (!w || !h || Math.max(w, h) <= max) return null
  return w >= h ? { width: max } : { height: max }
}

/** Bytes a base64 string holds. */
export function base64Bytes(b64) {
  const s = String(b64 || '')
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(s.length * 3 / 4) - pad)
}

/**
 * The item the page takes, from what arrived. shrink(uri, quality) is the
 * app's native shrink (App.js): base64 JPEG data, longest side SHARE_MAX_EDGE.
 * Each address is tried in turn, then a lower quality if it is still too big.
 * Never logs or keeps the picture anywhere but the returned item.
 */
export async function readShared(found, shrink) {
  if (!found) return null
  if (found.kind !== 'image') return found
  let read = false
  for (const uri of found.uris || []) {
    for (const quality of SHARE_QUALITIES) {
      let data
      try { data = await shrink(uri, quality) } catch { break }   // this address can't be read: the next one
      if (typeof data !== 'string' || !data) break
      read = true
      if (base64Bytes(data) <= SHARE_MAX_BYTES) {
        return { kind: 'image', name: found.name, type: 'image/jpeg', dataBase64: data, more: found.more || 0 }
      }
    }
    if (read) break
  }
  return { kind: 'refused', message: read ? TOO_BIG : UNREADABLE }
}
