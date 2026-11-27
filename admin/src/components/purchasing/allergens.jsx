// src/components/purchasing/allergens.jsx
//
// A supplier product's allergens (inventory phase 8a, migration 316;
// docs/INVENTORY.md 8.3), edited from the Inventory page's item drawer
// (lazy): each of the 14 allergens as contains, may contain or no, where the
// information came from, or "not known yet". Pepper can read them off the
// product's spec sheet (POST /api/ai/allergens/read): the reading fills the
// form, and nothing is saved until the person taps Save
// (PUT /api/inventory/quotes/:id/allergens, the whole of it).
// The Recipes page's Allergens tab checks each dish's declared allergens
// against these; nothing here changes a dish.

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Sparkles, FileText, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { btn, Toggle, fileToBase64 } from '@/components/purchasing/shared'
import { STANDARD_ALLERGENS } from '@shared/menuTags.js'
import { SPEC_LEVELS, SOURCE_MAX } from '@shared/allergenCheck.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const CHOICES = [
  { value: 'contains', label: 'Contains' },
  { value: 'may_contain', label: 'May contain' },
  { value: 'no', label: 'No' },
]
const SPEC_TONE = { contains: 'text-red-700', may_contain: 'text-amber-700', free: 'text-emerald-700', not_said: 'text-muted-foreground' }

/** The form from a stored product: { known, levels: { key: 'contains' | 'may_contain' | 'no' }, source }. */
function formOf(q) {
  const levels = Object.fromEntries(STANDARD_ALLERGENS.map(a => [a.key, 'no']))
  for (const k of q?.allergens_may_contain || []) levels[k] = 'may_contain'
  for (const k of q?.allergens_contains || []) levels[k] = 'contains'
  return { known: !!q?.allergens_checked_at, levels, source: q?.allergens_source || '' }
}

export function QuoteAllergensModal({ item, quote, canEdit, onClose, onSaved }) {
  const api = useApi()
  const start = useMemo(() => formOf(quote), [quote])
  const [f, setF] = useState(start)
  const [reading, setReading] = useState(null)
  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status'), staleTime: 60_000, enabled: canEdit })
  const dirty = JSON.stringify(f) !== JSON.stringify(start)
  const save = useMutation({
    mutationFn: () => api.put(`/inventory/quotes/${quote.id}/allergens`, {
      known: f.known,
      contains: STANDARD_ALLERGENS.filter(a => f.levels[a.key] === 'contains').map(a => a.key),
      may_contain: STANDARD_ALLERGENS.filter(a => f.levels[a.key] === 'may_contain').map(a => a.key),
      source: f.known ? f.source.trim() || null : null,
    }),
    onSuccess: saved => { onSaved(saved); onClose() },
  })
  const read = useMutation({
    mutationFn: async files => {
      const list = await Promise.all([...files].slice(0, 4).map(async file => ({ name: file.name, data: await fileToBase64(file) })))
      return api.post('/ai/allergens/read', { quote_id: quote.id, files: list })
    },
    onSuccess: r => setReading(r),
  })
  const useReading = () => {
    const levels = { ...f.levels }
    for (const a of STANDARD_ALLERGENS) {
      const l = reading.allergens[a.key]?.level
      levels[a.key] = l === 'contains' || l === 'may_contain' ? l : 'no'
    }
    const notSaid = STANDARD_ALLERGENS.filter(a => reading.allergens[a.key]?.level === 'not_said').length
    setF({ known: true, levels, source: (ASSISTANT_NAME + ' read the spec sheet' + (reading.product_name ? ' of ' + reading.product_name : '')).slice(0, SOURCE_MAX) })
    setReading(r => ({ ...r, used: true, not_said: notSaid }))
  }
  const setLevel = (key, v) => setF(x => ({ ...x, levels: { ...x.levels, [key]: v } }))
  const supplier = quote.supplier_name

  return (
    <Modal title={`Allergens · ${supplier}${quote.product_name ? ': ' + quote.product_name : ''}`} onClose={onClose}
      footer={canEdit ? <>
        <button type="button" className={btn.primary} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="quote-allergens-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </> : null}>
      <p className="text-sm text-muted-foreground">
        What {supplier}&apos;s {quote.product_name || item.name} contains, from its spec sheet or label. Two suppliers&apos; products can differ,
        so each price keeps its own. The Recipes page checks each dish&apos;s declared allergens against these; it never changes a dish by itself.
      </p>
      {canEdit && ai?.can_chat && (
        <div className="rounded-lg border p-3 space-y-2" data-testid="quote-allergens-read">
          <label className={cn(btn.outline, 'h-12 cursor-pointer w-full sm:w-auto')}>
            {read.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {read.isPending ? `${ASSISTANT_NAME} is reading it...` : 'Read the spec sheet (PDF or photo)'}
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple
              disabled={read.isPending} onChange={e => { if (e.target.files?.length) read.mutate(e.target.files); e.target.value = '' }}
              data-testid="quote-allergens-file" />
          </label>
          <ErrorNote error={read.error} />
          {reading && (
            <div className="space-y-2" data-testid="quote-allergens-reading">
              <p className="text-sm font-medium flex items-center gap-1.5"><FileText className="w-4 h-4" />
                {ASSISTANT_NAME} read{reading.product_name ? ` ${reading.product_name}` : ''}: {reading.said} of 14 answered
              </p>
              <ul className="grid sm:grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {STANDARD_ALLERGENS.map(a => {
                  const r = reading.allergens[a.key] || { level: 'not_said', words: '' }
                  return (
                    <li key={a.key} className="flex gap-1.5">
                      <span className="font-medium w-20 shrink-0">{a.label}</span>
                      <span className={SPEC_TONE[r.level]}>{SPEC_LEVELS[r.level]}{r.words ? ': ' + r.words : ''}</span>
                    </li>
                  )
                })}
              </ul>
              {reading.notes && <p className="text-xs text-amber-800 flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{reading.notes}</p>}
              {!reading.used ? (
                <button type="button" className={cn(btn.outline, 'h-12')} onClick={useReading} data-testid="quote-allergens-use">Use this reading</button>
              ) : (
                <p className="text-xs text-sky-800">
                  Put in below{reading.not_said ? `: ${reading.not_said} the sheet didn't mention are set to No. Check them before you save.` : '. Check it against the sheet, then Save.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <Toggle checked={!f.known} onChange={v => setF(x => ({ ...x, known: !v }))} disabled={!canEdit} label="Not known yet (shows as a gap in the allergen check)" />
      {f.known && (
        <>
          <div className="divide-y rounded-lg border" data-testid="quote-allergens-list">
            {STANDARD_ALLERGENS.map(a => (
              <div key={a.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-sm font-medium">{a.label}</span>
                <Segmented value={f.levels[a.key]} options={CHOICES} onChange={v => setLevel(a.key, v)} disabled={!canEdit} testid={'quote-allergen-' + a.key} />
              </div>
            ))}
          </div>
          <Field label="Where this came from" hint="Optional, e.g. the spec sheet's date or version">
            <input className={inputCls} value={f.source} maxLength={SOURCE_MAX} disabled={!canEdit} onChange={e => setF(x => ({ ...x, source: e.target.value }))}
              placeholder={`${supplier} spec sheet, ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`} />
          </Field>
        </>
      )}
      {quote.allergens_checked_at && (
        <p className="text-xs text-muted-foreground">
          Last saved {new Date(quote.allergens_checked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          {quote.allergens_checked_by ? ` by ${quote.allergens_checked_by}` : ''}.
        </p>
      )}
      <ErrorNote error={save.error} />
    </Modal>
  )
}
