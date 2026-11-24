// src/components/ai/RuleSettings.jsx
//
// Rules made from a sentence (Pepper-first step 8B2, migration 286), on the
// Settings page: the group's rules in words, each with its last run, switched
// off or on, deleted with a second tap; and a box that reads a sentence into a
// rule (POST /api/ai/rules/parse, one model call), shown as a card that is
// saved only on Confirm (POST /api/ai/rules). Pepper's make_rule does the same
// in the chat. What a rule is: shared/rules.js. View on Pepper reads the list;
// Manage changes it.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const btn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50'
const STATUS = { done: 'Ran', failed: 'Failed', capped: 'Skipped (its most for the day)', running: 'Running' }

function Toggle({ on, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors touch-manipulation disabled:opacity-50',
        on ? 'bg-primary' : 'bg-muted-foreground/30')}>
      <span className={cn('inline-block h-6 w-6 rounded-full bg-white shadow transition-transform', on ? 'translate-x-7' : 'translate-x-1')} />
    </button>
  )
}

function RuleRow({ rule, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [sure, setSure] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-rules'] })
  const flip = useMutation({ mutationFn: enabled => api.patch('/ai/rules/' + rule.id, { enabled }), onSuccess: refresh })
  const del = useMutation({ mutationFn: () => api.delete('/ai/rules/' + rule.id), onSuccess: refresh })
  return (
    <div className="py-3 space-y-2" data-testid="rule-row" data-name={rule.name}>
      <div className="flex items-start gap-3">
        <Zap className={cn('w-4 h-4 mt-1 shrink-0', rule.enabled ? 'text-primary' : 'text-muted-foreground')} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{rule.name}</p>
          {rule.sentence && <p className="text-xs text-muted-foreground italic">"{rule.sentence}"</p>}
          <ul className="mt-1 text-xs text-muted-foreground space-y-0.5" data-testid="rule-lines">
            {rule.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <p className="mt-1 text-xs" data-testid="rule-last-run">
            {rule.last_run
              ? <>{STATUS[rule.last_run.status] || rule.last_run.status} {new Date(rule.last_run.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{rule.last_run.message ? ': ' + rule.last_run.message : ''}</>
              : <span className="text-muted-foreground">Hasn't run yet</span>}
            {rule.runs_24h > 0 && <span className="text-muted-foreground"> ({rule.runs_24h} in the last day)</span>}
          </p>
          {rule.created_by_name && <p className="text-[11px] text-muted-foreground">Runs as {rule.created_by_name}</p>}
        </div>
        <Toggle on={rule.enabled} disabled={!canManage || flip.isPending} onChange={v => flip.mutate(v)}
          label={(rule.enabled ? 'Switch off ' : 'Switch on ') + rule.name} />
      </div>
      {canManage && (
        <div className="flex justify-end">
          {!sure ? (
            <button type="button" className={cn(btn, 'border text-destructive')} onClick={() => setSure(true)} data-testid="rule-delete">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-destructive">Delete this rule? What it already did stays.</span>
              <button type="button" className={cn(btn, 'bg-destructive text-destructive-foreground')} disabled={del.isPending}
                onClick={() => del.mutate()} data-testid="rule-delete-yes">Delete</button>
              <button type="button" className={cn(btn, 'border')} onClick={() => setSure(false)}>Keep</button>
            </span>
          )}
        </div>
      )}
      {(flip.error || del.error) && <p className="text-sm text-destructive">{(flip.error || del.error).message}</p>}
    </div>
  )
}

/** The sentence box: read by Pepper, shown as a card, saved only on Confirm. */
function NewRule() {
  const api = useApi()
  const qc = useQueryClient()
  const [sentence, setSentence] = useState('')
  const [draft, setDraft] = useState(null)
  const read = useMutation({ mutationFn: () => api.post('/ai/rules/parse', { sentence }), onSuccess: setDraft })
  const save = useMutation({
    mutationFn: () => api.post('/ai/rules', { rule: draft.rule, sentence }),
    onSuccess: () => { setDraft(null); setSentence(''); qc.invalidateQueries({ queryKey: ['ai-rules'] }) },
  })
  return (
    <div className="pt-3 border-t space-y-2" data-testid="rule-new">
      <label htmlFor="rule-sentence" className="text-sm font-medium">Make a rule from a sentence</label>
      <textarea id="rule-sentence" rows={2} value={sentence} maxLength={500} disabled={read.isPending || !!draft}
        onChange={e => setSentence(e.target.value)} data-testid="rule-sentence"
        placeholder={'e.g. When a fridge reads above 8, add an H&S action for the manager'}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation" />
      {!draft && (
        <button type="button" className={cn(btn, 'bg-primary text-primary-foreground')} disabled={sentence.trim().length < 8 || read.isPending}
          onClick={() => read.mutate()} data-testid="rule-read">
          {read.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Read it with {ASSISTANT_NAME}
        </button>
      )}
      {read.error && <p className="text-sm text-destructive" data-testid="rule-read-error">{read.error.message}</p>}
      {draft && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-2" data-testid="rule-card">
          <p className="text-sm font-semibold">Make the rule "{draft.rule.name}"?</p>
          <ul className="text-sm space-y-0.5">{draft.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="text-xs text-muted-foreground">It runs as you, with your access, each time it holds. Nothing is kept until you confirm.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={cn(btn, 'bg-primary text-primary-foreground')} disabled={save.isPending}
              onClick={() => save.mutate()} data-testid="rule-confirm">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Make rule
            </button>
            <button type="button" className={cn(btn, 'border')} onClick={() => setDraft(null)} data-testid="rule-cancel">
              <X className="w-4 h-4" /> Not this
            </button>
          </div>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
        </div>
      )}
    </div>
  )
}

export function RuleSettings() {
  const api = useApi()
  const { canView, canManage } = usePermission('ai_assistant')
  const { data, isLoading, error } = useQuery({ queryKey: ['ai-rules'], queryFn: () => api.get('/ai/rules'), enabled: canView })
  if (!canView) return null
  return (
    <div className="bg-background border rounded-xl overflow-hidden" data-testid="rule-settings">
      <div className="px-5 py-3 section-head">
        <h3 className="text-sm font-semibold">Rules</h3>
      </div>
      <div className="px-5 pb-4">
        <p className="pt-3 text-xs text-muted-foreground">
          Things the app does by itself when something happens. A rule can only add an H&S action or send a notice to
          people's phones: never money, pay, prices, allergens, deletions or anything about a person.
        </p>
        {isLoading && <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {error && <p className="py-3 text-sm text-destructive">{error.message}</p>}
        {data && !data.rules.length && <p className="py-3 text-sm text-muted-foreground">No rules yet.</p>}
        <div className="divide-y">
          {(data?.rules || []).map(r => <RuleRow key={r.id} rule={r} canManage={canManage} />)}
        </div>
        {canManage && <NewRule />}
      </div>
    </div>
  )
}

export default RuleSettings
