// canvas/SiteChrome.jsx
//
// React previews of the SSR header + footer partials. These render INSIDE
// the page-builder canvas so the editor reflects what gets shipped to the
// live site. They are display-only — clicking jumps to the relevant admin
// section instead of editing inline. The header / footer logic + data
// reads here MIRROR the corresponding Eta partials at:
//   api/src/views/site/templates/{template_key}/partials/{header,footer}.eta
//
// When a field is missing, the React preview falls back to the same default
// the Eta partial uses, so a tenant with no nav_extra_links sees the same
// auto-derived nav in both places.

import { ExternalLink } from 'lucide-react'

const ASSETS = '/template-assets/onethai'

// Wrapper that gates rendering: chrome only shows when we have a tenant_site
// (always true on the tenant home builder; venue builder needs the parent
// to pass tenantSite down).
function emptyChrome() { return null }

// ── Helpers ─────────────────────────────────────────────────

function deriveNav({ tenantSite, pages = [], venues = [], onLocation = false, venueSlug }) {
  const showLocationsLink = !tenantSite?.hide_locations_index && venues.length > 1
  const navExtra = Array.isArray(tenantSite?.nav_extra_links) ? tenantSite.nav_extra_links : []
  const ctaCfg = tenantSite?.header_cta || {}
  const ctaText = ctaCfg.text || tenantSite?.hero_cta_text || 'Book a Table'
  const ctaHref = ctaCfg.url || (onLocation ? `/locations/${venueSlug}#booking` : '/locations')
  const menuHref = onLocation ? `/locations/${venueSlug}/menu` : '/menu'

  return {
    showLocationsLink,
    menuHref,
    pages: pages.filter(p => p.is_published !== false),
    navExtra,
    ctaText,
    ctaHref,
  }
}

function brandFields(tenantSite, tenantName) {
  return {
    siteName:  tenantSite?.site_name || tenantSite?.brand_name || tenantName || 'Your Site',
    tagline:   tenantSite?.tagline || '',
    logoUrl:   tenantSite?.logo_url || null,
  }
}

// ═══════════════════════════════════════════════════════════
//   HEADER PREVIEW
// ═══════════════════════════════════════════════════════════

export function HeaderPreview({ tenantSite, pages, venues, tenantName, onJumpTo }) {
  if (!tenantSite) return emptyChrome()
  const tk = tenantSite.template_key || 'classic'
  if (tk === 'onethai') return <OnethaiHeader tenantSite={tenantSite} pages={pages} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
  if (tk === 'modern')  return <ModernHeader  tenantSite={tenantSite} pages={pages} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
  return <ClassicHeader tenantSite={tenantSite} pages={pages} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
}

function ChromeBadge({ label, onClick }) {
  // Small "Edit X" pill that appears on hover. Lets the operator jump
  // straight to the admin section that controls this part of the chrome.
  if (!onClick) return null
  return (
    <button type="button" onClick={onClick}
      className="chrome-edit"
      style={{
        position: 'absolute',
        top: 6, right: 6,
        padding: '3px 9px',
        background: 'rgba(31,41,55,0.92)',
        color: '#fff',
        border: 'none',
        borderRadius: 999,
        fontSize: 11, fontWeight: 600,
        letterSpacing: 0.3,
        cursor: 'pointer',
        opacity: 0,
        transition: 'opacity .12s',
        zIndex: 30,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
      Edit {label} →
    </button>
  )
}

function ClassicHeader({ tenantSite, pages, venues, tenantName, onJumpTo }) {
  const { siteName, tagline: _t, logoUrl } = brandFields(tenantSite, tenantName)
  const nav = deriveNav({ tenantSite, pages, venues })
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="header" onClick={() => onJumpTo?.('tenant-nav')} />
      <header style={{
        background: 'var(--c-bg)',
        borderBottom: '1px solid var(--c-border)',
        padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 18, color: 'var(--c-text)' }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ height: 'var(--logo-h, 36px)', width: 'auto' }} />}
          <span>{siteName}</span>
        </div>
        <nav style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {nav.showLocationsLink && <span style={navLink}>Locations</span>}
          <span style={navLink}>Menu</span>
          {nav.pages.map(p => <span key={p.id || p.slug} style={navLink}>{p.title}</span>)}
          {nav.navExtra.map((l, i) => <span key={i} style={navLink}>{l.label}</span>)}
          <span style={{ ...navLink, background: 'var(--c-primary)', color: '#fff', padding: '8px 18px', borderRadius: 'var(--btn-r, 4px)' }}>
            {nav.ctaText}
          </span>
        </nav>
      </header>
    </div>
  )
}

function ModernHeader({ tenantSite, pages, venues, tenantName, onJumpTo }) {
  const { siteName, logoUrl } = brandFields(tenantSite, tenantName)
  const nav = deriveNav({ tenantSite, pages, venues })
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="header" onClick={() => onJumpTo?.('tenant-nav')} />
      <header style={{
        background: 'transparent',
        padding: '22px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24,
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1,
        color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--f-heading)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.01em' }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ height: 'var(--logo-h, 36px)', width: 'auto' }} />}
          <span>{siteName}</span>
        </div>
        <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {nav.showLocationsLink && <span style={modernLink}>Locations</span>}
          <span style={modernLink}>Menu</span>
          {nav.pages.map(p => <span key={p.id || p.slug} style={modernLink}>{p.title}</span>)}
          {nav.navExtra.map((l, i) => <span key={i} style={modernLink}>{l.label}</span>)}
          <span style={{ background: '#fff', color: 'var(--c-primary)', padding: '10px 22px', borderRadius: 999, fontWeight: 700, fontSize: 14 }}>
            {nav.ctaText}
          </span>
        </nav>
      </header>
      {/* Empty space because modern header is overlaid on hero */}
      <div style={{ height: 80 }} />
    </div>
  )
}

function OnethaiHeader({ tenantSite, pages, venues, tenantName, onJumpTo }) {
  const { siteName, tagline, logoUrl } = brandFields(tenantSite, tenantName)
  const nav = deriveNav({ tenantSite, pages, venues })
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="header" onClick={() => onJumpTo?.('tenant-nav')} />
      <header style={{
        background: 'rgba(250, 246, 239, 0.92)',
        borderBottom: '1px solid var(--line, rgba(99,8,18,0.18))',
        padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />}
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: 'Caveat, cursive', fontSize: '1.6rem', fontWeight: 600, color: 'var(--plum, #630812)' }}>
              {siteName}
            </span>
            {tagline && (
              <span style={{ fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.3em', fontSize: '0.6rem', color: 'var(--plum-soft, #7a1a26)', marginTop: 2 }}>
                {tagline}
              </span>
            )}
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          {nav.showLocationsLink && <span style={onethaiLink}>Locations</span>}
          <span style={onethaiLink}>Menu</span>
          {nav.pages.map(p => <span key={p.id || p.slug} style={onethaiLink}>{p.title}</span>)}
          {nav.navExtra.map((l, i) => <span key={i} style={onethaiLink}>{l.label}</span>)}
          <span style={{
            background: 'var(--plum, #630812)', color: 'var(--cream, #f5efe6)',
            padding: '10px 22px', borderRadius: 999, fontWeight: 500, fontSize: 14,
          }}>
            {nav.ctaText}
          </span>
        </nav>
      </header>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//   FOOTER PREVIEW
// ═══════════════════════════════════════════════════════════

export function FooterPreview({ tenantSite, venues, tenantName, onJumpTo }) {
  if (!tenantSite) return emptyChrome()
  const tk = tenantSite.template_key || 'classic'
  if (tk === 'onethai') return <OnethaiFooter tenantSite={tenantSite} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
  if (tk === 'modern')  return <ModernFooter  tenantSite={tenantSite} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
  return <ClassicFooter tenantSite={tenantSite} venues={venues} tenantName={tenantName} onJumpTo={onJumpTo} />
}

function buildFooterShared(tenantSite, tenantName) {
  const { siteName, tagline, logoUrl } = brandFields(tenantSite, tenantName)
  const sl = tenantSite?.social_links || {}
  const socials = Object.entries(sl).filter(([, v]) => v)
  const customCols = Array.isArray(tenantSite?.footer_columns) ? tenantSite.footer_columns : []
  const copyright = tenantSite?.footer_copyright || `© ${new Date().getFullYear()} ${siteName}.`
  return { siteName, tagline, logoUrl, socials, customCols, copyright }
}

function ClassicFooter({ tenantSite, venues, tenantName, onJumpTo }) {
  const { siteName, tagline, socials, customCols, copyright } = buildFooterShared(tenantSite, tenantName)
  const showLocations = !tenantSite?.hide_locations_index && venues.length > 0
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="footer" onClick={() => onJumpTo?.('tenant-nav')} />
      <footer style={{ background: '#1f1f1f', color: '#ccc', padding: '56px 32px 24px', fontSize: 14 }}>
        <div style={{ maxWidth: 'var(--cw, 1100px)', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 18, color: 'white', fontWeight: 700, marginBottom: 12 }}>{siteName}</div>
              {tagline && <p style={{ color: '#a3a3a3', maxWidth: 360, fontStyle: 'italic' }}>{tagline}</p>}
              {!!socials.length && (
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  {socials.map(([k]) => (
                    <span key={k} style={{ color: '#fff', textTransform: 'capitalize' }}>{k}</span>
                  ))}
                </div>
              )}
            </div>
            {showLocations ? (
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ color: '#fff', marginBottom: 18 }}>Our locations</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                  {venues.slice(0, 8).map(v => <span key={v.id} style={{ color: '#ccc' }}>{v.name}</span>)}
                </div>
              </div>
            ) : <div />}
            {customCols.map((col, i) => (
              <div key={i}>
                <h4 style={{ color: '#fff', marginBottom: 12 }}>{col.title}</h4>
                {(col.items || []).map((item, j) => (
                  <span key={j} style={{ display: 'block', color: '#fff', marginBottom: 6 }}>{item.label}</span>
                ))}
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 30, borderTop: '1px solid #333', fontSize: 12, color: '#888', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{copyright}</span>
            <span>Powered by Macaroonie.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ModernFooter({ tenantSite, venues, tenantName, onJumpTo }) {
  const { siteName, tagline, socials, customCols, copyright } = buildFooterShared(tenantSite, tenantName)
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="footer" onClick={() => onJumpTo?.('tenant-nav')} />
      <footer style={{ background: 'var(--c-text, #0a0a0a)', color: '#c9c9c9', padding: '64px 32px 28px', fontSize: 14, letterSpacing: '0.02em' }}>
        <div style={{ maxWidth: 'var(--cw, 1100px)', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 36, marginBottom: 32 }}>
            <div>
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 12 }}>{siteName}</div>
              {tagline && <p style={{ maxWidth: 320 }}>{tagline}</p>}
            </div>
            <div>
              {!!socials.length && <>
                <div style={modernFootTitle}>Social</div>
                {socials.map(([k]) => <div key={k} style={{ color: '#fff', textTransform: 'capitalize' }}>{k}</div>)}
              </>}
            </div>
            {customCols.map((col, i) => (
              <div key={i}>
                <div style={modernFootTitle}>{col.title}</div>
                {(col.items || []).map((item, j) => <div key={j}><span style={{ color: '#fff' }}>{item.label}</span></div>)}
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 12, color: '#777', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{copyright}</span>
            <span>Powered by Macaroonie</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function OnethaiFooter({ tenantSite, venues, tenantName, onJumpTo }) {
  const { siteName, tagline, logoUrl, socials, customCols, copyright } = buildFooterShared(tenantSite, tenantName)
  const showLocations = !tenantSite?.hide_locations_index && venues.length > 1
  return (
    <div className="chrome-block" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <ChromeBadge label="footer" onClick={() => onJumpTo?.('tenant-nav')} />
      <footer style={{ background: 'var(--paper, #faf6ef)', padding: '80px 32px 30px', borderTop: '1px solid var(--line, rgba(99,8,18,0.18))' }}>
        <div style={{ maxWidth: 'var(--cw, 1240px)', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 60, marginBottom: 60 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
              {logoUrl && <img src={logoUrl} alt="" style={{ width: 110, height: 110, objectFit: 'contain' }} />}
              {tagline && <p style={{ color: 'var(--muted, #7a6b62)', maxWidth: 320, fontStyle: 'italic', fontFamily: 'Fraunces, serif' }}>{tagline}</p>}
              {!!socials.length && (
                <div style={{ display: 'flex', gap: 14 }}>
                  {socials.map(([k]) => <span key={k} style={{ color: 'var(--plum, #630812)', textTransform: 'capitalize' }}>{k}</span>)}
                </div>
              )}
            </div>
            <div style={{ gridColumn: showLocations ? 'span 2' : 'span 1' }}>
              {showLocations ? (
                <>
                  <h5 style={onethaiFootTitle}>Locations</h5>
                  {venues.slice(0, 8).map(v => (
                    <span key={v.id} style={{ display: 'block', color: 'var(--ink, #2a1c1a)', marginBottom: 10, fontSize: '0.92rem' }}>
                      {v.name}{v.city ? ` — ${v.city}` : ''}
                    </span>
                  ))}
                </>
              ) : null}
            </div>
            {customCols.map((col, i) => (
              <div key={i}>
                <h5 style={onethaiFootTitle}>{col.title}</h5>
                {(col.items || []).map((item, j) => (
                  <span key={j} style={{ display: 'block', color: 'var(--ink, #2a1c1a)', marginBottom: 10, fontSize: '0.92rem' }}>
                    {item.label}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* Decorative herb-icon strip */}
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 28,
            padding: '24px 0', margin: '0 0 30px',
            borderTop: '1px solid var(--line, rgba(99,8,18,0.18))',
            borderBottom: '1px solid var(--line, rgba(99,8,18,0.18))',
            opacity: 0.55,
          }}>
            {['icon-thai-basil', 'icon-chilli', 'icon-star-anise', 'icon-lemongrass-bunch', 'icon-kaffir-leaf', 'icon-lime-wedge', 'icon-coriander'].map(name => (
              <img key={name} src={`${ASSETS}/icons/${name}.png`} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            ))}
          </div>

          <div style={{
            paddingTop: 30, borderTop: '1px solid var(--line, rgba(99,8,18,0.18))',
            fontSize: '0.82rem', color: 'var(--muted, #7a6b62)',
            display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <span>{copyright}</span>
            <span style={{ fontFamily: 'Caveat, cursive', fontSize: '1.1rem', color: 'var(--plum, #630812)' }}>
              Powered by Macaroonie
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Inline styles ──────────────────────────────────────────

const navLink = {
  color: 'var(--c-text)',
  fontSize: 14, fontWeight: 500,
  cursor: 'default',
}
const modernLink = {
  color: '#fff', fontSize: 14, fontWeight: 500, letterSpacing: '0.02em',
  cursor: 'default',
}
const onethaiLink = {
  color: 'var(--ink, #2a1c1a)', fontSize: '0.92rem', cursor: 'default',
}
const modernFootTitle = {
  fontWeight: 600, color: '#fff', marginBottom: 10,
  fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
}
const onethaiFootTitle = {
  color: 'var(--plum, #630812)', marginBottom: 18,
  fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.18em',
  fontSize: '0.72rem', fontWeight: 500,
}

// ═══════════════════════════════════════════════════════════
//   Hover affordance: reveal "Edit" badges on chrome-block hover
// ═══════════════════════════════════════════════════════════

export const SiteChromeStyles = (
  <style>{`
    .chrome-block:hover .chrome-edit { opacity: 1 !important; }
    .chrome-block { outline: 2px dashed transparent; outline-offset: -2px; transition: outline-color .12s; }
    .chrome-block:hover { outline-color: rgba(99, 8, 18, 0.25); }
  `}</style>
)
