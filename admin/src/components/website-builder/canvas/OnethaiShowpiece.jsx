// canvas/OnethaiShowpiece.jsx
//
// In-canvas React preview of the Onethai empty-blocks fallback (server-side
// at api/src/views/site/templates/onethai/fallback_home.eta and
// fallback_location.eta). Renders the same hero + ticker + locations grid
// (multi-venue) OR hero + ticker + story + sample menu + reviews + visit +
// order (single-venue) the live site shows when the operator picks the
// Onethai template and leaves home_blocks / page_blocks empty.
//
// Display-only — clicking the showpiece doesn't edit it; it nudges the
// operator to add a real block to override the relevant section.

const ASSETS = '/template-assets/onethai'

const SAMPLE_DISHES_LEFT = [
  { name: 'Pad Thai',         thai: 'ผัดไทย',     heat: '',    price: '£11.50', desc: 'Wok-tossed rice noodles, tamarind, peanuts, lime.' },
  { name: 'Massaman Beef',    thai: 'มัสมั่น',     heat: '●●○', price: '£13.80', desc: 'Slow-cooked beef, potato, peanuts, cinnamon, star anise.' },
  { name: 'Tom Yum Goong',    thai: 'ต้มยำกุ้ง',   heat: '●●●', price: '£8.50',  desc: 'King prawns, lemongrass, lime leaf, galangal.' },
  { name: 'Green Curry',      thai: 'แกงเขียวหวาน', heat: '●●○', price: '£12.50', desc: 'House-made curry paste, Thai basil, bamboo.' },
]
const SAMPLE_DISHES_RIGHT = [
  { name: 'Spare Ribs',       thai: 'ซี่โครงอบ',   heat: '',    price: '£9.80',  desc: 'Slow-marinated, twice-cooked.' },
  { name: 'Pad Krapow Moo',   thai: 'ผัดกะเพรา',  heat: '●●●', price: '£11.80', desc: 'Minced pork, holy basil, chilli, fried egg.' },
  { name: 'Khao Soi',         thai: 'ข้าวซอย',    heat: '●●○', price: '£13.20', desc: 'Northern egg noodles, coconut curry, pickled mustard.' },
  { name: 'Som Tam',          thai: 'ส้มตำ',      heat: '●●●', price: '£8.20',  desc: 'Green papaya salad, lime, palm sugar, peanuts.' },
]
const SAMPLE_REVIEWS = [
  { stars: 5, text: 'Probably the best Thai food this side of Bangkok — and I drive past three other places to get here.', attr: 'Mark, regular since 2018' },
  { stars: 5, text: 'Tiny place, huge flavours. The spare ribs are dangerously good and the staff actually remember you.', attr: 'Sarah, Hertford' },
  { stars: 5, text: 'A proper neighbourhood gem. We have been coming here for years and it never disappoints.', attr: 'James & Priya' },
]
const TICKER_DEFAULT = ['Pad Thai', 'Massaman', 'Tom Yum', 'Pad Krapow', 'Green Curry', 'Som Tam', 'Spare Ribs', 'Khao Soi']

export function OnethaiShowpiece({ tenantSite, venues = [], tenantName }) {
  // Multi-venue tenants get the locations-grid showpiece; single-venue gets
  // the full editorial One Thai layout (hero + ticker + story + menu + …).
  const single = venues.length === 1
  if (single) return <SingleVenueShowpiece tenantSite={tenantSite} venue={venues[0]} tenantName={tenantName} />
  return <MultiVenueShowpiece tenantSite={tenantSite} venues={venues} tenantName={tenantName} />
}

// ── Multi-venue tenant home: hero + ticker + locations grid ─

function MultiVenueShowpiece({ tenantSite, venues, tenantName }) {
  const tagline = tenantSite?.tagline || 'Authentic Thai'
  const heading = tenantSite?.site_name || tenantSite?.brand_name || tenantName || 'Your Restaurant'
  const showLocations = !tenantSite?.hide_locations_index && venues.length > 0
  const ctaText = tenantSite?.header_cta?.text || 'Find a location'
  const tickerItems = TICKER_DEFAULT
  return (
    <div className="onethai-showpiece" style={{ position: 'relative' }}>
      <ShowpieceBadge />

      {/* HERO */}
      <section style={{ padding: '60px 0 80px', position: 'relative',
        background: 'radial-gradient(ellipse at 80% 20%, rgba(201,48,44,0.06) 0%, transparent 50%), radial-gradient(ellipse at 10% 80%, rgba(107,142,78,0.06) 0%, transparent 50%)',
      }}>
        <DecorIcon name="icon-thai-basil"      pos={{ top: 30, left: 24,    rotate: -12, w: 90 }} faint />
        <DecorIcon name="icon-lemongrass-bunch" pos={{ top: 50, right: 30,   rotate: 15,  w: 80 }} faint />
        <DecorIcon name="icon-kaffir-leaf"     pos={{ bottom: 60, left: '5%', rotate: 8,  w: 70 }} faint />
        <DecorIcon name="icon-sakura-bloom"    pos={{ bottom: 30, right: '8%', rotate: -20, w: 95 }} faint />

        <div style={containerStyle}>
          <div style={{ textAlign: 'center', color: 'var(--plum, #630812)', marginBottom: 8, fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: '0.72rem', fontWeight: 500 }}>
            — {tagline} —
          </div>
          <DottedDivider />
          {tenantSite?.logo_url && (
            <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0 30px' }}>
              <img src={tenantSite.logo_url} alt="" style={{ width: 200, height: 200, objectFit: 'contain' }} />
            </div>
          )}
          <h1 style={{
            fontFamily: 'Fraunces, serif', fontSize: 'clamp(2rem, 5vw, 4rem)', lineHeight: 1.0,
            fontWeight: 400, letterSpacing: '-0.03em', textAlign: 'center', marginBottom: 24,
            color: 'var(--ink, #2a1c1a)',
          }}>{heading}</h1>
          {tagline && (
            <p style={{ fontSize: '1.1rem', color: 'var(--muted, #7a6b62)', maxWidth: 560, margin: '0 auto 36px', textAlign: 'center', lineHeight: 1.7 }}>
              {tagline}
            </p>
          )}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span style={btnPrimary}>{ctaText} →</span>
            <span style={btnSecondary}>See the menu</span>
          </div>
        </div>
      </section>

      <Ticker items={tickerItems} />

      {showLocations && (
        <section style={{ padding: '110px 0', position: 'relative' }}>
          <DecorIcon name="icon-lemongrass-bunch" pos={{ bottom: 40, right: '6%', rotate: -8, w: 80 }} faint />
          <div style={containerStyle}>
            <SectionLabel iconName="icon-coriander">Where to find us</SectionLabel>
            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.02em', marginBottom: 16, color: 'var(--ink, #2a1c1a)' }}>
              {tenantSite?.locations_heading || 'Our locations'}
            </h2>
            {tenantSite?.locations_intro && (
              <p style={{ color: 'var(--muted, #7a6b62)', maxWidth: 640, marginBottom: 40 }}>{tenantSite.locations_intro}</p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 28 }}>
              {venues.map(v => (
                <div key={v.id} style={{
                  display: 'flex', flexDirection: 'column',
                  border: '1px solid var(--line, rgba(99,8,18,0.18))', borderRadius: 4, overflow: 'hidden',
                  background: 'var(--paper, #faf6ef)',
                }}>
                  <div style={{
                    aspectRatio: '4/3',
                    backgroundColor: 'var(--paper-warm, #f3ead8)',
                    backgroundImage: v.hero_image_url ? `url('${v.hero_image_url}')` : undefined,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                  }} />
                  <div style={{ padding: 22, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.4rem', fontWeight: 500, marginBottom: 8 }}>{v.name}</h3>
                    {(v.address_line1 || v.city) && (
                      <p style={{ color: 'var(--muted, #7a6b62)', fontSize: '0.92rem', margin: '0 0 6px' }}>
                        {[v.address_line1, v.city, v.postcode].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <span style={{ marginTop: 'auto', color: 'var(--plum, #630812)', fontWeight: 500, paddingTop: 10 }}>Visit ›</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <VineDivider />
    </div>
  )
}

// ── Single-venue: full One Thai showpiece (hero, ticker, story, menu, reviews, visit, order) ─

function SingleVenueShowpiece({ tenantSite, venue, tenantName }) {
  const tagline = tenantSite?.tagline || 'Your Local Thai'
  const heading = tenantSite?.site_name || tenantSite?.brand_name || venue?.name || tenantName || 'Your Restaurant'
  const ctaText = tenantSite?.header_cta?.text || 'Book a table'
  return (
    <div className="onethai-showpiece" style={{ position: 'relative' }}>
      <ShowpieceBadge />

      {/* HERO */}
      <section style={{ padding: '60px 0 80px', position: 'relative',
        background: 'radial-gradient(ellipse at 80% 20%, rgba(201,48,44,0.06) 0%, transparent 50%), radial-gradient(ellipse at 10% 80%, rgba(107,142,78,0.06) 0%, transparent 50%)',
      }}>
        <DecorIcon name="icon-thai-basil"      pos={{ top: 30, left: 24, rotate: -12, w: 90 }} faint />
        <DecorIcon name="icon-lemongrass-bunch" pos={{ top: 50, right: 30, rotate: 15, w: 80 }} faint />
        <DecorIcon name="icon-kaffir-leaf"     pos={{ bottom: 60, left: '5%', rotate: 8, w: 70 }} faint />
        <DecorIcon name="icon-sakura-bloom"    pos={{ bottom: 30, right: '8%', rotate: -20, w: 95 }} faint />

        <div style={containerStyle}>
          <div style={{ textAlign: 'center', color: 'var(--plum, #630812)', marginBottom: 8, fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: '0.72rem', fontWeight: 500 }}>
            — {tagline} —
          </div>
          <DottedDivider />
          {tenantSite?.logo_url && (
            <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0 30px', position: 'relative' }}>
              <ChilliFlourish side="left" />
              <img src={tenantSite.logo_url} alt="" style={{ width: 240, height: 240, objectFit: 'contain', position: 'relative', zIndex: 2 }} />
              <ChilliFlourish side="right" />
            </div>
          )}
          <h1 style={{
            fontFamily: 'Fraunces, serif', fontSize: 'clamp(2.5rem, 6.5vw, 5rem)', lineHeight: 1.0,
            fontWeight: 400, letterSpacing: '-0.03em', textAlign: 'center', marginBottom: 24,
            color: 'var(--ink, #2a1c1a)',
          }}>
            A small Thai cafe<br />
            with{' '}
            <span style={{ fontFamily: 'Caveat, cursive', fontWeight: 600, color: 'var(--plum, #630812)', fontSize: '1.15em' }}>
              very loyal
            </span>
            {' '}regulars.
          </h1>
          <p style={{ fontSize: '1.1rem', color: 'var(--muted, #7a6b62)', maxWidth: 560, margin: '0 auto 36px', textAlign: 'center', lineHeight: 1.7 }}>
            Tucked away in our neighbourhood, cooking the dishes we grew up on for years.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span style={btnPrimary}>{ctaText} →</span>
            <span style={btnSecondary}>See the menu</span>
          </div>
        </div>
      </section>

      <Ticker items={TICKER_DEFAULT} />

      {/* STORY */}
      <section style={{ padding: '110px 0', position: 'relative' }}>
        <DecorIcon name="icon-lemongrass-bunch" pos={{ bottom: 40, right: '6%', rotate: -8, w: 80 }} faint />
        <div style={containerStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 80, alignItems: 'start' }}>
            <div>
              <SectionLabel iconName="icon-coriander">Our Story</SectionLabel>
              <h2 style={storyH2}>
                Cooking for our{' '}
                <span style={{ fontFamily: 'Caveat, cursive', fontWeight: 600, color: 'var(--plum, #630812)', fontSize: '1.15em' }}>
                  neighbours.
                </span>
              </h2>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 14, marginTop: 24,
                padding: '12px 22px', background: 'var(--paper-warm, #f3ead8)',
                border: '1px dashed var(--plum, #630812)', borderRadius: 999,
                color: 'var(--plum, #630812)', fontFamily: 'Caveat, cursive', fontSize: '1.4rem',
              }}>
                <span style={{
                  background: 'var(--plum, #630812)', color: 'var(--cream, #f5efe6)',
                  width: 32, height: 32, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Fraunces, serif', fontSize: '1rem', fontWeight: 500,
                }}>10</span>
                years in the area
              </div>
            </div>
            <div style={{ color: 'var(--muted, #7a6b62)', fontSize: '1.05rem', maxWidth: 600 }}>
              <p>One Thai opened on a quiet stretch of West Street years ago, with a short menu, a few tables, and the kind of nervous optimism you only have when you're cooking your grandmother's recipes for strangers.</p>
              <p style={{ marginTop: 20 }}>The menu has grown — a little classic, a little modern, always honest — but the room is still small, the kitchen is still ours.</p>
            </div>
          </div>
        </div>
      </section>

      {/* MENU SAMPLE */}
      <section style={{ padding: '100px 0', background: 'var(--paper-warm, #f3ead8)', borderTop: '1px solid var(--line, rgba(99,8,18,0.18))', borderBottom: '1px solid var(--line, rgba(99,8,18,0.18))', position: 'relative' }}>
        <DecorIcon name="icon-lime-wedge"  pos={{ top: 40, left: '2%', rotate: -15, w: 70 }} faint />
        <DecorIcon name="icon-star-anise"  pos={{ bottom: 80, right: '3%', rotate: 20, w: 90 }} faint />
        <div style={containerStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: 60, flexWrap: 'wrap', gap: 24 }}>
            <div>
              <SectionLabel iconName="icon-chilli">A Taste of the Menu</SectionLabel>
              <h2 style={storyH2}>
                Classics, and a few{' '}
                <span style={{ fontFamily: 'Caveat, cursive', fontWeight: 600, color: 'var(--plum, #630812)', fontSize: '1.15em' }}>
                  quiet experiments.
                </span>
              </h2>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 80px' }}>
            <DishColumn iconName="icon-thai-basil" title="The Classics" dishes={SAMPLE_DISHES_LEFT} />
            <DishColumn iconName="icon-chilli"     title="House Favourites" dishes={SAMPLE_DISHES_RIGHT} />
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section style={{ padding: '90px 0', background: 'var(--plum, #630812)', color: 'var(--cream, #f5efe6)' }}>
        <div style={containerStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 40 }}>
            {SAMPLE_REVIEWS.map((r, i) => (
              <div key={i} style={{ borderLeft: '2px solid rgba(245,239,230,0.25)', paddingLeft: 24 }}>
                <div style={{ color: 'var(--hl-soft, #f5b8c0)', marginBottom: 14, letterSpacing: '0.15em', fontSize: '0.85rem' }}>
                  {'★'.repeat(r.stars)}
                </div>
                <p style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: '1.1rem', lineHeight: 1.5, marginBottom: 18 }}>{r.text}</p>
                <p style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.75 }}>— {r.attr}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <VineDivider />
    </div>
  )
}

// ── Building blocks ─────────────────────────────────────────

function ShowpieceBadge() {
  return (
    <div style={{
      position: 'absolute', top: 12, right: 16, zIndex: 30,
      background: 'rgba(31,41,55,0.92)', color: '#fff',
      padding: '6px 12px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      pointerEvents: 'none',
    }}>
      Showpiece preview · add a block to override
    </div>
  )
}

function DecorIcon({ name, pos, faint }) {
  return (
    <img src={`${ASSETS}/icons/${name}.png`} alt="" aria-hidden="true"
      style={{
        position: 'absolute',
        opacity: faint ? 0.10 : 0.18,
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 1,
        width: pos.w,
        ...(pos.top    !== undefined ? { top:    pos.top }    : {}),
        ...(pos.right  !== undefined ? { right:  pos.right }  : {}),
        ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
        ...(pos.left   !== undefined ? { left:   pos.left }   : {}),
        transform: `rotate(${pos.rotate}deg)`,
      }} />
  )
}

function DottedDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--plum, #630812)', margin: '12px 0' }}>
      <span style={{ flex: 1, maxWidth: 80, height: 1, background: 'var(--plum, #630812)', opacity: 0.4 }} />
      <span style={{ width: 3, height: 3, background: 'var(--plum, #630812)', borderRadius: '50%', opacity: 0.5 }} />
      <span style={{ width: 5, height: 5, background: 'var(--plum, #630812)', borderRadius: '50%' }} />
      <span style={{ width: 3, height: 3, background: 'var(--plum, #630812)', borderRadius: '50%', opacity: 0.5 }} />
      <span style={{ flex: 1, maxWidth: 80, height: 1, background: 'var(--plum, #630812)', opacity: 0.4 }} />
    </div>
  )
}

function Ticker({ items }) {
  // Static version — looped twice in markup so it visually fills the strip.
  // CSS animation skipped in the canvas to keep things simple.
  const looped = [...items, ...items]
  return (
    <div style={{
      background: 'var(--plum, #630812)', color: 'var(--cream, #f5efe6)',
      padding: '18px 0', overflow: 'hidden',
      borderTop: '1px solid var(--plum-deep, #4a060e)',
      borderBottom: '1px solid var(--plum-deep, #4a060e)',
    }}>
      <div style={{
        display: 'flex', gap: 48, whiteSpace: 'nowrap',
        fontFamily: 'Caveat, cursive', fontSize: '1.7rem', fontWeight: 500,
        paddingLeft: 32,
      }}>
        {looped.map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
            {item}
            <span style={{ width: 6, height: 6, background: 'var(--cream, #f5efe6)', borderRadius: '50%', opacity: 0.7 }} />
          </span>
        ))}
      </div>
    </div>
  )
}

function VineDivider() {
  return (
    <div aria-hidden="true" style={{
      display: 'flex', justifyContent: 'center', padding: '40px 0',
      opacity: 0.5, background: 'var(--paper, #faf6ef)',
    }}>
      <img src={`${ASSETS}/divider-vine.png`} alt="" style={{ maxWidth: 480, width: '100%', height: 'auto' }} />
    </div>
  )
}

function ChilliFlourish({ side }) {
  return (
    <svg viewBox="0 0 60 200" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute', top: '50%', width: 60, opacity: 0.4,
        transform: side === 'left'
          ? 'translateY(-50%) rotate(-20deg)'
          : 'translateY(-50%) rotate(20deg) scaleX(-1)',
        [side]: 'calc(50% - 220px)',
      }}>
      <path d="M30 10 Q 38 5, 35 15 Q 50 30, 40 55 Q 55 90, 35 130 Q 25 170, 30 195"
        stroke="#c9302c" strokeWidth="2" fill="#c9302c" fillOpacity="0.85" />
      <path d="M28 8 Q 22 3, 30 12" stroke="#6b8e4e" strokeWidth="3" fill="#6b8e4e" />
    </svg>
  )
}

function SectionLabel({ iconName, children }) {
  return (
    <div style={{
      color: 'var(--plum, #630812)', marginBottom: 20,
      display: 'inline-flex', alignItems: 'center', gap: 10,
      fontFamily: 'Inter, sans-serif', textTransform: 'uppercase',
      letterSpacing: '0.18em', fontSize: '0.72rem', fontWeight: 500,
    }}>
      <img src={`${ASSETS}/icons/${iconName}.png`} alt=""
        style={{ width: 22, height: 22, objectFit: 'contain', opacity: 0.85 }} />
      {children}
    </div>
  )
}

function DishColumn({ iconName, title, dishes }) {
  return (
    <div>
      <h3 style={{
        fontFamily: 'Caveat, cursive', fontWeight: 600,
        color: 'var(--plum, #630812)', fontSize: '1.7rem',
        paddingBottom: 14, marginBottom: 24,
        borderBottom: '1px solid var(--line, rgba(99,8,18,0.18))',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <img src={`${ASSETS}/icons/${iconName}.png`} alt=""
          style={{ width: 36, height: 36, objectFit: 'contain', opacity: 0.9 }} />
        {title}
      </h3>
      {dishes.map((d, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'baseline', gap: 12, padding: '18px 0',
          borderBottom: '1px dotted var(--line, rgba(99,8,18,0.18))',
        }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem', fontWeight: 500 }}>
            {d.name}
            {d.thai && <span style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--muted, #7a6b62)', fontSize: '0.9rem', marginLeft: 8 }}>{d.thai}</span>}
          </div>
          {d.heat ? <span style={{ color: 'var(--chilli, #c9302c)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>{d.heat}</span> : <span />}
          <div style={{ color: 'var(--plum, #630812)', fontWeight: 500, fontFamily: 'Fraunces, serif', fontVariantNumeric: 'tabular-nums' }}>{d.price}</div>
          <div style={{ gridColumn: '1 / -1', fontSize: '0.9rem', color: 'var(--muted, #7a6b62)', marginTop: 4 }}>{d.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ── Inline styles ──────────────────────────────────────────

const containerStyle = {
  maxWidth: 1240, margin: '0 auto', padding: '0 32px',
  position: 'relative', zIndex: 2,
}
const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  padding: '14px 28px', borderRadius: 999, fontSize: '0.95rem', fontWeight: 500,
  background: 'var(--plum, #630812)', color: 'var(--cream, #f5efe6)',
  fontFamily: 'Inter, sans-serif',
}
const btnSecondary = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  padding: '14px 28px', borderRadius: 999, fontSize: '0.95rem', fontWeight: 500,
  background: 'transparent', color: 'var(--plum, #630812)',
  border: '1px solid var(--plum, #630812)',
  fontFamily: 'Inter, sans-serif',
}
const storyH2 = {
  fontFamily: 'Fraunces, serif',
  fontSize: 'clamp(2rem, 4vw, 3rem)',
  fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.02em',
  marginBottom: 24, color: 'var(--ink, #2a1c1a)',
}
