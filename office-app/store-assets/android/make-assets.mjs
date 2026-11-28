// Google Play store assets for Macaroonie Office: the phone screenshots and
// the feature graphic, taken from the real phone pages (/mobile, what the app
// shows in its web view) with invented demo data. make-assets.py then makes
// the 512 px icon, takes the alpha off the screenshots and the feature
// graphic (Play wants 24-bit PNGs for those) and checks every size.
//
// Run from the repo root, on a computer with Postgres 16, Redis and
// Playwright (README.md, Google Play):
//
//   eval "$(scripts/test-env.sh playassets)"      # a test database of its own
//   node office-app/store-assets/android/make-assets.mjs
//   python3 office-app/store-assets/android/make-assets.py
//
// What it does: empties that test database (it must be a test one: rule 27)
// and fills it with an invented group, Harbour & Co, venues Quayside and West
// Pier, invented staff, guests and stock, and one Pepper chat (a fridge
// reading said aloud, its card waiting to be confirmed), all through the API
// as the owner; starts the API with the tests' sign-in stand-in
// (api/test/support) and the admin on Vite with an Auth0 stand-in (both on
// ports of their own, API_PORT and ADMIN_PORT); takes each screen in Chrome
// at 360 x 640 CSS px with deviceScaleFactor 3 (1080 x 1920); draws the
// feature graphic from feature-graphic.html; then stops what it started.
// Nothing here is a secret: the sign-in is the tests' own stand-in, and no
// model is called (Pepper's chat runs its real tools against the API tests'
// stand-in for the model, which says the words written here; the API itself
// gets a dummy Anthropic key, so Pepper's bar shows).
//
// Options: PLAYWRIGHT_DIR (a folder whose node_modules has playwright; the
// global npm folder is tried too), CHROME (a Chrome to use instead of
// Playwright's own), API_PORT (3091), ADMIN_PORT (5291), KEEP=1 (leave the
// API and the admin running afterwards, to look around).
//
// The script runs itself again for the seeding part (`seed`), under the API
// tests' loader, which swaps the Auth0 check for the tests' stand-in.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const API_DIR = path.join(ROOT, 'api')
const ADMIN_DIR = path.join(ROOT, 'admin')
const SHOTS = path.join(HERE, 'screenshots')
const API_PORT = Number(process.env.API_PORT || 3091)
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 5291)
const TZ = 'Europe/London'

// ── Dates and times at the venues ────────────────────────────────────────────
const localNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) % 24 * 60 + Number(p.minute) }
}
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay()
const mondayOf = date => addDays(date, -((weekday(date) + 6) % 7))
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')

// ── The demo group ───────────────────────────────────────────────────────────
// Every name is invented: first names and an initial, no real business.
const GROUP = 'Harbour & Co'
const OWNER_NAME = 'Maya R.'
// The staff and their usual week, Monday to Sunday: L lunch, E evening, - a
// day off. Two days off each, mostly early in the week, so Friday and
// Saturday have the most on and every service has a chef.
const STAFF = [
  ['Jonah P.', 'Head chef', '--EEEEE'], ['Marta S.', 'Sous chef', '--LLEEL'],
  ['Aisha K.', 'Chef', 'EE-EEE-'], ['Tomas V.', 'Chef', 'LL--LLL'],
  ['Leah M.', 'Front of house', '--EEEEE'], ['Ravi D.', 'Front of house', 'EE--EEE'], ['Nora B.', 'Front of house', 'LLLL-L-'],
  ['Felix H.', 'Bar', '--EEEEE'], ['Iris C.', 'Bar', 'EE--LLL'],
]
const KITCHEN = new Set(['Head chef', 'Sous chef', 'Chef'])
const SHIFT_OF = { L: 'Lunch', E: 'Evening' }
// Guests tonight: [minutes past 12:00, covers, name, table, note].
const GUESTS = [
  [30, 2, 'Elena M.', 'T2', null], [60, 4, 'Sam O.', 'T5', 'High chair needed'], [90, 2, 'Grace L.', 'T3', null],
  [300, 2, 'Owen T.', 'T1', 'Window table if possible'], [360, 4, 'Hannah W.', 'T6', null],
  [375, 2, 'Daniel F.', 'T2', 'Shellfish allergy'], [390, 3, 'Chloe A.', 'T4', null],
  [420, 2, 'Marcus J.', 'T3', 'Anniversary'], [435, 8, 'Hugo S.', 'T9', 'Birthday, candle on dessert'],
  [450, 2, 'Lucy N.', 'T1', null], [465, 4, 'Ben K.', 'T7', null], [480, 2, 'Zara P.', 'T8', 'Gluten free'],
  [510, 6, 'Theo G.', 'T10', null], [525, 2, 'Mia C.', 'T5', null], [540, 2, 'Adam E.', 'T2', null],
]
const FRIDGES = [
  ['Walk-in fridge', 'fridge', 0, 5], ['Prep fridge', 'fridge', 0, 5], ['Bar fridge', 'fridge', 1, 8], ['Freezer', 'freezer', -22, -18],
]
// Stock: [name, base unit, storage, [unit, base qty], area].
const STOCK = [
  ['Cod loins', 'g', 'chilled', ['box', 5000], 'Walk-in fridge'],
  ['King prawns', 'g', 'chilled', ['bag', 1000], 'Walk-in fridge'],
  ['Mussels', 'g', 'chilled', ['net', 2000], 'Walk-in fridge'],
  ['Unsalted butter', 'g', 'chilled', ['block', 250], 'Walk-in fridge'],
  ['Double cream', 'ml', 'chilled', ['tub', 1000], 'Walk-in fridge'],
  ['Lemons', 'each', 'chilled', ['case', 80], 'Walk-in fridge'],
  ['Plain flour', 'g', 'ambient', ['sack', 16000], 'Dry store'],
  ['Rapeseed oil', 'ml', 'ambient', ['drum', 20000], 'Dry store'],
  ['Panko crumbs', 'g', 'ambient', ['bag', 2000], 'Dry store'],
  ['Skin-on chips', 'g', 'frozen', ['bag', 2500], 'Freezer'],
  ['Vanilla ice cream', 'ml', 'frozen', ['tub', 4000], 'Freezer'],
]
// What has been counted so far in the walk-in: [item, entries].
const COUNTED = [
  ['Cod loins', [{ qty: 2, unit: 'box' }, { qty: 1800, unit: 'g' }]],
  ['King prawns', [{ qty: 3, unit: 'bag' }]],
  ['Mussels', [{ qty: 4, unit: 'net' }]],
]
const WEATHER = [ // [weather code, min, max, rain mm, wind kph, title]
  [3, 6, 10, 0.2, 18, 'Overcast'], [61, 5, 9, 4.1, 24, 'Light rain'], [2, 4, 9, 0, 14, 'Partly cloudy'],
  [1, 3, 8, 0, 10, 'Mostly clear'], [63, 6, 11, 7.5, 32, 'Rain, windy'], [3, 5, 10, 0.4, 20, 'Overcast'], [0, 2, 7, 0, 8, 'Clear'],
]

async function seed() {
  const support = p => pathToFileURL(path.join(API_DIR, 'test/support', p)).href
  // Pepper's model is the API tests' stand-in (support/fake-claude.mjs): the
  // chat below runs Pepper's real tools on the demo data, and only Pepper's
  // words are written here. It starts before the app is imported, which
  // reads its address from the environment.
  const { startFakeClaude } = await import(support('fake-claude.mjs'))
  const claude = await startFakeClaude()
  const { as, ok, sql, closeApp } = await import(support('app.mjs'))
  const { resetAndSeed, A } = await import(support('seed.mjs'))
  const ids = await resetAndSeed()
  const T = ids.a
  const o = as(A.owner, T)
  const post = (url, body) => ok(o.post(url, body), 'POST ' + url)
  const put = (url, body) => ok(o.put(url, body), 'PUT ' + url)
  const patch = (url, body) => ok(o.patch(url, body), 'PATCH ' + url)
  const { date: today, mins: now } = localNow()
  const monday = mondayOf(today)

  // The group and its owner, as the phone pages show them.
  await sql`UPDATE tenants SET name = ${GROUP}, slug = 'harbour-co' WHERE id = ${T}`
  await sql`UPDATE users SET full_name = ${OWNER_NAME}, email = 'maya@harbourandco.example' WHERE tenant_id = ${T} AND auth0_user_id = ${A.owner}`
  await sql`DELETE FROM venues WHERE tenant_id = ${T}`
  const V = (await post('/api/venues', { name: 'Quayside', slug: 'quayside', timezone: TZ, currency: 'GBP' })).id
  const V2 = (await post('/api/venues', { name: 'West Pier', slug: 'west-pier', timezone: TZ, currency: 'GBP' })).id
  await patch('/api/ai/settings', { staff_enabled: true })

  // ── Bookings: tables, the schedule, rules, tonight's guests ──
  for (const venue of [V, V2]) {
    const sec = await post(`/api/venues/${venue}/sections`, { name: 'Restaurant' })
    const tables = {}
    for (let n = 1; n <= 10; n++) {
      tables['T' + n] = (await post(`/api/venues/${venue}/tables`, { label: 'T' + n, min_covers: 1, max_covers: n >= 9 ? 8 : n >= 4 ? 4 : 2, section_id: sec.id })).id
    }
    const S = `/api/venues/${venue}/schedule`
    for (let dow = 0; dow < 7; dow++) {
      await put(`${S}/template/${dow}`, { is_open: true, slot_interval_mins: 15 })
      await post(`${S}/template/${dow}/sittings`, { opens_at: '12:00', closes_at: '22:00', name: 'All day', default_max_covers: 60 })
    }
    await post(`/api/venues/${venue}/rules`, {
      slot_duration_mins: 90, buffer_after_mins: 0, min_covers: 1, max_covers: 10, book_from_days: 0, book_until_days: 60,
      cutoff_before_mins: 0, hold_ttl_secs: 300, allow_cross_section_combo: false, allow_non_adjacent_combo: false,
      allow_widget_bookings_after_doors_close: false, enable_unconfirmed_flow: false, enable_reconfirmed_status: false, enable_arrived_status: true,
    }).catch(() => patch(`/api/venues/${venue}/rules`, { enable_arrived_status: true }))
    const guests = venue === V ? GUESTS : GUESTS.filter((_, i) => i % 3 === 0)
    for (const [i, [at, covers, name, table, note]] of guests.entries()) {
      const start = 12 * 60 + at
      const status = start + 90 < now ? 'checked_out' : start <= now ? 'seated' : start - 20 <= now ? 'arrived' : 'confirmed'
      await post('/api/bookings/admin-override', {
        venue_id: venue, starts_at: `${today}T${hhmm(start)}:00`, covers, table_ids: [tables[table]], status,
        guest_name: name, guest_email: `guest${i + 1}@example.com`, guest_phone: '07700 900' + String(100 + i), guest_notes: note,
        displace_conflicts: true,
      })
    }
  }
  // The harness has no email provider, so the guests' emails would fail and
  // show on Today: their confirmations are dropped from the queue (below) and
  // their reminders count as sent.
  await sql`UPDATE bookings SET reminder_sent_at = now() WHERE tenant_id = ${T}`

  // ── The rota: this week, everyone on their usual shift ──
  await patch('/api/rota/settings', { mode: 'day_parts' })
  const shifts = {}
  for (const [name, start_time, end_time] of [['Lunch', '11:00', '16:00'], ['Evening', '16:30', '23:00']]) {
    shifts[name] = (await post('/api/rota/shifts', { name, start_time, end_time, points: 1 })).id
  }
  const roles = {}
  for (const name of new Set(STAFF.map(s => s[1]))) roles[name] = (await post('/api/rota/roles', { name, points_multiplier: 1 })).id
  const people = []
  for (const [name, role, week] of STAFF) {
    const rate = role === 'Head chef' ? 17.5 : role === 'Sous chef' ? 15.2 : 12.6
    people.push({ ...(await post(`/api/rota/venues/${V}/staff`, { name, role_id: roles[role], pay_type: 'hourly', default_rate: rate })), name, role, week })
  }
  // This week and next (an empty next week is a late task on Today).
  for (const week of [monday, addDays(monday, 7)]) {
    const entries = []
    for (const person of people) {
      for (let d = 0; d < 7; d++) {
        const shift = SHIFT_OF[person.week[d]]
        if (shift) entries.push({ staff_id: person.id, work_date: addDays(week, d), shift_id: shifts[shift] })
      }
    }
    await put(`/api/rota/venues/${V}/weeks/${week}/entries`, { entries })
  }
  // Who is in the kitchen today: the checks and the count are theirs.
  const todayAt = (weekday(today) + 6) % 7
  const cooks = people.filter(p => KITCHEN.has(p.role) && p.week[todayAt] !== '-')
  const onNow = cooks.find(p => p.week[todayAt] === (now < 16 * 60 + 15 ? 'L' : 'E')) || cooks[0]
  const counter = cooks.find(p => p !== onNow) || onNow

  // ── Cash Recon: the last week's days cashed up and submitted ──
  const C = `/api/venues/${V}/cash-recon`
  const till = await post(C + '/config/income-sources', { name: 'Till', type: 'pos', vat_rate: 20, vat_inclusive: true })
  const card = await post(C + '/config/payment-channels', { name: 'Card', type: 'card' })
  const cash = await post(C + '/config/payment-channels', { name: 'Cash', type: 'cash' })
  for (let i = 7; i >= 1; i--) {
    const day = addDays(today, -i)
    const gross = 2400 + ((i * 337) % 900)
    const net = Math.round(gross / 1.2 * 100) / 100
    await put(`${C}/daily/${day}`, {
      income: [{ source_id: till.id, gross_amount: gross, vat_amount: Math.round((gross - net) * 100) / 100, net_amount: net }],
      takings: [{ channel_id: card.id, amount: Math.round(gross * 0.86) }, { channel_id: cash.id, amount: gross - Math.round(gross * 0.86) }],
    })
    await post(`${C}/daily/${day}/submit`, {})
  }

  // ── Food safety: fridges, the opening check done, the evening one due now ──
  const units = []
  for (const [name, equipment_type, min_temp_c, max_temp_c] of FRIDGES) {
    units.push(await post('/api/food-safety/equipment', { venue_id: V, name, equipment_type, min_temp_c, max_temp_c }))
  }
  // One check time, due in a few minutes (one column in the phone's sheet), half logged.
  const due = Math.min(23 * 60 + 45, Math.ceil((now + 10) / 15) * 15)
  const evening = await post('/api/food-safety/capture-times', { venue_id: V, label: 'Evening', time_of_day: hhmm(due) })
  for (const [i, temperature_c] of [3.4, 2.9].entries()) {
    await post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: units[i].id, capture_time_id: evening.id, log_date: today, temperature_c, recorded_by: onNow.name })
  }
  const closing = await post('/api/checklists/templates', { venue_id: V, name: 'Closing checks', department: 'Kitchen', frequency: 'daily' })
  for (const label of ['Fryers off and covered', 'Probe wipes restocked', 'Walk-in door shut and sealed', 'Floors mopped', 'Bins out', 'Back door locked']) {
    await post(`/api/checklists/templates/${closing.id}/items`, { label })
  }
  // The late task: a repair two days overdue on the H&S action log.
  const repairs = await post('/api/hs-action-log/categories', { name: 'Repairs' })
  await post('/api/hs-action-log/entries', { venue_id: V, category_id: repairs.id, task: 'Replace the walk-in door seal', priority: 'high', due_date: addDays(today, -2) })

  // ── Stock: items in their areas, today the count day, the count started ──
  const areas = {}
  for (const name of ['Walk-in fridge', 'Dry store', 'Freezer']) areas[name] = (await post(`/api/stock/venues/${V}/areas`, { name })).id
  const items = {}
  for (const [name, base_unit, storage, [unit, base_qty]] of STOCK) {
    const item = await post('/api/inventory/items', { name, base_unit, storage })
    await post(`/api/inventory/items/${item.id}/units`, { name: unit, base_qty })
    items[name] = item.id
  }
  for (const [area, id] of Object.entries(areas)) {
    await put(`/api/stock/areas/${id}/items`, { item_ids: STOCK.filter(s => s[4] === area).map(s => items[s[0]]) })
  }
  await put('/api/stock/settings', { second_person_approves: false, blind_count: false, refunds_return_stock: false })
  await put(`/api/stock/venues/${V}/settings`, { count_weekday: weekday(today), count_kind: 'full', key_list_id: null, par_mode: null })
  const count = await post(`/api/stock/venues/${V}/counts`, { kind: 'full', note: 'Weekly count' })
  for (const [name, list] of COUNTED) {
    await put(`/api/stock/counts/${count.id}/lines`, { item_id: items[name], area_id: areas['Walk-in fridge'], entries: list })
  }
  // Who started it and who is counting, by name (the tests' sign-in gives only the email).
  await sql`UPDATE stock_counts SET started_by = ${OWNER_NAME}, counted_by = ${OWNER_NAME} WHERE id = ${count.id}`
  await sql`UPDATE stock_count_lines SET counted_by = ${counter.name} WHERE count_id = ${count.id}`

  // ── The week ahead: a forecast (a weather capture's findings) and a local event ──
  const src = await post(`/api/local-info/venues/${V}/sources`, { kind: 'weather', place: 'Quayside', enabled: false })
  for (const [i, [code, lo, hi, rain, wind, title]] of WEATHER.entries()) {
    const day = addDays(today, i)
    await sql`INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key, data)
              VALUES (${T}, ${V}, ${src.source.id}, 'weather', ${title}, ${day}, 'info', ${'weather:' + day},
                      ${sql.json({ weather_code: code, temp_min: lo, temp_max: hi, precip_mm: rain, wind_kph: wind })})`
  }
  await post('/api/local-info/items', { venue_id: V, title: 'Winter market on the quay', starts_on: addDays(today, 3), severity: 'notice' })

  // ── Pepper: a reading said aloud, and its card waiting to be confirmed ──
  // (One exchange: the card fills most of a phone's chat, and the screenshot
  // shows the whole of it.)
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'toolu_demo_temp', name: 'log_temperature', input: { venue_id: V, fridge: 'Bar fridge', temperature_c: 4.2 } },
    ] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here it is for the evening check. Confirm and I\'ll log it.' }] }),
  )
  const chat = await post('/api/ai/chat', { message: 'The bar fridge is reading 4.2', voice: true })
  const shown = chat.items.map(i => i.type).join(' ')
  if (!/action/.test(shown) || chat.items.some(i => i.type === 'action' && i.status !== 'pending')) {
    throw new Error('Pepper\'s chat did not end on a card waiting to be confirmed: ' + shown)
  }
  await claude.close()

  const { queue: emails } = await import(pathToFileURL(path.join(API_DIR, 'src/jobs/notifications.js')).href)
  await emails.obliterate({ force: true })
  await emails.close()

  console.log(JSON.stringify({ venue: V, venue2: V2, count: count.id, chat: chat.conversation_id, today }))
  await closeApp()
}

// ── The harness: the API with the tests' sign-in, the admin with an Auth0 stand-in ──
const AUTH0_STAND_IN = `// Made by make-assets.mjs: @auth0/auth0-react stood in, signed in as the
// demo group's owner (the API's test sign-in takes "test:<sub>").
import { createContext, createElement, useContext } from 'react'
const sub = 'a-owner'
const value = {
  isAuthenticated: true, isLoading: false, error: null,
  user: { sub, email: 'maya@harbourandco.example', name: '${OWNER_NAME}' },
  getAccessTokenSilently: async () => 'test:' + sub,
  getIdTokenClaims: async () => ({ sub }),
  loginWithRedirect: async () => {}, logout: () => {},
}
export const Auth0Context = createContext(value)
export function Auth0Provider({ children }) { return createElement(Auth0Context.Provider, { value }, children) }
export const useAuth0 = () => useContext(Auth0Context)
export const withAuthenticationRequired = c => c
`

function viteConfig(standIn) {
  const api = `http://localhost:${API_PORT}`
  return `import { mergeConfig } from 'vite'
import base from ${JSON.stringify(path.join(ADMIN_DIR, 'vite.config.js'))}
const merged = mergeConfig(base, {
  resolve: { alias: { '@auth0/auth0-react': ${JSON.stringify(standIn)} } },
  server: { fs: { strict: false } },
})
merged.server.proxy = { '/api': '${api}', '/uploads': '${api}' }
export default merged
`
}

const procs = []
function start(name, cmd, args, opts) {
  const log = fs.openSync(path.join(opts.logDir, name + '.log'), 'w')
  const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', log, log], detached: true })
  procs.push(p)
  return p
}
function stopAll() {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM') } catch { /* gone */ } }
}
async function waitFor(url, what, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(url)).status < 500) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(what + ' did not start (' + url + ')')
}

function loadPlaywright() {
  const places = [process.env.PLAYWRIGHT_DIR, ROOT, ADMIN_DIR].filter(Boolean)
  // The global npm folder (npm install -g playwright).
  try { places.push(path.join(execSync('npm root -g').toString().trim(), '..')) } catch { /* no npm */ }
  for (const dir of places) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright') } catch { /* next */ }
  }
  throw new Error('Playwright was not found: set PLAYWRIGHT_DIR to a folder whose node_modules has it')
}

// ── The screens ──────────────────────────────────────────────────────────────
// Each: the file, the address, and what to do before the picture.
const SCREENS = [
  { file: '01-hub.png', path: '/mobile', ready: '[data-testid="mobile-tile-today"] [data-testid="mobile-tile-badge"]' },
  { file: '02-pepper.png', path: '/mobile/assistant', ready: '[data-testid="chat-answer"]', settle: 2500 },
  { file: '03-today.png', path: '/mobile/today', ready: '[data-testid="today-task"]', scrollTo: '[data-testid="today-tasks"]' },
  {
    file: '04-fridge-check.png', path: '/mobile/today', ready: '[data-testid="today-task"][data-kind="fridge_check"]',
    before: async p => {
      await p.locator('[data-testid="today-task"][data-kind="fridge_check"] [data-testid="today-task-action"]').click()
      await p.waitForSelector('[data-testid="today-form"]')
      // The sheet is drawn inside Today's spaced list (space-y-3), whose gap
      // gives its fixed backdrop a 12 px top margin: a white band above the
      // dimmed page. That is a bug of the page, not its look, so the picture
      // is taken without it.
      await p.addStyleTag({ content: '[data-testid="today-form"] { margin: 0 !important; }' })
      // Today from its top behind the sheet (the click scrolled it to the task).
      await p.evaluate(() => { const main = document.querySelector('main'); if (main) main.scrollTop = 0 })
      await p.waitForTimeout(2000)
    },
  },
  { file: '05-stock-count.png', path: '/mobile/stock-count', ready: '[data-testid="stock-count-line"]', settle: 2500, scrollTo: '[data-testid="stock-count-areas"]' },
  { file: '06-guest-list.png', path: '/mobile/guest-list', ready: 'main', settle: 2500 },
  { file: '07-rota.png', path: '/mobile/rota', ready: 'main', settle: 2500 },
]

async function shoot(seeded) {
  const { chromium } = loadPlaywright()
  fs.mkdirSync(SHOTS, { recursive: true })
  // Screenshots no longer in the list go, so the folder holds exactly these.
  for (const f of fs.readdirSync(SHOTS)) {
    if (f.endsWith('.png') && !SCREENS.some(s => s.file === f)) fs.rmSync(path.join(SHOTS, f))
  }
  const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
  const base = `http://localhost:${ADMIN_PORT}`
  let ip = 20
  const problems = []
  async function page() {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: TZ })
    // A new address per page load keeps the API's rate limit out of the way (infra.md).
    await ctx.route('**/api/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '10.0.7.' + (ip++ % 250) } }))
    // The venue Today opens on, and the chat Pepper's page opens (the one the seed had).
    await ctx.addInitScript(([v, c]) => {
      try { localStorage.setItem('maca_today_venue', v); localStorage.setItem('maca_ai_conversation', c) } catch { /* none */ }
    }, [seeded.venue, seeded.chat])
    const p = await ctx.newPage()
    p.on('pageerror', e => problems.push('page error: ' + e.message))
    p.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) problems.push(r.status() + ' ' + r.url().replace(base, '')) })
    return p
  }
  for (const s of SCREENS) {
    const p = await page()
    await p.goto(base + s.path)
    await p.waitForSelector(s.ready, { timeout: 60000 })
    await p.waitForTimeout(s.settle || 1500)
    if (s.before) await s.before(p)
    if (s.scrollTo) {
      await p.evaluate(sel => {
        const el = document.querySelector(sel)
        const main = document.querySelector('main')
        if (el && main) main.scrollTop = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 12
      }, s.scrollTo)
      await p.waitForTimeout(500)
    }
    await p.screenshot({ path: path.join(SHOTS, s.file) })
    console.log('took', s.file)
    await p.context().close()
  }

  // The feature graphic: feature-graphic.html, with the icon and two of the screens just taken.
  const fg = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })
  await fg.goto(pathToFileURL(path.join(HERE, 'feature-graphic.html')).href)
  await fg.waitForLoadState('networkidle')
  await fg.evaluate(() => document.fonts.ready)
  await fg.screenshot({ path: path.join(HERE, 'feature-graphic-1024x500.png') })
  console.log('took feature-graphic-1024x500.png')
  await browser.close()
  if (problems.length) console.log('Problems seen while taking them:\n  ' + problems.join('\n  '))
}

async function main() {
  const db = process.env.DATABASE_URL || ''
  if (!/test/i.test(new URL(db || 'postgres://x/none').pathname)) {
    throw new Error('DATABASE_URL must name a test database (eval "$(scripts/test-env.sh playassets)"): this empties it')
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'office-store-assets-'))
  const env = { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn', ANTHROPIC_API_KEY: 'not-a-real-key', PUBLIC_ROOT_DOMAIN: 'localhost' }
  process.on('exit', () => {
    if (process.env.KEEP) return
    stopAll()
    fs.rmSync(work, { recursive: true, force: true })
  })
  process.on('SIGINT', () => process.exit(130))

  // Seed, under the tests' loader.
  const out = execSync(`node --import ./test/support/register.mjs ${JSON.stringify(fileURLToPath(import.meta.url))} seed`, { cwd: API_DIR, env, encoding: 'utf8' })
  const seeded = JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).at(-1))
  console.log('seeded', seeded)

  start('api', process.execPath, ['--import', './test/support/register.mjs', 'src/server.js'], { cwd: API_DIR, env, logDir: work })
  const standIn = path.join(work, 'auth0-stand-in.jsx')
  fs.writeFileSync(standIn, AUTH0_STAND_IN)
  const config = path.join(work, 'vite.store.config.mjs')
  fs.writeFileSync(config, viteConfig(standIn))
  fs.symlinkSync(path.join(ADMIN_DIR, 'node_modules'), path.join(work, 'node_modules'))
  start('admin', path.join(ADMIN_DIR, 'node_modules/.bin/vite'), ['--config', config, '--port', String(ADMIN_PORT), '--strictPort'], { cwd: ADMIN_DIR, env: process.env, logDir: work })
  await waitFor(`http://localhost:${API_PORT}/api/health`, 'The API')
  await waitFor(`http://localhost:${ADMIN_PORT}/`, 'The admin')
  await shoot(seeded)
  if (process.env.KEEP) {
    console.log(`Left running: the admin on http://localhost:${ADMIN_PORT}/mobile (logs in ${work});`
      + ` stop them with: kill -- ${procs.map(p => '-' + p.pid).join(' ')}`)
  }
}

// Both parts leave connections or children open: exit when done (the exit
// handler stops the API and the admin, unless KEEP).
if (process.argv[2] === 'seed') await seed().then(() => process.exit(0), e => { console.error(e.stack || e.message); process.exit(1) })
else await main().then(() => process.exit(0), e => { console.error(e.message); process.exit(1) })
