// The dish being added from a till layout's Dish choices zones, shown in the
// Order zone (14 Nov 2026): a dashed line that isn't on the order yet, with
// what is picked so far and a placeholder for each choice still to pick
// ("Size to be picked"). Tapping a placeholder brings that choice into view
// in the choices zone, lit for a moment. Add (or Update, for a dish whose
// options are being changed) puts it on the order; Cancel takes it away.
//
// LayoutScreen provides the draft (useChoiceBuilder()'s draft, from
// LayoutChoices.jsx) through DraftContext; CheckPanel and the counter's
// panel draw it with DraftRow. A dish being changed shows under its own line,
// which is dimmed meanwhile; a dish being added goes at the end.

import { createContext, useContext, useEffect, useRef } from 'react'
import { PenLine, CircleDashed, CheckCircle2 } from 'lucide-react'
import { money } from './ui.jsx'

export const DraftContext = createContext(null)

/** { draft, focus(key) } while a dish is being added or changed, else null. */
export function useDraft() {
  return useContext(DraftContext)
}

/** What a placeholder says for a choice still to pick. */
export function missingText(p) {
  if (p.open || !p.picks.length) return p.title + ' to be picked'
  return p.title + ': ' + p.missing + ' more to be picked'
}

/** The draft where a panel shows it (the counter's panel before an order exists). */
export function PendingDraft({ className = '' }) {
  const pending = useDraft()
  if (!pending?.draft) return null
  return <div className={className} data-testid="pending-draft"><DraftRow draft={pending.draft} onFocus={pending.focus} /></div>
}

export default function DraftRow({ draft, onFocus }) {
  const ref = useRef(null)
  // In view when it starts (the end of a long order).
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [])
  const editing = !!draft.edit
  const missing = draft.parts.filter(p => p.missing > 0)
  return (
    <div ref={ref} className="m-2 rounded-xl border-2 border-dashed border-brand bg-brand-soft text-ink"
      data-testid="line-draft" data-ok={draft.ok ? '1' : '0'} data-edit={editing ? '1' : undefined}>
      <div className="px-3 pt-2 pb-2.5 flex gap-3 items-start">
        <div className="w-8 shrink-0 font-bold tabular-nums text-right" data-testid="draft-qty">{draft.qty}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-snug" data-testid="draft-name">{draft.name}</div>
          {draft.count > 1 && <div className="text-[0.875em] text-muted leading-snug">{draft.count} dishes, one for each pick</div>}
          {draft.parts.map(p => (
            <div key={p.key} data-part={p.key}>
              {p.picks.length > 0 && (
                <div className="text-[0.875em] text-muted leading-snug" data-testid="draft-picks">{p.title ? p.title + ': ' : ''}{p.picks.join(', ')}</div>
              )}
              {p.missing > 0 && (
                <button className="mt-1 inline-flex items-center gap-1.5 rounded-lg border-2 border-dashed border-warn bg-white text-warn font-semibold px-2.5 min-h-[48px] text-[0.875em] text-left touch-manipulation"
                  onClick={() => onFocus?.(p.key)} data-testid="draft-missing">
                  <CircleDashed size={16} className="shrink-0" /><span>{missingText(p)}</span>
                </button>
              )}
            </div>
          ))}
          <div className="mt-1.5 text-[0.75em] font-bold flex items-center gap-1 text-brand" data-testid="draft-state">
            {draft.ok
              ? <><CheckCircle2 size={12} className="shrink-0" />{editing ? 'Ready: tap Update to change it on the order' : 'Ready: tap Add to put it on the order'}</>
              : <><PenLine size={12} className="shrink-0" />{editing ? 'Being changed: not saved yet' : 'Being added: not on the order yet'}{missing.length ? ' · ' + missing.length + ' to pick' : ''}</>}
          </div>
        </div>
        <div className="text-right shrink-0 tabular-nums font-semibold" data-testid="draft-price">{draft.ok && draft.total != null ? money(draft.total) : '…'}</div>
      </div>
    </div>
  )
}
