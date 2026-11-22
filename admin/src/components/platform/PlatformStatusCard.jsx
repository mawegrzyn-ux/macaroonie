// src/components/platform/PlatformStatusCard.jsx
//
// Platform page, Services tab (22 Nov 2026, OUTSTANDING 45): whether the
// platform is up. One light (up, degraded, down) with the reasons, then the
// database, Redis, the machine, the API processes (their heartbeats) and the
// background jobs (when each last ran, late ones marked, queue counts, the
// last error). GET /api/platform/status (services/platformStatus.js), read
// again every 30 seconds while the tab is open.
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import { Activity, Loader2, RefreshCw, CircleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const STATE_STYLE = {
  up:       { dot: 'bg-emerald-500', text: 'text-emerald-800', box: 'border-emerald-300 bg-emerald-50', label: 'Up' },
  degraded: { dot: 'bg-amber-500',   text: 'text-amber-900',   box: 'border-amber-300 bg-amber-50',     label: 'Degraded' },
  down:     { dot: 'bg-red-600',     text: 'text-red-800',     box: 'border-red-300 bg-red-50',         label: 'Down' },
}
const ago = iso => (iso ? formatDistanceToNowStrict(parseISO(iso), { addSuffix: true }) : 'not since the last restart')
const every = s => (s == null ? 'when asked' : s < 120 ? 'every ' + s + ' s' : s < 7200 ? 'every ' + Math.round(s / 60) + ' min' : 'every ' + Math.round(s / 3600) + ' h')

function Light({ ok, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className={cn('w-2.5 h-2.5 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-600')} aria-hidden="true" />
      {label}: {ok ? 'reachable' : 'not reachable'}
    </span>
  )
}

export default function PlatformStatusCard() {
  const api = useApi()
  const { data: s, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['platform-status'], queryFn: () => api.get('/platform/status'), refetchInterval: 30_000,
  })
  const style = STATE_STYLE[s?.state] || STATE_STYLE.degraded
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="platform-status">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <Activity className="w-4 h-4" /> Platform status
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="ml-auto inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md text-xs font-medium hover:bg-black/5 touch-manipulation disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Check now
        </button>
      </div>
      <div className="p-5 space-y-5">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          : error ? (
            <p className="text-sm text-red-800 flex items-center gap-2"><CircleAlert className="w-4 h-4" /> Couldn&apos;t ask the API: {error.message}</p>
          ) : s && (<>
          <div className={cn('rounded-lg border px-4 py-3 flex flex-wrap items-start gap-3', style.box)} data-testid="platform-state" data-state={s.state}>
            <span className={cn('mt-1 w-3.5 h-3.5 rounded-full shrink-0', style.dot)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={cn('font-semibold', style.text)}>{style.label}</p>
              {s.reasons?.length > 0 && (
                <ul className="mt-1 text-sm list-disc pl-5">{s.reasons.map(r => <li key={r}>{r}</li>)}</ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Checked {ago(s.checked_at)}
                {s.deployed?.commit && <> · deployed {s.deployed.commit}{s.deployed.branch ? ' (' + s.deployed.branch + ')' : ''}</>}
                {s.node_env && <> · {s.node_env}</>}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3 space-y-1">
              <Light ok={s.database.ok} label="Database" />
              {s.database.ok ? (
                <p className="text-xs text-muted-foreground">{s.database.ms} ms · {s.database.size_mb} MB · {s.database.connections} connections · Postgres {String(s.database.version || '').split(' ')[0]}</p>
              ) : <p className="text-xs text-red-800">{s.database.error}</p>}
            </div>
            <div className="rounded-md border p-3 space-y-1">
              <Light ok={s.redis.ok} label="Redis" />
              {s.redis.ok ? (
                <p className="text-xs text-muted-foreground">{s.redis.ms} ms · {s.redis.used_memory} used</p>
              ) : <p className="text-xs text-red-800">{s.redis.error}</p>}
            </div>
            <div className="rounded-md border p-3 space-y-1" data-testid="platform-machine">
              <p className="text-sm font-medium">Machine {s.machine.host}</p>
              <p className={cn('text-xs', s.machine.disk && s.machine.disk.free_pct < 10 ? 'text-red-800 font-medium' : 'text-muted-foreground')}>
                {s.machine.disk ? 'Disk ' + s.machine.disk.free_gb + ' of ' + s.machine.disk.total_gb + ' GB free (' + s.machine.disk.free_pct + '%)' : 'Disk not known'}
              </p>
              <p className="text-xs text-muted-foreground">
                Memory {s.machine.memory.free_gb} of {s.machine.memory.total_gb} GB free · load {s.machine.load.join(' ')} on {s.machine.cpus} CPUs · up {s.machine.uptime_h} h
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">API processes</h3>
            {s.processes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No heartbeats{s.redis.ok ? '' : ' (Redis is down, so they can\'t be read)'}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="platform-processes">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">Process</th><th className="py-1 pr-3 font-medium">Running since</th><th className="py-1 pr-3 font-medium">Last heartbeat</th><th className="py-1 font-medium">Memory</th></tr></thead>
                  <tbody className="divide-y">
                    {s.processes.map(p => (
                      <tr key={p.host + p.pid}>
                        <td className="py-1.5 pr-3">{p.host} · {p.instance != null ? '#' + p.instance + ' · ' : ''}pid {p.pid}</td>
                        <td className="py-1.5 pr-3">{ago(p.started_at)}</td>
                        <td className="py-1.5 pr-3">{ago(p.beat_at)}</td>
                        <td className="py-1.5">{p.rss_mb} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">Background jobs</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="platform-jobs">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">Job</th><th className="py-1 pr-3 font-medium">Runs</th><th className="py-1 pr-3 font-medium">Last ran</th><th className="py-1 pr-3 font-medium">Waiting</th><th className="py-1 font-medium">Failed</th></tr></thead>
                <tbody className="divide-y">
                  {s.jobs.map(j => (
                    <tr key={j.name} data-testid="platform-job" data-late={j.late ? '1' : '0'}>
                      <td className="py-1.5 pr-3">
                        {j.label}
                        {j.late && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">Late</span>}
                        {j.last_error && <p className="text-xs text-red-800 break-words">Last failure {ago(j.last_failed_at)}: {j.last_error}</p>}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{every(j.every_s)}</td>
                      <td className="py-1.5 pr-3">{j.every_s == null && !j.last_done_at ? '–' : ago(j.last_done_at)}</td>
                      <td className="py-1.5 pr-3">{j.counts ? j.counts.waiting + j.counts.delayed : '–'}</td>
                      <td className={cn('py-1.5', j.counts?.failed ? 'text-red-800 font-medium' : '')}>{j.counts ? j.counts.failed : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Failed counts the jobs kept after failing (each queue keeps its last few). A job is late after three of its intervals.</p>
          </div>
        </>)}
      </div>
    </section>
  )
}
