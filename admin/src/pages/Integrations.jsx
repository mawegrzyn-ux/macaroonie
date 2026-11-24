// src/pages/Integrations.jsx
//
// Integrations (/integrations): other tills whose sales Macaroonie keeps
// (docs/SALES_IMPORT.md phase 1, migrations 288 to 290). Each connection
// (a Loyverse account now; Square and Simphony later) with its status, last
// sync, webhook and venues: each venue's store, trading day start, history
// import progress and the checks stored. Sync now and Fetch history queue
// the background sync; nothing is read from the other till in the page's
// requests but the token check and the store list.
//
// Permissions (Cash reconciliation): View sees it, Manage syncs and fetches
// history, owners and admins with Manage set accounts, links, the webhook
// and pausing (the API's guards are the real check). The Cash Recon field
// mapping stays in Cash Recon settings > Loyverse.

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Loader2, Plus, Check, AlertTriangle, RefreshCw, Pencil, Trash2, Plug, Copy, History, Pause, Play, Link2, Webhook, Shuffle,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useVenues } from '@/components/staff/shared'
import { Card, DAY_STARTS, inputCls, btnPrimary, btnOutline, btnDanger } from '@/components/cashRecon/reconShared'

const ago = at => at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : 'never'
const day = d => d ? format(new Date(d + 'T12:00:00'), 'd MMM yyyy') : ''

function useIntegrations() {
  const api = useApi()
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations/connections'),
    // Poll while something is running or waiting, so progress shows.
    refetchInterval: q => {
      const list = q.state.data?.connections || []
      const busy = list.some(c => c.syncing || c.sync_requested || c.venues.some(v => v.history.started && !v.history.done_at))
      return busy ? 5000 : false
    },
  })
}

export default function Integrations() {
  const perm = usePermission('cash_recon')
  const canSetup = perm.canManage && perm.isOwnerOrAdmin
  const { data, isLoading, error } = useIntegrations()
  const [adding, setAdding] = useState(false)
  const connections = data?.connections || []

  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="bg-background border-b px-4 max-lg:notouch:pl-14 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <Plug className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-bold flex-1">Integrations</h1>
          {canSetup && !adding && (
            <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Connect a till
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {perm.loaded && !perm.canView && (
          <p className="text-sm text-muted-foreground">Your role doesn&apos;t have access to Cash reconciliation, which these connections belong to.</p>
        )}
        {perm.loaded && perm.canView && !perm.canManage && <ReadOnlyNotice what="the integrations" />}
        {perm.canManage && !perm.isOwnerOrAdmin && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            You can sync and fetch history. Adding accounts and linking venues is for owners and admins.
          </div>
        )}
        <p className="text-sm text-muted-foreground leading-relaxed">
          Sales from other tills, kept in Macaroonie: every receipt with its lines, modifiers, discounts, taxes and
          payments, in pence exactly as the till recorded it. Receipts arrive within a minute or two through the
          webhook, and every 15 minutes anyway; linking a venue fetches its last 13 months. Customers are kept as the
          till&apos;s customer number only, never their name or contact details.
        </p>

        {adding && <ConnectForm onDone={() => setAdding(false)} />}
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {!isLoading && !error && perm.canView && connections.length === 0 && !adding && (
          <Card title="No tills connected">
            <p className="text-sm text-muted-foreground">
              Connect a Loyverse account to keep its sales here and fill Cash Recon from it.
              {canSetup ? ' Tap Connect a till.' : ' An owner or admin can connect one.'}
            </p>
          </Card>
        )}
        {connections.map(c => (
          <ConnectionCard key={c.id} conn={c} canManage={perm.canManage} canSetup={canSetup} />
        ))}
      </div>
    </div>
  )
}

// ── Connect ──────────────────────────────────────────────────────────────────

function ConnectForm({ onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [made, setMade] = useState(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      const r = await api.post('/loyverse/connections', { name: name.trim(), access_token: token.trim() })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
      if (r.webhook && !r.webhook.registered) setMade(r)
      else onDone()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  if (made) {
    return (
      <Card title="Connected">
        <WebhookShown result={made.webhook} />
        <button type="button" onClick={onDone} className={cn(btnPrimary, 'w-fit')}>Done</button>
      </Card>
    )
  }

  return (
    <Card title="Connect a Loyverse account">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Loyverse account" className={inputCls} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Access token</span>
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
          placeholder="Paste the token from Loyverse" className={inputCls} />
      </label>
      <p className="text-xs text-muted-foreground leading-relaxed">
        In the Loyverse Back Office open <strong>Integrations &gt; Access tokens</strong>, add a token and paste it
        here. It is checked with Loyverse before it is saved and is never shown again.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={btnOutline}>Cancel</button>
        <button type="button" onClick={save} disabled={!name.trim() || token.trim().length < 8 || busy} className={btnPrimary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Check and connect
        </button>
      </div>
    </Card>
  )
}

function WebhookShown({ result }) {
  const [copied, setCopied] = useState(false)
  if (!result) return null
  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
      {result.registered
        ? <p className="text-sm text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Registered with Loyverse: new receipts reach Macaroonie within a minute or two.</p>
        : (
          <p className="text-sm">
            Loyverse didn&apos;t take the webhook{result.error ? ' (' + result.error + ')' : ''}. Sales still arrive every
            15 minutes. To have them sooner, add this address as a webhook for receipts in Loyverse. It is shown only now.
          </p>
        )}
      {result.url && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs break-all flex-1 min-w-[200px] rounded-lg border bg-background px-2 py-2">{result.url}</code>
          <button type="button" className={btnOutline}
            onClick={() => { navigator.clipboard?.writeText(result.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {}) }}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── A connection ─────────────────────────────────────────────────────────────

function StatusPill({ conn }) {
  const [label, cls] = conn.status === 'paused' ? ['Paused', 'bg-muted text-muted-foreground']
    : conn.status === 'error' ? ['Needs attention', 'bg-red-100 text-red-800']
    : conn.syncing ? ['Syncing', 'bg-sky-100 text-sky-800']
    : conn.late ? ['Late', 'bg-amber-100 text-amber-800']
    : ['Active', 'bg-green-100 text-green-800']
  return <span className={cn('text-xs font-semibold rounded-full px-2.5 py-1', cls)}>{label}</span>
}

function ConnectionCard({ conn: c, canManage, canSetup }) {
  const api = useApi()
  const qc = useQueryClient()
  const [mode, setMode] = useState(null)        // null | 'rename' | 'token' | 'remove' | 'link'
  const [name, setName] = useState(c.name)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState(null)
  const [webhook, setWebhook] = useState(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['integrations'] })
    qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
    qc.invalidateQueries({ queryKey: ['loyverse-link'] })
  }

  async function run(what, fn) {
    setBusy(what); setNote(null)
    try { await fn() } catch (e) { setNote({ error: true, text: e.message }) }
    setBusy(null)
  }

  const counts = c.last_sync_counts || {}
  const catalogCount = Object.values(c.catalog || {}).reduce((a, b) => a + b, 0)

  return (
    <Card
      title={<span className="flex items-center gap-2 flex-wrap">{c.system_label}: {c.name} <StatusPill conn={c} /></span>}
      action={canManage && c.status !== 'paused' && (
        <button type="button" disabled={!!busy} className={cn(btnOutline, 'bg-background')}
          onClick={() => run('sync', async () => { await api.post(`/integrations/connections/${c.id}/sync`, {}); setNote({ text: 'Sync queued: it runs in the background.' }); refresh() })}>
          {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync now
        </button>
      )}
    >
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Account</div>
          <div>{[c.business_name, c.currency, c.token_hint && 'Token ending ' + c.token_hint].filter(Boolean).join(' · ') || 'Not checked yet'}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Last sync</div>
          <div>
            {c.last_sync_ok_at ? 'Worked ' + ago(c.last_sync_ok_at) : 'Not yet'}
            {c.sync_requested && !c.syncing && ' · one is queued'}
          </div>
          {c.last_sync_ok_at && (
            <div className="text-xs text-muted-foreground">
              {counts.sales ?? 0} receipts read, {counts.checks ?? 0} saved, {catalogCount} catalogue entries kept
            </div>
          )}
        </div>
      </div>
      <Link to={'/integrations/mapping?connection=' + c.id} className={cn(btnOutline, 'w-fit')}>
        <Shuffle className="w-4 h-4" /> Item mapping
      </Link>
      {c.last_sync_error && (
        <p className="text-sm text-destructive flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{c.last_sync_error}</p>
      )}
      {c.late && !c.last_sync_error && (
        <p className="text-sm text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />No good sync for over 50 minutes. It keeps trying every 15 minutes.</p>
      )}

      <div className="rounded-xl border p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Webhook className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm flex-1">
            {c.webhook.registered ? 'Webhook registered with Loyverse' : c.webhook.set ? 'Webhook address made (not registered with Loyverse)' : 'No webhook: sales arrive every 15 minutes'}
            {c.webhook.last_at && <span className="text-muted-foreground"> · last call {ago(c.webhook.last_at)}</span>}
          </span>
          {canSetup && (
            <button type="button" disabled={!!busy} className={btnOutline}
              onClick={() => run('webhook', async () => { setWebhook(await api.post(`/integrations/connections/${c.id}/webhook`, {})); refresh() })}>
              {busy === 'webhook' && <Loader2 className="w-4 h-4 animate-spin" />} New webhook address
            </button>
          )}
        </div>
        {webhook && <WebhookShown result={webhook} />}
      </div>

      <VenueList conn={c} canManage={canManage} canSetup={canSetup} onChanged={refresh} />

      {note && <p className={cn('text-sm', note.error ? 'text-destructive' : 'text-green-700')}>{note.text}</p>}

      {canSetup && !mode && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnOutline} onClick={() => setMode('link')}><Link2 className="w-4 h-4" /> Link a venue</button>
          <button type="button" disabled={!!busy} className={btnOutline}
            onClick={() => run('check', async () => {
              const r = await api.post(`/loyverse/connections/${c.id}/test`)
              setNote(r.ok ? { text: 'The token works.' } : { error: true, text: r.error })
              refresh()
            })}>
            {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Check token
          </button>
          <button type="button" className={btnOutline} onClick={() => { setName(c.name); setMode('rename') }}><Pencil className="w-4 h-4" /> Rename</button>
          <button type="button" className={btnOutline} onClick={() => { setToken(''); setMode('token') }}>Replace token</button>
          <button type="button" disabled={!!busy} className={btnOutline}
            onClick={() => run('pause', async () => { await api.patch(`/integrations/connections/${c.id}`, { status: c.status === 'paused' ? 'active' : 'paused' }); refresh() })}>
            {c.status === 'paused' ? <><Play className="w-4 h-4" /> Resume</> : <><Pause className="w-4 h-4" /> Pause</>}
          </button>
          <button type="button" className={cn(btnOutline, 'text-destructive')} onClick={() => setMode('remove')}><Trash2 className="w-4 h-4" /> Disconnect</button>
        </div>
      )}

      {mode === 'link' && <LinkForm conn={c} onDone={() => { setMode(null); refresh() }} />}
      {mode === 'rename' && (
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className={cn(inputCls, 'flex-1 min-w-[200px]')} />
          <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!name.trim() || !!busy}
            onClick={() => run('rename', async () => { await api.patch(`/loyverse/connections/${c.id}`, { name: name.trim() }); setMode(null); refresh() })}>
            Save
          </button>
        </div>
      )}
      {mode === 'token' && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">New access token</span>
            <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the token from Loyverse" className={inputCls} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={token.trim().length < 8 || !!busy}
              onClick={() => run('token', async () => { await api.patch(`/loyverse/connections/${c.id}`, { access_token: token.trim() }); setMode(null); refresh() })}>
              {busy === 'token' && <Loader2 className="w-4 h-4 animate-spin" />} Check and replace
            </button>
          </div>
        </div>
      )}
      {mode === 'remove' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">
            Disconnect <strong>{c.name}</strong>? Its {c.venues.length === 1 ? 'venue loses its' : c.venues.length + ' venues lose their'} link and
            Cash Recon mapping, and every sale kept from it ({c.venues.reduce((n, v) => n + v.checks, 0)} receipts) is deleted.
            Cash Recon days already filled keep their figures.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnDanger} disabled={!!busy}
              onClick={() => run('remove', async () => { await api.delete(`/loyverse/connections/${c.id}`); setMode(null); refresh() })}>
              Yes, disconnect
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Its venues ───────────────────────────────────────────────────────────────

function VenueList({ conn: c, canManage, canSetup, onChanged }) {
  if (!c.venues.length) {
    return <p className="text-sm text-muted-foreground">No venue linked yet. Link a venue to its Loyverse store to keep its sales.</p>
  }
  return (
    <div className="divide-y rounded-xl border">
      {c.venues.map(v => <VenueRow key={v.venue_id} conn={c} v={v} canManage={canManage} canSetup={canSetup} onChanged={onChanged} />)}
    </div>
  )
}

function VenueRow({ conn: c, v, canManage, canSetup, onChanged }) {
  const api = useApi()
  const [mode, setMode] = useState(null)        // null | 'history' | 'unlink' | 'edit'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const h = v.history
  const pct = Math.round((h.progress || 0) * 100)

  async function run(fn) {
    setBusy(true); setError(null)
    try { await fn(); setMode(null); onChanged() } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{v.venue_name}</div>
          <div className="text-xs text-muted-foreground">
            Store {v.store_name || v.store_id} · trading day starts {v.day_starts_at}
          </div>
          <div className="text-xs mt-1">
            {v.checks} receipts kept{v.refunds ? ', ' + v.refunds + ' refunds' : ''}{v.cancelled ? ', ' + v.cancelled + ' cancelled' : ''}
            {v.first_day && <span className="text-muted-foreground"> · {day(v.first_day)} to {day(v.last_day)}</span>}
          </div>
        </div>
        <Link to={`/cash-recon?venue=${v.venue_id}`} className={cn(btnOutline, 'text-sm')}>Cash Recon</Link>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1"><History className="w-3.5 h-3.5" /> History (13 months)</span>
          <span className="text-muted-foreground">
            {!h.started ? 'Not fetched' : h.done_at ? 'Done ' + ago(h.done_at) + ' · ' + h.count + ' receipts' : pct + '% · ' + h.count + ' receipts so far'}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full', h.done_at ? 'bg-green-600' : 'bg-primary')} style={{ width: (h.started ? Math.max(pct, 2) : 0) + '%' }} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!mode && (canManage || canSetup) && (
        <div className="flex flex-wrap gap-2">
          {canManage && c.status !== 'paused' && (
            <button type="button" className={btnOutline} onClick={() => setMode('history')}><History className="w-4 h-4" /> Fetch history</button>
          )}
          {canSetup && <button type="button" className={btnOutline} onClick={() => setMode('edit')}><Pencil className="w-4 h-4" /> Change store or day start</button>}
          {canSetup && <button type="button" className={cn(btnOutline, 'text-destructive')} onClick={() => setMode('unlink')}>Unlink</button>}
        </div>
      )}
      {mode === 'history' && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <p className="text-sm">Fetch the last 13 months of {v.venue_name}&apos;s receipts again? Receipts already kept are updated, not doubled. It runs in the background.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={busy}
              onClick={() => run(() => api.post(`/integrations/connections/${c.id}/venues/${v.venue_id}/history`, {}))}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Yes, fetch
            </button>
          </div>
        </div>
      )}
      {mode === 'edit' && <LinkForm conn={c} venue={v} onDone={() => { setMode(null); onChanged() }} />}
      {mode === 'unlink' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">Unlink {v.venue_name} from Loyverse? Its Cash Recon mapping goes; the receipts already kept stay.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnDanger} disabled={busy}
              onClick={() => run(() => api.delete(`/loyverse/venues/${v.venue_id}/link`))}>
              Yes, unlink
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Link a venue to a store (or change a link): venue, store, day start, one Save. */
function LinkForm({ conn: c, venue = null, onDone }) {
  const api = useApi()
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useState(venue?.venue_id || '')
  const [storeId, setStoreId] = useState(venue?.store_id || '')
  const [dayStart, setDayStart] = useState(venue?.day_starts_at || '00:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { data: catalog, isLoading, error: storesError } = useQuery({
    queryKey: ['loyverse-catalog', c.id],
    queryFn: () => api.get(`/loyverse/connections/${c.id}/catalog`),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const linked = useMemo(() => new Set(c.venues.map(v => v.venue_id)), [c.venues])
  const choices = venues.filter(v => v.id === venue?.venue_id || !linked.has(v.id))
  const stores = catalog?.stores || []

  async function save() {
    setBusy(true); setError(null)
    try {
      const store = stores.find(s => s.id === storeId)
      await api.put(`/loyverse/venues/${venueId}/link`, { connection_id: c.id, store_id: storeId, store_name: store?.name ?? null, day_starts_at: dayStart })
      onDone()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Venue</span>
          <select value={venueId} disabled={!!venue} onChange={e => setVenueId(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {choices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Loyverse store</span>
          <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls} disabled={isLoading}>
            <option value="">{isLoading ? 'Loading…' : 'Choose a store…'}</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Trading day starts at</span>
          <select value={dayStart} onChange={e => setDayStart(e.target.value)} className={inputCls}>
            {DAY_STARTS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Sales before the trading day start count on the day before (e.g. 04:00 if you trade past midnight), in the
        venue&apos;s local time. A new store link fetches its last 13 months in the background.
      </p>
      {storesError && <p className="text-sm text-destructive">{storesError.message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnOutline} onClick={onDone}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={!venueId || !storeId || busy} onClick={save}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </div>
    </div>
  )
}
