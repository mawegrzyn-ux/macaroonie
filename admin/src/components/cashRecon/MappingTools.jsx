// src/components/cashRecon/MappingTools.jsx
//
// The Item mapping page's helpers (sales from other tills, phase 3,
// docs/SALES_IMPORT.md 4.3 and 4.5), for one venue at a time:
//   Suggestions   matches for what is still unmapped (codes, then names;
//                 shared/itemMatch.js on the server), those at or above the
//                 threshold ticked; nothing is saved until Accept
//   Pepper        proposals for what is left (one model call per batch)
//   Learning      after accepting, a group with the same shape is offered
//                 as one pattern rule
//   Create missing dishes, Copy from another venue
// Every save goes through the API's rule checks (cleanRule()); the page
// only says what to save.

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check, Sparkles } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Card, btnPrimary, btnOutline } from '@/components/cashRecon/reconShared'

export const pence = p => (p < 0 ? '-' : '') + '£' + (Math.abs(Number(p) || 0) / 100).toFixed(2)
const pct = s => Math.round((Number(s) || 0) * 100) + '%'
export const thingName = t => t.name + (t.variant_name ? ' · ' + t.variant_name : '') + (t.group ? ' (' + t.group + ')' : '')

/** Refresh what a rule change shows. */
export function useRefreshMapping() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['item-mapping', 'item-mapping-coverage', 'item-mapping-suggest', 'item-mapping-menu']) qc.invalidateQueries({ queryKey: [k] })
  }
}

function Tick({ on, onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label} data-testid="proposal-tick"
      className={cn('h-12 w-12 shrink-0 rounded-xl border flex items-center justify-center touch-manipulation',
        on ? 'bg-primary border-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
      {on && <Check className="w-5 h-5" />}
    </button>
  )
}

/**
 * A list of proposed rules to accept one by one or ticked in bulk. rows:
 * [{ key, title, sub, choices: [{ label, score, reason, rule }], ticked }].
 * onAccept(rules) saves them (the bulk route) and returns its answer.
 */
export function ProposalRows({ rows, canManage, onAccept, testid = 'proposal-row', acceptLabel = 'Accept ticked' }) {
  const [ticked, setTicked] = useState(() => Object.fromEntries(rows.map(r => [r.key, !!r.ticked])))
  const [choice, setChoice] = useState({})
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const chosen = r => r.choices[choice[r.key] || 0]
  const tickedRows = rows.filter(r => ticked[r.key])
  async function accept(list) {
    setBusy(list.length === 1 ? list[0].key : 'all'); setErr('')
    try { await onAccept(list.map(r => ({ row: r, rule: chosen(r).rule }))) }
    catch (e) { setErr(e.message) }
    finally { setBusy(null) }
  }
  if (!rows.length) return null
  return (
    <div className="space-y-2">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={!tickedRows.length || !!busy} onClick={() => accept(tickedRows)} data-testid="accept-ticked">
            {busy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {acceptLabel} ({tickedRows.length})
          </button>
          <button type="button" className={btnOutline} disabled={!!busy}
            onClick={() => setTicked(Object.fromEntries(rows.map(r => [r.key, tickedRows.length < rows.length])))}>
            {tickedRows.length < rows.length ? 'Tick all' : 'Untick all'}
          </button>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {rows.map(r => {
        const c = chosen(r)
        return (
          <div key={r.key} className="rounded-xl border bg-background p-2 flex items-start gap-2" data-testid={testid}>
            {canManage && <Tick on={!!ticked[r.key]} label={'Tick ' + r.title} disabled={!!busy} onClick={() => setTicked(t => ({ ...t, [r.key]: !t[r.key] }))} />}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{r.title}</span>
                {r.sub && <span className="text-xs text-muted-foreground">{r.sub}</span>}
              </div>
              <div className="text-sm">→ <span className="font-medium">{c.label}</span>
                {c.score != null && <span className={cn('ml-2 text-[11px] font-semibold rounded-full px-2 py-0.5', c.score >= 0.9 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')}>{pct(c.score)}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{c.reason}</p>
              {r.choices.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {r.choices.map((o, i) => (
                    <button key={i} type="button" onClick={() => setChoice(x => ({ ...x, [r.key]: i }))} aria-pressed={(choice[r.key] || 0) === i}
                      className={cn('min-h-[40px] px-2.5 rounded-lg border text-xs touch-manipulation', (choice[r.key] || 0) === i ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                      {o.label}{o.score != null ? ' · ' + pct(o.score) : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canManage && (
              <button type="button" className={cn(btnOutline, 'px-3 shrink-0')} disabled={!!busy} onClick={() => accept([r])} data-testid="accept-one">
                {busy === r.key ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Accept'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** What a bulk save said: saved, refused (with why). */
export function SaveResult({ res }) {
  if (!res) return null
  return (
    <div className="text-sm space-y-1" data-testid="save-result">
      <p className="text-green-800">Saved {res.saved.length} {res.saved.length === 1 ? 'rule' : 'rules'}. The stored sales follow in the background.</p>
      {res.failed.map(f => <p key={f.index} className="text-destructive">{f.name ? f.name + ': ' : ''}{f.error}</p>)}
    </div>
  )
}

// ── Suggestions ──────────────────────────────────────────────────────────────

export function Suggestions({ connectionId, venueId, canManage, onSaved }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [res, setRes] = useState(null)
  const q = useQuery({
    queryKey: ['item-mapping-suggest', connectionId, venueId],
    queryFn: () => api.get(`/integrations/mapping/${connectionId}/suggestions?venue_id=${venueId}`),
    enabled: !!connectionId && !!venueId,
  })
  const rows = useMemo(() => (q.data?.suggestions || []).map(s => ({
    key: s.key, title: thingName(s), ticked: s.auto,
    sub: [s.sku, s.price_pence != null && pence(s.price_pence), s.sales?.net_pence ? pence(s.sales.net_pence) + ' sold' : ''].filter(Boolean).join(' · '),
    choices: [{ label: s.label, score: s.score, reason: s.reason, rule: s.rule }, ...s.others],
  })), [q.data])
  async function accept(list) {
    const out = await api.post(`/integrations/mapping/${connectionId}/rules/bulk`, { rules: list.map(x => x.rule) })
    out.failed = out.failed.map(f => ({ ...f, name: list[f.index]?.row.title }))
    setRes(out)
    onSaved?.(out)
    refresh()
  }
  return (
    <Card title="Suggestions" action={<Sparkles className="w-4 h-4 text-muted-foreground" />}>
      {!venueId && <p className="text-sm text-muted-foreground">Pick a venue above: suggestions come from the menus it sells.</p>}
      {venueId && q.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {q.data && (
        <>
          <p className="text-xs text-muted-foreground">
            Matched by product code or barcode first, then by name; price and category break ties. Those at
            {' '}{pct(q.data.threshold)} or more are ticked. Nothing is saved until you accept: each becomes a rule for this venue.
          </p>
          <SaveResult res={res} />
          {!rows.length && <p className="text-sm text-muted-foreground">No suggestions: everything open has no match on this venue&apos;s menus.</p>}
          <ProposalRows key={q.dataUpdatedAt} rows={rows} canManage={canManage} onAccept={accept} testid="suggestion-row" />
          {q.data.unmatched.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="unmatched-count">
              {q.data.unmatched.length} {q.data.unmatched.length === 1 ? 'thing' : 'things'} found no match. Ask Pepper below, or create the missing dishes.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
