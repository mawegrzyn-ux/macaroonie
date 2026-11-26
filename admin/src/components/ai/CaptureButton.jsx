// src/components/ai/CaptureButton.jsx
//
// Capture to For review (Pepper-first step 6b, migration 281): on the phone
// pages (and so in the Macaroonie Office app), one button that keeps a photo
// (a delivery note, an invoice, a broken door), a voice note's words or a
// typed line for later, with who, when and the venue. Nothing reads it now
// (no model call): it waits on For review until someone opens it in Pepper.
// Photos are shrunk on the phone first (prepareFile()) and checked by the
// server like a chat file (5 MB, JPEG / PNG / GIF / WebP).
//
// shared (26 Nov 2026): a picture, or a link or a note, shared to the Office
// app from another app (the hub's useSharedItem(), lib/officeApp.jsx) opens
// the window with it, through the same prepareFile() and checks as a picked
// photo. One photo per capture: when several pictures were shared, the first
// is kept and the window says so.
//
// From phone (26 Nov 2026): a picture already on the phone (the gallery or
// its files), through a second file input without capture, beside Photo
// (the camera where the browser or the app has it). Four buttons, two by two:
// each is one tap, nothing hides behind a second choice, and the labels fit
// on one line at 390 px. Images only, as Photo: a capture is a photo.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ImagePlus, Mic, Type, X, Loader2, Check, Inbox, Square } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { prepareFile } from './attachments'
import { canListen, listen } from '@/lib/speech'
import { useVenueWords } from './venueWords'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { photoCapture } from '../../lib/officeApp'

const NOTE_MAX = 2000
const btn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50'
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

export default function CaptureButton({ venueId = null, className, shared = null, onSharedDone }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(null)
  const [initial, setInitial] = useState(null)
  // Something shared to the app: open the window with it (each share its own window).
  useEffect(() => {
    if (!shared) return
    setInitial(shared); setOpen(true); setDone(null)
    onSharedDone?.()
  }, [shared])   // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); setInitial(null) }
  return (
    <>
      <button type="button" onClick={() => { setInitial(null); setOpen(true); setDone(null) }} data-testid="capture-open"
        className={cn('w-full flex items-center gap-3 rounded-xl border bg-background px-4 min-h-[56px] text-left touch-manipulation hover:bg-accent', className)}>
        <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Inbox className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">Capture</span>
          <span className="block text-xs text-muted-foreground truncate">
            {done || 'A photo, a voice note or a line, kept for For review'}
          </span>
        </span>
      </button>
      {open && <CaptureSheet key={initial?.key || 'own'} venueId={venueId} initial={initial} onClose={close} onSaved={text => { close(); setDone(text) }} />}
    </>
  )
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']
const NOT_A_PHOTO = 'Capture keeps a photo (JPEG, PNG, GIF or WebP). That file isn\'t one, so it wasn\'t added.'

function CaptureSheet({ venueId, initial = null, onClose, onSaved }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [venue, setVenue] = useState(venueId || '')
  const [mode, setMode] = useState(null)        // 'photo' | 'voice' | 'text'
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)      // { file, preview, from: 'camera' | 'phone' | 'shared' }
  const [hearing, setHearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)   // not an error: e.g. only the first of several shared pictures was kept
  const stop = useRef(null)
  const fileRef = useRef(null)
  const phoneRef = useRef(null)
  const words = useVenueWords(venue || null)
  useEffect(() => { if (!venue && venues.length) setVenue(venues[0].id) }, [venues, venue])
  const preview = useRef(null)
  useEffect(() => () => { stop.current?.(); if (preview.current) URL.revokeObjectURL(preview.current) }, [])

  /** A photo from the camera, the phone or a share: shrunk (prepareFile()) and shown; the server checks it again. */
  async function takePhoto(f, from) {
    setError(null)
    if (!f) return
    if (f.type ? !PHOTO_TYPES.includes(f.type.toLowerCase()) : !/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name || '')) { setError(NOT_A_PHOTO); return }
    try {
      const file = await prepareFile(f)
      if (preview.current) URL.revokeObjectURL(preview.current)
      preview.current = URL.createObjectURL(file)
      setPhoto({ file, preview: preview.current, from })
      setMode('photo')
    } catch (err) { setError(errText(err)) }
  }

  function pickPhoto(e, from) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) { setNotice(null); takePhoto(f, from) }
  }

  // Shared to the app: a picture as the photo, words as a typed note, anything else a polite no.
  useEffect(() => {
    if (!initial) return
    if (initial.kind === 'image') {
      takePhoto(initial.file, 'shared')
      if (initial.more > 0) setNotice('You shared ' + (initial.more + 1) + ' pictures: the first is here. A capture keeps one photo, so share the others one at a time.')
    } else if (initial.kind === 'text') {
      setMode('text'); setNote(String(initial.text || '').slice(0, NOTE_MAX))
    } else if (initial.kind === 'refused') {
      setError(initial.message)
    }
  }, [initial])   // eslint-disable-line react-hooks/exhaustive-deps

  function talk() {
    if (hearing) { stop.current?.(); return }
    setMode('voice'); setError(null); setHearing(true)
    const start = note ? note + ' ' : ''
    stop.current = listen({
      hints: words.hints,
      onText: t => setNote((start + words.fix(t)).slice(0, NOTE_MAX)),
      onEnd: () => setHearing(false),
      onError: m => { setError(m); setHearing(false) },
    })
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      let saved
      if (mode === 'photo') saved = await api.upload('/ai/captures', photo.file, { venue_id: venue, note: note.trim() || null })
      else saved = await api.post('/ai/captures', { venue_id: venue, kind: mode, note: note.trim() })
      qc.invalidateQueries({ queryKey: ['ai-review'] })
      qc.invalidateQueries({ queryKey: ['ai-review-count'] })
      onSaved('Kept for For review at ' + (saved.venue_name || 'the venue'))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = venue && !busy && !hearing && (mode === 'photo' ? !!photo : !!note.trim())
  return (
    <div className="fixed inset-0 z-[55] bg-black/40 flex items-end sm:items-center justify-center p-3" data-testid="capture-sheet">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="section-head px-4 py-3 flex items-center gap-2">
          <h2 className="text-base font-semibold flex-1">Capture</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 -mr-2 flex items-center justify-center rounded-lg touch-manipulation hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Kept as it is, with your name and the time, on For review. Nothing reads it until someone opens it in {ASSISTANT_NAME}.
          </p>
          {venues.length > 1 && (
            <label className="block text-sm font-medium">Venue
              <select value={venue} onChange={e => setVenue(e.target.value)} data-testid="capture-venue"
                className="mt-1 w-full min-h-[48px] rounded-lg border bg-background px-3 text-sm touch-manipulation">
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} data-testid="capture-photo"
              className={cn(btn, 'flex-col h-16 gap-1', mode === 'photo' && photo?.from !== 'phone' && 'border-primary bg-primary/5')}>
              <Camera className="w-5 h-5" /> Photo
            </button>
            <button type="button" onClick={() => phoneRef.current?.click()} data-testid="capture-from-phone"
              className={cn(btn, 'flex-col h-16 gap-1', mode === 'photo' && photo?.from === 'phone' && 'border-primary bg-primary/5')}>
              <ImagePlus className="w-5 h-5" /> From phone
            </button>
            <button type="button" onClick={talk} disabled={!canListen()} data-testid="capture-voice"
              className={cn(btn, 'flex-col h-16 gap-1', mode === 'voice' && 'border-primary bg-primary/5', hearing && 'bg-red-50 border-red-400 text-red-800')}>
              {hearing ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />} {hearing ? 'Stop' : 'Voice note'}
            </button>
            <button type="button" onClick={() => { setMode('text'); setError(null) }} data-testid="capture-text"
              className={cn(btn, 'flex-col h-16 gap-1', mode === 'text' && 'border-primary bg-primary/5')}>
              <Type className="w-5 h-5" /> Type
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture={photoCapture()} className="hidden" onChange={e => pickPhoto(e, 'camera')} data-testid="capture-photo-input" />
          {/* No capture: the phone's picker (gallery and files), in the app and in a browser. */}
          <input ref={phoneRef} type="file" accept="image/*" className="hidden" onChange={e => pickPhoto(e, 'phone')} data-testid="capture-from-phone-input" />
          {notice && <p className="text-sm text-muted-foreground" data-testid="capture-notice">{notice}</p>}
          {mode === 'photo' && photo && <img src={photo.preview} alt="The photo to keep" className="w-full max-h-64 object-contain rounded-lg border" />}
          {mode && (
            <label className="block text-sm font-medium">
              {mode === 'photo' ? 'A line about it (if you like)' : mode === 'voice' ? 'What you said (check it, change it if needed)' : 'What to keep'}
              <textarea value={note} onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))} rows={3} data-testid="capture-note"
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation" />
            </label>
          )}
          {error && <p className="text-sm text-destructive" role="alert" data-testid="capture-error">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={!ready} className={cn(btnPrimary, 'flex-1')} data-testid="capture-save">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Keep for review
            </button>
            <button type="button" onClick={onClose} className={btn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
