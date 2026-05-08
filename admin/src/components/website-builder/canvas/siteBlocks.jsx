// canvas/siteBlocks.jsx
//
// React canvas mirrors of the six "site shell" / themed blocks. These
// match the corresponding Eta partials in api/src/views/site/blocks/
// so what the operator drags around in the admin matches what gets
// rendered to the live site. Inline edits use InlineText / InlineRichText
// where it makes sense; the rest of the controls live in the editor.

import { InlineText }     from './InlineText'
import { InlineRichText } from './InlineRichText'

const ASSETS = '/template-assets/onethai'

function innerContainerStyle(width) {
  switch (width) {
    case 'wide': return { maxWidth: 1400, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
    case 'full': return { maxWidth: 'none', width: '100%', paddingLeft: 24, paddingRight: 24 }
    case 'boxed':
    default:     return { maxWidth: 'var(--cw)', marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%' }
  }
}

// Helper: pull tenant-site brand text + tagline + logo. Falls back to
// auto-derive from `it.config.site_name` etc. — same logic Eta uses.
function brandFrom(data, config) {
  const ts = config?.template_key !== undefined && config?.template_key !== null ? config : null
  return {
    siteName:    data.brand_text     || ts?.site_name || ts?.brand_name || '',
    subtitle:    data.brand_subtitle || ts?.tagline   || '',
    logoUrl:     ts?.logo_url || null,
  }
}

// ── Header ────────────────────────────────────────────────────

export function HeaderCanvas({ data, onChange, selected, config }) {
  const { siteName, subtitle, logoUrl } = brandFrom(data, config)
  const links = data.links || []
  const cta = data.cta || {}
  const setLinkLabel = (i, label) => {
    const next = links.slice(); next[i] = { ...next[i], label }
    onChange({ ...data, links: next })
  }

  return (
    <header style={{
      position: data.sticky !== false ? 'sticky' : 'static',
      top: 0, zIndex: 20,
      background: 'rgba(250, 246, 239, 0.92)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--c-border)',
      padding: '14px 32px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24, maxWidth: 'var(--cw, 1240px)', margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {data.show_logo !== false && logoUrl && (
            <img src={logoUrl} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{
              fontFamily: 'var(--f-heading), serif',
              fontWeight: 600, fontSize: '1.5rem',
              color: 'var(--c-primary)',
            }}>
              {siteName || 'Brand name'}
            </span>
            {subtitle && (
              <span style={{
                fontFamily: 'var(--f-body), sans-serif',
                textTransform: 'uppercase', letterSpacing: '0.3em',
                fontSize: '0.6rem', color: 'var(--c-muted)', marginTop: 4,
              }}>
                {subtitle}
              </span>
            )}
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {links.map((link, i) => (
            <InlineText key={i} as="span"
              value={link.label}
              onChange={(label) => setLinkLabel(i, label)}
              placeholder="Link"
              style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-text)' }} />
          ))}
          {cta.show !== false && (
            <InlineText as="span"
              value={cta.text}
              onChange={(text) => onChange({ ...data, cta: { ...cta, text } })}
              placeholder="Book a Table"
              style={{
                background: 'var(--c-primary)', color: '#fff',
                padding: '10px 22px', borderRadius: 999,
                fontSize: 14, fontWeight: 500,
              }} />
          )}
        </nav>
      </div>
      {selected && (
        <div style={{
          position: 'absolute', bottom: -22, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, color: 'var(--c-muted)', background: 'rgba(0,0,0,0.04)',
          padding: '2px 8px', borderRadius: 4,
        }}>
          Header — {links.length} link{links.length === 1 ? '' : 's'} · open inspector to add more
        </div>
      )}
    </header>
  )
}

// ── Footer ────────────────────────────────────────────────────

export function FooterCanvas({ data, onChange, config }) {
  const { siteName, subtitle, logoUrl } = brandFrom(data, config)
  const cols = data.columns || []
  const copyright = data.copyright_text || `© ${new Date().getFullYear()} ${siteName || 'Your brand'}.`

  return (
    <footer style={{
      background: 'var(--c-bg, #faf6ef)',
      padding: '64px 32px 30px',
      borderTop: '1px solid var(--c-border)',
    }}>
      <div style={{ maxWidth: 'var(--cw, 1240px)', margin: '0 auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: data.show_brand_block === false
            ? `repeat(${Math.max(1, cols.length || 1)}, 1fr)`
            : `2fr ${cols.map(() => '1fr').join(' ') || '1fr'}`,
          gap: 48, marginBottom: 48,
        }}>
          {data.show_brand_block !== false && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
              {logoUrl && <img src={logoUrl} alt="" style={{ width: 90, height: 90, objectFit: 'contain' }} />}
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 18, fontWeight: 700, color: 'var(--c-primary)' }}>
                {siteName || 'Brand name'}
              </div>
              {subtitle && <p style={{ color: 'var(--c-muted)', maxWidth: 320, fontStyle: 'italic', fontFamily: 'var(--f-heading)', margin: 0 }}>{subtitle}</p>}
            </div>
          )}

          {cols.map((col, ci) => (
            <div key={ci}>
              <h5 style={{
                color: 'var(--c-primary)', marginBottom: 14,
                fontFamily: 'var(--f-body)', textTransform: 'uppercase',
                letterSpacing: '0.18em', fontSize: '0.72rem', fontWeight: 500,
              }}>{col.title || 'Column title'}</h5>
              {(col.items || []).map((it, ii) => (
                <div key={ii} style={{ marginBottom: 8, color: 'var(--c-text)', fontSize: '0.92rem' }}>
                  {it.label || <span style={{ color: 'var(--c-muted)' }}>(empty)</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{
          paddingTop: 24, borderTop: '1px solid var(--c-border)',
          fontSize: 13, color: 'var(--c-muted)',
          display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span>{copyright}</span>
          {data.show_legal_links !== false && (
            <span style={{ display: 'flex', gap: 14 }}>
              <span>Terms</span><span>Privacy</span><span>Cookies</span>
            </span>
          )}
          {data.show_powered_by !== false && (
            <span style={{ fontFamily: 'var(--f-heading)' }}>Powered by Macaroonie</span>
          )}
        </div>
      </div>
    </footer>
  )
}

// ── Ticker ────────────────────────────────────────────────────

export function TickerCanvas({ data, onChange }) {
  const items = data.items || []
  const bg = {
    primary: 'var(--c-primary)',
    accent:  'var(--c-accent)',
    dark:    '#1f1f1f',
  }[data.bg_style || 'primary'] || 'var(--c-primary)'
  const fontFamily = data.font_style === 'sans'
    ? 'var(--f-body), sans-serif'
    : 'Caveat, var(--f-heading), cursive'
  const fontSize = data.font_style === 'sans' ? 18 : '1.7rem'
  const looped = items.length ? [...items, ...items] : []

  return (
    <div style={{
      background: bg, color: '#f5efe6',
      padding: '18px 0', overflow: 'hidden',
      borderTop: '1px solid rgba(0,0,0,0.15)',
      borderBottom: '1px solid rgba(0,0,0,0.15)',
    }}>
      <div style={{
        display: 'flex', gap: 48, whiteSpace: 'nowrap',
        fontFamily, fontSize, fontWeight: 500,
        paddingLeft: 32,
      }}>
        {looped.length === 0 ? (
          <span style={{ opacity: 0.6 }}>Add ticker items in the inspector →</span>
        ) : looped.map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
            {item}
            <span style={{ width: 6, height: 6, background: 'currentColor', borderRadius: '50%', opacity: 0.7 }} />
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Story with stamp ──────────────────────────────────────────

export function StoryWithStampCanvas({ data, onChange, selected }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const showImage = data.image_side && data.image_side !== 'none' && data.image_url
  const cols = showImage ? '1fr 1.3fr' : '1fr'
  const imageOrder = data.image_side === 'right' ? 2 : 1

  return (
    <section className="block" style={{ padding: '110px 0', position: 'relative' }}>
      <div style={innerContainerStyle(data.container)}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 80, alignItems: 'start' }}>
          {showImage && (
            <div style={{ order: imageOrder }}>
              <img src={data.image_url} alt="" style={{ width: '100%', borderRadius: 'var(--r-md, 8px)' }} />
            </div>
          )}
          <div style={{ order: imageOrder === 1 ? 2 : 1 }}>
            <InlineText as="h2"
              value={data.heading}
              onChange={set('heading')}
              placeholder="Story heading"
              style={{
                fontFamily: 'var(--f-heading)',
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.02em',
                color: 'var(--c-text)', marginBottom: 24,
              }} />
            <InlineRichText
              value={data.body_html}
              onChange={set('body_html')}
              placeholder="Tell your story…"
              className="prose"
              style={{ color: 'var(--c-muted)', lineHeight: 1.7, fontSize: '1.05rem' }} />
            {data.stamp_show !== false && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 14, marginTop: 24,
                padding: '12px 22px', background: 'var(--c-surface)',
                border: '1px dashed var(--c-primary)', borderRadius: 999,
                color: 'var(--c-primary)',
                fontFamily: 'Caveat, var(--f-heading), cursive', fontSize: '1.4rem',
              }}>
                <span style={{
                  background: 'var(--c-primary)', color: '#fff',
                  width: 32, height: 32, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--f-heading)', fontSize: '1rem', fontWeight: 500,
                }}>{data.stamp_number || '10'}</span>
                {data.stamp_label || 'years'}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Dish list ─────────────────────────────────────────────────

export function DishListCanvas({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const cols = data.columns || []
  const heatColors = { '●○○': 'var(--c-accent)', '●●○': '#dc6b00', '●●●': '#dc2626' }

  return (
    <section className="block" style={{ padding: '100px 0', background: 'var(--c-surface)' }}>
      <div style={innerContainerStyle(data.container)}>
        <div style={{ marginBottom: 48 }}>
          <InlineText as="h2"
            value={data.heading}
            onChange={set('heading')}
            placeholder="A Taste of the Menu"
            style={{
              fontFamily: 'var(--f-heading)',
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 400, color: 'var(--c-primary)',
              marginBottom: 8,
            }} />
          {(data.subheading || true) && (
            <InlineText as="p"
              value={data.subheading}
              onChange={set('subheading')}
              placeholder="Optional subheading"
              style={{ color: 'var(--c-muted)', fontSize: '1.05rem', margin: 0 }} />
          )}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, cols.length || 1)}, 1fr)`,
          gap: '0 80px',
        }}>
          {cols.map((col, ci) => (
            <div key={ci}>
              <h3 style={{
                fontFamily: 'Caveat, var(--f-heading), cursive',
                fontWeight: 600, color: 'var(--c-primary)',
                fontSize: '1.7rem',
                paddingBottom: 14, marginBottom: 24,
                borderBottom: '1px solid var(--c-border)',
              }}>{col.title || 'Column'}</h3>
              {(col.dishes || []).map((dish, di) => (
                <div key={di} style={{
                  display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                  alignItems: 'baseline', gap: 12, padding: '18px 0',
                  borderBottom: '1px dotted var(--c-border)',
                }}>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: '1.1rem', fontWeight: 500 }}>
                    {dish.name || <span style={{ color: 'var(--c-muted)' }}>(unnamed dish)</span>}
                    {dish.thai && <span style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--c-muted)', fontSize: '0.9rem', marginLeft: 8 }}>{dish.thai}</span>}
                  </div>
                  {dish.heat ? <span style={{ color: heatColors[dish.heat] || 'var(--c-accent)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>{dish.heat}</span> : <span />}
                  <div style={{ color: 'var(--c-primary)', fontWeight: 500, fontFamily: 'var(--f-heading)', fontVariantNumeric: 'tabular-nums' }}>{dish.price || ''}</div>
                  {dish.desc && <div style={{ gridColumn: '1 / -1', fontSize: '0.9rem', color: 'var(--c-muted)', marginTop: 4 }}>{dish.desc}</div>}
                </div>
              ))}
              {(col.dishes || []).length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, fontStyle: 'italic' }}>
                  No dishes yet — add some in the inspector.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Reviews band ──────────────────────────────────────────────

export function ReviewsBandCanvas({ data }) {
  const items = data.items || []
  const bgPalette = {
    primary: { bg: 'var(--c-primary)', fg: '#f5efe6', star: '#f5b8c0', divider: 'rgba(245,239,230,0.25)' },
    accent:  { bg: 'var(--c-accent)',  fg: '#fff',    star: '#fff7ed', divider: 'rgba(255,255,255,0.3)' },
    dark:    { bg: '#1f1f1f',           fg: '#f5f5f5', star: '#fbbf24', divider: 'rgba(245,245,245,0.2)' },
    surface: { bg: 'var(--c-surface)', fg: 'var(--c-text)', star: 'var(--c-primary)', divider: 'var(--c-border)' },
  }
  const palette = bgPalette[data.bg_style || 'primary'] || bgPalette.primary

  return (
    <section className="block" style={{ padding: '90px 0', background: palette.bg, color: palette.fg }}>
      <div style={innerContainerStyle(data.container)}>
        {data.heading && (
          <h2 style={{ fontFamily: 'var(--f-heading)', textAlign: 'center', marginBottom: 40, color: palette.fg }}>
            {data.heading}
          </h2>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(items.length || 1, 3))}, 1fr)`,
          gap: 40,
        }}>
          {items.map((r, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${palette.divider}`, paddingLeft: 24 }}>
              <div style={{ color: palette.star, marginBottom: 14, letterSpacing: '0.15em', fontSize: '0.85rem' }}>
                {'★'.repeat(r.stars || 5)}
              </div>
              <p style={{ fontFamily: 'var(--f-heading)', fontStyle: 'italic', fontSize: '1.1rem', lineHeight: 1.5, marginBottom: 18 }}>
                {r.text || <span style={{ opacity: 0.5 }}>(empty review)</span>}
              </p>
              <p style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.75, margin: 0 }}>
                — {r.attr || 'Anonymous'}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
