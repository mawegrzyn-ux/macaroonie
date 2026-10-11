// src/components/cashRecon/Loyverse.jsx
//
// Loyverse POS link for Cash Reconciliation (migration 154).
//
//   LoyverseSettings     Cash Recon settings > Loyverse: accounts (access
//                        tokens), this venue's store and trading day, and
//                        the field mapping (each income source, SC source
//                        and payment channel = a +/- list of Loyverse
//                        figures). One explicit Save for the venue part.
//   LoyverseFillButton   "Fill from Loyverse" on the day view and the week
//                        grid; opens LoyverseFillModal: Loyverse figures
//                        next to what Cash Recon has, tick days, Fill.
//
// Figures and labels come from shared/loyverse.js; the server reads
// Loyverse again on Fill, so what is written never comes from the browser.

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Loader2, Plus, X, Check, AlertTriangle, RefreshCw, Search, Lock, Trash2, Pencil, Download, Wand2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TOTAL_KINDS, REF_KINDS, termLabel } from '@shared/loyverse.js'

const GROUPS = [
  { key: 'income',  label: 'Income',                 configKey: 'income_sources',   empty: 'No active income sources.' },
  { key: 'sc',      label: 'Service charges & tips', configKey: 'sc_sources',       empty: 'No active service charge sources.' },
  { key: 'takings', label: 'Takings',                configKey: 'payment_channels', empty: 'No active payment channels.' },
]

const DAY_STARTS = Array.from({ length: 24 }, (_, i) => {
  const h = Math.floor(i / 2), m = i % 2 ? '30' : '00'
  return String(h).padStart(2, '0') + ':' + m
})

function money(n, currency = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(n ?? 0)
  } catch {
    return (n < 0 ? '-' : '') + '£' + Math.abs(n ?? 0).toFixed(2)
  }
}

function useLoyversePerms() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const level = me?.is_platform_admin ? 'manage' : (me?.permissions?.cash_recon ?? 'none')
  const canFill = level === 'manage'
  const canSetup = canFill && (!!me?.is_platform_admin || ['owner', 'admin'].includes(me?.role))
  return { canFill, canSetup, ready: !!me }
}

export function useLoyverseLink(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['loyverse-link', venueId],
    queryFn:  () => api.get(`/loyverse/venues/${venueId}/link`),
    enabled:  !!venueId,
    staleTime: 60_000,
  })
}

function Card({ title, action, children }) {
  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 section-head">
        <span className="text-sm font-semibold">{title}</span>
        {action}
      </div>
      <div className="p-4 bg-background space-y-3">{children}</div>
    </div>
  )
}

const inputCls = 'h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'
const btn = 'min-h-[48px] px-4 rounded-xl text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2'
const btnPrimary = cn(btn, 'bg-primary text-primary-foreground hover:bg-primary/90')
const btnOutline = cn(btn, 'border hover:bg-muted')

// ── Settings ─────────────────────────────────────────────────────────────────

export function LoyverseSettings({ venueId, config }) {
  const { canSetup, ready } = useLoyversePerms()
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Fill a day&apos;s income, service charges and takings from this venue&apos;s Loyverse sales instead of
        typing them in. Map each Cash Recon line to Loyverse figures below (for example Gross sales minus the
        Gratuity item, or a payment type), then use <strong>Fill from Loyverse</strong> on a day or week.
      </p>
      {ready && !canSetup && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Only owners and admins can set up Loyverse. You can see the setup here.
        </div>
      )}
      <AccountsCard canSetup={canSetup} />
      <VenueLinkCard venueId={venueId} config={config} canSetup={canSetup} />
    </div>
  )
}

function AccountsCard({ canSetup }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['loyverse-connections'],
    queryFn:  () => api.get('/loyverse/connections'),
  })
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title="Loyverse accounts"
      action={canSetup && !adding && (
        <button type="button" onClick={() => setAdding(true)} className={cn(btnOutline, 'bg-background')}>
          <Plus className="w-4 h-4" /> Add account
        </button>
      )}
    >
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {!isLoading && accounts.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No Loyverse account added yet.</p>
      )}
      {accounts.map(a => (
        <AccountRow key={a.id} account={a} canSetup={canSetup}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
            qc.invalidateQueries({ queryKey: ['loyverse-link'] })
            qc.invalidateQueries({ queryKey: ['loyverse-catalog', a.id] })
          }} />
      ))}
      {adding && (
        <AccountForm
          onCancel={() => setAdding(false)}
          onSave={async ({ name, token }) => {
            await api.post('/loyverse/connections', { name, access_token: token })
            qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
            setAdding(false)
          }}
        />
      )}
    </Card>
  )
}

function AccountForm({ initialName = '', tokenOnly, onSave, onCancel }) {
  const [name, setName] = useState(initialName)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ok = (tokenOnly || name.trim()) && token.trim().length >= 8

  async function save() {
    setBusy(true); setError(null)
    try { await onSave({ name: name.trim(), token: token.trim() }) } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
      {!tokenOnly && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Loyverse account" className={inputCls} />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-medium">{tokenOnly ? 'New access token' : 'Access token'}</span>
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
          placeholder="Paste the token from Loyverse" className={inputCls} />
      </label>
      <p className="text-xs text-muted-foreground leading-relaxed">
        In the Loyverse Back Office open <strong>Integrations &gt; Access tokens</strong>, add a token and paste it
        here. It is checked with Loyverse before it is saved and is never shown again.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnOutline}>Cancel</button>
        <button type="button" onClick={save} disabled={!ok || busy} className={btnPrimary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {tokenOnly ? 'Check and replace' : 'Check and save'}
        </button>
      </div>
    </div>
  )
}

function AccountRow({ account: a, canSetup, onChanged }) {
  const api = useApi()
  const [mode, setMode] = useState(null)          // null | 'token' | 'rename' | 'remove'
  const [name, setName] = useState(a.name)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  async function run(fn) {
    setBusy(true); setNote(null)
    try { await fn() } catch (e) { setNote({ error: true, text: e.message }) }
    setBusy(false)
  }

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{a.name}</div>
          <div className="text-xs text-muted-foreground">
            {[a.business_name, a.currency, 'Token ending ' + a.token_hint].filter(Boolean).join(' · ')}
            {a.venue_count > 0 && ' · ' + a.venue_count + (a.venue_count === 1 ? ' venue' : ' venues')}
          </div>
          {a.last_error
            ? <div className="mt-1 text-xs text-destructive flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{a.last_error}</div>
            : a.last_checked_at && <div className="mt-1 text-xs text-green-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" />Working, checked {format(new Date(a.last_checked_at), 'd MMM HH:mm')}</div>}
        </div>
        {canSetup && !mode && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={btnOutline}
              onClick={() => run(async () => {
                const r = await api.post(`/loyverse/connections/${a.id}/test`)
                setNote(r.ok ? { text: 'The token works.' } : { error: true, text: r.error })
                onChanged()
              })}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check
            </button>
            <button type="button" className={btnOutline} onClick={() => setMode('rename')}><Pencil className="w-4 h-4" /> Rename</button>
            <button type="button" className={btnOutline} onClick={() => setMode('token')}>Replace token</button>
            <button type="button" className={cn(btnOutline, 'text-destructive')} onClick={() => setMode('remove')}><Trash2 className="w-4 h-4" /> Remove</button>
          </div>
        )}
      </div>
      {note && <p className={cn('text-sm', note.error ? 'text-destructive' : 'text-green-700')}>{note.text}</p>}
      {mode === 'rename' && (
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className={cn(inputCls, 'flex-1 min-w-[200px]')} />
          <button type="button" className={btnOutline} onClick={() => { setMode(null); setName(a.name) }}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!name.trim() || busy}
            onClick={() => run(async () => { await api.patch(`/loyverse/connections/${a.id}`, { name: name.trim() }); setMode(null); onChanged() })}>
            Save
          </button>
        </div>
      )}
      {mode === 'token' && (
        <AccountForm tokenOnly onCancel={() => setMode(null)}
          onSave={async ({ token }) => { await api.patch(`/loyverse/connections/${a.id}`, { access_token: token }); setMode(null); onChanged() }} />
      )}
      {mode === 'remove' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">
            Remove <strong>{a.name}</strong>?{a.venue_count > 0 && ' ' + a.venue_count + (a.venue_count === 1 ? ' venue loses its' : ' venues lose their') + ' Loyverse link and mapping.'} Days already filled keep their figures.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={cn(btn, 'bg-destructive text-destructive-foreground hover:bg-destructive/90')} disabled={busy}
              onClick={() => run(async () => { await api.delete(`/loyverse/connections/${a.id}`); onChanged() })}>
              Yes, remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function emptyDraft(connectionId = '') {
  return { connection_id: connectionId, store_id: '', day_starts_at: '00:00', mappings: { income: {}, takings: {}, sc: {} } }
}

function draftFromLink(link) {
  return {
    connection_id: link.connection_id, store_id: link.store_id, day_starts_at: link.day_starts_at || '00:00',
    mappings: { income: {}, takings: {}, sc: {}, ...(link.mappings || {}) },
  }
}

function VenueLinkCard({ venueId, config, canSetup }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['loyverse-connections'], queryFn: () => api.get('/loyverse/connections') })
  const { data: linkRes, isLoading } = useLoyverseLink(venueId)
  const link = linkRes?.link ?? null

  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [picker, setPicker] = useState(null)       // { group, id, name }
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [matchNote, setMatchNote] = useState(null)

  const firstAccountId = accounts[0]?.id || ''
  const base = useMemo(() => link ? draftFromLink(link) : emptyDraft(firstAccountId), [link, firstAccountId])
  useEffect(() => { setDraft(base); setError(null) }, [base, venueId])
  const d = draft ?? base
  const dirty = JSON.stringify(d) !== JSON.stringify(base)

  const { data: catalog, isLoading: catalogLoading, error: catalogError } = useQuery({
    queryKey: ['loyverse-catalog', d.connection_id],
    queryFn:  () => api.get(`/loyverse/connections/${d.connection_id}/catalog`),
    enabled:  canSetup && !!d.connection_id,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const names = useMemo(() => ({
    item:         Object.fromEntries((catalog?.items ?? []).map(x => [x.id, x.name])),
    category:     Object.fromEntries((catalog?.categories ?? []).map(x => [x.id, x.name])),
    payment_type: Object.fromEntries((catalog?.payment_types ?? []).map(x => [x.id, x.name])),
  }), [catalog])

  if (isLoading || !draft) return <Card title="This venue"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></Card>

  if (!accounts.length && !link) {
    return <Card title="This venue"><p className="text-sm text-muted-foreground">Add a Loyverse account above first.</p></Card>
  }

  const setField = (group, id, terms) => setDraft(p => {
    const g = { ...(p.mappings[group] || {}) }
    if (terms.length) g[id] = terms
    else delete g[id]
    return { ...p, mappings: { ...p.mappings, [group]: g } }
  })
  const termsOf = (group, id) => d.mappings[group]?.[id] || []

  function matchPaymentTypes() {
    const norm = s => String(s || '').trim().toLowerCase()
    let n = 0
    const next = { ...(d.mappings.takings || {}) }
    for (const ch of (config?.payment_channels ?? []).filter(c => c.is_active)) {
      if (next[ch.id]?.length) continue
      const pt = (catalog?.payment_types ?? []).find(p => norm(p.name) === norm(ch.name))
      if (pt) { next[ch.id] = [{ sign: 1, kind: 'payment_type', ref: pt.id, label: pt.name }]; n++ }
    }
    setDraft(p => ({ ...p, mappings: { ...p.mappings, takings: next } }))
    setMatchNote(n ? `Matched ${n} payment ${n === 1 ? 'channel' : 'channels'} by name. Save to keep.` : 'No unmapped channel has the same name as a Loyverse payment type.')
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const store = catalog?.stores?.find(s => s.id === d.store_id)
      await api.put(`/loyverse/venues/${venueId}/link`, { ...d, store_name: store?.name ?? null })
      await qc.invalidateQueries({ queryKey: ['loyverse-link', venueId] })
      qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      setMatchNote(null)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  async function unlink() {
    setSaving(true); setError(null)
    try {
      await api.delete(`/loyverse/venues/${venueId}/link`)
      await qc.invalidateQueries({ queryKey: ['loyverse-link', venueId] })
      qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
      setConfirmUnlink(false)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const readOnly = !canSetup
  const account = accounts.find(a => a.id === d.connection_id)
  const stores = catalog?.stores ?? (link && link.connection_id === d.connection_id ? [{ id: link.store_id, name: link.store_name || link.store_id }] : [])

  return (
    <>
      <Card title="This venue">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Loyverse account</span>
            <select disabled={readOnly} value={d.connection_id}
              onChange={e => setDraft(p => ({ ...p, connection_id: e.target.value, store_id: '' }))} className={inputCls}>
              {!d.connection_id && <option value="">Choose…</option>}
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Store</span>
            <select disabled={readOnly || (!catalog && !stores.length)} value={d.store_id}
              onChange={e => setDraft(p => ({ ...p, store_id: e.target.value }))} className={inputCls}>
              <option value="">{catalogLoading ? 'Loading…' : 'Choose a store…'}</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Trading day starts at</span>
            <select disabled={readOnly} value={d.day_starts_at}
              onChange={e => setDraft(p => ({ ...p, day_starts_at: e.target.value }))} className={inputCls}>
              {DAY_STARTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Sales before the trading day start count on the day before (set e.g. 04:00 if you trade past midnight).
          Times are the venue&apos;s local time.
        </p>
        {catalogError && (
          <p className="text-sm text-destructive flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{catalogError.message}</p>
        )}
        {account?.last_error && !catalogError && (
          <p className="text-sm text-destructive flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{account.last_error}</p>
        )}
      </Card>

      <Card title="Field mapping">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Each line below is filled with the sum of the Loyverse figures you add to it. Tap <strong>+</strong> or
          <strong> −</strong> on a figure to switch between adding and subtracting it. Lines with nothing added are
          never changed by a fill.
        </p>
        {GROUPS.map(g => {
          const fields = (config?.[g.configKey] ?? []).filter(f => f.is_active)
          return (
            <div key={g.key} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <h4 className="text-sm font-semibold">{g.label}</h4>
                {g.key === 'takings' && canSetup && catalog && (
                  <button type="button" onClick={matchPaymentTypes} className={btnOutline}>
                    <Wand2 className="w-4 h-4" /> Match payment types by name
                  </button>
                )}
              </div>
              {g.key === 'takings' && matchNote && <p className="text-sm text-muted-foreground">{matchNote}</p>}
              {fields.length === 0 && <p className="text-sm text-muted-foreground">{g.empty}</p>}
              <div className="divide-y rounded-xl border">
                {fields.map(f => {
                  const terms = termsOf(g.key, f.id)
                  return (
                    <div key={f.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="sm:w-44 shrink-0 text-sm font-medium">{f.name}</div>
                      <div className="flex-1 flex flex-wrap items-center gap-2">
                        {terms.length === 0 && <span className="text-sm text-muted-foreground">Not filled from Loyverse</span>}
                        {terms.map((t, i) => (
                          <TermChip key={i} term={t} names={names} readOnly={readOnly}
                            onFlip={() => setField(g.key, f.id, terms.map((x, j) => j === i ? { ...x, sign: -x.sign } : x))}
                            onRemove={() => setField(g.key, f.id, terms.filter((_, j) => j !== i))} />
                        ))}
                        {!readOnly && (
                          <button type="button" onClick={() => setPicker({ group: g.key, id: f.id, name: f.name })}
                            className={cn(btnOutline, 'border-dashed')}>
                            <Plus className="w-4 h-4" /> Add
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </Card>

      {canSetup && (
        <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background border-t flex flex-wrap items-center gap-2">
          {link && !confirmUnlink && (
            <button type="button" onClick={() => setConfirmUnlink(true)} className={cn(btnOutline, 'text-destructive')}>Unlink venue</button>
          )}
          {confirmUnlink && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Unlink this venue from Loyverse? The mapping is removed.</span>
              <button type="button" onClick={() => setConfirmUnlink(false)} className={btnOutline}>Cancel</button>
              <button type="button" onClick={unlink} disabled={saving} className={cn(btn, 'bg-destructive text-destructive-foreground')}>Yes, unlink</button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-3">
            {error && <span className="text-sm text-destructive">{error}</span>}
            {saved && <span className="text-sm text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
            {dirty && <button type="button" onClick={() => setDraft(base)} className={btnOutline}>Discard</button>}
            <button type="button" onClick={save} disabled={!dirty || saving || !d.connection_id || !d.store_id} className={btnPrimary}>
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

function TermChip({ term, names, onFlip, onRemove, readOnly }) {
  const neg = term.sign < 0
  return (
    <span className={cn('inline-flex items-stretch rounded-xl border overflow-hidden text-sm',
      neg ? 'border-red-200 bg-red-50 text-red-900' : 'border-green-200 bg-green-50 text-green-900')}>
      {readOnly
        ? <span className="px-3 flex items-center font-bold">{neg ? '−' : '+'}</span>
        : (
          <button type="button" onClick={onFlip}
            aria-label={neg ? 'Subtracted, tap to add' : 'Added, tap to subtract'}
            className="w-12 min-h-[48px] text-lg font-bold touch-manipulation hover:bg-black/5 border-r border-black/10">
            {neg ? '−' : '+'}
          </button>
        )}
      <span className="px-2 py-1 flex items-center">{termLabel(term, names)}</span>
      {!readOnly && (
        <button type="button" onClick={onRemove} aria-label="Remove"
          className="w-12 min-h-[48px] flex items-center justify-center touch-manipulation hover:bg-black/5">
          <X className="w-4 h-4" />
        </button>
      )}
    </span>
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

export function LoyverseFillModal({ venueId, dates, onClose, onApplied }) {
  const api = useApi()
  const qc = useQueryClient()
  const from = dates[0], to = dates[dates.length - 1]
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['loyverse-preview', venueId, from, to],
    queryFn:  () => api.post(`/loyverse/venues/${venueId}/preview`, { from, to }),
    staleTime: 0, gcTime: 0, retry: false,
  })
  const [picked, setPicked] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!data) return
    setPicked(new Set(data.days
      .filter(d => d.status !== 'submitted' && (dates.length === 1 || d.sales + d.refund_receipts > 0))
      .map(d => d.date)))
  }, [data, dates.length])

  const currency = data?.currency || 'GBP'
  const days = data?.days ?? []
  const fields = data?.fields ?? []
  const toggle = date => setPicked(p => { const n = new Set(p); n.has(date) ? n.delete(date) : n.add(date); return n })

  async function apply() {
    setApplying(true); setApplyError(null)
    try {
      const r = await api.post(`/loyverse/venues/${venueId}/apply`, { dates: [...picked].sort() })
      setResult(r)
      qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
      onApplied?.(r)
    } catch (e) { setApplyError(e.message) }
    setApplying(false)
  }

  const dayLabel = date => format(parseISO(date), 'EEE d MMM')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget && !applying) onClose() }}>
      <div className={cn('bg-background rounded-2xl shadow-xl w-full max-h-[85vh] flex flex-col', dates.length === 1 ? 'max-w-xl' : 'max-w-5xl')}>
        <div className="p-4 border-b flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Fill from Loyverse</div>
            <div className="text-xs text-muted-foreground">
              {data ? [data.store_name, 'Trading day from ' + data.day_starts_at].filter(Boolean).join(' · ') : 'Reading Loyverse…'}
            </div>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching || applying} aria-label="Read again"
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-muted touch-manipulation disabled:opacity-40">
            <RefreshCw className={cn('w-5 h-5', isFetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={onClose} disabled={applying} aria-label="Close"
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-muted touch-manipulation"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-auto flex-1">
          {isLoading && <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Reading Loyverse…</div>}
          {error && <div className="m-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error.message}</div>}
          {data && fields.length === 0 && (
            <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Nothing is mapped yet. Map fields in Cash Recon settings &gt; Loyverse.
            </div>
          )}
          {data && fields.length > 0 && (
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="sticky left-0 z-20 bg-background text-left px-3 py-2 border-b min-w-[170px]" />
                  {days.map(d => {
                    const locked = d.status === 'submitted'
                    const on = picked?.has(d.date)
                    return (
                      <th key={d.date} className="px-2 py-2 border-b text-center min-w-[112px] align-top">
                        <div className="text-xs font-semibold">{dayLabel(d.date)}</div>
                        {locked ? (
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-green-700 min-h-[48px]"><Lock className="w-3 h-3" /> Submitted</div>
                        ) : (
                          <button type="button" onClick={() => toggle(d.date)} aria-pressed={!!on} disabled={!!result}
                            className={cn('mt-1 w-full min-h-[48px] rounded-xl border text-xs font-medium touch-manipulation flex items-center justify-center gap-1',
                              on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                            {on ? <><Check className="w-3.5 h-3.5" /> Fill</> : 'Skip'}
                          </button>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(g => {
                  const gf = fields.filter(f => f.group === g.key)
                  if (!gf.length) return null
                  return [
                    <tr key={g.key}><td colSpan={days.length + 1} className="sticky left-0 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</td></tr>,
                    ...gf.map(f => (
                      <tr key={f.key} className="border-b">
                        <td className="sticky left-0 z-[1] bg-background px-3 py-2 align-top">
                          <div className="font-medium">{f.name}</div>
                          <div className="text-[11px] text-muted-foreground leading-snug">
                            {f.terms.map((t, i) => (i === 0 ? (t.sign < 0 ? '− ' : '') : (t.sign < 0 ? ' − ' : ' + ')) + termLabel(t)).join('')}
                          </div>
                        </td>
                        {days.map(d => {
                          const v = d.values[f.key]
                          const same = v.current != null && Math.abs(v.current - v.loyverse) < 0.005
                          return (
                            <td key={d.date} className="px-2 py-2 text-right align-top tabular-nums">
                              <div className={cn('font-semibold', v.loyverse < 0 && 'text-red-700')}>{money(v.loyverse, currency)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {v.current == null ? 'empty now' : same ? 'same now' : 'now ' + money(v.current, currency)}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )),
                  ]
                })}
                <tr><td colSpan={days.length + 1} className="sticky left-0 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Loyverse day</td></tr>
                <SummaryRow label="Receipts" days={days} render={d => d.sales + (d.refund_receipts ? ` + ${d.refund_receipts} refund${d.refund_receipts === 1 ? '' : 's'}` : '')} />
                <SummaryRow label="Gross sales" days={days} render={d => money(d.totals.gross_sales, currency)} />
                <SummaryRow label="Net sales" days={days} render={d => money(d.totals.net_sales, currency)} />
                <SummaryRow label="Total collected" days={days} render={d => money(d.totals.total_collected, currency)} />
                <SummaryRow label="Payment types not mapped" days={days} render={d => {
                  const un = d.payments.filter(p => !p.mapped && Math.abs(p.amount) >= 0.005)
                  if (!un.length) return <span className="text-muted-foreground">—</span>
                  return <span className="text-amber-700">{un.map(p => p.name + ' ' + money(p.amount, currency)).join(', ')}</span>
                }} />
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t flex flex-wrap items-center gap-3">
          {result ? (
            <div className="text-sm flex-1 min-w-0">
              {result.filled.length > 0 && <span className="text-green-700">Filled {result.filled.map(dayLabel).join(', ')}.</span>}
              {result.skipped.length > 0 && <span className="text-muted-foreground"> Skipped {result.skipped.map(s => dayLabel(s.date)).join(', ')} (submitted).</span>}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground flex-1 min-w-0">
              Only mapped lines are written; their notes stay. Submitted days are never changed.
              {applyError && <div className="text-sm text-destructive mt-1">{applyError}</div>}
            </div>
          )}
          {result ? (
            <button type="button" onClick={onClose} className={btnPrimary}>Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={applying} className={btnOutline}>Cancel</button>
              <button type="button" onClick={apply} disabled={applying || !picked?.size || !fields.length} className={btnPrimary}>
                {applying && <Loader2 className="w-4 h-4 animate-spin" />}
                {picked?.size ? `Fill ${picked.size} ${picked.size === 1 ? 'day' : 'days'}` : 'Fill'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, days, render }) {
  return (
    <tr className="border-b">
      <td className="sticky left-0 z-[1] bg-background px-3 py-2 text-xs text-muted-foreground">{label}</td>
      {days.map(d => <td key={d.date} className="px-2 py-2 text-right text-xs tabular-nums align-top">{render(d)}</td>)}
    </tr>
  )
}
