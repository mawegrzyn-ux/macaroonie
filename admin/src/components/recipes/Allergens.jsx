// src/components/recipes/Allergens.jsx
//
// The Recipes page's Allergens tab (inventory phase 8a, migration 316;
// docs/INVENTORY.md 8.3, decision D6), lazy from pages/Recipes.jsx at
// ?tab=allergens (&check=<dish id> opens one dish's check): each food dish's
// declared allergens (the menu's draft) against what its recipes suggest at
// each venue's supplier products, dishes with open differences first. A
// check shows the suggestion and the declaration, each difference with its
// evidence (which ingredient, through which prep recipe or option, and which
// supplier's product), the ingredients whose allergens are unknown, and
// Accept (the dish's allergens changed in the menu's draft through the
// Allergen matrix's own save; publishing stays on the Menus page) or Dismiss
// with a note (it holds until the differences change). Filter by venue. A
// dish whose known ingredients agree while some aren't known is "Not all
// known", never "Agrees" (checkState() in shared/allergenCheck.js).
// The rule is shared/allergenCheck.js; API: routes/allergenChecks.js.
// RecipeSuggestion is the recipe editor's card (its own suggestion per venue).
// Phase 8b (migration 317): a check a change opened again says what changed
// ("Oyster sauce: the usual supplier switched at Leeds"); the Changed filter
// (&changed=1, Today's "Allergen checks to review") lists those first.
// What a delivery brought instead of what was ordered counts at its venue.
// Phase 8b (migration 318): each dish's suggested calories beside its declared
// figure (CaloriesCard: one serving of its recipe at each venue, the
// ingredients giving the most, what isn't known; Accept writes the figure into
// the menu's draft, Dismiss keeps it with a note), the Calories filter, and
// the recipe editor's own figure with the declared figures of its dishes.
// The rule is shared/calorieCheck.js.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, ShieldAlert, ChevronRight, ArrowLeft, Check, X, Undo2, Info } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote, Field } from '@/components/staff/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Card, btn } from '@/components/purchasing/shared'
import { STANDARD_ALLERGENS } from '@shared/menuTags.js'
import { evidenceWords, checkState, pickedDifferences, CHECK_STATES, DIFFERENCE_KINDS, NOTE_MAX } from '@shared/allergenCheck.js'
import { CALORIE_KINDS, CALORIE_TOLERANCE } from '@shared/calorieCheck.js'

const LABEL = Object.fromEntries(STANDARD_ALLERGENS.map(a => [a.key, a.label]))
const STATUS_LOOK = {
  open: 'bg-amber-50 text-amber-900 border-amber-200',
  incomplete: 'bg-background text-amber-900 border-amber-300 border-dashed',
  dismissed: 'bg-muted text-muted-foreground border-border',
  accepted: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  agree: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  not_checkable: 'bg-muted text-muted-foreground border-border',
}
const STATUS_WORDS = CHECK_STATES
const FILTERS = [
  // Phase 8b: open checks a change opened, opened again or changed (Today's "Allergen checks to review").
  { value: 'changed', label: 'Changed' },
  // Phase 8b: dishes whose declared calories differ from the recipe's.
  { value: 'calories', label: 'Calories' },
  ...['open', 'incomplete', 'dismissed', 'accepted', 'agree', 'not_checkable'].map(value => ({ value, label: CHECK_STATES[value] })),
  { value: 'all', label: 'All' },
]
const isChanged = r => (stateOf(r) === 'open' && !!r.change) || (r.calories?.state === 'open' && !!r.calories?.change)
const caloriesOpen = r => r.calories?.state === 'open'
const kcalText = n => (n == null ? '' : Number(n).toLocaleString('en-GB') + ' kcal')

// Calorie labelling (the Help says the same): who it applies to, and to confirm it.
export const CALORIE_LAW = 'Calorie labelling on menus applies in England to businesses with 250 or more employees, and a franchise counts the whole network\'s employees. Confirm the detail for your business before relying on these figures: they are worked out from your recipes and item energy, as good as the figures under them.'
const stateOf = checkState
// A scope group's suggestion with no allergens: none only when everything is known.
const groupEmpty = g => (!g.recipe ? 'No recipe linked here' : g.complete ? 'None of the 14' : 'Not known yet')
const thingsWords = n => (n === 1 ? '1 thing' : n + ' things')
const linkCls = 'inline-flex items-center min-h-[48px] underline touch-manipulation'
const when = at => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export const LIABILITY = 'Your business is responsible for what each dish declares. This check is only as good as the supplier data under it: it suggests, and a person decides. Nothing here changes a dish by itself.'

function StatusBadge({ state }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_LOOK[state])} data-state={state}>{STATUS_WORDS[state]}</span>
}

/** Allergens as chips: contains filled, may contain outlined, can be removed with its asterisk. */
export function AllergenChips({ levels, empty, testid }) {
  const keys = STANDARD_ALLERGENS.map(a => a.key).filter(k => levels?.[k])
  if (!keys.length) return <span className="text-xs text-muted-foreground" data-testid={testid}>{empty}</span>
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid={testid}>
      {keys.map(k => (
        <span key={k} className={cn('rounded-full border px-2 py-0.5 text-xs',
          levels[k] === 'may_contain' ? 'border-dashed border-amber-400 text-amber-900' : 'bg-foreground/5 border-foreground/20')}>
          {LABEL[k]}{levels[k] === 'may_contain' ? ' (may contain)' : levels[k] === 'removable' ? '*' : ''}
        </span>
      ))}
    </span>
  )
}

export default function AllergenChecks({ canManage, openId, onOpen, onClose, startQ = '', startChanged = false }) {
  const api = useApi()
  const [venueId, setVenueId] = useState('')
  const [filter, setFilter] = useState(startChanged ? 'changed' : 'open')
  const [q, setQ] = useState(startQ)
  const { data, isLoading, error } = useQuery({
    queryKey: ['allergen-checks', venueId],
    queryFn: () => api.get('/allergen-checks' + (venueId ? '?venue_id=' + venueId : '')),
  })
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = useMemo(() => (data?.rows || [])
    .filter(r => filter === 'all' || words.length > 0 || (filter === 'changed' ? isChanged(r) : filter === 'calories' ? caloriesOpen(r) : stateOf(r) === filter))
    .filter(r => words.every(w => [r.dish, r.menu, r.section].some(x => (x || '').toLowerCase().includes(w)))),
  [data, filter, q])
  if (isLoading) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (error) return <ErrorNote error={error} />
  const open = openId ? data.rows.find(r => r.dish_id === openId) : null
  if (openId) {
    // Keyed by what differs: when the check changes (a partial accept, a refetch), what was ticked starts again from it.
    return open
      ? <CheckDetail key={open.dish_id + '|' + open.fingerprint} row={open} venueId={venueId} canManage={canManage} canDecide={canManage && data.can_decide} onClose={onClose} />
      : <Card><p className="text-sm">That dish isn&apos;t on one of your menus as food any more. <button type="button" className={linkCls} onClick={onClose}>Back to the list</button></p></Card>
  }
  const counts = data.counts
  return (
    <div className="space-y-4" data-testid="allergen-checks">
      <div className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-4 py-3 text-sm flex gap-2" data-testid="allergen-liability">
        <Info className="w-4 h-4 shrink-0 mt-0.5" /><span>{LIABILITY}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Each dish&apos;s declared allergens against what its recipes hold: the allergens of the supplier products each venue orders,
        through its prep recipes and what its options add. Put each product&apos;s allergens in on the Inventory page.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(inputCls, 'w-auto h-12')} value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Venue" data-testid="allergen-venue">
          <option value="">Every venue</option>
          {data.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9 h-12')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes" aria-label="Search dishes" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show" data-testid="allergen-filter">
        {FILTERS.map(f => {
          const n = f.value === 'all' ? data.rows.length : f.value === 'changed' ? data.rows.filter(isChanged).length
            : f.value === 'calories' ? data.rows.filter(caloriesOpen).length : counts[f.value]
          return (
            <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)} data-value={f.value}
              className={cn('h-12 px-3 rounded-full border text-sm touch-manipulation', filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
              {f.label} <span className="tabular-nums opacity-80">{n}</span>
            </button>
          )
        })}
      </div>
      <Card bodyClass="p-0">
        {!rows.length ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="allergen-none">
            {filter === 'changed' ? 'No check is open because of a change: anything a change opened has been decided.'
              : filter === 'calories' ? 'No dish\'s declared calories differ from its recipe, among those whose ingredients\' energy is known.'
              : filter !== 'open' ? 'No dishes here.'
              : counts.incomplete ? 'Nothing open: no dish\'s known ingredients differ from what it declares. ' + (counts.incomplete === 1 ? '1 dish has' : counts.incomplete + ' dishes have')
                + ' ingredients whose allergens aren\'t known yet, so it can\'t be confirmed: see Not all known.'
                : 'Nothing open: every dish that can be checked agrees with its recipes, or has been decided.'}
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map(r => (
              <li key={r.dish_id}>
                <button type="button" onClick={() => onOpen(r.dish_id)} className="w-full text-left px-4 py-3 hover:bg-muted/50 touch-manipulation flex items-start gap-3 min-h-[56px]" data-testid="allergen-row">
                  <span className="flex-1 min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.dish}</span>
                      <StatusBadge state={stateOf(r)} />
                      {!r.published && r.live_declared && <span className="text-xs text-amber-800">Draft not live yet</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{[r.menu, r.section].filter(Boolean).join(' · ')}{r.venues.length ? ' · ' + r.venues.join(', ') : ''}</span>
                    {isChanged(r) && <span className="block text-xs text-amber-900" data-testid="allergen-row-change">Changed: {r.change || r.calories?.change}</span>}
                    {caloriesOpen(r) && r.calories.difference && (
                      <span className="block text-sm" data-testid="allergen-row-calories">Calories: {r.calories.difference.text}</span>
                    )}
                    {r.differences.length > 0 && (
                      <span className="block text-sm space-y-0.5">
                        {r.differences.slice(0, 3).map(d => <span key={d.allergen} className="block">{d.text}{d.kind !== 'not_found' && d.where.length ? ' (' + d.where.join(', ') + ')' : ''}</span>)}
                        {r.differences.length > 3 && <span className="block text-xs text-muted-foreground">and {r.differences.length - 3} more</span>}
                      </span>
                    )}
                    {!r.checkable && <span className="block text-xs text-muted-foreground">{r.gaps[0]?.text || 'No recipe linked'}</span>}
                    {r.checkable && r.gaps.length > 0 && <span className="block text-xs text-amber-800">{thingsWords(r.gaps.length)} not known yet</span>}
                  </span>
                  <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function CheckDetail({ row, venueId, canManage, canDecide, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [picked, setPicked] = useState(() => new Set(row.differences.map(d => d.allergen)))
  // What is ticked, of the differences there are now: the count, the confirm and what is sent all read this.
  const chosen = pickedDifferences(row.differences, picked)
  const [confirming, setConfirming] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [note, setNote] = useState('')
  const done = () => {
    qc.invalidateQueries({ queryKey: ['allergen-checks'] })
    qc.invalidateQueries({ queryKey: ['menu'] })
    qc.invalidateQueries({ queryKey: ['allergen-matrix'] })
    setConfirming(false); setDismissing(false); setNote('')
  }
  const accept = useMutation({
    // Always the ticked allergens by name, never "whatever differs now".
    mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/accept`, {
      fingerprint: row.fingerprint, allergens: chosen.map(d => d.allergen),
    }),
    onSuccess: done,
  })
  const dismiss = useMutation({
    mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/dismiss`, { fingerprint: row.fingerprint, note: note.trim() }),
    onSuccess: done,
  })
  const reopen = useMutation({ mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/reopen`, {}), onSuccess: done })
  const groups = venueId ? row.groups.filter(g => g.scopes.some(s => s.venue_id === venueId)) : row.groups
  const toggle = k => setPicked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const state = stateOf(row)
  return (
    <div className="space-y-4" data-testid="allergen-detail">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn.ghost, 'h-12')} onClick={onClose}><ArrowLeft className="w-4 h-4" />All dishes</button>
        <h2 className="text-lg font-semibold">{row.dish}</h2>
        <StatusBadge state={state} />
        <span className="text-sm text-muted-foreground">{[row.menu, row.section].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-4 py-3 text-sm flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" /><span>{LIABILITY}</span>
      </div>
      {isChanged(row) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm" data-testid="allergen-change">
          Opened because something changed{row.changed_at ? ' on ' + when(row.changed_at) : ''}: {row.change}. Look at it again and decide.
        </p>
      )}

      <Card title="Declared on the menu">
        <div className="space-y-2">
          <AllergenChips levels={row.declared} empty="No allergens declared" testid="allergen-declared" />
          {row.live_declared == null
            ? <p className="text-xs text-muted-foreground">The menu isn&apos;t live yet.</p>
            : !row.published && (
              <p className="text-xs text-amber-800" data-testid="allergen-not-live">
                This is the menu&apos;s draft. Guests are still told: <AllergenChips levels={row.live_declared} empty="none" />. Publish the menu&apos;s
                allergens on the <Link className={linkCls} to="/menus/allergens">Allergen matrix</Link> to put it live.
              </p>
            )}
        </div>
      </Card>

      <Card title={groups.length > 1 ? 'Suggested by the recipes, where they differ' : 'Suggested by the recipe'}>
        {!row.checkable ? (
          <p className="text-sm text-muted-foreground">{row.gaps[0]?.text || 'No recipe linked'}. {row.gaps[0]?.fix}</p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-3" data-testid="allergen-groups">
              {groups.map((g, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{g.where.join(', ')}{g.recipe ? ': ' + g.recipe.name : ''}</p>
                  <AllergenChips levels={g.levels} empty={groupEmpty(g)} />
                  {g.recipe && !g.complete && Object.keys(g.levels || {}).length > 0 && (
                    <p className="text-xs text-amber-800">So far: {thingsWords(g.gaps.length)} not known yet.</p>
                  )}
                </li>
              ))}
            </ul>
            {state === 'incomplete' && (
              <p className="text-sm text-amber-900" data-testid="allergen-incomplete">
                Nothing differs among the ingredients whose allergens are known, but {thingsWords(row.gaps.length)} aren&apos;t known yet,
                so the declaration can&apos;t be confirmed. Put them in (below), and the check is worked out again.
              </p>
            )}
          </div>
        )}
      </Card>

      {row.differences.length > 0 && (
        <Card title="What differs">
          <ul className="space-y-3" data-testid="allergen-differences">
            {row.differences.map(d => (
              <li key={d.allergen} className="flex items-start gap-3">
                {canDecide && state === 'open' && (
                  <button type="button" role="checkbox" aria-checked={picked.has(d.allergen)} onClick={() => toggle(d.allergen)} aria-label={'Accept ' + d.label}
                    className={cn('w-12 h-12 -my-1 shrink-0 rounded-lg border flex items-center justify-center touch-manipulation', picked.has(d.allergen) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                    {picked.has(d.allergen) && <Check className="w-5 h-5" />}
                  </button>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium">{d.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {DIFFERENCE_KINDS[d.kind]?.label}{d.kind !== 'not_found' && d.where.length ? ' · ' + d.where.join(', ') : ''}
                    {DIFFERENCE_KINDS[d.kind] && ' · accepting ' + (DIFFERENCE_KINDS[d.kind].suggest ? 'declares it as ' + (DIFFERENCE_KINDS[d.kind].suggest === 'may_contain' ? 'may contain' : 'contains') : 'takes it off')}
                  </p>
                  {d.evidence.length > 0 && (
                    <ul className="text-xs space-y-0.5" data-testid="allergen-evidence">
                      {d.evidence.map((e, i) => <li key={i}>{evidenceWords(e)}{e.where?.length && groups.length > 1 ? ' · ' + e.where.join(', ') : ''}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {row.gaps.length > 0 && (
        <Card title="Not known yet">
          <ul className="space-y-2 text-sm" data-testid="allergen-gaps">
            {row.gaps.map((g, i) => (
              <li key={i}>
                <p className="flex gap-1.5"><ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />{g.text}</p>
                <p className="text-xs text-muted-foreground pl-6">
                  {g.fix}{g.item_id && ['unknown', 'no_product'].includes(g.reason) ? <> <Link className={linkCls} to={'/inventory?item=' + g.item_id}>Open {g.item}</Link></> : null}
                </p>
              </li>
            ))}
          </ul>
          {row.checkable && !row.complete && (
            <p className="text-xs text-muted-foreground mt-3">While anything is unknown, an allergen the dish declares that nothing known has is not called out: an unknown product may hold it.</p>
          )}
        </Card>
      )}

      {/* Why there is no Decide card: View only, or Recipes manage without Menus manage. */}
      {!canDecide && (state === 'open' || state === 'dismissed') && (canManage ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-4 py-3 text-sm" data-testid="allergen-cant-decide">
          Accepting or dismissing changes what the dish declares on its menu, so it needs Menus manage as well as Recipes
          manage. Ask someone who has both.
        </p>
      ) : <ReadOnlyNotice what="this check" />)}

      {canDecide && state === 'open' && (
        <Card title="Decide">
          {!confirming && !dismissing && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn(btn.primary, 'h-12')} disabled={!chosen.length} onClick={() => setConfirming(true)} data-testid="allergen-accept">
                <Check className="w-4 h-4" />Accept {chosen.length === row.differences.length ? 'all' : chosen.length}
              </button>
              <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setDismissing(true)} data-testid="allergen-dismiss">
                <X className="w-4 h-4" />Dismiss
              </button>
            </div>
          )}
          {confirming && (
            <div className="space-y-3" data-testid="allergen-accept-confirm">
              <p className="text-sm">
                Change what {row.dish} declares on {row.menu}&apos;s draft: {chosen.map(d => d.label).join(', ')}?
                Guests see it once the menu&apos;s allergens are published.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={cn(btn.primary, 'h-12')} disabled={accept.isPending || !chosen.length} onClick={() => accept.mutate()} data-testid="allergen-accept-yes">
                  {accept.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Yes, change the draft
                </button>
                <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
          {dismissing && (
            <div className="space-y-3" data-testid="allergen-dismiss-form">
              <Field label="Why the declaration stays as it is" hint="Kept with the check. It holds until the differences change.">
                <textarea className={cn(inputCls, 'min-h-[88px]')} value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)}
                  placeholder="Celery salt is in the garnish, not in the recipe" data-testid="allergen-dismiss-note" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={cn(btn.primary, 'h-12')} disabled={!note.trim() || dismiss.isPending} onClick={() => dismiss.mutate()} data-testid="allergen-dismiss-save">
                  {dismiss.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
                </button>
                <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setDismissing(false)}>Cancel</button>
              </div>
            </div>
          )}
          <ErrorNote error={accept.error || dismiss.error} />
        </Card>
      )}

      {row.calories && <CaloriesCard key={row.calories.fingerprint || 'none'} row={row} canManage={canManage} canDecide={canDecide} />}

      {(state === 'dismissed' || state === 'accepted' || row.history.length > 0) && (
        <Card title="Decisions">
          <ul className="space-y-2 text-sm" data-testid="allergen-history">
            {(state === 'dismissed' || state === 'accepted') && (
              <li>
                <span className="font-medium">{STATUS_WORDS[state]}</span> by {row.decided_by || 'someone'} on {when(row.decided_at)}
                {row.note ? ': "' + row.note + '"' : ''}
                {state === 'accepted' && row.accepted.length > 0 && <span className="block text-xs text-muted-foreground">{row.accepted.map(d => d.text).join('; ')}</span>}
              </li>
            )}
            {[...row.history].reverse().map((h, i) => (
              <li key={i} className="text-muted-foreground">
                {STATUS_WORDS[h.status] || h.status} by {h.by || 'someone'} on {when(h.at)}{h.note ? ': "' + h.note + '"' : ''}, then opened again
              </li>
            ))}
          </ul>
          {canDecide && state === 'dismissed' && (
            <button type="button" className={cn(btn.outline, 'h-12 mt-3')} disabled={reopen.isPending} onClick={() => reopen.mutate()} data-testid="allergen-reopen">
              <Undo2 className="w-4 h-4" />Open it again
            </button>
          )}
          <ErrorNote error={reopen.error} />
        </Card>
      )}
    </div>
  )
}

/**
 * A dish's calories (phase 8b): what its menu declares against one serving of
 * its recipe at each venue, the ingredients giving the most, what isn't known,
 * and the decision. Accept writes the suggested figure into the menu's draft
 * (publishing stays on the Menus page); a figure with gaps can't be accepted.
 */
function CaloriesCard({ row, canManage, canDecide }) {
  const api = useApi()
  const qc = useQueryClient()
  const c = row.calories
  const [confirming, setConfirming] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [note, setNote] = useState('')
  const done = () => {
    qc.invalidateQueries({ queryKey: ['allergen-checks'] })
    qc.invalidateQueries({ queryKey: ['menu'] })
    setConfirming(false); setDismissing(false); setNote('')
  }
  const accept = useMutation({ mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/calories/accept`, { fingerprint: c.fingerprint }), onSuccess: done })
  const dismiss = useMutation({ mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/calories/dismiss`, { fingerprint: c.fingerprint, note: note.trim() }), onSuccess: done })
  const reopen = useMutation({ mutationFn: () => api.post(`/allergen-checks/dishes/${row.dish_id}/calories/reopen`, {}), onSuccess: done })
  const d = c.difference
  const canAccept = c.complete && c.suggested != null && d && d.kind !== 'under'
  const top = c.groups.find(g => g.recipe && g.lines?.length) || null
  return (
    <Card title="Calories">
      <div className="space-y-3" data-testid="calorie-card" data-state={c.state}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge state={c.state} />
          {c.state === 'open' && c.change && <span className="text-xs text-amber-900">Changed: {c.change}</span>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Declared on the menu</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="calorie-declared">{c.declared == null ? 'None declared' : kcalText(c.declared)}</p>
            {c.live && !c.published && (
              <p className="text-xs text-amber-800">This is the draft. Guests are still told: {c.live_declared == null ? 'no figure' : kcalText(c.live_declared)}.</p>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Suggested by the recipe</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="calorie-suggested">
              {!c.checkable ? 'No recipe linked' : c.complete ? kcalText(c.suggested) : 'Not all known'}
            </p>
            {c.checkable && !c.complete && c.lower != null && <p className="text-xs text-amber-800">At least {kcalText(c.lower)} from what is known so far.</p>}
            {c.spread && <p className="text-xs text-muted-foreground">The venues&apos; recipes differ: {kcalText(c.min)} to {kcalText(c.max)}. The suggestion is the highest.</p>}
          </div>
        </div>
        {d && <p className="text-sm font-medium" data-testid="calorie-difference">{d.text}</p>}
        {!d && c.state === 'agree' && <p className="text-sm text-emerald-800">The declared figure agrees with the recipe (within {CALORIE_TOLERANCE.pct}%).</p>}
        {c.groups.length > 1 && (
          <ul className="text-xs space-y-0.5" data-testid="calorie-groups">
            {c.groups.map((g, i) => <li key={i}>{g.where.join(', ')}{g.recipe ? ': ' + g.recipe.name : ''}: {g.recipe ? (g.complete ? kcalText(g.kcal) : 'not all known (' + kcalText(g.known_kcal) + ' so far)') : 'no recipe'}</li>)}
          </ul>
        )}
        {top && (
          <details className="text-xs">
            <summary className="min-h-[48px] flex items-center cursor-pointer touch-manipulation">What gives the most{c.groups.length > 1 ? ' (' + top.where.join(', ') + ')' : ''}</summary>
            <ul className="space-y-0.5" data-testid="calorie-lines">
              {top.lines.map(l => <li key={l.item_id}>{l.item}{l.via?.length > 1 ? ' in ' + l.via.slice(1).join(' in ') : ''}: {Number(l.qty_base).toLocaleString('en-GB')} {l.base_unit === 'each' ? 'each' : l.base_unit}, {kcalText(Math.round(l.kcal))}</li>)}
            </ul>
          </details>
        )}
        {c.gaps.length > 0 && (
          <ul className="space-y-2 text-sm" data-testid="calorie-gaps">
            {c.gaps.slice(0, 8).map((g, i) => (
              <li key={i}>
                <p className="flex gap-1.5"><ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />{g.text}</p>
                <p className="text-xs text-muted-foreground pl-6">{g.fix}{g.item_id && g.reason === 'no_energy' ? <> <Link className={linkCls} to={'/inventory?item=' + g.item_id}>Open {g.item}</Link></> : null}</p>
              </li>
            ))}
            {c.gaps.length > 8 && <li className="text-xs text-muted-foreground">and {c.gaps.length - 8} more</li>}
          </ul>
        )}
        <p className="text-xs text-muted-foreground" data-testid="calorie-law">{CALORIE_LAW}</p>
        {!canDecide && c.state === 'open' && (
          <p className="text-xs text-muted-foreground">
            {canManage ? 'Changing a dish\'s calories needs Menus manage as well as Recipes manage.' : 'You can look at this check; deciding it needs Recipes manage and Menus manage.'}
          </p>
        )}
        {canDecide && c.state === 'open' && !confirming && !dismissing && (
          <div className="flex flex-wrap gap-2">
            {canAccept && (
              <button type="button" className={cn(btn.primary, 'h-12')} onClick={() => setConfirming(true)} data-testid="calorie-accept">
                <Check className="w-4 h-4" />Accept {kcalText(c.suggested)}
              </button>
            )}
            <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setDismissing(true)} data-testid="calorie-dismiss">
              <X className="w-4 h-4" />Dismiss
            </button>
          </div>
        )}
        {canDecide && c.state === 'open' && !canAccept && d?.kind === 'under' && (
          <p className="text-xs text-muted-foreground">Put in the energy that isn&apos;t known first: there is no figure to accept until it is all known.</p>
        )}
        {confirming && (
          <div className="space-y-3" data-testid="calorie-accept-confirm">
            <p className="text-sm">Change {row.dish}&apos;s calories on {row.menu}&apos;s draft to {kcalText(c.suggested)}? Guests see it once the menu is published.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn(btn.primary, 'h-12')} disabled={accept.isPending} onClick={() => accept.mutate()} data-testid="calorie-accept-yes">
                {accept.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Yes, change the draft
              </button>
              <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
        {dismissing && (
          <div className="space-y-3" data-testid="calorie-dismiss-form">
            <Field label="Why the declared figure stays as it is" hint={'Kept with the check. It holds while the recipe stays within ' + CALORIE_TOLERANCE.pct + '% of the figure now.'}>
              <textarea className={cn(inputCls, 'min-h-[88px]')} value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)}
                placeholder="Lab tested at 640 kcal in October" data-testid="calorie-dismiss-note" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn(btn.primary, 'h-12')} disabled={!note.trim() || dismiss.isPending} onClick={() => dismiss.mutate()} data-testid="calorie-dismiss-save">
                {dismiss.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
              </button>
              <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setDismissing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {(c.state === 'dismissed' || c.state === 'accepted') && (
          <p className="text-sm" data-testid="calorie-decision">
            <span className="font-medium">{STATUS_WORDS[c.state]}</span> by {c.decided_by || 'someone'} on {when(c.decided_at)}
            {c.state === 'accepted' && c.decided_kcal != null ? ': ' + kcalText(c.decided_kcal) + ' into the draft' : ''}{c.note ? ': "' + c.note + '"' : ''}
          </p>
        )}
        {canDecide && c.state === 'dismissed' && (
          <button type="button" className={cn(btn.outline, 'h-12')} disabled={reopen.isPending} onClick={() => reopen.mutate()} data-testid="calorie-reopen">
            <Undo2 className="w-4 h-4" />Open it again
          </button>
        )}
        <ErrorNote error={accept.error || dismiss.error || reopen.error} />
        {CALORIE_KINDS[d?.kind] && <span className="sr-only">{CALORIE_KINDS[d.kind].label}</span>}
      </div>
    </Card>
  )
}

/** The recipe editor's card: the recipe's own suggested allergens at each venue (venues that agree together). */
export function RecipeSuggestion({ recipeId, stamp = null }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['allergen-recipe', recipeId, stamp], queryFn: () => api.get('/allergen-checks/recipes/' + recipeId), enabled: !!recipeId })
  return (
    <Card title="Suggested allergens">
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : error ? <ErrorNote error={error} /> : (
        <div className="space-y-3" data-testid="recipe-allergens">
          {data.groups.length === 0 && <p className="text-sm text-muted-foreground">No venues yet.</p>}
          {data.groups.map((g, i) => (
            <div key={i} className="space-y-1">
              {data.groups.length > 1 && <p className="text-xs font-medium text-muted-foreground">{g.venues.join(', ')}</p>}
              {g.items ? <AllergenChips levels={g.levels} empty={g.complete ? 'None of the 14' : 'Not known yet'} /> : <span className="text-xs text-muted-foreground">Nothing in it yet.</span>}
              {g.gaps.length > 0 && (
                <ul className="text-xs text-amber-800 space-y-0.5">
                  {g.gaps.slice(0, 5).map((x, j) => <li key={j}>{x.text}</li>)}
                  {g.gaps.length > 5 && <li>and {g.gaps.length - 5} more</li>}
                </ul>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            From each ingredient&apos;s supplier product as each venue orders it. A suggestion only: what a dish declares is set on its menu,
            and the <Link className={linkCls} to="/recipes?tab=allergens">Allergens tab</Link> shows where they differ.
          </p>
          {data.calories && <RecipeCalories cal={data.calories} />}
        </div>
      )}
    </Card>
  )
}

/** Phase 8b: the recipe's own calories, and each dish linked to it with what it declares (decided on the Allergens tab). */
function RecipeCalories({ cal }) {
  return (
    <div className="border-t pt-3 space-y-2" data-testid="recipe-calories">
      <p className="text-sm font-medium">Suggested calories</p>
      <p className="text-sm" data-testid="recipe-calories-figure">
        {cal.complete ? kcalText(cal.kcal) + ' ' + cal.per : 'Not all known' + (cal.known_kcal ? ': at least ' + kcalText(cal.known_kcal) + ' ' + cal.per + ' so far' : '')}
      </p>
      {cal.gaps.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-0.5">
          {cal.gaps.slice(0, 5).map((g, i) => <li key={i}>{g.text}</li>)}
          {cal.gaps.length > 5 && <li>and {cal.gaps.length - 5} more</li>}
        </ul>
      )}
      {cal.dishes.length > 0 && (
        <ul className="text-sm divide-y rounded-lg border" data-testid="recipe-calories-dishes">
          {cal.dishes.map(d => (
            <li key={d.dish_id} className="px-3 py-2 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-0">{d.dish}<span className="block text-xs text-muted-foreground">{[d.menu, d.section].filter(Boolean).join(' · ')}{d.portions !== 1 ? ' · ' + d.portions + ' portions' : ''}</span></span>
              <span className="text-xs tabular-nums">Declares {d.declared == null ? 'none' : kcalText(d.declared)}{d.suggested != null ? ' · recipe ' + kcalText(d.suggested) : ''}</span>
              {d.agrees === false && (
                <Link className={cn(linkCls, 'text-xs')} to={'/recipes?tab=allergens&check=' + d.dish_id}>Check it</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{CALORIE_LAW}</p>
    </div>
  )
}
