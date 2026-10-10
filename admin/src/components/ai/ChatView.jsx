// src/components/ai/ChatView.jsx
//
// The staff AI assistant chat (migration 148), shared by the assistant
// drawer (AssistantDrawer.jsx, opened from the sidebar), the AI assistant
// page (/ai) and the phone app (/mobile/assistant). Talks to /api/ai:
// POST /chat runs a turn and returns the whole conversation as display
// items; a proposed change comes back as an `action` card, and nothing
// changes until the person presses its Confirm button
// (POST /actions/:id/confirm). Outcome notes for the model are not shown:
// the card itself shows the result.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Loader2, Check, X, Sparkles, Search, CircleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  'What is booked for tonight?',
  'Is there a table for 4 on Friday at 7pm?',
  'Find the booking for Smith',
  'Book a table for 2 tomorrow at 1pm',
]

export function useAiStatus() {
  const api = useApi()
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status'), staleTime: 60_000 })
}

export default function ChatView({ conversationId, onConversationId, className }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [draft, setDraft]     = useState('')
  const [pending, setPending] = useState(null)   // the message being sent, shown at once
  const [error, setError]     = useState(null)
  const listRef = useRef(null)

  const { data: conv, isLoading } = useQuery({
    queryKey: ['ai-conversation', conversationId],
    queryFn:  () => api.get('/ai/conversations/' + conversationId),
    enabled:  !!conversationId,
  })
  const items = conversationId ? (conv?.items ?? []) : []

  function apply(res) {
    qc.setQueryData(['ai-conversation', res.conversation_id], old => ({ ...(old || {}), id: res.conversation_id, title: res.title ?? old?.title, items: res.items }))
    if (res.conversation_id !== conversationId) onConversationId?.(res.conversation_id)
    qc.invalidateQueries({ queryKey: ['ai-conversations'] })
    qc.invalidateQueries({ queryKey: ['ai-status'] })
  }

  const send = useMutation({
    mutationFn: message => api.post('/ai/chat', { conversation_id: conversationId || undefined, message }),
    onMutate:   message => { setPending(message); setError(null) },
    onSuccess:  res => { setPending(null); apply(res) },
    onError:    (err, message) => {
      setPending(null)
      setError(err.message || 'Something went wrong')
      setDraft(d => d || message)
      if (conversationId) qc.invalidateQueries({ queryKey: ['ai-conversation', conversationId] })
    },
  })

  const decide = useMutation({
    mutationFn: ({ id, how }) => api.post(`/ai/actions/${id}/${how}`, {}),
    onSuccess:  res => { setError(null); apply(res) },
    onError:    err => {
      setError(err.message || 'Something went wrong')
      if (conversationId) qc.invalidateQueries({ queryKey: ['ai-conversation', conversationId] })
    },
  })

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, pending, send.isPending])

  function submit(text) {
    const message = (text ?? draft).trim()
    if (!message || send.isPending) return
    setDraft('')
    send.mutate(message)
  }

  const shown = items.filter(i => i.type !== 'note')
  const empty = !shown.length && !pending

  return (
    <div className={cn('flex flex-col min-h-0 h-full', className)}>
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
        {conversationId && isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        )}
        {empty && !isLoading && (
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 mx-auto text-primary mb-2" />
            <p className="font-medium">Ask about bookings</p>
            <p className="text-sm text-muted-foreground mb-4">Look bookings up, check tables, book, move or cancel. You confirm every change.</p>
            <div className="flex flex-col gap-2 max-w-sm mx-auto">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => submit(s)}
                  className="text-sm text-left px-3 min-h-[44px] rounded-md border hover:bg-accent touch-manipulation">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {shown.map((item, i) => <ChatItem key={item.id || i} item={item} decide={decide} />)}
        {pending && <UserBubble text={pending} />}
        {send.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Working on it...
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
      </div>

      <form
        className="border-t p-2 sm:p-3 flex items-end gap-2 bg-background"
        onSubmit={e => { e.preventDefault(); submit() }}
      >
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          rows={Math.min(5, Math.max(1, draft.split('\n').length))}
          maxLength={2000}
          placeholder="Ask about bookings..."
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2.5 text-sm min-h-[48px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="submit" disabled={!draft.trim() || send.isPending}
          className="w-12 h-12 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 touch-manipulation"
          aria-label="Send">
          {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  )
}

function ChatItem({ item, decide }) {
  if (item.type === 'user') return <UserBubble text={item.text} />
  if (item.type === 'assistant') {
    return (
      <div className="max-w-[92%] text-sm leading-relaxed">
        <RichText text={item.text} />
      </div>
    )
  }
  if (item.type === 'step') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="w-3 h-3" /> {item.text}
      </div>
    )
  }
  if (item.type === 'action') return <ActionCard card={item} decide={decide} />
  return null
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  )
}

const STATUS_TEXT = {
  done:      'Done',
  cancelled: 'Cancelled, nothing changed',
  expired:   'Expired, nothing changed',
  failed:    'Didn\'t go through',
}

function ActionCard({ card, decide }) {
  const busy = decide.isPending && decide.variables?.id === card.id
  const open = card.status === 'pending'
  return (
    <div className={cn('rounded-lg border bg-background overflow-hidden', open && 'ring-2 ring-primary/40')}>
      <div className="section-head px-3 py-2 text-sm font-semibold">{card.title}</div>
      <div className="px-3 py-2 text-sm space-y-0.5">
        {(card.lines || []).map((l, i) => <div key={i} className={i === 0 ? 'font-medium' : ''}>{l}</div>)}
      </div>
      {open ? (
        <div className="flex gap-2 px-3 pb-3">
          <button type="button" disabled={busy}
            onClick={() => decide.mutate({ id: card.id, how: 'confirm' })}
            className={cn('flex-1 min-h-[48px] rounded-md font-medium text-sm flex items-center justify-center gap-2 touch-manipulation disabled:opacity-50',
              card.destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}>
            {busy && decide.variables?.how === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {card.confirmLabel || 'Confirm'}
          </button>
          <button type="button" disabled={busy}
            onClick={() => decide.mutate({ id: card.id, how: 'cancel' })}
            className="min-h-[48px] px-4 rounded-md border text-sm flex items-center gap-2 touch-manipulation disabled:opacity-50">
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      ) : (
        <div className={cn('px-3 py-2 text-sm border-t',
          card.status === 'done' ? 'text-emerald-700 bg-emerald-50' : card.status === 'failed' ? 'text-destructive bg-destructive/10' : 'text-muted-foreground bg-muted/40')}>
          <span className="font-medium">{STATUS_TEXT[card.status] || card.status}</span>
          {card.result && <span>: {card.result}</span>}
          {card.error && <span>: {card.error}</span>}
        </div>
      )}
    </div>
  )
}

/** Paragraphs, "- " / "1. " lists and **bold**; everything else plain text. */
export function RichText({ text }) {
  const blocks = String(text || '').split(/\n{2,}/)
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every(l => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0])
          const List = ordered ? 'ol' : 'ul'
          return (
            <List key={i} className={cn('pl-5 space-y-0.5', ordered ? 'list-decimal' : 'list-disc')}>
              {lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*([-*]|\d+\.)\s+/, '')} /></li>)}
            </List>
          )
        }
        return <p key={i} className="whitespace-pre-wrap break-words"><Inline text={b} /></p>
      })}
    </div>
  )
}

function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => p.startsWith('**') && p.endsWith('**') && p.length > 4
    ? <strong key={i}>{p.slice(2, -2)}</strong>
    : <span key={i}>{p}</span>)
}
