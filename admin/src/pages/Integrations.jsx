// src/pages/Integrations.jsx
//
// Integrations (/integrations): other tills whose sales Macaroonie keeps
// (docs/SALES_IMPORT.md, migrations 288 to 294). Each connection (a
// Loyverse or Square account; Simphony later) with its status, last sync,
// webhook and venues: each venue's store or location, trading day start,
// history import progress and the checks stored. Sync now and Fetch history
// queue the background sync; nothing is read from the other till in the
// page's requests but the token check and the location list.
//
// Square (phase 5): a pasted access token per environment (production or
// sandbox), or Sign in with Square when the server has the OAuth app's
// settings (GET /api/square/oauth). Square sends the person back through
// the API's callback to here with ?square_code=&square_state=; the page
// hands both to POST /api/square/oauth/finish (the API checks the state is
// this tenant's and this person's) and clears them from the address.
// Square's webhook signature key can be pasted.
//
// Permissions (Cash reconciliation): View sees it, Manage syncs and fetches
// history, owners and admins with Manage set accounts, links, the webhook
// and pausing (the API's guards are the real check). The Cash Recon field
// mapping stays in Cash Recon settings > Loyverse (Loyverse only).

import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  const signIn = useSquareReturn()

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

        {signIn.state !== 'idle' && (
          <Card title="Sign in with Square">
            {signIn.state === 'busy' && <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Connecting your Square account…</p>}
            {signIn.state === 'error' && <p className="text-sm text-destructive">{signIn.error}</p>}
            {signIn.state === 'done' && (
              <>
                <p className="text-sm text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Square account connected. Link a venue to one of its locations below.</p>
                <WebhookShown result={signIn.result?.webhook} system="square" />
              </>
            )}
            {signIn.state !== 'busy' && <button type="button" onClick={signIn.clear} className={cn(btnOutline, 'w-fit')}>Close</button>}
          </Card>
        )}
        {adding && <ConnectForm onDone={() => setAdding(false)} />}
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {!isLoading && !error && perm.canView && connections.length === 0 && !adding && (
          <Card title="No tills connected">
            <p className="text-sm text-muted-foreground">
              Connect a Loyverse or Square account to keep its sales here (and, for Loyverse, fill Cash Recon from it).
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

const LABEL = { loyverse: 'Loyverse', square: 'Square' }
const ENVIRONMENTS = [['production', 'Production (live sales)'], ['sandbox', 'Sandbox (Square test account)']]

/**
 * After Sign in with Square, Square sends the person to the API's
 * /api/square/oauth/callback, which sends them on here with
 * ?square_code=&square_state= (or square_error=): Auth0's sign-in would take
 * a plain ?code=&state= as its own. They go to the API once, and the
 * address is cleared so a reload doesn't send them again.
 */
function useSquareReturn() {
  const api = useApi()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [s, setS] = useState({ state: 'idle' })
  const sent = useRef(false)
  const code = params.get('square_code')
  const state = params.get('square_state')
  const denied = params.get('square_error')
  useEffect(() => {
    if (sent.current || (!code && !denied)) return
    sent.current = true
    setParams({}, { replace: true })
    if (denied || !state) {
      setS({ state: 'error', error: 'Square didn\'t connect the account' + (denied ? ' (' + (params.get('square_error_description') || denied) + ')' : '') + '. Try again.' })
      return
    }
    setS({ state: 'busy' })
    api.post('/square/oauth/finish', { code, state })
      .then(r => { setS({ state: 'done', result: r }); qc.invalidateQueries({ queryKey: ['integrations'] }) })
      .catch(e => setS({ state: 'error', error: e.message }))
  }, [code, state, denied]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, clear: () => setS({ state: 'idle' }) }
}

function ConnectForm({ onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const [system, setSystem] = useState('loyverse')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [environment, setEnvironment] = useState('production')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [made, setMade] = useState(null)
  const { data: oauth } = useQuery({
    queryKey: ['square-oauth'],
    queryFn: () => api.get('/square/oauth'),
    enabled: system === 'square',
    staleTime: 5 * 60_000,
  })

  async function save() {
    setBusy(true); setError(null)
    try {
      const r = system === 'square'
        ? await api.post('/square/connections', { name: name.trim(), access_token: token.trim(), environment })
        : await api.post('/loyverse/connections', { name: name.trim(), access_token: token.trim() })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['loyverse-connections'] })
      if (r.webhook && !r.webhook.registered) setMade(r)
      else onDone()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  async function signIn() {
    setBusy(true); setError(null)
    try {
      const r = await api.post('/square/oauth/start', { name: name.trim() || 'Square' })
      window.location.assign(r.url)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  if (made) {
    return (
      <Card title="Connected">
        <WebhookShown result={made.webhook} system={system} />
        <button type="button" onClick={onDone} className={cn(btnPrimary, 'w-fit')}>Done</button>
      </Card>
    )
  }

  const label = LABEL[system]
  return (
    <Card title="Connect a till">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Till">
        {Object.entries(LABEL).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={system === k} onClick={() => { setSystem(k); setError(null) }}
            className={cn(btnOutline, system === k && 'border-primary bg-primary/10 font-semibold')}>
            {system === k && <Check className="w-4 h-4" />} {l}
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={'e.g. Main ' + label + ' account'} className={inputCls} />
      </label>
      {system === 'square' && oauth?.available && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <p className="text-sm">Sign in to Square and allow Macaroonie to read your items and orders. You come back here when it&apos;s done.</p>
          <button type="button" onClick={signIn} disabled={busy} className={cn(btnPrimary, 'w-fit')}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in with Square
          </button>
          <p className="text-xs text-muted-foreground">Or paste an access token below.</p>
        </div>
      )}
      {system === 'square' && oauth && !oauth.available && (
        <p className="text-xs text-muted-foreground leading-relaxed" data-testid="square-oauth-off">
          Sign in with Square isn&apos;t set up on this server yet, so paste an access token instead.
        </p>
      )}
      {system === 'square' && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">Square environment</span>
          <select value={environment} onChange={e => setEnvironment(e.target.value)} className={inputCls}>
            {ENVIRONMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Access token</span>
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
          placeholder={'Paste the token from ' + label} className={inputCls} />
      </label>
      {system === 'loyverse' ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          In the Loyverse Back Office open <strong>Integrations &gt; Access tokens</strong>, add a token and paste it
          here. It is checked with Loyverse before it is saved and is never shown again.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          On Square&apos;s Developer Dashboard open your application, then <strong>Credentials</strong>, and copy the
          access token for the environment chosen above. It is checked with Square before it is saved and is never shown again.
        </p>
      )}
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

function WebhookShown({ result, system = 'loyverse' }) {
  const [copied, setCopied] = useState(false)
  if (!result) return null
  const label = LABEL[system] || 'the till'
  const where = system === 'square'
    ? 'add a webhook subscription in Square\'s Developer Dashboard with this address and the events order.created, order.updated and catalog.version.updated, then paste its signature key on this connection'
    : 'add this address as a webhook for receipts in Loyverse'
  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
      {result.registered
        ? <p className="text-sm text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Registered with {label}{result.signed ? ' (its calls are signed)' : ''}: new sales reach Macaroonie within a minute or two.</p>
        : (
          <p className="text-sm">
            {label} didn&apos;t take the webhook{result.error ? ' (' + result.error + ')' : ''}. Sales still arrive every
            15 minutes. To have them sooner, {where}. The address is shown only now.
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
  const [mode, setMode] = useState(null)        // null | 'rename' | 'token' | 'remove' | 'link' | 'signature'
  const [name, setName] = useState(c.name)
  const [token, setToken] = useState('')
  const [sigKey, setSigKey] = useState('')
  const square = c.system === 'square'
  const label = c.system_label || LABEL[c.system] || c.system
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
          {square && (
            <div className="text-xs text-muted-foreground" data-testid="square-account">
              {c.environment === 'sandbox' ? 'Sandbox' : 'Production'}
              {' · '}{c.auth_kind === 'oauth' ? 'Signed in with Square' + (c.token_expires_at ? ', renewed before ' + format(new Date(c.token_expires_at), 'd MMM yyyy') : '') : 'Access token'}
            </div>
          )}
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
      <div className="flex flex-wrap items-center gap-3">
        <Link to={'/integrations/mapping?connection=' + c.id} className={cn(btnOutline, 'w-fit')}>
          <Shuffle className="w-4 h-4" /> Item mapping
        </Link>
        <span className="text-sm text-muted-foreground" data-testid="mapping-summary">
          {c.mapping?.percent == null
            ? 'No item sales in the last ' + (c.mapping?.days || 30) + ' days yet'
            : c.mapping.percent + '% of the last ' + c.mapping.days + ' days\' item sales mapped or kept'}
          {' · '}{c.mapping?.rules || 0} {c.mapping?.rules === 1 ? 'rule' : 'rules'}
        </span>
      </div>
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
            {c.webhook.registered ? 'Webhook registered with ' + label : c.webhook.set ? 'Webhook address made (not registered with ' + label + ')' : 'No webhook: sales arrive every 15 minutes'}
            {square && c.webhook.set && (c.webhook.signed
              ? <span className="text-muted-foreground"> · signature key ending {c.webhook.signature_hint}</span>
              : <span className="text-amber-800"> · no signature key: only the address is checked</span>)}
            {c.webhook.last_at && <span className="text-muted-foreground"> · last call {ago(c.webhook.last_at)}</span>}
          </span>
          {canSetup && square && c.webhook.set && (
            <button type="button" disabled={!!busy} className={btnOutline} onClick={() => { setSigKey(''); setMode('signature') }}>
              Signature key
            </button>
          )}
          {canSetup && (
            <button type="button" disabled={!!busy} className={btnOutline}
              onClick={() => run('webhook', async () => { setWebhook(await api.post(`/integrations/connections/${c.id}/webhook`, {})); refresh() })}>
              {busy === 'webhook' && <Loader2 className="w-4 h-4 animate-spin" />} New webhook address
            </button>
          )}
        </div>
        {webhook && <WebhookShown result={webhook} system={c.system} />}
        {mode === 'signature' && (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Square&apos;s signature key for this webhook</span>
              <input type="password" autoComplete="off" value={sigKey} onChange={e => setSigKey(e.target.value)}
                placeholder="Paste it from the webhook subscription in Square" className={inputCls} />
            </label>
            <p className="text-xs text-muted-foreground">With it, a call to the address must carry Square&apos;s signature. Kept sealed, never shown again.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
              {c.webhook.signed && (
                <button type="button" className={btnOutline} disabled={!!busy}
                  onClick={() => run('sig', async () => { await api.patch(`/square/connections/${c.id}`, { signature_key: null }); setMode(null); refresh() })}>
                  Remove key
                </button>
              )}
              <button type="button" className={btnPrimary} disabled={sigKey.trim().length < 8 || !!busy}
                onClick={() => run('sig', async () => { await api.patch(`/square/connections/${c.id}`, { signature_key: sigKey.trim() }); setMode(null); setNote({ text: 'Signature key saved.' }); refresh() })}>
                Save key
              </button>
            </div>
          </div>
        )}
      </div>

      <VenueList conn={c} canManage={canManage} canSetup={canSetup} onChanged={refresh} />

      {note && <p className={cn('text-sm', note.error ? 'text-destructive' : 'text-green-700')}>{note.text}</p>}

      {canSetup && !mode && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnOutline} onClick={() => setMode('link')}><Link2 className="w-4 h-4" /> Link a venue</button>
          <button type="button" disabled={!!busy} className={btnOutline}
            onClick={() => run('check', async () => {
              const r = await api.post(`/${c.system}/connections/${c.id}/test`)
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
            onClick={() => run('rename', async () => { await api.patch(`/integrations/connections/${c.id}`, { name: name.trim() }); setMode(null); refresh() })}>
            Save
          </button>
        </div>
      )}
      {mode === 'token' && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">New access token</span>
            <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder={'Paste the token from ' + label} className={inputCls} />
          </label>
          {square && c.auth_kind === 'oauth' && (
            <p className="text-xs text-muted-foreground">A pasted token takes the place of the Square sign-in for this account.</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={token.trim().length < 8 || !!busy}
              onClick={() => run('token', async () => { await api.patch(`/${c.system}/connections/${c.id}`, { access_token: token.trim() }); setMode(null); refresh() })}>
              {busy === 'token' && <Loader2 className="w-4 h-4 animate-spin" />} Check and replace
            </button>
          </div>
        </div>
      )}
      {mode === 'remove' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm">
            Disconnect <strong>{c.name}</strong>? Its {c.venues.length === 1 ? 'venue loses its' : c.venues.length + ' venues lose their'} link
            {c.system === 'loyverse' ? ' and Cash Recon mapping' : ''}, and every sale kept from it ({c.venues.reduce((n, v) => n + v.checks, 0)} receipts) is deleted.
            {c.system === 'loyverse' ? ' Cash Recon days already filled keep their figures.' : ''}
            {square && c.auth_kind === 'oauth' ? ' Macaroonie\'s access to the Square account is given back.' : ''}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnDanger} disabled={!!busy}
              onClick={() => run('remove', async () => { await api.delete(`/integrations/connections/${c.id}`); setMode(null); refresh() })}>
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
    return <p className="text-sm text-muted-foreground">No venue linked yet. Link a venue to its {c.system === 'square' ? 'Square location' : 'Loyverse store'} to keep its sales.</p>
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
            {c.system === 'square' ? 'Location' : 'Store'} {v.store_name || v.store_id} · trading day starts {v.day_starts_at}
          </div>
          <div className="text-xs mt-1">
            {v.checks} receipts kept{v.refunds ? ', ' + v.refunds + ' refunds' : ''}{v.cancelled ? ', ' + v.cancelled + ' cancelled' : ''}
            {v.first_day && <span className="text-muted-foreground"> · {day(v.first_day)} to {day(v.last_day)}</span>}
          </div>
        </div>
        {c.system === 'loyverse' && <Link to={`/cash-recon?venue=${v.venue_id}`} className={cn(btnOutline, 'text-sm')}>Cash Recon</Link>}
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
          {canSetup && <button type="button" className={btnOutline} onClick={() => setMode('edit')}><Pencil className="w-4 h-4" /> Change {c.system === 'square' ? 'location' : 'store'} or day start</button>}
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
          <p className="text-sm">Unlink {v.venue_name} from {c.system_label}?{c.system === 'loyverse' ? ' Its Cash Recon mapping goes;' : ''} the receipts already kept stay.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnOutline} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={btnDanger} disabled={busy}
              onClick={() => run(() => api.delete(`/integrations/connections/${c.id}/venues/${v.venue_id}`))}>
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
  const { data: located, isLoading, error: storesError } = useQuery({
    queryKey: ['integration-locations', c.id],
    queryFn: () => api.get(`/integrations/connections/${c.id}/locations`),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const linked = useMemo(() => new Set(c.venues.map(v => v.venue_id)), [c.venues])
  const choices = venues.filter(v => v.id === venue?.venue_id || !linked.has(v.id))
  const stores = located?.locations || []
  const place = c.system === 'square' ? 'location' : 'store'

  async function save() {
    setBusy(true); setError(null)
    try {
      await api.put(`/integrations/connections/${c.id}/venues/${venueId}`, { location_id: storeId, day_starts_at: dayStart })
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
          <span className="text-sm font-medium">{c.system_label} {place}</span>
          <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls} disabled={isLoading}>
            <option value="">{isLoading ? 'Loading…' : 'Choose a ' + place + '…'}</option>
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
        venue&apos;s local time. A new {place} link fetches its last 13 months in the background.
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
