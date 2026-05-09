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

export function GalleryCanvas({ data, onChange, config }) {
  const api = useApi()
  const venueId = config?.venue_id
  const { data: images = [], isLoading } = useQuery({
    queryKey: ['gallery-preview', venueId],
    queryFn:  () => api.get(venueId ? `/website/gallery?venue_id=${venueId}` : '/website/gallery'),
    enabled:  !!venueId,
    staleTime: 30_000,
  })
  return (
    <section className="block" style={{ padding: '48px 0' }}>
      <div style={innerContainerStyle(data.container)}>
        <BlockHeading data={data} onChange={onChange} />
        {!venueId ? (
          <EmptyPanel Icon={ImageIcon} title="Gallery"
            hint="Gallery images live per-location."
            where="Add to a venue's location page" />
        ) : isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--c-muted)' }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : images.length === 0 ? (
          <EmptyPanel Icon={ImageIcon} title="Gallery"
            hint="No images yet."
            where="Add via Gallery section of this venue" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {images.slice(0, 8).map(img => (
              <img key={img.id} src={img.image_url} alt={img.caption || ''}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 'var(--r-md, 8px)' }} />
            ))}
            {images.length > 8 && (
              <div style={{
                aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--r-md, 8px)', background: 'var(--c-surface)',
                color: 'var(--c-muted)', fontSize: 14,
              }}>+{images.length - 8} more</div>
            )}
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

export function BookingWidgetCanvas({ data, onChange, config }) {
  // Embeds the SAME /widget/{id} iframe that ships on the live site.
  // Single source of truth — what you see here is what visitors see.
  // Resolution order matches the SSR partial (booking_widget.eta):
  //   1. block-level override (data.venue_id)
  //   2. on a location page: the venue this config row belongs to
  //   3. tenant default_widget_venue_id
  //   4. tenant mode with location picker
  const ts          = config && config.template_key !== undefined ? config : null
  const tenantId    = (ts && ts.tenant_id) || (config && config.tenant_id) || null
  const venueId     = data.venue_id
                   || (config && config.venue_id)
                   || (ts && ts.default_widget_venue_id)
                   || null

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
  if (venueId) {
    widgetSrc = `/widget/${venueId}?${qp.toString()}`
  } else if (tenantId) {
    widgetSrc = `/widget/tenant/${tenantId}?${qp.toString()}`
  }

  return (
    <section className="block" id="booking" style={{ padding: '64px 0', background: 'var(--c-surface)' }}>
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
  const cols = menu ? Math.min(menu.print_columns || 3, 3) : 1

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
            {menu.tagline && (
              <p style={{ textAlign: 'center', fontFamily: 'Caveat, var(--f-heading), cursive', fontSize: '1.3rem', color: 'var(--c-primary)', margin: '-16px 0 24px' }}>
                {menu.tagline}
              </p>
            )}
            {menu.intro_line && (
              <p style={{ textAlign: 'center', color: 'var(--c-muted)', maxWidth: 640, margin: '0 auto 32px', fontSize: '0.95rem' }}>
                {menu.intro_line}
              </p>
            )}
            <div style={{ columnCount: cols, columnGap: 48, columnFill: 'balance' }}>
              {(menu.sections || []).map(s => (
                <div key={s.id} style={{ breakInside: 'avoid', marginBottom: 36 }}>
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
                        {item.price_pence != null && (!item.variants || item.variants.length === 0) && (
                          <span style={{ fontFamily: 'var(--f-heading)', color: 'var(--c-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrice(item.price_pence)}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p style={{ fontSize: '0.88rem', color: 'var(--c-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>{item.description}</p>
                      )}
                      {item.variants && item.variants.length > 0 && (
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
