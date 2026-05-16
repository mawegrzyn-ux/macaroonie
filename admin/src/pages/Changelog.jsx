// src/pages/Changelog.jsx
//
// Platform changelog — platform admins write, all tenants read.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, Eye, EyeOff } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── Constants ─────────────────────────────────────────────────

const TYPE_BADGE = {
  feature:     'bg-blue-100 text-blue-800',
  fix:         'bg-green-100 text-green-800',
  improvement: 'bg-cyan-100 text-cyan-800',
  security:    'bg-red-100 text-red-800',
  breaking:    'bg-orange-100 text-orange-800',
  maintenance: 'bg-slate-100 text-slate-700',
}

const TYPE_LABELS = {
  feature:     'Feature',
  fix:         'Fix',
  improvement: 'Improvement',
  security:    'Security',
  breaking:    'Breaking',
  maintenance: 'Maintenance',
}

const TYPES = ['feature', 'fix', 'improvement', 'security', 'breaking', 'maintenance']

function Badge({ children, className }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', className)}>
      {children}
    </span>
  )
}

// ── Simple markdown renderer ──────────────────────────────────

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-xl mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[\s\S]+?<\/li>)/g, '<ul class="my-2">$1</ul>')
    .replace(/\n/g, '<br>')
}

// ── Entry editor panel ────────────────────────────────────────

function EntryEditor({ entry, onSave, onDelete, onPublish, onUnpublish, isSaving, isDeleting }) {
  const [title,   setTitle]   = useState(entry?.title   ?? '')
  const [version, setVersion] = useState(entry?.version ?? '')
  const [type,    setType]    = useState(entry?.type    ?? 'feature')
  const [body,    setBody]    = useState(entry?.body    ?? '')
  const [confirmDel, setConfirmDel] = useState(false)

  const isPublished = entry?.is_published ?? false

  function handleSave() {
    if (!title.trim()) return
    onSave({
      title:   title.trim(),
      version: version.trim() || null,
      type,
      body:    body.trim() || null,
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Title *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
          placeholder="Release title"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Version</label>
          <input
            value={version}
            onChange={e => setVersion(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
            placeholder="e.g. 2.4.0"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
          >
            {TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Body (Markdown supported)</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={12}
          className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none font-mono"
          placeholder="## What changed&#10;&#10;- Added feature X&#10;- Fixed bug Y&#10;&#10;**Note:** Breaking change for…"
        />
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={isSaving || !title.trim()}
          className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        {entry && !isPublished && (
          <button
            onClick={onPublish}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 border border-green-500 text-green-700 rounded text-sm font-medium touch-manipulation min-h-[44px] hover:bg-green-50 disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            Publish
          </button>
        )}
        {entry && isPublished && (
          <button
            onClick={onUnpublish}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 border text-muted-foreground rounded text-sm touch-manipulation min-h-[44px] hover:bg-accent disabled:opacity-50"
          >
            <EyeOff className="w-4 h-4" />
            Unpublish
          </button>
        )}
        {entry && (
          confirmDel ? (
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium touch-manipulation min-h-[44px]"
            >
              Confirm delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="p-2 text-red-500 hover:bg-red-50 rounded touch-manipulation min-h-[44px]"
              title="Delete entry"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )
        )}
      </div>
    </div>
  )
}

// ── Entry list item ───────────────────────────────────────────

function EntryItem({ entry, isSelected, onClick, isPlatformAdmin }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'border rounded-xl p-4 space-y-2 cursor-pointer touch-manipulation transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
      )}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <Badge className={TYPE_BADGE[entry.type]}>{TYPE_LABELS[entry.type]}</Badge>
        {isPlatformAdmin && !entry.is_published && (
          <Badge className="bg-yellow-100 text-yellow-800">Draft</Badge>
        )}
        {entry.version && (
          <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            v{entry.version}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {entry.published_at
            ? format(new Date(entry.published_at), 'd MMM yyyy')
            : format(new Date(entry.created_at), 'd MMM yyyy')}
        </span>
      </div>
      <h3 className="font-medium text-sm leading-snug">{entry.title}</h3>
      {entry.body && (
        <div
          className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Changelog() {
  const api         = useApi()
  const queryClient = useQueryClient()

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })

  const [selected,    setSelected]    = useState(null)  // entry being edited (null = new)
  const [showEditor,  setShowEditor]  = useState(false)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['changelog'],
    queryFn:  () => api.get('/changelog'),
    enabled:  !!me,
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/changelog', body),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['changelog'] })
      setSelected(data)
    },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/changelog/${id}`, body),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['changelog'] })
      setSelected(data)
    },
  })

  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/changelog/${id}`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['changelog'] })
      setSelected(null)
      setShowEditor(false)
    },
  })

  const publishMut = useMutation({
    mutationFn: id => api.patch(`/changelog/${id}/publish`),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['changelog'] })
      setSelected(data)
    },
  })

  const unpublishMut = useMutation({
    mutationFn: id => api.patch(`/changelog/${id}`, { is_published: false }),
    onSuccess:  (data) => {
      queryClient.invalidateQueries({ queryKey: ['changelog'] })
      setSelected(data)
    },
  })

  const isPlatformAdmin = me?.is_platform_admin ?? false

  function handleSave(body) {
    if (selected) {
      patchMut.mutate({ id: selected.id, ...body })
    } else {
      createMut.mutate(body)
    }
  }

  const isSaving = createMut.isPending || patchMut.isPending || publishMut.isPending || unpublishMut.isPending

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{"What's new"}</h1>
        {isPlatformAdmin && (
          <button
            onClick={() => { setSelected(null); setShowEditor(true) }}
            className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            New entry
          </button>
        )}
      </div>

      <div className={cn(
        'grid gap-6',
        isPlatformAdmin && showEditor ? 'lg:grid-cols-[1fr_420px]' : 'lg:grid-cols-1 max-w-3xl',
      )}>
        {/* Entry list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-sm">
              No changelog entries yet.
              {isPlatformAdmin && " Click \"New entry\" to create one."}
            </div>
          ) : entries.map(entry => (
            <EntryItem
              key={entry.id}
              entry={entry}
              isSelected={selected?.id === entry.id}
              isPlatformAdmin={isPlatformAdmin}
              onClick={() => {
                setSelected(entry)
                if (isPlatformAdmin) setShowEditor(true)
              }}
            />
          ))}
        </div>

        {/* Editor panel (platform admin only) */}
        {isPlatformAdmin && showEditor && (
          <div className="lg:sticky lg:top-6 h-fit border rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">
                {selected ? 'Edit entry' : 'New entry'}
              </h2>
              <button
                onClick={() => { setShowEditor(false); setSelected(null) }}
                className="p-1.5 rounded hover:bg-accent touch-manipulation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <EntryEditor
              key={selected?.id ?? 'new'}
              entry={selected}
              onSave={handleSave}
              onDelete={() => selected && deleteMut.mutate(selected.id)}
              onPublish={() => selected && publishMut.mutate(selected.id)}
              onUnpublish={() => selected && unpublishMut.mutate(selected.id)}
              isSaving={isSaving}
              isDeleting={deleteMut.isPending}
            />
          </div>
        )}
      </div>
    </div>
  )
}
