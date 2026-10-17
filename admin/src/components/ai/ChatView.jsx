// src/components/ai/ChatView.jsx
//
// Pepper, the staff AI assistant chat (migration 148), shared by the
// assistant drawer (AssistantDrawer.jsx, opened from the sidebar's Ask
// Pepper), the Pepper page (/ai) and the phone app (/mobile/assistant).
// Talks to /api/ai:
// POST /chat runs a turn, streamed (api.stream): the reply's text shows as it
// is written, with a line for what Pepper is doing and each step and card as
// it happens; the `done` event then brings the whole conversation as display
// items, which replace the live ones. If the connection drops, the chat
// reloads the conversation and keeps asking while it is still `running`.
// A proposed change comes back as an `action` card, and nothing
// changes until the person presses its Confirm button
// (POST /actions/:id/confirm). Outcome notes for the model are not shown:
// the card itself shows the result. Photos, screenshots, PDFs and text files
// can go with a message (attach button, camera on touch devices, paste, or
// drop onto the chat): see ./attachments.jsx. Links Pepper gives to pages of
// the app ([Rota](/rota), from its open_page tool) open in the app; other
// links show as plain text.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Loader2, Check, X, Sparkles, Search, CircleAlert, Paperclip, Camera, Upload } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAttachments, PendingFiles, MessageFiles, ACCEPT } from './attachments'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

const SUGGESTIONS = [
  'What is booked for tonight?',
  'Who is working today?',
  'Which H&S checks are still to do today?',
  'How did yesterday\'s cash up balance?',
  'Mark the Pad Thai sold out for today',
  'Which dishes are free from peanuts?',
]

// The parents key ChatView by conversation id, so a new chat's view is
// replaced when the chat gets its id: a notice or error from that first turn
// is handed to the new view here.
const carried = new Map()

export function useAiStatus() {
  const api = useApi()
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status'), staleTime: 60_000 })
}

export default function ChatView({ conversationId, onConversationId, className }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [draft, setDraft]     = useState('')
  const [pending, setPending] = useState(null)   // { text, files } being sent, shown at once
  const [live, setLive]       = useState([])     // the turn as it streams in
  const [activity, setActivity] = useState('')   // what Pepper is doing right now
  const [notice, setNotice]   = useState(() => carried.get(conversationId ?? null)?.notice ?? null)   // the turn stopped early or was refused
  const [error, setError]     = useState(() => carried.get(conversationId ?? null)?.error ?? null)
  const [dragging, setDragging] = useState(false)
  const listRef   = useRef(null)
  const stick     = useRef(true)    // keep the list scrolled to the end
  const started   = useRef(null)    // the conversation the streaming turn is in
  const sending   = useRef(false)
  const fileInput = useRef(null)
  const camInput  = useRef(null)
  const dragDepth = useRef(0)
  const att = useAttachments()

  const { data: conv, isLoading } = useQuery({
    queryKey: ['ai-conversation', conversationId],
    queryFn:  () => api.get('/ai/conversations/' + conversationId),
    enabled:  !!conversationId,
    // A turn still running (another tab, or a stream that dropped): look
    // again until it's done.
    refetchInterval: q => (q.state.data?.running && !sending.current ? 3000 : false),
  })
  const items = conversationId ? (conv?.items ?? []) : []
  const running = !!conv?.running

  useEffect(() => { carried.delete(conversationId ?? null) }, [conversationId])

  // A null conversation_id: a new chat's only message was refused and taken
  // back out, so there is no chat to show.
  function apply(res) {
    if (res.conversation_id) {
      qc.setQueryData(['ai-conversation', res.conversation_id], old => ({
        ...(old || {}), id: res.conversation_id, title: res.title ?? old?.title, closed: res.closed ?? old?.closed,
        running: false, items: res.items,
      }))
    }
    if ((res.conversation_id ?? null) !== (conversationId ?? null)) onConversationId?.(res.conversation_id ?? null)
    qc.invalidateQueries({ queryKey: ['ai-conversations'] })
    qc.invalidateQueries({ queryKey: ['ai-status'] })
  }

  function onEvent(ev) {
    if (ev.type === 'start') { started.current = ev.conversation_id; return }
    if (ev.type === 'activity') { setActivity(ev.text); return }
    setLive(list => {
      if (ev.type === 'text') {
        const i = list.findIndex(x => x.key === ev.key)
        if (i < 0) return [...list, { type: 'assistant', key: ev.key, text: ev.delta }]
        const next = list.slice()
        next[i] = { ...next[i], text: next[i].text + ev.delta }
        return next
      }
      if (ev.type === 'discard') return list.filter(x => !x.key?.startsWith(ev.key))
      if (ev.type === 'step') return [...list, { type: 'step', text: ev.text }]
      if (ev.type === 'card') return [...list, ev.card]
      return list
    })
    if (ev.type === 'step' || ev.type === 'card') setActivity('')
  }

  function endTurn() {
    sending.current = false
    setPending(null)
    setLive([])
    setActivity('')
  }

  const send = useMutation({
    mutationFn: ({ message, files }) => api.stream('/ai/chat', {
      conversation_id: conversationId || undefined, message, attachments: files.map(f => f.id),
    }, onEvent),
    onMutate:   ({ message, files }) => {
      sending.current = true
      started.current = null
      stick.current = true
      setPending({ text: message, files }); setError(null); setNotice(null)
    },
    onSuccess:  (res, { files }) => {
      endTurn()
      att.discard(files)
      setNotice(res.notice || null)
      if (res.notice && res.conversation_id && res.conversation_id !== conversationId) carried.set(res.conversation_id, { notice: res.notice })
      apply(res)
    },
    onError:    (err, { message, files }) => {
      endTurn()
      // Once the turn had started, the message is in the chat (unless
      // Claude couldn't take it and it was withdrawn).
      const inChat = !!started.current && !err.body?.withdrawn
      const shown = err.lost
        ? 'The connection dropped. ' + ASSISTANT_NAME + ' may still be working on it: the chat will update when it\'s done.'
        : (err.message || 'Something went wrong')
      setError(shown)
      if (inChat) {
        att.discard(files)
        if (started.current !== conversationId) {
          carried.set(started.current, { error: shown })
          onConversationId?.(started.current)
        }
        qc.invalidateQueries({ queryKey: ['ai-conversation', started.current] })
        qc.invalidateQueries({ queryKey: ['ai-conversations'] })
        return
      }
      setDraft(d => d || message)
      // A refused message leaves its files unsent, so they go back on the
      // message box; after a server error they may be in the chat already.
      if (err.status && err.status < 500) att.restore(files)
      else att.discard(files)
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
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items.length, pending, send.isPending, live, activity, notice])

  function onScroll(e) {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function submit(text) {
    const message = (text ?? draft).trim()
    if ((!message && !att.ready.length) || send.isPending || running || att.uploading) return
    const files = att.take().filter(f => f.status === 'ready')
    setDraft('')
    send.mutate({ message, files })
  }

  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files')
  const dropProps = {
    onDragEnter: e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) },
    onDragOver:  e => { if (hasFiles(e)) e.preventDefault() },
    onDragLeave: e => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) },
    onDrop:      e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); att.add(e.dataTransfer.files) },
  }

  // A screenshot pasted into the message box is attached; pasted text is
  // left to the box as normal.
  function onPaste(e) {
    const pasted = Array.from(e.clipboardData?.files || [])
    if (!pasted.length) return
    e.preventDefault()
    att.add(pasted)
  }

  const canSend = (!!draft.trim() || att.ready.length > 0) && !send.isPending && !running && !att.uploading

  const shown = items.filter(i => i.type !== 'note')
  const empty = !shown.length && !pending
  const working = send.isPending || running
  // A guest's details were erased from this chat (customer anonymise): it
  // can be read, not continued.
  const closed = !!conv?.closed

  return (
    <div className={cn('relative flex flex-col min-h-0 h-full', className)} {...dropProps}>
      {dragging && (
        <div className="absolute inset-2 z-20 rounded-lg border-2 border-dashed border-primary bg-background/90 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-8 h-8 text-primary" />
          <p className="font-medium text-sm">Drop to attach</p>
          <p className="text-xs text-muted-foreground">Photos, screenshots, PDFs, text or CSV files</p>
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
        {conversationId && isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        )}
        {empty && !isLoading && (
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 mx-auto text-primary mb-2" />
            <p className="font-medium">Ask {ASSISTANT_NAME}</p>
            <p className="text-sm text-muted-foreground mb-4">Bookings, customers, the rota and staff, cash up and wages, online orders, sold out and the till, H&S checks, menus, purchasing and the website. Attach a photo, screenshot, PDF or CSV to work from. You confirm every change.</p>
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
        {shown.map((item, i) => <ChatItem key={item.id || i} item={item} decide={decide} busy={working} />)}
        {pending && <UserBubble text={pending.text} files={pending.files} local />}
        {live.map((item, i) => <ChatItem key={item.key || item.id || 'l' + i} item={item} decide={decide} busy />)}
        {working && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" />
            {send.isPending ? (activity || 'Working on it...') : 'Still working on the last message...'}
          </div>
        )}
        {notice && !working && (
          <p className="text-sm text-muted-foreground italic">{notice}</p>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
      </div>

      {closed ? (
        <div className="border-t bg-background p-3 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[200px] text-sm text-muted-foreground">
            A guest&apos;s details were erased from this chat, so it can&apos;t carry on.
          </p>
          <button type="button" onClick={() => onConversationId?.(null)}
            className="min-h-[48px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
            Start a new chat
          </button>
        </div>
      ) : (
        <div className="border-t bg-background">
          <PendingFiles files={att.files} onRemove={att.remove} />
          {att.notice && <p className="px-3 pt-1 text-xs text-amber-700">{att.notice}</p>}
          <form
            className="p-2 sm:p-3 flex items-end gap-1.5 sm:gap-2"
            onSubmit={e => { e.preventDefault(); submit() }}
          >
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={e => { att.add(e.target.files); e.target.value = '' }} />
            <input ref={camInput} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { att.add(e.target.files); e.target.value = '' }} />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={working}
              className="w-12 h-12 shrink-0 rounded-md border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 touch-manipulation"
              aria-label="Attach a photo, screenshot or file" title="Attach a photo, screenshot or file">
              <Paperclip className="w-4 h-4" />
            </button>
            {IS_TOUCH && (
              <button type="button" onClick={() => camInput.current?.click()} disabled={working}
                className="w-12 h-12 shrink-0 rounded-md border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 touch-manipulation"
                aria-label="Take a photo">
                <Camera className="w-4 h-4" />
              </button>
            )}
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onPaste={onPaste}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              rows={Math.min(5, Math.max(1, draft.split('\n').length))}
              maxLength={2000}
              placeholder={att.files.length ? 'Add a message...' : 'Ask ' + ASSISTANT_NAME + '...'}
              className="flex-1 min-w-0 resize-none rounded-md border bg-background px-3 py-2.5 text-sm min-h-[48px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="submit" disabled={!canSend}
              className="w-12 h-12 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 touch-manipulation"
              aria-label="Send">
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function ChatItem({ item, decide, busy = false }) {
  if (item.type === 'user') return <UserBubble text={item.text} files={item.attachments} />
  if (item.type === 'assistant') {
    if (!item.text.trim()) return null
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
  if (item.type === 'action') return <ActionCard card={item} decide={decide} busy={busy} />
  return null
}

function UserBubble({ text, files, local = false }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">
        <MessageFiles files={files} local={local} />
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

// While a turn is still running (`turnBusy`) its cards can't be answered
// yet: the server would say the chat is busy.
function ActionCard({ card, decide, busy: turnBusy = false }) {
  const busy = turnBusy || (decide.isPending && decide.variables?.id === card.id)
  const open = card.status === 'pending'
  return (
    <div className={cn('rounded-lg border bg-background overflow-hidden', open && 'ring-2 ring-primary/40')}>
      <div className="section-head px-3 py-2 text-sm font-semibold">{card.title}</div>
      <div className="px-3 py-2 text-sm space-y-0.5">
        {(card.lines || []).map((l, i) => <div key={i} className={i === 0 ? 'font-medium' : ''}>{l}</div>)}
      </div>
      {card.warnings?.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
          <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{card.warningTitle || 'Check before confirming'}</div>
            {card.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}
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

/** Paragraphs, "- " / "1. " lists, **bold** and [links](/page); everything
 *  else plain text. Only links to a page of the app (a path starting with
 *  one /) are clickable: Pepper's open_page links. */
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

const LINK_RE = /(\[[^\]\n]{1,120}\]\([^)\s]{1,300}\))/g

function Inline({ text }) {
  return String(text).split(LINK_RE).flatMap((chunk, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(chunk)
    if (link) {
      const [, label, href] = link
      return /^\/(?!\/)/.test(href)
        ? [<Link key={'l' + i} to={href} className="text-primary underline underline-offset-2 font-medium">{label}</Link>]
        : [<span key={'l' + i}>{label} ({href})</span>]
    }
    return chunk.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith('**') && p.endsWith('**') && p.length > 4
      ? <strong key={i + '-' + j}>{p.slice(2, -2)}</strong>
      : <span key={i + '-' + j}>{p}</span>)
  })
}
