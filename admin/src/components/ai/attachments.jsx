// src/components/ai/attachments.jsx
//
// Files in the staff AI chat (migration 150): photos, screenshots, PDFs and
// text / CSV files. ChatView uses:
//
//   useAttachments()     the files waiting to go with the next message: each
//                        is shrunk if it's a big photo (prepareFile), uploaded
//                        straight away (POST /api/ai/attachments) and sent by
//                        id with the message
//   PendingFiles         the row of chips above the message box
//   MessageFiles         a sent message's files: image thumbnails (tap for a
//                        full view) and file chips (tap to open)
//
// Files are served only to their uploader, behind auth, so they are fetched
// as blobs (api.blob) and shown through object URLs, kept for the session.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X, FileText, CircleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const MAX_FILES = 5
export const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,.pdf,.txt,.csv,.tsv,.md,.json,text/plain,text/csv'

// Photos are shrunk to this long edge before upload: enough for the model
// to read a receipt or a screen, and far fewer tokens than a 12 MP photo.
const MAX_EDGE = 2000
const SHRINK_OVER_BYTES = 1.5 * 1024 * 1024

const kindOf = file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf'
  : file.type.startsWith('image/') ? 'image' : 'text'

export const sizeText = n => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}

const toBlob = (canvas, type, quality) => new Promise(r => canvas.toBlob(r, type, quality))

/** A big photo shrunk to MAX_EDGE (and a HEIC turned into a JPEG where the
 *  browser can read it); anything else as it is. */
export async function prepareFile(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  let loaded
  try {
    loaded = await loadImage(file)
  } catch {
    return file   // can't read it here; the server says what's wrong
  }
  const { img, url } = loaded
  URL.revokeObjectURL(url)
  const w = img.naturalWidth, h = img.naturalHeight
  const heic = !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  if (!heic && Math.max(w, h) <= MAX_EDGE && file.size <= SHRINK_OVER_BYTES) return file
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'           // transparent PNGs onto white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // Screenshots stay PNG (sharp text) unless that is still big; photos JPEG.
  let blob = file.type === 'image/png' ? await toBlob(canvas, 'image/png') : null
  if (!blob || blob.size > 4 * 1024 * 1024) blob = await toBlob(canvas, 'image/jpeg', 0.88)
  if (!blob) return file
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], base + (blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type })
}

let nextKey = 1

/** The files waiting to go with the next message. */
export function useAttachments() {
  const api = useApi()
  const apiRef = useRef(api)
  apiRef.current = api
  const [files, setFiles] = useState([])   // { key, name, kind, bytes, status: uploading|ready|error, id?, preview?, error? }
  const [notice, setNotice] = useState(null)
  // The current list for the callbacks below (state updaters may run late).
  const filesRef = useRef(files)
  filesRef.current = files

  const update = (key, patch) => setFiles(list => list.map(f => f.key === key ? { ...f, ...patch } : f))

  const add = useCallback(async fileList => {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return
    setNotice(null)
    const room = Math.max(0, MAX_FILES - filesRef.current.length)
    const chosen = incoming.slice(0, room)
    if (incoming.length > chosen.length) setNotice('Up to ' + MAX_FILES + ' files per message.')
    const added = chosen.map(original => ({
      original, key: nextKey++, name: original.name || 'file', kind: kindOf(original), bytes: original.size, status: 'uploading',
    }))
    filesRef.current = [...filesRef.current, ...added]
    setFiles(list => [...list, ...added.map(({ original, ...f }) => f)])
    for (const { original, key } of added) {
      ;(async () => {
        try {
          const file = await prepareFile(original)
          const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
          update(key, { name: file.name, bytes: file.size, preview })
          const saved = await apiRef.current.upload('/ai/attachments', file)
          update(key, { status: 'ready', id: saved.id, kind: saved.kind })
        } catch (err) {
          update(key, { status: 'error', error: err.message || 'Upload failed' })
        }
      })()
    }
  }, [])

  const remove = useCallback(key => {
    const f = filesRef.current.find(x => x.key === key)
    if (f?.id) apiRef.current.delete('/ai/attachments/' + f.id).catch(() => {})
    if (f?.preview) URL.revokeObjectURL(f.preview)
    setFiles(list => list.filter(x => x.key !== key))
  }, [])

  /** Hands the files to a message being sent; returns them (with previews). */
  const take = useCallback(() => {
    const taken = filesRef.current
    filesRef.current = []
    setFiles([])
    return taken
  }, [])

  /** Puts files back after a send that didn't go through. */
  const restore = useCallback(list => setFiles(cur => [...list, ...cur].slice(0, MAX_FILES)), [])

  /** Forgets files whose message reached the chat (their previews too). */
  const discard = useCallback(list => list.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), [])

  return {
    files, add, remove, take, restore, discard, notice, setNotice,
    uploading: files.some(f => f.status === 'uploading'),
    ready: files.filter(f => f.status === 'ready'),
  }
}

/** Chips for the files waiting above the message box. */
export function PendingFiles({ files, onRemove }) {
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-2 px-2 sm:px-3 pt-2">
      {files.map(f => (
        <div key={f.key} className={cn('flex items-center gap-2 rounded-md border pl-1.5 min-w-0',
          f.status === 'error' ? 'border-destructive bg-destructive/5 max-w-full sm:max-w-[360px]' : 'max-w-[calc(50%-0.25rem)] sm:max-w-[260px]')}>
          <FileThumb kind={f.kind} src={f.preview} className="w-10 h-10" />
          <div className="min-w-0 py-1">
            <div className="text-xs font-medium truncate">{f.name}</div>
            <div className={cn('text-[11px]', f.status === 'error' ? 'text-destructive leading-snug' : 'text-muted-foreground truncate')}>
              {f.status === 'uploading' ? 'Uploading...' : f.status === 'error' ? f.error : sizeText(f.bytes)}
            </div>
          </div>
          {f.status === 'uploading'
            ? <span className="w-12 h-12 flex items-center justify-center shrink-0"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></span>
            : (
              <button type="button" onClick={() => onRemove(f.key)} aria-label={'Remove ' + f.name}
                className="w-12 h-12 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            )}
        </div>
      ))}
    </div>
  )
}

function FileThumb({ kind, src, className }) {
  if (kind === 'image' && src) return <img src={src} alt="" className={cn('rounded object-cover shrink-0 bg-muted', className)} />
  return (
    <span className={cn('rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground', className)}>
      <FileText className="w-5 h-5" />
    </span>
  )
}

// Sent files, fetched once per session: id -> Promise<object URL>.
const fileUrls = new Map()
function fileUrl(api, id) {
  if (!fileUrls.has(id)) {
    const p = api.blob('/ai/attachments/' + id).then(b => URL.createObjectURL(b))
    p.catch(() => fileUrls.delete(id))
    fileUrls.set(id, p)
  }
  return fileUrls.get(id)
}

function useFileUrl(id, enabled = true) {
  const api = useApi()
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!id || !enabled) return
    let live = true
    fileUrl(api, id).then(u => { if (live) setUrl(u) }, () => { if (live) setFailed(true) })
    return () => { live = false }
    // api changes identity every render; the id decides what to fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled])
  return { url, failed }
}

/** A sent message's files, inside the user's bubble. `local` files (the
 *  message still being sent) show their own previews. */
export function MessageFiles({ files, local = false }) {
  const [open, setOpen] = useState(null)   // { url, name } of an image shown full size
  if (!files?.length) return null
  return (
    <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
      {files.map(f => f.kind === 'image'
        ? <ImageFile key={f.id || f.key} file={f} local={local} onOpen={setOpen} />
        : <DocFile key={f.id || f.key} file={f} local={local} />)}
      {open && <ImageView {...open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ImageFile({ file, local, onOpen }) {
  const { url, failed } = useFileUrl(file.id, !local)
  const src = local ? file.preview : url
  return (
    <button type="button" disabled={!src} onClick={() => onOpen({ url: src, name: file.name })}
      className="w-24 h-24 rounded-md overflow-hidden bg-primary-foreground/20 flex items-center justify-center touch-manipulation"
      aria-label={'View ' + file.name}>
      {src ? <img src={src} alt={file.name} className="w-full h-full object-cover" />
        : failed ? <CircleAlert className="w-5 h-5 opacity-70" /> : <Loader2 className="w-4 h-4 animate-spin opacity-70" />}
    </button>
  )
}

function DocFile({ file, local }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  async function openFile() {
    if (local || !file.id) return
    // Open the tab now (a tab opened after an await is blocked as a pop-up).
    const tab = window.open('', '_blank')
    setBusy(true)
    try {
      const url = await fileUrl(api, file.id)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={openFile} disabled={local}
      className="flex items-center gap-2 rounded-md bg-primary-foreground/15 px-2 min-h-[48px] max-w-[220px] text-left touch-manipulation">
      {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
      <span className="min-w-0">
        <span className="block text-xs font-medium truncate">{file.name}</span>
        <span className="block text-[11px] opacity-80">{(file.kind === 'pdf' ? 'PDF' : 'Text') + (file.bytes ? ', ' + sizeText(file.bytes) : '')}</span>
      </span>
    </button>
  )
}

function ImageView({ url, name, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <img src={url} alt={name} className="max-w-full max-h-[85vh] rounded-md bg-white" onClick={e => e.stopPropagation()} />
      <button type="button" onClick={onClose} aria-label="Close"
        className="absolute top-3 right-3 w-12 h-12 rounded-full bg-black/60 text-white flex items-center justify-center touch-manipulation">
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}
