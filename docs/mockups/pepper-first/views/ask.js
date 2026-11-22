// The ask bar: one input that finds a page or a saved report from a list held
// in the browser (no model call) and hands the words to Pepper on Enter.
// Pepper answers with four card types and no others (nav, form, data,
// action), scripted here for the suggested asks. Source: reports/AI first
// back office strategy.md, "The ask bar: search first, Pepper on Enter" and
// the target flows (rota at another venue, mark a dish sold out, ask for a
// figure).
App.view('ask', {
  label: 'Ask bar',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, el } = App
    const D = App.data
    const venues = D.venues
    const HOME = venues[0] // the signed-in person's own venue in the story (Ware)
    const HOST = 'office.macaroonie.com'
    const dish = (D.dishes.find(d => d.id === 'seabass') || { name: 'Steamed Sea Bass' }).name
    const dairy = (D.suppliers.find(s => s.id === 'harlow') || { name: 'Harlow Dairy' }).name
    const others = venues.slice(1).map(v => v.name).join(' and ')
    const gbp = p => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    // ── The days and weeks a page can open at ──────────────────
    // Fixed around the story's today, Sunday 22 November 2026 (App.data.today).
    const PERIODS = {
      yesterday: { label: 'Yesterday', short: 'Sat 21 Nov', kind: 'day', value: '2026-11-21', long: 'Saturday 21 November', pill: 'Saturday 21 November', week: 'this-week' },
      today: { label: 'Today', short: 'Sun 22 Nov', kind: 'day', value: '2026-11-22', long: 'Sunday 22 November', pill: 'Sunday 22 November', week: 'this-week' },
      tomorrow: { label: 'Tomorrow', short: 'Mon 23 Nov', kind: 'day', value: '2026-11-23', long: 'Monday 23 November', pill: 'Monday 23 November', week: 'next-week' },
      'this-week': { label: 'This week', short: 'from Mon 16 Nov', kind: 'week', value: '2026-11-16', long: 'the week of Monday 16 November', pill: 'Week of Monday 16 November' },
      'next-week': { label: 'Next week', short: 'from Mon 23 Nov', kind: 'week', value: '2026-11-23', long: 'the week of Monday 23 November', pill: 'Week of Monday 23 November' },
    }
    const DAYS = ['today', 'tomorrow'], PAST = ['yesterday', 'today'], WEEKS = ['this-week', 'next-week']

    // ── The local index: 25 pages and three saved reports ──────
    // venue / periods / tabs say what context a page takes. noAddr marks the
    // pages the report names as reading nothing from their address today.
    const page = (id, label, ico, desc, words, o) => Object.assign({ kind: 'page', id, label, ico, desc, words, path: '/' + id, venue: false, periods: null, def: null, tabs: null, weekTabs: null, noAddr: false }, o || {})
    const report = (id, label, desc, words) => ({ kind: 'report', id, label, ico: 'chart', desc, words, path: '/reports/' + id, venue: false, periods: null, def: null, tabs: null, weekTabs: null, noAddr: false })
    const ITEMS = [
      page('home', 'Home', 'home', 'Today\'s tasks, your pins and the ask bar', ['start', 'today', 'tasks', 'overview', 'dashboard'], { path: '/' }),
      page('timeline', 'Timeline', 'calendar', 'A day\'s bookings laid out across the tables', ['floor', 'service', 'diary', 'seating', 'walk in'], { venue: true, periods: DAYS, noAddr: true }),
      page('bookings', 'Bookings', 'calendar', 'Every booking for a day, with status and notes', ['reservations', 'covers', 'guests', 'no show', 'deposit'], { venue: true, periods: DAYS }),
      page('customers', 'Customers', 'users', 'Guest records, visits and marketing consent', ['guests', 'contacts', 'marketing', 'newsletter'], {}),
      page('rota', 'Rota', 'users', 'Shifts and cover for a week', ['shifts', 'who is working', 'cover', 'roster', 'holiday', 'time off'], { venue: true, periods: WEEKS, noAddr: true }),
      page('cash-recon', 'Cash recon', 'cash', 'Cash-up for a day, the week\'s variance, expenses, and wages filled from the rota', ['cash-up', 'cash up', 'cashing up', 'banking', 'expenses', 'variance', 'float', 'takings'],
        { venue: true, periods: PAST, def: 'today', tabs: [['day', 'Day'], ['week', 'Week'], ['wages', 'Wages']], weekTabs: ['week', 'wages'], noAddr: true }),
      page('food-safety', 'Food safety', 'thermometer', 'Fridge, cooking and delivery checks for a day', ['fridge', 'temperature', 'temps', 'haccp', 'probe', 'hygiene'],
        { venue: true, periods: PAST, def: 'today', tabs: [['fridges', 'Fridges'], ['cooking', 'Cooking'], ['deliveries', 'Deliveries']], noAddr: true }),
      page('checklists', 'Checklists', 'check', 'Opening, closing and cleaning lists for a day', ['opening', 'closing', 'cleaning', 'tick'], { venue: true, periods: DAYS, noAddr: true }),
      page('purchasing', 'Purchasing', 'truck', 'Supplier orders, deliveries and invoices', ['suppliers', 'order', 'stock', 'inventory', 'invoice'], { venue: true, tabs: [['orders', 'Orders'], ['deliveries', 'Deliveries'], ['invoices', 'Invoices']] }),
      page('menus', 'Menus', 'utensils', 'Dishes, prices, allergens and publishing', ['dishes', 'prices', 'allergens', 'food', 'publish'], {}),
      page('till-reports', 'Till reports', 'chart', 'A day\'s takings by tender, with the X and Z figures', ['sales', 'takings', 'x report', 'z report', 'tender'], { venue: true, periods: PAST, def: 'today' }),
      page('online-orders', 'Online orders', 'box', 'Collection orders for a day and where each one is', ['collection', 'takeaway', 'web orders', 'click and collect'], { venue: true, periods: DAYS }),
      page('loyalty', 'Loyalty', 'star', 'Members, rewards and stamp cards', ['points', 'stamps', 'wallet'], { tabs: [['members', 'Members'], ['rewards', 'Rewards'], ['stamp-cards', 'Stamp cards']] }),
      page('reports', 'Reports', 'chart', 'Saved reports and the report builder', ['figures', 'numbers', 'analysis', 'export', 'data'], {}),
      page('sold-out', 'Sold out', 'tag', 'Dishes off sale on the till, online and on the menu screens', ['86', 'out of stock', 'unavailable', 'run out', 'off sale'], { venue: true }),
      page('staff', 'Staff', 'users', 'The people you can put on the rota, their pay and time off', ['employees', 'team members', 'pay', 'contracts', 'starters', 'leavers'], { venue: true, noAddr: true }),
      page('tables', 'Tables', 'list', 'Tables, seats and the tables that can be joined', ['floor plan', 'seats', 'combinations', 'layout'], { venue: true }),
      page('schedule', 'Schedule', 'clock', 'Opening times, sittings and closed dates for bookings', ['opening times', 'hours', 'slots', 'closures', 'sittings'], { venue: true, noAddr: true }),
      page('kitchen-screens', 'Kitchen screens', 'eye', 'The screens in the kitchen, their stations and ticket times', ['kds', 'tickets', 'stations', 'pass', 'chef'], { venue: true }),
      page('till-layouts', 'Till layouts', 'edit', 'The buttons on the till and how they are grouped', ['buttons', 'tiles', 'grid'], {}),
      page('website', 'Website', 'link', 'Pages, theme and publishing for your website', ['site', 'domain', 'publish', 'brand'], {}),
      page('reviews', 'Reviews', 'star', 'Guest reviews and your replies', ['ratings', 'feedback', 'stars', 'replies'], { venue: true }),
      page('team', 'Team', 'shield', 'Who can sign in and what each person can do', ['users', 'logins', 'invite', 'access', 'permissions', 'roles'], {}),
      page('settings', 'Settings', 'lock', 'Your group\'s details, tax rates and payments', ['account', 'vat', 'tax rates', 'payments', 'preferences'], {}),
      page('review', 'For review', 'list', 'Drafts waiting for you and the changes Pepper made', ['approve', 'drafts', 'audit', 'undo'], { tabs: [['waiting', 'Waiting'], ['done', 'Done by Pepper']] }),
      report('sales-by-day', 'Sales by day', 'Net sales for each day at a venue', ['net sales', 'daily sales', 'revenue']),
      report('ticket-times', 'Ticket times by station', 'How long kitchen tickets took at each station', ['kitchen', 'speed', 'wait']),
      report('cash-variance', 'Cash variance by week', 'Counted cash against expected cash, week by week', ['over', 'short', 'cash-up', 'difference']),
    ]
    ITEMS.forEach((it, n) => { it.n = n; it.keys = it.words.concat((it.tabs || []).map(t => t[1].toLowerCase())) })
    const byId = id => ITEMS.find(it => it.id === id)

    // ── Search: words in, ranked pages out. No model anywhere. ──
    const STOP = new Set('a an the of at to for is are was what whats how did do does my me open show go take add on in with and i we it can you please need want'.split(' '))
    /** The words someone typed: the venue and the day or week they name, and what is left to match pages with. */
    function parse(text) {
      const clean = String(text || '').toLowerCase().replace(/[\u2018\u2019']s\b/g, '').replace(/[^a-z0-9.\- ]+/g, ' ')
      const words = s => s.split(/\s+/).map(w => w.replace(/^[.\-]+|[.\-]+$/g, '')).filter(Boolean)
      const ctx = { venue: null, period: null }
      let rest = clean
      ;[['next week', 'next-week'], ['this week', 'this-week'], ['tomorrow', 'tomorrow'], ['yesterday', 'yesterday'], ['today', 'today'], ['tonight', 'today']].forEach(p => {
        const re = new RegExp('\\b' + p[0] + '\\b')
        if (!ctx.period && re.test(rest)) { ctx.period = p[1]; rest = rest.replace(re, ' ') }
      })
      let tokens = words(rest).filter(w => {
        const v = venues.find(x => x.name.toLowerCase() === w)
        if (v && !ctx.venue) ctx.venue = v.id
        return !v
      })
      if (!tokens.length) tokens = words(clean) // only a venue or a day was typed: match on those words
      const kept = tokens.length > 1 ? tokens.filter(w => !STOP.has(w)) : tokens
      const use = kept.length ? kept : tokens
      return { ctx, tokens: use, phrase: use.join(' '), raw: ' ' + words(rest).join(' ') + ' ' }
    }
    /** Label match first, then search words, then the description. */
    function score(it, q) {
      const label = it.label.toLowerCase(), ph = q.phrase
      if (!ph) return 0
      if (label === ph) return 100
      if (label.startsWith(ph)) return 90
      if (label.split(' ').some(w => w.startsWith(ph))) return 85
      if (ph.length >= 3 && label.includes(ph)) return 80
      if (it.keys.includes(ph)) return 70
      if (it.keys.some(k => k.startsWith(ph) || k.split(' ').some(w => w.startsWith(ph)))) return 60
      if (ph.length >= 3 && it.keys.some(k => k.includes(ph))) return 50
      if (ph.length >= 3 && it.desc.toLowerCase().includes(ph)) return 30
      let s = 0 // a sentence: count each word where it lands
      q.tokens.forEach(t => {
        if (t.length < 2) return
        const hit = w => (t.length < 4 ? w === t : w.startsWith(t))
        if (label.split(' ').some(hit)) s += 12
        else if (it.keys.some(k => k.split(' ').some(hit))) s += 8
      })
      return s
    }
    /** The chips the words already chose for this page (a venue, a day or week, a tab). */
    function prePick(it, q) {
      const pick = { venue: null, period: null, tab: null }
      if (it.venue && q.ctx.venue) pick.venue = q.ctx.venue
      if (it.periods && q.ctx.period) {
        const p = q.ctx.period
        if (it.periods.includes(p)) pick.period = p
        else if (PERIODS[p].week && it.periods.includes(PERIODS[p].week)) pick.period = PERIODS[p].week
      }
      if (it.tabs) { const t = it.tabs.find(x => q.raw.includes(' ' + x[1].toLowerCase() + ' ')); if (t) pick.tab = t[0] }
      return pick
    }
    function find(text) {
      const q = parse(text)
      return ITEMS.map(it => ({ item: it, score: score(it, q), pick: prePick(it, q) }))
        .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.item.n - b.item.n).slice(0, 6)
    }

    // ── A page and its context: what opens, at which address ───
    const hasCtx = it => !!(it.venue || it.periods || it.tabs)
    const complete = (it, pick) => (!it.venue || !!pick.venue) && (!it.periods || !!pick.period) && (!it.tabs || !!pick.tab)
    function resolve(it, pick) {
      pick = pick || {}
      const v = it.venue ? (venues.find(x => x.id === pick.venue) || HOME) : null
      const tab = it.tabs ? (it.tabs.find(t => t[0] === pick.tab) || it.tabs[0]) : null
      let per = it.periods ? PERIODS[pick.period || it.def || it.periods[0]] : null
      if (per && per.kind === 'day' && tab && it.weekTabs && it.weekTabs.includes(tab[0])) per = PERIODS[per.week]
      const qs = []
      if (v) qs.push('venue=' + v.id)
      if (tab) qs.push('tab=' + tab[0])
      if (per) qs.push(per.kind + '=' + per.value)
      return { v, tab, per, addr: HOST + it.path + (qs.length ? '?' + qs.join('&') : '') }
    }
    const short = res => [res.v && res.v.name, res.per && res.per.label, res.tab && res.tab[1]].filter(Boolean).join(' · ')
    function where(res) {
      const a = []
      if (res.v) a.push('at ' + res.v.name)
      if (res.per) a.push((res.per.kind === 'day' ? 'on ' : 'for ') + res.per.long)
      if (res.tab) a.push('on the ' + res.tab[1] + ' tab')
      return a.join(', ')
    }

    // ── The suggested asks and what Pepper is scripted to answer ──
    const ASKS = [
      { text: 'rota', search: true },
      { text: 'How did Friday compare with the Friday before?', card: 'data' },
      { text: 'sold out of sea bass', card: 'action' },
      { text: 'add expense 42.50 milk Harlow Dairy', card: 'expense' },
      { text: 'do yesterday\'s cash-up', card: 'cashup' },
      { text: 'what is the VAT on gift cards?', card: 'vat' },
    ]
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\.+(\s|$)/g, ' ').trim()
    const SCRIPT = {}
    ASKS.forEach(a => { if (a.card) SCRIPT[norm(a.text)] = a.card })
    const TYPE = { nav: 'Nav card', form: 'Form card', data: 'Data card', action: 'Action card' }
    const FRI = { now: 486240, before: 441875 } // net sales at Ware, in pence
    const WEEK_ROWS = [['Friday 13 November', 441875, true], ['Saturday 14 November', 523610], ['Sunday 15 November', 312040], ['Monday 16 November', 189420],
      ['Tuesday 17 November', 204065], ['Wednesday 18 November', 231190], ['Thursday 19 November', 287635], ['Friday 20 November', 486240, true]]

    const CSS = `
      #view-ask { --ask-gap: 12px; }
      #view-ask #ask-pepper { scroll-margin-top: calc(var(--ask-top, 100px) + var(--ask-gap)); scroll-margin-bottom: 12px; }
      #view-ask #ask-last { white-space: normal; height: auto; min-height: 22px; padding-block: 2px; }
      #view-ask .ask-meter > .muted { flex: 1 1 260px; min-width: 0; }
      @media (min-width: 981px) {
        #view-ask { --ask-gap: 92px; }
        #view-ask .ask-meter { position: sticky; top: var(--ask-top, 100px); z-index: 40; background: var(--bg); padding: 8px 10px; margin: -8px -10px; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; align-items: center; }
        #view-ask .ask-meter > .muted { grid-column: 2; grid-row: 1; }
        #view-ask #ask-last { grid-column: 1 / -1; justify-self: start; }
      }
      #view-ask .ask-pane { display: grid; gap: 12px; align-content: start; min-width: 0; }
      #view-ask #ask-bar-pane { padding-bottom: 56px; }
      #view-ask .m-toast { width: max-content; }
      #view-ask .m-results :focus-visible { outline-offset: -3px; }
      #view-ask .ask-box { display: grid; gap: 6px; min-width: 0; }
      #view-ask .m-ask .m-iconbtn { width: 48px; height: 48px; }
      #view-ask .ask-row { padding: 0; gap: 0; align-items: stretch; }
      #view-ask .m-result.on { box-shadow: inset 3px 0 0 var(--m-primary); }
      #view-ask .m-result { touch-action: manipulation; }
      #view-ask .ask-pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 12px; min-height: 56px; border: 0; background: transparent; color: var(--m-ink); font-size: 14px; text-align: left; touch-action: manipulation; }
      #view-ask .ask-pick .what { flex: 1; min-width: 0; display: grid; }
      #view-ask .ask-sum { flex: none; align-self: center; margin-right: 8px; max-width: 45%; }
      #view-ask .ask-sum > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #view-ask .ask-ctx { display: grid; gap: 8px; padding: 2px 12px 12px 56px; min-width: 0; }
      #view-ask .ask-grp { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
      #view-ask .ask-grp > .m-label { flex: none; width: 46px; }
      #view-ask .ask-chip { min-height: 48px; padding: 6px 14px; white-space: normal; text-align: left; max-width: 100%; touch-action: manipulation; cursor: pointer; }
      #view-ask .ask-addr { font-family: var(--font-mono); font-size: 12px; color: var(--m-muted); overflow-wrap: anywhere; }
      #view-ask .ask-hint, #view-ask .ask-none { font-size: 12.5px; color: var(--m-muted); }
      #view-ask .ask-none { padding: 12px; }
      #view-ask .ask-sugg { display: grid; gap: 6px; min-width: 0; }
      #view-ask .ask-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
      #view-ask .m-head svg, #view-ask .m-cardlet > header svg { width: 16px; height: 16px; flex: none; color: var(--m-primary); }
      #view-ask .m-cardlet > header .t { flex: 1; min-width: 0; }
      #view-ask .m-cardlet > footer { align-items: center; }
      #view-ask .ask-types { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); }
      #view-ask .ask-type { border: 1px solid var(--m-line); border-radius: 8px; padding: 10px; display: grid; gap: 4px; align-content: start; font-size: 12.5px; color: var(--m-muted); min-width: 0; }
      #view-ask .ask-type b { color: var(--m-ink); font-size: 13px; display: flex; align-items: center; gap: 6px; }
      #view-ask .ask-type svg { width: 16px; height: 16px; flex: none; color: var(--m-primary); }
      #view-ask .ask-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 0; font-size: 13.5px; }
      #view-ask .ask-kv dt { color: var(--m-muted); }
      #view-ask .ask-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
      #view-ask .ask-done { display: flex; gap: 8px; align-items: flex-start; }
      #view-ask .ask-done svg { width: 18px; height: 18px; flex: none; margin-top: 1px; color: var(--m-good); }
      #view-ask .ask-fri td { background: var(--m-accent-soft); }
      @media (max-width: 560px) {
        #view-ask .ask-ctx { padding-left: 12px; }
        #view-ask .ask-sum > span { display: none; }
        #view-ask .ask-kv { grid-template-columns: minmax(0, 1fr); gap: 0; }
        #view-ask .ask-kv dd { margin-bottom: 6px; }
      }`

    const out = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>'
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>The ask bar: search first, Pepper on Enter</h1>
        <p class="lede">One input, on Home and over every other page. Typing finds a page or a saved report from a list held in the browser, before any model is called. Pepper comes in only when the words are a question or a request, and answers with a card that leads to a real page, a real form or a figure from a report.</p>
      </div>
      <div class="stage">
        ${App.brief({
          what: 'One input for finding a page and for asking Pepper. Results come from a local list of pages and saved reports, so a page jump costs no model call. Enter with nothing chosen hands the words to Pepper, who answers with one of four cards.',
          tryThis: [
            'Under Rota, tap <b>Hertford</b> and then <b>Next week</b>. The page opens at that venue and week, the address says so, and the counter stays at 0.',
            'Go back to the bar and type <b>bookings hitchin tomorrow</b>. The words choose the chips for you. Tap Bookings to open it, still with no model call.',
            'Type a page name, then use the arrow keys and Enter to open it. Press Enter with nothing chosen to ask Pepper. Escape clears the bar.',
            'Tap each suggested ask to see the four cards. On the sea bass card, read what Pepper understood, press Confirm, then Undo.',
            'Tap <b>what is the VAT on gift cards?</b> Reports do not cover it, so Pepper says so and shows no figure.',
          ],
          why: [
            { text: 'Asking first with the screens kept underneath beats chat alone. Finding a page by words has stuck in other products as an extra way in beside the menu (' + out('https://hashnode.com/changelog/2026-07-28-ai-navigation-cmd-k', 'Hashnode') + ', ' + out('https://rameshbabuprudhvi.github.io/sentri/docs/guide/command-palette.html', 'Sentri') + ', ' + out('https://docs.stripe.com/assistant', 'Stripe') + '), and none of the products the report found removed their menus.', confidence: 'high' },
            { text: 'Chat lowers effort. In controlled studies (' + out('https://arxiv.org/pdf/2605.31287', '134 decision-makers') + ', ' + out('https://arxiv.org/pdf/2608.19551', '73 people') + ') it did not reliably save time or improve accuracy, and its advantage shrank as tasks got harder. So words are for finding things and for small requests, and the checking happens on a page.', confidence: 'medium' },
            { text: 'At UK prices, 3,000 model requests a month for one site on a mid-tier model would take 35% to 70% of the subscription, on the report\'s own estimates. So a page jump must cost no model call. <span class="tag low">Medium to low confidence</span>' },
            { text: 'A figure comes from the report catalogue. Model-written database queries were right about 39% of the time on an ' + out('https://aclanthology.org/2026.findings-emnlp.1971/', 'enterprise-scale benchmark') + ', and a curated description of the data added 17 to 23 points. So Pepper picks a named measure and the report engine does the sums. <span class="tag medium">Medium to high confidence</span>' },
          ],
          status: [
            { text: 'A menu search over 1,023 search words, with a description for every page, and Pepper\'s links to pages.', kind: 'built' },
            { text: 'One page matcher in place of three, and the venue, day and tab carried in the address.', kind: 'target' },
            { text: 'The four card types as one surface, and search across records such as a booking or a dish.', kind: 'target' },
          ],
          calls: 'None for navigation. One short turn for a question or a request. The report engine works out any figure.',
        })}
        <div class="stack">
          <div class="row ask-meter">
            <span class="callcount">Model calls so far: <b id="ask-count">0</b></span>
            <span class="tag high" id="ask-last" role="status"></span>
            <span class="small muted">Every model call costs money, on every site, every month. Finding a page has to cost none.</span>
          </div>
          <div class="mock" id="ask-mock">
            ${App.mockBar(HOST + '/')}
            <div class="mock-body">
              ${App.sidebar('Home')}
              <div class="m-main">
                <div class="ask-pane" id="ask-bar-pane">
                  <div class="m-title"><h2>Home</h2><span class="m-pill">${esc(D.today)}</span><span class="m-pill info">${esc(HOME.name)}</span></div>
                  <div class="ask-box" id="ask-box">
                    <div class="m-ask">
                      ${icon('search')}
                      <input type="text" id="ask-input" placeholder="Search or ask Pepper" aria-label="Search or ask Pepper" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" value="rota">
                      <button type="button" class="m-iconbtn" id="ask-clear" aria-label="Clear the bar">${icon('x')}</button>
                    </div>
                    <div class="m-results" id="ask-results" role="group" aria-label="Results"></div>
                  </div>
                  <div class="ask-sugg" role="group" aria-label="Suggested asks">
                    <span class="m-label">Suggested asks</span>
                    <div class="ask-chips">
                      ${ASKS.map((a, i) => `<button type="button" class="m-chip ask-chip" data-sugg="${i}">${icon(a.search ? 'search' : 'sparkles')}${esc(a.text)}</button>`).join('')}
                    </div>
                    <p class="ask-hint">The first one fills the bar. The others go straight to Pepper.</p>
                  </div>
                  <div class="m-card" id="ask-pepper">
                    <div class="m-head">${icon('sparkles')} Pepper <span class="count" id="ask-pepper-count">Not asked yet</span></div>
                    <div class="m-pad" id="ask-talk">
                      <p>Enter with nothing chosen, or the last row of the list, hands your words to Pepper. Pepper answers with one of four cards and nothing else.</p>
                      <div class="ask-types">
                        <div class="ask-type"><b>${icon('link')}Nav card</b>A link to a page, with the venue and day it opens at.</div>
                        <div class="ask-type"><b>${icon('file')}Form card</b>Opens a real form. You check it and save.</div>
                        <div class="ask-type"><b>${icon('chart')}Data card</b>A figure from a report, with what was counted.</div>
                        <div class="ask-type"><b>${icon('check')}Action card</b>A change, shown for you to confirm.</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="ask-pane" id="ask-page-pane" hidden></div>
              </div>
            </div>
          </div>
          <p class="note">Example data. Thai House, its venues, dishes and figures are made up. No model runs on this page: what Pepper says is scripted for the suggested asks.</p>
        </div>
      </div>`

    // ── State and the parts of the page ────────────────────────
    const $ = sel => root.querySelector(sel)
    const mock = $('#ask-mock'), input = $('#ask-input'), box = $('#ask-results'), meter = $('.ask-meter')
    const barPane = $('#ask-bar-pane'), pagePane = $('#ask-page-pane'), talk = $('#ask-talk')
    // The counter stays in sight at a desk: it sticks under the page's own top bar, whose height is measured here.
    const topbar = document.querySelector('.topbar')
    const setTop = () => { root.style.setProperty('--ask-top', (topbar ? topbar.offsetHeight : 0) + 'px') }
    setTop()
    window.addEventListener('resize', setTop)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(setTop, () => {})
    /** After a page opens, bring the top of the mock-up (and the counter) back into sight if it had scrolled away. */
    function bringUp() {
      const top = topbar ? topbar.getBoundingClientRect().bottom : 0
      const stuck = getComputedStyle(meter).position === 'sticky'
      const lim = stuck ? Math.max(top, meter.getBoundingClientRect().bottom) : top
      if (mock.getBoundingClientRect().top >= lim) return
      window.scrollBy(0, (stuck ? mock : meter).getBoundingClientRect().top - lim - (stuck ? 4 : 12))
    }
    let calls = 0
    let results = []      // [{ item, score, pick }]
    let cur = -1          // the row the arrow keys are on; -1 is nothing chosen, results.length is the Ask Pepper row
    let openI = 0         // the row whose chips are showing
    let onPage = false
    let answer = null     // what Pepper last answered: { card, item, pick }
    const fine = () => { try { return window.matchMedia('(pointer: fine)').matches } catch (e) { return false } }

    function setLast(text, paid) {
      const t = $('#ask-last')
      t.textContent = text + (paid ? ' · 1 model call' : ' · no model call')
      t.className = 'tag ' + (paid ? 'low' : 'high')
    }
    const setAddr = addr => { mock.querySelector('.mock-bar .addr').textContent = addr }
    /** Mark a page in the sidebar. The kit's sidebar is a short one, so a page it does not list is added under More. */
    function markSide(label, ico) {
      const side = el(App.sidebar(label))
      if (!side.querySelector('.on')) {
        side.appendChild(el('<h4>More</h4>'))
        side.appendChild(el('<a href="#" data-nav="' + esc(label) + '" class="on">' + icon(ico) + esc(label) + '</a>'))
      }
      mock.querySelector('.m-side').replaceWith(side)
    }

    // ── The results list ───────────────────────────────────────
    function ctxHtml(r, i) {
      const it = r.item
      const grp = (name, key, chips) => '<div class="ask-grp" role="group" aria-label="' + name + '"><span class="m-label">' + name + '</span>' +
        chips.map(c => '<button type="button" class="m-chip ask-chip' + (r.pick[key] === c.id ? ' on' : '') + '" data-ctx="' + key + '" data-val="' + c.id + '" aria-pressed="' + (r.pick[key] === c.id) + '">' +
          esc(c.label) + (c.small ? ' <small>' + esc(c.small) + '</small>' : '') + '</button>').join('') + '</div>'
      const needs = []
      let html = ''
      if (it.venue) { needs.push('a venue'); html += grp('Venue', 'venue', venues.map(v => ({ id: v.id, label: v.name, small: v.id === HOME.id ? 'your venue' : '' }))) }
      if (it.periods) {
        const week = PERIODS[it.periods[0]].kind === 'week'
        needs.push(week ? 'a week' : 'a day')
        html += grp(week ? 'Week' : 'Day', 'period', it.periods.map(p => ({ id: p, label: PERIODS[p].label, small: PERIODS[p].short })))
      }
      if (it.tabs) { needs.push('a tab'); html += grp('Tab', 'tab', it.tabs.map(t => ({ id: t[0], label: t[1] }))) }
      const list = needs.length > 1 ? needs.slice(0, -1).join(', ') + ' and ' + needs[needs.length - 1] : needs[0]
      return '<div class="ask-ctx" data-ctx-of="' + i + '">' + html +
        '<p class="ask-addr">Opens <span data-addr>' + esc(resolve(it, r.pick).addr) + '</span></p>' +
        '<p class="ask-hint">Pick ' + list + ' and the page opens there. Or tap ' + esc(it.label) + ' to open it at the address shown.</p></div>'
    }
    function drawResults() {
      const text = input.value.trim()
      $('#ask-clear').hidden = !input.value
      box.hidden = !text
      if (!text) { box.innerHTML = ''; return }
      let html = ''
      results.forEach((r, i) => {
        const it = r.item, ctx = hasCtx(it), open = ctx && i === openI
        const now = short(resolve(it, r.pick))
        html += '<div class="m-result ask-row' + (i === cur ? ' on' : '') + '">' +
          '<button type="button" class="ask-pick" data-pick="' + i + '"><span class="m-ico">' + icon(it.ico) + '</span>' +
          '<span class="what"><b>' + esc(it.label) + '</b><span>' + esc(it.desc) + '</span></span>' +
          (it.kind === 'report' ? '<span class="m-pill info">Saved report</span>' : '') + '</button>' +
          (ctx && !open ? '<button type="button" class="m-chip ask-chip ask-sum" data-more="' + i + '" aria-label="Choose where ' + esc(it.label) + ' opens. Now ' + esc(now) + '"><span>' + esc(now) + '</span>' + icon('down') + '</button>' : '') +
          '</div>' + (open ? ctxHtml(r, i) : '')
      })
      if (!results.length) html += '<div class="ask-none">No page or saved report matches these words. Searching records such as a dish or a booking is a target, not built.</div>'
      html += '<button type="button" class="m-result pepper' + (cur === results.length ? ' on' : '') + '" id="ask-row-pepper"><span class="m-ico">' + icon('sparkles') + '</span>' +
        '<span class="what"><b>Ask Pepper</b><span>' + esc(text) + '</span></span><span class="m-pill pepper">1 model call</span></button>'
      box.innerHTML = html
    }
    function refresh() {
      results = input.value.trim() ? find(input.value) : []
      cur = -1
      openI = 0
      drawResults()
    }

    // ── Opening a page (a stub of it) and coming back ──────────
    const HOW = {
      list: 'Picked from the results list. No model call.',
      menu: 'Tapped in the menu. No model call.',
      pepper: 'From the link on Pepper\'s card. The question cost one model call. Opening the page cost none.',
      card: 'From Open report on the data card. No further model call.',
    }
    function openPage(it, pick, how, extra) {
      if (it.id === 'home') { backToBar(); input.value = ''; refresh(); setLast('Opened Home', false); return }
      const res = resolve(it, pick)
      const addr = (extra && extra.addr) || res.addr
      const pills = (extra && extra.pills) || [res.v && res.v.name, res.per && res.per.pill, res.tab && res.tab[1] + ' tab'].filter(Boolean)
      const at = (extra && extra.where) || where(res)
      const kv = []
      if (extra && extra.kv) extra.kv.forEach(x => kv.push(x))
      else {
        if (res.v) kv.push(['Venue', res.v.name])
        if (res.per) kv.push([res.per.kind === 'day' ? 'Day' : 'Week', res.per.pill])
        if (res.tab) kv.push(['Tab', res.tab[1]])
      }
      kv.push(['Address', addr], ['How it opened', HOW[how]])
      const rows = extra && extra.rows
        ? '<div class="m-scroll"><table class="m-table"><tr><th>Day</th><th class="r">Net sales</th><th></th></tr>' +
          WEEK_ROWS.map(r => '<tr' + (r[2] ? ' class="ask-fri"' : '') + '><td>' + esc(r[0]) + '</td><td class="r">' + gbp(r[1]) + '</td><td>' + (r[2] ? '<span class="m-pill pepper">Asked about</span>' : '') + '</td></tr>').join('') +
          '</table></div>'
        : ''
      onPage = true
      setAddr(addr)
      markSide(it.kind === 'report' ? 'Reports' : it.label, it.ico)
      pagePane.innerHTML =
        '<div class="m-title"><button type="button" class="m-btn" id="ask-back">' + icon('undo') + 'Back to the bar</button></div>' +
        '<div class="m-title"><h2>' + esc(it.label) + '</h2>' + pills.map(p => '<span class="m-pill info">' + esc(p) + '</span>').join('') + (it.kind === 'report' ? '<span class="m-pill">Saved report</span>' : '') + '</div>' +
        '<div class="m-card"><div class="m-head">' + icon(it.ico) + esc(it.label) + '<span class="count">Stub of the page</span></div><div class="m-pad">' +
        '<p>The ' + esc(it.label) + (it.kind === 'report' ? ' report' : ' page') + ' opened' + (at ? ' ' + esc(at) : '') + '. ' +
        (rows ? 'It lands on the rows behind the figure.' : (hasCtx(it) ? '' : 'It takes no venue or day. ') + 'The mock-up stops here: the page itself is not drawn.') + '</p>' +
        rows +
        '<dl class="ask-kv">' + kv.map(x => '<dt>' + esc(x[0]) + '</dt><dd' + (x[0] === 'Address' ? ' class="ask-addr"' : '') + '>' + esc(x[1]) + '</dd>').join('') + '</dl>' +
        (it.noAddr ? '<p class="ask-hint"><span class="m-pill pepper">Target, not built</span> Today the ' + esc(it.label) + ' page reads nothing from its address, so a link cannot yet open it at a venue or a day.</p>' : '') +
        '</div></div>'
      barPane.hidden = true
      pagePane.hidden = false
      setLast('Opened ' + it.label + (pills.length ? ' · ' + (extra && extra.pills ? pills.join(' · ') : short(res)) : ''), false)
      bringUp()
      $('#ask-back').focus({ preventScroll: true })
    }
    function backToBar() {
      onPage = false
      setAddr(HOST + '/')
      markSide('Home', 'home')
      pagePane.hidden = true
      pagePane.innerHTML = ''
      barPane.hidden = false
      refresh()
      if (fine()) input.focus({ preventScroll: true })
    }

    // ── Pepper: four card types, scripted ──────────────────────
    const cardlet = (type, ico, title, understood, body, foot) =>
      '<div class="m-cardlet" data-card="' + type + '"><header>' + icon(ico) + '<span class="t">' + esc(title) + '</span><span class="m-pill pepper">' + TYPE[type] + '</span></header>' +
      '<div class="m-pad" data-body><div class="m-understood"><b>Understood</b>' + understood.map(u => '<span class="m-pill">' + esc(u) + '</span>').join('') + '</div>' + body + '</div>' +
      (foot ? '<footer>' + foot + '</footer>' : '') + '</div>'
    const kvHtml = rows => '<dl class="ask-kv">' + rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>'
    const mine = HOME.name + ', your venue'

    function navCard(r) {
      const it = r.item, res = resolve(it, r.pick)
      answer = { card: 'nav', item: it, pick: r.pick }
      const u = ['Page: ' + it.label]
      if (res.v) u.push('Venue: ' + (res.v.id === HOME.id ? mine : res.v.name))
      if (res.per) u.push(res.per.pill)
      if (res.tab) u.push('Tab: ' + res.tab[1])
      return cardlet('nav', 'link', it.label, u,
        '<p>' + esc(it.desc) + '.</p><p class="ask-addr">' + esc(res.addr) + '</p><p class="ask-hint">The list under the bar opens this page for no model call.</p>',
        '<button type="button" class="m-btn primary" data-act="open-nav">Open ' + esc(it.label) + '</button>')
    }
    const CARDS = {
      data() {
        const diff = FRI.now - FRI.before
        return cardlet('data', 'chart', 'Net sales, Friday against the Friday before',
          ['Measure: net sales', 'Venue: ' + mine, 'Friday: 20 November', 'Friday before: 13 November'],
          '<div class="m-scroll"><table class="m-table"><tr><th>Day</th><th class="r">Net sales</th></tr>' +
          '<tr><td>Friday 20 November</td><td class="r">' + gbp(FRI.now) + '</td></tr>' +
          '<tr><td>Friday 13 November</td><td class="r">' + gbp(FRI.before) + '</td></tr>' +
          '<tr><td><b>Difference</b></td><td class="r"><b>+' + gbp(diff) + '</b>, up ' + (diff / FRI.before * 100).toFixed(1) + '%</td></tr></table></div>' +
          kvHtml([['Measure', 'Net sales: till and online orders, after discounts and refunds, before VAT'], ['Venue', esc(HOME.name)], ['Dates', 'Friday 20 November 2026 and Friday 13 November 2026'],
            ['Worked out by', 'The report engine, from the report catalogue. Pepper chose the measure and the dates and did no sums.']]),
          '<button type="button" class="m-btn primary" data-act="open-report">' + icon('chart') + 'Open report</button>')
      },
      action() {
        return cardlet('action', 'check', 'Mark a dish sold out',
          ['Dish: ' + dish, 'Venue: ' + mine, 'From: now'],
          '<p>You said sea bass. One dish on the menu matches.</p>' +
          kvHtml([['What will change', '<span class="m-diff">' + esc(dish) + ': <s>On sale</s><b>Sold out</b></span>'], ['Where it applies', esc(HOME.name) + ': the till, online ordering and the menu screens'],
            ['Not changed', esc(others)], ['Until', 'You put it back on sale']]),
          '<button type="button" class="m-btn primary" data-act="confirm">Confirm</button><button type="button" class="m-btn" data-act="cancel">Cancel</button>')
      },
      expense() {
        return cardlet('form', 'file', 'Expense for ' + PERIODS.today.long,
          ['Form: Expense', 'Venue: ' + mine, 'Day: today, ' + PERIODS.today.long, 'Supplier: ' + dairy],
          '<p>Pepper put three values from your words on the form. You check them there, and nothing is saved until you press Save.</p>' +
          kvHtml([['Amount', gbp(4250)], ['For', 'Milk'], ['Supplier', esc(dairy)]]),
          '<button type="button" class="m-btn primary" data-act="open-form">' + icon('file') + 'Open form</button>')
      },
      cashup() {
        return cardlet('form', 'cash', 'Cash-up for ' + PERIODS.yesterday.long,
          ['Form: Cash-up', 'Venue: ' + mine, 'Day: yesterday, ' + PERIODS.yesterday.long],
          '<p>The till\'s takings are already on the form. You count the cash and type it in. Pepper never fills in a counted amount.</p>',
          '<button type="button" class="m-btn primary" data-act="open-form">' + icon('file') + 'Open form</button>')
      },
      vat() {
        return cardlet('data', 'chart', 'VAT on gift cards',
          ['A question about a figure', 'Topic: VAT on gift cards', 'No report measure matches'],
          '<p><b>That is not something reports cover yet.</b></p>' +
          '<p>Reports cover sales, takings, tips, discounts, covers, online orders and bookings. This is a tax question, so ask your accountant. Pepper shows no figure here, because it never guesses one.</p>',
          '<button type="button" class="m-btn" data-act="see-reports">See what reports cover</button>')
      },
    }
    function askPepper(text) {
      const words = String(text || '').trim()
      if (!words) return
      calls += 1
      $('#ask-count').textContent = calls
      answer = null
      let html
      const card = SCRIPT[norm(words)]
      if (card) { answer = { card }; html = CARDS[card]() }
      else {
        const hit = find(words)[0] // the same page list the bar uses: a page's name gets a link to it
        html = hit && hit.score >= 60 ? navCard(hit)
          : '<div class="m-msg pepper">This mock-up only knows the examples above. In the product, Pepper would answer with one of the four cards.</div>'
      }
      mock.querySelectorAll('.m-toast').forEach(t => t.remove()) // an Undo for the card this answer replaces
      talk.innerHTML = '<div class="m-msg me">' + esc(words) + '</div>' + html
      $('#ask-pepper-count').textContent = '1 model call for this answer · ' + calls + ' so far'
      input.value = ''
      refresh()
      setLast('Asked Pepper', true)
      $('#ask-pepper').scrollIntoView({ block: 'nearest' })
    }
    function act(name) {
      const card = talk.querySelector('.m-cardlet')
      const body = card && card.querySelector('[data-body]'), foot = card && card.querySelector('footer')
      const here = HOME.name
      if (name === 'open-nav' && answer && answer.item) return openPage(answer.item, answer.pick, 'pepper')
      if (name === 'open-form') return App.go('form')
      if (name === 'see-reports') return openPage(byId('reports'), {}, 'pepper')
      if (name === 'open-report') {
        return openPage(byId('sales-by-day'), {}, 'card', {
          addr: HOST + '/reports/sales-by-day?venue=' + HOME.id + '&from=2026-11-13&to=2026-11-20', rows: true,
          pills: [here, '13 to 20 November'], where: 'at ' + here + ', for Friday 13 to Friday 20 November',
          kv: [['Venue', here], ['Dates', 'Friday 13 to Friday 20 November 2026'], ['Measure', 'Net sales']],
        })
      }
      if (!card) return
      const undo = () => {
        mock.querySelectorAll('.m-toast').forEach(t => t.remove())
        body.innerHTML = '<p class="ask-done">' + icon('undo') + '<span>Undone. ' + esc(dish) + ' is back on sale at ' + esc(here) + '.</span></p>'
        if (foot) foot.hidden = true
        setLast('Undid the change', false)
      }
      if (name === 'confirm') {
        body.innerHTML = '<p class="ask-done">' + icon('check') + '<span><b>Done.</b> ' + esc(dish) + ' is sold out at ' + esc(here) + ' on the till, online ordering and the menu screens. ' + esc(others) + ' are not changed.</span></p>'
        foot.innerHTML = '<button type="button" class="m-btn" data-act="undo">' + icon('undo') + 'Undo</button>'
        App.toast(mock, dish + ' marked sold out at ' + here, { undo })
        setLast('Confirmed the change', false)
      }
      if (name === 'cancel') {
        body.innerHTML = '<p>Cancelled. Nothing changed.</p>'
        foot.hidden = true
        setLast('Cancelled the change', false)
      }
      if (name === 'undo') undo()
    }

    // ── Events ─────────────────────────────────────────────────
    input.addEventListener('input', () => {
      refresh()
      const words = input.value.trim()
      setLast(words ? 'Searched for ' + (words.length > 28 ? words.slice(0, 28) + '...' : words) : 'Cleared the bar', false)
    })
    input.addEventListener('keydown', e => {
      const last = results.length // the Ask Pepper row
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!input.value.trim()) return
        e.preventDefault()
        cur = e.key === 'ArrowDown' ? Math.min(cur + 1, last) : Math.max(cur - 1, -1)
        if (cur >= 0 && cur < last && hasCtx(results[cur].item)) openI = cur
        drawResults()
        const on = box.querySelector('.m-result.on')
        if (on) on.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (cur >= 0 && cur < last) openPage(results[cur].item, results[cur].pick, 'list')
        else askPepper(input.value)
      } else if (e.key === 'Escape') {
        if (!input.value) return
        input.value = ''
        refresh()
        setLast('Cleared the bar', false)
      }
    })
    mock.addEventListener('keydown', e => { if (e.key === 'Escape' && onPage) backToBar() })
    mock.addEventListener('click', e => {
      const t = e.target
      let b
      if ((b = t.closest('.m-side [data-nav]'))) {
        e.preventDefault()
        const name = b.dataset.nav
        if (name === 'Home' || name === 'Pepper') { backToBar(); setLast(name === 'Home' ? 'Opened Home' : 'Back at the bar', false); return }
        const it = ITEMS.find(x => x.label === name)
        if (it) openPage(it, {}, 'menu')
        return
      }
      if (t.closest('#ask-back')) { backToBar(); setLast('Back at the bar', false); return }
      if (t.closest('#ask-clear')) { input.value = ''; refresh(); setLast('Cleared the bar', false); if (fine()) input.focus({ preventScroll: true }); return }
      if ((b = t.closest('[data-ctx]'))) {
        const ctx = b.closest('.ask-ctx'), r = results[Number(ctx.dataset.ctxOf)]
        r.pick[b.dataset.ctx] = b.dataset.val
        if (complete(r.item, r.pick)) return openPage(r.item, r.pick, 'list')
        b.parentNode.querySelectorAll('[data-ctx]').forEach(c => { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', String(c === b)) })
        ctx.querySelector('[data-addr]').textContent = resolve(r.item, r.pick).addr
        return
      }
      if ((b = t.closest('[data-more]'))) {
        openI = Number(b.dataset.more)
        drawResults()
        const first = box.querySelector('.ask-ctx [data-ctx]')
        if (first) first.focus({ preventScroll: true })
        return
      }
      if ((b = t.closest('[data-pick]'))) { const r = results[Number(b.dataset.pick)]; return openPage(r.item, r.pick, 'list') }
      if (t.closest('#ask-row-pepper')) return askPepper(input.value)
      if ((b = t.closest('[data-sugg]'))) {
        const a = ASKS[Number(b.dataset.sugg)]
        if (a.search) { input.value = a.text; refresh(); setLast('Searched for ' + a.text, false); if (fine()) input.focus({ preventScroll: true }) }
        else askPepper(a.text)
        return
      }
      if ((b = t.closest('[data-act]'))) act(b.dataset.act)
    })

    // At rest: the example is typed and its results are showing.
    refresh()
    setLast('Searched for rota', false)
  },
})
