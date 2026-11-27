// src/components/recipes/RecipeReader.jsx
//
// Read recipes in (inventory phase 3, docs/INVENTORY.md 5.6): the Recipes
// page's "Read recipes" (Recipes manage), loaded on its own (React.lazy).
// Three steps:
//   1. What to read: photos of recipe cards (taken with the phone's camera
//      in the office app or a browser), PDFs, a spreadsheet (Excel or CSV),
//      or text pasted in. One file can hold several recipes.
//   2. Pepper reads them (POST /api/ai/recipes/read, up to a minute or two).
//   3. The review: each recipe read with its lines, each line's match
//      (matched, suggested, not found) with the words read. The person
//      accepts a suggestion or picks an item or prep recipe, adds a missing
//      item to the inventory in place (Purchasing setup manage), leaves a line
//      out, unticks a recipe, and makes the drafts (POST /api/recipes/drafts).
//      Nothing is guessed: a line not matched goes into the recipe's notes in
//      the words read. Drafts Pepper read are costed as partly costed ("not
//      checked yet") until someone makes them live.
//
//   <RecipeReader onClose={() => ...} onOpen={id => ...} />

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, Check, ChevronDown, FileText, Loader2, Package, ChefHat, Plus, Sparkles, TriangleAlert, Upload, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { prepareFile, sizeText } from '@/components/ai/attachments'
import { Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { KindBadge, unitLabel, usePickers } from './shared'
import { UNITS } from '@shared/procurement.js'
import { YIELD_UNITS, unitChoices, recipeUnitChoices } from '@shared/costing.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { photoCapture } from '../../lib/officeApp'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,.pdf,.xlsx,.xls,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
const MAX_FILES = 10
const MAX_TEXT = 60000
const errText = e => e?.body?.error || e?.message || 'Something went wrong'
let seq = 1
const key = () => 'r' + seq++

const okFile = f => /^image\//.test(f.type) || f.type === 'application/pdf' || /\.(pdf|xlsx|xls|csv|tsv|txt)$/i.test(f.name)

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(new Error(file.name + ' couldn\'t be read here.'))
    r.readAsDataURL(file)
  })
}

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

/** The standard unit an item kept in this unit's kind is kept in (a new item's "counted in"). */
const baseFor = unit => (UNITS[unit]?.kind === 'mass' ? 'g' : UNITS[unit]?.kind === 'volume' ? 'ml' : 'each')

/** The reading as the review holds it: keys, a tick per recipe, a state per line. */
function toDraft(read) {
  const keys = read.recipes.map(() => key())
  return read.recipes.map((r, i) => ({
    ...r, key: keys[i], keep: true, open: true,
    lines: r.lines.map(l => ({
      ...l, key: key(), out: false,
      // A recipe of this reading is named by its key, so unticking it can be seen.
      match: l.match.kind === 'new' ? { ...l.match, new_key: keys[l.match.new_idx] } : l.match,
    })),
  }))
}

/** A line is saved as a line only when it is matched (or picked) and has a quantity. */
function lineReady(l, draft) {
  if (l.out || !(Number(l.qty) > 0)) return false
  const m = l.match
  if (m.state !== 'matched') return false
  if (m.kind === 'new') return !!draft.find(r => r.key === m.new_key && r.keep && r.kind === 'prep')
  return m.kind === 'item' || m.kind === 'recipe'
}

/** POST /recipes/drafts's body from the review. */
export function draftsBody(draft) {
  return {
    source: 'reader',
    recipes: draft.filter(r => r.keep && r.name.trim()).map(r => ({
      key: r.key, name: r.name.trim(), kind: r.kind, category: r.category || null, code: r.code || null,
      portions: r.kind === 'dish' ? (Number(r.portions) > 0 ? Number(r.portions) : 1) : null,
      yield_qty: r.kind === 'prep' && Number(r.yield_qty) > 0 && r.yield_unit ? Number(r.yield_qty) : null,
      yield_unit: r.kind === 'prep' && Number(r.yield_qty) > 0 && r.yield_unit ? r.yield_unit : null,
      loss_pct: r.kind === 'prep' ? Number(r.loss_pct || 0) : 0,
      method: r.method || null, notes: r.notes || null,
      lines: r.lines.filter(l => lineReady(l, draft)).map(l => ({
        ...(l.match.kind === 'item' ? { item_id: l.match.item_id } : l.match.kind === 'recipe' ? { sub_recipe_id: l.match.sub_recipe_id } : { new_key: l.match.new_key }),
        qty: Number(l.qty), unit: String(l.unit || 'each').trim() || 'each', note: l.note || null,
      })),
      left_out: r.lines.filter(l => !lineReady(l, draft)).map(l => l.words),
    })),
  }
}

export default function RecipeReader({ onClose, onOpen }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status'), staleTime: 60_000 })
  const { data: pickers } = usePickers()
  const setup = usePermission('purchasing_setup')
  const [files, setFiles] = useState([])
  const [text, setText] = useState('')
  const [hint, setHint] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(null)
  const [read, setRead] = useState(null)       // { notes, counts, items_listed, items_total }
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [made, setMade] = useState(null)
  const [over, setOver] = useState(false)
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const elapsed = useElapsed(reading)
  const canAi = !!ai?.can_chat

  useEffect(() => () => files.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(list) {
    setError(null)
    const room = MAX_FILES - files.length
    if (room <= 0) { setError('Up to ' + MAX_FILES + ' files at a time.'); return }
    const next = []
    for (const f of [...list].slice(0, room)) {
      if (!okFile(f)) { setError(f.name + ' isn\'t a photo, a PDF or a spreadsheet.'); continue }
      const ready = /^image\//.test(f.type) ? await prepareFile(f) : f
      next.push({ key: key(), file: ready, preview: /^image\//.test(ready.type) ? URL.createObjectURL(ready) : null })
    }
    setFiles(fs => [...fs, ...next])
  }

  async function doRead() {
    setReading(true)
    setError(null)
    try {
      const payload = []
      for (const f of files) payload.push({ name: f.file.name, data: await readBase64(f.file) })
      const res = await api.post('/ai/recipes/read', { files: payload, text: text.trim(), hint: hint.trim() })
      if (!Array.isArray(res?.recipes)) throw new Error(ASSISTANT_NAME + '\'s answer didn\'t arrive. Try again.')
      setRead({ notes: res.notes, counts: res.counts, items_listed: res.items_listed, items_total: res.items_total })
      setDraft(toDraft(res))
    } catch (e) {
      setError(errText(e))
    } finally {
      setReading(false)
    }
  }

  const setRecipe = (rk, patch) => setDraft(d => d.map(r => (r.key === rk ? { ...r, ...patch } : r)))
  const setLine = (rk, lk, patch) => setDraft(d => d.map(r => (r.key === rk ? { ...r, lines: r.lines.map(l => (l.key === lk ? { ...l, ...patch } : l)) } : r)))
  // An item added to the inventory here: every line not matched with the same words takes it too.
  const takeNewItem = (item, what) => setDraft(d => d.map(r => ({
    ...r,
    lines: r.lines.map(l => (l.match.state !== 'matched' && l.what.trim().toLowerCase() === what.trim().toLowerCase()
      ? { ...l, match: { state: 'matched', kind: 'item', item_id: item.id, name: item.name, how: 'added' }, unit_problem: null }
      : l)),
  })))

  const summary = useMemo(() => {
    if (!draft) return null
    const kept = draft.filter(r => r.keep)
    const lines = kept.flatMap(r => r.lines)
    return {
      recipes: kept.length,
      ready: lines.filter(l => lineReady(l, draft)).length,
      out: lines.filter(l => !lineReady(l, draft)).length,
      unnamed: kept.some(r => !r.name.trim()),
    }
  }, [draft])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await api.post('/recipes/drafts', draftsBody(draft))
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe-pickers'] })
      qc.invalidateQueries({ queryKey: ['recipe-coverage'] })
      setMade(res.made)
    } catch (e) {
      setError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <button type="button" className={cn(btn.outline, 'h-12')} onClick={onClose} data-testid="reader-back"><ArrowLeft className="w-4 h-4" />Recipes</button>
  )

  if (ai && !canAi) {
    return (
      <div className="space-y-4">
        {back}
        <Card title="Read recipes">
          <p className="text-sm" data-testid="reader-no-ai">
            Reading recipes needs {ASSISTANT_NAME}, which isn&apos;t available
            {ai.configured === false ? ' on this server' : !ai.enabled ? ' (switched off for your group, ' + ASSISTANT_NAME + ' > Settings)' : ' to your role'}.
            You can still type recipes in with New recipe.
          </p>
        </Card>
      </div>
    )
  }

  if (made) {
    return (
      <div className="space-y-4" data-testid="reader-done">
        {back}
        <Card title={made.length + (made.length === 1 ? ' draft recipe made' : ' draft recipes made')}>
          <p className="text-sm mb-3">
            Each is a draft: it shows as partly costed (not checked yet) until someone opens it, checks what {ASSISTANT_NAME} read, and makes it live.
            Lines that weren&apos;t matched are in each recipe&apos;s notes.
          </p>
          <ul className="divide-y rounded-lg border">
            {made.map(m => (
              <li key={m.id}>
                <button type="button" onClick={() => onOpen(m.id)} className="w-full text-left px-3 min-h-[48px] flex items-center gap-2 hover:bg-muted touch-manipulation" data-testid="reader-made">
                  <span className="flex-1 text-sm font-medium">{m.name}</span>
                  <KindBadge kind={m.kind} />
                  <span className="text-xs text-muted-foreground">Open</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="space-y-4 max-w-3xl" data-testid="reader-files">
        {back}
        <Card title={'Read recipes with ' + ASSISTANT_NAME}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Photos of recipe cards, a PDF, a spreadsheet (Excel or CSV) or text pasted below. One file can hold several recipes.
              {' '}{ASSISTANT_NAME} matches each line to your inventory items and prep recipes; you check everything before anything is made.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); add([...(e.dataTransfer.files || [])]) }}
              className={cn('rounded-lg border border-dashed bg-muted/20 p-3', over && 'border-primary bg-primary/10')}>
              {files.length === 0 ? (
                <div className="h-28 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1">
                  <FileText className="w-6 h-6" />
                  <span>Drop photos, a PDF or a spreadsheet here</span>
                </div>
              ) : (
                <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2" data-testid="reader-file-list">
                  {files.map((f, i) => (
                    <li key={f.key} className="relative rounded-md border bg-background overflow-hidden aspect-[3/4] flex items-center justify-center">
                      {f.preview
                        ? <img src={f.preview} alt={'Page ' + (i + 1)} className="w-full h-full object-cover" draggable={false} />
                        : <span className="text-xs text-center px-1 break-all"><FileText className="w-5 h-5 mx-auto mb-1" />{f.file.name}</span>}
                      <span className="absolute left-1 bottom-1 text-[10px] bg-background/90 rounded px-1">{i + 1} · {sizeText(f.file.size)}</span>
                      <button type="button" onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} aria-label={'Remove ' + f.file.name} disabled={reading}
                        className="absolute top-1 right-1 w-11 h-11 rounded-full bg-background/90 border flex items-center justify-center touch-manipulation">
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only" data-testid="reader-file-input"
              onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
            <input ref={camRef} type="file" accept="image/*" capture={photoCapture()} className="sr-only" data-testid="reader-camera-input"
              onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => fileRef.current?.click()} disabled={reading} data-testid="reader-choose">
                <Upload className="w-4 h-4" />Choose files
              </button>
              {IS_TOUCH && (
                <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => camRef.current?.click()} disabled={reading} data-testid="reader-photo">
                  <Camera className="w-4 h-4" />Take a photo
                </button>
              )}
            </div>
            <Field label="Or paste recipes" hint="As they are written: a name, then each ingredient on its own line">
              <textarea rows={6} className={cn(inputCls, 'h-auto py-2')} value={text} maxLength={MAX_TEXT} disabled={reading}
                onChange={e => setText(e.target.value)} placeholder={'Burger sauce (makes 1 litre)\n600 ml mayonnaise\n200 g gherkins, chopped\n...'} data-testid="reader-text" />
            </Field>
            <Field label="Anything to know? (optional)" hint="e.g. The quantities are for 10 portions; only the mains.">
              <input className={cn(inputCls, 'h-12')} value={hint} maxLength={1000} onChange={e => setHint(e.target.value)} disabled={reading} data-testid="reader-hint" />
            </Field>
            {error && <p className="text-sm text-destructive" role="alert" data-testid="reader-error">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={cn(btn.primary, 'h-12')} onClick={doRead} disabled={(!files.length && !text.trim()) || reading} data-testid="reader-read">
                {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {reading ? ASSISTANT_NAME + ' is reading… ' + elapsed + 's' : 'Read with ' + ASSISTANT_NAME}
              </button>
            </div>
            {reading && <p className="text-xs text-muted-foreground text-right">A long sheet takes a minute or two.</p>}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="reader-review">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <h2 className="text-lg font-semibold flex-1 min-w-[10rem]">Check what {ASSISTANT_NAME} read</h2>
      </div>
      <p className="text-sm">
        {read.counts.recipes} {read.counts.recipes === 1 ? 'recipe' : 'recipes'} with {read.counts.lines} lines: {read.counts.matched} matched,
        {' '}{read.counts.suggested} suggested, {read.counts.not_found} not found. Accept or pick what each line is, untick a recipe you don&apos;t want, then make the drafts.
      </p>
      {read.notes && (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex gap-2" data-testid="reader-notes">
          <TriangleAlert className="w-4 h-4 shrink-0" />{read.notes}
        </p>
      )}
      {read.items_total > read.items_listed && (
        <p className="text-xs text-muted-foreground">{ASSISTANT_NAME} was shown the first {read.items_listed} of your {read.items_total} inventory items; lines for the others were matched by name here.</p>
      )}
      <div className="space-y-3">
        {draft.map(r => (
          <ReadRecipe key={r.key} r={r} draft={draft} pickers={pickers} canAddItem={setup.canManage}
            onChange={patch => setRecipe(r.key, patch)} onLine={(lk, patch) => setLine(r.key, lk, patch)} onNewItem={takeNewItem} />
        ))}
      </div>
      {error && <p className="text-sm text-destructive" role="alert" data-testid="reader-error">{error}</p>}
      <div className="sticky bottom-0 bg-page/95 py-3 flex flex-wrap items-center justify-end gap-2 border-t">
        <span className="text-sm text-muted-foreground flex-1 min-w-[12rem]" data-testid="reader-summary">
          {summary.recipes} {summary.recipes === 1 ? 'recipe' : 'recipes'}, {summary.ready} lines
          {summary.out > 0 && <> · <span className="text-amber-800">{summary.out} not matched go into the notes</span></>}
        </span>
        <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => { setDraft(null); setRead(null); setError(null) }} disabled={saving}>Read something else</button>
        <button type="button" className={cn(btn.primary, 'h-12')} onClick={save} disabled={saving || !summary.recipes || summary.unnamed} data-testid="reader-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Make {summary.recipes} draft {summary.recipes === 1 ? 'recipe' : 'recipes'}
        </button>
      </div>
    </div>
  )
}

function ReadRecipe({ r, draft, pickers, canAddItem, onChange, onLine, onNewItem }) {
  const counts = { matched: 0, suggested: 0, not_found: 0, out: 0 }
  for (const l of r.lines) counts[l.out ? 'out' : l.match.state]++
  // Prep recipes of this reading a line can name (ticked, not this one).
  const own = draft.filter(x => x.key !== r.key && x.kind === 'prep' && x.keep)
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', !r.keep && 'opacity-60')} data-testid="reader-recipe" data-name={r.name}>
      <div className="section-head flex flex-wrap items-center gap-2 px-3 py-2 min-h-[56px]">
        <label className="inline-flex items-center justify-center w-12 h-12 shrink-0 touch-manipulation" aria-label={'Make ' + r.name}>
          <input type="checkbox" className="w-5 h-5" checked={r.keep} onChange={e => onChange({ keep: e.target.checked })} data-testid="reader-keep" />
        </label>
        <input className={cn(inputCls, 'h-12 flex-1 min-w-[10rem] font-medium')} value={r.name} maxLength={200} aria-label="Recipe name"
          onChange={e => onChange({ name: e.target.value })} data-testid="reader-name" />
        <Segmented value={r.kind} onChange={v => onChange({ kind: v })} options={[{ value: 'dish', label: 'Dish' }, { value: 'prep', label: 'Prep' }]}
          className="[&>button]:h-12" testid="reader-kind" />
        <button type="button" onClick={() => onChange({ open: !r.open })} aria-label={r.open ? 'Fold' : 'Open'} aria-expanded={r.open}
          className="w-12 h-12 shrink-0 rounded-lg border bg-background flex items-center justify-center touch-manipulation">
          <ChevronDown className={cn('w-4 h-4 transition-transform', r.open && 'rotate-180')} />
        </button>
      </div>
      {r.open && r.keep && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="reader-recipe-counts">
            {r.lines.length} {r.lines.length === 1 ? 'line' : 'lines'}: {counts.matched} matched, {counts.suggested} suggested, {counts.not_found} not found{counts.out ? ', ' + counts.out + ' left out' : ''}
          </p>
          {r.existing && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-testid="reader-existing">
              A recipe called {r.existing.name} is already on the Recipes page: this makes another one beside it.
            </p>
          )}
          {r.kind === 'dish' ? (
            <Field label="Portions it makes">
              <NumInput value={r.portions} onChange={v => onChange({ portions: v })} className="h-12 w-32" />
            </Field>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Field label="It makes">
                <NumInput value={r.yield_qty} onChange={v => onChange({ yield_qty: v })} className="h-12 w-28" data-testid="reader-yield-qty" />
              </Field>
              <Field label="Made in">
                <select className={cn(inputCls, 'h-12 w-36')} value={r.yield_unit || ''} onChange={e => onChange({ yield_unit: e.target.value || null })} data-testid="reader-yield-unit">
                  <option value="">Pick one</option>
                  {YIELD_UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              </Field>
            </div>
          )}
          <ul className="divide-y rounded-lg border">
            {r.lines.map(l => (
              <ReadLine key={l.key} l={l} own={own} pickers={pickers} canAddItem={canAddItem}
                onChange={patch => onLine(l.key, patch)} onNewItem={onNewItem} />
            ))}
            {!r.lines.length && <li className="p-3 text-sm text-muted-foreground">No lines were read.</li>}
          </ul>
          {r.method && (
            <details className="text-sm">
              <summary className="cursor-pointer min-h-[44px] flex items-center text-muted-foreground touch-manipulation">Method</summary>
              <p className="whitespace-pre-wrap text-sm mt-1">{r.method}</p>
            </details>
          )}
          {r.notes && <p className="text-xs text-muted-foreground">Notes: {r.notes}</p>}
        </div>
      )}
    </section>
  )
}

const STATE_LOOK = {
  matched: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  suggested: 'bg-amber-50 text-amber-900 border-amber-200',
  not_found: 'bg-red-50 text-red-800 border-red-200',
}
const STATE_WORD = { matched: 'Matched', suggested: 'Suggested', not_found: 'Not found' }
const HOW_WORD = { pepper: 'by ' + ASSISTANT_NAME, code: 'by its code', name: 'by its name', picked: 'picked', added: 'added to the inventory' }

function ReadLine({ l, own, pickers, canAddItem, onChange, onNewItem }) {
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const m = l.match
  const items = pickers?.items || []
  const preps = pickers?.recipes || []
  const item = m.kind === 'item' ? items.find(i => i.id === m.item_id) : null
  const prep = m.kind === 'recipe' ? preps.find(p => p.id === m.sub_recipe_id) : null
  const ownPrep = m.kind === 'new' ? own.find(x => x.key === m.new_key) : null
  const lost = m.kind === 'new' && !ownPrep
  const state = l.out ? 'not_found' : lost ? 'not_found' : m.state
  const choices = item ? unitChoices(item) : prep ? recipeUnitChoices(prep) : ownPrep ? recipeUnitChoices({ kind: 'prep', yield_unit: ownPrep.yield_unit }) : []
  const units = [...new Set([...(l.unit ? [l.unit] : []), ...choices])]
  const pick = x => {
    onChange({ match: { state: 'matched', how: 'picked', ...x }, unit_problem: null, out: false })
    setPicking(false)
  }
  return (
    <li className="p-3 space-y-2" data-testid="reader-line" data-state={state}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="flex-1 min-w-[12rem] text-sm">
          <span className="block text-xs text-muted-foreground">Read: {l.words}</span>
          {l.out ? (
            <span className="text-muted-foreground">Left out: kept in the notes</span>
          ) : m.state !== 'not_found' && !lost ? (
            <span className="inline-flex items-center gap-1.5 font-medium">
              {m.kind === 'item' ? <Package className="w-4 h-4 text-muted-foreground" /> : <ChefHat className="w-4 h-4 text-sky-700" />}
              {m.name}{m.kind === 'new' ? ' (read here)' : ''}{m.state === 'suggested' ? '?' : ''}
              <span className="text-xs font-normal text-muted-foreground">{HOW_WORD[m.how] || ''}</span>
            </span>
          ) : (
            <span className="font-medium">{lost ? m.name + ' isn\'t being made' : 'Nothing called ' + l.what}</span>
          )}
        </span>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap', STATE_LOOK[state])}>{l.out ? 'Left out' : STATE_WORD[state]}</span>
      </div>
      {!l.out && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="How much">
            <NumInput value={l.qty} onChange={v => onChange({ qty: v })} className={cn('h-12 w-24', !(Number(l.qty) > 0) && 'border-amber-400')} data-testid="reader-qty" />
          </Field>
          <Field label="Unit">
            {units.length ? (
              <select className={cn(inputCls, 'h-12 w-32')} value={l.unit} onChange={e => onChange({ unit: e.target.value, unit_problem: null })} data-testid="reader-unit">
                {units.map(u => <option key={u} value={u}>{unitLabel(u)}{u === l.unit && !choices.includes(u) && choices.length ? ' (as read)' : ''}</option>)}
              </select>
            ) : (
              <input className={cn(inputCls, 'h-12 w-32')} value={l.unit} maxLength={30} onChange={e => onChange({ unit: e.target.value })} data-testid="reader-unit" />
            )}
          </Field>
          {m.state === 'suggested' && (
            <button type="button" className={cn(btn.primary, 'h-12')} onClick={() => onChange({ match: { ...m, state: 'matched', how: m.how } })} data-testid="reader-accept">
              <Check className="w-4 h-4" />Use {m.name}
            </button>
          )}
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => { setPicking(p => !p); setAdding(false) }} data-testid="reader-pick">
            {m.state === 'matched' && !lost ? 'Change' : 'Pick one'}
          </button>
          {(m.state !== 'matched' || lost) && (canAddItem
            ? <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => { setAdding(a => !a); setPicking(false) }} data-testid="reader-add-item"><Plus className="w-4 h-4" />Add to the inventory</button>
            : null)}
          <button type="button" className={cn(btn.ghost, 'h-12')} onClick={() => onChange({ out: true })} data-testid="reader-leave-out">Leave out</button>
        </div>
      )}
      {l.out && (
        <button type="button" className={cn(btn.ghost, 'h-12')} onClick={() => onChange({ out: false })} data-testid="reader-put-back">Put it back</button>
      )}
      {!l.out && !(Number(l.qty) > 0) && <p className="text-xs text-amber-800">No quantity was read: give one, or it goes into the notes.</p>}
      {!l.out && l.unit_problem && m.state === 'matched' && <p className="text-xs text-amber-800">{l.unit_problem}: it is kept as read and shows as a gap until the item has that size, or pick another unit.</p>}
      {!l.out && (m.state !== 'matched' || lost) && !canAddItem && (
        <p className="text-xs text-muted-foreground" data-testid="reader-ask">Not in the inventory? Ask someone with Purchasing setup to add it, then pick it here, or leave the line out.</p>
      )}
      {!l.out && m.state === 'suggested' && l.candidates.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {l.candidates.slice(1).map(c => (
            <button key={(c.item_id || c.sub_recipe_id)} type="button" className={cn(btn.outline, 'h-12')}
              onClick={() => pick({ kind: c.kind, item_id: c.item_id, sub_recipe_id: c.sub_recipe_id, name: c.name })}>{c.name}?</button>
          ))}
        </div>
      )}
      {picking && (
        <PickThing items={items} preps={preps} own={own} start={l.what} onPick={pick} onCancel={() => setPicking(false)} />
      )}
      {adding && (
        <AddItem what={l.what} unit={l.unit} onAdded={it => { onNewItem(it, l.what); setAdding(false) }} onCancel={() => setAdding(false)} />
      )}
    </li>
  )
}

/** A search over inventory items, prep recipes and this reading's own prep recipes. */
function PickThing({ items, preps, own, start, onPick, onCancel }) {
  const [q, setQ] = useState(start.split(/[\s,]+/).filter(w => w.length > 2).slice(0, 2).join(' '))
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const all = [
    ...own.map(x => ({ kind: 'new', new_key: x.key, id: x.key, name: x.name, hint: 'prep, read here' })),
    ...preps.filter(p => p.is_active !== false).map(p => ({ kind: 'recipe', sub_recipe_id: p.id, id: p.id, name: p.name, hint: 'prep recipe' })),
    ...items.filter(i => i.is_active !== false).map(i => ({ kind: 'item', item_id: i.id, id: i.id, name: i.name, hint: 'item, in ' + (i.unit_choices || []).map(unitLabel).join(', ') })),
  ]
  const hits = words.length ? all.filter(x => words.every(w => x.name.toLowerCase().includes(w))).slice(0, 8) : []
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-2" data-testid="reader-picker">
      <div className="flex gap-2">
        <input className={cn(inputCls, 'h-12')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search items and prep recipes" aria-label="Search items and prep recipes" autoFocus />
        <button type="button" className={cn(btn.ghost, 'h-12')} onClick={onCancel}>Cancel</button>
      </div>
      {words.length > 0 && !hits.length && <p className="text-sm text-muted-foreground px-1">Nothing called that.</p>}
      {hits.length > 0 && (
        <div className="rounded-lg border divide-y bg-background">
          {hits.map(x => (
            <button key={x.kind + x.id} type="button" onClick={() => onPick({ kind: x.kind, item_id: x.item_id, sub_recipe_id: x.sub_recipe_id, new_key: x.new_key, name: x.name })}
              className="w-full text-left px-3 min-h-[48px] flex items-center gap-2 hover:bg-muted touch-manipulation" data-testid="reader-pick-hit">
              {x.kind === 'item' ? <Package className="w-4 h-4 text-muted-foreground" /> : <ChefHat className="w-4 h-4 text-sky-700" />}
              <span className="flex-1 text-sm">{x.name}</span>
              <span className="text-xs text-muted-foreground">{x.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A missing item added to the inventory in place (Purchasing setup manage): its name and what it is kept in. */
function AddItem({ what, unit, onAdded, onCancel }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(what.charAt(0).toUpperCase() + what.slice(1))
  const [base, setBase] = useState(baseFor(unit))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const it = await api.post('/inventory/items', { name: name.trim(), base_unit: base })
      qc.invalidateQueries({ queryKey: ['recipe-pickers'] })
      onAdded(it)
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="reader-add-form">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New inventory item">
          <input className={cn(inputCls, 'h-12 w-56')} value={name} maxLength={200} onChange={e => setName(e.target.value)} data-testid="reader-add-name" />
        </Field>
        <Field label="Counted in" group>
          <Segmented value={base} onChange={setBase} options={[{ value: 'g', label: 'Weight' }, { value: 'ml', label: 'Volume' }, { value: 'each', label: 'Each' }]} className="[&>button]:h-12" />
        </Field>
        <button type="button" className={cn(btn.primary, 'h-12')} onClick={save} disabled={saving || !name.trim()} data-testid="reader-add-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}Add item
        </button>
        <button type="button" className={cn(btn.ghost, 'h-12')} onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-xs text-muted-foreground">Its supplier prices are added on the Inventory page; until then the line shows as a gap (no price).</p>
      <ErrorNote error={error} />
    </div>
  )
}
