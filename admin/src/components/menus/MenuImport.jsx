// src/components/menus/MenuImport.jsx
//
// A new menu from photos or a PDF (Menus > From a photo or PDF, and the venue
// setup wizard's Menu step). Three steps in one panel:
//   1. Add the files (drop, choose, or take photos on a phone or tablet).
//      Photos are shrunk here (prepareFile()); PDFs go as they are.
//   2. Pepper reads them (POST /api/ai/menus/read, about a minute); the
//      person checks what was read: the menu's name and venue, each section
//      and dish (name, price, description), and removes anything wrong.
//   3. Make the menu (POST /api/ai/menus/import): a draft, not live until
//      published, with allergens and option groups matched to the group's own.
//
//   <MenuImport venues={venues} venueId={id|null} onCreated={result => ...} onCancel={...} />
//   <MenuImportModal ... />  the same in a window

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronDown, FileText, Loader2, Plus, Sparkles, Trash2, TriangleAlert, Upload, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FileDropArea } from '@/components/FileDropArea'
import { useAiStatus } from '@/components/ai/ChatView'
import { prepareFile, sizeText } from '@/components/ai/attachments'
import { Field, Input, TextArea, Btn, PriceInput } from '@/components/menus/shared'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,.pdf'
const MAX_FILES = 10
const errText = e => e?.body?.error || e?.message || 'Something went wrong'
let nextKey = 1
const key = () => 'k' + nextKey++

const money = p => (p == null ? '' : '£' + Number(p).toFixed(2))

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(new Error(file.name + ' couldn\'t be read here.'))
    r.readAsDataURL(file)
  })
}

/** Elapsed seconds while busy. */
function useElapsed(on) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!on) { setS(0); return undefined }
    const t0 = Date.now()
    const id = setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [on])
  return s
}

const withKeys = sections => sections.map(s => ({ ...s, key: key(), open: true, dishes: s.dishes.map(d => ({ ...d, key: key() })) }))

function dishExtras(d) {
  const parts = []
  for (const o of d.options || []) {
    parts.push(o.group + ': ' + o.choices.map(c => c.name + (c.price != null ? ' ' + (o.mode === 'extra' ? '+' : '') + money(c.price) : '')).join(', '))
  }
  if (d.allergens?.length) parts.push('Allergens: ' + d.allergens.map(a => a.name + (a.level === 'may_contain' ? ' (may contain)' : a.level === 'removable' ? ' (can be removed)' : '')).join(', '))
  if (d.dietary?.length) parts.push(d.dietary.join(', '))
  if (d.calories) parts.push(d.calories + ' kcal')
  return parts
}

function DishRow({ d, onChange, onRemove }) {
  const [more, setMore] = useState(false)
  const extras = dishExtras(d)
  return (
    <li className="py-2 space-y-1.5" data-testid="mi-dish">
      <div className="flex items-center gap-2">
        <Input value={d.name} onChange={e => onChange({ name: e.target.value })} aria-label="Dish name" className="flex-1 min-w-0" />
        {!(d.options || []).some(o => o.mode === 'base') && (
          <PriceInput pence={d.price != null ? Math.round(d.price * 100) : null} aria-label={'Price of ' + d.name}
            onChange={p => onChange({ price: p == null ? undefined : p / 100 })} className="w-24 shrink-0" placeholder="Price" />
        )}
        <button type="button" onClick={() => setMore(m => !m)} aria-label={more ? 'Less' : 'Description'} aria-expanded={more}
          className="w-11 h-11 shrink-0 rounded-md border flex items-center justify-center touch-manipulation">
          <ChevronDown className={cn('w-4 h-4 transition-transform', more && 'rotate-180')} />
        </button>
        <button type="button" onClick={onRemove} aria-label={'Remove ' + d.name}
          className="w-11 h-11 shrink-0 rounded-md border flex items-center justify-center text-destructive touch-manipulation">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {(more || d.description) && (more
        ? <TextArea rows={2} value={d.description || ''} onChange={e => onChange({ description: e.target.value || undefined })} aria-label={'Description of ' + d.name} />
        : <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>)}
      {extras.length > 0 && <p className="text-[11px] text-muted-foreground">{extras.join(' · ')}</p>}
    </li>
  )
}

export function MenuImport({ venues = [], venueId = null, hideVenue = false, onCreated, onCancel, className }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: ai } = useAiStatus()
  const canAi = !!ai?.can_chat

  const [files, setFiles] = useState([])         // { key, file, preview }
  const [hint, setHint] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)       // { name, tagline, service_times, venue_id, sections, notes }
  const [making, setMaking] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const elapsed = useElapsed(reading)

  useEffect(() => () => files.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(list) {
    setError(null)
    const room = MAX_FILES - files.length
    if (room <= 0) { setError('Up to ' + MAX_FILES + ' files at a time.'); return }
    const next = []
    for (const f of [...list].slice(0, room)) {
      if (!/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setError(f.name + ' isn\'t a photo or a PDF.'); continue }
      const ready = await prepareFile(f)
      next.push({ key: key(), file: ready, preview: /^image\//.test(ready.type) ? URL.createObjectURL(ready) : null })
    }
    setFiles(fs => [...fs, ...next])
  }

  async function read() {
    setReading(true)
    setError(null)
    try {
      const payload = []
      for (const f of files) payload.push({ name: f.file.name, data: await readBase64(f.file) })
      const res = await api.post('/ai/menus/read', { files: payload, hint: hint.trim(), venue_id: venueId || null })
      if (!res?.menu?.sections) throw new Error(ASSISTANT_NAME + '\'s answer didn\'t arrive. Try again.')
      setDraft({ ...res.menu, venue_id: venueId || '', sections: withKeys(res.menu.sections), notes: res.notes || '' })
    } catch (e) {
      setError(errText(e))
    } finally {
      setReading(false)
    }
  }

  const counts = useMemo(() => draft ? {
    sections: draft.sections.length,
    dishes: draft.sections.reduce((n, s) => n + s.dishes.length, 0),
    unpriced: draft.sections.reduce((n, s) => n + s.dishes.filter(d => d.price == null && !(d.options || []).some(o => o.mode === 'base')).length, 0),
  } : null, [draft])

  const setSection = (sk, patch) => setDraft(d => ({ ...d, sections: d.sections.map(s => (s.key === sk ? { ...s, ...patch } : s)) }))
  const setDish = (sk, dk, patch) => setDraft(d => ({
    ...d, sections: d.sections.map(s => (s.key === sk ? { ...s, dishes: s.dishes.map(x => (x.key === dk ? { ...x, ...patch } : x)) } : s)),
  }))

  async function make() {
    setMaking(true)
    setError(null)
    try {
      const sections = draft.sections.filter(s => s.dishes.length).map(s => ({
        section: s.section.trim() || 'Menu', ...(s.subtitle ? { subtitle: s.subtitle } : {}),
        dishes: s.dishes.filter(x => x.name.trim()).map(({ key: _k, ...x }) => ({ ...x, name: x.name.trim() })),
      }))
      const res = await api.post('/ai/menus/import', {
        name: draft.name.trim(), venue_id: draft.venue_id || null,
        tagline: draft.tagline || undefined, service_times: draft.service_times || undefined, sections,
      })
      qc.invalidateQueries({ queryKey: ['menus'] })
      setResult(res)
      onCreated?.(res)
    } catch (e) {
      setError(errText(e))
    } finally {
      setMaking(false)
    }
  }

  if (!canAi && ai) {
    return (
      <div className={cn('rounded-lg border bg-muted/30 p-4 text-sm', className)} data-testid="mi-no-ai">
        Reading a menu from a file needs {ASSISTANT_NAME}, which isn&apos;t available
        {ai.configured === false ? ' on this server' : !ai.enabled ? ' (switched off for your group, ' + ASSISTANT_NAME + ' > Settings)' : ' to your role'}.
        You can still make the menu by hand on the Menus page.
      </div>
    )
  }

  if (result) {
    return (
      <div className={cn('space-y-3', className)} data-testid="mi-done">
        <p className="text-sm">
          <strong>{result.name}</strong> is made with {result.dishes} {result.dishes === 1 ? 'dish' : 'dishes'} in {result.sections} {result.sections === 1 ? 'section' : 'sections'}.
          It&apos;s a draft: check it on the Menus page, add photos, then publish it.
        </p>
        {(result.new_option_groups?.length > 0 || result.warnings?.length > 0) && (
          <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
            {(result.warnings || []).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    )
  }

  if (!draft) {
    return (
      <div className={cn('space-y-3', className)} data-testid="mi-files">
        <FileDropArea onFiles={add} onRefused={setError} disabled={reading} kinds={['image', 'pdf']} label="Drop to add">
          <div className="rounded-lg border border-dashed bg-muted/20 p-3">
            {files.length === 0 ? (
              <div className="h-28 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1">
                <FileText className="w-6 h-6" />
                <span>Drop photos or a PDF of the menu here</span>
                <span className="text-xs">Several pages are fine: add them in order.</span>
              </div>
            ) : (
              <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2" data-testid="mi-file-list">
                {files.map((f, i) => (
                  <li key={f.key} className="relative rounded-md border bg-background overflow-hidden aspect-[3/4] flex items-center justify-center">
                    {f.preview
                      ? <img src={f.preview} alt={'Page ' + (i + 1)} className="w-full h-full object-cover" draggable={false} />
                      : <span className="text-xs text-center px-1 break-all"><FileText className="w-5 h-5 mx-auto mb-1" />{f.file.name}</span>}
                    <span className="absolute left-1 bottom-1 text-[10px] bg-background/90 rounded px-1">{i + 1} · {sizeText(f.file.size)}</span>
                    <button type="button" onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} aria-label={'Remove ' + f.file.name} disabled={reading}
                      className="absolute top-1 right-1 w-8 h-8 rounded-full bg-background/90 border flex items-center justify-center touch-manipulation">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FileDropArea>
        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only" data-testid="mi-file-input"
          onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
        <div className="flex flex-wrap gap-2 relative">
          <Btn variant="secondary" onClick={() => fileRef.current?.click()} disabled={reading}><Upload className="w-4 h-4" /> Choose files</Btn>
          {IS_TOUCH && <Btn variant="secondary" onClick={() => camRef.current?.click()} disabled={reading}><Camera className="w-4 h-4" /> Take a photo</Btn>}
        </div>
        <Field label="Anything to know? (optional)" hint="e.g. Only the dinner pages; prices are for eat in.">
          <Input value={hint} onChange={e => setHint(e.target.value.slice(0, 1000))} disabled={reading} data-testid="mi-hint" />
        </Field>
        {error && <p className="text-sm text-destructive" role="alert" data-testid="mi-error">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel && <Btn variant="secondary" onClick={onCancel} disabled={reading}>Cancel</Btn>}
          <Btn onClick={read} disabled={!files.length || reading} data-testid="mi-read">
            {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {reading ? ASSISTANT_NAME + ' is reading the menu… ' + elapsed + 's' : 'Read the menu with ' + ASSISTANT_NAME}
          </Btn>
        </div>
        {reading && <p className="text-xs text-muted-foreground text-right">A long menu takes a minute or two.</p>}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="mi-review">
      <p className="text-sm">
        {ASSISTANT_NAME} read {counts.dishes} {counts.dishes === 1 ? 'dish' : 'dishes'} in {counts.sections} {counts.sections === 1 ? 'section' : 'sections'}.
        Check the names and prices, remove anything that isn&apos;t right, then make the menu.
        {counts.unpriced > 0 && <> <span className="text-amber-800">{counts.unpriced} without a price.</span></>}
      </p>
      {draft.notes && (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex gap-2" data-testid="mi-notes">
          <TriangleAlert className="w-4 h-4 shrink-0" />{draft.notes}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Menu name"><Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="mi-name" /></Field>
        {!hideVenue && (
          <Field label="For">
            <select value={draft.venue_id} onChange={e => setDraft(d => ({ ...d, venue_id: e.target.value }))}
              className="w-full h-11 border rounded-md px-3 text-sm bg-background" data-testid="mi-venue">
              <option value="">All venues</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Tagline (optional)"><Input value={draft.tagline || ''} onChange={e => setDraft(d => ({ ...d, tagline: e.target.value }))} /></Field>
        <Field label="Served (optional)"><Input value={draft.service_times || ''} onChange={e => setDraft(d => ({ ...d, service_times: e.target.value }))} placeholder="e.g. Mon-Sat 5-10pm" /></Field>
      </div>
      <div className="space-y-3">
        {draft.sections.map(s => (
          <div key={s.key} className="border rounded-lg" data-testid="mi-section">
            <div className="flex items-center gap-2 px-3 py-2 section-head">
              <Input value={s.section} onChange={e => setSection(s.key, { section: e.target.value })} aria-label="Section title" className="flex-1 min-w-0 font-medium" />
              <span className="text-xs text-muted-foreground shrink-0">{s.dishes.length}</span>
              <button type="button" onClick={() => setSection(s.key, { open: !s.open })} aria-label={s.open ? 'Fold' : 'Open'} aria-expanded={s.open}
                className="w-11 h-11 shrink-0 rounded-md border bg-background flex items-center justify-center touch-manipulation">
                <ChevronDown className={cn('w-4 h-4 transition-transform', s.open && 'rotate-180')} />
              </button>
              <button type="button" onClick={() => setDraft(d => ({ ...d, sections: d.sections.filter(x => x.key !== s.key) }))} aria-label={'Remove the section ' + s.section}
                className="w-11 h-11 shrink-0 rounded-md border bg-background flex items-center justify-center text-destructive touch-manipulation">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {s.open && (
              <ul className="divide-y px-3">
                {s.dishes.map(d => (
                  <DishRow key={d.key} d={d} onChange={patch => setDish(s.key, d.key, patch)}
                    onRemove={() => setSection(s.key, { dishes: s.dishes.filter(x => x.key !== d.key) })} />
                ))}
                <li className="py-2">
                  <button type="button" onClick={() => setSection(s.key, { dishes: [...s.dishes, { key: key(), name: '', allergens: [], dietary: [], options: [] }] })}
                    className="min-h-[44px] px-3 rounded-md border text-sm inline-flex items-center gap-1.5 touch-manipulation">
                    <Plus className="w-4 h-4" /> Add a dish
                  </button>
                </li>
              </ul>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-destructive" role="alert" data-testid="mi-error">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Btn variant="secondary" onClick={() => { setDraft(null); setError(null) }} disabled={making}>Read other files</Btn>
        <Btn onClick={make} disabled={making || !draft.name.trim() || !counts.dishes} data-testid="mi-make">
          {making && <Loader2 className="w-4 h-4 animate-spin" />} Make the menu
        </Btn>
      </div>
    </div>
  )
}

export function MenuImportModal({ onClose, onCreated, ...props }) {
  const [done, setDone] = useState(null)
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="New menu from a photo or PDF">
      <div className="w-full sm:max-w-3xl bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[90vh]">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold flex-1">New menu from a photo or PDF</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 -mr-2 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[85vh] p-4">
          <MenuImport {...props} onCancel={onClose} onCreated={r => setDone(r)} />
          {done && (
            <div className="flex justify-end gap-2 mt-3">
              <Btn variant="secondary" onClick={onClose}>Close</Btn>
              <Btn onClick={() => onCreated?.(done)} data-testid="mi-open">Open the menu</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
