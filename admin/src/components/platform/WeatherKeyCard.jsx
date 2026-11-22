// src/components/platform/WeatherKeyCard.jsx
//
// Platform page, Services tab (22 Nov 2026): the Open-Meteo key for the Local
// info weather captures. Open-Meteo's free API is for non-commercial use;
// with a paid plan's key saved here the captures use Open-Meteo's customer
// hosts. Saving checks the key with Open-Meteo first; the key is never sent
// back, only its last four characters. GET/PUT/DELETE /api/platform/weather-key.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, CircleAlert, CircleCheck, CloudSun } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function WeatherKeyCard() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: info, isLoading } = useQuery({ queryKey: ['platform-weather-key'], queryFn: () => api.get('/platform/weather-key') })
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState(null)   // { tone: 'ok' | 'error', text }
  const [confirmRemove, setConfirmRemove] = useState(false)
  const done = res => qc.setQueryData(['platform-weather-key'], res)

  const save = useMutation({
    mutationFn: () => api.put('/platform/weather-key', { api_key: draft.trim() }),
    onSuccess: res => { setDraft(''); done(res); setNotice({ tone: 'ok', text: 'Key checked with Open-Meteo and saved. The next weather captures use it.' }) },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/platform/weather-key'),
    onSuccess: res => { setConfirmRemove(false); done(res); setNotice({ tone: 'ok', text: 'Key removed. The weather captures use Open-Meteo\'s free API again.' }) },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="weather-key-card">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <CloudSun className="w-4 h-4" /> Open-Meteo key (weather)
      </div>
      <div className="p-5 space-y-4">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : info?.saved ? (
          <p className="text-sm" data-testid="weather-key-saved">
            <span className="font-medium">A key is saved</span>, ending <span className="font-mono">{info.saved.hint}</span>.
            <span className="text-muted-foreground">
              {' '}Saved{info.saved.updated_by ? ' by ' + info.saved.updated_by : ''} on {format(parseISO(info.saved.updated_at), 'd MMM yyyy, HH:mm')}.
              The weather captures use Open-Meteo&apos;s paid service with it.
            </span>
          </p>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2" data-testid="weather-key-none">
            <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>No key: the weather captures use Open-Meteo&apos;s free API, which is for non-commercial use. Take a paid plan before real customers rely on the weather, and save its key here.</span>
          </div>
        )}

        <form className="space-y-2" autoComplete="off"
          onSubmit={e => { e.preventDefault(); if (draft.trim()) { setNotice(null); save.mutate() } }}>
          <label className="block text-sm font-medium" htmlFor="weather-key-input">{info?.saved ? 'Replace the key' : 'Add a key'}</label>
          <div className="flex flex-wrap gap-2">
            <input id="weather-key-input" type="password" autoComplete="new-password" spellCheck={false}
              value={draft} onChange={e => setDraft(e.target.value)}
              className="flex-1 min-w-[220px] rounded-md border bg-background px-3 min-h-[48px] text-sm font-mono" />
            <button type="submit" disabled={!draft.trim() || save.isPending}
              className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation">
              {save.isPending ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking</span> : 'Check and save'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">From your Open-Meteo account. We check it with one small call before saving, and it&apos;s never shown again here.</p>
        </form>

        {notice && (
          <div className={cn('rounded-md border px-3 py-2 text-sm flex items-start gap-2',
            notice.tone === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800')}>
            {notice.tone === 'ok' ? <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" /> : <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{notice.text}</span>
          </div>
        )}

        {info?.saved && (confirmRemove ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5">
            <span className="text-sm text-red-800">Remove it? The weather captures go back to Open-Meteo&apos;s free API.</span>
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
              className="min-h-[48px] px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation">
              {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, remove'}
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-[48px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)}
            className="min-h-[48px] px-4 rounded-md border text-sm font-medium text-destructive hover:bg-destructive/10 touch-manipulation">
            Remove saved key
          </button>
        ))}
      </div>
    </section>
  )
}
