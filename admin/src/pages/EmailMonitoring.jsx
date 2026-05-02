// src/pages/EmailMonitoring.jsx
//
// SendGrid + local email_log monitoring.
//
// Two columns: "What went out" (sends + delivery stats) and "What's in"
// (bounces / blocks / spam reports / invalid emails — the things SendGrid
// blocks at the gateway).
//
// RBAC: admin/owner can view; only owner can remove suppressions.

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Mail, AlertTriangle, ShieldAlert, MailX, Ban,
  Loader2, RefreshCw, Send, CheckCircle2, XCircle, Trash2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const SUPPRESSION_META = {
  bounces:        { label: 'Bounces',         icon: MailX,        color: 'text-amber-700 bg-amber-50',  description: 'Recipient mailbox rejected the message.' },
  blocks:         { label: 'Blocks',          icon: Ban,          color: 'text-rose-700 bg-rose-50',    description: 'ISP blocked our IP or content.' },
  spam_reports:   { label: 'Spam reports',    icon: ShieldAlert,  color: 'text-purple-700 bg-purple-50', description: 'Recipient marked the email as spam.' },
  invalid_emails: { label: 'Invalid emails',  icon: XCircle,      color: 'text-gray-700 bg-gray-100',   description: 'Address malformed at SendGrid validation.' },
}

const STATUS_DOT = {
  sent:   'bg-emerald-500',
  failed: 'bg-rose-500',
  retry:  'bg-amber-400',
}

export default function EmailMonitoring() {
  const api = useApi()
  const qc  = useQueryClient()
  const [venueId, setVenueId] = useState('')
  const [days,    setDays]    = useState(30)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    onSuccess: v => { if (v.length && !venueId) setVenueId(v[0].id) },
  })

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['email-monitoring', 'summary', venueId, days],
    queryFn:  () => api.get(`/email-monitoring/summary?venue_id=${venueId}&days=${days}`),
    enabled:  !!venueId,
    staleTime: 30_000,
  })

  const { data: log = [] } = useQuery({
    queryKey: ['email-monitoring', 'log', venueId],
    queryFn:  () => api.get(`/email-monitoring/log?venue_id=${venueId}&limit=200`),
    enabled:  !!venueId,
    staleTime: 30_000,
  })

  const removeSuppression = useMutation({
    mutationFn: ({ type, email }) => api.delete(`/email-monitoring/suppressions/${type}/${encodeURIComponent(email)}?venue_id=${venueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-monitoring', 'summary'] }),
  })

  const sg = summary?.sendgrid
  const totals = sg?.totals
  const local  = summary?.local || {}
  const supp   = summary?.suppressions

  const totalSent  = (local.sent ?? 0) + (local.retry ?? 0)
  const totalFail  = (local.failed ?? 0)
  const deliveryRate = totals && totals.requests > 0
    ? ((totals.delivered / totals.requests) * 100).toFixed(1)
    : null
  const openRate = totals && totals.delivered > 0
    ? ((totals.unique_opens / totals.delivered) * 100).toFixed(1)
    : null
  const bounceRate = totals && totals.requests > 0
    ? ((totals.bounces / totals.requests) * 100).toFixed(1)
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" /> Email monitoring
          </h1>
          <p className="text-xs text-muted-foreground">
            SendGrid stats + suppressions for the selected venue, plus the platform&apos;s own send log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={venueId} onChange={e => setVenueId(e.target.value)}
            className="text-sm border rounded-md px-3 py-2 bg-background min-h-[40px] touch-manipulation">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-sm border rounded-md px-3 py-2 bg-background min-h-[40px] touch-manipulation">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={() => refetchSummary()}
            className="p-2 rounded-md border hover:bg-accent touch-manipulation min-h-[40px] min-w-[40px] inline-flex items-center justify-center"
            title="Refresh">
            <RefreshCw className={cn('w-4 h-4', summaryLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-6">

          {!venueId && <p className="text-sm text-muted-foreground">Pick a venue to load monitoring.</p>}

          {summaryLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {summary && summary.provider !== 'sendgrid' && (
            <Banner type="info">
              This venue is using <strong>{summary.provider}</strong>, not SendGrid. Monitoring
              currently supports SendGrid only — switch the provider in Email Templates →
              Settings to see delivery data here.
            </Banner>
          )}

          {summary && summary.provider === 'sendgrid' && !summary.configured && (
            <Banner type="warn">
              No SendGrid API key configured for this venue (or the key is invalid).
              Add it in <strong>Email Templates → Settings</strong>. Local send log is still
              shown below.
            </Banner>
          )}

          {summary && (
            <>
              {/* ── What went out ─────────────────────────── */}
              <Section icon={Send} title="What went out">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat label="Requested" value={totals?.requests ?? '—'} sub="SendGrid" />
                  <Stat label="Delivered" value={totals?.delivered ?? '—'}
                        sub={deliveryRate ? `${deliveryRate}% rate` : 'SendGrid'}
                        valueClass="text-emerald-700" />
                  <Stat label="Opened (unique)" value={totals?.unique_opens ?? '—'}
                        sub={openRate ? `${openRate}% of delivered` : 'SendGrid'} />
                  <Stat label="Clicked (unique)" value={totals?.unique_clicks ?? '—'} sub="SendGrid" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <Stat label="Sent (local log)" value={totalSent} sub="our DB" />
                  <Stat label="Failed (local log)" value={totalFail} sub="our DB"
                        valueClass={totalFail > 0 ? 'text-rose-700' : ''} />
                  <Stat label="Bounces" value={totals?.bounces ?? '—'}
                        sub={bounceRate ? `${bounceRate}% rate` : 'SendGrid'}
                        valueClass={(totals?.bounces ?? 0) > 0 ? 'text-amber-700' : ''} />
                  <Stat label="Spam reports" value={totals?.spam_reports ?? '—'}
                        valueClass={(totals?.spam_reports ?? 0) > 0 ? 'text-rose-700' : ''} />
                </div>

                {/* Daily breakdown table */}
                {sg?.series?.length > 0 && (
                  <div className="mt-4 border rounded-xl overflow-hidden bg-background">
                    <div className="px-4 py-2 border-b bg-muted/40 text-xs font-semibold">
                      Daily breakdown
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/20">
                          <tr className="text-left text-muted-foreground">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2 text-right">Requested</th>
                            <th className="px-3 py-2 text-right">Delivered</th>
                            <th className="px-3 py-2 text-right">Opens</th>
                            <th className="px-3 py-2 text-right">Clicks</th>
                            <th className="px-3 py-2 text-right">Bounces</th>
                            <th className="px-3 py-2 text-right">Spam</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...sg.series].reverse().map(d => (
                            <tr key={d.date} className="border-t">
                              <td className="px-3 py-1.5 font-mono">{d.date}</td>
                              <td className="px-3 py-1.5 text-right">{d.requests || 0}</td>
                              <td className="px-3 py-1.5 text-right text-emerald-700">{d.delivered || 0}</td>
                              <td className="px-3 py-1.5 text-right">{d.unique_opens || 0}</td>
                              <td className="px-3 py-1.5 text-right">{d.unique_clicks || 0}</td>
                              <td className="px-3 py-1.5 text-right text-amber-700">{d.bounces || 0}</td>
                              <td className="px-3 py-1.5 text-right text-rose-700">{d.spam_reports || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Local email_log */}
                <div className="mt-4 border rounded-xl overflow-hidden bg-background">
                  <div className="px-4 py-2 border-b bg-muted/40 text-xs font-semibold flex items-center justify-between">
                    <span>Recent sends (local log)</span>
                    <span className="text-muted-foreground font-normal">
                      Last {log.length} entries
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {log.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No sends yet.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-muted/20 sticky top-0">
                          <tr className="text-left text-muted-foreground">
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Recipient</th>
                            <th className="px-3 py-2">Subject</th>
                            <th className="px-3 py-2">Provider</th>
                          </tr>
                        </thead>
                        <tbody>
                          {log.map(row => (
                            <tr key={row.id} className="border-t hover:bg-accent/30">
                              <td className="px-3 py-1.5">
                                <span className={cn('inline-block w-2 h-2 rounded-full mr-1', STATUS_DOT[row.status] || 'bg-gray-400')} />
                                {row.status}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-[11px]">{row.template_type}</td>
                              <td className="px-3 py-1.5 truncate max-w-xs">{row.recipient}</td>
                              <td className="px-3 py-1.5 truncate max-w-xs text-muted-foreground">{row.subject}</td>
                              <td className="px-3 py-1.5 text-[11px]">{row.provider}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </Section>

              {/* ── What's in (suppressions) ──────────────── */}
              <Section icon={AlertTriangle} title="What's in (suppressions)">
                <p className="text-xs text-muted-foreground mb-3">
                  Addresses SendGrid is currently NOT delivering to. Click an entry to copy the
                  email; owners can remove individual entries to retry sending.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {Object.entries(SUPPRESSION_META).map(([type, meta]) => (
                    <SuppressionCard key={type}
                      type={type}
                      meta={meta}
                      items={supp?.[type] ?? []}
                      onRemove={(email) => removeSuppression.mutate({ type, email })}
                      pending={removeSuppression.isPending && removeSuppression.variables?.email}
                    />
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────

function Section({ icon: Icon, title, children }) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4" /> {title}
      </h2>
      {children}
    </section>
  )
}

function Stat({ label, value, sub, valueClass }) {
  return (
    <div className="border rounded-xl p-4 bg-background">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', valueClass)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function Banner({ type, children }) {
  const colour = type === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900'
              : type === 'error' ? 'border-rose-300 bg-rose-50 text-rose-900'
              :                    'border-blue-300 bg-blue-50 text-blue-900'
  return (
    <div className={cn('border rounded-xl px-5 py-3 text-sm', colour)}>
      {children}
    </div>
  )
}

function SuppressionCard({ type, meta, items, onRemove, pending }) {
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, 5)

  return (
    <div className="border rounded-xl bg-background overflow-hidden">
      <div className={cn('px-4 py-2 border-b flex items-center justify-between', meta.color)}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="w-4 h-4" /> {meta.label}
        </div>
        <span className="text-2xl font-bold tabular-nums">{items.length}</span>
      </div>
      <p className="text-[11px] text-muted-foreground px-4 pt-2">{meta.description}</p>
      <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
        {items.length === 0
          ? <p className="text-xs text-muted-foreground text-center py-3 italic">none</p>
          : (
            <>
              {visible.map(s => (
                <div key={s.email} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-accent/40 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate">{s.email}</p>
                    {s.reason && <p className="text-[10px] text-muted-foreground truncate">{s.reason}</p>}
                  </div>
                  <button onClick={() => onRemove(s.email)}
                    disabled={pending === s.email}
                    title="Remove suppression"
                    className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50">
                    {pending === s.email ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  </button>
                </div>
              ))}
              {items.length > 5 && (
                <button onClick={() => setExpanded(x => !x)}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1.5">
                  {expanded ? 'Show less' : `Show ${items.length - 5} more…`}
                </button>
              )}
            </>
          )
        }
      </div>
    </div>
  )
}
