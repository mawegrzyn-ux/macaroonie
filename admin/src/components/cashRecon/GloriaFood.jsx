// src/components/cashRecon/GloriaFood.jsx
//
// GloriaFood online orders for Cash Reconciliation (migration 159).
//
//   GloriaFoodSettings     Cash Recon settings > GloriaFood: how orders reach
//                          us (GloriaFood pushes them to this venue's address,
//                          or we collect them every minute with a poll key),
//                          which day an order counts on, whether the orders
//                          show on the Online orders board, the field mapping,
//                          and the latest orders received. One explicit Save.
//   GloriaFoodFillButton   "Fill from GloriaFood" on the day view and the week
//                          grid; opens the shared fill window (reconShared).
//
// Figures and labels come from shared/gloriafood.js. GloriaFood only hands
// over orders as they are accepted, so the figures are the orders stored
// since the link was set up; the server works them out again on Fill.

import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Loader2, X, Check, AlertTriangle, RefreshCw, Search, Download, Copy, Link2, ShoppingBag,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TOTAL_KINDS, REF_KINDS, termLabel } from '@shared/gloriafood.js'
import {
  DAY_STARTS, money, useReconLinkPerms, Card, inputCls, btn, btnPrimary, btnOutline, btnDanger,
  MappingGroups, SummaryRow, ReconFillModal,
} from './reconShared'

export function useGloriaFoodLink(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['gloriafood-link', venueId],
    queryFn:  () => api.get(`/gloriafood/venues/${venueId}/link`),
    enabled:  !!venueId,
    staleTime: 60_000,
  })
}

const when = iso => iso ? format(new Date(iso), 'd MMM HH:mm') : null

function Switch({ checked, onChange, disabled, label, hint }) {
  return (
    <label className={cn('flex items-start gap-3 min-h-[48px] py-1 cursor-pointer touch-manipulation', disabled && 'opacity-60 cursor-default')}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function GloriaFoodSettings({ venueId, config }) {
  const { canSetup, ready } = useReconLinkPerms()
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Fill a day&apos;s income, service charges and takings from this venue&apos;s accepted GloriaFood orders, and
        (if you want) show those orders on the Online orders board. GloriaFood only hands orders over as they are
        accepted, so orders count from the day you link the venue onwards.
      </p>
      {ready && !canSetup && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Only owners and admins can set up GloriaFood. You can see the setup here.
        </div>
      )}
      <VenueLinkCards venueId={venueId} config={config} canSetup={canSetup} />
    </div>
  )
}

function emptyDraft() {
  return {
    method: 'push', poll_key: '', day_basis: 'fulfill', day_starts_at: '00:00', show_on_board: false,
    mappings: { income: {}, takings: {}, sc: {} },
  }
}

function draftFromLink(link) {
  return {
    method: link.method, poll_key: '', day_basis: link.day_basis, day_starts_at: link.day_starts_at,
    show_on_board: link.show_on_board, mappings: { income: {}, takings: {}, sc: {}, ...(link.mappings || {}) },
  }
}

function VenueLinkCards({ venueId, config, canSetup }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: linkRes, isLoading } = useGloriaFoodLink(venueId)
  const link = linkRes?.link ?? null

  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)              // { error?, text }
  const [picker, setPicker] = useState(null)          // { group, id, name }
  const [confirm, setConfirm] = useState(null)        // 'unlink' | 'url' | 'restaurant'
  const [checking, setChecking] = useState(false)

  const base = useMemo(() => link ? draftFromLink(link) : emptyDraft(), [link])
  useEffect(() => { setDraft(base) }, [base])
  useEffect(() => { setNote(null); setConfirm(null) }, [venueId])
  const d = draft ?? base
  const dirty = JSON.stringify(d) !== JSON.stringify(base)

  const { data: pushRes } = useQuery({
    queryKey: ['gloriafood-push-url', venueId, link?.updated_at],
    queryFn:  () => api.get(`/gloriafood/venues/${venueId}/push-url`),
    enabled:  canSetup && !!link,
  })
  const { data: seen } = useQuery({
    queryKey: ['gloriafood-seen', venueId],
    queryFn:  () => api.get(`/gloriafood/venues/${venueId}/seen`),
    enabled:  canSetup && !!picker,
    staleTime: 60_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['gloriafood-link', venueId] })
    qc.invalidateQueries({ queryKey: ['gloriafood-orders', venueId] })
    qc.invalidateQueries({ queryKey: ['gloriafood-push-url', venueId] })
    qc.invalidateQueries({ queryKey: ['orders', venueId] })
  }

  if (isLoading || !draft) return <Card title="This venue"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></Card>

  const readOnly = !canSetup
  const set = patch => setDraft(p => ({ ...p, ...patch }))
  const setField = (group, id, terms) => setDraft(p => {
    const g = { ...(p.mappings[group] || {}) }
    if (terms.length) g[id] = terms
    else delete g[id]
    return { ...p, mappings: { ...p.mappings, [group]: g } }
  })
  const termsOf = (group, id) => d.mappings[group]?.[id] || []
  const needsKey = d.method === 'poll' && !link?.has_poll_key && !d.poll_key.trim()

  async function run(fn) {
    setSaving(true); setNote(null)
    try { await fn() } catch (e) { setNote({ error: true, text: e.message }) }
    setSaving(false)
  }

  const save = () => run(async () => {
    const body = { ...d, poll_key: d.method === 'poll' && d.poll_key.trim() ? d.poll_key.trim() : undefined }
    const r = await api.put(`/gloriafood/venues/${venueId}/link`, body)
    await qc.invalidateQueries({ queryKey: ['gloriafood-link', venueId] })
    refresh()
    const got = r.checked ? r.checked.stored + r.checked.updated : 0
    setNote({ text: r.checked ? (got ? `Saved. The key works: ${got} waiting ${got === 1 ? 'order was' : 'orders were'} collected.` : 'Saved. The key works; no orders are waiting.') : 'Saved.' })
  })

  const checkNow = async () => {
    setChecking(true); setNote(null)
    try {
      const r = await api.post(`/gloriafood/venues/${venueId}/poll`)
      const got = r.stored + r.updated
      setNote({ text: r.busy ? 'Already checking, try again in a moment.' : got ? `${got} ${got === 1 ? 'order' : 'orders'} collected.` : 'No new orders waiting in GloriaFood.' })
      refresh()
    } catch (e) { setNote({ error: true, text: e.message }) }
    setChecking(false)
  }

  return (
    <>
      <Card title="How orders reach Macaroonie">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How orders reach Macaroonie">
          {[
            ['push', 'GloriaFood sends them', 'GloriaFood posts each accepted order to this venue\'s own address straight away (integration "Push Accepted Order").'],
            ['poll', 'Collect them every minute', 'Macaroonie asks GloriaFood for new accepted orders every minute with a key (integration "Poll Accepted Order v2").'],
          ].map(([key, title, hint]) => (
            <button key={key} type="button" role="radio" aria-checked={d.method === key} disabled={readOnly}
              onClick={() => set({ method: key })}
              className={cn('min-h-[48px] rounded-xl border p-3 text-left touch-manipulation',
                d.method === key ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-muted', readOnly && 'cursor-default')}>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
            </button>
          ))}
        </div>

        {d.method === 'push' && (
          <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
            {link && link.method === 'push' && pushRes?.push_url ? (
              <>
                <div className="text-sm font-medium">This venue&apos;s address for GloriaFood</div>
                <PushUrl url={pushRes.push_url} />
                <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-0.5 leading-relaxed">
                  <li>In the GloriaFood admin panel for this restaurant open <strong>Others &gt; 3rd party integrations</strong>.</li>
                  <li>Add the <strong>Push Accepted Order</strong> integration.</li>
                  <li>Paste this address as the endpoint (URL) and choose <strong>JSON</strong>.</li>
                </ol>
                <p className="text-xs text-muted-foreground">Keep the address private: anyone who has it can send orders to this venue. Make a new one if it gets out.</p>
              </>
            ) : link && link.method === 'push' ? (
              <p className="text-sm text-muted-foreground">Only owners and admins can see this venue&apos;s address for GloriaFood.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Save to get this venue&apos;s address to paste into GloriaFood.</p>
            )}
          </div>
        )}

        {d.method === 'poll' && (
          <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
            {link?.has_poll_key && (
              <div className="text-sm">Key ending <strong>{link.poll_key_hint}</strong> saved.{link.last_poll_at && <span className="text-muted-foreground"> Last checked {when(link.last_poll_at)}.</span>}</div>
            )}
            {!readOnly && (
              <label className="block space-y-1">
                <span className="text-sm font-medium">{link?.has_poll_key ? 'New poll key (leave empty to keep the saved one)' : 'Poll key'}</span>
                <input type="password" autoComplete="off" value={d.poll_key} onChange={e => set({ poll_key: e.target.value })}
                  placeholder="Paste the key from GloriaFood" className={inputCls} />
              </label>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed">
              In the GloriaFood admin panel for this restaurant open <strong>Others &gt; 3rd party integrations</strong>,
              add <strong>Poll Accepted Order v2</strong> and copy its key. It is checked with GloriaFood when you save
              (any orders waiting are collected straight away) and is never shown again.
            </p>
          </div>
        )}

        {link && (
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">GloriaFood restaurant: </span>
              {link.restaurant ? <strong>{link.restaurant.name || 'Restaurant'} <span className="font-normal text-muted-foreground">({link.restaurant.id})</span></strong>
                : <span className="text-muted-foreground">set by the first order</span>}
            </div>
            <div>
              <span className="text-muted-foreground">Orders received: </span>
              <strong>{link.order_count}</strong>
              {link.last_order_at && <span className="text-muted-foreground"> · last {when(link.last_order_at)}</span>}
            </div>
          </div>
        )}
        {link?.last_error && (
          <p className="text-sm text-destructive flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{link.last_error}{link.last_error_at && <span className="text-muted-foreground"> ({when(link.last_error_at)})</span>}</span>
          </p>
        )}

        {link && canSetup && (
          <div className="flex flex-wrap gap-2">
            {link.method === 'poll' && (
              <button type="button" onClick={checkNow} disabled={checking} className={btnOutline}>
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check for orders now
              </button>
            )}
            {link.method === 'push' && confirm !== 'url' && (
              <button type="button" onClick={() => setConfirm('url')} className={btnOutline}><Link2 className="w-4 h-4" /> New address</button>
            )}
            {link.restaurant && confirm !== 'restaurant' && (
              <button type="button" onClick={() => setConfirm('restaurant')} className={btnOutline}>Use a different restaurant</button>
            )}
          </div>
        )}
        {confirm === 'url' && (
          <ConfirmRow text="Make a new address? The old one stops working at once, so paste the new one into GloriaFood straight away."
            yes="Yes, new address" busy={saving} onNo={() => setConfirm(null)}
            onYes={() => run(async () => { await api.post(`/gloriafood/venues/${venueId}/push-url/new`); refresh(); setConfirm(null) })} />
        )}
        {confirm === 'restaurant' && (
          <ConfirmRow text={`Forget ${link.restaurant?.name || 'this restaurant'}? The next order sets which GloriaFood restaurant this venue takes orders from. Orders already received stay.`}
            yes="Yes, forget it" busy={saving} onNo={() => setConfirm(null)}
            onYes={() => run(async () => { await api.post(`/gloriafood/venues/${venueId}/restaurant/reset`); refresh(); setConfirm(null) })} />
        )}
      </Card>

      <Card title="Days and the orders board">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">An order counts on the day it is</span>
            <select disabled={readOnly} value={d.day_basis} onChange={e => set({ day_basis: e.target.value })} className={inputCls}>
              <option value="fulfill">Collected or delivered</option>
              <option value="accepted">Accepted</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Trading day starts at</span>
            <select disabled={readOnly} value={d.day_starts_at} onChange={e => set({ day_starts_at: e.target.value })} className={inputCls}>
              {DAY_STARTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          An order placed tonight for tomorrow counts tomorrow when it is collected or delivered. Orders before the
          trading day start count on the day before. Times are the venue&apos;s local time.
        </p>
        <Switch checked={d.show_on_board} disabled={readOnly} onChange={v => set({ show_on_board: v })}
          label="Show GloriaFood orders on the Online orders board"
          hint="They show with a GloriaFood label next to your own online orders. Moving one to Ready or Collected only changes the board; GloriaFood isn't told." />
        {base.show_on_board && (
          <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline min-h-[44px]">
            <ShoppingBag className="w-4 h-4" /> Open the Online orders board
          </Link>
        )}
      </Card>

      <Card title="Field mapping">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Each line below is filled with the sum of the GloriaFood figures you add to it, for example income
          = Order totals minus Tips, a payment channel = Payment: Paid online. Tap <strong>+</strong> or
          <strong> −</strong> on a figure to switch between adding and subtracting it. Lines with nothing added
          are never changed by a fill.
        </p>
        <MappingGroups
          config={config}
          mappings={d.mappings}
          termLabel={termLabel}
          readOnly={readOnly}
          emptyText="Not filled from GloriaFood"
          onChange={setField}
          onAdd={(group, f) => setPicker({ group, id: f.id, name: f.name })}
        />
      </Card>

      {link && <LatestOrders venueId={venueId} />}

      {canSetup && (
        <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background border-t flex flex-wrap items-center gap-2">
          {link && confirm !== 'unlink' && (
            <button type="button" onClick={() => setConfirm('unlink')} className={cn(btnOutline, 'text-destructive')}>Unlink venue</button>
          )}
          {confirm === 'unlink' && (
            <ConfirmRow text="Unlink this venue from GloriaFood? Orders stop arriving and the mapping is removed. Orders already received are kept."
              yes="Yes, unlink" busy={saving} onNo={() => setConfirm(null)}
              onYes={() => run(async () => {
                await api.delete(`/gloriafood/venues/${venueId}/link`)
                await qc.invalidateQueries({ queryKey: ['gloriafood-link', venueId] })
                refresh(); setConfirm(null)
              })} />
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {note && <span className={cn('text-sm', note.error ? 'text-destructive' : 'text-green-700')}>{!note.error && <Check className="w-4 h-4 inline -mt-0.5 mr-1" />}{note.text}</span>}
            {dirty && <button type="button" onClick={() => setDraft(base)} className={btnOutline}>Discard</button>}
            <button type="button" onClick={save} disabled={(!dirty && !!link) || saving || needsKey} className={btnPrimary}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {link ? 'Save' : 'Link this venue'}
            </button>
          </div>
        </div>
      )}

      {picker && (
        <TermPicker
          fieldName={picker.name}
          seen={seen}
          onClose={() => setPicker(null)}
          onPick={term => { setField(picker.group, picker.id, [...termsOf(picker.group, picker.id), term]); setPicker(null) }}
        />
      )}
    </>
  )
}

function ConfirmRow({ text, yes, busy, onYes, onNo }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2 w-full">
      <p className="text-sm">{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onNo} className={btnOutline}>Cancel</button>
        <button type="button" onClick={onYes} disabled={busy} className={btnDanger}>{yes}</button>
      </div>
    </div>
  )
}

function PushUrl({ url }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* select it instead */ }
  }
  return (
    <div className="flex gap-2">
      <input readOnly value={url} onFocus={e => e.target.select()} className={cn(inputCls, 'font-mono text-sm min-w-0')} aria-label="Address for GloriaFood" />
      <button type="button" onClick={copy} className={cn(btnOutline, 'shrink-0 bg-background')}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function LatestOrders({ venueId }) {
  const api = useApi()
  const { data = [], isLoading } = useQuery({
    queryKey: ['gloriafood-orders', venueId],
    queryFn:  () => api.get(`/gloriafood/venues/${venueId}/orders?limit=10`),
    refetchInterval: 60_000,
  })
  return (
    <Card title="Latest orders received">
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {!isLoading && data.length === 0 && (
        <p className="text-sm text-muted-foreground">No orders yet. They appear here as GloriaFood accepts them.</p>
      )}
      {data.length > 0 && (
        <div className="divide-y rounded-xl border">
          {data.map(o => (
            <div key={o.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold tabular-nums">#{o.order_number}</span>
              <span className="text-muted-foreground">{o.fulfill_at ? format(new Date(o.fulfill_at), 'EEE d MMM HH:mm') : ''}</span>
              <span>{o.type_label}</span>
              <span className="text-muted-foreground">{o.payment_label}</span>
              {o.is_test && <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">Test order, not counted</span>}
              {o.status !== 'accepted' && <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700">{o.status === 'canceled' ? 'Cancelled' : o.status}</span>}
              <span className="ml-auto font-semibold tabular-nums">{money(o.total, o.currency)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function TermPicker({ fieldName, seen, onPick, onClose }) {
  const [sign, setSign] = useState(1)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const match = name => !needle || String(name).toLowerCase().includes(needle)
  const totals = Object.entries(TOTAL_KINDS).filter(([, v]) => match(v.label))
  const payments = (seen?.payments ?? []).filter(p => match(p.name) || match(p.id))
  const types = (seen?.order_types ?? []).filter(t => match(t.name))
  const pick = (kind, ref) => onPick({ sign, kind, ...(ref ? { ref } : {}) })

  const Option = ({ onClick, title, hint, extra }) => (
    <button type="button" onClick={onClick}
      className="w-full min-h-[48px] text-left px-3 py-2 rounded-xl hover:bg-muted touch-manipulation">
      <div className="text-sm font-medium">{title}{extra && <span className="ml-2 text-xs font-normal text-muted-foreground">{extra}</span>}</div>
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
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search figures, payments, order types…" className={cn(inputCls, 'pl-9')} />
          </div>
        </div>
        <div className="overflow-y-auto p-2 space-y-3">
          {totals.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day totals</div>
              {totals.map(([k, v]) => <Option key={k} title={v.label} hint={v.hint} onClick={() => pick(k)} />)}
            </div>
          )}
          {!seen && <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {payments.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</div>
              {payments.map(p => <Option key={p.id} title={p.name} extra={p.seen ? 'used by your orders' : null} hint={REF_KINDS.payment.hint} onClick={() => pick('payment', p.id)} />)}
            </div>
          )}
          {types.length > 0 && (
            <div>
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order types</div>
              {types.map(t => <Option key={t.id} title={t.name} extra={t.seen ? 'used by your orders' : null} hint={REF_KINDS.order_type.hint} onClick={() => pick('order_type', t.id)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fill from GloriaFood ─────────────────────────────────────────────────────

const GLORIAFOOD = { name: 'GloriaFood', path: '/gloriafood', valueKey: 'source', settingsHint: 'Cash Recon settings > GloriaFood' }

export function GloriaFoodFillButton({ venueId, dates, onApplied, compact, className }) {
  const { canFill } = useReconLinkPerms()
  const { data } = useGloriaFoodLink(venueId)
  const [open, setOpen] = useState(false)
  if (!data?.link || !canFill || !dates?.length) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn(compact
          ? 'h-8 px-3 rounded-lg border text-xs font-semibold touch-manipulation hover:bg-muted flex items-center gap-1.5 whitespace-nowrap'
          : 'h-10 px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-2 whitespace-nowrap',
          className)}>
        <Download className={compact ? 'w-3 h-3' : 'w-4 h-4'} /> Fill from GloriaFood
      </button>
      {open && <GloriaFoodFillModal venueId={venueId} dates={dates} onClose={() => setOpen(false)} onApplied={onApplied} />}
    </>
  )
}

export function GloriaFoodFillModal({ venueId, dates, onClose, onApplied }) {
  return (
    <ReconFillModal
      source={GLORIAFOOD} venueId={venueId} dates={dates} onClose={onClose} onApplied={onApplied}
      termLabel={termLabel}
      subtitle={data => [
        data.restaurant_name,
        data.day_basis === 'accepted' ? 'By accepted time' : 'By collection / delivery time',
        'Trading day from ' + data.day_starts_at,
      ].filter(Boolean).join(' · ')}
      hasSales={d => d.orders > 0}
      notices={data => (
        <>
          {data.poll_error && (
            <div className="m-4 mb-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Couldn&apos;t check GloriaFood for new orders just now ({data.poll_error}) These figures are the orders received so far.</span>
            </div>
          )}
          {!data.last_order_at && (
            <div className="m-4 mb-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No GloriaFood orders have reached this venue yet. Check the setup in {GLORIAFOOD.settingsHint}.
            </div>
          )}
        </>
      )}
      summary={(days, currency) => (
        <>
          <SummaryRow label="Orders" days={days} render={d => {
            const extra = [d.cancelled ? `${d.cancelled} cancelled` : null, d.test_orders ? `${d.test_orders} test` : null].filter(Boolean).join(', ')
            return <>{d.orders}{extra && <div className="text-muted-foreground">not counted: {extra}</div>}</>
          }} />
          <SummaryRow label="Order totals" days={days} render={d => money(d.totals.total, currency)} />
          <SummaryRow label="Food subtotal" days={days} render={d => money(d.totals.subtotal, currency)} />
          <SummaryRow label="Tips" days={days} render={d => money(d.totals.tips, currency)} />
          <SummaryRow label="Payments not mapped" days={days} render={d => {
            const un = d.payments.filter(p => !p.mapped && Math.abs(p.amount) >= 0.005)
            if (!un.length) return <span className="text-muted-foreground">—</span>
            return <span className="text-amber-700">{un.map(p => p.name + ' ' + money(p.amount, currency)).join(', ')}</span>
          }} />
          {days.some(d => d.split_payments) && (
            <SummaryRow label="Paid two ways" days={days} render={d => d.split_payments
              ? <span className="text-amber-700">{d.split_payments} {d.split_payments === 1 ? 'order counts' : 'orders count'} under the main payment</span>
              : <span className="text-muted-foreground">—</span>} />
          )}
        </>
      )}
    />
  )
}
