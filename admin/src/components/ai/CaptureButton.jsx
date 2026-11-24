// src/components/ai/CaptureButton.jsx
//
// Capture to For review (Pepper-first step 6b, migration 281): on the phone
// pages (and so in the Macaroonie Office app), one button that keeps a photo
// (a delivery note, an invoice, a broken door), a voice note's words or a
// typed line for later, with who, when and the venue. Nothing reads it now
// (no model call): it waits on For review until someone opens it in Pepper.
// Photos are shrunk on the phone first (prepareFile()) and checked by the
// server like a chat file (5 MB, JPEG / PNG / GIF / WebP).

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Mic, Type, X, Loader2, Check, Inbox, Square } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { prepareFile } from './attachments'
import { canListen, listen } from '@/lib/speech'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const NOTE_MAX = 2000
const btn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50'
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

export default function CaptureButton({ venueId = null, className }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(null)
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(null) }} data-testid="capture-open"
        className={cn('w-full flex items-center gap-3 rounded-xl border bg-background px-4 min-h-[56px] text-left touch-manipulation hover:bg-accent', className)}>
        <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Inbox className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">Capture</span>
          <span className="block text-xs text-muted-foreground truncate">
            {done || 'A photo, a voice note or a line, kept for For review'}
          </span>
        </span>
      </button>
      {open && <CaptureSheet venueId={venueId} onClose={() => setOpen(false)} onSaved={text => { setOpen(false); setDone(text) }} />}
    </>
  )
}

function CaptureSheet({ venueId, onClose, onSaved }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [venue, setVenue] = useState(venueId || '')
  const [mode, setMode] = useState(null)        // 'photo' | 'voice' | 'text'
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)      // { file, preview }
  const [hearing, setHearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const stop = useRef(null)
  const fileRef = useRef(null)
  useEffect(() => { if (!venue && venues.length) setVenue(venues[0].id) }, [venues, venue])
  useEffect(() => () => { stop.current?.(); if (photo?.preview) URL.revokeObjectURL(photo.preview) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(null)
    try {
      const file = await prepareFile(f)
      setPhoto({ file, preview: URL.createObjectURL(file) })
      setMode('photo')
    } catch (err) { setError(errText(err)) }
  }

  function talk() {
    if (hearing) { stop.current?.(); return }
    setMode('voice'); setError(null); setHearing(true)
    const start = note ? note + ' ' : ''
    stop.current = listen({
      onText: t => setNote((start + t).slice(0, NOTE_MAX)),
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
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} data-testid="capture-photo"
              className={cn(btn, 'flex-col h-20', mode === 'photo' && 'border-primary bg-primary/5')}>
              <Camera className="w-5 h-5" /> Photo
            </button>
            <button type="button" onClick={talk} disabled={!canListen()} data-testid="capture-voice"
              className={cn(btn, 'flex-col h-20', mode === 'voice' && 'border-primary bg-primary/5', hearing && 'bg-red-50 border-red-400 text-red-800')}>
              {hearing ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />} {hearing ? 'Stop' : 'Voice note'}
            </button>
            <button type="button" onClick={() => { setMode('text'); setError(null) }} data-testid="capture-text"
              className={cn(btn, 'flex-col h-20', mode === 'text' && 'border-primary bg-primary/5')}>
              <Type className="w-5 h-5" /> Type
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
          {mode === 'photo' && photo && <img src={photo.preview} alt="The photo to keep" className="w-full max-h-64 object-contain rounded-lg border" />}
          {mode && (
            <label className="block text-sm font-medium">
              {mode === 'photo' ? 'A line about it (if you like)' : mode === 'voice' ? 'What you said (check it, change it if needed)' : 'What to keep'}
              <textarea value={note} onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))} rows={3} data-testid="capture-note"
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation" />
            </label>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
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
