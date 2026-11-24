// src/components/cashRecon/Loyverse.jsx
//
// Loyverse POS link for Cash Reconciliation (migration 154).
//
//   LoyverseSettings     Cash Recon settings > Loyverse: the field mapping
//                        (each income source, SC source and payment channel
//                        = a +/- list of Loyverse figures), one explicit
//                        Save. The account (access token) and the venue's
//                        store and trading day are on the Integrations page
//                        (pages/Integrations.jsx, migration 288).
//   LoyverseFillButton   "Fill from Loyverse" on the day view and the week
//                        grid; opens LoyverseFillModal: Loyverse figures
//                        next to what Cash Recon has, tick days, Fill.
//
// Figures and labels come from shared/loyverse.js; the server works the
// figures out again from the stored receipts on Fill (sales import phase 4:
// nothing is read from Loyverse live), so what is written never comes from
// the browser. A day not synced yet shows Sync now instead of zeros.
// The mapping editor and the fill window are shared with GloriaFood
// (reconShared.jsx).

import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Loader2, X, Check, AlertTriangle, Search, Download, Wand2, Plug,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TOTAL_KINDS, REF_KINDS, termLabel } from '@shared/loyverse.js'
import {
  money, useReconLinkPerms, Card, inputCls, btn, btnPrimary, btnOutline,
  MappingGroups, SummaryRow, ReconFillModal,
} from './reconShared'

const useLoyversePerms = useReconLinkPerms

export function useLoyverseLink(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['loyverse-link', venueId],
    queryFn:  () => api.get(`/loyverse/venues/${venueId}/link`),
    enabled:  !!venueId,
    staleTime: 60_000,
  })
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function LoyverseSettings({ venueId, config }) {
  const { canSetup, ready } = useLoyversePerms()
  const { data: linkRes, isLoading } = useLoyverseLink(venueId)
  const link = linkRes?.link ?? null
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Fill a day&apos;s income, service charges and takings from this venue&apos;s Loyverse sales instead of
        typing them in. Map each Cash Recon line to Loyverse figures below (for example Gross sales minus the
        Gratuity item, or a payment type), then use <strong>Fill from Loyverse</strong> on a day or week.
      </p>
      {ready && !canSetup && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Only owners and admins can change the Loyverse mapping. You can see it here.
        </div>
      )}
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {!isLoading && !link && (
        <Card title="This venue">
          <p className="text-sm text-muted-foreground">
            This venue isn&apos;t linked to a Loyverse store yet. Add the Loyverse account and link the venue to its
            store on the Integrations page, then come back here to map the figures.
          </p>
          <Link to="/integrations" className={cn(btnOutline, 'w-fit')}><Plug className="w-4 h-4" /> Open Integrations</Link>
        </Card>
      )}
      {link && <MappingCard venueId={venueId} config={config} link={link} canSetup={canSetup} />}
    </div>
  )
}

function MappingCard({ venueId, config, link, canSetup }) {
  const api = useApi()
  const qc = useQueryClient()
  const base = useMemo(() => ({ income: {}, takings: {}, sc: {}, ...(link.mappings || {}) }), [link])
  const [draft, setDraft] = useState(base)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [picker, setPicker] = useState(null)       // { group, id, name }
  const [matchNote, setMatchNote] = useState(null)
  useEffect(() => { setDraft(base); setError(null) }, [base, venueId])
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)

  const { data: catalog, isLoading: catalogLoading, error: catalogError } = useQuery({
    queryKey: ['loyverse-catalog', link.connection_id],
    queryFn:  () => api.get(`/loyverse/connections/${link.connection_id}/catalog`),
    enabled:  canSetup,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const names = useMemo(() => ({
    item:         Object.fromEntries((catalog?.items ?? []).map(x => [x.id, x.name])),
    category:     Object.fromEntries((catalog?.categories ?? []).map(x => [x.id, x.name])),
    payment_type: Object.fromEntries((catalog?.payment_types ?? []).map(x => [x.id, x.name])),
  }), [catalog])

  const setField = (group, id, terms) => setDraft(p => {
    const g = { ...(p[group] || {}) }
    if (terms.length) g[id] = terms
    else delete g[id]
    return { ...p, [group]: g }
  })
  const termsOf = (group, id) => draft[group]?.[id] || []

  function matchPaymentTypes() {
    const norm = s => String(s || '').trim().toLowerCase()
    let n = 0
    const next = { ...(draft.takings || {}) }
    for (const ch of (config?.payment_channels ?? []).filter(c => c.is_active)) {
      if (next[ch.id]?.length) continue
      const pt = (catalog?.payment_types ?? []).find(p => norm(p.name) === norm(ch.name))
      if (pt) { next[ch.id] = [{ sign: 1, kind: 'payment_type', ref: pt.id, label: pt.name }]; n++ }
    }
    setDraft(p => ({ ...p, takings: next }))
    setMatchNote(n ? `Matched ${n} payment ${n === 1 ? 'channel' : 'channels'} by name. Save to keep.` : 'No unmapped channel has the same name as a Loyverse payment type.')
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await api.put(`/loyverse/venues/${venueId}/mappings`, { mappings: draft })
      await qc.invalidateQueries({ queryKey: ['loyverse-link', venueId] })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      setMatchNote(null)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const readOnly = !canSetup

  return (
    <>
      <Card title="This venue">
        <p className="text-sm">
          Linked to <strong>{link.store_name || link.store_id}</strong> on <strong>{link.connection_name}</strong>;
          the trading day starts at <strong>{link.day_starts_at}</strong>.
        </p>
        <Link to="/integrations" className={cn(btnOutline, 'w-fit')}><Plug className="w-4 h-4" /> Change on Integrations</Link>
        {catalogError && (
          <p className="text-sm text-destructive flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{catalogError.message}</p>
        )}
      </Card>

      <Card title="Field mapping">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Each line below is filled with the sum of the Loyverse figures you add to it. Tap <strong>+</strong> or
          <strong> −</strong> on a figure to switch between adding and subtracting it. Lines with nothing added are
          never changed by a fill.
        </p>
        <MappingGroups
          config={config}
          mappings={draft}
          termLabel={t => termLabel(t, names)}
          readOnly={readOnly}
          emptyText="Not filled from Loyverse"
          onChange={setField}
          onAdd={(group, f) => setPicker({ group, id: f.id, name: f.name })}
          groupAction={group => group === 'takings' && (
            <div className="flex flex-col items-end gap-1">
              {canSetup && catalog && (
                <button type="button" onClick={matchPaymentTypes} className={btnOutline}>
                  <Wand2 className="w-4 h-4" /> Match payment types by name
                </button>
              )}
              {matchNote && <p className="text-sm text-muted-foreground">{matchNote}</p>}
            </div>
          )}
        />
      </Card>

      {canSetup && (
        <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background border-t flex flex-wrap items-center gap-2">
          <div className="ml-auto flex items-center gap-3">
            {error && <span className="text-sm text-destructive">{error}</span>}
            {saved && <span className="text-sm text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
            {dirty && <button type="button" onClick={() => setDraft(base)} className={btnOutline}>Discard</button>}
            <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}

      {picker && (
        <TermPicker
          fieldName={picker.name}
          catalog={catalog}
          catalogLoading={catalogLoading}
          onClose={() => setPicker(null)}
          onPick={term => { setField(picker.group, picker.id, [...termsOf(picker.group, picker.id), term]); setPicker(null) }}
        />
      )}
    </>
  )
}

const ITEM_LIMIT = 60

function TermPicker({ fieldName, catalog, catalogLoading, onPick, onClose }) {
  const [sign, setSign] = useState(1)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const match = name => !needle || String(name).toLowerCase().includes(needle)
  const totals = Object.entries(TOTAL_KINDS).filter(([, v]) => match(v.label))
  const payments = (catalog?.payment_types ?? []).filter(p => match(p.name))
  const categories = (catalog?.categories ?? []).filter(c => match(c.name))
  const items = (catalog?.items ?? []).filter(i => match(i.name))

  const pick = (kind, ref, label) => onPick({ sign, kind, ...(ref ? { ref, label } : {}) })

  const Option = ({ onClick, title, hint }) => (
    <button type="button" onClick={onClick}
      className="w-full min-h-[48px] text-left px-3 py-2 rounded-xl hover:bg-muted touch-manipulation">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Add to {fieldName}</span>
            <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-muted touch-manipulation"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[[1, 'Add (+)'], [-1, 'Subtract (−)']].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setSign(v)} aria-pressed={sign === v}
                className={cn(btn, 'border', sign === v ? (v > 0 ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600') : 'hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search figures, payment types, items…" className={cn(inputCls, 'pl-9')} />
          </div>
        </div>
        <div className="overflow-y-auto p-2 space-y-3">
          {totals.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day totals</div>
              {totals.map(([k, v]) => <Option key={k} title={v.label} hint={v.hint} onClick={() => pick(k)} />)}
            </div>
          )}
          {catalogLoading && <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading from Loyverse…</div>}
          {!catalogLoading && !catalog && <div className="px-3 py-2 text-sm text-muted-foreground">Payment types and items show once the account and store load.</div>}
          {payments.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment types</div>
              {payments.map(p => <Option key={p.id} title={p.name} hint={REF_KINDS.payment_type.hint} onClick={() => pick('payment_type', p.id, p.name)} />)}
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</div>
              {categories.map(c => <Option key={c.id} title={c.name} hint={REF_KINDS.category.hint} onClick={() => pick('category', c.id, c.name)} />)}
            </div>
          )}
          {items.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</div>
              {items.slice(0, ITEM_LIMIT).map(i => <Option key={i.id} title={i.name} onClick={() => pick('item', i.id, i.name)} />)}
              {items.length > ITEM_LIMIT && <div className="px-3 py-2 text-xs text-muted-foreground">{items.length - ITEM_LIMIT} more: search to find them.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fill from Loyverse ───────────────────────────────────────────────────────

export function LoyverseFillButton({ venueId, dates, onApplied, compact, className }) {
  const { canFill } = useLoyversePerms()
  const { data } = useLoyverseLink(venueId)
  const [open, setOpen] = useState(false)
  if (!data?.link || !canFill || !dates?.length) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn(compact
          ? 'h-8 px-3 rounded-lg border text-xs font-semibold touch-manipulation hover:bg-muted flex items-center gap-1.5 whitespace-nowrap'
          : 'h-10 px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-2 whitespace-nowrap',
          className)}>
        <Download className={compact ? 'w-3 h-3' : 'w-4 h-4'} /> Fill from Loyverse
      </button>
      {open && <LoyverseFillModal venueId={venueId} dates={dates} onClose={() => setOpen(false)} onApplied={onApplied} />}
    </>
  )
}

const LOYVERSE = { name: 'Loyverse', path: '/loyverse', valueKey: 'loyverse', settingsHint: 'Cash Recon settings > Loyverse' }

/**
 * Days nothing has synced for yet (the fill reads the stored receipts, sales
 * import phase 4): they are never filled with zeros. Sync now asks for a
 * sync of the venue's account; Read again shows what came in.
 */
function NotSyncedNotice({ venueId, days, refetch }) {
  const api = useApi()
  const [state, setState] = useState(null)       // null | 'busy' | 'asked' | error text
  if (!days.length) return null
  async function syncNow() {
    setState('busy')
    try { await api.post(`/loyverse/venues/${venueId}/sync`, {}); setState('asked') } catch (e) { setState(e.message) }
  }
  const label = d => format(new Date(d.date + 'T12:00:00'), 'EEE d MMM')
  return (
    <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex flex-wrap items-center gap-3" data-testid="loyverse-not-synced">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-[200px]">
        Loyverse hasn't synced {days.length === 1 ? 'this day' : 'these days'} yet ({days.map(label).join(', ')}), so there is nothing to fill from.
        {state === 'asked' && ' Sync asked for: press Read again in a minute.'}
        {state && !['busy', 'asked'].includes(state) && <span className="text-destructive"> {state}</span>}
      </div>
      {state === 'asked'
        ? <button type="button" onClick={() => refetch()} className={btnOutline}>Read again</button>
        : <button type="button" onClick={syncNow} disabled={state === 'busy'} className={btnOutline}>
            {state === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />} Sync now
          </button>}
    </div>
  )
}

export function LoyverseFillModal({ venueId, dates, onClose, onApplied }) {
  return (
    <ReconFillModal
      source={LOYVERSE} venueId={venueId} dates={dates} onClose={onClose} onApplied={onApplied}
      termLabel={t => termLabel(t)}
      subtitle={data => [data.store_name, 'Trading day from ' + data.day_starts_at,
        data.synced_to ? 'Synced to ' + format(new Date(data.synced_to), 'd MMM HH:mm') : 'Not synced yet'].filter(Boolean).join(' · ')}
      hasSales={d => d.sales + d.refund_receipts > 0}
      fillable={d => d.synced !== false}
      notices={(data, refetch) => <NotSyncedNotice venueId={venueId} days={data.days.filter(d => d.synced === false)} refetch={refetch} />}
      summary={(days, currency) => (
        <>
          <SummaryRow label="Receipts" days={days} render={d => d.sales + (d.refund_receipts ? ` + ${d.refund_receipts} refund${d.refund_receipts === 1 ? '' : 's'}` : '')} />
          <SummaryRow label="Gross sales" days={days} render={d => money(d.totals.gross_sales, currency)} />
          <SummaryRow label="Net sales" days={days} render={d => money(d.totals.net_sales, currency)} />
          <SummaryRow label="Total collected" days={days} render={d => money(d.totals.total_collected, currency)} />
          <SummaryRow label="Payment types not mapped" days={days} render={d => {
            const un = d.payments.filter(p => !p.mapped && Math.abs(p.amount) >= 0.005)
            if (!un.length) return <span className="text-muted-foreground">—</span>
            return <span className="text-amber-700">{un.map(p => p.name + ' ' + money(p.amount, currency)).join(', ')}</span>
          }} />
        </>
      )}
    />
  )
}
