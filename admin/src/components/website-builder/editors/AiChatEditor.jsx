// Editor for the AI chat block (migration 148): the booking chat on the
// website. See api/src/views/site/blocks/ai_chat.eta. Whether the chat
// answers at all is the tenant's "Chat on your website" switch on the AI
// assistant page, not a block setting.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

export function useAiSettings() {
  const api = useApi()
  return useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get('/ai/settings'), staleTime: 30_000, retry: false })
}

export function AiChatEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: ai } = useAiSettings()
  const mode = data.mode === 'launcher' ? 'launcher' : 'inline'
  const off = ai && (!ai.settings?.guest_chat_enabled || !ai.chat_configured)
  return (
    <div className="space-y-3">
      {off && (
        <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1.5">
          {ai.chat_configured
            ? 'The website chat is switched off, so this block is hidden on the site. '
            : 'The AI chat isn\'t set up on the server yet, so this block is hidden on the site. '}
          {ai.chat_configured && <Link to="/ai" className="underline">Switch it on</Link>}
        </p>
      )}
      <FormRow label="Shown as">
        <div className="grid grid-cols-2 gap-1.5">
          {[['inline', 'In the page'], ['launcher', 'Chat button']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => set('mode')(k)}
              className={'text-sm border rounded-md px-2 py-2 min-h-[44px] touch-manipulation ' + (mode === k ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {mode === 'launcher' ? 'A round button in the corner of the screen opens the chat. Use one per page.' : 'The chat sits in the page where you put the block.'}
        </p>
      </FormRow>
      <FormRow label="Heading">
        <input value={data.heading ?? ''} onChange={e => set('heading')(e.target.value)} placeholder="Chat with us" className={input} />
      </FormRow>
      <FormRow label="Intro">
        <textarea rows={2} value={data.intro ?? ''} onChange={e => set('intro')(e.target.value)} className={input} />
      </FormRow>
      {mode === 'launcher' && (
        <FormRow label="Button text">
          <input value={data.button_text || ''} onChange={e => set('button_text')(e.target.value)} placeholder="Chat with us" className={input} />
        </FormRow>
      )}
      <FormRow label="Colour">
        <ThemeColourPicker value={data.accent || 'primary'} onChange={set('accent')} allowNone={false} />
      </FormRow>
    </div>
  )
}
