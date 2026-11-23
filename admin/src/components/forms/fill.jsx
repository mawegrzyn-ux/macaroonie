// src/components/forms/fill.jsx
//
// Pepper's values in a form (docs/CHAT_FIRST.md F4, F7; Pepper-first step 3b).
// FormSheet wraps the form's own panel in <FormFillProvider values={...}>,
// where values come from the open_form card (checked by the server against
// the form's fields in shared/forms.js). A panel that takes values reads
// them with useFormFill() (null outside a filled sheet, so the pages are
// unchanged): it starts its inputs from fill.values, tints each one Pepper
// filled (filledClass) and shows <FilledMark> beside it, until the person
// changes the field (fill.clear(key)) or accepts it (the mark's OK). Nothing
// is saved by placing a value: the panel's own Save (or, in a grid that
// saves as it is typed, the OK or an edit) saves through the page's route.
//
// Keys are the panel's own: a field's name ('supplier'), or a row's
// ('readings:<equipment id>:<check time id>') in a grid.
//
// The provider also carries what the sheet needs from the panel:
//   change(key, value)  a field's current value, for the draft (step 3d)
//   saved(line, key?)   a short line of what was just saved (the chat's
//                       summary after Save, step 3c); a later line with the
//                       same key (default: the line) replaces it

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Sparkles, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const FillContext = createContext(null)

export function FormFillProvider({ values, onChange, onSaved, children }) {
  const [cleared, setCleared] = useState(() => new Set())
  const clear = useCallback(key => setCleared(s => (s.has(key) ? s : new Set(s).add(key))), [])
  const value = useMemo(() => ({
    values: values || {},
    // Pepper's value for a key is still waiting for the person.
    filled: key => !cleared.has(key),
    clear,
    change: (key, v) => onChange?.(key, v),
    saved: (line, key) => onSaved?.(line, key),
  }), [values, cleared, clear, onChange, onSaved])
  return <FillContext.Provider value={value}>{children}</FillContext.Provider>
}

/** The sheet's fill, or null outside a filled sheet. */
export function useFormFill() {
  return useContext(FillContext)
}

/** The tint on an input Pepper filled. */
export const FILLED_CLASS = 'border-violet-400 bg-violet-50 ring-1 ring-violet-300'
export const filledClass = (fill, key, has = true) => (fill && has && fill.filled(key) ? FILLED_CLASS : '')

/** "Filled by Pepper" and OK beside a field Pepper filled; gone once the
 *  person changes the field or presses OK. onAccept runs before the mark
 *  goes (a grid cell saves its value there). */
export function FilledMark({ fill, k, has = true, onAccept, className }) {
  if (!fill || !has || !fill.filled(k)) return null
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium text-violet-700', className)} data-testid="pepper-filled" data-key={k}>
      <Sparkles className="w-3 h-3" /> Filled by Pepper
      <button type="button" onClick={() => { onAccept?.(); fill.clear(k) }} data-testid="pepper-filled-ok"
        className="ml-1 inline-flex items-center justify-center gap-0.5 rounded border border-violet-300 bg-background px-3 min-h-[48px] min-w-[48px] text-violet-700 hover:bg-violet-100 touch-manipulation">
        <Check className="w-3 h-3" /> OK
      </button>
    </span>
  )
}

/** A field's starting value: the record's own when editing one, else Pepper's (or a draft's). */
export function startValue(fill, key, own, empty = '') {
  if (own !== undefined && own !== null) return own
  const v = fill?.values?.[key]
  return v === undefined || v === null ? empty : v
}
