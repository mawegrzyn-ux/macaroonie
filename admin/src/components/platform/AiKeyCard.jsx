// src/components/platform/AiKeyCard.jsx
//
// Platform page, AI usage tab (migration 149): the Anthropic API key the AI
// chats use. Saving checks the key with Anthropic first; the key is never
// sent back, only where it comes from and its last four characters. A saved
// key wins over ANTHROPIC_API_KEY in the server's .env; removing it goes
// back to that. GET/PUT/DELETE /api/ai/platform/key, POST .../key/test.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, CircleAlert, CircleCheck, KeyRound } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const AI_KEYS = [['ai-platform-key'], ['ai-platform'], ['ai-status'], ['ai-settings']]

export default function AiKeyCard() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: info, isLoading } = useQuery({ queryKey: ['ai-platform-key'], queryFn: () => api.get('/ai/platform/key') })
  const [draft, setDraft]       = useState('')
  const [notice, setNotice]     = useState(null)   // { tone: 'ok' | 'warn' | 'error', text }
  const [confirmRemove, setConfirmRemove] = useState(false)

  const refresh = () => AI_KEYS.forEach(queryKey => qc.invalidateQueries({ queryKey }))

  const save = useMutation({
    mutationFn: () => api.put('/ai/platform/key', { api_key: draft.trim() }),
    onSuccess: res => {
      setDraft('')
      setNotice(res.warning ? { tone: 'warn', text: res.warning } : { tone: 'ok', text: 'Key checked with Anthropic and saved. The chats use it from now on.' })
      refresh()
    },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  const test = useMutation({
    mutationFn: () => api.post('/ai/platform/key/test', {}),
    onSuccess: res => setNotice(
      !res.ok      ? { tone: 'error', text: res.message }
      : res.warning ? { tone: 'warn', text: res.warning }
      : { tone: 'ok', text: 'The key works.' }),
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  const remove = useMutation({
    mutationFn: () => api.delete('/ai/platform/key'),
    onSuccess: res => {
      setConfirmRemove(false)
      setNotice({ tone: res.source === 'env' ? 'ok' : 'warn',
        text: res.source === 'env' ? 'Saved key removed. The chats use the key from the server\'s .env file again.' : 'Saved key removed. There is no key now, so the chats are off.' })
      refresh()
    },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  return (
    <section className="rounded-lg border bg-background overflow-hidden">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <KeyRound className="w-4 h-4" /> Anthropic API key
      </div>
      <div className="p-5 space-y-4">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <KeyStatus info={info} />}

        <form className="space-y-2" autoComplete="off"
          onSubmit={e => { e.preventDefault(); if (draft.trim()) { setNotice(null); save.mutate() } }}>
          <label className="block text-sm font-medium" htmlFor="ai-key-input">
            {info?.source ? 'Replace the key' : 'Add a key'}
          </label>
          <div className="flex flex-wrap gap-2">
            <input id="ai-key-input" type="password" autoComplete="new-password" spellCheck={false}
              value={draft} onChange={e => setDraft(e.target.value)} placeholder="sk-ant-..."
              className="flex-1 min-w-[220px] rounded-md border bg-background px-3 min-h-[48px] text-sm font-mono" />
            <button type="submit" disabled={!draft.trim() || save.isPending}
              className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation">
              {save.isPending ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking</span> : 'Check and save'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Make one in the Anthropic Console under Settings, API keys. We check it with Anthropic before saving,
            and it's never shown again here.
          </p>
        </form>

        {notice && (
          <div className={cn('rounded-md border px-3 py-2 text-sm flex items-start gap-2',
            notice.tone === 'ok'   && 'border-green-300 bg-green-50 text-green-800',
            notice.tone === 'warn' && 'border-amber-300 bg-amber-50 text-amber-800',
            notice.tone === 'error' && 'border-red-300 bg-red-50 text-red-800')}>
            {notice.tone === 'ok' ? <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" /> : <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{notice.text}</span>
          </div>
        )}

        {info?.source && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => { setNotice(null); test.mutate() }} disabled={test.isPending}
              className="min-h-[48px] px-4 rounded-md border text-sm font-medium hover:bg-accent disabled:opacity-40 touch-manipulation">
              {test.isPending ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking</span> : 'Check the key now'}
            </button>
            {info.source === 'platform' && !confirmRemove && (
              <button type="button" onClick={() => setConfirmRemove(true)}
                className="min-h-[48px] px-4 rounded-md border text-sm font-medium text-destructive hover:bg-destructive/10 touch-manipulation">
                Remove saved key
              </button>
            )}
            {info.source === 'platform' && confirmRemove && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5">
                <span className="text-sm text-red-800">
                  {info.env_hint
                    ? 'Remove it? The chats go back to the server\'s .env key.'
                    : 'Remove it? There\'s no key in .env, so the chats will stop.'}
                </span>
                <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
                  className="min-h-[44px] px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation">
                  {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, remove'}
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)}
                  className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function KeyStatus({ info }) {
  if (!info?.source) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
        <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <span>No key, so the AI chats are off. The connectors for AI apps still work.</span>
      </div>
    )
  }
  return (
    <div className="text-sm space-y-1">
      {info.source === 'platform' ? (
        <p>
          <span className="font-medium">Saved here</span>, ending <span className="font-mono">{info.saved.hint}</span>.
          <span className="text-muted-foreground">
            {' '}Saved{info.saved.updated_by ? ' by ' + info.saved.updated_by : ''} on {format(parseISO(info.saved.updated_at), 'd MMM yyyy, HH:mm')}.
          </span>
        </p>
      ) : (
        <p>
          <span className="font-medium">From the server's .env file</span>, ending <span className="font-mono">{info.env_hint}</span>.
          <span className="text-muted-foreground"> Save a key here to change it without touching the server.</span>
        </p>
      )}
      {info.source === 'platform' && info.env_hint && (
        <p className="text-muted-foreground">The server's .env also has a key (ending <span className="font-mono">{info.env_hint}</span>); the one saved here is used.</p>
      )}
      <p className="text-muted-foreground">Chat model: <span className="font-mono">{info.model}</span></p>
    </div>
  )
}
