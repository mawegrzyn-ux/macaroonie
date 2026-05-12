// canvas/dataBlocks.jsx
//
// Faithful previews for the "data" / dynamic block types — gallery,
// opening_hours, find_us, contact, menu_pdfs, allergens, menu_inline,
// booking_widget. Each fetches its real data via TanStack Query (or
// reads from the config prop the parent already passed in) and renders
// the same shape the SSR Eta partial does. When data is missing or
// loading we show an inline placeholder pointing the operator at the
// admin section that owns that data.
//
// The previous shared DataPlaceholderCanvas has been replaced. Each
// block now has its own canvas component registered in canvasRegistry.

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { ImageIcon, Clock, MapPin, Phone, BookOpen, AlertTriangle, Loader2, Calendar } from 'lucide-react'
import { InlineText } from './InlineText'

// ── Shared helpers ────────────────────────────────────────

function innerContainerStyle(width) {
  switch (width) {
    case 'wide': return { maxWidth: 1400, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
    case 'full': return { maxWidth: 'none', width: '100%', paddingLeft: 24, paddingRight: 24 }
    default:     return { maxWidth: 'var(--cw)', marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
  }
}

// Generic dashed-border placeholder shown when a block has no data yet.
function EmptyPanel({ Icon, title, hint, where }) {
  return (
    <div style={{
      padding: '36px 24px', textAlign: 'center',
      background: 'repeating-linear-gradient(45deg, rgba(99,8,18,0.025) 0 12px, transparent 12px 24px)',
      border: '1px dashed rgba(99,8,18,0.25)',
      borderRadius: 'var(--r-md, 8px)', margin: '0 24px',
    }}>
      {Icon && <Icon size={20} style={{ color: 'var(--c-primary)', margin: '0 auto 8px' }} />}
      <p style={{ fontFamily: 'var(--f-heading)', color: 'var(--c-primary)', margin: '0 0 4px', fontWeight: 500 }}>
        {title}
      </p>
      <p style={{ color: 'var(--c-muted)', fontSize: 13, margin: 0 }}>
        {hint}
        {where && <em> · {where}</em>}
      </p>
    </div>
  )
}

function formatPrice(pence) {
  if (pence == null) return ''
  return '£' + (Number(pence) / 100).toFixed(2)
}

// Heading helper — block.data.heading + InlineText edit.
function BlockHeading({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <InlineText as="h2"
      value={data.heading}
      onChange={set('heading')}
      placeholder="Heading"
      style={{ fontFamily: 'var(--f-heading)', textAlign: 'center', margin: '0 0 28px', color: 'var(--c-primary)', fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }} />
  )
}

// ── Find us ───────────────────────────────────────────────

export function FindUsCanvas({ data, onChange, config }) {
  const c = config || {}
  const addressLines = [
    c.address_line1, c.address_line2,
    [c.city, c.postcode].filter(Boolean).join(' '),
  ].filter(Boolean)
  const has = addressLines.length > 0 || c.google_maps_embed_url
  return (
    <section className="block" style={{ padding: '48px 0', background: 'var(--c-surface)' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {has ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div>
              {addressLines.map((line, i) => (
                <p key={i} style={{ margin: 0, fontSize: 17, lineHeight: 1.6 }}>{line}</p>
              ))}
              {c.phone && <p style={{ marginTop: 12 }}><strong>Phone:</strong> <span style={{ color: 'var(--c-primary)' }}>{c.phone}</span></p>}
              {c.email && <p><strong>Email:</strong> <span style={{ color: 'var(--c-primary)' }}>{c.email}</span></p>}
            </div>
            <div style={{
              borderRadius: 'var(--r-md, 8px)', overflow: 'hidden', minHeight: 240,
              background: c.google_maps_embed_url ? 'transparent' : 'rgba(0,0,0,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--c-muted)', fontSize: 13,
            }}>
              {c.google_maps_embed_url
                ? <iframe src={c.google_maps_embed_url} style={{ width: '100%', height: '100%', minHeight: 240, border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                : <span style={{ fontStyle: 'italic' }}>Map will appear here when Google Maps embed URL is set in Find us section.</span>}
            </div>
          </div>
        ) : (
          <EmptyPanel Icon={MapPin} title="Find us"
            hint="No address yet."
            where="Set in Find us section of this venue's location page" />
        )}
      </div>
    </section>
  )
}

// ── Contact ──────────────────────────────────────────────

export function ContactCanvas({ data, onChange, config }) {
  const c = config || {}
  const social = c.social_links || {}
  const SOCIAL_LABELS = { instagram: 'Instagram', facebook: 'Facebook', x: 'X / Twitter', tiktok: 'TikTok', youtube: 'YouTube' }
  const has = c.phone || c.email || Object.values(social).some(v => v)
  return (
    <section className="block" style={{ padding: '48px 0' }}>
      <div style={innerContainerStyle(data.container)}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <BlockHeading data={data} onChange={onChange} />
          {has ? (
            <>
              {c.phone && <p style={{ fontSize: 17, margin: '0 0 6px' }}><span style={{ color: 'var(--c-primary)' }}>{c.phone}</span></p>}
              {c.email && <p style={{ fontSize: 17, margin: '0 0 12px' }}><span style={{ color: 'var(--c-primary)' }}>{c.email}</span></p>}
              <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
                {Object.entries(SOCIAL_LABELS).map(([k, label]) => social[k] && (
                  <span key={k} style={{ color: 'var(--c-primary)', textDecoration: 'underline', fontWeight: 600 }}>
                    {label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel Icon={Phone} title="Contact"
              hint="No phone, email, or social links yet."
              where="Set in Contact section / Brand identity" />
          )}
        </div>
      </div>
    </section>
  )
}

// ── Gallery ──────────────────────────────────────────────

export function GalleryCanvas({ data, onChange }) {
  // Resolves the same way the SSR partial does — the user's selection
  // (category or hand-picked items) is fetched from the Media library so
  // the canvas preview matches the live render exactly.
  const api = useApi()
  const source     = data.source || 'category'
  const categoryId = data.category_id || null
  const itemIds    = Array.isArray(data.item_ids) ? data.item_ids : []
  const layout     = data.layout || 'grid'
  const cols       = Math.max(2, Math.min(4, data.columns || 3))
  const gapMap     = { tight: 8, normal: 16, wide: 24 }
  const gap        = gapMap[data.gap || 'normal'] || 16
  const aspect     = data.aspect || 'square'

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media-items', { categoryId: source === 'category' ? categoryId : null }],
    queryFn:  () => {
      const qs = source === 'category' && categoryId
        ? '?category_id=' + encodeURIComponent(categoryId) : ''
      return api.get('/media/items' + qs)
    },
    staleTime: 30_000,
  })

  // Filter to images & honour the source mode + max_items cap.
  let resolved = items.filter(i => /^image\//.test(i.mimetype || ''))
  if (source === 'items') {
    const byId = Object.fromEntries(resolved.map(i => [i.id, i]))
    resolved = itemIds.map(id => byId[id]).filter(Boolean)
  }
  if (data.max_items && resolved.length > data.max_items) {
    resolved = resolved.slice(0, data.max_items)
  }

  const aspectStyle = aspect === '4:3'  ? { aspectRatio: '4 / 3' }
                    : aspect === '16:9' ? { aspectRatio: '16 / 9' }
                    : aspect === 'natural' ? {}
                    : { aspectRatio: '1 / 1' }

  const gridStyle = layout === 'masonry'
    ? { columnCount: cols, columnGap: gap }
    : layout === 'horizontal'
      ? { display: 'flex', gap, overflowX: 'auto', paddingBottom: 8 }
      : { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }

  return (
    <section className="block" style={{ padding: '48px 0', background: 'var(--c-surface)' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : resolved.length === 0 ? (
          <EmptyPanel Icon={ImageIcon} title="Gallery"
            hint={source === 'items'
              ? 'No images selected.'
              : (categoryId ? 'No images in this category.' : 'No images in your Media library.')}
            where="Configure the gallery in the inspector or upload images on the Media page" />
        ) : (
          <div style={gridStyle}>
            {resolved.map(img => {
              const wrap = layout === 'masonry'
                ? { breakInside: 'avoid', marginBottom: gap, display: 'block' }
                : layout === 'horizontal'
                  ? { flex: '0 0 220px' }
                  : {}
              return (
                <div key={img.id} style={{
                  position: 'relative', overflow: 'hidden',
                  borderRadius: 'var(--r-md, 8px)',
                  background: 'var(--c-bg)',
                  ...wrap,
                }}>
                  <img src={img.url} alt={img.filename || ''} loading="lazy"
                    style={{
                      display: 'block', width: '100%',
                      objectFit: 'cover',
                      ...(layout === 'masonry' && aspect === 'natural'
                        ? { height: 'auto' }
                        : aspectStyle),
                    }} />
                  {data.show_captions && img.filename && (
                    <span style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '8px 10px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      color: '#fff', fontSize: 13,
                    }}>{img.filename}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Opening hours ────────────────────────────────────────

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

export function OpeningHoursCanvas({ data, onChange, config }) {
  const api = useApi()
  const venueId = config?.venue_id
  const { data: hours = [], isLoading } = useQuery({
    queryKey: ['hours-preview', venueId],
    queryFn:  () => api.get(venueId ? `/website/opening-hours?venue_id=${venueId}` : '/website/opening-hours'),
    enabled:  !!venueId,
    staleTime: 30_000,
  })
  return (
    <section className="block" style={{ padding: '48px 0', background: 'var(--c-surface)' }}>
      <div style={innerContainerStyle(data.container)}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <BlockHeading data={data} onChange={onChange} />
          {!venueId ? (
            <EmptyPanel Icon={Clock} title="Opening hours"
              hint="Hours live per-location."
              where="Add to a venue's location page" />
          ) : isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : hours.length === 0 ? (
            <EmptyPanel Icon={Clock} title="Opening hours"
              hint="No hours set yet."
              where="Set in Opening hours section of this venue" />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 0].map(d => {
                  const rows = hours.filter(h => h.day_of_week === d)
                  const closed = rows.length === 0 || rows.every(r => r.is_closed)
                  return (
                    <tr key={d} style={{ borderBottom: '1px solid var(--c-border)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--c-muted)' }}>{DAYS[d]}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', opacity: closed ? 0.5 : 1 }}>
                        {closed
                          ? 'Closed'
                          : rows.filter(r => !r.is_closed).map(r => `${(r.opens_at || '').slice(0,5)}–${(r.closes_at || '').slice(0,5)}`).join(', ')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Menu PDFs ────────────────────────────────────────────

export function MenuPdfsCanvas({ data, onChange, config }) {
  const api = useApi()
  const venueId = config?.venue_id
  const { data: menus = [], isLoading } = useQuery({
    queryKey: ['menu-pdfs-preview', venueId],
    queryFn:  () => api.get(venueId ? `/website/menus?venue_id=${venueId}` : '/website/menus'),
    enabled:  !!venueId,
    staleTime: 30_000,
  })
  return (
    <section className="block" style={{ padding: '48px 0' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {!venueId ? (
          <EmptyPanel Icon={BookOpen} title="Menus (PDFs)"
            hint="PDF menus live per-location."
            where="Upload via Menus (PDF) section of this venue" />
        ) : isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : menus.length === 0 ? (
          <EmptyPanel Icon={BookOpen} title="Menus (PDFs)"
            hint="No PDF menus uploaded yet."
            where="Upload via Menus (PDF) section" />
        ) : (
          <div style={{
            display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap',
          }}>
            {menus.map(m => (
              <span key={m.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '12px 22px', borderRadius: 999,
                background: 'var(--c-primary)', color: '#fff',
                fontWeight: 500, fontSize: 14,
              }}>
                <BookOpen size={14} /> {m.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Allergens ────────────────────────────────────────────

export function AllergensCanvas({ data, onChange, config }) {
  const api = useApi()
  const venueId = config?.venue_id
  const { data: allergens = {}, isLoading } = useQuery({
    queryKey: ['allergens-preview', venueId],
    queryFn:  () => api.get(venueId ? `/website/allergens?venue_id=${venueId}` : '/website/allergens'),
    enabled:  !!venueId,
    staleTime: 30_000,
  })
  const items = allergens?.structured_data || []
  return (
    <section className="block" style={{ padding: '48px 0' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {!venueId ? (
          <EmptyPanel Icon={AlertTriangle} title="Allergens"
            hint="Allergen info lives per-location."
            where="Set in Allergens section" />
        ) : isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : allergens.info_type === 'document' && allergens.document_url ? (
          <div style={{ textAlign: 'center' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 22px', borderRadius: 999,
              background: 'var(--c-primary)', color: '#fff', fontWeight: 500,
            }}>
              <BookOpen size={14} /> Download allergen info
            </span>
          </div>
        ) : items.length > 0 ? (
          <table style={{ width: '100%', maxWidth: 800, margin: '0 auto', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--c-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Dish</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Allergens</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 6).map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '8px 12px' }}>{row.dish}</td>
                  <td style={{ padding: '8px 12px' }}>{(row.allergens || []).join(', ')}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--c-muted)' }}>{row.notes || ''}</td>
                </tr>
              ))}
              {items.length > 6 && (
                <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: 'var(--c-muted)', fontSize: 13 }}>+{items.length - 6} more rows</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <EmptyPanel Icon={AlertTriangle} title="Allergens"
            hint="No allergen info yet."
            where="Set in Allergens section" />
        )}
      </div>
    </section>
  )
}

// ── Booking widget ───────────────────────────────────────

export function ReservationsWidgetCanvas({ data, onChange, config }) {
  const api = useApi()
  // Embeds the SAME /reservations/{id} iframe that ships on the live site.
  // Single source of truth — what you see here is what visitors see.
  // Resolution order matches the SSR partial (booking_widget.eta):
  //   1. block-level override (data.venue_id)
  //   2. on a location page: the venue this config row belongs to
  //   3. tenant default_widget_venue_id
  //   4. tenant mode with location picker
  //
  // We need the tenant_site row regardless of which page-builder context
  // we're in (tenant home OR per-venue page) — both for the
  // default_widget_venue_id fallback AND for the subdomain_slug we use
  // to build the iframe's absolute URL (see widgetOrigin below).
  const { data: tenantSite } = useQuery({
    queryKey: ['tenant-site'],
    queryFn:  () => api.get('/website/tenant-site'),
    staleTime: 60_000,
  })
  const ts          = tenantSite || (config && config.template_key !== undefined ? config : null)
  const tenantId    = (ts && ts.tenant_id) || (config && config.tenant_id) || null
  const venueId     = data.venue_id
                   || (config && config.venue_id)
                   || (ts && ts.default_widget_venue_id)
                   || null

  // Where to point the iframe at. The page-builder admin runs on the
  // apex domain (macaroonie.com) which doesn't proxy /reservations/* by
  // default — relative URLs hit the SPA's catch-all and render blank.
  // The tenant subdomain (e.g. onethai.macaroonie.com) DOES proxy
  // everything through the wildcard server block, so use that as the
  // iframe origin in production. Localhost relies on Vite's /widget proxy.
  const widgetOrigin = (() => {
    if (typeof window === 'undefined') return ''
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') return ''  // Vite proxy handles it
    if (!ts?.subdomain_slug) return ''                            // Caller hasn't set one yet
    // Strip leading subdomain to get the apex (admin may run on
    // either macaroonie.com or app.macaroonie.com — both reduce to
    // macaroonie.com via the last-two-parts heuristic).
    const parts = host.split('.')
    const apex  = parts.length >= 2 ? parts.slice(-2).join('.') : host
    return `${window.location.protocol}//${ts.subdomain_slug}.${apex}`
  })()

  // Surface + text colours from the theme so the widget melts into the
  // canvas card visually — same params the SSR block partial sends.
  const theme       = (config && config.theme) || {}
  const surfaceHex  = (theme.colors?.surface || '').replace(/^#/, '')
  const textHex     = (theme.colors?.text    || '').replace(/^#/, '')
  const accentHex   = (theme.colors?.primary || config?.primary_colour || '').replace(/^#/, '')

  let widgetSrc = null
  const qp = new URLSearchParams()
  qp.set('theme', config?.widget_theme || 'light')
  if (accentHex)  qp.set('accent', accentHex)
  if (surfaceHex) qp.set('bg',     surfaceHex)
  if (textHex)    qp.set('text',   textHex)

  // Per-block widget chrome overrides — match what the SSR partial sends.
  // Colour fields are theme role names; resolve to hex (the widget URL
  // params only accept hex, the widget itself paints CSS custom props).
  const stripHash = (s) => (typeof s === 'string' ? s.replace(/^#/, '') : '')
  const ROLE_HEX = {
    primary: '#630812', accent: '#f4a7b9', background: '#ffffff',
    surface: '#f9f6f1', text: '#1a1a1a', muted: '#666666', border: '#e5e7eb',
  }
  const colours = (theme && theme.colors) || {}
  const roleToHex = (val) => {
    if (!val || typeof val !== 'string') return null
    if (/^#?[0-9a-fA-F]{6}$/.test(val)) return stripHash(val)
    const hex = colours[val] || ROLE_HEX[val]
    return hex ? stripHash(hex) : null
  }

  if (data.header_show === false) qp.set('headerShow', '0')
  if (data.header_show === true)  qp.set('headerShow', '1')
  if (data.header_text)    qp.set('header', data.header_text)
  if (data.subheader_text) qp.set('sub',    data.subheader_text)
  const bgHex  = roleToHex(data.button_bg)
  const fgHex  = roleToHex(data.button_fg)
  const brdHex = roleToHex(data.border_colour)
  if (bgHex)  qp.set('btnBg', bgHex)
  if (fgHex)  qp.set('btnFg', fgHex)
  if (brdHex) qp.set('brd',   brdHex)
  if (typeof data.button_radius_px === 'number') qp.set('btnR',  String(data.button_radius_px))
  if (typeof data.card_radius_px   === 'number') qp.set('cardR', String(data.card_radius_px))
  if (data.font_family)    qp.set('font', data.font_family)
  if (typeof data.font_size_px === 'number')           qp.set('fontS',   String(data.font_size_px))
  if (data.font_calendar_family) qp.set('calFont',  data.font_calendar_family)
  if (typeof data.font_calendar_size_px === 'number') qp.set('calSz',   String(data.font_calendar_size_px))
  if (data.font_slots_family)    qp.set('slotFont', data.font_slots_family)
  if (typeof data.font_slots_size_px    === 'number') qp.set('slotSz',  String(data.font_slots_size_px))
  // Calendar day colours (role names → hex for the URL)
  const coBg = roleToHex(data.cal_open_bg);     if (coBg) qp.set('coBg', coBg)
  const coFg = roleToHex(data.cal_open_fg);     if (coFg) qp.set('coFg', coFg)
  const coBd = roleToHex(data.cal_open_border); if (coBd) qp.set('coBd', coBd)
  const ccBg = roleToHex(data.cal_closed_bg);     if (ccBg) qp.set('ccBg', ccBg)
  const ccFg = roleToHex(data.cal_closed_fg);     if (ccFg) qp.set('ccFg', ccFg)
  const ccBd = roleToHex(data.cal_closed_border); if (ccBd) qp.set('ccBd', ccBd)
  if (data.large_party_text) qp.set('lp', data.large_party_text)
  if (data.debug_enabled === true)  qp.set('debug', '1')
  if (data.debug_enabled === false) qp.set('debug', '0')

  if (venueId) {
    widgetSrc = `${widgetOrigin}/reservations/${venueId}?${qp.toString()}`
  } else if (tenantId) {
    widgetSrc = `${widgetOrigin}/reservations/tenant/${tenantId}?${qp.toString()}`
  }

  // Anchor id — operator-defined, falls back to "reservations". Same
  // sanitisation as the SSR partial (alphanumeric + dashes/underscores).
  const safeAnchor = String(data.anchor_id || '')
    .replace(/^#/, '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
  const sectionId = safeAnchor || 'reservations'

  return (
    <section className="block" id={sectionId} style={{ padding: '64px 0', background: 'var(--c-surface)' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {widgetSrc ? (
          <iframe
            src={widgetSrc}
            title="Booking widget preview"
            loading="lazy"
            style={{
              display: 'block',
              width: '100%', maxWidth: 640, margin: '0 auto',
              minHeight: 640, border: 0,
              borderRadius: 'var(--r-md, 8px)',
              background: surfaceHex ? `#${surfaceHex}` : 'transparent',
            }}
          />
        ) : (
          <EmptyPanel Icon={Calendar} title="Booking widget"
            hint="No venue resolved."
            where="Pick a venue on the block, set a default on the tenant site, or attach a venue to this page" />
        )}
      </div>
    </section>
  )
}

// ── Menu (inline) ────────────────────────────────────────

export function MenuInlineCanvas({ data, onChange }) {
  const api = useApi()
  const { data: menu, isLoading } = useQuery({
    queryKey: ['menu', data.menu_id],
    queryFn:  () => api.get(`/menus/${data.menu_id}`),
    enabled:  !!data.menu_id,
    staleTime: 30_000,
  })
  const tagsByCode = menu ? Object.fromEntries((menu.dietary_tags || []).map(t => [t.code, t])) : {}

  // Layout — block override beats menu default. Capped at 4 to match SSR.
  const colOverride = typeof data.columns === 'number' ? data.columns : null
  const cols = menu
    ? Math.max(1, Math.min(4, colOverride || menu.print_columns || 3))
    : 1
  const direction       = data.direction === 'rows' ? 'rows' : 'columns'
  const showHeaders     = data.show_section_headers !== false
  const showSubheader   = data.show_subheader      !== false
  const subheaderText   = (data.subheader_text || '').trim() || (menu && menu.tagline) || ''

  // Block-level filters — match the SSR partial exactly so the canvas
  // preview reflects what the live site will render.
  const sectionFilter = Array.isArray(data.section_ids) ? data.section_ids : []
  const itemFilter    = Array.isArray(data.item_ids)    ? data.item_ids    : []
  const hidePrices    = !!data.hide_prices
  const filteredSections = (menu?.sections || [])
    .filter(s => sectionFilter.length === 0 || sectionFilter.includes(s.id))
    .map(s => ({
      ...s,
      items: (s.items || []).filter(it => itemFilter.length === 0 || itemFilter.includes(it.id)),
    }))
    .filter(s => s.items.length > 0)

  const containerStyle = direction === 'rows'
    ? { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '36px 48px', alignItems: 'start' }
    : { columnCount: cols, columnGap: 48, columnFill: 'balance' }

  return (
    <section className="block" style={{ padding: '64px 0' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {!data.menu_id ? (
          <EmptyPanel Icon={BookOpen} title="Menu"
            hint="No menu picked."
            where="Pick one in the inspector" />
        ) : isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : !menu ? (
          <EmptyPanel Icon={BookOpen} title="Menu" hint="Menu not found." where="Check that the menu still exists" />
        ) : (
          <>
            {showSubheader && subheaderText && (
              <p style={{ textAlign: 'center', fontFamily: 'Caveat, var(--f-heading), cursive', fontSize: '1.3rem', color: 'var(--c-primary)', margin: '-16px 0 24px' }}>
                {subheaderText}
              </p>
            )}
            {menu.intro_line && (
              <p style={{ textAlign: 'center', color: 'var(--c-muted)', maxWidth: 640, margin: '0 auto 32px', fontSize: '0.95rem' }}>
                {menu.intro_line}
              </p>
            )}
            <div style={containerStyle}>
              {filteredSections.map(s => (
                <div key={s.id} style={{ breakInside: 'avoid', marginBottom: direction === 'rows' ? 0 : 36 }}>
                  {showHeaders && (
                    <h3 style={{
                      fontFamily: 'var(--f-heading)', color: 'var(--c-primary)',
                      fontSize: '1.2rem', fontWeight: 600,
                      paddingBottom: 8, borderBottom: '1px solid var(--c-border)',
                      margin: '0 0 16px', display: 'flex',
                      alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
                    }}>
                      <span>{s.title}</span>
                      {s.subtitle && <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--c-muted)', fontStyle: 'italic' }}>{s.subtitle}</span>}
                    </h3>
                  )}
                  {(s.items || []).map(item => (
                    <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px dotted var(--c-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div>
                          <span style={{ fontFamily: 'var(--f-heading)', fontSize: '1rem', fontWeight: 500 }}>
                            {item.name}
                          </span>
                          {item.native_name && (
                            <span style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--c-muted)', fontSize: '0.85rem', marginLeft: 6 }}>
                              {item.native_name}
                            </span>
                          )}
                          {(item.dietary || []).map(code => {
                            const tag = tagsByCode[code]
                            if (!tag) return null
                            return (
                              <span key={code} title={tag.label} style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 14, height: 14, padding: '0 4px', borderRadius: 3,
                                color: '#fff', fontSize: 9, fontWeight: 700, marginLeft: 3,
                                background: tag.colour,
                              }}>{tag.glyph}</span>
                            )
                          })}
                        </div>
                        {!hidePrices && item.price_pence != null && (!item.variants || item.variants.length === 0) && (
                          <span style={{ fontFamily: 'var(--f-heading)', color: 'var(--c-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrice(item.price_pence)}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p style={{ fontSize: '0.88rem', color: 'var(--c-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>{item.description}</p>
                      )}
                      {item.variants && item.variants.length > 0 && (
                        !hidePrices ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 8px', marginTop: 6, fontSize: '0.88rem' }}>
                            {item.variants.map((v, i) => (
                              <div key={i} style={{ display: 'contents' }}>
                                <span>{v.label}</span>
                                <span style={{ fontFamily: 'var(--f-heading)', color: 'var(--c-primary)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                                  {formatPrice(v.price_pence)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 6, fontSize: '0.88rem' }}>
                            {item.variants.map(v => v.label).join(' · ')}
                          </div>
                        )
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
