// shared/fonts.js
//
// The Google Fonts the admin offers: the website builder's font list
// (Brand & theme, block editors, reservations widget) and the menu
// designer. Plain ESM, no dependencies.
//
// Google Fonts v2 returns HTTP 400 for the WHOLE stylesheet if any one
// requested weight is missing for any one font, so each font asks only
// for the weights it has. The API-side copies (head.eta, siteDataSvc.js,
// scrolling_text.eta, reservations_widget.eta, canvas/siteBlocks.jsx) keep
// their own tables; add a new font to those too.

export const FONT_WEIGHTS = {
  'Inter':              '300;400;500;600;700;800',
  'Fraunces':           '300;400;500;600;700;800',
  'Caveat':             '400;500;600;700',
  'Playfair Display':   '400;500;600;700;800',
  'Poppins':            '300;400;500;600;700;800',
  'Lora':               '400;500;600;700',
  'Montserrat':         '300;400;500;600;700;800',
  'Roboto':             '300;400;500;700',
  'Open Sans':          '300;400;500;600;700;800',
  'Source Sans Pro':    '300;400;600;700',
  'Raleway':            '300;400;500;600;700;800',
  'Merriweather':       '300;400;700;900',
  'Work Sans':          '300;400;500;600;700;800',
  'Karla':              '300;400;500;600;700;800',
  'DM Sans':            '400;500;700',
  'DM Serif Display':   '400',
  'Space Grotesk':      '300;400;500;600;700',
  'Manrope':            '300;400;500;600;700;800',
  'Cormorant Garamond': '300;400;500;600;700',
  'Libre Baskerville':  '400;700',
  'Nunito':             '300;400;500;600;700;800',
  'Rubik':              '300;400;500;600;700;800',
}

// What the pickers list, in this order.
export const FONT_OPTIONS = [
  'Inter', 'Fraunces', 'Caveat', 'Playfair Display', 'Poppins',
  'Lora', 'Montserrat', 'Roboto', 'Open Sans', 'Raleway',
  'Merriweather', 'Work Sans', 'Karla', 'DM Sans', 'DM Serif Display',
  'Space Grotesk', 'Manrope', 'Cormorant Garamond', 'Libre Baskerville',
  'Nunito', 'Rubik',
]

const SERIF = new Set([
  'Fraunces', 'Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display',
  'Cormorant Garamond', 'Libre Baskerville',
])
const SCRIPT = new Set(['Caveat'])

// CSS font-family value with a fallback of the same kind. Single quotes,
// so it can sit inside a double-quoted style="" attribute.
export function fontStack(name) {
  const generic = SCRIPT.has(name) ? 'cursive' : SERIF.has(name) ? 'serif' : 'sans-serif'
  return "'" + name + "', " + generic
}

// Fraunces also loads its optical-size axis (finer letters at small sizes),
// as the printed menu always has.
function familyParam(name) {
  const w = FONT_WEIGHTS[name]
  if (name === 'Fraunces') return 'family=Fraunces:opsz,wght@' + w.split(';').map(x => '9..144,' + x).join(';')
  return 'family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@' + w
}

// One stylesheet URL for the given fonts; unknown names are dropped.
export function googleFontsUrl(names) {
  const list = [...new Set(names || [])].filter(n => FONT_WEIGHTS[n])
  if (!list.length) return null
  return 'https://fonts.googleapis.com/css2?' + list.map(familyParam).join('&') + '&display=swap'
}
