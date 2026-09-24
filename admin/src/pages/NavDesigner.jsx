// src/pages/NavDesigner.jsx
//
// Navigation designer: one shared nav tree per tenant, arbitrary depth,
// per-role visibility toggles, plus the tenant-wide sidebar/launcher
// style switch. Outline-editor UI (indent/outdent/move up/down) rather
// than free-form drag-and-drop reparenting — see nav.js for why.
//
// Gated on the nav_designer module (owner-only by default, migration 091).

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import {
  Compass, Plus, Trash2, Pencil, ChevronUp, ChevronDown, ChevronRight, ChevronLeft,
  Loader2, X, RotateCcw, LayoutGrid, PanelLeft, FolderPlus, Link2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

function resolveIcon(name) {
  return LucideIcons[name] || LucideIcons.Circle
}

function buildTree(items, parentId = null) {
  return items
    .filter(i => i.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(i => ({ ...i, children: buildTree(items, i.id) }))
}

export default function NavDesigner() {
  const api = useApi()
  const qc  = useQueryClient()

  const [editorState, setEditorState] = useState(null) // { mode: 'add'|'edit', node, parentNode }
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetText, setResetText] = useState('')

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const canManage = me?.permissions?.nav_designer === 'manage' || me?.is_platform_admin
  const navStyle  = me?.current_tenant?.nav_style || 'sidebar'

  const { data: items = [], isLoading } = useQuery({ queryKey: ['nav-items'], queryFn: () => api.get('/nav/items') })
  const { data: routeCatalog = [] } = useQuery({ queryKey: ['nav-route-catalog'], queryFn: () => api.get('/nav/route-catalog') })
  const { data: roles = [] } = useQuery({ queryKey: ['access-roles'], queryFn: () => api.get('/access/roles') })
  const { data: modules = [] } = useQuery({ queryKey: ['access-modules'], queryFn: () => api.get('/access/modules') })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['nav-items'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }

  const createItem = useMutation({
    mutationFn: (body) => api.post('/nav/items', body),
    onSuccess:  () => { invalidate(); setEditorState(null) },
  })
  const patchItem = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/nav/items/${id}`, body),
    onSuccess:  () => { invalidate(); setEditorState(null) },
  })
  const deleteItem = useMutation({
    mutationFn: (id) => api.delete(`/nav/items/${id}`),
    onSuccess:  invalidate,
  })
  const reorder = useMutation({
    mutationFn: (body) => api.patch('/nav/items/reorder', body),
    onSuccess:  invalidate,
  })
  const reparent = useMutation({
    mutationFn: ({ id, parent_id, index }) => api.patch(`/nav/items/${id}/reparent`, { parent_id, index }),
    onSuccess:  invalidate,
  })
  const resetNav = useMutation({
    mutationFn: () => api.post('/nav/reset'),
    onSuccess:  () => { invalidate(); setResetConfirm(false); setResetText('') },
  })
  const setStyle = useMutation({
    mutationFn: (nav_style) => api.patch('/nav/style', { nav_style }),
    onSuccess:  invalidate,
  })

  const tree = useMemo(() => buildTree(items), [items])
  const mutations = { reorder, reparent, delete: deleteItem }

  function openAdd(parentNode) {
    setEditorState({ mode: 'add', node: null, parentNode: parentNode || null })
  }
  function openEdit(node) {
    const parentNode = node.parent_id ? items.find(i => i.id === node.parent_id) : null
    setEditorState({ mode: 'edit', node, parentNode })
  }
  function handleSave(body) {
    if (editorState.mode === 'add') {
      createItem.mutate({ ...body, parent_id: editorState.parentNode?.id || null })
    } else {
      patchItem.mutate({ id: editorState.node.id, body })
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2"><Compass className="w-4 h-4" /> Navigation</h1>
          <p className="text-xs text-muted-foreground">Sidebar tree + quick-access launcher</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <button onClick={() => setStyle.mutate('sidebar')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded touch-manipulation min-h-[36px] inline-flex items-center gap-1.5',
                navStyle === 'sidebar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}>
              <PanelLeft className="w-3.5 h-3.5" /> Sidebar
            </button>
            <button onClick={() => setStyle.mutate('launcher')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded touch-manipulation min-h-[36px] inline-flex items-center gap-1.5',
                navStyle === 'launcher' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}>
              <LayoutGrid className="w-3.5 h-3.5" /> Launcher
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            {navStyle === 'launcher'
              ? 'Launcher mode is active — the sidebar tree below is hidden for everyone in this tenant. It still controls which pages show up as quick-access tiles.'
              : 'This tree drives the left sidebar for every user in this tenant. Toggle "Show as a quick-access tile" on a link item to also surface it in launcher mode.'}
          </p>

          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={() => openAdd(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium border rounded-md px-3 py-2 min-h-[40px] touch-manipulation hover:bg-accent">
                <FolderPlus className="w-4 h-4" /> Add section
              </button>
              <button onClick={() => openAdd(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium border rounded-md px-3 py-2 min-h-[40px] touch-manipulation hover:bg-accent">
                <Link2 className="w-4 h-4" /> Add link
              </button>
            </div>
          )}

          <div className="border rounded-xl overflow-hidden bg-background">
            {tree.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No nav items yet.</p>
            ) : (
              tree.map((node, i) => (
                <NavRow key={node.id} node={node} depth={0} siblings={tree} index={i} parent={null}
                  onEdit={openEdit} onAddChild={openAdd} mutations={mutations} canManage={canManage} />
              ))
            )}
          </div>

          {canManage && (
            <div className="border rounded-xl bg-muted/30 p-4">
              {!resetConfirm ? (
                <button onClick={() => setResetConfirm(true)}
                  className="inline-flex items-center gap-1.5 text-sm text-destructive font-medium touch-manipulation min-h-[40px] px-2">
                  <RotateCcw className="w-4 h-4" /> Reset to defaults
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-destructive font-medium">
                    This deletes every nav item for this tenant and restores the shipped default tree. This cannot be undone.
                  </p>
                  <p className="text-xs text-muted-foreground">Type RESET to confirm.</p>
                  <div className="flex items-center gap-2">
                    <input value={resetText} onChange={e => setResetText(e.target.value)}
                      className="border rounded-md px-3 py-2 text-sm min-h-[40px] touch-manipulation w-40 focus:outline-none focus:ring-1 focus:ring-destructive" />
                    <button disabled={resetText !== 'RESET' || resetNav.isPending} onClick={() => resetNav.mutate()}
                      className="bg-destructive text-white text-sm font-medium rounded-md px-4 py-2 min-h-[40px] disabled:opacity-40 touch-manipulation inline-flex items-center gap-2">
                      {resetNav.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Confirm reset
                    </button>
                    <button onClick={() => { setResetConfirm(false); setResetText('') }}
                      className="text-sm text-muted-foreground px-3 py-2 touch-manipulation min-h-[40px]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editorState && (
        <ItemEditor
          mode={editorState.mode}
          node={editorState.node}
          parentNode={editorState.parentNode}
          roles={roles}
          modules={modules}
          routeCatalog={routeCatalog}
          onClose={() => setEditorState(null)}
          onSave={handleSave}
          saving={createItem.isPending || patchItem.isPending}
          error={createItem.error?.body?.error || patchItem.error?.body?.error}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// One tree row + its rendered children. `parent` describes this
// node's own position: { node: parentNode, index: parentIndex,
// siblings: parentSiblingsArray } or null at the root — that's exactly
// the information outdent needs (new parent = parent.node's own
// parent_id, new index = parent.index + 1 within `siblings`).
// ──────────────────────────────────────────────────────────

function NavRow({ node, depth, siblings, index, parent, onEdit, onAddChild, mutations, canManage }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const Icon = resolveIcon(node.icon)
  const isFirst = index === 0
  const isLast  = index === siblings.length - 1

  function moveBy(delta) {
    const ids = siblings.map(s => s.id)
    const j = index + delta
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    mutations.reorder.mutate({ parent_id: node.parent_id, ids })
  }

  function indent() {
    const prev = siblings[index - 1]
    if (!prev) return
    mutations.reparent.mutate({ id: node.id, parent_id: prev.id, index: prev.children.length })
  }

  function outdent() {
    if (!parent) return
    const newParentId = parent.node ? parent.node.parent_id : null
    mutations.reparent.mutate({ id: node.id, parent_id: newParentId, index: parent.index + 1 })
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 pr-2 border-b last:border-b-0 hover:bg-accent/40"
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{node.label}</span>
            {node.kind === 'section' && (
              <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">section</span>
            )}
            {node.show_in_launcher && (
              <span className="text-[10px] rounded bg-blue-100 text-blue-700 px-1.5 py-0.5">launcher</span>
            )}
            {node.hidden_role_ids?.length > 0 && (
              <span className="text-[10px] rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">
                hidden for {node.hidden_role_ids.length} role{node.hidden_role_ids.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {node.route && <p className="text-[11px] text-muted-foreground truncate font-mono">{node.route}</p>}
        </div>
        {canManage && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button disabled={isFirst} onClick={() => moveBy(-1)} title="Move up"
              className="p-1.5 rounded disabled:opacity-30 hover:bg-accent touch-manipulation">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button disabled={isLast} onClick={() => moveBy(1)} title="Move down"
              className="p-1.5 rounded disabled:opacity-30 hover:bg-accent touch-manipulation">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button disabled={isFirst} onClick={indent} title="Indent — make child of the item above"
              className="p-1.5 rounded disabled:opacity-30 hover:bg-accent touch-manipulation">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button disabled={!parent} onClick={outdent} title="Outdent"
              className="p-1.5 rounded disabled:opacity-30 hover:bg-accent touch-manipulation">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onAddChild(node)} title="Add child item"
              className="p-1.5 rounded hover:bg-accent touch-manipulation">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onEdit(node)} title="Edit"
              className="p-1.5 rounded hover:bg-accent touch-manipulation">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} title="Delete"
                className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive touch-manipulation">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="flex items-center gap-1">
                <button
                  onClick={() => { mutations.delete.mutate(node.id); setConfirmDelete(false) }}
                  className="text-[11px] font-medium text-destructive px-1.5 py-1 rounded hover:bg-destructive/10 touch-manipulation">
                  Confirm
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="text-[11px] text-muted-foreground px-1.5 py-1 touch-manipulation">
                  Cancel
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      {node.children.map((child, i) => (
        <NavRow
          key={child.id}
          node={child}
          depth={depth + 1}
          siblings={node.children}
          index={i}
          parent={{ node, index, siblings }}
          onEdit={onEdit}
          onAddChild={onAddChild}
          mutations={mutations}
          canManage={canManage}
        />
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Add / edit modal
// ──────────────────────────────────────────────────────────

function ItemEditor({ mode, node, parentNode, roles, modules, routeCatalog, onClose, onSave, saving, error }) {
  const [kind, setKind]             = useState(node?.kind || 'link')
  const [label, setLabel]           = useState(node?.label || '')
  const [icon, setIcon]             = useState(node?.icon || '')
  const [route, setRoute]           = useState(node?.route || '')
  const [moduleKey, setModuleKey]   = useState(node?.module || '')
  const [hiddenRoleIds, setHiddenRoleIds] = useState(node?.hidden_role_ids || [])
  const [showInLauncher, setShowInLauncher] = useState(node?.show_in_launcher || false)

  const Icon = resolveIcon(icon)

  function pickRoute(r) {
    setRoute(r)
    const cat = routeCatalog.find(c => c.route === r)
    if (cat) {
      if (!label) setLabel(cat.label)
      if (!icon) setIcon(cat.icon)
      if (!moduleKey) setModuleKey(cat.module || '')
    }
  }

  function toggleRole(id) {
    setHiddenRoleIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  function submit() {
    onSave({
      kind,
      label: label.trim(),
      icon: icon || null,
      route: kind === 'section' ? null : route,
      module: moduleKey || null,
      hidden_role_ids: hiddenRoleIds,
      show_in_launcher: kind === 'link' ? showInLauncher : false,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl border w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-background">
          <h2 className="text-sm font-semibold">
            {mode === 'add' ? 'Add nav item' : `Edit: ${node.label}`}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {parentNode && (
            <p className="text-xs text-muted-foreground">
              Adding under: <span className="font-medium">{parentNode.label}</span>
            </p>
          )}
          {mode === 'add' && (
            <div>
              <label className="text-sm font-medium block mb-1">Type</label>
              <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
                {['link', 'section'].map(k => (
                  <button key={k} onClick={() => setKind(k)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded capitalize touch-manipulation min-h-[36px]',
                      kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Icon</label>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded border flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <input value={icon} onChange={e => setIcon(e.target.value)} list="nav-icon-suggestions"
                placeholder="e.g. LayoutDashboard"
                className="flex-1 border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
              <datalist id="nav-icon-suggestions">
                {[...new Set(routeCatalog.map(c => c.icon))].map(i => <option key={i} value={i} />)}
              </datalist>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Any lucide-react icon name. Unknown names fall back to a dot.</p>
          </div>
          {kind === 'link' && (
            <div>
              <label className="text-sm font-medium block mb-1">Page</label>
              <select value={route} onChange={e => pickRoute(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">Select a page…</option>
                {routeCatalog.map(c => <option key={c.route} value={c.route}>{c.label} — {c.route}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">Module gate</label>
            <select value={moduleKey} onChange={e => setModuleKey(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[44px] touch-manipulation focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">None — always visible (subject to role hiding below)</option>
              {modules.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Hidden automatically when a viewer's role has no access to this module.
            </p>
          </div>
          {kind === 'link' && (
            <label className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px]">
              <input type="checkbox" checked={showInLauncher} onChange={e => setShowInLauncher(e.target.checked)} className="w-4 h-4" />
              Show as a quick-access tile in launcher mode
            </label>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">Hide for specific roles</label>
            <div className="border rounded-md divide-y">
              {roles.map(r => (
                <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm touch-manipulation min-h-[44px]">
                  <input type="checkbox" checked={hiddenRoleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="w-4 h-4" />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t sticky bottom-0 bg-background">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2 touch-manipulation min-h-[40px]">
            Cancel
          </button>
          <button onClick={submit} disabled={!label.trim() || (kind === 'link' && !route) || saving}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50 touch-manipulation">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'add' ? 'Add item' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
