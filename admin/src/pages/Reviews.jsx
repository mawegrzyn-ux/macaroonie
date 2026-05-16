// src/pages/Reviews.jsx
//
// Review management: approve, feature, add manually, trigger Apify scrape, CSV import.
// Connects to the reviews_band CMS block when source='db'.

import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Star, StarOff, CheckCircle2, XCircle, Trash2, Plus, Upload,
  RefreshCw, Search, Loader2, ChevronDown, ChevronUp,
  MessageSquare, Globe, Clock, Filter,
} from 'lucide-react'
import { useApi }  from '@/lib/api'
import { cn }      from '@/lib/utils'

const PLATFORMS = [
  { key: '',            label: 'All platforms' },
  { key: 'google',      label: 'Google' },
  { key: 'tripadvisor', label: 'TripAdvisor' },
  { key: 'justeat',     label: 'Just Eat' },
  { key: 'deliveroo',   label: 'Deliveroo' },
  { key: 'glovo',       label: 'Glovo' },
  { key: 'manual',      label: 'Manual' },
]

const PLATFORM_COLOURS = {
  google:      'bg-blue-100 text-blue-700',
  tripadvisor: 'bg-green-100 text-green-700',
  justeat:     'bg-orange-100 text-orange-700',
  deliveroo:   'bg-teal-100 text-teal-700',
  glovo:       'bg-yellow-100 text-yellow-700',
  manual:      'bg-gray-100 text-gray-700',
  csv:         'bg-purple-100 text-purple-700',
}

function Stars({ n, size = 'sm' }) {
  const cls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'
  return (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={cn(cls, i <= n ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200')} />
      ))}
    </span>
  )
}

function PlatformBadge({ platform }) {
  const cls = PLATFORM_COLOURS[platform] || 'bg-gray-100 text-gray-600'
  return <span className={cn('text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5', cls)}>{platform}</span>
}

function StatCard({ label, value, color = '' }) {
  return (
    <div className="border rounded-lg p-4 text-center">
      <p className={cn('text-2xl font-bold', color)}>{value ?? '—'}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  )
}

// ── Add review modal ──────────────────────────────────────────

function AddReviewModal({ venueId, onClose, onSaved }) {
  const api = useApi()
  const [form, setForm] = useState({
    venue_id:      venueId || '',
    platform:      'manual',
    reviewer_name: '',
    rating:        5,
    review_text:   '',
    review_date:   new Date().toISOString().slice(0, 10),
    is_approved:   true,
    is_featured:   false,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const set = k => v => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      const payload = {
        ...form,
        venue_id:    form.venue_id || null,
        review_date: form.review_date ? form.review_date + 'T00:00:00Z' : null,
      }
      await api.post('/reviews', payload)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message || 'Failed to save review')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border rounded px-3 py-2 text-sm'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Add review manually</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><XCircle className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {err && <p className="text-sm text-destructive bg-destructive/10 rounded p-2">{err}</p>}

          <div className="space-y-1">
            <label className="text-xs font-medium">Reviewer name</label>
            <input className={inputCls} value={form.reviewer_name} onChange={e => set('reviewer_name')(e.target.value)} placeholder="e.g. Jane M." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Platform</label>
              <select className={inputCls} value={form.platform} onChange={e => set('platform')(e.target.value)}>
                {PLATFORMS.filter(p => p.key).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Date</label>
              <input type="date" className={inputCls} value={form.review_date} onChange={e => set('review_date')(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Rating</label>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(n => (
                <button key={n} type="button" onClick={() => set('rating')(n)}
                  className={cn('w-9 h-9 rounded text-sm font-bold border touch-manipulation',
                    form.rating === n ? 'bg-amber-400 text-white border-amber-400' : 'border-border')}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Review text</label>
            <textarea className={inputCls} rows={4} value={form.review_text} onChange={e => set('review_text')(e.target.value)} placeholder="What did they say?" />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_approved} onChange={e => set('is_approved')(e.target.checked)} />
              Approved
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_featured} onChange={e => set('is_featured')(e.target.checked)} />
              Featured
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border rounded py-2 text-sm touch-manipulation">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-primary text-primary-foreground rounded py-2 text-sm font-medium disabled:opacity-50 touch-manipulation">
              {saving ? 'Saving…' : 'Save review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Scrape modal ──────────────────────────────────────────────

function ScrapeModal({ venues, onClose, onStarted }) {
  const api = useApi()
  const [venueId,    setVenueId]    = useState(venues[0]?.id || '')
  const [maxReviews, setMaxReviews] = useState(200)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)

  async function handleScrape() {
    setLoading(true)
    setMsg(null)
    try {
      const res = await api.post('/reviews/scrape', {
        venue_id:    venueId,
        platform:    'google',
        max_reviews: maxReviews,
      })
      setMsg({ type: 'ok', text: `Scrape started for ${res.venue_name}. Results will appear shortly.` })
      onStarted?.()
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Failed to start scrape' })
    } finally {
      setLoading(false)
    }
  }

  const selectedVenue = venues.find(v => v.id === venueId)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Scrape Google reviews</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {msg && (
            <p className={cn('text-sm rounded p-2', msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/10 text-destructive')}>
              {msg.text}
            </p>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium">Venue</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={venueId} onChange={e => setVenueId(e.target.value)}>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {selectedVenue && !selectedVenue.google_place_id && (
              <p className="text-xs text-amber-600 mt-1">This venue has no Google Place ID set. Add it in Venue settings first.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Max reviews to fetch</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={maxReviews} onChange={e => setMaxReviews(Number(e.target.value))}>
              {[50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} reviews</option>)}
            </select>
          </div>

          <p className="text-xs text-muted-foreground">
            Scraping runs in the background via Apify. Reviews will appear in the list once complete. New reviews are added; existing ones updated.
          </p>

          {msg?.type !== 'ok' && (
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 border rounded py-2 text-sm touch-manipulation">Cancel</button>
              <button onClick={handleScrape} disabled={loading || !selectedVenue?.google_place_id}
                className="flex-1 bg-primary text-primary-foreground rounded py-2 text-sm font-medium disabled:opacity-50 touch-manipulation">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Start scrape'}
              </button>
            </div>
          )}
          {msg?.type === 'ok' && (
            <button onClick={onClose} className="w-full border rounded py-2 text-sm touch-manipulation">Close</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CSV Import ────────────────────────────────────────────────

function CsvImportButton({ venueId, onImported }) {
  const api    = useApi()
  const fileRef = useRef()
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    setMsg(null)
    try {
      const qs = venueId ? `?venue_id=${venueId}&platform=manual` : `?platform=manual`
      const json = await api.upload(`/reviews/import-csv${qs}`, file)
      setMsg(`Imported ${json.imported} reviews (${json.skipped} skipped)`)
      onImported?.()
    } catch (e) {
      setMsg('Error: ' + (e.message || 'Import failed'))
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()} disabled={loading}
        className="flex items-center gap-1.5 border rounded px-3 py-2 text-sm touch-manipulation disabled:opacity-50">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Import CSV
      </button>
      {msg && <p className="text-xs mt-1 text-muted-foreground">{msg}</p>}
    </div>
  )
}

// ── Review row ────────────────────────────────────────────────

function ReviewRow({ review, onPatch, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm]   = useState(false)

  return (
    <div className={cn('border rounded-lg p-3 space-y-2', review.is_approved ? '' : 'border-amber-200 bg-amber-50/40')}>
      <div className="flex items-start gap-3">
        {review.reviewer_photo_url && (
          <img src={review.reviewer_photo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{review.reviewer_name || 'Anonymous'}</span>
            <PlatformBadge platform={review.platform} />
            {review.is_featured && <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">Featured</span>}
            {!review.is_approved && <span className="text-[10px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 font-medium">Pending</span>}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Stars n={review.rating} />
            {review.review_date && (
              <span className="text-xs text-muted-foreground">{new Date(review.review_date).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground p-1 touch-manipulation">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {review.review_text && (
        <p className="text-sm text-muted-foreground line-clamp-2">{review.review_text}</p>
      )}

      {expanded && (
        <div className="pt-2 space-y-3 border-t">
          {review.review_text && <p className="text-sm">{review.review_text}</p>}
          {review.reply_text && (
            <div className="bg-muted rounded p-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Business reply</p>
              <p className="text-sm">{review.reply_text}</p>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onPatch({ is_approved: !review.is_approved })}
              className={cn('flex items-center gap-1 text-xs px-2 py-1 rounded border touch-manipulation',
                review.is_approved ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700')}>
              <CheckCircle2 className="w-3 h-3" />
              {review.is_approved ? 'Approved' : 'Approve'}
            </button>
            <button
              onClick={() => onPatch({ is_featured: !review.is_featured })}
              className={cn('flex items-center gap-1 text-xs px-2 py-1 rounded border touch-manipulation',
                review.is_featured ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-border text-muted-foreground')}>
              <Star className="w-3 h-3" />
              {review.is_featured ? 'Featured' : 'Feature'}
            </button>
            {confirm ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-destructive">Delete?</span>
                <button onClick={() => { setConfirm(false); onDelete() }}
                  className="text-xs text-destructive border border-destructive/50 rounded px-2 py-1 touch-manipulation">Yes</button>
                <button onClick={() => setConfirm(false)}
                  className="text-xs border rounded px-2 py-1 touch-manipulation">No</button>
              </div>
            ) : (
              <button onClick={() => setConfirm(true)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-destructive/30 text-destructive touch-manipulation">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Reviews() {
  const api = useApi()
  const qc  = useQueryClient()

  const [venueId,      setVenueId]      = useState('')
  const [platform,     setPlatform]     = useState('')
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [showPending,  setShowPending]  = useState(false)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showScrape,   setShowScrape]   = useState(false)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const reviewsParams = new URLSearchParams()
  if (venueId)    reviewsParams.set('venue_id', venueId)
  if (platform)   reviewsParams.set('platform', platform)
  if (approvedOnly) reviewsParams.set('is_approved', 'true')
  if (showPending)  reviewsParams.set('is_approved', 'false')
  reviewsParams.set('limit', '100')

  const { data: reviews = [], isLoading, refetch } = useQuery({
    queryKey: ['reviews', venueId, platform, approvedOnly, showPending],
    queryFn:  () => api.get('/reviews?' + reviewsParams.toString()),
    staleTime: 30_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['reviews-stats', venueId],
    queryFn:  () => api.get('/reviews/stats' + (venueId ? `?venue_id=${venueId}` : '')),
    staleTime: 30_000,
  })

  const { data: scrapeJobs = [] } = useQuery({
    queryKey: ['review-scrape-jobs', venueId],
    queryFn:  () => api.get('/reviews/scrape-jobs' + (venueId ? `?venue_id=${venueId}` : '')),
    staleTime: 15_000,
    refetchInterval: (data) =>
      (data ?? []).some(j => j.status === 'running' || j.status === 'pending') ? 10_000 : false,
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, ...patch }) => api.patch(`/reviews/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/reviews/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  })

  const bulkApproveMutation = useMutation({
    mutationFn: ({ ids, is_approved }) => api.post('/reviews/bulk-approve', { ids, is_approved }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reviews'] }); qc.invalidateQueries({ queryKey: ['reviews-stats'] }) },
  })

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['reviews'] })
    qc.invalidateQueries({ queryKey: ['reviews-stats'] })
    qc.invalidateQueries({ queryKey: ['review-scrape-jobs'] })
  }, [qc])

  const pendingIds = reviews.filter(r => !r.is_approved).map(r => r.id)

  const latestJob = scrapeJobs[0]

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold">Reviews</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refetch()} className="p-2 border rounded touch-manipulation" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowScrape(true)}
            className="flex items-center gap-1.5 border rounded px-3 py-2 text-sm touch-manipulation">
            <Globe className="w-4 h-4" /> Scrape Google
          </button>
          <CsvImportButton venueId={venueId || null} onImported={invalidateAll} />
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded px-3 py-2 text-sm font-medium touch-manipulation">
            <Plus className="w-4 h-4" /> Add review
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Approved" value={stats.approved} color="text-emerald-600" />
          <StatCard label="Pending" value={stats.pending} color="text-amber-600" />
          <StatCard label="Avg. rating" value={stats.avg_rating ? `${stats.avg_rating} ★` : '—'} color="text-amber-500" />
        </div>
      )}

      {/* Scrape job status */}
      {latestJob && (
        <div className={cn('rounded-lg p-3 text-sm flex items-center gap-2',
          latestJob.status === 'done'    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          latestJob.status === 'failed'  ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          'bg-blue-50 text-blue-700 border border-blue-200')}>
          {latestJob.status === 'running' || latestJob.status === 'pending'
            ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
          <span>
            Last scrape: <strong>{latestJob.status}</strong>
            {latestJob.result_count ? ` — ${latestJob.result_count} reviews` : ''}
            {latestJob.error_message ? ` (${latestJob.error_message})` : ''}
            {latestJob.finished_at ? ` · ${new Date(latestJob.finished_at).toLocaleString()}` : ''}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select className="border rounded px-2 py-1.5 text-sm bg-background"
          value={venueId} onChange={e => setVenueId(e.target.value)}>
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className="border rounded px-2 py-1.5 text-sm bg-background"
          value={platform} onChange={e => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <button onClick={() => { setApprovedOnly(false); setShowPending(false) }}
          className={cn('px-2 py-1.5 text-sm rounded border touch-manipulation', !approvedOnly && !showPending ? 'bg-primary text-primary-foreground' : '')}>
          All
        </button>
        <button onClick={() => { setApprovedOnly(true); setShowPending(false) }}
          className={cn('px-2 py-1.5 text-sm rounded border touch-manipulation', approvedOnly ? 'bg-emerald-600 text-white' : '')}>
          Approved
        </button>
        <button onClick={() => { setShowPending(true); setApprovedOnly(false) }}
          className={cn('px-2 py-1.5 text-sm rounded border touch-manipulation', showPending ? 'bg-amber-500 text-white' : '')}>
          Pending {stats?.pending ? `(${stats.pending})` : ''}
        </button>
        {pendingIds.length > 0 && (
          <button
            onClick={() => bulkApproveMutation.mutate({ ids: pendingIds, is_approved: true })}
            className="ml-auto text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 touch-manipulation">
            Approve all pending
          </button>
        )}
      </div>

      {/* Review list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12 space-y-3 text-muted-foreground">
          <MessageSquare className="w-10 h-10 mx-auto opacity-30" />
          <p className="text-sm">No reviews yet. Add one manually, import a CSV, or scrape from Google.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reviews.map(r => (
            <ReviewRow
              key={r.id}
              review={r}
              onPatch={(patch) => patchMutation.mutate({ id: r.id, ...patch })}
              onDelete={() => deleteMutation.mutate(r.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddReviewModal
          venueId={venueId || null}
          onClose={() => setShowAdd(false)}
          onSaved={invalidateAll}
        />
      )}
      {showScrape && (
        <ScrapeModal
          venues={venues}
          onClose={() => setShowScrape(false)}
          onStarted={invalidateAll}
        />
      )}
    </div>
  )
}
