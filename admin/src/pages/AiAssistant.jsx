// src/pages/AiAssistant.jsx
//
// AI assistant (/ai, module ai_assistant, migration 148). Tabs:
//   Chat      the staff assistant, with earlier chats (ChatView)
//   Connect   MCP addresses for AI apps, and the person's access tokens
//   Settings  which AI features are on, and this month's usage (manage)
//   Activity  every booking change made through AI (manage)
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Sparkles, Plus, Copy, Check, Loader2, KeyRound, Trash2, CircleAlert, History,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import ChatView, { useAiStatus } from '@/components/ai/ChatView'
import { ConversationList, useRememberedConversation } from '@/components/ai/AssistantDrawer'

export default function AiAssistant() {
  const api = useApi()
  const [tab, setTab] = useState('chat')
  const { data: status } = useAiStatus()
  const { data: info } = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get('/ai/settings') })
  const canManage = !!info?.can_manage
  const tabs = [
    ['chat', 'Chat'],
    ['connect', 'Connect'],
    ...(canManage ? [['settings', 'Settings'], ['activity', 'Activity']] : []),
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b shrink-0 bg-background max-lg:notouch:pl-14">
        <div className="min-w-0">
          <h1 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI assistant</h1>
          <p className="text-xs text-muted-foreground truncate">Bookings and H&amp;S by chat, here and in AI apps</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn('px-3 py-1.5 text-sm font-medium rounded touch-manipulation min-h-[40px] whitespace-nowrap',
                tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat' && <ChatTab status={status} />}
      {tab !== 'chat' && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
            {tab === 'connect'  && <ConnectTab info={info} />}
            {tab === 'settings' && canManage && <SettingsTab info={info} />}
            {tab === 'activity' && canManage && <ActivityTab />}
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ title, children, className }) {
  return (
    <section className={cn('rounded-lg border bg-background overflow-hidden', className)}>
      <div className="px-4 py-3 section-head font-semibold text-sm">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  )
}

// ── Chat ────────────────────────────────────────────────

function ChatTab({ status }) {
  const [conversationId, setConversationId] = useRememberedConversation()
  const [showList, setShowList] = useState(false)

  if (status && !status.can_chat) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto rounded-lg border bg-background p-6 text-center space-y-2">
          <Sparkles className="w-8 h-8 mx-auto text-muted-foreground" />
          <p className="font-medium">The assistant isn't available</p>
          <p className="text-sm text-muted-foreground">
            {!status.configured
              ? 'The AI chat isn\'t set up on this server yet.'
              : !status.enabled
                ? 'An owner has switched the staff assistant off in Settings.'
                : 'You don\'t have access to the AI assistant. Ask an owner.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className={cn('w-72 shrink-0 border-r bg-background flex-col', showList ? 'flex' : 'hidden md:flex')}>
        <div className="p-2 border-b">
          <button type="button" onClick={() => { setConversationId(null); setShowList(false) }}
            className="w-full min-h-[44px] rounded-md border flex items-center justify-center gap-2 text-sm font-medium hover:bg-accent touch-manipulation">
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList activeId={conversationId} onPick={id => { setConversationId(id); setShowList(false) }} />
        </div>
      </div>
      <div className={cn('flex-1 min-w-0 flex-col bg-background', showList ? 'hidden md:flex' : 'flex')}>
        <div className="md:hidden flex items-center gap-2 px-2 py-1 border-b">
          <button type="button" onClick={() => setShowList(true)}
            className="min-h-[44px] px-3 rounded-md flex items-center gap-2 text-sm hover:bg-accent touch-manipulation">
            <History className="w-4 h-4" /> Earlier chats
          </button>
          <button type="button" onClick={() => setConversationId(null)}
            className="min-h-[44px] px-3 rounded-md flex items-center gap-2 text-sm hover:bg-accent touch-manipulation ml-auto">
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
        <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto flex flex-col">
          <ChatView key={conversationId || 'new'} conversationId={conversationId} onConversationId={setConversationId} className="flex-1" />
        </div>
      </div>
    </div>
  )
}

// ── Connect ─────────────────────────────────────────────

function CopyField({ value, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      {label && <div className="text-xs text-muted-foreground mb-1">{label}</div>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 rounded-md border bg-muted/40 px-3 py-2.5 text-xs sm:text-sm break-all">{value}</code>
        <button type="button"
          onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
          className="w-12 shrink-0 rounded-md border flex items-center justify-center hover:bg-accent touch-manipulation"
          aria-label="Copy">
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

function ConnectTab({ info }) {
  if (!info) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
  return (
    <>
      <Card title="Your own AI app">
        <p className="text-sm text-muted-foreground">
          Connect the AI app you already use (Claude, Cursor and other apps that take an MCP server) to this restaurant
          group's bookings, checklists and food safety logs. It can do what this assistant does, with your own permissions.
        </p>
        <CopyField label="MCP server address" value={info.staff_mcp_url} />
        <ol className="list-decimal pl-5 text-sm space-y-1">
          <li>Make an access token below. Copy it: it is shown once.</li>
          <li>In your AI app, add a custom MCP connector with the address above, and send the token as a header:
            <code className="text-xs bg-muted/60 rounded px-1 ml-1">Authorization: Bearer mcp_...</code></li>
          <li>Ask it about bookings, checklists or H&S checks. Changes are made as you, and listed in Activity.</li>
        </ol>
        {!info.settings.staff_enabled && (
          <p className="text-sm text-amber-700 flex items-center gap-2"><CircleAlert className="w-4 h-4" /> The staff assistant is switched off, so this connector is off too.</p>
        )}
      </Card>
      <TokensCard />
      <Card title="Guests' AI apps">
        <p className="text-sm text-muted-foreground">
          Guests can book, change and cancel tables at your restaurants from their own AI app through Macaroonie's public
          connector. Changing or cancelling needs a code we email to the guest.
          {info.settings.guest_mcp_enabled ? ' This is on for your restaurants.' : ' This is off for your restaurants.'}
        </p>
        <CopyField label="Public booking connector" value={info.guest_mcp_url} />
      </Card>
    </>
  )
}

function TokensCard() {
  const api = useApi()
  const qc  = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const { data: tokens = [] } = useQuery({ queryKey: ['ai-tokens'], queryFn: () => api.get('/ai/tokens') })
  const create = useMutation({
    mutationFn: () => api.post('/ai/tokens', { name: name.trim() }),
    onSuccess: row => { setCreated(row); setName(''); qc.invalidateQueries({ queryKey: ['ai-tokens'] }) },
  })
  const revoke = useMutation({
    mutationFn: id => api.delete('/ai/tokens/' + id),
    onSuccess: () => { setConfirmId(null); qc.invalidateQueries({ queryKey: ['ai-tokens'] }) },
  })

  return (
    <Card title="Access tokens">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80}
          placeholder="Name, e.g. Claude on my laptop"
          className="flex-1 min-w-0 rounded-md border bg-background px-3 min-h-[44px] text-sm" />
        <button type="submit" disabled={!name.trim() || create.isPending}
          className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-40 touch-manipulation">
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Make token
        </button>
      </form>
      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      {created && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 space-y-2">
          <p className="text-sm font-medium">Copy your token now. You won't see it again.</p>
          <CopyField value={created.token} />
          <button type="button" onClick={() => setCreated(null)} className="text-sm underline min-h-[40px]">Done</button>
        </div>
      )}
      {tokens.length > 0 && (
        <ul className="divide-y border rounded-md">
          {tokens.map(t => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 min-h-[52px]">
              <div className="flex-1 min-w-0">
                <div className={cn('text-sm font-medium truncate', t.revoked_at && 'line-through text-muted-foreground')}>{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.token_prefix}... {!t.mine && <>· {t.user_email} </>}· made {format(new Date(t.created_at), 'd MMM yyyy')}
                  {t.last_used_at ? ' · last used ' + format(new Date(t.last_used_at), 'd MMM, HH:mm') : ' · not used yet'}
                </div>
              </div>
              {t.revoked_at ? (
                <span className="text-xs text-muted-foreground">Revoked</span>
              ) : confirmId === t.id ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => revoke.mutate(t.id)}
                    className="min-h-[40px] px-3 rounded-md bg-destructive text-destructive-foreground text-xs touch-manipulation">Revoke</button>
                  <button type="button" onClick={() => setConfirmId(null)}
                    className="min-h-[40px] px-3 rounded-md border text-xs touch-manipulation">Keep</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmId(t.id)}
                  className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-destructive touch-manipulation"
                  aria-label="Revoke token">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ── Settings ────────────────────────────────────────────

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} onClick={() => onChange(!checked)}
      className="w-14 h-12 shrink-0 flex items-center justify-center touch-manipulation">
      <span className={cn('relative w-11 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

const SWITCHES = [
  ['staff_enabled', 'Staff assistant', 'The Ask AI chat in this app and the staff connector for AI apps.'],
  ['guest_mcp_enabled', 'Guests book through their AI apps', 'Your restaurants can be found and booked through Macaroonie\'s public connector.'],
  ['guest_chat_enabled', 'Chat on your website', 'The AI chat block on your website answers guests and takes bookings. Add the block in the website builder.'],
]

function SettingsTab({ info }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [draft, setDraft] = useState(null)
  const current = draft ?? info?.settings
  const dirty = draft && SWITCHES.some(([k]) => draft[k] !== info.settings[k])
  const save = useMutation({
    mutationFn: () => api.patch('/ai/settings', Object.fromEntries(SWITCHES.map(([k]) => [k, draft[k]]))),
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      qc.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
  if (!info) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
  const u = info.usage
  const limit = info.settings.monthly_token_limit
  const pct = limit ? Math.min(100, Math.round((u.chat_tokens / limit) * 100)) : 100
  const mcpCalls = (u.channels.staff_mcp?.requests || 0) + (u.channels.guest_mcp?.requests || 0)

  return (
    <>
      {!info.chat_configured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
          <CircleAlert className="w-4 h-4 shrink-0" /> The AI chats aren't set up on this server yet. The connectors for AI apps still work.
        </div>
      )}
      <Card title="What's switched on">
        <div className="divide-y -my-1">
          {SWITCHES.map(([k, label, hint]) => (
            <div key={k} className="flex items-center gap-3 py-1">
              <div className="flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
              <Switch checked={current[k]} label={label} onChange={v => setDraft({ ...current, [k]: v })} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          {save.error && <span className="text-sm text-destructive mr-auto">{save.error.message}</span>}
          {dirty && <button type="button" onClick={() => setDraft(null)} className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Discard</button>}
          <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}
            className="min-h-[44px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center gap-2 touch-manipulation">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </Card>
      <Card title={'This month (' + format(new Date(u.month + 'T12:00:00'), 'MMMM yyyy') + ')'}>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>Chat allowance used</span>
            <span className="font-medium">{u.chat_tokens.toLocaleString()} of {limit.toLocaleString()} tokens</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full', pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary')} style={{ width: pct + '%' }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">The staff assistant and the website chat share this allowance. When it runs out they pause until next month; the connectors keep working.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Stat label="Staff chat replies" value={u.channels.staff_chat?.requests || 0} />
          <Stat label="Website chat replies" value={u.channels.guest_chat?.requests || 0} />
          <Stat label="Staff app calls" value={u.channels.staff_mcp?.requests || 0} />
          <Stat label="Guest app calls" value={u.channels.guest_mcp?.requests || 0} />
        </div>
        {mcpCalls === 0 && <p className="text-xs text-muted-foreground">No calls from AI apps yet this month.</p>}
      </Card>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-lg font-semibold">{Number(value).toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// ── Activity ────────────────────────────────────────────

const CHANNEL_LABELS = { staff_chat: 'Assistant', staff_mcp: 'Staff AI app', guest_chat: 'Website chat', guest_mcp: 'Guest AI app' }
const TOOL_LABELS = {
  create_booking: 'Made a booking', confirm_booking: 'Made a booking', change_booking: 'Moved a booking',
  cancel_booking: 'Cancelled a booking', set_booking_status: 'Changed status', update_guest_details: 'Updated guest details',
  add_booking_note: 'Added a note', request_booking_code: 'Emailed a booking code',
  log_temperature: 'Logged a fridge temperature', log_hold_check: 'Logged a hold temperature',
  log_cooking_check: 'Logged a cooking check', log_delivery: 'Logged a delivery',
  add_corrective_action: 'Added a corrective action', tick_checklist: 'Ticked a checklist',
  add_hs_action: 'Added an H&S action', complete_hs_action: 'Updated an H&S action',
}

/** What an H&S change was about, from its stored result. */
function hsDetail(r) {
  const x = r.result || {}
  switch (r.tool) {
    case 'log_temperature':       return [x.fridge, x.temperature].filter(Boolean).join(' ')
    case 'log_hold_check':        return [x.station, x.temperature].filter(Boolean).join(' ')
    case 'log_cooking_check':     return [x.dish, x.core_temp].filter(Boolean).join(' ')
    case 'log_delivery':          return x.supplier
    case 'add_corrective_action': return x.what
    case 'tick_checklist':        return x.checklist ? x.checklist + (x.ticked ? ' (' + x.ticked + ' ticked)' : '') : null
    case 'add_hs_action':
    case 'complete_hs_action':    return x.task
    default:                      return null
  }
}

function ActivityTab() {
  const api = useApi()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['ai-activity'], queryFn: () => api.get('/ai/activity') })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
  return (
    <Card title="Changes made through AI">
      {!rows.length && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      {rows.length > 0 && (
        <ul className="divide-y -my-2">
          {rows.map(r => (
            <li key={r.id} className="py-2 flex items-start gap-3">
              <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', r.ok ? 'bg-emerald-500' : 'bg-destructive')} />
              <div className="flex-1 min-w-0 text-sm">
                <div>
                  <span className="font-medium">{TOOL_LABELS[r.tool] || r.tool}</span>
                  {!r.ok && <span className="text-destructive"> (didn't go through)</span>}
                  {r.guest_name && <span> · {r.guest_name}</span>}
                  {r.ok && hsDetail(r) && <span> · {hsDetail(r)}</span>}
                  {r.result?.overridden_limits?.length > 0 && <span className="text-amber-700"> · past the usual limits</span>}
                  {r.starts_at && <span className="text-muted-foreground"> · {format(new Date(r.starts_at), 'EEE d MMM, HH:mm')}{r.venue_name ? ', ' + r.venue_name : ''}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(r.created_at), 'd MMM yyyy, HH:mm')} · {CHANNEL_LABELS[r.channel] || r.channel}
                  {r.actor && r.actor !== 'guest' ? ' · ' + r.actor : ''}
                  {!r.ok && r.result?.error ? ' · ' + r.result.error : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
