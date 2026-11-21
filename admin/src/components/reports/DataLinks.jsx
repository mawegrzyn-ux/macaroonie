// src/components/reports/DataLinks.jsx
//
// Data links (docs/REPORTS.md 15, migration 256): addresses other apps read a
// report's current figures from, with a key shown once. Owners and admins with
// Manage on Reports make and change them (routes/reportDataLinks.js).

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Link2, Trash2, Plus, Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Modal, Field, inputCls } from '@/components/staff/shared'
import { Problems, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const STATE_WORDS = { on: 'On', off: 'Switched off', expired: 'Ran out' }

function whenText(at) {
  if (!at) return 'never'
  return new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CopyButton({ text, testid, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000) } catch { /* the text stays on screen to copy by hand */ }
  }
  return (
    <button type="button" onClick={copy} data-testid={testid} className={btn}>
      {done ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{done ? 'Copied' : label}
    </button>
  )
}

// The key, once: after making a link or a new key.
function KeyShown({ link, keyText, onDone }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2" role="alert" data-testid="link-key">
      <p className="text-sm font-medium text-amber-900">Copy the key now: it isn't shown again.</p>
      <p className="text-xs text-amber-900">Send it in an Authorization: Bearer header (or X-Report-Key). Anyone with the address and the key can read “{link.name}”.</p>
      <code className="block break-all rounded bg-background border px-2 py-1 text-xs" data-testid="link-key-text">{keyText}</code>
      <code className="block break-all rounded bg-background border px-2 py-1 text-xs" data-testid="link-key-url">{link.url}</code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={keyText} testid="link-key-copy" label="Copy the key" />
        <CopyButton text={link.url} testid="link-url-copy" label="Copy the address" />
        <button type="button" onClick={onDone} data-testid="link-key-done" className={btn}>Done</button>
      </div>
    </div>
  )
}

function LinkRow({ link, onChanged, onKey }) {
  const api = useApi()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(false)
  const act = async (what, fn) => {
    setBusy(what); setError(null)
    try { await fn() } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const path = '/reports/data-links/' + link.id
  return (
    <li className="rounded-lg border bg-background p-3 space-y-2" data-testid="link-row" data-id={link.id} data-state={link.state}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[10rem]">
          <p className="text-sm font-medium break-words">{link.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {STATE_WORDS[link.state]} · key ending {link.key_hint} · {link.uses} {link.uses === 1 ? 'read' : 'reads'} · last read {whenText(link.last_used_at)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {link.rate_per_hour} calls an hour
            {link.expires_at ? ' · stops after ' + new Date(link.expires_at).toLocaleDateString('en-GB') : ''}
            {link.open_params.length ? ' · caller can set ' + link.open_params.join(', ') : ''}
            {link.personal ? ' · shows people\'s details' : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={link.url} testid="link-copy-url" label="Copy the address" />
        <button type="button" disabled={!!busy} data-testid="link-toggle" className={btn}
          onClick={() => act('toggle', async () => { await api.patch(path, { enabled: !link.enabled }); onChanged() })}>
          {link.enabled ? 'Switch off' : 'Switch on'}
        </button>
        <button type="button" disabled={!!busy} data-testid="link-new-key" className={btn}
          onClick={() => act('key', async () => { const r = await api.post(path + '/new-key', {}); onKey(r.link, r.key); onChanged() })}>
          <KeyRound className="w-4 h-4" />{busy === 'key' ? 'Making…' : 'New key'}
        </button>
        {!asking && (
          <button type="button" disabled={!!busy} data-testid="link-delete" onClick={() => setAsking(true)} className={cn(btn, 'text-red-700')}>
            <Trash2 className="w-4 h-4" />Delete
          </button>
        )}
      </div>
      {asking && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 flex flex-wrap items-center gap-2" data-testid="link-delete-ask">
          <span className="text-sm text-red-800 flex-1 min-w-[10rem]">Delete it? Apps reading it stop at once.</span>
          <button type="button" data-testid="link-delete-yes" disabled={!!busy}
            onClick={() => act('delete', async () => { await api.delete(path); onChanged() })}
            className="h-12 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation">Yes, delete it</button>
          <button type="button" data-testid="link-delete-no" onClick={() => setAsking(false)} className={btn}>Keep it</button>
        </div>
      )}
      <Problems error={error} title="That didn't work" />
    </li>
  )
}

function MakeLink({ reportId, spec, given, canPersonal, onMade, onCancel }) {
  const api = useApi()
  const params = spec?.params || []
  const [name, setName] = useState('')
  const [open, setOpen] = useState(() => params.filter(p => p.type === 'period').map(p => p.key))
  const [rate, setRate] = useState('60')
  const [until, setUntil] = useState('')
  const [personal, setPersonal] = useState(false)
  const [state, setState] = useState({ busy: false, error: null })
  const rateNum = Number(rate)
  const ok = name.trim() && Number.isInteger(rateNum) && rateNum >= 1 && rateNum <= 3600
  const make = async () => {
    setState({ busy: true, error: null })
    try {
      const fixed = Object.fromEntries(params.filter(p => p.key in given).map(p => [p.key, given[p.key]]))
      const r = await api.post('/reports/' + encodeURIComponent(reportId) + '/data-links', {
        name: name.trim(), params: fixed, open_params: open, rate_per_hour: rateNum,
        expires_on: until || null, ...(canPersonal ? { personal } : {}),
      })
      onMade(r.link, r.key)
    } catch (error) {
      setState({ busy: false, error })
    }
  }
  return (
    <div className="rounded-lg border bg-background p-3 space-y-3" data-testid="link-make">
      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Power BI sales feed" data-testid="link-name" className={inputCls} />
      </Field>
      <p className="text-xs text-muted-foreground">The choices picked on this page are the link's own. Tick any the reading app may change in the address.</p>
      {params.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="link-open">
          {params.map(p => {
            const on = open.includes(p.key)
            return (
              <button key={p.key} type="button" aria-pressed={on} data-testid="link-open-param" data-key={p.key}
                onClick={() => setOpen(o => (on ? o.filter(k => k !== p.key) : [...o, p.key]))}
                className={cn(btn, on && 'border-primary bg-primary/10')}>
                {on && <Check className="w-4 h-4" />}{p.label || p.key}
              </button>
            )
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Field label="Calls an hour">
          <input type="text" inputMode="numeric" value={rate} onChange={e => setRate(e.target.value.replace(/\D/g, ''))} data-testid="link-rate" className={cn(inputCls, 'w-28')} />
        </Field>
        <Field label="Last day (optional)">
          <input type="date" value={until} onChange={e => setUntil(e.target.value)} data-testid="link-until" className={cn(inputCls, 'w-44')} />
        </Field>
      </div>
      {canPersonal && (
        <label className="flex items-start gap-2 text-sm min-h-[48px] touch-manipulation">
          <input type="checkbox" checked={personal} onChange={e => setPersonal(e.target.checked)} data-testid="link-personal" className="mt-1 w-5 h-5" />
          <span>Include people's details (names, emails, phones). Left off, those columns are left out.</span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={make} disabled={!ok || state.busy} data-testid="link-make-go"
          className="h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
          {state.busy ? 'Making…' : 'Make the link'}
        </button>
        <button type="button" onClick={onCancel} data-testid="link-make-cancel" className={btn}>Cancel</button>
      </div>
      <Problems error={state.error} title="The link wasn't made" />
    </div>
  )
}

export function DataLinksWindow({ reportId, reportName, spec, given, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const key = ['report-data-links', reportId]
  const q = useQuery({
    queryKey: key, queryFn: () => api.get('/reports/data-links?report=' + encodeURIComponent(reportId)),
    retry: retryUnlessRefused, staleTime: 0, gcTime: 0,
  })
  const [making, setMaking] = useState(false)
  const [shown, setShown] = useState(null)   // { link, key }
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const links = q.data?.links || []
  return (
    <Modal title={'Data links: ' + reportName} onClose={onClose}>
      <div className="space-y-3" data-testid="data-links">
        <p className="text-xs text-muted-foreground">
          An address other apps (Power BI, Google Sheets, your own systems) read this report's current figures from, as JSON or CSV. It runs with your access each time it is read.
        </p>
        {shown && <KeyShown link={shown.link} keyText={shown.key} onDone={() => setShown(null)} />}
        <Problems error={q.error} title="The links couldn't be loaded" />
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isLoading && !q.error && !links.length && !making && (
          <p className="text-sm text-muted-foreground" data-testid="links-none">No data links for this report yet.</p>
        )}
        {links.length > 0 && (
          <ul className="space-y-2" data-testid="links-list">
            {links.map(l => <LinkRow key={l.id} link={l} onChanged={refresh} onKey={(link, k) => setShown({ link, key: k })} />)}
          </ul>
        )}
        {making ? (
          <MakeLink reportId={reportId} spec={spec} given={given} canPersonal={!!q.data?.can_personal}
            onCancel={() => setMaking(false)}
            onMade={(link, k) => { setMaking(false); setShown({ link, key: k }); refresh() }} />
        ) : !q.error && (
          <button type="button" onClick={() => setMaking(true)} data-testid="link-add" className={btn}>
            <Plus className="w-4 h-4" />Make a data link
          </button>
        )}
        <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" />The key goes in a header, never in an email or a message.</p>
      </div>
    </Modal>
  )
}
