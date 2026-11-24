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
import { Loader2, Check, Sparkles, Wand2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/staff/shared'
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
          <Offers connectionId={connectionId} offers={res?.offers} canManage={canManage} />
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

// ── Learning ─────────────────────────────────────────────────────────────────

/** Offers after accepting (learnOffers() on the server): one rule for a group with the same shape. */
export function Offers({ connectionId, offers, canManage, onDone }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState({})
  const [err, setErr] = useState('')
  const left = (offers || []).filter(o => !done[o.key])
  if (!left.length || !canManage) return null
  async function take(o) {
    setBusy(o.key); setErr('')
    try {
      if (o.replaces) await api.put(`/integrations/mapping/${connectionId}/rules/${o.replaces}`, o.rule)
      else await api.post(`/integrations/mapping/${connectionId}/rules`, o.rule)
      setDone(d => ({ ...d, [o.key]: 'saved' }))
      refresh()
      onDone?.()
    } catch (e) { setErr(e.message) }
    finally { setBusy(null) }
  }
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2" data-testid="learn-offers">
      <p className="text-sm font-semibold flex items-center gap-2"><Wand2 className="w-4 h-4" /> Make it a pattern rule?</p>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {left.map(o => (
        <div key={o.key} className="flex flex-wrap items-center gap-2" data-testid="learn-offer">
          <p className="text-sm flex-1 min-w-[12rem]">{o.title}</p>
          <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => take(o)} data-testid="learn-accept">
            {busy === o.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Make it a rule
          </button>
          <button type="button" className={btnOutline} disabled={!!busy} onClick={() => setDone(d => ({ ...d, [o.key]: 'no' }))}>No thanks</button>
        </div>
      ))}
    </div>
  )
}

// ── Pattern rules ────────────────────────────────────────────────────────────

const MATCHES = [
  { key: 'code:equals', label: 'Code is' }, { key: 'code:starts_with', label: 'Code starts with' },
  { key: 'name:contains', label: 'Name contains' }, { key: 'category:equals', label: 'Category is' },
]
export const patternWords = (r, categories = []) => {
  const cat = ref => categories.find(c => c.ref === ref)?.name || r.ext_name || 'a category no longer on the till'
  if (r.kind === 'bucket') return 'Category ' + cat(r.pattern_value) + ', not mapped otherwise'
  const m = MATCHES.find(x => x.key === r.pattern_field + ':' + r.pattern_op)
  return (m ? m.label : 'Matches') + ' ' + (r.pattern_field === 'category' ? cat(r.pattern_value) : '"' + r.pattern_value + '"')
}

const field = 'h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation'

/**
 * A pattern rule (code, name or category -> one of our dishes) or a bucket
 * (category -> one of our sections, for reports), in a sheet. draft: the
 * rule; data: the catalogue view; menu: our menus at the venue.
 */
export function PatternEditor({ draft, data, menu, connectionId, venueId, canManage, onClose }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [r, setR] = useState(() => ({ pattern_field: 'name', pattern_op: 'contains', pattern_value: '', ...draft,
    venue_id: draft.id ? draft.venue_id : (venueId || null) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = patch => setR(x => ({ ...x, ...patch }))
  const dishes = (menu?.menus || []).flatMap(m => m.sections.flatMap(s => s.items.map(i => ({ ...i, where: m.name + ' · ' + s.title }))))
  const sections = (menu?.menus || []).flatMap(m => m.sections.map(s => ({ id: s.id, label: m.name + ' · ' + s.title })))
  const matchKey = r.kind === 'bucket' ? 'category:equals' : r.pattern_field + ':' + r.pattern_op
  const ro = !canManage
  function body() {
    const b = { kind: r.kind, venue_id: r.venue_id || null, pattern_value: r.pattern_value || null, effective_from: r.effective_from || null, note: r.note || null }
    if (r.kind === 'bucket') return { ...b, target_section_id: r.target_section_id || null }
    const dish = dishes.find(d => d.id === (r.target_combo_id || r.target_item_id))
    return { ...b, pattern_field: r.pattern_field, pattern_op: r.pattern_op,
      target_item_id: dish?.kind === 'combo' ? null : dish?.id || null, target_combo_id: dish?.kind === 'combo' ? dish.id : null,
      target_option_ids: r.target_option_ids || [], target_item_ids: r.target_item_ids || [] }
  }
  async function save() {
    setBusy(true); setErr('')
    try {
      if (r.id) await api.put(`/integrations/mapping/${connectionId}/rules/${r.id}`, body())
      else await api.post(`/integrations/mapping/${connectionId}/rules`, body())
      refresh(); onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true); setErr('')
    try { await api.delete(`/integrations/mapping/${connectionId}/rules/${r.id}`); refresh(); onClose() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const footer = canManage ? (
    <>
      <button type="button" className={btnPrimary} onClick={save} disabled={busy} data-testid="pattern-save">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save rule
      </button>
      {r.id && !confirmDelete && <button type="button" className={btnOutline} onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</button>}
      {r.id && confirmDelete && (
        <>
          <button type="button" className={cn(btnOutline, 'border-destructive text-destructive')} onClick={remove} disabled={busy}>Yes, delete this rule</button>
          <button type="button" className={btnOutline} onClick={() => setConfirmDelete(false)} disabled={busy}>Keep it</button>
        </>
      )}
    </>
  ) : null
  return (
    <Modal title={r.kind === 'bucket' ? 'Category to a section' : 'Pattern rule'} onClose={onClose} footer={footer}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
        {[{ key: 'pattern', label: 'Map to a dish' }, { key: 'bucket', label: 'Count under a section' }].map(k => (
          <button key={k.key} type="button" disabled={ro || !!r.id} aria-pressed={r.kind === k.key}
            onClick={() => set(k.key === 'bucket' ? { kind: 'bucket', pattern_field: 'category', pattern_op: 'equals', pattern_value: '' } : { kind: 'pattern' })}
            className={cn('min-h-[48px] px-3 rounded-xl border text-sm touch-manipulation', r.kind === k.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {r.kind === 'bucket'
          ? 'Lines in this category that no other rule maps are counted under one of your menu sections in reports, not as a dish.'
          : 'Lines that no rule maps by item are matched by this, most specific first: code is, code starts with, name contains, category.'}
      </p>
      {r.kind !== 'bucket' && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Match</span>
          <select className={field} value={matchKey} disabled={ro} aria-label="Match"
            onChange={e => { const [f, o] = e.target.value.split(':'); set({ pattern_field: f, pattern_op: o, pattern_value: '' }) }}>
            {MATCHES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      )}
      {matchKey === 'category:equals' ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Category on the other till</span>
          <select className={field} value={r.pattern_value || ''} disabled={ro} onChange={e => set({ pattern_value: e.target.value })} aria-label="Category">
            <option value="">Choose</option>
            {(data.categories || []).map(c => <option key={c.ref} value={c.ref}>{c.name}</option>)}
          </select>
        </label>
      ) : (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{r.pattern_field === 'code' ? 'Code (SKU or barcode)' : 'Words in the name'}</span>
          <input className={field} value={r.pattern_value || ''} disabled={ro} onChange={e => set({ pattern_value: e.target.value })} aria-label="Pattern" data-testid="pattern-value" />
        </label>
      )}
      {r.kind === 'bucket' ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Our section</span>
          <select className={field} value={r.target_section_id || ''} disabled={ro} onChange={e => set({ target_section_id: e.target.value })} aria-label="Section">
            <option value="">Choose</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      ) : (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Our dish</span>
          <select className={field} value={r.target_combo_id || r.target_item_id || ''} disabled={ro} aria-label="Dish" data-testid="pattern-dish"
            onChange={e => set({ target_item_id: e.target.value, target_combo_id: null })}>
            <option value="">Choose</option>
            {dishes.map(d => <option key={d.id} value={d.id}>{d.name} ({d.where})</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-3 min-h-[48px]">
        <input type="checkbox" className="h-5 w-5" checked={!r.venue_id} disabled={ro || !venueId || !!r.id}
          onChange={e => set({ venue_id: e.target.checked ? null : venueId })} />
        <span className="text-sm">Every venue on the connection{!venueId ? '' : ' (otherwise this venue only)'}</span>
      </label>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

// ── Create missing dishes ────────────────────────────────────────────────────

/**
 * Our dishes made from what is still unmapped at the venue, in one section
 * of a menu it sells; an item's variants become an option group with the
 * dish's own prices, and the rules are saved as they are made. Needs Menus
 * manage too.
 */
export function CreateMissing({ connectionId, venueId, menu, canManage, canMenus }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [picked, setPicked] = useState({})
  const [sectionId, setSectionId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const q = useQuery({
    queryKey: ['item-mapping-suggest', connectionId, venueId],
    queryFn: () => api.get(`/integrations/mapping/${connectionId}/suggestions?venue_id=${venueId}`),
    enabled: !!connectionId && !!venueId && canManage,
  })
  const items = useMemo(() => {
    const all = [...(q.data?.suggestions || []), ...(q.data?.unmatched || [])].filter(t => t.kind !== 'option')
    const byItem = new Map()
    for (const t of all) {
      if (!byItem.has(t.item_ref)) byItem.set(t.item_ref, { item_ref: t.item_ref, name: t.name, keys: [], variants: [], price: null, sales: 0 })
      const it = byItem.get(t.item_ref)
      it.keys.push(t.key)
      if (t.variant_name) it.variants.push(t.variant_name)
      if (t.price_pence != null) it.price = it.price == null ? t.price_pence : Math.min(it.price, t.price_pence)
      it.sales += t.sales?.net_pence || 0
    }
    return [...byItem.values()].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
  }, [q.data])
  const sections = (menu?.menus || []).flatMap(m => m.sections.map(s => ({ id: s.id, label: m.name + ' · ' + s.title })))
  if (!venueId || !canManage) return null
  const chosen = items.filter(i => picked[i.item_ref])
  const section = sections.find(s => s.id === sectionId)
  async function create() {
    setBusy(true); setErr('')
    try {
      const out = await api.post(`/integrations/mapping/${connectionId}/create-dishes`, { venue_id: venueId, section_id: sectionId, keys: chosen.flatMap(i => i.keys) })
      setRes(out); setPicked({}); setConfirm(false)
      refresh()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Card title="Create missing dishes">
      <p className="text-xs text-muted-foreground">
        For a venue moving to your menus: tick what the other till sells that you don&apos;t have, choose a section, and
        the dishes are made with the till&apos;s prices (its variants as an option group with this dish&apos;s own prices) and
        mapped as they are made. They go into the menu&apos;s draft: publish the menu when you&apos;re ready.
      </p>
      {!canMenus && <p className="text-sm text-muted-foreground">Making dishes needs Menus manage as well.</p>}
      {res && (
        <div className="text-sm space-y-1" data-testid="create-result">
          <p className="text-green-800">Made {res.dishes.map(d => d.name).join(', ') || 'nothing'}{res.groups.filter(g => g.made).length ? '; new option groups ' + res.groups.filter(g => g.made).map(g => g.name).join(', ') : ''}. {res.rules.saved.length} rules saved.</p>
          {res.skipped.map(s => <p key={s.name} className="text-muted-foreground">{s.name}: {s.why}</p>)}
          {res.rules.failed.map(f => <p key={f.index} className="text-destructive">{f.error}</p>)}
        </div>
      )}
      {q.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {canMenus && items.length > 0 && (
        <>
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {items.map(i => (
              <div key={i.item_ref} className="flex items-center gap-2 rounded-xl border bg-background p-1.5" data-testid="missing-row">
                <Tick on={!!picked[i.item_ref]} label={'Tick ' + i.name} onClick={() => setPicked(p => ({ ...p, [i.item_ref]: !p[i.item_ref] }))} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{i.name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{i.variants.length ? i.variants.join(', ') : 'One price'}{i.price != null ? ' · from ' + pence(i.price) : ''}</span>
                </span>
              </div>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Into the section</span>
            <select className={field} value={sectionId} onChange={e => { setSectionId(e.target.value); setConfirm(false) }} aria-label="Section" data-testid="create-section">
              <option value="">Choose</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!confirm ? (
            <button type="button" className={btnPrimary} disabled={!chosen.length || !sectionId || busy} onClick={() => setConfirm(true)} data-testid="create-dishes">
              <Wand2 className="w-4 h-4" /> Create {chosen.length} {chosen.length === 1 ? 'dish' : 'dishes'}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Make {chosen.length} {chosen.length === 1 ? 'dish' : 'dishes'} in {section?.label}?</span>
              <button type="button" className={btnPrimary} onClick={create} disabled={busy} data-testid="create-confirm">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Yes, create them
              </button>
              <button type="button" className={btnOutline} onClick={() => setConfirm(false)} disabled={busy}>Not yet</button>
            </div>
          )}
        </>
      )}
      {q.data && !items.length && <p className="text-sm text-muted-foreground">Every item is mapped at this venue.</p>}
    </Card>
  )
}

// ── Copy from another venue ──────────────────────────────────────────────────

/** A venue's rules copied to this venue, re-pointed by name; a preview first, then Copy with a confirm. */
export function CopyFromVenue({ connectionId, venueId, venues, canManage, describe }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [from, setFrom] = useState('')
  const [plan, setPlan] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const others = (venues || []).filter(v => v.venue_id !== venueId)
  if (!venueId || !others.length) return null
  const body = () => ({ from_venue_id: from, to_venue_id: venueId })
  async function preview() {
    setBusy(true); setErr(''); setRes(null); setConfirm(false)
    try { setPlan(await api.post(`/integrations/mapping/${connectionId}/copy-preview`, body())) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function copy() {
    setBusy(true); setErr('')
    try { setRes(await api.post(`/integrations/mapping/${connectionId}/copy`, body())); setPlan(null); setConfirm(false); refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const Line = ({ c, tone }) => (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', tone)} data-testid="copy-line">
      <span className="font-medium">{describe(c.rule)}</span> <span className="text-muted-foreground">→ {c.target}</span>
      {c.why && <span className="block text-xs text-destructive">{c.why}</span>}
      {c.changed && <span className="block text-xs text-muted-foreground">Found by name on this venue&apos;s menus</span>}
    </div>
  )
  return (
    <Card title="Copy from another venue">
      <p className="text-xs text-muted-foreground">
        Copies another venue&apos;s own rules to this one, finding each dish, option and section by name on this
        venue&apos;s menus. You see what will be copied first; nothing is saved until you confirm.
      </p>
      <div className="flex flex-wrap gap-2">
        <select className={cn(field, 'w-auto flex-1 min-w-[12rem]')} value={from} onChange={e => { setFrom(e.target.value); setPlan(null) }} aria-label="Copy from" data-testid="copy-from">
          <option value="">Copy from</option>
          {others.map(v => <option key={v.venue_id} value={v.venue_id}>{v.venue_name}</option>)}
        </select>
        <button type="button" className={btnOutline} disabled={!from || busy} onClick={preview} data-testid="copy-preview">
          {busy && !plan ? <Loader2 className="w-4 h-4 animate-spin" /> : null} See what will be copied
        </button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {res && (
        <div className="text-sm" data-testid="copy-result">
          <p className="text-green-800">Copied {res.saved.length} {res.saved.length === 1 ? 'rule' : 'rules'}.</p>
          {res.unmatched.length > 0 && <p className="text-muted-foreground">{res.unmatched.length} couldn&apos;t be matched and were left out.</p>}
          {res.failed.map(f => <p key={f.index} className="text-destructive">{f.error}</p>)}
        </div>
      )}
      {plan && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{plan.copy.length} to copy</p>
          {plan.copy.map(c => <Line key={c.from_rule_id} c={c} />)}
          {plan.unmatched.length > 0 && <p className="text-sm font-medium">{plan.unmatched.length} can&apos;t be matched here</p>}
          {plan.unmatched.map(c => <Line key={c.from_rule_id} c={c} tone="bg-amber-50" />)}
          {plan.existing.length > 0 && <p className="text-xs text-muted-foreground">{plan.existing.length} this venue already has a rule for (left as they are).</p>}
          {canManage && plan.copy.length > 0 && (!confirm ? (
            <button type="button" className={btnPrimary} onClick={() => setConfirm(true)} disabled={busy} data-testid="copy-go">Copy {plan.copy.length} {plan.copy.length === 1 ? 'rule' : 'rules'}</button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Copy {plan.copy.length} rules to this venue?</span>
              <button type="button" className={btnPrimary} onClick={copy} disabled={busy} data-testid="copy-confirm">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Yes, copy them
              </button>
              <button type="button" className={btnOutline} onClick={() => setConfirm(false)} disabled={busy}>Not yet</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Pepper ───────────────────────────────────────────────────────────────────

export function PepperProposals({ connectionId, venueId, canManage, onSaved }) {
  const api = useApi()
  const refresh = useRefreshMapping()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [out, setOut] = useState(null)
  const [res, setRes] = useState(null)
  if (!venueId || !canManage) return null
  async function ask() {
    setBusy(true); setErr(''); setRes(null)
    try { setOut(await api.post(`/ai/sales-mapping/${connectionId}/propose`, { venue_id: venueId })) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  const rows = (out?.proposals || []).map(p => ({
    key: p.key, title: p.title, ticked: p.confidence >= 0.9, sub: p.kind === 'axis' ? 'An option axis' : '',
    choices: [{ label: p.label, score: p.confidence, reason: p.reason, rule: p.rule }],
  }))
  async function accept(list) {
    const r = await api.post(`/integrations/mapping/${connectionId}/rules/bulk`, { rules: list.map(x => x.rule) })
    r.failed = r.failed.map(f => ({ ...f, name: list[f.index]?.row.title }))
    setRes(r)
    setOut(o => ({ ...o, proposals: o.proposals.filter(p => !list.some((x, i) => x.row.key === p.key && r.saved.some(s => s.index === i))) }))
    onSaved?.(r)
    refresh()
  }
  return (
    <Card title="Ask Pepper" action={<Sparkles className="w-4 h-4 text-muted-foreground" />}>
      <p className="text-xs text-muted-foreground">
        Pepper looks at up to 40 of what&apos;s left (the suggestions above didn&apos;t tick them) beside this venue&apos;s menus and proposes
        a rule for each, with its reason and how sure it is. Uses your Pepper allowance. Nothing is saved until you accept.
      </p>
      <button type="button" className={btnOutline} onClick={ask} disabled={busy} data-testid="ask-pepper">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {out ? 'Ask again' : 'Ask Pepper about what\'s left'}
      </button>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <SaveResult res={res} />
      <Offers connectionId={connectionId} offers={res?.offers} canManage={canManage} />
      {out && (
        <>
          {!out.asked && <p className="text-sm text-muted-foreground">Nothing left to ask about.</p>}
          <ProposalRows key={JSON.stringify(rows.map(r => r.key))} rows={rows} canManage={canManage} onAccept={accept} testid="pepper-row" />
          {(out.couldnt.length > 0 || out.dropped.length > 0) && (
            <p className="text-xs text-muted-foreground">
              {out.couldnt.length > 0 && <>Pepper couldn&apos;t tell: {out.couldnt.map(thingName).join(', ')}. </>}
              {out.dropped.length > 0 && <>{out.dropped.length} {out.dropped.length === 1 ? 'answer was' : 'answers were'} left out (not on this venue&apos;s menus or not a rule we can save).</>}
            </p>
          )}
        </>
      )}
    </Card>
  )
}
