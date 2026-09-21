// src/pages/Menus.jsx
//
// Structured menu manager — list, create, edit, print.
//
//   list  — table of all menus for the tenant + create + seed buttons
//   edit  — sections + dish list in the middle, a right-hand drawer for
//           editing one dish's full details. Menu-level details (name,
//           slug, tagline, scope…) are edited in a modal via the pencil
//           button next to the menu name, not inline on the page.
//
// Dietary tags and variant groups are tenant-wide and managed on their
// own pages (see AppShell's Menus > Variant groups / Dietary groups)
// rather than inline here — this page only ATTACHES them to dishes.
//
// Single Save button PATCHes the whole tree (server delete-and-reinserts).

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Plus, Trash2, Loader2, X, ChevronDown, ChevronRight,
  Sparkles, Printer, Image as ImageIcon, Layers, Pencil, GripVertical, Copy,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { Card, Field, Input, TextArea, Btn, formatPrice, PriceInput } from '@/components/menus/shared'

const SEEDS = [
  { slug: 'onethai-dinner', label: 'One Thai Dinner sample' },
  { slug: 'onethai-lunch',  label: 'One Thai Lunch sample'  },
]

// ════════════════════════════════════════════════════════════
//  Top-level page
// ════════════════════════════════════════════════════════════

export default function Menus() {
  const [editingId, setEditingId] = useState(null)
  if (editingId) {
    return <MenuEditor id={editingId} onBack={() => setEditingId(null)} />
  }
  return <MenuList onEdit={setEditingId} />
}

// ── List view ───────────────────────────────────────────────

function MenuList({ onEdit }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data: menus = [], isLoading } = useQuery({
    queryKey: ['menus'],
    queryFn:  () => api.get('/menus'),
  })
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const seed = useMutation({
    mutationFn: ({ slug, venue_id }) => api.post(`/menus/seed/${slug}`, { venue_id: venue_id || null }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['menus'] })
      onEdit(m.id)
    },
  })
  const del = useMutation({
    mutationFn: (id) => api.delete(`/menus/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
  })
  const duplicate = useMutation({
    mutationFn: (id) => api.post(`/menus/${id}/duplicate`),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['menus'] })
      onEdit(m.id)
    },
  })

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Menus</h1>
          <p className="text-sm text-muted-foreground">
            Structured menus — sections, dishes, variants, allergens. Render on the website inline or print as PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> New menu
          </Btn>
        </div>
      </div>

      <Card title="Sample menus"
        description="Seed a starter menu in your tenant — edit afterwards. Both samples include sections, dishes, variants, and dietary tags pre-populated.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SEEDS.map(s => (
            <Btn key={s.slug} variant="secondary" disabled={seed.isPending}
              onClick={() => seed.mutate({ slug: s.slug })}>
              {seed.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {s.label}
            </Btn>
          ))}
        </div>
      </Card>

      <Card title="Your menus"
        description={`${menus.length} menu${menus.length === 1 ? '' : 's'} on this tenant.`}>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : menus.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No menus yet. Click <strong>New menu</strong> or import a sample above.
          </p>
        ) : (
          <div className="divide-y">
            {menus.map(m => {
              const venue = m.venue_name || (m.venue_id ? '— unknown —' : 'All venues (tenant)')
              const liveUrl = `/api/menus/${m.id}/print`
              return (
                <div key={m.id} className="flex items-center justify-between py-3 first:pt-0 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-primary shrink-0" />
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      {m.is_published
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">PUBLISHED</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">DRAFT</span>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      <code>/menus/{m.slug}</code> · {venue}
                      {m.tagline && <> · {m.tagline}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a href={liveUrl} target="_blank" rel="noopener"
                      className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground px-2 py-1.5">
                      <Printer className="w-3.5 h-3.5" /> Print
                    </a>
                    <button onClick={() => onEdit(m.id)}
                      className="text-xs text-primary hover:underline px-2 py-1.5">Edit</button>
                    <button onClick={() => duplicate.mutate(m.id)} disabled={duplicate.isPending}
                      title="Duplicate menu"
                      className="text-muted-foreground hover:text-foreground hover:bg-accent p-1.5 rounded disabled:opacity-50">
                      {duplicate.isPending && duplicate.variables === m.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => { if (window.confirm(`Delete menu "${m.name}"?`)) del.mutate(m.id) }}
                      className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {creating && (
        <NewMenuModal venues={venues} onClose={() => setCreating(false)}
          onCreated={(m) => { setCreating(false); onEdit(m.id) }} />
      )}
    </div>
    </div>
  )
}

function NewMenuModal({ venues, onClose, onCreated }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [form, setForm] = useState({
    name: '', slug: '', tagline: '', venue_id: '',
    is_published: true, sort_order: 0, print_columns: 4,
  })
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))
  const create = useMutation({
    mutationFn: () => api.post('/menus', { ...form, venue_id: form.venue_id || null }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['menus'] })
      onCreated(m)
    },
  })
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">New menu</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Dinner Menu" autoFocus />
          </Field>
          <Field label="URL slug" hint="Lowercase letters, digits, hyphens. Will appear at /menus/{slug}.">
            <Input value={form.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="dinner" />
          </Field>
          <Field label="Tagline (optional)">
            <Input value={form.tagline} onChange={e => set('tagline', e.target.value)}
              placeholder="classics, curries & everything in between" />
          </Field>
          <Field label="Scope">
            <select value={form.venue_id} onChange={e => set('venue_id', e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="">All venues (tenant-wide)</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          {create.isError && (
            <p className="text-xs text-destructive">{create.error?.body?.error || 'Create failed'}</p>
          )}
        </div>
        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn disabled={!form.name || !form.slug || create.isPending}
            onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create menu
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
//  Edit view
// ════════════════════════════════════════════════════════════

function ensureIds(menu) {
  // Existing sections/items carry a server id already. Anything without
  // one (shouldn't happen from the API, but be defensive) gets a local
  // id purely for React keys + drawer selection — never sent to the
  // server (the save payload below reconstructs fields explicitly).
  return {
    ...menu,
    sections: (menu.sections || []).map(s => ({
      ...s,
      id: s.id || crypto.randomUUID(),
      items: (s.items || []).map(it => ({ ...it, id: it.id || crypto.randomUUID() })),
    })),
  }
}

function MenuEditor({ id, onBack }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: menu, isLoading } = useQuery({
    queryKey: ['menu', id],
    queryFn:  () => api.get(`/menus/${id}`),
  })
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })
  const { data: variantGroups = [] } = useQuery({
    queryKey: ['menu-variant-groups'],
    queryFn:  () => api.get('/menus/variant-groups'),
  })

  const [draft, setDraft] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState(null)

  useEffect(() => {
    if (menu) setDraft(ensureIds(structuredClone(menu)))
  }, [menu])

  const dirty = useMemo(() => menu && draft &&
    JSON.stringify(ensureIds(structuredClone(menu))) !== JSON.stringify(draft),
    [menu, draft])

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name, slug: draft.slug,
        venue_id: draft.venue_id || null,
        tagline: draft.tagline || null,
        service_times: draft.service_times || null,
        intro_line: draft.intro_line || null,
        is_published: !!draft.is_published,
        sort_order: draft.sort_order ?? 0,
        print_columns: draft.print_columns ?? 4,
        print_orientation: draft.print_orientation || 'landscape',
        print_paper_size: draft.print_paper_size || 'A4',
        sections: (draft.sections || []).map((s, si) => ({
          title: s.title, subtitle: s.subtitle || null, highlight: !!s.highlight,
          sort_order: si,
          items: (s.items || []).map((it, ii) => ({
            name: it.name,
            native_name: it.native_name || null,
            description: it.description || null,
            price_pence: it.price_pence ?? null,
            notes: it.notes || null,
            is_featured: !!it.is_featured,
            image_url: it.image_url || null,
            sort_order: ii,
            // One-off ad-hoc variants are retired — every variant must
            // come from a predefined group (attached below). Price can
            // still be overridden per item via variant_groups.overrides.
            variants: [],
            variant_groups: (it.variant_groups || []).map((g, gi) => ({
              group_id: g.group_id,
              sort_order: gi,
              overrides: g.overrides || (g.options || [])
                .filter(o => o.overridden)
                .map(o => ({ option_id: o.option_id, price_pence: o.price_pence })),
            })),
            dietary: it.dietary || [],
          })),
        })),
        callouts: (draft.callouts || []).map((c, ci) => ({ ...c, sort_order: ci })),
      }
      return api.patch(`/menus/${id}`, payload)
    },
    onSuccess: (m) => {
      qc.setQueryData(['menu', id], m)
      qc.invalidateQueries({ queryKey: ['menus'] })
    },
  })

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const printUrl = `/api/menus/${id}/print`

  // ── Selected item lookup + mutators (by stable id, across sections) ──
  let selectedItem = null
  if (selectedItemId) {
    outer: for (let si = 0; si < (draft.sections || []).length; si++) {
      const items = draft.sections[si].items || []
      for (let ii = 0; ii < items.length; ii++) {
        if (items[ii].id === selectedItemId) { selectedItem = { si, ii, item: items[ii] }; break outer }
      }
    }
  }
  function patchItem(sectionIndex, itemIndex, patch) {
    const sections = draft.sections.slice()
    const items = sections[sectionIndex].items.slice()
    items[itemIndex] = { ...items[itemIndex], ...patch }
    sections[sectionIndex] = { ...sections[sectionIndex], items }
    set('sections', sections)
  }
  function removeItemAt(sectionIndex, itemIndex) {
    const sections = draft.sections.slice()
    sections[sectionIndex] = { ...sections[sectionIndex], items: sections[sectionIndex].items.filter((_, j) => j !== itemIndex) }
    set('sections', sections)
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-6xl mx-auto space-y-5 pb-24">
      {/* Top bar — sticks to the scroll container, not the viewport. */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-background/95 backdrop-blur py-3 -mx-6 px-6 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
            ← All menus
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate inline-flex items-center gap-1.5">
              {draft.name}
              <button onClick={() => setDetailsOpen(true)}
                className="text-muted-foreground hover:text-primary p-0.5 rounded shrink-0" title="Edit menu details">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </p>
            <p className="text-xs text-muted-foreground truncate">/menus/{draft.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={printUrl} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-2">
            <Printer className="w-3.5 h-3.5" /> Print
          </a>
          <Btn disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {dirty ? 'Save changes' : 'Saved'}
          </Btn>
        </div>
      </div>

      {save.isError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-4 py-3">
          <strong>Save failed:</strong> {save.error?.body?.error || save.error?.message || 'Unknown error'}
        </div>
      )}

      {/* Sections + dish list, with a right-hand drawer for the selected dish */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          <SectionsPanel
            sections={draft.sections || []}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            onChange={(sections) => set('sections', sections)} />
        </div>

        {selectedItem && (
          <ItemDrawer
            item={selectedItem.item}
            dietaryTags={draft.dietary_tags || []}
            variantGroups={variantGroups}
            onChange={(patch) => patchItem(selectedItem.si, selectedItem.ii, patch)}
            onRemove={() => { removeItemAt(selectedItem.si, selectedItem.ii); setSelectedItemId(null) }}
            onClose={() => setSelectedItemId(null)} />
        )}
      </div>

      {/* Callouts */}
      <CalloutsPanel
        callouts={draft.callouts || []}
        onChange={(callouts) => set('callouts', callouts)} />

      {/* Sticky bottom save bar (mirror of top, easier to reach when long) */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg z-20">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Unsaved changes.</span>
            <Btn disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save changes
            </Btn>
          </div>
        </div>
      )}
    </div>

    {detailsOpen && (
      <MenuDetailsModal draft={draft} venues={venues} onChange={set} onClose={() => setDetailsOpen(false)} />
    )}
    </div>
  )
}

// ── Menu details modal (name, slug, scope, print settings…) ─

function MenuDetailsModal({ draft, venues, onChange, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between sticky top-0 bg-background">
          <h2 className="font-semibold text-sm">Menu details</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name"><Input value={draft.name} onChange={e => onChange('name', e.target.value)} /></Field>
          <Field label="URL slug">
            <Input value={draft.slug} onChange={e => onChange('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
          </Field>
          <Field label="Tagline"><Input value={draft.tagline || ''} onChange={e => onChange('tagline', e.target.value)} /></Field>
          <Field label="Service times" hint="e.g. 'Tue–Sat · Dinner 6 PM – 10 PM'">
            <Input value={draft.service_times || ''} onChange={e => onChange('service_times', e.target.value)} />
          </Field>
          <Field label="Scope">
            <select value={draft.venue_id || ''} onChange={e => onChange('venue_id', e.target.value || null)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="">All venues (tenant-wide)</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Paper size">
            <select value={draft.print_paper_size || 'A4'} onChange={e => onChange('print_paper_size', e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </Field>
          <Field label="Orientation">
            <select value={draft.print_orientation || 'landscape'} onChange={e => onChange('print_orientation', e.target.value)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </Field>
          <Field label="Print columns" hint="A3 or portrait leaves more/less room per column — adjust this to match.">
            <select value={draft.print_columns ?? 4} onChange={e => onChange('print_columns', Number(e.target.value))}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Intro line" hint="Short note shown at the top — e.g. 'Looking for starters? Our dinner menu is available all day…'">
              <TextArea value={draft.intro_line || ''} onChange={e => onChange('intro_line', e.target.value)} rows={2} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft.is_published}
                onChange={e => onChange('is_published', e.target.checked)} />
              Published — make this menu visible on the website + printable
            </label>
          </div>
        </div>
        <div className="px-5 py-3 border-t flex items-center justify-end">
          <Btn onClick={onClose}>Done</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Sections + dish list (compact rows, click to open the drawer) ──

function SectionsPanel({ sections, selectedItemId, onSelectItem, onChange }) {
  const set = (i, patch) => {
    const next = sections.slice(); next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const setItems = (i, items) => set(i, { items })
  const addSection = () => onChange([...sections, { id: crypto.randomUUID(), title: 'New section', subtitle: '', highlight: false, items: [] }])
  const removeSection = (i) => onChange(sections.filter((_, j) => j !== i))
  const moveSection = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= sections.length) return
    const next = sections.slice();[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <Card title="Sections" description="Group dishes into sections (Starters, Soups, Curries…)."
      action={<Btn variant="secondary" onClick={addSection}><Plus className="w-3.5 h-3.5" /> Add section</Btn>}>
      {sections.length === 0
        ? <p className="text-sm text-muted-foreground text-center py-4">No sections yet.</p>
        : (
          <div className="space-y-3">
            {sections.map((s, i) => (
              <SectionEditor key={s.id} section={s}
                index={i} total={sections.length}
                selectedItemId={selectedItemId}
                onSelectItem={onSelectItem}
                onChange={(patch) => set(i, patch)}
                onRemove={() => { if (window.confirm(`Remove section "${s.title}"?`)) removeSection(i) }}
                onMoveUp={() => moveSection(i, -1)}
                onMoveDown={() => moveSection(i, 1)}
                onItemsChange={(items) => setItems(i, items)} />
            ))}
          </div>
        )}
    </Card>
  )
}

function SectionEditor({ section, index, total, selectedItemId, onSelectItem, onChange, onRemove, onMoveUp, onMoveDown, onItemsChange }) {
  const [open, setOpen] = useState(true)
  const items = section.items || []

  const addItem = () => {
    const item = {
      id: crypto.randomUUID(), name: 'New dish', native_name: '', description: '',
      price_pence: null, notes: '', is_featured: false, image_url: null,
      variants: [], variant_groups: [], dietary: [],
    }
    onItemsChange([...items, item])
    onSelectItem(item.id)
  }
  const removeItem = (i) => {
    const removed = items[i]
    onItemsChange(items.filter((_, j) => j !== i))
    if (removed && removed.id === selectedItemId) onSelectItem(null)
  }
  const moveItem = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= items.length) return
    const next = items.slice();[next[i], next[j]] = [next[j], next[i]]
    onItemsChange(next)
  }

  return (
    <div className="border border-sky-200 rounded-lg overflow-hidden bg-sky-50">
      <div className="flex items-center gap-2 px-3 py-2 bg-sky-100">
        <button onClick={() => setOpen(o => !o)} className="p-1">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <Input value={section.title} onChange={e => onChange({ title: e.target.value })}
          placeholder="Section title (e.g. Starters)" className="flex-1 font-medium bg-white" />
        <Input value={section.subtitle || ''} onChange={e => onChange({ subtitle: e.target.value })}
          placeholder="Subtitle (optional)" className="flex-1 max-w-[260px] bg-white" />
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={!!section.highlight}
            onChange={e => onChange({ highlight: e.target.checked })} />
          Highlight
        </label>
        <button onClick={onMoveUp}   disabled={index === 0}        className="text-xs px-2 disabled:opacity-30">↑</button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="text-xs px-2 disabled:opacity-30">↓</button>
        <button onClick={onRemove} className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="p-2 space-y-1">
          {items.map((it, i) => (
            <ItemRow key={it.id} item={it}
              index={i} total={items.length}
              selected={it.id === selectedItemId}
              onSelect={() => onSelectItem(it.id)}
              onRemove={() => removeItem(i)}
              onMoveUp={() => moveItem(i, -1)}
              onMoveDown={() => moveItem(i, 1)} />
          ))}
          <button onClick={addItem}
            className="w-full text-xs border-2 border-dashed border-amber-300 rounded-md py-2 text-amber-800/70 hover:bg-amber-100 hover:text-amber-900 bg-amber-50/40">
            + Add dish
          </button>
        </div>
      )}
    </div>
  )
}

// Compact row — name, price, attached-group + dietary badges. Click
// anywhere on the row to open it in the drawer.
function ItemRow({ item, index, total, selected, onSelect, onRemove, onMoveUp, onMoveDown }) {
  const groupCount = (item.variant_groups || []).length
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer bg-white hover:border-primary/50',
        selected ? 'border-primary ring-1 ring-primary/30 bg-primary/5' : 'border-amber-200',
      )}>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      {item.image_url
        ? <img src={item.image_url} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
        : <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <span className="text-sm font-medium truncate flex-1">{item.name || 'Untitled dish'}</span>
      {groupCount > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 inline-flex items-center gap-1 shrink-0">
          <Layers className="w-2.5 h-2.5" /> {groupCount}
        </span>
      )}
      {(item.dietary || []).length > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0">{item.dietary.length} tag{item.dietary.length === 1 ? '' : 's'}</span>
      )}
      <span className="text-xs font-mono text-muted-foreground shrink-0 w-16 text-right">{formatPrice(item.price_pence)}</span>
      <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
        <button onClick={onMoveUp}   disabled={index === 0}        className="text-xs px-1.5 disabled:opacity-30">↑</button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="text-xs px-1.5 disabled:opacity-30">↓</button>
        <button onClick={onRemove} className="text-destructive hover:bg-destructive/10 p-1 rounded">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

function ItemImagePicker({ url, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="relative shrink-0">
        <button type="button" onClick={() => setOpen(true)}
          className="w-16 h-16 rounded-md border overflow-hidden bg-muted/30 flex items-center justify-center hover:border-primary">
          {url
            ? <img src={url} alt="" className="w-full h-full object-cover" />
            : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
        </button>
        {url && (
          <button type="button" onClick={() => onChange(null)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border text-destructive flex items-center justify-center shadow-sm"
            title="Remove image">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <MediaLibraryModal
        open={open}
        onClose={() => setOpen(false)}
        mode="picker"
        scope="menu:item"
        onPick={(pickedUrl) => { onChange(pickedUrl); setOpen(false) }}
      />
    </>
  )
}

function mergeAttachedGroup(attached, library) {
  const lib = (library || []).find(g => g.id === attached.group_id)
  const ovMap = {}
  for (const o of attached.overrides || []) ovMap[o.option_id] = o.price_pence
  for (const o of attached.options || []) {
    if (o.overridden) ovMap[o.option_id] = o.price_pence
  }
  if (!lib) {
    return {
      group_id: attached.group_id,
      name: attached.name || 'Removed group',
      missing: true,
      options: attached.options || [],
    }
  }
  return {
    group_id: lib.id,
    name: lib.name,
    missing: false,
    options: (lib.options || []).map(o => {
      const hasOv = Object.prototype.hasOwnProperty.call(ovMap, o.id)
      return {
        option_id: o.id,
        label: o.label,
        default_pence: o.price_pence,
        price_pence: hasOv ? ovMap[o.id] : o.price_pence,
        overridden: hasOv && Number(ovMap[o.id]) !== Number(o.price_pence),
      }
    }),
  }
}

// ── Item drawer — full dish editor, opened from a row in the middle list ──

function ItemDrawer({ item, dietaryTags, variantGroups = [], onChange, onRemove, onClose }) {
  const toggleDietary = (code) => {
    const set = new Set(item.dietary || [])
    if (set.has(code)) set.delete(code); else set.add(code)
    onChange({ dietary: Array.from(set) })
  }

  const attached = item.variant_groups || []
  const attachedIds = new Set(attached.map(g => g.group_id))
  const availableGroups = variantGroups.filter(g => !attachedIds.has(g.id))

  function attachGroup(groupId) {
    if (!groupId || attachedIds.has(groupId)) return
    onChange({ variant_groups: [...attached, { group_id: groupId, overrides: [] }] })
  }
  function detachGroup(groupId) {
    onChange({ variant_groups: attached.filter(g => g.group_id !== groupId) })
  }
  function setOverride(groupId, optionId, pence, defaultPence) {
    onChange({
      variant_groups: attached.map(g => {
        if (g.group_id !== groupId) return g
        const overrides = (g.overrides || []).filter(o => o.option_id !== optionId)
        if (pence != null && Number(pence) !== Number(defaultPence)) {
          overrides.push({ option_id: optionId, price_pence: Number(pence) })
        }
        return { group_id: g.group_id, overrides }
      }),
    })
  }

  return (
    <aside className="border rounded-lg bg-background flex flex-col w-[380px] shrink-0 max-h-[calc(100vh-140px)] sticky top-[76px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <p className="text-sm font-semibold flex-1 truncate">Edit dish</p>
        <button onClick={onRemove} className="text-destructive hover:bg-destructive/10 p-1.5 rounded" title="Delete dish">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-start gap-3">
          <ItemImagePicker url={item.image_url || null} onChange={(image_url) => onChange({ image_url })} />
          <div className="flex-1 space-y-2">
            <Input value={item.name} onChange={e => onChange({ name: e.target.value })} placeholder="Dish name" className="font-medium" />
            <Input value={item.native_name || ''} onChange={e => onChange({ native_name: e.target.value })} placeholder="Native script (optional)" />
          </div>
        </div>

        <Field label="Price">
          <PriceInput
            pence={item.price_pence}
            onChange={(pence) => onChange({ price_pence: pence })}
            placeholder="£0.00" className="font-mono" />
        </Field>

        <Field label="Description">
          <TextArea value={item.description || ''} onChange={e => onChange({ description: e.target.value })} rows={3} />
        </Field>

        <Field label="Notes" hint="e.g. 'Min 2', 'pp'">
          <Input value={item.notes || ''} onChange={e => onChange({ notes: e.target.value })} />
        </Field>

        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!item.is_featured}
            onChange={e => onChange({ is_featured: e.target.checked })} />
          House favourite
        </label>

        <div>
          <p className="text-xs font-medium mb-1.5">Dietary tags</p>
          <div className="flex flex-wrap gap-1.5">
            {dietaryTags.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No dietary tags yet — add some on Menus &gt; Dietary groups.</p>
            )}
            {dietaryTags.map(t => {
              const active = (item.dietary || []).includes(t.code)
              return (
                <button key={t.id} type="button" onClick={() => toggleDietary(t.code)}
                  title={t.label}
                  className={cn(
                    'text-[11px] px-2 py-1 rounded-full font-bold border',
                    active ? 'border-transparent text-white' : 'border-muted text-muted-foreground hover:border-primary bg-white',
                  )}
                  style={active ? { background: t.colour } : {}}>
                  {t.glyph}
                </button>
              )
            })}
          </div>
        </div>

        {/* Attached variant groups — the only source of variants. Every
            option is predefined in the group (managed on Menus > Variant
            groups); only its price can be overridden here, per item. */}
        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
              Variant groups
            </span>
            {availableGroups.length > 0 && (
              <select
                value=""
                onChange={e => { attachGroup(e.target.value); e.target.value = '' }}
                className="text-xs border rounded-md px-2 py-1 bg-background min-h-[28px]">
                <option value="">Attach group…</option>
                {availableGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>
          {attached.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              {variantGroups.length
                ? 'No groups on this dish yet — attach Protein / Size from the dropdown above.'
                : 'No variant groups exist yet — create one under Menus > Variant groups, then attach it here.'}
            </p>
          )}
          {attached.map(raw => {
            const g = mergeAttachedGroup(raw, variantGroups)
            return (
              <div key={g.group_id} className="rounded-md border border-violet-200 bg-violet-50/70 p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-900 inline-flex items-center gap-1">
                    <Layers className="w-3 h-3" /> {g.name}
                    {g.missing && <span className="font-normal text-destructive"> (deleted)</span>}
                  </span>
                  <button onClick={() => detachGroup(g.group_id)}
                    className="text-[11px] text-destructive hover:underline">Detach</button>
                </div>
                {g.options.map(o => (
                  <div key={o.option_id} className="flex items-center gap-2">
                    <span className="text-xs flex-1">{o.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      default {formatPrice(o.default_pence)}
                    </span>
                    <PriceInput
                      pence={o.price_pence ?? 0}
                      onChange={(pence) => setOverride(g.group_id, o.option_id, pence ?? 0, o.default_pence)}
                      className={cn('w-24 font-mono text-xs', o.overridden && 'border-violet-400')}
                    />
                    {o.overridden && (
                      <button type="button"
                        onClick={() => setOverride(g.group_id, o.option_id, o.default_pence, o.default_pence)}
                        className="text-[10px] text-violet-700 hover:underline">Reset</button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

// ── Callouts ─────────────────────────────────────────────────

function CalloutsPanel({ callouts, onChange }) {
  const add = () => onChange([...callouts, { kind: 'custom', title: 'New callout', body: '' }])
  const set = (i, patch) => {
    const next = callouts.slice(); next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const remove = (i) => onChange(callouts.filter((_, j) => j !== i))
  const KINDS = [
    { value: 'allergens',  label: 'Allergies & Diet' },
    { value: 'go_large',   label: 'Go Large' },
    { value: 'thai_hot',   label: 'Make It Thai Hot' },
    { value: 'order_book', label: 'Order & Book' },
    { value: 'custom',     label: 'Custom' },
  ]
  return (
    <Card title="Footer callouts"
      description="Notes shown at the bottom of the printable menu (allergy notice, Go Large upgrade, ordering info)."
      action={<Btn variant="secondary" onClick={add}><Plus className="w-3.5 h-3.5" /> Add callout</Btn>}>
      {callouts.length === 0
        ? <p className="text-sm text-muted-foreground text-center py-4">No callouts yet.</p>
        : (
          <div className="space-y-2">
            {callouts.map((c, i) => (
              <div key={i} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={c.kind || 'custom'} onChange={e => set(i, { kind: e.target.value })}
                    className="text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px] w-44">
                    {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <Input value={c.title} onChange={e => set(i, { title: e.target.value })}
                    placeholder="Title" className="flex-1 font-medium" />
                  <button onClick={() => remove(i)}
                    className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <TextArea value={c.body || ''} onChange={e => set(i, { body: e.target.value })}
                  rows={2} placeholder="Body" />
              </div>
            ))}
          </div>
        )}
    </Card>
  )
}
