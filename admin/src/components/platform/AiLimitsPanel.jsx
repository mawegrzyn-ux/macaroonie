// src/components/platform/AiLimitsPanel.jsx
//
// Platform page, "AI usage" tab (migration 148): each tenant's chat tokens
// this month against its monthly limit, AI app calls, and the limit itself
// (the platform pays for chats, so only a platform admin sets it).
// GET/PATCH /api/ai/platform/tenants.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CircleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function AiLimitsPanel() {
  const api = useApi()
  const { data, isLoading } = useQuery({ queryKey: ['ai-platform'], queryFn: () => api.get('/ai/platform/tenants') })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
  const tenants = data?.tenants ?? []
  return (
    <section className="rounded-lg border bg-background overflow-hidden">
      <div className="px-5 py-3 section-head font-semibold text-sm">AI usage, {data?.month?.slice(0, 7)}</div>
      {!data?.chat_configured && (
        <div className="mx-5 mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
          <CircleAlert className="w-4 h-4 shrink-0" /> ANTHROPIC_API_KEY isn't set on this server, so the chats are off. The MCP connectors still work.
        </div>
      )}
      <ul className="divide-y">
        {tenants.map(t => <TenantRow key={t.id} t={t} />)}
      </ul>
    </section>
  )
}

function TenantRow({ t }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [limit, setLimit] = useState(String(t.monthly_token_limit))
  const value = Number(limit)
  const valid = limit.trim() !== '' && Number.isInteger(value) && value >= 0
  const dirty = valid && value !== t.monthly_token_limit
  const save = useMutation({
    mutationFn: () => api.patch('/ai/platform/tenants/' + t.id, { monthly_token_limit: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-platform'] }),
  })
  const pct = t.monthly_token_limit ? Math.min(100, Math.round((t.chat_tokens / t.monthly_token_limit) * 100)) : 100
  return (
    <li className="px-5 py-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <div className="text-sm font-medium">{t.name}</div>
        <div className="h-2 rounded-full bg-muted overflow-hidden my-1">
          <div className={cn('h-full', pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary')} style={{ width: pct + '%' }} />
        </div>
        <div className="text-xs text-muted-foreground">
          {t.chat_tokens.toLocaleString()} chat tokens · {t.mcp_calls.toLocaleString()} AI app calls
          {' · '}{[t.staff_enabled && 'staff', t.guest_mcp_enabled && 'guest apps', t.guest_chat_enabled && 'website chat'].filter(Boolean).join(', ') || 'all off'}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Monthly limit</span>
        <input type="text" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/[^\d]/g, ''))}
          className="w-32 rounded-md border bg-background px-2 min-h-[44px] text-sm text-right" />
      </label>
      <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}
        className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation">
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
      </button>
      {save.error && <span className="text-xs text-destructive w-full">{save.error.message}</span>}
    </li>
  )
}
