// src/components/ai/AssistantDrawer.jsx
//
// The AI assistant as a panel on the right, opened from the sidebar's
// "Ask AI" button on any page (so staff can keep the timeline in view).
// The open conversation is remembered per browser (maca_ai_conversation).
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, History, Sparkles, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import ChatView from './ChatView'

const KEY = 'maca_ai_conversation'

export function useRememberedConversation() {
  const [id, setId] = useState(() => {
    try { return localStorage.getItem(KEY) || null } catch { return null }
  })
  function set(next) {
    setId(next)
    try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY) } catch {}
  }
  return [id, set]
}

/** Recent conversations, with an inline double-confirm delete. */
export function ConversationList({ activeId, onPick, className }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [confirmId, setConfirmId] = useState(null)
  const { data: list = [] } = useQuery({ queryKey: ['ai-conversations'], queryFn: () => api.get('/ai/conversations') })
  const del = useMutation({
    mutationFn: id => api.delete('/ai/conversations/' + id),
    onSuccess: (_r, id) => {
      setConfirmId(null)
      qc.invalidateQueries({ queryKey: ['ai-conversations'] })
      if (id === activeId) onPick(null)
    },
  })
  if (!list.length) return <p className={cn('text-sm text-muted-foreground p-3', className)}>No conversations yet.</p>
  return (
    <ul className={cn('divide-y', className)}>
      {list.map(c => (
        <li key={c.id} className={cn('flex items-center', c.id === activeId && 'bg-accent')}>
          {confirmId === c.id ? (
            <div className="flex-1 flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">Delete this chat?</span>
              <button type="button" onClick={() => del.mutate(c.id)}
                className="min-h-[40px] px-3 rounded-md bg-destructive text-destructive-foreground text-xs touch-manipulation">Delete</button>
              <button type="button" onClick={() => setConfirmId(null)}
                className="min-h-[40px] px-3 rounded-md border text-xs touch-manipulation">Keep</button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => onPick(c.id)}
                className="flex-1 min-w-0 text-left px-3 py-2 min-h-[48px] touch-manipulation">
                <div className="text-sm truncate">{c.title || 'New chat'}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(c.updated_at), 'd MMM, HH:mm')}</div>
              </button>
              <button type="button" onClick={() => setConfirmId(c.id)}
                className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-destructive touch-manipulation"
                aria-label="Delete chat">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function AssistantDrawer({ open, onClose }) {
  const [conversationId, setConversationId] = useRememberedConversation()
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-background border-l shadow-xl flex flex-col">
        <div className="h-14 shrink-0 flex items-center gap-1 px-2 border-b">
          <Sparkles className="w-4 h-4 text-primary ml-2" />
          <span className="font-semibold text-sm flex-1 ml-1">AI assistant</span>
          <button type="button" onClick={() => setShowHistory(v => !v)}
            className={cn('w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation', showHistory && 'bg-accent')}
            aria-label="Earlier chats" title="Earlier chats">
            <History className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => { setConversationId(null); setShowHistory(false) }}
            className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation"
            aria-label="New chat" title="New chat">
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation"
            aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {showHistory ? (
          <div className="flex-1 overflow-y-auto">
            <ConversationList activeId={conversationId} onPick={id => { setConversationId(id); setShowHistory(false) }} />
          </div>
        ) : (
          <ChatView key={conversationId || 'new'} conversationId={conversationId} onConversationId={setConversationId} className="flex-1" />
        )}
      </aside>
    </>
  )
}
