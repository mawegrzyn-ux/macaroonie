// src/components/platform/WalletCard.jsx
//
// Platform page, Loyalty wallets tab (migration 211): Macaroonie's Apple
// Pass Type ID and Google Wallet issuer, which every tenant's loyalty cards
// use unless the tenant adds its own (Loyalty > Wallet). Saving checks the
// certificate / key / service account; nothing secret is sent back.
// GET/PUT/DELETE /api/loyalty/platform/wallet/:kind.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, Wallet } from 'lucide-react'
import { useApi } from '@/lib/api'
import { AppleWalletForm, GoogleWalletForm } from '@/components/loyalty/WalletForms'

const KINDS = [
  { key: 'apple', label: 'Apple Wallet', Form: AppleWalletForm },
  { key: 'google', label: 'Google Wallet', Form: GoogleWalletForm },
]

export default function WalletCard() {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['loyalty-platform-wallet'], queryFn: () => api.get('/loyalty/platform/wallet') })
  return (
    <section className="rounded-lg border bg-background overflow-hidden">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <Wallet className="w-4 h-4" /> Loyalty cards in Apple and Google Wallet
      </div>
      <div className="p-5 space-y-6">
        <p className="text-sm text-muted-foreground">
          Every restaurant group's loyalty cards are signed with these accounts and shown in the group's own colours and name.
          A group can add its own account in Loyalty, Wallet; theirs is then used instead.
        </p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {data && KINDS.map(k => (
          <WalletKind key={k.key} kind={k} status={data[k.key]} api={api}
            onChanged={() => { qc.invalidateQueries({ queryKey: ['loyalty-platform-wallet'] }); qc.invalidateQueries({ queryKey: ['loyalty'] }) }} />
        ))}
      </div>
    </section>
  )
}

function WalletKind({ kind, status, api, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const save = useMutation({
    mutationFn: body => api.put('/loyalty/platform/wallet/' + kind.key, body),
    onSuccess: () => { setEditing(false); setError(null); onChanged() },
    onError: e => setError(e.message),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/loyalty/platform/wallet/' + kind.key),
    onSuccess: () => { setConfirmRemove(false); onChanged() },
    onError: e => setError(e.message),
  })
  const { Form } = kind
  return (
    <div className="space-y-3" data-testid={'platform-wallet-' + kind.key}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex-1 min-w-0">{kind.label}</h3>
        {status?.set
          ? <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800">Set up</span>
          : <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Not set up</span>}
      </div>
      {status?.set && (
        <p className="text-sm">
          <span className="font-mono">{status.hint}</span>
          {status.valid_to && <span className="text-muted-foreground"> · certificate runs until {format(parseISO(status.valid_to), 'd MMM yyyy')}</span>}
          {status.updated_at && <span className="text-muted-foreground"> · saved {format(parseISO(status.updated_at), 'd MMM yyyy')}</span>}
        </p>
      )}
      {editing ? (
        <div className="rounded-lg border p-3 space-y-2">
          <Form onSave={body => { setError(null); save.mutate(body) }} saving={save.isPending} error={error} testPrefix={'platform-wallet-' + kind.key} />
          <button type="button" onClick={() => { setEditing(false); setError(null) }}
            className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} data-testid={'platform-wallet-' + kind.key + '-edit'}
            className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">{status?.set ? 'Replace' : 'Add the account'}</button>
          {status?.set && (confirmRemove ? (
            <>
              <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
                className="min-h-[44px] px-4 rounded-md bg-destructive text-destructive-foreground text-sm touch-manipulation">Yes, remove it</button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Keep it</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)}
              className="min-h-[44px] px-4 rounded-md border text-sm text-destructive touch-manipulation">Remove</button>
          ))}
          {error && !editing && <p className="w-full text-xs text-red-700">{error}</p>}
        </div>
      )}
      {confirmRemove && <p className="text-xs text-amber-800">Groups without their own account lose the wallet buttons until a new account is added.</p>}
    </div>
  )
}
