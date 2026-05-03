// src/components/media/MediaLibrary.jsx
//
// Per-tenant media library modal. Two modes:
//
//   <MediaLibraryModal open={...} onClose={...}
//                      mode="picker"
//                      scope="website:hero"     // default upload scope
//                      onPick={url => ...} />   // picker mode: callback receives URL
//
//   <MediaLibraryModal open={...} onClose={...} mode="manager" />
//
// Spec: see "Epic: Media Library" in the project notes.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Upload, Maximize2, Minimize2, Search, Plus, Folder, Image as ImageIcon,
  Trash2, Tag, MoveRight, Loader2, Check, AlertTriangle, Pencil, Edit3,
  LayoutGrid, List, ChevronDown,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ImageEditor } from './ImageEditor'

const ALL_FORMS = '__all__'
const NO_CATEGORY = '__none__'

export function MediaLibraryModal({
  open, onClose,
  mode = 'manager',         // 'picker' | 'manager'
  scope: defaultScope = 'shared',
  onPick,
  multiPick = false,
}) {
  const api = useApi()
  const qc  = useQueryClient()

  const [fullscreen, setFullscreen]   = useState(false)
  const [view, setView]               = useState('grid')           // 'grid' | 'list'
  const [search, setSearch]           = useState('')
  const [scopeFilter, setScopeFilter] = useState(ALL_FORMS)        // ALL_FORMS | 'shared' | '<form_key>'
  const [categoryFilter, setCategory] = useState(null)             // null = all, NO_CATEGORY = uncategorized, uuid = specific
  const [uploadCategoryId, setUploadCategoryId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [uploads, setUploads]         = useState([])               // [{ id, name, status: 'uploading'|'done'|'error', error? }]
  const [duplicateConflict, setDuplicateConflict] = useState(null) // { file, existing[], onResolve }
  const [dragActive, setDragActive]   = useState(false)
  const [detailWidth, setDetailWidth] = useState(360)
  const [editorItem, setEditorItem]   = useState(null)             // item being edited, or null
  const dragCounter = useRef(0)
  const fileInputRef = useRef(null)

  // Reset state on open
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set())
      setSearch('')
      setUploads([])
      setDuplicateConflict(null)
    }
  }, [open])

  // ESC closes
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Queries
  const { data: categories = [] } = useQuery({
    queryKey: ['media-categories'],
    queryFn:  () => api.get('/media/categories'),
    enabled:  open,
  })
  const { data: scopes = ['shared'] } = useQuery({
    queryKey: ['media-scopes'],
    queryFn:  () => api.get('/media/items/scopes'),
    enabled:  open,
  })
  const itemsQueryKey = ['media-items', { scopeFilter, categoryFilter }]
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: itemsQueryKey,
    queryFn:  () => {
      const params = new URLSearchParams()
      if (scopeFilter !== ALL_FORMS) params.set('scope', scopeFilter)
      if (categoryFilter === NO_CATEGORY)    params.set('category_id', 'none')
      else if (categoryFilter)               params.set('category_id', categoryFilter)
      return api.get(`/media/items?${params.toString()}`)
    },
    enabled:  open,
    staleTime: 5_000,
  })

  // Client-side search filter
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(i => i.filename.toLowerCase().includes(q))
  }, [items, search])

  const selected = useMemo(() => items.filter(i => selectedIds.has(i.id)), [items, selectedIds])
  const singleSelected = selected.length === 1 ? selected[0] : null

  // ── Mutations ──────────────────────────────────────────
  const createCategory = useMutation({
    mutationFn: (name) => api.post('/media/categories', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-categories'] }),
  })
  const renameCategory = useMutation({
    mutationFn: ({ id, name }) => api.patch(`/media/categories/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-categories'] }),
  })
  const deleteCategory = useMutation({
    mutationFn: (id) => api.delete(`/media/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media-categories'] })
      qc.invalidateQueries({ queryKey: ['media-items'] })
    },
  })
  const patchItem = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/media/items/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-items'] }),
  })
  const deleteItem = useMutation({
    mutationFn: (id) => api.delete(`/media/items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media-items'] })
      qc.invalidateQueries({ queryKey: ['media-categories'] })
    },
  })
  const bulkAction = useMutation({
    mutationFn: (body) => api.post('/media/items/bulk', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media-items'] })
      qc.invalidateQueries({ queryKey: ['media-categories'] })
    },
  })

  // ── Upload pipeline ────────────────────────────────────
  const sha256OfFile = useCallback(async (file) => {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  }, [])

  const performUpload = useCallback(async (file, scope, categoryId) => {
    const tmpId = crypto.randomUUID()
    setUploads(u => [...u, { id: tmpId, name: file.name, status: 'uploading' }])

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('scope', scope)
      if (categoryId) fd.append('category_id', categoryId)

      const data = await api.upload('/media/items/upload', file, { scope, ...(categoryId ? { category_id: categoryId } : {}) })
      setUploads(u => u.map(x => x.id === tmpId ? { ...x, status: 'done', itemId: data.id } : x))
      qc.invalidateQueries({ queryKey: ['media-items'] })
      qc.invalidateQueries({ queryKey: ['media-scopes'] })
      // Auto-clear chip after 2s
      setTimeout(() => setUploads(u => u.filter(x => x.id !== tmpId)), 2000)
    } catch (err) {
      setUploads(u => u.map(x => x.id === tmpId ? { ...x, status: 'error', error: err?.body?.error || err.message } : x))
      setTimeout(() => setUploads(u => u.filter(x => x.id !== tmpId)), 6000)
    }
  }, [api, qc])

  const handleFiles = useCallback(async (files) => {
    const list = Array.from(files || []).filter(f => f.type.startsWith('image/'))
    if (!list.length) return

    const targetScope = scopeFilter === ALL_FORMS ? defaultScope : scopeFilter

    for (const file of list) {
      // Pre-upload duplicate check (filename + hash within scope)
      let hash = null
      try { hash = await sha256OfFile(file) } catch { /* large files OK without hash */ }
      let existing = []
      try {
        existing = await api.post('/media/items/check-duplicate', {
          filename: file.name, hash, scope: targetScope,
        })
      } catch { /* if check fails, proceed with upload */ }

      if (existing.length > 0) {
        const choice = await new Promise(resolve => {
          setDuplicateConflict({
            file, existing,
            onResolve: (action) => { setDuplicateConflict(null); resolve(action) },
          })
        })
        if (choice === 'cancel') continue
        if (choice === 'replace') {
          // Best-effort: delete existing then upload
          for (const e of existing) {
            await deleteItem.mutateAsync(e.id).catch(() => {})
          }
        }
        // 'keep-both' falls through to plain upload
      }

      await performUpload(file, targetScope, uploadCategoryId)
    }
  }, [api, defaultScope, scopeFilter, uploadCategoryId, sha256OfFile, performUpload, deleteItem])

  // ── Drag-and-drop ──────────────────────────────────────
  const onDragEnter = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    if (dragCounter.current === 0) setDragActive(true)
    dragCounter.current += 1
  }, [])
  const onDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragActive(false) }
  }, [])
  const onDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation() }, [])
  const onDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    setDragActive(false)
    dragCounter.current = 0
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  // ── Detail panel resize ───────────────────────────────
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = detailWidth
    const move = (ev) => {
      const w = Math.max(280, Math.min(700, startW + (startX - ev.clientX)))
      setDetailWidth(w)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [detailWidth])

  // ── Selection handlers ────────────────────────────────
  const toggleSelect = (id, additive) => {
    setSelectedIds(prev => {
      const next = additive ? new Set(prev) : new Set()
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())
  const selectOnly = (id) => setSelectedIds(new Set([id]))

  if (!open) return null

  const containerClass = fullscreen
    ? 'fixed inset-0 bg-background flex flex-col z-50'
    : 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4'
  const panelClass = fullscreen
    ? 'flex-1 flex flex-col overflow-hidden'
    : 'bg-background rounded-xl shadow-2xl flex flex-col w-full max-w-[1400px] h-[85vh] overflow-hidden'

  return (
    <div className={containerClass}
      onDragEnter={onDragEnter} onDragOver={onDragOver}
      onDragLeave={onDragLeave} onDrop={onDrop}
    >
      <div className={panelClass} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 px-5 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold">Media library</h2>
            {defaultScope !== 'shared' && mode === 'picker' && (
              <span className="ml-3 text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Form: <span className="font-mono">{defaultScope}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="p-2 rounded hover:bg-accent">
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} title="Close" className="p-2 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Sidebar */}
          <aside className="w-64 border-r flex flex-col overflow-hidden shrink-0">
            <div className="p-3 space-y-3 overflow-y-auto flex-1">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search filenames…"
                  className="w-full pl-8 pr-2 py-2 text-sm border rounded-md bg-background min-h-[36px] touch-manipulation" />
              </div>

              <div>
                <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">Form filter</p>
                <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
                  className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
                  <option value={ALL_FORMS}>All forms</option>
                  {scopes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <CategoriesList
                categories={categories}
                active={categoryFilter}
                onSelect={setCategory}
                onCreate={(name) => createCategory.mutate(name)}
                onRename={(id, name) => renameCategory.mutate({ id, name })}
                onDelete={(id) => {
                  if (window.confirm('Delete this category? Items will become uncategorized.')) deleteCategory.mutate(id)
                }}
              />

              <div className="border-t pt-3">
                <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">Upload to</p>
                <select value={uploadCategoryId ?? ''} onChange={e => setUploadCategoryId(e.target.value || null)}
                  className="w-full text-sm border rounded-md px-2 py-1.5 bg-background mb-2">
                  <option value="">No category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden
                  onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-md px-3 py-2 min-h-[40px] touch-manipulation">
                  <Upload className="w-4 h-4" /> Upload
                </button>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Or drag images onto the modal.
                </p>
              </div>
            </div>
          </aside>

          {/* Main */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="h-12 border-b px-4 flex items-center justify-between shrink-0">
              <div className="text-xs text-muted-foreground">
                {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
                {selectedIds.size > 0 && (
                  <span> · <button onClick={clearSelection} className="text-primary hover:underline">{selectedIds.size} selected (clear)</button></span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setView('grid')} title="Grid"
                  className={cn('p-2 rounded', view === 'grid' ? 'bg-accent' : 'hover:bg-accent/50')}>
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button onClick={() => setView('list')} title="List"
                  className={cn('p-2 rounded', view === 'list' ? 'bg-accent' : 'hover:bg-accent/50')}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Upload chips */}
            {uploads.length > 0 && (
              <div className="px-4 py-2 border-b flex flex-wrap gap-2">
                {uploads.map(u => (
                  <span key={u.id} className={cn(
                    'inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1',
                    u.status === 'uploading' ? 'bg-muted text-muted-foreground'
                    : u.status === 'done'    ? 'bg-emerald-100 text-emerald-700'
                    :                           'bg-rose-100 text-rose-700'
                  )}>
                    {u.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {u.status === 'done'      && <Check className="w-3 h-3" />}
                    {u.status === 'error'     && <AlertTriangle className="w-3 h-3" />}
                    <span className="truncate max-w-[160px]">{u.name}</span>
                    {u.error && <span className="ml-1 italic" title={u.error}>{u.error.slice(0, 40)}</span>}
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {itemsLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-12 text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No items match the current filter.</p>
                  <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-sm text-primary hover:underline">
                    Upload your first image
                  </button>
                </div>
              ) : view === 'grid' ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                  {filteredItems.map(item => (
                    <ItemThumb key={item.id} item={item}
                      selected={selectedIds.has(item.id)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) toggleSelect(item.id, true)
                        else selectOnly(item.id)
                      }}
                      onCheckbox={() => toggleSelect(item.id, true)}
                    />
                  ))}
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Filename</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Scope</th>
                        <th className="px-3 py-2 text-right">Size</th>
                        <th className="px-3 py-2">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(item => (
                        <tr key={item.id}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey) toggleSelect(item.id, true)
                            else selectOnly(item.id)
                          }}
                          className={cn('border-t cursor-pointer hover:bg-accent/40',
                            selectedIds.has(item.id) && 'bg-primary/10')}>
                          <td className="px-3 py-1.5"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id, true)} onClick={(e) => e.stopPropagation()} /></td>
                          <td className="px-3 py-1.5 truncate max-w-xs">{item.filename}</td>
                          <td className="px-3 py-1.5">{item.category_name || '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{item.scope}</td>
                          <td className="px-3 py-1.5 text-right">{(item.bytes / 1024).toFixed(0)} KB</td>
                          <td className="px-3 py-1.5">{new Date(item.created_at).toLocaleDateString('en-GB')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          <div className="border-l flex shrink-0 relative" style={{ width: detailWidth }}>
            <div onMouseDown={onResizeStart}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30" />
            <div className="flex-1 overflow-y-auto">
              {selected.length === 0 ? (
                <DetailEmpty />
              ) : selected.length === 1 ? (
                <DetailSingle item={singleSelected}
                  categories={categories}
                  scopes={scopes}
                  onPatch={(body) => patchItem.mutate({ id: singleSelected.id, body })}
                  onEdit={() => setEditorItem(singleSelected)}
                  onDelete={() => {
                    if (window.confirm(`Delete "${singleSelected.filename}"? This cannot be undone.`)) {
                      deleteItem.mutate(singleSelected.id, { onSuccess: clearSelection })
                    }
                  }}
                />
              ) : (
                <DetailMulti count={selected.length}
                  categories={categories}
                  scopes={scopes}
                  onMoveCategory={(id) => bulkAction.mutate({ action: 'move-category', ids: [...selectedIds], category_id: id })}
                  onMoveScope={(scope) => bulkAction.mutate({ action: 'move-scope', ids: [...selectedIds], scope })}
                  onDelete={() => {
                    if (window.confirm(`Delete ${selected.length} item${selected.length !== 1 ? 's' : ''}?`)) {
                      bulkAction.mutate({ action: 'delete', ids: [...selectedIds] }, { onSuccess: clearSelection })
                    }
                  }}
                />
              )}
            </div>
          </div>

          {/* Drop overlay */}
          {dragActive && (
            <div className="absolute inset-0 bg-primary/10 border-4 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none">
              <div className="bg-background rounded-lg px-6 py-4 shadow-lg">
                <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium">Drop images to upload</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-14 px-5 border-t flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Close</button>
          {mode === 'picker' && (
            <button
              disabled={selected.length !== 1 || !singleSelected}
              onClick={() => { if (singleSelected) { onPick?.(singleSelected.url, singleSelected); onClose() } }}
              className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] disabled:opacity-50">
              Insert selected
            </button>
          )}
        </div>

        {/* Duplicate conflict dialog */}
        {duplicateConflict && (
          <DuplicateDialog conflict={duplicateConflict} />
        )}
      </div>

      {/* Image editor — overlays the whole library modal when active */}
      {editorItem && (
        <ImageEditor item={editorItem}
          onClose={() => setEditorItem(null)}
          onSaved={(saved, mode) => {
            // After save, point selection at the resulting item so the
            // detail panel updates immediately.
            setSelectedIds(new Set([saved.id]))
            setEditorItem(null)
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────

function CategoriesList({ categories, active, onSelect, onCreate, onRename, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)

  return (
    <div>
      <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">Categories</p>
      <div className="space-y-0.5">
        <CatRow active={active === null} onClick={() => onSelect(null)} icon={<Folder className="w-3.5 h-3.5" />}>
          All media
        </CatRow>
        <CatRow active={active === NO_CATEGORY} onClick={() => onSelect(NO_CATEGORY)} icon={<Folder className="w-3.5 h-3.5 opacity-50" />}>
          No category
        </CatRow>
        {categories.map(c => (
          <CatRow key={c.id} active={active === c.id} onClick={() => onSelect(c.id)} icon={<Tag className="w-3.5 h-3.5" />}
            onRename={(newName) => onRename(c.id, newName)} onDelete={() => onDelete(c.id)}
            count={c.item_count}>
            {c.name}
          </CatRow>
        ))}
      </div>
      {creating ? (
        <div className="flex items-center gap-1 mt-1.5">
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="Category name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); setCreating(false) }
              if (e.key === 'Escape') { setCreating(false); setName('') }
            }}
            className="flex-1 text-xs border rounded-md px-2 py-1" />
        </div>
      ) : (
        <button onClick={() => setCreating(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="w-3 h-3" /> New category
        </button>
      )}
    </div>
  )
}

function CatRow({ active, onClick, icon, children, onRename, onDelete, count }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(typeof children === 'string' ? children : '')
  if (editing) {
    return (
      <input autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) { onRename?.(name.trim()); setEditing(false) }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => setEditing(false)}
        className="w-full text-xs border rounded-md px-2 py-1" />
    )
  }
  return (
    <button onClick={onClick}
      className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left group',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {count != null && <span className={cn('text-[10px]', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{count}</span>}
      {onRename && (
        <span className={cn('opacity-0 group-hover:opacity-100 inline-flex gap-0.5', active && 'opacity-100')}>
          <span onClick={(e) => { e.stopPropagation(); setEditing(true) }} className="hover:text-primary cursor-pointer p-0.5"><Pencil className="w-3 h-3" /></span>
          <span onClick={(e) => { e.stopPropagation(); onDelete?.() }} className="hover:text-destructive cursor-pointer p-0.5"><Trash2 className="w-3 h-3" /></span>
        </span>
      )}
    </button>
  )
}

function ItemThumb({ item, selected, onClick, onCheckbox }) {
  return (
    <button onClick={onClick}
      className={cn('group relative aspect-square rounded-md overflow-hidden border-2 transition-all',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-muted-foreground/40')}>
      <img src={item.url} alt={item.filename} loading="lazy"
        className="absolute inset-0 w-full h-full object-cover bg-muted" />
      <span onClick={(e) => { e.stopPropagation(); onCheckbox() }}
        className={cn('absolute top-1 left-1 w-5 h-5 rounded border-2 bg-background/80 flex items-center justify-center transition-opacity',
          selected ? 'opacity-100 border-primary' : 'opacity-0 group-hover:opacity-100 border-muted-foreground')}>
        {selected && <Check className="w-3 h-3 text-primary" />}
      </span>
      <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] px-1.5 py-1 truncate">
        {item.filename}
      </span>
      {item.scope !== 'shared' && (
        <span className="absolute top-1 right-1 text-[9px] bg-background/80 rounded px-1 py-0.5 font-mono">{item.scope}</span>
      )}
    </button>
  )
}

function DetailEmpty() {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p className="text-sm">Select an item to see details.</p>
    </div>
  )
}

function DetailSingle({ item, categories, scopes, onPatch, onEdit, onDelete }) {
  const [filename, setFilename] = useState(item.filename)
  useEffect(() => setFilename(item.filename), [item.id, item.filename])

  return (
    <div className="p-4 space-y-4">
      <div className="aspect-square rounded-md overflow-hidden bg-muted">
        <img src={item.url} alt={item.filename} className="w-full h-full object-contain" />
      </div>

      <div>
        <label className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">Filename</label>
        <div className="flex gap-1">
          <input value={filename} onChange={e => setFilename(e.target.value)}
            className="flex-1 text-sm border rounded-md px-2 py-1.5 min-h-[36px]" />
          {filename !== item.filename && (
            <button onClick={() => onPatch({ filename })}
              className="text-xs text-primary px-2">Save</button>
          )}
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">Category</label>
        <select value={item.category_id ?? ''}
          onChange={e => onPatch({ category_id: e.target.value || null })}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="">No category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">Scope</label>
        <select value={item.scope}
          onChange={e => onPatch({ scope: e.target.value })}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          {scopes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="text-[10px] text-muted-foreground mt-0.5">Move to <span className="font-mono">shared</span> to reuse across forms.</p>
      </div>

      <dl className="text-xs text-muted-foreground space-y-1 border-t pt-3">
        <div className="flex justify-between"><dt>Dimensions</dt><dd>{item.width && item.height ? `${item.width}×${item.height}` : '—'}</dd></div>
        <div className="flex justify-between"><dt>Size</dt><dd>{(item.bytes / 1024).toFixed(0)} KB</dd></div>
        <div className="flex justify-between"><dt>Type</dt><dd className="font-mono">{item.mimetype}</dd></div>
        <div className="flex justify-between"><dt>Uploaded</dt><dd>{new Date(item.created_at).toLocaleDateString('en-GB')}</dd></div>
      </dl>

      <div className="border-t pt-3 flex flex-col gap-2">
        <button onClick={onEdit}
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm border rounded-md px-3 py-2 min-h-[36px] hover:bg-accent">
          <Edit3 className="w-3.5 h-3.5" /> Edit image
        </button>
        <button onClick={onDelete}
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm border border-destructive text-destructive rounded-md px-3 py-2 min-h-[36px] hover:bg-destructive/10">
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    </div>
  )
}

function DetailMulti({ count, categories, scopes, onMoveCategory, onMoveScope, onDelete }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-sm font-medium">{count} item{count !== 1 ? 's' : ''} selected</p>
      <div>
        <label className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">Move to category</label>
        <select onChange={e => { if (e.target.value !== 'noop') onMoveCategory(e.target.value === '' ? null : e.target.value); e.target.value = 'noop' }}
          defaultValue="noop"
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="noop" disabled>Choose a category…</option>
          <option value="">No category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide block mb-1">Move to scope</label>
        <select onChange={e => { if (e.target.value !== 'noop') onMoveScope(e.target.value); e.target.value = 'noop' }}
          defaultValue="noop"
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="noop" disabled>Choose a scope…</option>
          {scopes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <button onClick={onDelete}
        className="inline-flex items-center justify-center gap-1.5 w-full text-sm border border-destructive text-destructive rounded-md px-3 py-2 min-h-[36px] hover:bg-destructive/10">
        <Trash2 className="w-3.5 h-3.5" /> Delete all
      </button>
    </div>
  )
}

function DuplicateDialog({ conflict }) {
  const { file, existing, onResolve } = conflict
  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
      <div className="bg-background rounded-lg shadow-2xl max-w-md w-full m-4 p-5">
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" /> Possible duplicate
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          A file with the same name {existing.some(e => e.id) ? '(or contents)' : ''} already exists in this scope:
        </p>
        <ul className="text-xs space-y-1 mb-4 max-h-32 overflow-y-auto bg-muted/30 rounded p-2">
          {existing.map(e => <li key={e.id} className="font-mono">{e.filename}</li>)}
        </ul>
        <p className="text-xs text-muted-foreground mb-3">Uploading: <span className="font-mono">{file.name}</span></p>
        <div className="flex justify-end gap-2 text-sm">
          <button onClick={() => onResolve('cancel')} className="px-3 py-1.5 text-muted-foreground">Cancel</button>
          <button onClick={() => onResolve('keep-both')} className="px-3 py-1.5 border rounded-md hover:bg-accent">Keep both</button>
          <button onClick={() => onResolve('replace')} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md">Replace</button>
        </div>
      </div>
    </div>
  )
}
