// src/pages/Launcher.jsx
//
// Quick-access launcher — the alternative to the sidebar tree when a
// tenant sets nav_style = 'launcher' (Navigation designer → Launcher).
// Admin defines the default tile set + order via nav_items.show_in_launcher
// (see nav.js / NavDesigner.jsx); each user can then reorder / hide tiles
// for themselves, persisted to localStorage only — matching the existing
// per-viewer preference pattern (maca_settings, maca_timeline_prefs)
// rather than a DB table. "Reset to defaults" just clears the override.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LayoutGrid, Pencil, Check, X, RotateCcw, GripVertical, Compass, PanelLeft } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

function resolveIcon(name) {
  return LucideIcons[name] || LucideIcons.Circle
}

function prefsKey(tenantId) {
  return `maca_launcher_prefs_${tenantId || 'none'}`
}

function loadPrefs(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(prefsKey(tenantId)) ?? '{}')
  } catch {
    return {}
  }
}

// Merge the admin-defined default tile list with the viewer's own order/
// hidden overrides. Tiles the admin removed (or the viewer no longer has
// access to) are dropped even if they're still named in the override.
function applyPrefs(tiles, prefs) {
  const byId = new Map(tiles.map(t => [t.id, t]))
  const order = (prefs.order || []).filter(id => byId.has(id))
  const rest  = tiles.filter(t => !order.includes(t.id)).map(t => t.id)
  const hidden = new Set(prefs.hidden || [])
  return [...order, ...rest].map(id => byId.get(id)).filter(t => !hidden.has(t.id))
}

export default function Launcher() {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })

  const tenantId = me?.current_tenant?.id
  const canManageNav = me?.permissions?.nav_designer === 'manage' || me?.is_platform_admin
  const defaultTiles = me?.launcher_tiles ?? []

  const setStyle = useMutation({
    mutationFn: (nav_style) => api.patch('/nav/style', { nav_style }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const [prefs, setPrefs] = useState(() => loadPrefs(tenantId))
  const [editMode, setEditMode] = useState(false)

  // Re-load prefs if the tenant switches under us.
  useEffect(() => { setPrefs(loadPrefs(tenantId)) }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    try { localStorage.setItem(prefsKey(tenantId), JSON.stringify(prefs)) } catch {}
  }, [prefs, tenantId])

  const tiles = useMemo(() => applyPrefs(defaultTiles, prefs), [defaultTiles, prefs])
  const hiddenTiles = useMemo(
    () => defaultTiles.filter(t => (prefs.hidden || []).includes(t.id)),
    [defaultTiles, prefs],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = tiles.findIndex(t => t.id === active.id)
    const newIdx = tiles.findIndex(t => t.id === over.id)
    const reordered = arrayMove(tiles, oldIdx, newIdx)
    setPrefs(p => ({ ...p, order: reordered.map(t => t.id) }))
  }

  function hideTile(id) {
    setPrefs(p => ({ ...p, hidden: [...new Set([...(p.hidden || []), id])] }))
  }

  function unhideTile(id) {
    setPrefs(p => ({ ...p, hidden: (p.hidden || []).filter(x => x !== id) }))
  }

  function resetToDefaults() {
    setPrefs({})
    if (tenantId) { try { localStorage.removeItem(prefsKey(tenantId)) } catch {} }
    setEditMode(false)
  }

  if (isLoading) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2"><LayoutGrid className="w-4 h-4" /> Quick access</h1>
          <p className="text-xs text-muted-foreground">Your shortcuts — drag to reorder, hide what you don't need</p>
        </div>
        <div className="flex items-center gap-2">
          {canManageNav && me?.current_tenant?.nav_style === 'launcher' && (
            <button onClick={() => setStyle.mutate('sidebar')} disabled={setStyle.isPending}
              title="Bring back the full sidebar menu for everyone in this tenant"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground touch-manipulation min-h-[40px] px-3 py-2 rounded-md border hover:bg-accent hover:text-foreground disabled:opacity-50">
              <PanelLeft className="w-3.5 h-3.5" /> Back to full menu
            </button>
          )}
          {editMode ? (
            <button onClick={() => setEditMode(false)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary touch-manipulation min-h-[40px] px-3 py-2 rounded-md hover:bg-primary/10">
              <Check className="w-4 h-4" /> Done
            </button>
          ) : (
            <button onClick={() => setEditMode(true)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground touch-manipulation min-h-[40px] px-3 py-2 rounded-md hover:bg-accent hover:text-foreground">
              <Pencil className="w-3.5 h-3.5" /> Customise
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {defaultTiles.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <LayoutGrid className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">No quick-access tiles have been set up yet.</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Tiles come from the Navigation designer — open a link item there and turn on
                "Show as a quick-access tile" for each page you want here.
              </p>
              {canManageNav && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button onClick={() => navigate('/nav-designer')}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary touch-manipulation min-h-[40px] px-3 py-2">
                    <Compass className="w-4 h-4" /> Open Navigation designer
                  </button>
                </div>
              )}
            </div>
          ) : tiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">All tiles are hidden. Turn on Customise to bring them back.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tiles.map(t => t.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {tiles.map(tile => (
                    <LauncherTile
                      key={tile.id}
                      tile={tile}
                      editMode={editMode}
                      onNavigate={() => navigate(tile.route)}
                      onHide={() => hideTile(tile.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {editMode && hiddenTiles.length > 0 && (
            <div className="border rounded-xl bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hidden</p>
              <div className="flex flex-wrap gap-2">
                {hiddenTiles.map(tile => {
                  const Icon = resolveIcon(tile.icon)
                  return (
                    <button key={tile.id} onClick={() => unhideTile(tile.id)}
                      className="inline-flex items-center gap-2 text-sm border rounded-full pl-2 pr-3 py-1.5 min-h-[40px] touch-manipulation bg-background hover:border-primary/40">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      {tile.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(prefs.order?.length > 0 || prefs.hidden?.length > 0) && (
            <button onClick={resetToDefaults}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground touch-manipulation min-h-[40px] px-2">
              <RotateCcw className="w-3.5 h-3.5" /> Reset to admin defaults
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LauncherTile({ tile, editMode, onNavigate, onHide }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const Icon = resolveIcon(tile.icon)

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        onClick={() => !editMode && onNavigate()}
        className={cn(
          'w-full flex flex-col items-center gap-2.5 px-3 pt-5 pb-4 rounded-xl border bg-background transition-colors touch-manipulation',
          'min-h-[104px]',
          editMode ? 'cursor-default' : 'hover:bg-accent hover:border-primary/30 active:scale-95',
        )}
      >
        <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm font-medium text-center leading-tight">{tile.label}</span>
      </button>
      {editMode && (
        <>
          <button {...attributes} {...listeners}
            className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-background border flex items-center justify-center shadow-sm cursor-grab active:cursor-grabbing touch-manipulation text-muted-foreground">
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <button onClick={onHide}
            className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center shadow-sm touch-manipulation">
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
