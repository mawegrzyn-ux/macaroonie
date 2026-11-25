// The kiosk sandbox on macaroonie.com/try/kiosk
// (views/platform/site/try-kiosk.eta). A module, no build.
//
// The visitor's choices make a kiosk design, cleaned by the kiosk's own
// normaliseDesign() and drawn through its own rules (shared/kiosk.js: the
// font list and stacks, the Google Fonts address, kioskTextVars() for the
// text sizes, partColours() for the bottom bar, the kiosk's built-in words
// with uiText(); prices with money() from shared/pos/pricing.js), served by
// the API at /site/shared/<version>/ (services/platformSite/sharedModules.js).
// The screens are a small stand-in for the kiosk app (pos/src/kiosk) with
// the same steps: Welcome, Menu, a dish, the order, Done. Nothing is sent;
// the visitor's design is kept in this browser's localStorage only.

const root = document.getElementById('ks')
const base = root.dataset.shared
const [Kiosk, Pricing, Theme] = await Promise.all([
  import(base + 'kiosk.js'),
  import(base + 'pos/pricing.js'),
  import(base + 'themeKit.js'),
])
const { normaliseDesign, kioskTextVars, kioskFontStack, kioskFontsUrl, partColours, uiText, KIOSK_FONTS, SYSTEM_FONT, TEXT_SIZE_PARTS, TEXT_SIZE_STEP, DESIGN_COLORS } = Kiosk
const { money } = Pricing

const STORE = 'macaroonie-try-kiosk'
const SWATCHES = ['#0b6b3a', '#630812', '#1d4ed8', '#c2410c', '#7c3aed', '#111827']
const CATEGORIES = ['Mains', 'Sides', 'Drinks']
const SIZES = [{ label: 'Regular', add: 0 }, { label: 'Large', add: 150 }]
const t = (key, vars) => uiText('en', key, vars)

function defaults() {
  return {
    colour: DESIGN_COLORS.primary,
    font_heading: 'Oswald', font_body: 'Inter',
    text_sizes: { body: 100, headings: 100, buttons: 100, prices: 100 },
    logo: 'Quayside',
    dishes: [
      { name: 'Smash burger', price: 1095, cat: 0 },
      { name: 'Chicken wrap', price: 895, cat: 0 },
      { name: 'Fries', price: 350, cat: 1 },
      { name: 'Lemonade', price: 295, cat: 2 },
    ],
  }
}

function load() {
  const d = defaults()
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (raw && typeof raw === 'object') {
      if (/^#[0-9a-f]{6}$/i.test(raw.colour)) d.colour = raw.colour
      if (typeof raw.font_heading === 'string') d.font_heading = raw.font_heading
      if (typeof raw.font_body === 'string') d.font_body = raw.font_body
      if (raw.text_sizes && typeof raw.text_sizes === 'object') d.text_sizes = raw.text_sizes
      if (typeof raw.logo === 'string') d.logo = raw.logo.slice(0, 24)
      if (Array.isArray(raw.dishes)) {
        raw.dishes.slice(0, d.dishes.length).forEach((x, i) => {
          if (typeof x?.name === 'string') d.dishes[i].name = x.name.slice(0, 40)
          if (Number.isInteger(x?.price) && x.price >= 0 && x.price <= 99999) d.dishes[i].price = x.price
        })
      }
    }
  } catch { /* storage blocked or bad: the defaults */ }
  return d
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S.look)) } catch { /* not kept */ }
}

const S = {
  look: load(),
  screen: 'welcome',   // welcome | menu | dish | order | done
  type: null,          // Eat in / Take away
  cat: 0,
  dish: null,          // { i, size, qty } on the dish screen
  basket: [],          // [{ i, size, qty }]
  number: 0,
}

// The look as a kiosk design, cleaned by the kiosk's own rules.
function design() {
  const c = S.look.colour
  const ink = Theme.contrast('#ffffff', c) >= Theme.contrast(DESIGN_COLORS.text, c) ? '#ffffff' : DESIGN_COLORS.text
  return normaliseDesign({
    brand: {
      colors: { primary: c, primary_text: ink },
      font_heading: S.look.font_heading, font_body: S.look.font_body,
      text_sizes: S.look.text_sizes,
    },
  })
}

// ── Drawing helpers ───────────────────────────────────────────

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'style') Object.assign(e.style, v)
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)))
  return e
}
const initials = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
const dishPrice = (i, size) => S.look.dishes[i].price + SIZES[size].add
const lineTotal = l => dishPrice(l.i, l.size) * l.qty
const count = () => S.basket.reduce((n, l) => n + l.qty, 0)
const total = () => S.basket.reduce((n, l) => n + lineTotal(l), 0)
const btn = (cls, label, onclick, extra = {}) => el('button', { type: 'button', class: 'k-btn ' + cls, onclick, ...extra }, label)

// ── The preview ───────────────────────────────────────────────

function drawPreview() {
  const d = design()
  const c = d.brand.colors
  const p = partColours(c)
  const vars = {
    '--k-bg': c.background, '--k-surface': c.surface, '--k-text': c.text, '--k-muted': c.muted,
    '--k-primary': c.primary, '--k-primary-text': c.primary_text, '--k-accent': c.accent, '--k-accent-text': c.accent_text,
    '--k-bar': p.bar, '--k-bar-text': p.bar_text, '--k-radius': d.brand.radius + 'px',
    '--k-font-head': kioskFontStack(d.brand.font_heading), '--k-font-body': kioskFontStack(d.brand.font_body),
    ...kioskTextVars(d),
  }
  const kiosk = document.querySelector('.ksk')
  for (const [k, v] of Object.entries(vars)) kiosk.style.setProperty(k, v)
  kiosk.dataset.case = d.brand.heading_case
  const url = kioskFontsUrl(d)
  let link = document.getElementById('ks-fonts')
  if (url) {
    if (!link) { link = el('link', { id: 'ks-fonts', rel: 'stylesheet' }); document.head.append(link) }
    if (link.href !== url) link.href = url
  }
  const screen = SCREENS[S.screen]()
  kiosk.replaceChildren(el('div', { class: 'k-band' }, t('preview')), screen)
}

function header() {
  return el('div', { class: 'k-top' }, el('span', { class: 'k-head k-logo' }, S.look.logo || ' '))
}

const SCREENS = {
  welcome: () => el('div', { class: 'k-screen k-welcome' },
    el('div', { class: 'k-hero' },
      el('span', { class: 'k-head k-logo k-logo-big' }, S.look.logo || ' '),
      el('h3', { class: 'k-head k-title' }, t('order_here')),
      el('p', { class: 'k-sub' }, t('staying_or_going'))),
    el('div', { class: 'k-types' },
      ['Eat in', 'Take away'].map(type => btn('k-type', [icon(type === 'Eat in' ? ICON_IN : ICON_AWAY), type], () => {
        S.type = type
        go('menu')
      })))),

  menu: () => {
    const items = S.look.dishes.map((d, i) => ({ ...d, i })).filter(d => d.cat === S.cat)
    return el('div', { class: 'k-screen k-menu' },
      header(),
      el('div', { class: 'k-body' },
        el('nav', { class: 'k-rail', 'aria-label': 'Sections' }, CATEGORIES.map((name, n) =>
          btn('k-rail-btn' + (n === S.cat ? ' k-on' : ''), name, () => { S.cat = n; drawPreview(); focusIn('.k-rail-btn.k-on') }, { 'aria-pressed': String(n === S.cat) }))),
        el('div', { class: 'k-list' },
          el('h3', { class: 'k-head k-section' }, CATEGORIES[S.cat]),
          el('div', { class: 'k-grid' }, items.map(d =>
            el('button', { type: 'button', class: 'k-item', onclick: () => { S.dish = { i: d.i, size: 0, qty: 1 }; go('dish') } },
              el('span', { class: 'k-ph', 'aria-hidden': 'true' }, initials(d.name)),
              el('span', { class: 'k-item-text' },
                el('span', { class: 'k-head k-item-name' }, d.name),
                el('span', { class: 'k-price' }, money(d.price)))))))),
      bar())
  },

  dish: () => {
    const x = S.dish
    const d = S.look.dishes[x.i]
    return el('div', { class: 'k-screen k-dish' },
      header(),
      el('div', { class: 'k-dish-body' },
        el('span', { class: 'k-ph k-ph-big', 'aria-hidden': 'true' }, initials(d.name)),
        el('h3', { class: 'k-head k-title' }, d.name),
        el('span', { class: 'k-price' }, money(dishPrice(x.i, x.size))),
        el('p', { class: 'k-step' }, t('your_choice')),
        el('div', { class: 'k-chips' }, SIZES.map((s, n) => btn('k-chip' + (x.size === n ? ' k-on' : ''), [s.label, s.add ? el('small', {}, ' +' + money(s.add)) : null], () => { x.size = n; drawPreview(); focusIn('.k-chip.k-on') }, { 'aria-pressed': String(x.size === n) }))),
        el('p', { class: 'k-step' }, t('quantity')),
        qty(x.qty, n => { x.qty = n; drawPreview(); focusIn('.k-qty .k-on-focus') })),
      el('div', { class: 'k-bar k-bar-dish' },
        btn('k-btn-ghost', t('back'), () => go('menu')),
        btn('k-btn-primary', t('add_to_order') + ' ' + money(dishPrice(x.i, x.size) * x.qty), () => {
          const same = S.basket.find(l => l.i === x.i && l.size === x.size)
          if (same) same.qty += x.qty
          else S.basket.push({ i: x.i, size: x.size, qty: x.qty })
          go('menu')
        })))
  },

  order: () => el('div', { class: 'k-screen k-order' },
    header(),
    el('div', { class: 'k-list' },
      el('h3', { class: 'k-head k-section' }, t('your_order')),
      S.basket.length
        ? el('ul', { class: 'k-lines' }, S.basket.map(l => el('li', {},
            el('span', { class: 'k-line-name' }, el('b', {}, S.look.dishes[l.i].name), el('small', {}, SIZES[l.size].label)),
            qty(l.qty, n => {
              if (n <= 0) S.basket = S.basket.filter(x => x !== l)
              else l.qty = n
              drawPreview()
              focusIn('.k-lines .k-on-focus') || focusIn('.k-bar .k-btn')
            }, 0),
            el('span', { class: 'k-price' }, money(lineTotal(l))))))
        : el('p', { class: 'k-sub' }, t('empty_order')),
      el('p', { class: 'k-total' }, el('span', {}, t('total')), el('span', { class: 'k-price' }, money(total())))),
    el('div', { class: 'k-bar k-bar-dish' },
      btn('k-btn-ghost', t('add_more'), () => go('menu')),
      btn('k-btn-primary', t('checkout'), () => { S.number = 100 + Math.floor(Math.random() * 900); go('done') }, { disabled: !S.basket.length }))),

  done: () => el('div', { class: 'k-screen k-done' },
    el('div', { class: 'k-hero' },
      el('span', { class: 'k-head k-logo k-logo-big' }, S.look.logo || ' '),
      el('h3', { class: 'k-head k-title' }, t('thank_you')),
      el('p', { class: 'k-sub' }, t('order_number')),
      el('p', { class: 'k-head k-number' }, String(S.number)),
      el('p', { class: 'k-sub' }, (S.type ? S.type + '. ' : '') + t('paid_note'))),
    el('div', { class: 'k-types' }, btn('k-btn-primary k-wide', t('done'), () => { S.basket = []; S.type = null; S.cat = 0; go('welcome') }))),
}

const ICON_IN = '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/><path d="M3 4v6m0 0v10M21 4v16"/>'
const ICON_AWAY = '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'
function icon(paths) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', 'k-type-icon')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</g>'
  return s
}

function qty(n, set, min = 1) {
  return el('div', { class: 'k-qty' },
    btn('k-round' + (n <= min ? '' : ' k-on-focus'), '−', () => set(n - 1), { 'aria-label': t('one_less'), disabled: n <= min }),
    el('span', { class: 'k-n', 'aria-live': 'polite' }, String(n)),
    btn('k-round', '+', () => set(n + 1), { 'aria-label': t('one_more'), disabled: n >= 20 }))
}

function bar() {
  const n = count()
  return el('div', { class: 'k-bar' },
    btn('k-btn-ghost k-bar-ghost', t('start_again'), () => { S.basket = []; go('welcome') }),
    el('span', { class: 'k-sum' }, el('span', {}, n === 1 ? t('item_count_one') : t('item_count', { n })), el('b', { class: 'k-price' }, money(total()))),
    btn('k-btn-accent', t('view_order'), () => go('order')))
}

function go(screen) {
  S.screen = screen
  drawPreview()
  const dots = document.querySelectorAll('.ks-steps [data-step]')
  dots.forEach(d => d.setAttribute('aria-current', d.dataset.step === screen ? 'step' : 'false'))
  focusIn('.k-screen button:not([disabled])')
}
function focusIn(sel) {
  if (!S.used) return true
  if (!document.querySelector('.ksk').contains(document.activeElement) && document.activeElement !== document.body) return true
  const e = document.querySelector('.ksk ' + sel)
  if (e) e.focus({ preventScroll: true })
  return !!e
}

// ── The controls ──────────────────────────────────────────────

function drawControls() {
  const L = S.look
  const change = fn => e => { fn(e.target); save(); drawPreview() }
  const fontOptions = sel => [SYSTEM_FONT, ...KIOSK_FONTS].map(f => el('option', { value: f, selected: f === sel }, f === SYSTEM_FONT ? 'The screen\'s own' : f))
  const picker = el('input', { type: 'color', class: 'ks-picker', id: 'ks-colour', value: L.colour, 'aria-label': 'Any colour' })
  picker.addEventListener('input', change(x => { L.colour = x.value; markSwatch() }))
  const swatches = SWATCHES.map(c => el('button', { type: 'button', class: 'ks-swatch', style: { background: c }, 'data-colour': c, 'aria-label': 'Brand colour ' + c, onclick: () => { L.colour = c; picker.value = c; markSwatch(); save(); drawPreview() } }))
  const markSwatch = () => swatches.forEach(s => s.setAttribute('aria-pressed', String(s.dataset.colour === L.colour)))
  markSwatch()

  const groups = [
    el('section', { class: 'ks-group' }, el('h2', {}, 'Brand'),
      el('label', { for: 'ks-logo' }, 'Logo word'),
      (() => { const i = el('input', { type: 'text', id: 'ks-logo', value: L.logo, maxlength: '24', autocomplete: 'off' }); i.addEventListener('input', change(x => { L.logo = x.value })); return i })(),
      el('span', { class: 'ks-label', id: 'ks-colour-label' }, 'Brand colour'),
      el('div', { class: 'ks-swatches', role: 'group', 'aria-labelledby': 'ks-colour-label' }, swatches, picker)),
    el('section', { class: 'ks-group' }, el('h2', {}, 'Fonts'),
      el('label', { for: 'ks-fh' }, 'Headings'),
      (() => { const s = el('select', { id: 'ks-fh' }, fontOptions(L.font_heading)); s.addEventListener('change', change(x => { L.font_heading = x.value })); return s })(),
      el('label', { for: 'ks-fb' }, 'Body text'),
      (() => { const s = el('select', { id: 'ks-fb' }, fontOptions(L.font_body)); s.addEventListener('change', change(x => { L.font_body = x.value })); return s })()),
    el('section', { class: 'ks-group' }, el('h2', {}, 'Text sizes'),
      TEXT_SIZE_PARTS.map(p => {
        const id = 'ks-size-' + p.key
        const out = el('output', { for: id }, (L.text_sizes[p.key] ?? 100) + '%')
        const r = el('input', { type: 'range', id, min: String(p.min), max: String(p.max), step: String(TEXT_SIZE_STEP), value: String(L.text_sizes[p.key] ?? 100) })
        r.addEventListener('input', change(x => { L.text_sizes = { ...L.text_sizes, [p.key]: Number(x.value) }; out.textContent = x.value + '%' }))
        return el('div', { class: 'ks-range' }, el('label', { for: id }, p.label), out, r)
      })),
    el('section', { class: 'ks-group' }, el('h2', {}, 'Dishes'),
      L.dishes.map((d, i) => {
        const name = el('input', { type: 'text', value: d.name, maxlength: '40', 'aria-label': 'Dish ' + (i + 1) + ' name (' + CATEGORIES[d.cat] + ')', autocomplete: 'off' })
        name.addEventListener('input', change(x => { d.name = x.value.trim() || 'Dish ' + (i + 1) }))
        const price = el('input', { type: 'text', inputmode: 'decimal', value: (d.price / 100).toFixed(2), 'aria-label': 'Dish ' + (i + 1) + ' price in pounds', autocomplete: 'off' })
        price.addEventListener('change', change(x => {
          const v = Math.round(parseFloat(String(x.value).replace(/[^0-9.]/g, '')) * 100)
          d.price = Number.isFinite(v) ? Math.min(99999, Math.max(0, v)) : d.price
          x.value = (d.price / 100).toFixed(2)
        }))
        return el('div', { class: 'ks-dish' }, name, price)
      })),
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: reset }, 'Reset'),
  ]
  document.querySelector('.ks-controls').replaceChildren(...groups)
}

function reset() {
  S.look = defaults()
  S.basket = []
  S.type = null
  S.cat = 0
  try { localStorage.removeItem(STORE) } catch { /* nothing kept */ }
  drawControls()
  go('welcome')
}

document.querySelectorAll('.ks-steps [data-step]').forEach(b => b.addEventListener('click', () => {
  const step = b.dataset.step
  if (step === 'dish' && !S.dish) S.dish = { i: 0, size: 0, qty: 1 }
  if (step === 'done' && !S.number) S.number = 101
  go(step)
}))

document.querySelector('.ksk').addEventListener('click', () => { S.used = true }, true)
document.querySelector('.ksk').addEventListener('keydown', () => { S.used = true }, true)
drawControls()
go('welcome')
root.classList.add('ks-ready')
