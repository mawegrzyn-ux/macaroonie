// shared/storeOpening.js
//
// Opening a new location with Pepper (migration 186): the areas a new
// location is set up in, the plan Pepper fills in and the server checks, and
// the words both sides use to describe it. Used by the API (checking Pepper's
// plan, creating the location: services/storeSetup.js) and the admin page.
//
// An area is set up one of three ways:
//   copy  from the location the plan names (template_venue_id)
//   new   from the settings in the plan (only areas that have settings)
//   skip  not set up now; someone does it on its page later
//
// The plan (normalisePlan() output):
//   venue          { name, slug, timezone, currency }
//   location       { address_line1, address_line2, city, postcode, country, phone, email }
//   opening_date   'YYYY-MM-DD' | null   before it: closed for bookings, ordering off
//   template_venue_id   uuid | null      the location areas are copied from
//   modes          { area: 'copy' | 'new' | 'skip' }
//   hours, tables, booking_rules, ordering, till, devices, food_safety,
//   checklists, purchasing, staff, emails: each area's settings for 'new'
//   (and the few that also change a copy: ordering.enabled, till.receipt_name,
//   purchasing.pars_percent, emails.from_name)

export const MODES = ['copy', 'new', 'skip']
export const MODE_LABELS = { copy: 'Copy', new: 'Set up new', skip: 'Leave for later' }

// Rounds of questions before Pepper must write the brief.
export const MAX_ROUNDS = 3

// modules: manage on every one of them sets the area up (any: on one of them).
// admin: also an owner or admin login (Cash Recon settings are).
export const OPENING_AREAS = [
  { key: 'hours',         label: 'Opening hours',            icon: 'Clock',             modules: ['schedule'],           modes: ['copy', 'new', 'skip'],
    about: 'Booking times for each day of the week: sittings, slot length and covers.' },
  { key: 'tables',        label: 'Tables',                   icon: 'Table2',            modules: ['tables'],             modes: ['copy', 'new', 'skip'],
    about: 'Rooms, tables and their sizes, combinations of tables.' },
  { key: 'booking_rules', label: 'Booking rules',            icon: 'Settings',          modules: ['rules'],              modes: ['copy', 'new', 'skip'],
    about: 'How long a booking lasts, party sizes, how far ahead guests can book, deposits.' },
  { key: 'website',       label: 'Location page',            icon: 'Globe',             modules: ['website'],            modes: ['copy', 'new', 'skip'],
    about: 'The location\'s page on the website: address, contact details, its page layout and pictures.' },
  { key: 'emails',        label: 'Booking emails',           icon: 'Mail',              modules: ['email_templates'],    modes: ['copy', 'skip'],
    about: 'Who booking emails come from, how they are sent, reminders and the location\'s own email wording.' },
  { key: 'ordering',      label: 'Online ordering',          icon: 'ShoppingBag',       modules: ['web_ordering_setup'], modes: ['copy', 'new', 'skip'],
    about: 'Collection ordering on the website: menus, hours, slots, tips, payment.' },
  { key: 'deliveroo',     label: 'Deliveroo menu file',      icon: 'Bike',              modules: ['menus'],              modes: ['copy', 'skip'],
    about: 'Deliveroo price uplift, allergen codes and dish matches.' },
  { key: 'tax',           label: 'Tax rates',                icon: 'Percent',           modules: ['menus'],              modes: ['copy', 'skip'],
    about: 'Tax rates that differ at this location from the company\'s rates.' },
  { key: 'till',          label: 'Till setup',               icon: 'MonitorSmartphone', modules: ['pos_setup'],          modes: ['copy', 'new', 'skip'],
    about: 'Till settings, receipts, revenue streams, floor plan areas, printers and where tickets print.' },
  { key: 'kitchen',       label: 'Kitchen screens',          icon: 'ChefHat',           modules: ['pos_setup'],          modes: ['copy', 'skip'],
    about: 'Kitchen stations and kitchen flows.' },
  { key: 'devices',       label: 'Devices to link',          icon: 'Tablet',            modules: ['pos_setup'],          modes: ['copy', 'new', 'skip'],
    about: 'Tills, kitchen screens, kiosks and menu screens, made ready for someone to link on the day.' },
  { key: 'cash',          label: 'Cash reconciliation',      icon: 'Wallet',            modules: ['cash_recon'], admin: true, modes: ['copy', 'new', 'skip'],
    about: 'Income sources, payment channels, service charge and tips sources, expense categories.' },
  { key: 'food_safety',   label: 'Food safety',              icon: 'Thermometer',       modules: ['food_safety'],        modes: ['copy', 'new', 'skip'],
    about: 'Fridges and freezers, hold stations, check times, cooking sessions and dishes.' },
  { key: 'checklists',    label: 'Checklists',               icon: 'ListChecks',        modules: ['checklists'],         modes: ['copy', 'new', 'skip'],
    about: 'Opening, closing, cleaning and other checklists with their tasks.' },
  { key: 'dashboards',    label: 'Dashboards',               icon: 'LayoutGrid',        modules: ['hs_dashboard', 'cash_dashboard', 'rota_dashboard', 'custom_dashboard'], any: true, modes: ['copy', 'skip'],
    about: 'The location\'s H&S, cash, rota and other dashboards with their widgets.' },
  { key: 'purchasing',    label: 'Purchasing',               icon: 'ShoppingCart',      modules: ['purchasing_setup'],   modes: ['copy', 'skip'],
    about: 'Suppliers\' delivery days and cutoffs, order lists and pars, prices for this location.' },
  { key: 'staff',         label: 'Team',                     icon: 'UsersRound',        modules: ['staff'],              modes: ['new', 'skip'],
    about: 'The people who will work there, with their role and pay.' },
]
export const AREA_KEYS = OPENING_AREAS.map(a => a.key)
export const AREA_BY_KEY = Object.fromEntries(OPENING_AREAS.map(a => [a.key, a]))
export const areaLabel = key => AREA_BY_KEY[key]?.label || (key === 'basics' ? 'The location' : key)

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Monday first, the way people read a week.
const WEEK = [1, 2, 3, 4, 5, 6, 0]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const int = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}
const num = (v, lo, hi, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : dflt
}
const time = v => {
  const t = str(v, 8)
  if (/^\d:\d{2}$/.test(t)) return '0' + t
  return TIME_RE.test(t.slice(0, 5)) ? t.slice(0, 5) : null
}
const realDate = v => {
  const d = str(v, 10)
  if (!DATE_RE.test(d)) return null
  const t = new Date(d + 'T12:00:00Z')
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d ? null : d
}
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])

/** A URL slug from a name: lower case letters, numbers and hyphens. */
export function slugify(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '') || 'location'
}

const CURRENCIES = new Set(['GBP', 'EUR', 'USD', 'PLN', 'AED', 'SGD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'RON', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'INR', 'CAD', 'NZD', 'ZAR', 'TRY', 'EGP'])

function cleanHours(h) {
  const interval = [15, 30, 60].includes(Number(h?.slot_interval_mins)) ? Number(h.slot_interval_mins) : 15
  const byDay = new Map()
  for (const d of list(h?.days, 14)) {
    const day = int(d?.day, 0, 6, null)
    if (day === null || byDay.has(day)) continue
    const sittings = []
    for (const s of list(d?.sittings, 6)) {
      const opens = time(s?.opens_at), closes = time(s?.closes_at)
      if (!opens || !closes || closes <= opens) continue
      const covers = int(s?.max_covers, 0, 2000, null)
      sittings.push({ name: str(s?.name, 60) || null, opens_at: opens, closes_at: closes, max_covers: covers || null })
    }
    sittings.sort((a, b) => a.opens_at.localeCompare(b.opens_at))
    byDay.set(day, { day, open: d?.open !== false && sittings.length > 0, sittings: d?.open === false ? [] : sittings })
  }
  return { slot_interval_mins: interval, days: WEEK.filter(d => byDay.has(d)).map(d => byDay.get(d)) }
}

function cleanTables(t) {
  const sections = []
  const labels = new Set()
  let count = 0
  for (const sec of list(t?.sections, 12)) {
    const tables = []
    for (const tb of list(sec?.tables, 120)) {
      if (count >= 200) break
      let label = str(tb?.label, 20)
      const max = int(tb?.max_covers, 1, 40, null)
      if (!label || !max) continue
      if (labels.has(label.toLowerCase())) continue
      labels.add(label.toLowerCase())
      const min = Math.min(max, int(tb?.min_covers, 1, 40, 1))
      tables.push({ label, min_covers: min, max_covers: max })
      count++
    }
    if (tables.length) sections.push({ name: str(sec?.name, 60) || 'Main room', tables })
  }
  return { sections }
}

function cleanRules(r) {
  const min = int(r?.min_covers, 1, 50, 1)
  return {
    slot_duration_mins: int(r?.slot_duration_mins, 15, 480, 90),
    min_covers: min,
    max_covers: Math.max(min, int(r?.max_covers, 1, 200, 8)),
    book_until_days: int(r?.book_until_days, 1, 730, 60),
    cutoff_before_mins: int(r?.cutoff_before_mins, 0, 2880, 60),
  }
}

function cleanFoodSafety(f) {
  const seen = new Set()
  const equipment = []
  for (const e of list(f?.equipment, 30)) {
    const name = str(e?.name, 60)
    const type = ['fridge', 'freezer'].includes(e?.type) ? e.type : 'fridge'
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    equipment.push({ name, type })
  }
  const times = [...new Set(list(f?.check_times, 8).map(time).filter(Boolean))].sort()
  const holdSeen = new Set()
  const hold_stations = []
  for (const h of list(f?.hold_stations, 20)) {
    const name = str(h?.name, 60)
    if (!name || holdSeen.has(name.toLowerCase())) continue
    holdSeen.add(name.toLowerCase())
    hold_stations.push({ name, hold_type: h?.hold_type === 'cold' || h?.hold_type === 'cold_hold' ? 'cold_hold' : 'hot_hold' })
  }
  const hold_times = [...new Set(list(f?.hold_check_times, 8).map(time).filter(Boolean))].sort()
  const cooking_sessions = []
  for (const c of list(f?.cooking_sessions, 8)) {
    const label = str(c?.label, 60)
    if (!label) continue
    cooking_sessions.push({ label, time: time(c?.time), required: int(c?.required, 0, 50, 1) })
  }
  return { equipment, check_times: times, hold_stations, hold_check_times: hold_times, cooking_sessions }
}

function cleanChecklists(c) {
  const lists = []
  for (const l of list(c?.lists, 12)) {
    const name = str(l?.name, 80)
    const tasks = [...new Set(list(l?.tasks, 40).map(t => str(t, 160)).filter(Boolean))]
    if (!name || !tasks.length) continue
    lists.push({ name, frequency: ['daily', 'weekly', 'monthly'].includes(l?.frequency) ? l.frequency : 'daily', tasks })
  }
  return { lists }
}

function cleanStaff(s) {
  const people = []
  const seen = new Set()
  for (const p of list(s?.people, 80)) {
    const name = str(p?.name, 80)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    people.push({
      name,
      role: str(p?.role, 60) || null,
      pay_type: p?.pay_type === 'hourly' ? 'hourly' : 'fixed',
      rate: num(p?.rate, 0, 100000, 0),
    })
  }
  return { people }
}

function cleanTill(t) {
  const streams = []
  const seen = new Set()
  for (const s of list(t?.streams, 10)) {
    const name = str(s?.name, 60)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    streams.push({ name, service_charge_percent: num(s?.service_charge_percent, 0, 30, 0) })
  }
  return { receipt_name: str(t?.receipt_name, 80) || null, streams }
}

const cleanDevices = d => ({
  tills: int(d?.tills, 0, 30, 0),
  kitchen_screens: int(d?.kitchen_screens, 0, 30, 0),
  kiosks: int(d?.kiosks, 0, 30, 0),
  menu_screens: int(d?.menu_screens, 0, 40, 0),
})

/** True when a 'new' area has nothing to set up from. */
function emptyNew(key, p) {
  switch (key) {
    case 'hours': return !p.hours.days.some(d => d.open)
    case 'tables': return !p.tables.sections.length
    case 'devices': { const d = p.devices; return !(d.tills || d.kitchen_screens || d.kiosks || d.menu_screens) }
    case 'food_safety': { const f = p.food_safety; return !(f.equipment.length || f.check_times.length || f.hold_stations.length || f.cooking_sessions.length) }
    case 'checklists': return !p.checklists.lists.length
    case 'staff': return !p.staff.people.length
    default: return false
  }
}

/**
 * A checked plan from Pepper's (or anyone's) raw plan, with the person's own
 * choices laid over it. Never throws: anything unusable falls back to a
 * default, an area that can't be done the way asked is changed (copy without
 * a location to copy from becomes new where it can, else skip; new with
 * nothing to set up from becomes skip).
 *   opts.templates   Set of venue ids that can be copied from (the tenant's own)
 *   opts.today       'YYYY-MM-DD' (opening dates before it are dropped)
 */
export function normalisePlan(raw = {}, overrides = {}, opts = {}) {
  const r = raw || {}
  const o = overrides || {}
  const v = { ...(r.venue || {}), ...(o.venue || {}) }
  const name = str(v.name, 120) || str(r.title, 120) || 'New location'
  const slug = slugify(str(v.slug, 60) || name)
  const loc = { ...(r.location || {}), ...(o.location || {}) }
  const templates = opts.templates || new Set()

  const template = o.template_venue_id !== undefined ? o.template_venue_id : r.template_venue_id
  const plan = {
    venue: {
      name,
      slug,
      timezone: str(v.timezone, 60) || 'Europe/London',
      currency: CURRENCIES.has(str(v.currency, 3).toUpperCase()) ? str(v.currency, 3).toUpperCase() : 'GBP',
    },
    location: {
      address_line1: str(loc.address_line1, 120) || null,
      address_line2: str(loc.address_line2, 120) || null,
      city: str(loc.city, 80) || null,
      postcode: str(loc.postcode, 20) || null,
      country: str(loc.country, 60) || null,
      phone: str(loc.phone, 40) || null,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(loc.email, 120)) ? str(loc.email, 120) : null,
    },
    opening_date: null,
    template_venue_id: typeof template === 'string' && UUID_RE.test(template) && templates.has(template) ? template : null,
    modes: {},
    hours: cleanHours(r.hours),
    tables: cleanTables(r.tables),
    booking_rules: cleanRules(r.booking_rules),
    ordering: { enabled: !!r.ordering?.enabled },
    till: cleanTill(r.till),
    devices: cleanDevices(r.devices),
    food_safety: cleanFoodSafety(r.food_safety),
    checklists: cleanChecklists(r.checklists),
    purchasing: { pars_percent: int(r.purchasing?.pars_percent, 10, 500, 100) },
    staff: cleanStaff(r.staff),
    emails: { from_name: str(r.emails?.from_name, 80) || null },
  }
  const opening = realDate(o.opening_date !== undefined ? o.opening_date : r.opening_date)
  plan.opening_date = opening && (!opts.today || opening >= opts.today) ? opening : null

  const rawModes = { ...(r.modes || {}), ...(o.modes || {}) }
  for (const a of OPENING_AREAS) {
    let m = MODES.includes(rawModes[a.key]) ? rawModes[a.key] : (plan.template_venue_id && a.modes.includes('copy') ? 'copy' : 'skip')
    if (!a.modes.includes(m)) m = a.modes.includes('new') && m === 'copy' ? 'new' : 'skip'
    if (m === 'copy' && !plan.template_venue_id) m = a.modes.includes('new') ? 'new' : 'skip'
    if (m === 'new' && emptyNew(a.key, plan)) m = 'skip'
    plan.modes[a.key] = m
  }
  return plan
}

/** Problems that stop the location being created (the API adds slug and time zone checks). */
export function planProblems(plan) {
  const out = []
  if (!plan?.venue?.name) out.push('The location needs a name.')
  if (!/^[a-z0-9-]+$/.test(plan?.venue?.slug || '')) out.push('The web address needs letters, numbers and hyphens only.')
  return out
}

// ── Words ───────────────────────────────────────────────────────

const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)

/** "Mon-Fri 12:00-15:00, 17:00-22:00; Sat-Sun closed" from [{ day, open, sittings }]. */
export function hoursText(days) {
  const byDay = new Map((days || []).map(d => [d.day, d]))
  const key = d => (d && d.open && d.sittings?.length ? d.sittings.map(s => s.opens_at.slice(0, 5) + '-' + s.closes_at.slice(0, 5)).join(', ') : 'closed')
  const runs = []
  for (const day of WEEK) {
    const k = key(byDay.get(day))
    const last = runs[runs.length - 1]
    if (last && last.k === k) last.to = day
    else runs.push({ from: day, to: day, k })
  }
  return runs.map(r => (r.from === r.to ? DAY_SHORT[r.from] : DAY_SHORT[r.from] + '-' + DAY_SHORT[r.to]) + ' ' + r.k).join('; ')
}

export function tablesText(t) {
  const tables = t.sections.flatMap(s => s.tables)
  const seats = tables.reduce((n, x) => n + x.max_covers, 0)
  return plural(tables.length, 'table') + ' in ' + plural(t.sections.length, 'room') + ' (' + seats + ' seats)'
}

const deviceWords = d => [
  d.tills && plural(d.tills, 'till'),
  d.kitchen_screens && plural(d.kitchen_screens, 'kitchen screen'),
  d.kiosks && plural(d.kiosks, 'kiosk'),
  d.menu_screens && plural(d.menu_screens, 'menu screen'),
].filter(Boolean).join(', ')

/**
 * One line per area saying what creating the location will do, from the
 * plan and a summary of the location copied from (storeSetup.venueSummary).
 */
export function previewPlan(plan, template) {
  const from = template?.name || 'the location copied from'
  const s = template?.areas || {}
  const out = {}
  for (const a of OPENING_AREAS) {
    const m = plan.modes[a.key]
    if (m === 'skip') { out[a.key] = 'Left for later.'; continue }
    if (m === 'copy') {
      const what = s[a.key]?.text
      out[a.key] = what ? 'Copied from ' + from + ': ' + what + '.' : 'Copied from ' + from + ' (it has nothing set up here yet).'
      if (a.key === 'purchasing' && plan.purchasing.pars_percent !== 100) out[a.key] += ' Pars at ' + plan.purchasing.pars_percent + '% of ' + from + '\'s.'
      if (a.key === 'ordering') out[a.key] += plan.ordering.enabled && !plan.opening_date ? ' Switched on.' : ' Switched off until opening.'
      if (a.key === 'emails' && plan.emails.from_name) out[a.key] += ' Sent as "' + plan.emails.from_name + '".'
      continue
    }
    switch (a.key) {
      case 'hours': out.hours = hoursText(plan.hours.days) + ' (' + plan.hours.slot_interval_mins + '-minute slots).'; break
      case 'tables': out.tables = tablesText(plan.tables) + '.'; break
      case 'booking_rules': {
        const b = plan.booking_rules
        out.booking_rules = 'Bookings last ' + b.slot_duration_mins + ' minutes, parties of ' + b.min_covers + '-' + b.max_covers + ', up to ' + b.book_until_days + ' days ahead.'
        break
      }
      case 'website': out.website = 'A new location page with the address and contact details.'; break
      case 'ordering': out.ordering = 'Set up and switched off: pick its menus and hours in Ordering setup.'; break
      case 'till': {
        const names = plan.till.streams.map(x => x.name)
        out.till = 'Till settings' + (plan.till.receipt_name ? ' (receipts say "' + plan.till.receipt_name + '")' : '') + ', revenue streams: ' + (names.length ? names.join(', ') : 'Restaurant') + '.'
        break
      }
      case 'devices': out.devices = deviceWords(plan.devices) + ', ready to link.'; break
      case 'cash': out.cash = 'Standard sources: Food and Drink income, Cash and Card takings, Card tips, four expense categories.'; break
      case 'food_safety': {
        const f = plan.food_safety
        const fr = f.equipment.filter(e => e.type === 'fridge').length, fz = f.equipment.length - fr
        out.food_safety = [
          fr && plural(fr, 'fridge'), fz && plural(fz, 'freezer'),
          f.check_times.length && 'checks at ' + f.check_times.join(', '),
          f.hold_stations.length && plural(f.hold_stations.length, 'hold station'),
          f.cooking_sessions.length && plural(f.cooking_sessions.length, 'cooking session'),
        ].filter(Boolean).join(', ') + '.'
        break
      }
      case 'checklists': out.checklists = plan.checklists.lists.map(l => l.name + ' (' + plural(l.tasks.length, 'task') + ')').join(', ') + '.'; break
      case 'staff': out.staff = plural(plan.staff.people.length, 'person', 'people') + ': ' + plan.staff.people.map(p => p.name).join(', ') + '.'; break
      default: out[a.key] = 'Set up new.'
    }
  }
  return out
}

// ── After creating ──────────────────────────────────────────────

// The page each area is set up on.
export const AREA_LINKS = {
  hours: '/schedule', tables: '/tables', booking_rules: '/rules', website: '/website', emails: '/email-templates',
  ordering: '/orders/settings', deliveroo: '/menus/deliveroo', tax: '/menus/tax', till: '/pos?tab=receipts',
  kitchen: '/pos?tab=kitchen', devices: '/pos?tab=tills', cash: '/cash-recon', food_safety: '/food-safety',
  checklists: '/checklists', dashboards: '/hs-dashboard', purchasing: '/suppliers', staff: '/staff',
}

/**
 * What is left for people to do once the location is made: [{ key, text, link, done }].
 * From what creating it did (results), the location copied from (its summary)
 * and the brief's own follow-ups (things outside the app).
 */
export function buildFollowups({ plan, results, template, brief, venueName }) {
  const out = []
  const add = (key, text, link = null) => out.push({ key, text, link, done: false })
  const done = k => results?.[k]?.status === 'done'
  const name = venueName || plan.venue.name
  if (done('devices')) {
    add('link_devices', 'On site, link each till, kitchen screen, kiosk and menu screen at ' + name + ': open the installer on a phone and type or scan the code each device shows.', '/pos?tab=tills')
  }
  if (done('till') && plan.modes.till === 'copy') add('printers', 'Check each printer\'s network address at ' + name + ' (copied printers keep the old addresses).', '/pos?tab=printers')
  if (done('website')) add('website', 'Check ' + name + '\'s location page (address, words and pictures), then publish the website.', '/website')
  if (done('ordering')) {
    add('ordering', plan.opening_date
      ? 'Switch online ordering on for ' + name + ' on opening day (' + plan.opening_date + ').'
      : 'Check ' + name + '\'s online ordering menus and switch it on when ready.', '/orders/settings')
  }
  if (plan.opening_date && done('hours')) add('bookings', 'Bookings open from ' + plan.opening_date + ': the "Not open yet" closure ends the day before. Move it on the Schedule page if the date changes.', '/schedule')
  if (done('purchasing')) add('suppliers', 'Add ' + name + '\'s account number with each supplier.', '/suppliers')
  if (!done('staff')) add('team', 'Add the team at ' + name + ': their roles, pay and till PINs.', '/staff')
  else add('team', 'Give each person at ' + name + ' a till PIN and check their pay.', '/staff')
  if (template?.links?.gloriafood) add('gloriafood', 'Link ' + name + ' to its GloriaFood restaurant in Cash Recon settings (links aren\'t copied).', '/cash-recon')
  if (template?.links?.loyverse) add('loyverse', 'Link ' + name + ' to its Loyverse store in Cash Recon settings (links aren\'t copied).', '/cash-recon')
  for (const a of OPENING_AREAS) {
    const r = results?.[a.key]
    if (r?.status === 'no_access') add('access-' + a.key, 'Someone with access sets up ' + a.label.toLowerCase() + ' for ' + name + '.', AREA_LINKS[a.key])
    else if (r?.status === 'skipped' && plan.modes[a.key] === 'skip' && ['hours', 'tables', 'booking_rules', 'till', 'cash', 'food_safety', 'checklists'].includes(a.key)) {
      add('later-' + a.key, 'Set up ' + a.label.toLowerCase() + ' for ' + name + '.', AREA_LINKS[a.key])
    }
  }
  for (const [i, text] of (brief?.followups || []).entries()) add('pepper-' + (i + 1), text)
  return out
}
