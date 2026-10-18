// src/pages/ConnectAi.jsx
//
// The staff connector's sign-in page (/connect-ai?request=..., migration
// 181). An AI app that can only connect with OAuth (Claude's custom
// connectors, ChatGPT) sends the person here from /oauth/authorize: they
// see which app wants Pepper and for which restaurant group, choose read
// only and how long it works, then Allow (back to the app, which gets an
// ordinary connector token) or Cancel. Outside the app shell, inside the
// login and tenant gate. API: api/src/routes/mcpOauth.js.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, Plug, CircleAlert } from 'lucide-react'
import { useApi, setSelectedTenant } from '@/lib/api'
import { ErrorNote } from '@/components/staff/shared'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const DAY_LABEL = d => (d === 365 ? 'a year' : d + ' days')

function Frame({ children }) {
  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background shadow-sm overflow-hidden">
        <div className="section-head px-5 py-3 flex items-center gap-2">
          <Plug className="w-4 h-4" />
          <h1 className="text-sm font-semibold">Connect an AI app to {ASSISTANT_NAME}</h1>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

export default function ConnectAi() {
  const [params] = useSearchParams()
  const id = params.get('request')
  const api = useApi()
  const { data, error, isLoading } = useQuery({
    queryKey: ['connect-ai', id],
    queryFn: () => api.get('/ai/oauth/requests/' + encodeURIComponent(id)),
    enabled: !!id,
    retry: false,
  })
  const [readOnly, setReadOnly] = useState(false)
  const [days, setDays] = useState(90)
  const [leaving, setLeaving] = useState(null)
  const go = (what, url) => { setLeaving(what); window.location.assign(url) }
  const allow = useMutation({
    mutationFn: () => api.post('/ai/oauth/requests/' + encodeURIComponent(id) + '/allow', { read_only: readOnly, expires_in_days: days }),
    onSuccess: r => go('allowed', r.redirect),
  })
  const deny = useMutation({
    mutationFn: () => api.post('/ai/oauth/requests/' + encodeURIComponent(id) + '/deny'),
    onSuccess: r => go('cancelled', r.redirect),
  })

  if (!id) return <Frame><p className="text-sm">This page opens from your AI app when you connect it. Start from there.</p></Frame>
  if (isLoading) return <Frame><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></Frame>
  if (error) return <Frame><ErrorNote error={error} /></Frame>
  if (leaving) {
    return (
      <Frame>
        <p className="text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {leaving === 'allowed' ? 'Connected. Going back to ' : 'Cancelled. Going back to '}{data.client_name}...
        </p>
      </Frame>
    )
  }
  if (!data.member) {
    return (
      <Frame>
        <p className="text-sm">
          This connection is for <strong>{data.tenant?.name || 'another restaurant group'}</strong>, and you're not a team member there.
          Sign in as someone who is, or ask an owner to invite you.
        </p>
        <button type="button" disabled={deny.isPending} onClick={() => deny.mutate()}
          className="w-full min-h-[48px] rounded-lg border text-sm font-medium hover:bg-muted touch-manipulation">Cancel connecting</button>
      </Frame>
    )
  }
  if (data.needs_switch) {
    return (
      <Frame>
        <p className="text-sm">
          {data.client_name} wants to connect to <strong>{data.tenant.name}</strong>, but you're working in{' '}
          {data.current_tenant?.name || 'another restaurant group'} now.
        </p>
        <button type="button" onClick={() => { setSelectedTenant(data.tenant.id); window.location.reload() }}
          className="w-full min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
          Switch to {data.tenant.name}
        </button>
      </Frame>
    )
  }

  return (
    <Frame>
      <p className="text-sm">
        <strong>{data.client_name}</strong> wants to use {ASSISTANT_NAME} as you{data.email ? ` (${data.email})` : ''} at{' '}
        <strong>{data.tenant?.name}</strong>. It can see and do what you can in Macaroonie, through {ASSISTANT_NAME}'s tools,
        and every change is made as you and listed in {ASSISTANT_NAME}'s Activity.
      </p>
      {data.problem ? (
        <p className="text-sm text-amber-800 flex items-start gap-2"><CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />{data.problem}</p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm min-h-[48px] cursor-pointer touch-manipulation">
            <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} className="w-5 h-5" />
            <span>Read only <span className="text-muted-foreground">(can look things up, can't change anything)</span></span>
          </label>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Works for</p>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Works for">
              {data.days.map(d => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
                  className={'min-h-[48px] rounded-lg border text-sm touch-manipulation ' + (days === d ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                  {DAY_LABEL(d)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <ErrorNote error={allow.error || deny.error} />
      <div className="flex gap-2">
        <button type="button" disabled={!!data.problem || allow.isPending || deny.isPending} onClick={() => allow.mutate()}
          className="flex-1 min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 touch-manipulation inline-flex items-center justify-center gap-2">
          {allow.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Allow
        </button>
        <button type="button" disabled={allow.isPending || deny.isPending} onClick={() => deny.mutate()}
          className="flex-1 min-h-[48px] rounded-lg border text-sm font-medium hover:bg-muted disabled:opacity-50 touch-manipulation">Cancel</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Allow sends you back to {data.redirect_host}. You can disconnect it at any time on the {ASSISTANT_NAME} page, Connect, where it's
        listed with your access tokens.
      </p>
    </Frame>
  )
}
