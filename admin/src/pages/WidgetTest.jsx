// src/pages/WidgetTest.jsx
// Admin-side booking widget test harness.
// Left panel: configuration (venue, date, covers, widget appearance).
// Right panel: live widget preview running the real booking flow.
// Mirrors exactly what the Ember widget will do.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Settings2, ExternalLink, RefreshCw } from 'lucide-react'
import { useApi } from '@/lib/api'
import BookingWidget from '@/components/widget/BookingWidget'

export default function WidgetTest() {
  const api = useApi()

  const [venueId,  setVenueId]  = useState('')
  const [date,     setDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })
  const [covers,   setCovers]   = useState(2)
  const [theme,    setTheme]    = useState('light')
  const [accentHex, setAccent]  = useState('#2563eb')
  const [key,      setKey]      = useState(0)   // increment to force widget remount

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    onSuccess: d => { if (d.length && !venueId) setVenueId(d[0].id) },
  })

  const selectedVenue = venues.find(v => v.id === venueId)

  function reset() { setKey(k => k + 1) }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Config panel ─────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-14 border-b shrink-0">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Widget config</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          <Section title="Venue">
            <select
              value={venueId}
              onChange={e => { setVenueId(e.target.value); reset() }}
              className="w-full text-sm border rounded-lg px-3 py-2"
            >
              <option value="">Select venue…</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {selectedVenue && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {selectedVenue.timezone} · {selectedVenue.currency}
              </p>
            )}
          </Section>

          <Section title="Booking params">
            <label className="block text-xs text-muted-foreground mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); reset() }}
              className="w-full text-sm border rounded-lg px-3 py-2"
            />
            <label className="block text-xs text-muted-foreground mb-1 mt-3">Default covers</label>
            <div className="flex gap-1.5">
              {[1,2,3,4,5,6,7,8].map(n => (
                <button
                  key={n}
                  onClick={() => { setCovers(n); reset() }}
                  className={`w-8 h-8 rounded-full text-xs font-medium border transition-colors
                    ${covers === n ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Appearance">
            <label className="block text-xs text-muted-foreground mb-1">Theme</label>
            <div className="flex gap-2">
              {['light','dark'].map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 text-sm py-1.5 rounded-lg border capitalize transition-colors
                    ${theme === t ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="block text-xs text-muted-foreground mb-1 mt-3">Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentHex}
                onChange={e => setAccent(e.target.value)}
                className="w-10 h-9 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={accentHex}
                onChange={e => setAccent(e.target.value)}
                className="flex-1 text-sm border rounded-lg px-3 py-2 font-mono"
              />
            </div>
          </Section>

          <Section title="Embed code">
            <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`<script src="https://cdn.macaroonie.com/widget.js"></script>
<div id="booking-widget"
  data-venue="${venueId}"
  data-accent="${accentHex}"
  data-theme="${theme}">
</div>`}
            </pre>
          </Section>

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex items-center gap-1.5 flex-1 justify-center text-sm py-2 border rounded-lg hover:bg-accent"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>
      </aside>

      {/* ── Widget preview panel ──────────────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-colors
        ${theme === 'dark' ? 'bg-zinc-900' : 'bg-slate-50'}`}
      >
        {/* Preview header */}
        <div className={`flex items-center justify-between px-5 h-14 border-b shrink-0
          ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-slate-200 bg-white'}`}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {['bg-red-400','bg-yellow-400','bg-green-400'].map(c => (
                <div key={c} className={`w-3 h-3 rounded-full ${c}`} />
              ))}
            </div>
            <span className={`text-xs font-mono ml-2 ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-400'}`}>
              {selectedVenue?.name ?? 'restaurant.com'} — booking widget preview
            </span>
          </div>
          <span className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
            Live · connected to API
          </span>
        </div>

        {/* Widget container — centred like it would be on a real restaurant page */}
        <div className="flex-1 overflow-y-auto flex items-start justify-center p-8">
          {venueId ? (
            <BookingWidget
              key={key}
              venueId={venueId}
              date={date}
              initialCovers={covers}
              theme={theme}
              accentHex={accentHex}
            />
          ) : (
            <div className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
              Select a venue to preview the widget
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  )
}
