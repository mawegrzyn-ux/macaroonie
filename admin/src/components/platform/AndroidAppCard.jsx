// src/components/platform/AndroidAppCard.jsx
//
// Platform page, Android app tab (migration 213): the Macaroonie Android
// app's download. A platform admin pastes the newest build's link from
// expo.dev; the server keeps its own copy of the APK (Expo's links change
// with every build and run out), and the setup screens of tills, kitchen
// screens and kiosks offer it at /android. GET/PUT/DELETE /api/platform/android-app.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Loader2, CircleAlert, CircleCheck, Smartphone } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const KEY = ['platform-android-app']

const mb = bytes => (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0) + ' MB'

export default function AndroidAppCard() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api.get('/platform/android-app') })
  const [link, setLink]     = useState('')
  const [notice, setNotice] = useState(null)   // { tone: 'ok' | 'error', text }
  const [confirmRemove, setConfirmRemove] = useState(false)

  const save = useMutation({
    mutationFn: () => api.put('/platform/android-app', { link: link.trim() }),
    onSuccess: res => {
      qc.setQueryData(KEY, res)
      setLink('')
      setNotice({ tone: 'ok', text: `Copied (${mb(res.app.bytes)}). The setup screens offer this one from now on.` })
    },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  const remove = useMutation({
    mutationFn: () => api.delete('/platform/android-app'),
    onSuccess: res => {
      qc.setQueryData(KEY, res)
      setConfirmRemove(false)
      setNotice({ tone: 'ok', text: 'Removed. The setup screens no longer offer the app.' })
    },
    onError: err => setNotice({ tone: 'error', text: err.message }),
  })

  const app = data?.app
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="android-app-card">
      <div className="px-5 py-3 section-head font-semibold text-sm flex items-center gap-2">
        <Smartphone className="w-4 h-4" /> Android app download
      </div>
      <div className="p-5 space-y-4">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : app ? (
          <div className="text-sm space-y-2" data-testid="android-app-status">
            <p>
              <span className="font-medium">Offered on the setup screens</span>, {mb(app.bytes)}.
              <span className="text-muted-foreground">
                {' '}Copied{app.updated_by ? ' by ' + app.updated_by : ''} on {format(parseISO(app.updated_at), 'd MMM yyyy, HH:mm')}.
              </span>
            </p>
            <p className="text-muted-foreground break-all">From <span className="font-mono text-xs">{app.source_url}</span></p>
            <div>
              <div className="text-muted-foreground mb-1">Downloads at:</div>
              <ul className="space-y-1">
                {(data.addresses || []).map(a => (
                  <li key={a}><a href={a} className="font-mono text-xs underline break-all">{a}</a></li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2" data-testid="android-app-status">
            <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>No app yet, so the setup screens of tills, kitchen screens and kiosks don't offer it.</span>
          </div>
        )}

        <form className="space-y-2" autoComplete="off"
          onSubmit={e => { e.preventDefault(); if (link.trim()) { setNotice(null); save.mutate() } }}>
          <label className="block text-sm font-medium" htmlFor="android-app-link">
            {app ? 'Replace it with a newer build' : 'Add the app'}
          </label>
          <div className="flex flex-wrap gap-2">
            <input id="android-app-link" type="url" inputMode="url" spellCheck={false}
              value={link} onChange={e => setLink(e.target.value)} placeholder="https://expo.dev/..."
              className="flex-1 min-w-[220px] rounded-md border bg-background px-3 min-h-[48px] text-sm font-mono" />
            <button type="submit" disabled={!link.trim() || save.isPending}
              className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation">
              {save.isPending ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Getting the app</span> : 'Copy and offer it'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            On expo.dev, open the Android internal distribution build and copy its Install or Download link
            (the build page's own address works too). Use an APK build, not an app bundle for Google Play.
            The server keeps its own copy, so the download keeps working after Expo's link runs out.
            Paste the newer link after each build.
          </p>
        </form>

        {notice && (
          <div className={cn('rounded-md border px-3 py-2 text-sm flex items-start gap-2',
            notice.tone === 'ok'    && 'border-green-300 bg-green-50 text-green-800',
            notice.tone === 'error' && 'border-red-300 bg-red-50 text-red-800')} data-testid="android-app-notice">
            {notice.tone === 'ok' ? <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" /> : <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{notice.text}</span>
          </div>
        )}

        {app && !confirmRemove && (
          <button type="button" onClick={() => { setNotice(null); setConfirmRemove(true) }}
            className="min-h-[48px] px-4 rounded-md border text-sm font-medium text-destructive hover:bg-destructive/10 touch-manipulation">
            Stop offering it
          </button>
        )}
        {app && confirmRemove && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5">
            <span className="text-sm text-red-800">Remove the copy? The setup screens stop offering the app; devices that have it keep it.</span>
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}
              className="min-h-[44px] px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation">
              {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, remove'}
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)}
              className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
