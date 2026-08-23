// Shared link selector for the website builder.
// Stores a plain href string:
//   #hours                  this-page anchor
//   /p/events               standalone page
//   /p/events#hours         page + anchor
//   #modal/allergens        modal page
//   #modal/allergens:hours  modal + inner anchor
//   https://…               custom / external
//   /menu  /  /locations    built-ins

import { useContext, useMemo, useState, createContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Link2, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { collectAnchors } from './blockRegistry'
import { cn } from '@/lib/utils'

export const LinkCatalogContext = createContext({
  currentBlocks: [],
  currentLabel: 'This page',
  homeBlocks: [],
  venueSlug: null,
  venueId: null,
})

export function LinkCatalogProvider({ value, children }) {
  return (
    <LinkCatalogContext.Provider value={value}>
      {children}
    </LinkCatalogContext.Provider>
  )
}

function pageHref(p, venueSlug, anchor) {
  if (p.kind === 'modal') {
    return anchor ? `#modal/${p.slug}:${anchor}` : `#modal/${p.slug}`
  }
  const base = p.venue_id && venueSlug
    ? `/locations/${venueSlug}/p/${p.slug}`
    : `/p/${p.slug}`
  return anchor ? `${base}#${anchor}` : base
}

function summarise(href, pages, currentAnchors) {
  const v = String(href || '')
  if (!v) return 'Choose a link…'
  if (v.startsWith('#modal/')) {
    const rest = v.slice('#modal/'.length)
    const [slug, a] = rest.split(':')
    const p = pages.find(x => x.slug === slug && x.kind === 'modal')
    const title = p?.title || slug
    return a ? `${title} · #${a}` : `${title} (modal)`
  }
  if (v.startsWith('#')) {
    const a = v.slice(1)
    const hit = currentAnchors.find(x => x.id === a)
    return hit ? `This page · ${hit.label}` : `This page · #${a}`
  }
  const [path, hash] = v.split('#')
  const p = pages.find(x => {
    const h = pageHref(x, null)
    const hv = x.venue_id ? pageHref(x, 'VENUE') : h
    return path === h || path.endsWith(`/p/${x.slug}`)
  })
  if (p) return hash ? `${p.title} · #${hash}` : p.title
  if (path === '/') return hash ? `Home · #${hash}` : 'Home'
  if (path === '/menu') return hash ? `Menu · #${hash}` : 'Menu'
  if (path === '/locations') return hash ? `Locations · #${hash}` : 'Locations'
  return v
}

export function LinkPicker({ value, onChange, placeholder = '/path or #anchor', className = '' }) {
  const api = useApi()
  const catalog = useContext(LinkCatalogContext)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')

  const { data: tenantPages = [] } = useQuery({
    queryKey: ['website-pages', 'tenant'],
    queryFn:  () => api.get('/website/pages?venue_id=tenant'),
    staleTime: 15_000,
  })
  const { data: venuePages = [] } = useQuery({
    queryKey: ['website-pages', catalog.venueId],
    queryFn:  () => api.get(`/website/pages?venue_id=${catalog.venueId}`),
    enabled:  !!catalog.venueId,
    staleTime: 15_000,
  })

  const pages = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const p of [...tenantPages, ...venuePages]) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }, [tenantPages, venuePages])

  const currentAnchors = useMemo(
    () => collectAnchors(catalog.currentBlocks),
    [catalog.currentBlocks],
  )
  const homeAnchors = useMemo(
    () => collectAnchors(catalog.homeBlocks),
    [catalog.homeBlocks],
  )

  const standalone = pages.filter(p => p.kind !== 'modal')
  const modals     = pages.filter(p => p.kind === 'modal')

  function pick(href) {
    onChange(href)
    setOpen(false)
  }

  const label = summarise(value, pages, currentAnchors)

  return (
    <div className={cn('relative', className)}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full text-left text-sm border rounded-md px-2 py-1.5 min-h-[36px] bg-background inline-flex items-center gap-2 hover:bg-accent/40">
        <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className={cn('flex-1 truncate', value ? '' : 'text-muted-foreground')}>{value ? label : placeholder}</span>
        {value ? (
          <span role="button" tabIndex={0}
            onClick={e => { e.stopPropagation(); onChange('') }}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </span>
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-[min(100%,22rem)] max-h-[min(70vh,28rem)] overflow-y-auto bg-background border rounded-lg shadow-xl p-2 text-sm">
            <Group title={catalog.currentLabel || 'This page'}>
              <Row label="Top of this page (no section)" hint="#" onClick={() => pick('#')} />
              {currentAnchors.map(a => (
                <Row key={a.id} label={a.label} hint={`#${a.id}`}
                  onClick={() => pick(`#${a.id}`)} />
              ))}
              {currentAnchors.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No anchors on this page yet. Set Anchor ID on a block.</p>
              )}
            </Group>

            <Group title="Site pages">
              <Row label="Home" hint="/" onClick={() => pick('/')} />
              {homeAnchors.length > 0 && catalog.currentLabel !== 'Home' && homeAnchors.map(a => (
                <Row key={`home-${a.id}`} label={`Home · ${a.label}`} hint={`/#${a.id}`}
                  indent onClick={() => pick(`/#${a.id}`)} />
              ))}
              <Row label="Menu" hint="/menu" onClick={() => pick('/menu')} />
              <Row label="Locations" hint="/locations" onClick={() => pick('/locations')} />
              {standalone.map(p => {
                const href = pageHref(p, catalog.venueSlug)
                const anchors = collectAnchors(p.blocks)
                return (
                  <div key={p.id}>
                    <Row label={p.title} hint={href} onClick={() => pick(href)} />
                    {anchors.map(a => (
                      <Row key={`${p.id}-${a.id}`} label={a.label} hint={`${href}#${a.id}`}
                        indent onClick={() => pick(`${href}#${a.id}`)} />
                    ))}
                  </div>
                )
              })}
            </Group>

            <Group title="Modals">
              {modals.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No modals yet. Create one under Pages.</p>
              ) : modals.map(p => {
                const href = pageHref(p, catalog.venueSlug)
                const anchors = collectAnchors(p.blocks)
                return (
                  <div key={p.id}>
                    <Row label={p.title} hint="opens as overlay" onClick={() => pick(href)} />
                    {anchors.map(a => (
                      <Row key={`${p.id}-${a.id}`} label={a.label} hint={`#modal/${p.slug}:${a.id}`}
                        indent onClick={() => pick(`#modal/${p.slug}:${a.id}`)} />
                    ))}
                  </div>
                )
              })}
            </Group>

            <Group title="Custom URL">
              <div className="flex gap-1 px-1 pb-1">
                <input
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) pick(custom.trim()) }}
                  placeholder="https://…  or  /path"
                  className="flex-1 text-xs border rounded-md px-2 py-1.5 font-mono min-h-[32px]"
                />
                <button type="button" onClick={() => { if (custom.trim()) pick(custom.trim()) }}
                  className="text-xs px-2 rounded-md bg-primary text-primary-foreground">Use</button>
              </div>
            </Group>
          </div>
        </>
      )}
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function Row({ label, hint, onClick, indent }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'w-full text-left px-2 py-1.5 rounded hover:bg-accent flex items-baseline gap-2 min-h-[32px]',
        indent && 'pl-5',
      )}>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[45%]">{hint}</span>}
    </button>
  )
}
