// src/components/orders/StripeAccountCard.jsx
//
// The group's own Stripe account (Stripe Connect, migration 215): connect
// it, finish Stripe's sign-up, see whether it can take payments, unlink.
// Used by Ordering setup (Card (Stripe) at checkout) and Store tech, Card
// machines (Stripe card machines through the group's account). Every
// change is a button the person presses; Stripe's own sign-up page does
// the rest and sends them back here (?stripe=return, or ?stripe=refresh
// when its link ran out, which makes a new one).

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, ExternalLink, Loader2, RefreshCw, Unlink } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'

const STALE_MS = 5 * 60_000

export function useStripeAccount() {
  const api = useApi()
  return useQuery({ queryKey: ['stripe-account'], queryFn: () => api.get('/stripe'), staleTime: 30_000 })
}

export default function StripeAccountCard({ module = 'web_ordering_setup', purpose = 'ordering' }) {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage, isOwnerOrAdmin } = usePermission(module)
  const canChange = canManage && isOwnerOrAdmin
  const q = useStripeAccount()
  const s = q.data
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const setData = d => qc.setQueryData(['stripe-account'], d)

  const refresh = useMutation({ mutationFn: () => api.post('/stripe/refresh', {}), onSuccess: setData })
  const connect = useMutation({
    mutationFn: () => {
      const back = new URL(window.location.href)
      back.searchParams.delete('stripe')
      return api.post('/stripe/connect', { return_url: back.toString() })
    },
    onSuccess: r => { window.location.href = r.url },
  })
  const unlink = useMutation({
    mutationFn: () => api.delete('/stripe'),
    onSuccess: d => { setData(d); setConfirmUnlink(false); qc.invalidateQueries({ queryKey: ['ordering-settings'] }) },
  })

  // Back from Stripe: ask it how the sign-up went; an expired link makes a new one.
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current || !s) return
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('stripe')
    if (flag) {
      handled.current = true
      url.searchParams.delete('stripe')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      if (flag === 'refresh' && canChange) connect.mutate()
      else if (s.connected) refresh.mutate()
      return
    }
    if (s.connected && (!s.checked_at || Date.now() - new Date(s.checked_at).getTime() > STALE_MS)) {
      handled.current = true
      refresh.mutate()
    }
  }, [s, canChange])   // eslint-disable-line react-hooks/exhaustive-deps

  const busy = refresh.isPending || connect.isPending || unlink.isPending
  const error = refresh.error || connect.error || unlink.error
  const what = purpose === 'terminal' ? 'card machine payments' : 'card payments online'

  if (q.isLoading) return <div className="rounded-lg border p-4"><Loader2 className="w-4 h-4 animate-spin" /></div>
  if (q.error) return <p className="text-sm text-destructive">{q.error.message}</p>

  return (
    <div className="rounded-lg border p-4 space-y-3" data-testid="stripe-account">
      <div className="flex items-start gap-3">
        <StatusIcon s={s} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" data-testid="stripe-account-state">{headline(s)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{explain(s, what)}</p>
          {s.connected && (
            <p className="text-xs text-muted-foreground mt-1">
              {s.account_name ? <span className="font-medium text-foreground">{s.account_name}</span> : null}
              {s.account_name ? ' · ' : ''}<span className="font-mono">{s.account_id}</span>
              {s.mode === 'test' && <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[11px] font-medium">Test mode</span>}
            </p>
          )}
        </div>
      </div>

      {!s.platform_ready && (
        <p className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2" data-testid="stripe-platform-off">
          Stripe isn't switched on for this platform yet: a platform admin adds Stripe's keys on the{' '}
          <Link to="/platform?tab=payments" className="underline">Platform page, Payments</Link>.
        </p>
      )}

      {s.connected && s.charges_enabled && purpose === 'ordering' && s.fee_percent > 0 && (
        <p className="text-xs text-muted-foreground">
          The platform fee ({s.fee_percent}% of each online order, not of tips) is taken from each payment by Stripe; refunds give it back.
        </p>
      )}

      {s.connected && s.charges_enabled && s.domains?.length > 0 && purpose === 'ordering' && (
        <ul className="text-xs text-muted-foreground space-y-0.5" data-testid="stripe-domains">
          {s.domains.map(d => (
            <li key={d.domain}>
              Apple Pay / Google Pay on <span className="font-mono">{d.domain}</span>: {d.ok ? 'ready' : 'not set up (' + (d.error || 'refused') + ')'}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-destructive" data-testid="stripe-error">{error.message}</p>}

      <div className="flex flex-wrap gap-2">
        {canChange && s.platform_ready && (!s.connected || !s.charges_enabled || !s.details_submitted) && (
          <button type="button" onClick={() => connect.mutate()} disabled={busy} data-testid="stripe-connect"
            className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-40">
            {connect.isPending ? 'Opening Stripe…' : s.connected ? 'Continue on Stripe' : 'Connect Stripe'}
          </button>
        )}
        {s.connected && (
          <button type="button" onClick={() => refresh.mutate()} disabled={busy} data-testid="stripe-refresh"
            className="min-h-[44px] px-3 rounded-md border text-sm inline-flex items-center gap-1.5 touch-manipulation disabled:opacity-40">
            <RefreshCw className={'w-4 h-4' + (refresh.isPending ? ' animate-spin' : '')} /> Check again
          </button>
        )}
        {s.connected && s.charges_enabled && (
          <a href={s.dashboard_url} target="_blank" rel="noreferrer"
            className="min-h-[44px] px-3 rounded-md border text-sm inline-flex items-center gap-1.5 touch-manipulation">
            Stripe dashboard <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {canChange && s.connected && !confirmUnlink && (
          <button type="button" onClick={() => setConfirmUnlink(true)} disabled={busy} data-testid="stripe-unlink"
            className="min-h-[44px] px-3 rounded-md border text-sm text-destructive inline-flex items-center gap-1.5 touch-manipulation">
            <Unlink className="w-4 h-4" /> Unlink
          </button>
        )}
      </div>

      {confirmUnlink && (
        <div className="rounded-md border border-destructive/40 bg-red-50 p-3 space-y-2" data-testid="stripe-unlink-confirm">
          <p className="text-sm">
            Unlink this Stripe account? Card (Stripe) disappears from checkout and Stripe card machines on this account stop working.
            The account itself, and its payments, stay at Stripe.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => unlink.mutate()} disabled={busy} data-testid="stripe-unlink-yes"
              className="min-h-[44px] px-4 rounded-md bg-destructive text-white text-sm font-semibold touch-manipulation">Yes, unlink</button>
            <button type="button" onClick={() => setConfirmUnlink(false)}
              className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Keep it</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ s }) {
  if (s.ready) return <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
  if (s.connected) return <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
  return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/40 shrink-0 mt-0.5" />
}

function headline(s) {
  if (s.ready) return 'Stripe is connected and can take payments'
  if (s.connected && s.charges_enabled) return 'Stripe is connected'
  if (s.connected && s.details_submitted) return 'Stripe is checking your details'
  if (s.connected) return 'Your Stripe sign-up isn\'t finished'
  return 'Stripe isn\'t connected'
}

function explain(s, what) {
  if (s.ready) return 'Payments go straight to your own Stripe account; payouts, disputes and receipts are in your Stripe dashboard.'
  if (s.connected && s.details_submitted) return 'Stripe has your details but can\'t take payments on the account yet. Stripe emails you if it needs anything; check again later.'
  if (s.connected) return 'Finish Stripe\'s sign-up (business details, bank account) to turn on ' + what + '.'
  return 'Connect a Stripe account of your own to take ' + what + '. You set it up on Stripe\'s own page (business details, bank account) and come back here.'
}
