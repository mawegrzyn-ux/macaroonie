// src/components/platform/StripeKeysCard.jsx
//
// Platform page, Payments tab (migration 215): the platform's Stripe keys,
// which every group's connected Stripe account is used through (online
// ordering's Card (Stripe), Stripe card machines in connect mode). The
// secret key is checked with Stripe before it is saved; no key is ever
// sent back, only where it comes from and its last four characters. Saved
// keys win over STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY /
// STRIPE_CONNECT_WEBHOOK_SECRET in the server's .env.
// GET / PUT /api/platform/stripe.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CircleAlert, CircleCheck, CreditCard } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const FIELDS = [
  ['secret', 'sk_live_… or sk_test_…', 'Developers, API keys, Secret key. Checked with Stripe before it is saved.'],
  ['publishable', 'pk_live_… or pk_test_…', 'Developers, API keys, Publishable key. Must be the same mode (test or live) as the secret key.'],
  ['webhook', 'whsec_…', 'Developers, Webhooks: an endpoint for connected accounts. Its signing secret.'],
]

export default function StripeKeysCard() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: info, isLoading, error } = useQuery({ queryKey: ['platform-stripe'], queryFn: () => api.get('/platform/stripe') })
  const [draft, setDraft] = useState({ secret: '', publishable: '', webhook: '' })
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [notice, setNotice] = useState(null)

  const save = useMutation({
    mutationFn: body => api.put('/platform/stripe', body),
    onSuccess: res => {
      qc.setQueryData(['platform-stripe'], res)
      qc.invalidateQueries({ queryKey: ['stripe-account'] })
      setDraft({ secret: '', publishable: '', webhook: '' })
      setConfirmRemove(null)
      setNotice({ tone: 'ok', text: 'Saved.' })
    },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  const typed = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))

  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="stripe-keys">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <CreditCard className="w-4 h-4" /> Stripe (Connect)
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Groups connect their own Stripe accounts (Ordering setup, Store tech's Card machines) to take card payments online and on
          Stripe card machines. Their money goes to their own account; the platform's online ordering fee is taken as an application fee.
          These are the platform's own keys from your Stripe dashboard, with Connect switched on.
        </p>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {info && (
          <>
            <div className={cn('rounded-md px-3 py-2 text-sm flex items-center gap-2',
              info.ready ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')} data-testid="stripe-keys-state">
              {info.ready ? <CircleCheck className="w-4 h-4" /> : <CircleAlert className="w-4 h-4" />}
              {info.ready
                ? `Ready${info.mode === 'test' ? ' in test mode' : ''}. ${info.connected_groups} group${info.connected_groups === 1 ? '' : 's'} connected.`
                : 'Not ready: a secret key and a publishable key of the same mode are needed.'}
            </div>
            {FIELDS.map(([k, ph, hint]) => {
              const cur = info.keys[k]
              return (
                <div key={k} className="space-y-1">
                  <label className="block text-sm font-medium" htmlFor={'stripe-' + k}>{cur.label}</label>
                  <p className="text-xs text-muted-foreground" data-testid={'stripe-key-' + k}>
                    {cur.source === 'platform' ? `Saved here, ends ${cur.hint}.`
                      : cur.source === 'env' ? `From the server's .env (${cur.env_var}), ends ${cur.hint}.`
                      : 'Not set.'} {hint}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input id={'stripe-' + k} type="password" autoComplete="off" value={draft[k]} placeholder={ph}
                      onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                      className="flex-1 min-w-[220px] border rounded-md px-3 min-h-[44px] bg-background font-mono text-sm" />
                    {cur.source === 'platform' && confirmRemove !== k && (
                      <button type="button" onClick={() => setConfirmRemove(k)}
                        className="min-h-[44px] px-3 rounded-md border text-sm text-destructive touch-manipulation">Remove</button>
                    )}
                    {confirmRemove === k && (
                      <>
                        <button type="button" onClick={() => save.mutate({ [k]: null })} disabled={save.isPending}
                          className="min-h-[44px] px-3 rounded-md bg-destructive text-white text-sm touch-manipulation">Yes, remove</button>
                        <button type="button" onClick={() => setConfirmRemove(null)}
                          className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation">Keep</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-muted-foreground">
              Webhook endpoint for connected accounts: <span className="font-mono break-all" data-testid="stripe-webhook-url">{info.webhook_url}</span>, events
              payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, account.updated and
              account.application.deauthorized.
            </p>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => save.mutate(typed)} disabled={!Object.keys(typed).length || save.isPending}
                data-testid="stripe-keys-save"
                className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-40">
                {save.isPending ? 'Checking…' : 'Save'}
              </button>
              {notice && <span className={cn('text-sm', notice.tone === 'error' ? 'text-destructive' : 'text-emerald-700')} data-testid="stripe-keys-notice">{notice.text}</span>}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
