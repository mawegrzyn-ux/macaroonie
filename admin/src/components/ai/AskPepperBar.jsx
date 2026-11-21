// src/components/ai/AskPepperBar.jsx
//
// Pepper on the phone's home (/mobile): a bar at the bottom with the same
// microphone as Pepper's own box (./mic.jsx: tap to dictate, hold to talk
// and let go to send), a message box and Send. Asking opens the Pepper page
// (/mobile/assistant) with the question, which sends it in the chat that page
// shows (the remembered one, as if typed there), so reading answers aloud and
// a spoken yes for a check work as they do on that page.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, CircleAlert } from 'lucide-react'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { canListen } from '@/lib/speech'
import { useMic, MicButton } from './mic'

export default function AskPepperBar({ to = '/mobile/assistant' }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  function ask(text, voice = false) {
    const message = String(text ?? draft).trim()
    if (!message) return
    navigate(to, { state: { ask: { text: message, voice } } })
  }
  const mic = useMic({
    draft, setDraft,
    onSend: text => ask(text, true),
    onError: setError, onStart: () => setError(null),
  })
  const listenable = canListen()

  return (
    <div className="sticky bottom-0 z-10 border-t bg-background" data-testid="home-pepper-bar">
      {error && (
        <p className="px-3 pt-2 flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{error}</span>
        </p>
      )}
      {mic.state === 'hold' && (
        <p className="px-3 pt-2 text-xs font-medium text-red-700" aria-live="polite">Recording: let go to send.</p>
      )}
      <form className="p-2 flex items-end gap-2" onSubmit={e => { e.preventDefault(); ask() }}>
        {listenable && <MicButton mic={mic} prominent testId="home-pepper-mic" />}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          rows={Math.min(4, Math.max(1, draft.split('\n').length))}
          maxLength={2000}
          aria-label={'Ask ' + ASSISTANT_NAME}
          placeholder={'Ask ' + ASSISTANT_NAME + '...'}
          data-testid="home-pepper-box"
          className="flex-1 min-w-0 resize-none rounded-md border bg-background px-3 py-2.5 text-sm min-h-[48px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="submit" disabled={!draft.trim()} data-testid="home-pepper-send"
          className="w-12 h-12 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 touch-manipulation"
          aria-label={'Ask ' + ASSISTANT_NAME}>
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}
