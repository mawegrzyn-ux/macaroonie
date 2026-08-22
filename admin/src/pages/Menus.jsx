// src/pages/Menus.jsx
//
// Structured menu manager — list, create, edit, print.
// One file. Two modes:
//
//   list  — table of all menus for the tenant + create + seed buttons
//   edit  — full nested form for one menu: meta, sections, items,
//           variants, dietary tag links, callouts. Single Save button
//           that PATCHes the whole tree (server delete-and-reinserts).
//
// Dietary tags are tenant-wide; managed in a separate panel inside the
// edit view.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Plus, Trash2, ExternalLink, Loader2, X, ChevronDown, ChevronRight,
  Sparkles, Printer, Tag, Image as ImageIcon, Layers,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'

// ── Tiny primitives ─────────────────────────────────────────

function Card({ title, action, description, children }) {
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1">{label}</span>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </label>
  )
}
function Input(props) {
  return <input {...props} className={cn('w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px]', props.className)} />
}
function TextArea(props) {
  return <textarea {...props} className={cn('w-full text-sm border rounded-md px-2 py-1.5', props.className)} />
}
function Btn({ variant = 'primary', children, ...props }) {
  const cls = variant === 'primary'
    ? 'bg-primary text-primary-foreground'
    : variant === 'destructive'
    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
    : 'border bg-background hover:bg-accent'
  return (
    <button {...props}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium min-h-[36px] disabled:opacity-50', cls)}>
      {children}
    </button>
  )
}

const SEEDS = [
  { slug: 'onethai-dinner', label: 'One Thai Dinner sample' },
  { slug: 'onethai-lunch',  label: 'One Thai Lunch sample'  },
]

// Currency helper — converts £ pence → £ display string.
function formatPrice(pence) {
  if (pence == null || pence === '') return ''
  const n = Number(pence) / 100
  return `£${n.toFixed(2)}`
}
function parsePrice(str) {
  if (str == null || str === '') return null
  const cleaned = String(str).replace(/[£\s,]/g, '')
  const f = parseFloat(cleaned)
  if (Number.isNaN(f)) return null
  return Math.round(f * 100)
}

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
  useEffect(() => {
    if (menu) setDraft(structuredClone(menu))
  }, [menu])

  const dirty = useMemo(() => menu && draft &&
    JSON.stringify(menu) !== JSON.stringify(draft),
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
        sections: (draft.sections || []).map((s, si) => ({
          ...s, sort_order: si,
          items: (s.items || []).map((it, ii) => ({
            name: it.name,
            native_name: it.native_name || null,
            description: it.description || null,
            price_pence: it.price_pence ?? null,
            notes: it.notes || null,
            is_featured: !!it.is_featured,
            image_url: it.image_url || null,
            sort_order: ii,
            variants: (it.variants || []).map((v, vi) => ({
              label: v.label, price_pence: v.price_pence ?? 0, sort_order: vi,
            })),
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

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-5xl mx-auto space-y-5 pb-24">
      {/* Top bar — sticks to the scroll container, not the viewport. */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-background/95 backdrop-blur py-3 -mx-6 px-6 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
            ← All menus
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{draft.name}</p>
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

      {/* Meta */}
      <Card title="Menu details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name"><Input value={draft.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="URL slug">
            <Input value={draft.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
          </Field>
          <Field label="Tagline"><Input value={draft.tagline || ''} onChange={e => set('tagline', e.target.value)} /></Field>
          <Field label="Service times" hint="e.g. 'Tue–Sat · Dinner 6 PM – 10 PM'">
            <Input value={draft.service_times || ''} onChange={e => set('service_times', e.target.value)} />
          </Field>
          <Field label="Scope">
            <select value={draft.venue_id || ''} onChange={e => set('venue_id', e.target.value || null)}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              <option value="">All venues (tenant-wide)</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Print columns" hint="How many columns to use on the printable A4-landscape page.">
            <select value={draft.print_columns ?? 4} onChange={e => set('print_columns', Number(e.target.value))}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Intro line" hint="Short note shown at the top — e.g. 'Looking for starters? Our dinner menu is available all day…'">
              <TextArea value={draft.intro_line || ''} onChange={e => set('intro_line', e.target.value)} rows={2} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft.is_published}
                onChange={e => set('is_published', e.target.checked)} />
              Published — make this menu visible on the website + printable
            </label>
          </div>
        </div>
      </Card>

      {/* Dietary tags */}
      <DietaryPanel allTags={draft.dietary_tags || []} />

      <VariantGroupsPanel />

      {/* Sections */}
      <SectionsPanel
        sections={draft.sections || []}
        dietaryTags={draft.dietary_tags || []}
        variantGroups={variantGroups}
        onChange={(sections) => set('sections', sections)} />

      {/* Callouts */}
      <CalloutsPanel
        callouts={draft.callouts || []}
        onChange={(callouts) => set('callouts', callouts)} />

      {/* Sticky bottom save bar (mirror of top, easier to reach when long) */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg z-20">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Unsaved changes.</span>
            <Btn disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save changes
            </Btn>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}

// ── Dietary tag panel (manages tenant's dietary tags) ──────

function DietaryPanel({ allTags }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [open, setOpen] = useState(false)
  const [newTag, setNewTag] = useState({ code: '', label: '', glyph: '', colour: '#7a1a26' })

  const create = useMutation({
    mutationFn: () => api.post('/menus/dietary', { ...newTag, sort_order: allTags.length }),
    onSuccess: () => {
      setNewTag({ code: '', label: '', glyph: '', colour: '#7a1a26' })
      // Re-fetch any menu we're editing (the GET shape includes dietary_tags)
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })
  const del = useMutation({
    mutationFn: (id) => api.delete(`/menus/dietary/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })

  return (
    <Card title="Dietary tags"
      description="Allergen / dietary badges shown next to dishes. Shared across all your menus."
      action={
        <button onClick={() => setOpen(o => !o)}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          {open ? 'Hide' : 'Manage'} {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      }>
      <div className="flex flex-wrap gap-2">
        {allTags.map(t => (
          <span key={t.id}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
            style={{ background: t.colour, color: '#fff' }}>
            <strong>{t.glyph}</strong>
            <span>{t.label}</span>
          </span>
        ))}
        {allTags.length === 0 && (
          <span className="text-xs text-muted-foreground">No dietary tags yet.</span>
        )}
      </div>
      {open && (
        <>
          <div className="border rounded-md divide-y mt-3">
            {allTags.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="inline-flex items-center justify-center text-xs font-bold w-7 h-7 rounded"
                  style={{ background: t.colour, color: '#fff' }}>{t.glyph}</span>
                <span className="font-medium flex-1">{t.label}</span>
                <code className="text-xs text-muted-foreground">{t.code}</code>
                <button onClick={() => { if (window.confirm(`Delete tag ${t.label}?`)) del.mutate(t.id) }}
                  className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {allTags.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">No dietary tags yet.</div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <Field label="Code" hint="e.g. 'gf'">
              <Input value={newTag.code}
                onChange={e => setNewTag(t => ({ ...t, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))} />
            </Field>
            <Field label="Glyph" hint="e.g. 'GF' or '🌶'">
              <Input value={newTag.glyph} onChange={e => setNewTag(t => ({ ...t, glyph: e.target.value }))} />
            </Field>
            <Field label="Label">
              <Input value={newTag.label} onChange={e => setNewTag(t => ({ ...t, label: e.target.value }))} />
            </Field>
            <Field label="Colour">
              <input type="color" value={newTag.colour}
                onChange={e => setNewTag(t => ({ ...t, colour: e.target.value }))}
                className="w-full h-9 border rounded cursor-pointer" />
            </Field>
            <Btn variant="secondary" onClick={() => create.mutate()}
              disabled={!newTag.code || !newTag.label || !newTag.glyph || create.isPending}>
              <Plus className="w-3.5 h-3.5" /> Add tag
            </Btn>
          </div>
        </>
      )}
    </Card>
  )
}

// ── Variant groups (tenant-wide reusable option sets) ───────

function emptyGroup() {
  return { name: '', options: [{ label: '', price_pence: 0 }] }
}

function VariantGroupsPanel() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: groups = [] } = useQuery({
    queryKey: ['menu-variant-groups'],
    queryFn:  () => api.get('/menus/variant-groups'),
  })
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null) // null | { id?: uuid, name, options }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name.trim(),
        sort_order: draft.id ? (groups.find(g => g.id === draft.id)?.sort_order ?? 0) : groups.length,
        options: (draft.options || [])
          .filter(o => o.label.trim())
          .map((o, i) => ({
            id: o.id,
            label: o.label.trim(),
            price_pence: o.price_pence ?? 0,
            sort_order: i,
          })),
      }
      return draft.id
        ? api.patch(`/menus/variant-groups/${draft.id}`, payload)
        : api.post('/menus/variant-groups', payload)
    },
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['menu-variant-groups'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })
  const del = useMutation({
    mutationFn: (id) => api.delete(`/menus/variant-groups/${id}`),
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['menu-variant-groups'] })
      qc.invalidateQueries({ queryKey: ['menu'] })
    },
  })

  function editGroup(g) {
    setDraft({
      id: g.id,
      name: g.name,
      options: (g.options || []).map(o => ({ ...o })),
    })
  }

  return (
    <Card title="Variant groups"
      description="Reusable option sets (Protein, Size…) you can attach to any dish. Default prices can be overridden per item."
      action={
        <button onClick={() => setOpen(o => !o)}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          {open ? 'Hide' : 'Manage'} {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      }>
      <div className="flex flex-wrap gap-2">
        {groups.map(g => (
          <span key={g.id}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-violet-100 text-violet-800">
            <Layers className="w-3 h-3" />
            {g.name}
            <span className="text-violet-500">· {(g.options || []).length}</span>
          </span>
        ))}
        {groups.length === 0 && (
          <span className="text-xs text-muted-foreground">No variant groups yet. Create “Protein” or “Size” and attach them to dishes.</span>
        )}
      </div>
      {open && (
        <div className="space-y-3 mt-3">
          <div className="border rounded-md divide-y">
            {groups.map(g => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Layers className="w-4 h-4 text-violet-600 shrink-0" />
                <span className="font-medium flex-1">{g.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(g.options || []).map(o => o.label).join(', ') || 'No options'}
                </span>
                <button onClick={() => editGroup(g)} className="text-xs text-primary hover:underline">Edit</button>
                <button onClick={() => { if (window.confirm(`Delete group "${g.name}"? Dishes will lose this group.`)) del.mutate(g.id) }}
                  className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {draft ? (
            <div className="border rounded-lg p-3 bg-violet-50/60 space-y-3">
              <Field label="Group name">
                <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Protein" autoFocus />
              </Field>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Options + default price</p>
                {(draft.options || []).map((o, i) => (
                  <div key={o.id || i} className="flex items-center gap-2">
                    <Input value={o.label}
                      onChange={e => setDraft(d => {
                        const options = d.options.slice(); options[i] = { ...options[i], label: e.target.value }
                        return { ...d, options }
                      })}
                      placeholder="Label (e.g. Chicken)" className="flex-1" />
                    <Input
                      value={o.price_pence == null ? '' : (o.price_pence / 100).toFixed(2)}
                      onChange={e => setDraft(d => {
                        const options = d.options.slice()
                        options[i] = { ...options[i], price_pence: parsePrice(e.target.value) ?? 0 }
                        return { ...d, options }
                      })}
                      placeholder="£0.00" className="w-28 font-mono" />
                    <button onClick={() => setDraft(d => ({ ...d, options: d.options.filter((_, j) => j !== i) }))}
                      className="text-destructive hover:bg-destructive/10 p-1 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setDraft(d => ({ ...d, options: [...d.options, { label: '', price_pence: 0 }] }))}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add option
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <Btn variant="secondary" onClick={() => setDraft(null)}>Cancel</Btn>
                <Btn disabled={!draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {draft.id ? 'Save group' : 'Create group'}
                </Btn>
              </div>
              {save.isError && (
                <p className="text-xs text-destructive">{save.error?.body?.error || 'Save failed'}</p>
              )}
            </div>
          ) : (
            <Btn variant="secondary" onClick={() => setDraft(emptyGroup())}>
              <Plus className="w-3.5 h-3.5" /> New variant group
            </Btn>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Sections + items panel ──────────────────────────────────

function SectionsPanel({ sections, dietaryTags, variantGroups, onChange }) {
  const set = (i, patch) => {
    const next = sections.slice(); next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const setItems = (i, items) => set(i, { items })
  const addSection = () => onChange([...sections, { title: 'New section', subtitle: '', highlight: false, items: [] }])
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
              <SectionEditor key={i} section={s}
                index={i} total={sections.length}
                dietaryTags={dietaryTags}
                variantGroups={variantGroups}
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

function SectionEditor({ section, index, total, dietaryTags, variantGroups, onChange, onRemove, onMoveUp, onMoveDown, onItemsChange }) {
  const [open, setOpen] = useState(true)
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
        <div className="p-3 space-y-2">
          <ItemsEditor items={section.items || []}
            dietaryTags={dietaryTags}
            variantGroups={variantGroups}
            onChange={onItemsChange} />
        </div>
      )}
    </div>
  )
}

function ItemsEditor({ items, dietaryTags, variantGroups, onChange }) {
  const set = (i, patch) => {
    const next = items.slice(); next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const addItem = () => onChange([...items, {
    name: 'New dish', native_name: '', description: '',
    price_pence: null, notes: '', is_featured: false, image_url: null,
    variants: [], variant_groups: [], dietary: [],
  }])
  const removeItem = (i) => onChange(items.filter((_, j) => j !== i))
  const moveItem = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= items.length) return
    const next = items.slice();[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((it, i) => (
          <ItemEditor key={i} item={it}
            index={i} total={items.length}
            dietaryTags={dietaryTags}
            variantGroups={variantGroups}
            onChange={(patch) => set(i, patch)}
            onRemove={() => removeItem(i)}
            onMoveUp={() => moveItem(i, -1)}
            onMoveDown={() => moveItem(i, 1)} />
        ))}
      </div>
      <button onClick={addItem}
        className="w-full text-xs border-2 border-dashed border-amber-300 rounded-md py-2 text-amber-800/70 hover:bg-amber-100 hover:text-amber-900 bg-amber-50/40">
        + Add dish
      </button>
    </>
  )
}

function ItemImagePicker({ url, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="relative shrink-0">
        <button type="button" onClick={() => setOpen(true)}
          className="w-14 h-14 rounded-md border border-amber-300 overflow-hidden bg-white flex items-center justify-center hover:border-primary">
          {url
            ? <img src={url} alt="" className="w-full h-full object-cover" />
            : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
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

function ItemEditor({ item, index, total, dietaryTags, variantGroups = [], onChange, onRemove, onMoveUp, onMoveDown }) {
  const setVariants = (variants) => onChange({ variants })
  const toggleDietary = (code) => {
    const set = new Set(item.dietary || [])
    if (set.has(code)) set.delete(code); else set.add(code)
    onChange({ dietary: Array.from(set) })
  }
  const addVariant = () => setVariants([...(item.variants || []), { label: '', price_pence: 0 }])
  const setVariant = (i, patch) => {
    const next = (item.variants || []).slice(); next[i] = { ...next[i], ...patch }; setVariants(next)
  }
  const removeVariant = (i) => setVariants((item.variants || []).filter((_, j) => j !== i))

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
    <div className="border border-amber-200 rounded-md p-3 bg-amber-50 space-y-2">
      <div className="flex items-start gap-2">
        <ItemImagePicker url={item.image_url || null} onChange={(image_url) => onChange({ image_url })} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
          <Input value={item.name} onChange={e => onChange({ name: e.target.value })}
            placeholder="Dish name" className="font-medium bg-white" />
          <Input value={item.native_name || ''} onChange={e => onChange({ native_name: e.target.value })}
            placeholder="Native script (optional)" className="bg-white" />
          <Input
            value={item.price_pence == null ? '' : (item.price_pence / 100).toFixed(2)}
            onChange={e => onChange({ price_pence: parsePrice(e.target.value) })}
            placeholder="£0.00 (single price)"
            className="font-mono bg-white" />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onMoveUp}   disabled={index === 0}        className="text-xs px-2 disabled:opacity-30">↑</button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="text-xs px-2 disabled:opacity-30">↓</button>
          <button onClick={onRemove} className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <TextArea value={item.description || ''} onChange={e => onChange({ description: e.target.value })}
        rows={2} placeholder="Description" className="bg-white" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={!!item.is_featured}
            onChange={e => onChange({ is_featured: e.target.checked })} />
          House favourite
        </label>
        <Input value={item.notes || ''} onChange={e => onChange({ notes: e.target.value })}
          placeholder="Notes (e.g. 'Min 2', 'pp')" className="max-w-[220px] bg-white" />

        <div className="flex flex-wrap gap-1.5 ml-auto">
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

      {/* Attached variant groups */}
      <div className="border-t border-amber-200/80 pt-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase font-semibold text-amber-900/70 tracking-wide">
            Variant groups
          </span>
          {availableGroups.length > 0 && (
            <select
              value=""
              onChange={e => { attachGroup(e.target.value); e.target.value = '' }}
              className="text-xs border rounded-md px-2 py-1 bg-white min-h-[28px]">
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
              ? 'No groups on this dish. Attach Protein / Size from the dropdown, or add a one-off variant below.'
              : 'Create a variant group above, then attach it here.'}
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
                  <Input
                    value={(o.price_pence ?? 0) / 100}
                    type="number" step="0.10"
                    onChange={e => setOverride(g.group_id, o.option_id, parsePrice(e.target.value) ?? 0, o.default_pence)}
                    className={cn('w-24 font-mono bg-white text-xs', o.overridden && 'border-violet-400')}
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

      {/* Ad-hoc variants */}
      <div className="border-t border-amber-200/80 pt-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-semibold text-amber-900/70 tracking-wide">
            One-off variants {item.variants?.length ? `· ${item.variants.length}` : '(optional)'}
          </span>
          <button onClick={addVariant} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add variant
          </button>
        </div>
        {(item.variants || []).map((v, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <Input value={v.label} onChange={e => setVariant(i, { label: e.target.value })}
              placeholder="Label (e.g. Extra chilli)" className="flex-1 bg-white" />
            <Input value={(v.price_pence ?? 0) / 100} type="number" step="0.10"
              onChange={e => setVariant(i, { price_pence: parsePrice(e.target.value) ?? 0 })}
              className="w-28 font-mono bg-white" />
            <button onClick={() => removeVariant(i)}
              className="text-destructive hover:bg-destructive/10 p-1 rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
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
