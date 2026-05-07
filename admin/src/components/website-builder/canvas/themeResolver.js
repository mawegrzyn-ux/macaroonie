// canvas/themeResolver.js
//
// Mirror of api/src/views/site/shared/head.eta theme resolution. Keep
// the two in sync — when a knob is added on the public side, add it
// here too.

const GOOGLE_FONTS = new Set([
  'Inter', 'Playfair Display', 'Poppins', 'Lora', 'Montserrat', 'Roboto', 'Open Sans',
  'Source Sans Pro', 'Raleway', 'Merriweather', 'Work Sans', 'Karla', 'DM Sans', 'DM Serif Display',
  'Space Grotesk', 'Manrope', 'Cormorant Garamond', 'Libre Baskerville', 'Nunito', 'Rubik',
])

export function resolveTheme(config) {
  const t = (config && config.theme) || {}
  const colors     = t.colors     || {}
  const typography = t.typography || {}
  const spacing    = t.spacing    || {}
  const radii      = t.radii      || {}
  const logo       = t.logo       || {}
  const buttons    = t.buttons    || {}
  const hero       = t.hero       || {}

  const primary    = colors.primary    || config?.primary_colour    || '#630812'
  const accent     = colors.accent     || config?.secondary_colour  || '#f4a7b9'
  const background = colors.background || '#ffffff'
  const surface    = colors.surface    || '#f9f6f1'
  const textColor  = colors.text       || '#1a1a1a'
  const mutedColor = colors.muted      || '#666666'
  const border     = colors.border     || '#e5e7eb'

  const headingFont = typography.heading_font || config?.font_family || 'Inter'
  const bodyFont    = typography.body_font    || config?.font_family || 'Inter'
  const baseSize    = typography.base_size_px   || 16
  const hScale      = typography.heading_scale  || 1.25
  const hWeight     = typography.heading_weight || 700
  const bWeight     = typography.body_weight    || 400
  const lineHeight  = typography.line_height    || 1.5
  const letterSp    = typography.letter_spacing || 'normal'

  const containerMax = spacing.container_max_px    || 1100
  const sectionY     = spacing.section_y_px        || 72
  const sectionYMob  = spacing.section_y_mobile_px || 48
  const gap          = spacing.gap_px              || 24

  const rSm = (radii.sm_px != null ? radii.sm_px :  4)
  const rMd = (radii.md_px != null ? radii.md_px :  8)
  const rLg = (radii.lg_px != null ? radii.lg_px : 16)

  const logoH = logo.height_px || 36

  const btnR  = (buttons.radius_px    != null ? buttons.radius_px    : 4)
  const btnPy = (buttons.padding_y_px != null ? buttons.padding_y_px : 12)
  const btnPx = (buttons.padding_x_px != null ? buttons.padding_x_px : 28)
  const btnW  = buttons.weight   || 600

  const heroOpacity = (hero.overlay_opacity != null ? hero.overlay_opacity : 0.4)
  const heroMinH    = hero.min_height_px || 520

  const fontsToLoad = []
  if (GOOGLE_FONTS.has(headingFont)) fontsToLoad.push(headingFont)
  if (GOOGLE_FONTS.has(bodyFont) && bodyFont !== headingFont) fontsToLoad.push(bodyFont)
  const googleFontsUrl = fontsToLoad.length
    ? `https://fonts.googleapis.com/css2?${fontsToLoad.map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800`).join('&')}&display=swap`
    : null

  return {
    primary, accent, background, surface, textColor, mutedColor, border,
    headingFont, bodyFont, baseSize, hScale, hWeight, bWeight, lineHeight, letterSp,
    containerMax, sectionY, sectionYMob, gap,
    rSm, rMd, rLg,
    logoH,
    btnR, btnPy, btnPx, btnW,
    heroOpacity, heroMinH,
    googleFontsUrl,
  }
}
