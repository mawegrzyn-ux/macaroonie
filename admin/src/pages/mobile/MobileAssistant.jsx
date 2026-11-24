// src/pages/mobile/MobileAssistant.jsx
//
// The staff AI assistant on a phone (/mobile/assistant): the same ChatView
// as the admin's Ask AI drawer and the AI assistant page, full screen, with
// earlier chats behind a button. Shares the remembered conversation
// (maca_ai_conversation) with the drawer. A question asked on the phone's
// home (AskPepperBar) arrives in the address's state and is sent in this
// chat once.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, History, Sparkles } from 'lucide-react'
import ChatView, { useAiStatus } from '@/components/ai/ChatView'
import { opsLink } from '@/mobile/today'
import { ConversationList, useRememberedConversation } from '@/components/ai/AssistantDrawer'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME } from '@shared/assistant.js'

export default function MobileAssistant() {
  const { data: status } = useAiStatus()
  const [conversationId, setConversationId] = useRememberedConversation()
  const [showList, setShowList] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(() => location.state?.ask || null)
  // Taken off the address at once, so Back or a reload doesn't send it again.
  useEffect(() => {
    if (location.state?.ask) navigate(location.pathname, { replace: true, state: null })
    // A capture opened from For review (migration 281) starts a new chat.
    if (location.state?.ask?.fresh) setConversationId(null)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const askHere = ask?.fresh && conversationId ? null : ask

  if (status && !status.can_chat) {
    return (
      <div className="p-6 text-center space-y-2">
        <Sparkles className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="font-medium">{ASSISTANT_NAME} isn't available</p>
        <p className="text-sm text-muted-foreground">
          {!status.configured ? 'The AI chat isn\'t set up on this server yet.'
            : !status.enabled ? 'An owner has switched the staff assistant off.'
            : 'You don\'t have access to ' + ASSISTANT_NAME + '. Ask an owner.'}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-2 px-2 py-1 border-b shrink-0">
        <button type="button" onClick={() => setShowList(v => !v)}
          className={cn('min-h-[44px] px-3 rounded-md flex items-center gap-2 text-sm touch-manipulation', showList && 'bg-accent')}>
          <History className="w-4 h-4" /> Earlier chats
        </button>
        <button type="button" onClick={() => { setConversationId(null); setShowList(false) }}
          className="min-h-[44px] px-3 rounded-md flex items-center gap-2 text-sm touch-manipulation ml-auto">
          <Plus className="w-4 h-4" /> New chat
        </button>
      </div>
      {showList ? (
        <div className="flex-1 overflow-y-auto">
          <ConversationList activeId={conversationId} onPick={id => { setConversationId(id); setShowList(false) }} />
        </div>
      ) : (
        <ChatView key={conversationId || 'new'} conversationId={conversationId} onConversationId={setConversationId} className="flex-1" linkFor={opsLink} talkMode
          ask={askHere} onAsked={() => setAsk(null)} />
      )}
    </div>
  )
}
