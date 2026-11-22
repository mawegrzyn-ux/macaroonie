// Home: the day comes to the person. One page at / in place of the three
// home pages: the ask bar, the person's pins and a few suggestions, the
// Today feed (Late, Now, Next, Later) where each task opens its form in a
// sheet, the week ahead and a For review tile. A second role shows the area
// manager's Home: venues ranked by exceptions. Everything is worked out from
// the example data in core.js by rules in this file. No model runs.
// Source: reports/AI first back office strategy.md, "Home: the day comes to
// the person", "Above the store" and the target flows.
App.view('home', {
  label: 'Home',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, el } = App
    const D = App.data
    const NOW = '11:20' // the example's clock

    // ── Styles this view adds (kit gaps: see the note at each block) ──
    if (!document.getElementById('hm-style')) {
      const st = document.createElement('style')
      st.id = 'hm-style'
      st.textContent = `
        /* Home is taller than a screen. The kit pins a sheet and a toast to the
           bottom of the mock-up, which would be off screen here, so both stick
           to the bottom of the window while they are inside the mock-up. */
        #view-home .mock { overflow: clip; }
        #view-home .m-sheet { position: sticky; bottom: 0; max-height: min(92%, calc(100vh - 128px)); max-height: min(92%, calc(100dvh - 128px)); outline: 0; }
        #view-home .hm-toasts { position: sticky; bottom: 0; height: 0; z-index: 30; }
        #view-home .hm-toasts .m-toast { left: 12px; right: 12px; transform: none; width: fit-content; max-width: none; margin-inline: auto; }
        #view-home .hm-footnote { margin-right: auto; align-self: center; font-size: 13px; color: var(--m-muted); min-width: 0; }
        #view-home .hm-footnote b { color: var(--m-ink); }

        /* the kit sizes icons in buttons, chips and task rows only */
        #view-home .m-head svg, #view-home .m-cardlet > header svg { width: 16px; height: 16px; flex: none; }

        #view-home .hm-who { display: grid; flex: 1 1 200px; min-width: 0; }
        #view-home .hm-sub { font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-back svg { transform: rotate(180deg); }
        #view-home .hm-strip { display: grid; gap: 8px; }
        #view-home .hm-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
        #view-home .hm-chips .m-chip { min-height: 48px; max-width: 100%; touch-action: manipulation; }
        #view-home .hm-chips .m-chip.why { white-space: normal; text-align: left; }
        #view-home .hm-lab { flex: 0 0 74px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--m-muted); }

        #view-home .hm-ghead { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--m-page); border-top: 1px solid var(--m-line); border-bottom: 1px solid var(--m-line); font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-group:first-child .hm-ghead { border-top: 0; }
        #view-home .hm-ghead b { color: var(--m-ink); font-variant-numeric: tabular-nums; }
        #view-home .hm-empty { padding: 12px; font-size: 13px; color: var(--m-muted); }
        #view-home .hm-item + .hm-item { border-top: 1px solid var(--m-line); }
        #view-home .hm-task { flex-wrap: wrap; border-top: 0; }
        #view-home .hm-task .what { flex: 1 1 180px; }
        #view-home .hm-task .what .m-pill { margin-left: 4px; }
        #view-home .hm-acts { display: flex; gap: 6px; align-items: center; margin-left: auto; }
        #view-home .hm-more { padding: 0 8px; gap: 2px; color: var(--m-muted); }
        #view-home .hm-more svg + svg { width: 12px; height: 12px; }
        #view-home .hm-ico-late { background: var(--m-bad-soft); color: var(--m-bad); }
        #view-home .hm-ico-done { background: var(--m-good-soft); color: var(--m-good); }
        #view-home .hm-not { padding: 0 12px 12px 56px; display: grid; gap: 10px; }
        #view-home .hm-notrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        #view-home .hm-notlab { font-size: 12.5px; font-weight: 600; color: var(--m-muted); }
        #view-home .hm-skip { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--m-line); border-radius: 8px; background: var(--m-page); }
        #view-home .hm-warn { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--m-warn); background: var(--m-warn-soft); border-radius: 8px; padding: 8px 10px; }
        #view-home .hm-warn svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
        #view-home .hm-hint { font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-foot { padding: 9px 12px; border-top: 1px solid var(--m-line); font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-badge { min-width: 34px; height: 34px; padding: 0 9px; border-radius: 999px; background: var(--m-primary); color: var(--m-primary-ink); display: inline-flex; align-items: center; justify-content: center; font-weight: 650; font-variant-numeric: tabular-nums; flex: none; }

        #view-home .hm-week { container-type: inline-size; }
        #view-home .hm-days { display: grid; }
        #view-home .hm-day { display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; gap: 2px 10px; align-items: baseline; padding: 9px 12px; border-top: 1px solid var(--m-line); font-size: 13px; }
        #view-home .hm-day:first-child { border-top: 0; }
        #view-home .hm-day.today { background: var(--m-accent-soft); }
        #view-home .hm-day b { font-weight: 600; }
        #view-home .hm-wx { color: var(--m-muted); min-width: 0; }
        #view-home .hm-ev { grid-column: 2 / -1; justify-self: start; font-size: 12px; background: var(--m-info-soft); color: var(--m-info); border-radius: 6px; padding: 2px 7px; }
        @container (min-width: 600px) {
          #view-home .hm-days { grid-template-columns: repeat(7, minmax(0, 1fr)); }
          #view-home .hm-day { grid-template-columns: minmax(0, 1fr); align-content: start; gap: 3px; padding: 10px; border-top: 0; border-left: 1px solid var(--m-line); }
          #view-home .hm-day:first-child { border-left: 0; }
          #view-home .hm-ev { grid-column: auto; }
        }

        #view-home .hm-venue { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px; border-top: 1px solid var(--m-line); }
        #view-home .hm-venue:first-child { border-top: 0; }
        #view-home .hm-vname { display: flex; align-items: center; gap: 10px; flex: 1 1 150px; min-width: 0; }
        #view-home .hm-vname .what { display: grid; min-width: 0; }
        #view-home .hm-vname .what b { font-size: 15px; font-weight: 600; }
        #view-home .hm-vname .what span { font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-rank { width: 28px; height: 28px; border-radius: 50%; background: var(--m-hover); color: var(--m-muted); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12.5px; flex: none; }
        #view-home .hm-stats { flex: 1 1 100%; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; min-width: 0; }
        #view-home .hm-stat { display: grid; padding: 6px 9px; border-radius: 8px; background: var(--m-page); min-width: 0; }
        #view-home .hm-stat b { font-size: 18px; font-weight: 650; line-height: 1.25; font-variant-numeric: tabular-nums; color: var(--m-muted); }
        #view-home .hm-stat span { font-size: 11.5px; line-height: 1.25; color: var(--m-muted); }
        #view-home .hm-stat.bad { background: var(--m-bad-soft); }
        #view-home .hm-stat.bad b, #view-home .hm-stat.bad span { color: var(--m-bad); }
        #view-home .hm-stat.warn { background: var(--m-warn-soft); }
        #view-home .hm-stat.warn b, #view-home .hm-stat.warn span { color: var(--m-warn); }
        #view-home .hm-vskip { flex: 1 1 100%; }

        #view-home .hm-note { font-size: 13px; color: var(--m-muted); }
        #view-home .hm-till { display: grid; gap: 4px; align-content: start; min-width: 0; }
        #view-home .hm-till b { font-size: 20px; font-weight: 650; }
        #view-home .hm-var { font-size: 13px; color: var(--m-muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--m-line); background: var(--m-page); }
        #view-home .hm-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        #view-home .hm-sum > div { display: grid; gap: 2px; align-content: start; padding: 8px 10px; border-radius: 8px; background: var(--m-page); min-width: 0; }
        #view-home .hm-sum span { font-size: 11.5px; color: var(--m-muted); }
        #view-home .hm-sum b { font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
        #view-home .hm-sum b.wait { font-size: 13px; font-weight: 500; color: var(--m-muted); }
        #view-home .hm-unit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-top: 1px solid var(--m-line); }
        #view-home .hm-unit:first-child { border-top: 0; padding-top: 0; }
        #view-home .hm-uname { flex: 1 1 150px; min-width: 0; display: grid; }
        #view-home .hm-uname label { font-weight: 600; font-size: 14px; }
        #view-home .hm-uname span { font-size: 12.5px; color: var(--m-muted); }
        #view-home .hm-temp { display: flex; align-items: center; gap: 8px; flex: none; }
        #view-home .hm-temp .m-input { width: 92px; text-align: right; }
        #view-home .hm-temp .m-pill { min-width: 132px; justify-content: center; }
        #view-home .hm-deg { font-size: 13px; color: var(--m-muted); }
        #view-home .hm-sign { width: 48px; padding: 0; font-size: 18px; flex: none; }
        #view-home .hm-unit.out .hm-temp .m-input, #view-home .hm-unit.miss .hm-temp .m-input { border-color: var(--m-bad); }
        #view-home .hm-fix { flex: 1 1 100%; }
        #view-home .hm-formerr { font-size: 13px; font-weight: 500; color: var(--m-bad); }
        #view-home .hm-ticks { display: grid; }
        #view-home .hm-tick { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 4px 2px; border-top: 1px solid var(--m-line); font-size: 14px; cursor: pointer; touch-action: manipulation; }
        #view-home .hm-tick:first-child { border-top: 0; }
        #view-home .hm-tick input { width: 22px; height: 22px; margin: 0; flex: none; accent-color: var(--m-primary); }
        #view-home .hm-tick svg { width: 16px; height: 16px; flex: none; color: var(--m-muted); }
        @media (max-width: 720px) {
          #view-home .hm-not { padding-left: 12px; }
          #view-home .hm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          #view-home .hm-lab { flex-basis: 100%; }
        }
      `
      document.head.appendChild(st)
    }

    // ── Small helpers ───────────────────────────────────────────
    const gbp = p => (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const parseMoney = s => { const c = String(s).replace(/[£,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(c) ? Math.round(parseFloat(c) * 100) : null }
    const parseTemp = s => { const c = String(s).trim().replace(',', '.').replace(/\u2212/g, '-'); return /^-?\d{1,3}(\.\d+)?$/.test(c) ? parseFloat(c) : null }
    const fmtTemp = v => (v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(1) + ' °C'
    const varWords = v => v === 0 ? 'balanced' : gbp(Math.abs(v)) + (v < 0 ? ' short' : ' over')
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
    const setErr = (field, msg) => {
      field.classList.toggle('error', !!msg)
      const e = field.querySelector('.err')
      if (e) { e.textContent = msg || ''; e.hidden = !msg }
    }

    // ── The example: venues, people and each venue's tasks ──────
    const VEN = {}
    D.venues.forEach(v => { VEN[v.id] = v })
    const ANNA = D.people.find(p => p.id === 'anna') || { name: 'Anna Novak', role: 'General manager' }
    const TOM = D.people.find(p => p.id === 'tom') || { name: 'Tom Reid', role: 'Area manager' }
    const HOME_VENUE = VEN.ware ? 'ware' : D.venues[0].id
    const without = name => D.fridges.filter(f => f !== name)
    const EXTRA = {
      ware: { missed: 0, orders: 1, review: '1 supplier order to approve, 1 invoice read from a photo', units: D.fridges, week: [46, 18, 22, 25, 41, 88, 97], event: [5, 'Christmas lights, 18:00'] },
      hertford: { missed: 0, orders: 1, review: '1 allergen change to sign off, for all venues', units: without('Prep fridge 2'), week: [38, 14, 19, 20, 35, 74, 81], event: [6, 'Christmas market, all day'] },
      hitchin: { missed: 2, orders: 2, review: '2 supplier orders to approve, 1 price list read from a file', units: without('Bar fridge'), week: [34, 17, 19, 21, 32, 69, 74], event: [4, 'Late-night shopping, 17:00 to 21:00'] },
    }
    const extra = id => EXTRA[id] || { missed: 0, orders: 0, review: '', units: D.fridges, week: [30, 15, 18, 20, 30, 60, 70], event: null }
    const DAYS = ['Today', 'Mon 23', 'Tue 24', 'Wed 25', 'Thu 26', 'Fri 27', 'Sat 28']
    const WEATHER = ['Dry and cold', 'Light rain', 'Cloudy', 'Heavy rain', 'Dry', 'Dry, frost early', 'Showers']
    const TILL = { 'ware:cashup': { cash: 148640, card: 231045 }, 'hitchin:cashup-fri': { cash: 121050, card: 198430 }, 'hitchin:cashup': { cash: 139975, card: 240210 } }
    const DAY_OF = { Saturday: 'Saturday 21 November', Friday: 'Friday 20 November' }
    const CHECKLIST = ['Alarm off and doors unlocked', 'Lights, extraction and gas on', 'Hand wash sinks stocked with soap and paper towels', 'Sanitiser made up and labelled', 'Probe thermometer wiped and checked', 'Rice cookers on', 'Fryer oil checked', 'Date labels checked in the prep fridges', 'Till float counted', 'Card machines on and charged', 'Front door and toilets checked', 'Tables laid and menus wiped', 'Allergen folder at the pass', 'Music and heating on']
    const PAGES = [['Timeline', 'calendar'], ['Bookings', 'calendar'], ['Online orders', 'box'], ['Sold out', 'utensils'], ['Till reports', 'chart'], ['Cash recon', 'cash'], ['Rota', 'users'], ['Food safety', 'thermometer'], ['Checklists', 'check'], ['Purchasing', 'truck'], ['Menus', 'utensils'], ['Reports', 'file']]
    const pageIcon = name => (PAGES.find(p => p[0] === name) || [name, 'right'])[1]
    const BUTTON = { cashup: 'Do the cash-up', fridges: 'Log temperatures', delivery: 'Book it in', order: 'Fill the order', rota: 'Open the rota' }

    function prep(t, vid) {
      const o = Object.assign({ state: 'open', snoozed: null, summary: '', reason: '' }, t)
      o.safety = o.form === 'fridges' || o.form === 'checklist'
      if (o.form === 'cashup') {
        o.till = TILL[vid + ':' + o.id] || { cash: 120000, card: 200000 }
        const day = (/for (\w+)/.exec(o.title) || [])[1] || 'Saturday'
        o.dayShort = day
        o.day = DAY_OF[day] || day
      }
      if (o.form === 'checklist') {
        const n = Number((/(\d+) of \d+/.exec(o.sub) || [])[1] || 0)
        o.ticks = CHECKLIST.map((_, i) => i < n)
      }
      return o
    }
    function seedFeed(vid) {
      const n = VEN[vid].name
      let list = []
      if (vid === 'ware') {
        list = D.tasks.map(t => Object.assign({}, t)).concat([
          { id: 'bakery', when: 'now', icon: 'send', title: 'Send the order to East Bakery', sub: '', form: 'sent', state: 'done', summary: '12 lines, £86.40 · sent 08:50 by Mia Clarke' },
        ])
      } else if (vid === 'hertford') {
        list = [
          { id: 'opening', when: 'now', icon: 'check', title: 'Opening checklist', sub: n + ' · 12 of 14 done', form: 'checklist' },
          { id: 'delivery', when: 'now', icon: 'truck', title: 'East Bakery delivery', sub: n + ' · expected 11:30 to 12:30', form: 'delivery' },
          { id: 'order', when: 'next', icon: 'box', title: 'Harlow Dairy order cut-off', sub: 'Order by 15:00 for Tuesday', form: 'order' },
          { id: 'fridge-pm', when: 'later', icon: 'thermometer', title: 'Evening fridge checks', sub: n + ' · due 21:00', form: 'fridges' },
          { id: 'cashup', when: 'late', icon: 'cash', title: 'Cash-up for Saturday', sub: '', form: 'cashup', state: 'done', summary: 'Counted £3,104.20 against £3,104.20 from the till · balanced · submitted 09:10' },
          { id: 'fridge-am', when: 'late', icon: 'thermometer', title: 'Morning fridge checks', sub: '', form: 'fridges', state: 'done', summary: '4 units logged, all in range · saved 08:55' },
        ]
      } else if (vid === 'hitchin') {
        list = [
          { id: 'cashup-fri', when: 'late', icon: 'cash', title: 'Cash-up for Friday not submitted', sub: n + ' · due by 10:00 on Saturday', form: 'cashup' },
          { id: 'cashup', when: 'late', icon: 'cash', title: 'Cash-up for Saturday not submitted', sub: n + ' · due by 10:00', form: 'cashup' },
          { id: 'fridge-am', when: 'late', icon: 'thermometer', title: 'Morning fridge checks', sub: n + ' · due 09:00 · 4 units', form: 'fridges' },
          { id: 'opening', when: 'late', icon: 'check', title: 'Opening checklist', sub: n + ' · due 10:30 · 0 of 14 done', form: 'checklist' },
          { id: 'delivery', when: 'now', icon: 'truck', title: 'Lea Valley Produce delivery', sub: n + ' · expected 11:00 to 12:00', form: 'delivery' },
          { id: 'order', when: 'next', icon: 'box', title: 'Harlow Dairy order cut-off', sub: 'Order by 15:00 for Tuesday', form: 'order' },
          { id: 'fridge-pm', when: 'later', icon: 'thermometer', title: 'Evening fridge checks', sub: n + ' · due 21:00', form: 'fridges' },
        ]
      }
      return list.map(t => prep(t, vid))
    }
    const seed = () => {
      const feeds = {}
      D.venues.forEach(v => { feeds[v.id] = seedFeed(v.id) })
      return { feeds, pins: { site: ['Rota', 'Cash recon', 'Sold out', 'Timeline'], area: ['Till reports', 'Reports', 'Purchasing', 'Menus'] } }
    }

    // ── State (this view only) ──────────────────────────────────
    const state = Object.assign({ role: 'site', venue: null }, seed())
    const who = () => state.role === 'area' ? TOM : ANNA
    const curVenue = () => state.role === 'site' ? HOME_VENUE : state.venue // null: the area manager's list
    const groupOf = t => t.state !== 'open' ? t.state : t.snoozed ? 'later' : t.when
    const subOf = t => t.form === 'checklist' && t.ticks ? t.sub.replace(/\d+ of \d+ done/, t.ticks.filter(Boolean).length + ' of ' + t.ticks.length + ' done') : t.sub
    const buttonOf = t => t.form === 'checklist' ? (t.ticks.some(Boolean) ? 'Carry on' : 'Tick it off') : BUTTON[t.form] || 'Open'
    function venueStats(v) {
      const list = state.feeds[v.id] || []
      const open = list.filter(t => t.state === 'open')
      const x = extra(v.id)
      return {
        id: v.id, name: v.name, review: v.review || 0, missed: x.missed, orders: x.orders,
        late: open.filter(t => groupOf(t) === 'late').length,
        cashups: open.filter(t => t.form === 'cashup').length,
        done: list.filter(t => t.state === 'done').length, total: list.length,
        skipped: list.filter(t => t.state === 'skipped' && t.safety),
      }
    }
    const ranked = () => D.venues.map(venueStats).sort((a, b) => (b.late + b.missed) - (a.late + a.missed) || b.cashups - a.cashups || b.orders - a.orders || a.name.localeCompare(b.name))

    // ── The page ────────────────────────────────────────────────
    root.innerHTML = `
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>Home: the day comes to the person</h1>
        <p class="lede">One page in place of three home pages. From top to bottom it holds the ask bar, your pins and a few suggestions, today's tasks, the week ahead and what is waiting for review.</p>
      </div>
      <div class="stage">
        ${App.brief({
          what: 'Home at <span class="mono">/</span> for two roles. A site manager gets the day as a short list of tasks, and each task opens its real form in a sheet. An area manager gets the venues ranked by what is going wrong.',
          tryThis: [
            'Tap <b>Do the cash-up</b>. The till\'s takings are already there. Type the counted cash and the card total, then submit.',
            'Tap <b>Log temperatures</b> and type 9.5 for a fridge. Save is refused until you type what you did about it.',
            'Tap the clock beside a task. Snooze it, or skip it and give a reason.',
            'Switch to <b>Area manager</b> and open a venue\'s feed.',
            'Tap the ask bar or <b>Open For review</b>. Each leads to its own mock-up.',
          ],
          why: [
            { text: 'A task feed as Home is a reasoned bet and has not been proven. It matches Square\'s and Shopify\'s home screens, but nobody has published a test of a task feed against dashboards in this sector. <span class="tag low">Medium to low confidence</span>' },
            { text: 'About 80% of multi-unit operators want visibility of daily task completion and 36% have it, in one vendor\'s survey (<a href="https://www.crunchtime.com/blog/webinar-recap-2025-restaurant-growth-insights-report" target="_blank" rel="noopener">Crunchtime</a>).', confidence: 'low' },
            { text: 'In one US vendor\'s 2026 assistant logs, with no published method, 54% of prompts came from phones and 53% arrived during peak lunch or dinner service (<a href="https://pos.toasttab.com/blog/data/q1-2026-restaurant-ai-pos-trends" target="_blank" rel="noopener">Toast</a>). That fits short jobs that come to the person.', confidence: 'low' },
          ],
          status: [
            { kind: 'built', text: 'The Today feed. Rules and data work it out on every request: 8 sources, grouped Late, Now, Next and Later, one action per task. The cash-up, fridge check and checklist forms are real panels.' },
            { kind: 'target', text: 'One home in place of three (the Overview tiles, Today and the Launcher).' },
            { kind: 'target', text: 'Pins kept on the server, and up to four suggestions that each give a reason.' },
            { kind: 'target', text: 'Snooze, and skip with a reason. There is no task store yet to remember them.' },
            { kind: 'target', text: 'The above-store Home: venues ranked by exceptions, completion by site.' },
          ],
          calls: 'None. Tasks, counts and suggestions come from rules and data, and the forms save through their own pages.',
        })}
        <div class="stack">
          <div class="row">
            <div class="seg" id="hm-role" role="group" aria-label="Whose Home">
              <button type="button" data-role="site" aria-pressed="true">Site manager (Anna, Ware)</button>
              <button type="button" data-role="area" aria-pressed="false">Area manager (Tom, all venues)</button>
            </div>
            <span class="spacer"></span>
            <button type="button" class="btn" id="hm-reset">${icon('undo')} Start the example again</button>
          </div>
          <div class="mock" id="hm-mock">
            ${App.mockBar('office.macaroonie.com/')}
            <div class="mock-body">
              ${App.sidebar('Home')}
              <div class="m-main" id="hm-main"></div>
            </div>
            <div class="hm-toasts" id="hm-toasts"></div>
          </div>
        </div>
      </div>`

    const mock = root.querySelector('#hm-mock')
    const main = root.querySelector('#hm-main')
    const toasts = root.querySelector('#hm-toasts')
    const toast = (text, opts) => App.toast(toasts, text, opts)
    const closeSheets = () => mock.querySelectorAll('.m-scrim').forEach(s => s.remove())

    // ── Drawing ─────────────────────────────────────────────────
    function titleRow() {
      const vid = curVenue()
      const p = who()
      const where = vid ? VEN[vid].name : 'All venues'
      return `<div class="m-title">
        ${state.role === 'area' && vid ? `<button type="button" class="m-btn hm-back" data-act="back">${icon('right')} All venues</button>` : ''}
        <div class="hm-who"><h2>Home</h2><span class="hm-sub">${esc(p.name)}, ${esc(p.role)} · ${esc(where)} · ${esc(D.today)}, ${NOW}</span></div>
        <span class="m-pill">Example data</span>
      </div>`
    }
    const askBar = () => `<div class="m-ask" id="hm-ask" data-act="ask">${icon('search')}
      <input type="text" id="hm-ask-input" placeholder="Search or ask Pepper" aria-label="Search or ask Pepper. Opens the ask bar." readonly>
      <button type="button" class="m-iconbtn primary" data-act="ask" aria-label="Ask Pepper">${icon('sparkles')}</button>
    </div>`

    function suggestions() {
      const vid = curVenue()
      const out = []
      if (state.role === 'area') {
        const rows = D.venues.map(venueStats)
        const cashups = rows.reduce((n, r) => n + r.cashups, 0)
        const lateSafety = D.venues.filter(v => (state.feeds[v.id] || []).some(t => t.state === 'open' && t.safety && groupOf(t) === 'late'))
        if (cashups) out.push(['Cash recon', plural(cashups, 'cash-up', 'cash-ups') + ' not submitted'])
        if (lateSafety.length) out.push(['Food safety', 'checks late at ' + (lateSafety.length === 1 ? lateSafety[0].name : lateSafety.length + ' venues')])
        out.push(['Rota', 'you open this most Sundays'])
      } else {
        const list = state.feeds[vid] || []
        if (list.some(t => t.state === 'open' && t.safety && (groupOf(t) === 'late' || groupOf(t) === 'now'))) out.push(['Food safety', 'due now'])
        out.push(['Till reports', 'you open this most Sundays'])
        if (list.some(t => t.state === 'open' && t.form === 'delivery')) out.push(['Purchasing', 'delivery today'])
        out.push(['Bookings', extra(vid).week[0] + ' booked tonight'])
      }
      const pinned = state.pins[state.role]
      return out.filter(s => pinned.indexOf(s[0]) < 0).slice(0, 4)
    }
    function chips() {
      const pins = state.pins[state.role]
      const sugg = suggestions()
      return `<div class="hm-strip" id="hm-strip">
        <div class="hm-chips"><span class="hm-lab">Your pins</span>
          ${pins.map(p => `<button type="button" class="m-chip" data-act="page" data-page="${esc(p)}">${icon(pageIcon(p))}${esc(p)}</button>`).join('')}
          <button type="button" class="m-chip" data-act="pinpage">${icon('pin')}Pin a page</button>
        </div>
        ${sugg.length ? `<div class="hm-chips"><span class="hm-lab">Suggested</span>
          ${sugg.map(s => `<button type="button" class="m-chip why" data-act="page" data-page="${esc(s[0])}">${icon(pageIcon(s[0]))}<span>${esc(s[0])} <small>${esc(s[1])}</small></span></button>`).join('')}
        </div>` : ''}
      </div>`
    }

    function notNow(t) {
      const id = esc(t.id)
      return `<div class="hm-not" id="hm-not-${id}" hidden>
        <div class="hm-notrow"><span class="hm-notlab">Not now?</span>
          ${t.snoozed
            ? `<button type="button" class="m-btn" data-act="wake" data-id="${id}">End the snooze</button>`
            : `<button type="button" class="m-btn" data-act="snooze" data-id="${id}" data-until="12:20">Snooze 1 hour</button>
               <button type="button" class="m-btn" data-act="snooze" data-id="${id}" data-until="14:30">Snooze until 14:30</button>`}
          <button type="button" class="m-btn" data-act="askskip" data-id="${id}">Skip today</button>
        </div>
        <div class="hm-skip" id="hm-skip-${id}" hidden>
          <div class="m-field" id="hm-whyf-${id}"><label for="hm-why-${id}">Why is this being skipped?</label>
            <input class="m-input" id="hm-why-${id}" autocomplete="off" placeholder="${t.safety ? 'For example: closed today for a private event' : 'For example: the supplier cancelled'}"><span class="err" hidden></span></div>
          ${t.safety
            ? `<p class="hm-warn">${icon('shield')}<span>This is a food safety task. A skip is recorded with your reason and shown above the store.</span></p>`
            : '<p class="hm-hint">The reason is kept with the task.</p>'}
          <div class="hm-notrow"><button type="button" class="m-btn danger" data-act="skip" data-id="${id}">Skip this task</button><button type="button" class="m-btn ghost" data-act="cancelskip" data-id="${id}">Keep the task</button></div>
        </div>
      </div>`
    }
    function taskRow(t) {
      const g = groupOf(t)
      const id = esc(t.id)
      if (g === 'done') return `<div class="hm-item" data-task="${id}"><div class="m-task hm-task done"><span class="m-ico hm-ico-done">${icon('check')}</span><div class="what"><b>${esc(t.title.replace(/ not submitted$/, ''))}</b><span>${esc(t.summary)}</span></div></div></div>`
      if (g === 'skipped') return `<div class="hm-item" data-task="${id}"><div class="m-task hm-task done"><span class="m-ico">${icon('flag')}</span>
        <div class="what"><b>${esc(t.title)}</b><span>Skipped ${NOW} by ${esc(t.by)} · Reason: ${esc(t.reason)}${t.safety ? ' <span class="m-pill now">Shown above the store</span>' : ''}</span></div>
        <div class="hm-acts"><button type="button" class="m-btn" data-act="unskip" data-id="${id}">Bring it back</button></div></div></div>`
      return `<div class="hm-item" data-task="${id}">
        <div class="m-task hm-task">
          <span class="m-ico ${g === 'late' ? 'hm-ico-late' : ''}">${icon(t.icon)}</span>
          <div class="what"><b>${esc(t.title)}</b><span>${esc(subOf(t))}${t.snoozed ? ` <span class="m-pill">Snoozed until ${esc(t.snoozed)}</span>` : ''}</span></div>
          <div class="hm-acts">
            <button type="button" class="m-btn ${g === 'late' || g === 'now' ? 'primary' : ''}" data-act="open" data-id="${id}">${esc(buttonOf(t))}</button>
            <button type="button" class="m-btn hm-more" data-act="more" data-id="${id}" aria-expanded="false" aria-controls="hm-not-${id}" aria-label="Snooze or skip: ${esc(t.title)}">${icon('clock')}${icon('down')}</button>
          </div>
        </div>
        ${notNow(t)}
      </div>`
    }
    function feedCard(vid) {
      const list = state.feeds[vid] || []
      const of = g => list.filter(t => groupOf(t) === g)
      const open = list.filter(t => t.state === 'open').length
      const late = of('late').length
      const groups = [['late', 'Late', 'late', 'Nothing is late.'], ['now', 'Now', 'now', 'Nothing is due now.'], ['next', 'Next', 'info', 'Nothing is coming up.'], ['later', 'Later', '', 'Nothing for later today.'], ['done', 'Done today', 'ok', 'Nothing is done yet today.']]
      if (of('skipped').length) groups.push(['skipped', 'Skipped today', '', ''])
      return `<section class="m-card" id="hm-feed">
        <div class="m-head">${icon('list')}Today at ${esc(VEN[vid].name)}<span class="count" id="hm-feed-count">${open} to do${late ? ' · ' + late + ' late' : ''}</span></div>
        <div>${groups.map(g => {
          const rows = of(g[0])
          return `<div class="hm-group" data-group="${g[0]}">
            <div class="hm-ghead"><span class="m-pill ${g[2]}">${g[1]}</span><b data-count="${g[0]}">${rows.length}</b></div>
            ${rows.length ? `<div class="m-list">${rows.map(taskRow).join('')}</div>` : `<p class="hm-empty">${g[3]}</p>`}
          </div>`
        }).join('')}</div>
      </section>`
    }

    function venuesCard() {
      const rows = ranked()
      const stat = (n, label, kind) => `<div class="hm-stat ${n ? kind : ''}"><b>${n}</b><span>${esc(label)}</span></div>`
      return `<section class="m-card" id="hm-venues">
        <div class="m-head">${icon('store')}Venues, most exceptions first<span class="count">${rows.length} venues</span></div>
        <div class="m-list">${rows.map((r, i) => `
          <div class="hm-venue" data-venue-row="${esc(r.id)}">
            <div class="hm-vname"><span class="hm-rank">${i + 1}</span><div class="what"><b>${esc(r.name)}</b><span>${r.done} of ${r.total} tasks done today</span></div></div>
            <button type="button" class="m-btn" data-act="venue" data-venue="${esc(r.id)}" aria-label="Open the feed for ${esc(r.name)}">Open feed ${icon('right')}</button>
            <div class="hm-stats">
              ${stat(r.late, r.late === 1 ? 'late task' : 'late tasks', 'bad')}
              ${stat(r.missed, 'missed yesterday', 'warn')}
              ${stat(r.cashups, r.cashups === 1 ? 'cash-up not submitted' : 'cash-ups not submitted', 'warn')}
              ${stat(r.orders, r.orders === 1 ? 'order waiting' : 'orders waiting', 'warn')}
            </div>
            ${r.skipped.map(t => `<p class="hm-warn hm-vskip">${icon('flag')}<span>Skipped today: ${esc(t.title)}. Reason: ${esc(t.reason)}</span></p>`).join('')}
          </div>`).join('')}</div>
        <p class="hm-foot">Completion is shown by site, never by person.</p>
      </section>`
    }

    function weekCard(vid) {
      const ids = vid ? [vid] : D.venues.map(v => v.id)
      const days = DAYS.map((d, i) => {
        const booked = ids.reduce((n, id) => n + (extra(id).week[i] || 0), 0)
        const evs = ids.filter(id => extra(id).event && extra(id).event[0] === i).map(id => (vid ? '' : VEN[id].name + ': ') + extra(id).event[1])
        return `<div class="hm-day ${i === 0 ? 'today' : ''}"><b>${d}</b><span class="hm-wx">${WEATHER[i]}</span><span class="num">${booked} booked</span>${evs.map(e => `<span class="hm-ev">${esc(e)}</span>`).join('')}</div>`
      })
      return `<section class="m-card" id="hm-week">
        <div class="m-head">${icon('calendar')}Week ahead${vid ? ' at ' + esc(VEN[vid].name) : ', all venues'}<span class="count">next 7 days</span></div>
        <div class="hm-week"><div class="hm-days">${days.join('')}</div></div>
      </section>`
    }

    function reviewTile(vid) {
      const n = vid ? (VEN[vid].review || 0) : D.venues.reduce((s, v) => s + (v.review || 0), 0)
      const sub = vid
        ? (n ? n + ' waiting at ' + VEN[vid].name + ': ' + extra(vid).review : 'Nothing is waiting at ' + VEN[vid].name)
        : n + ' waiting across ' + D.venues.length + ' venues: ' + D.venues.slice().sort((a, b) => (b.review || 0) - (a.review || 0)).map(v => v.name + ' ' + (v.review || 0)).join(', ')
      return `<section class="m-card" id="hm-review">
        <div class="m-task hm-task">
          <span class="hm-badge" id="hm-review-count">${n}</span>
          <div class="what"><b>For review</b><span>${esc(sub)}</span></div>
          <div class="hm-acts"><button type="button" class="m-btn" data-act="review">Open For review ${icon('right')}</button></div>
        </div>
      </section>`
    }

    function draw() {
      const vid = curVenue()
      main.innerHTML = titleRow() + askBar() + chips() + (vid ? feedCard(vid) : venuesCard()) + weekCard(vid) + reviewTile(vid)
      root.querySelectorAll('#hm-role button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.role === state.role)))
    }
    /** Bring the top of the mock-up back into view after the whole page inside it changed. */
    function toTop() {
      const bar = document.querySelector('.topbar')
      const edge = (bar ? bar.offsetHeight : 0) + 8
      const top = mock.getBoundingClientRect().top
      if (top < edge) window.scrollBy(0, top - edge)
    }

    // ── Sheets ──────────────────────────────────────────────────
    // App.sheet puts its buttons in the first <footer> it finds, so a sheet body here never holds one.
    function openSheet(opts) {
      closeSheets()
      toasts.innerHTML = ''
      const s = App.sheet(mock, opts)
      s.sheet.setAttribute('tabindex', '-1')
      s.sheet.focus({ preventScroll: true })
      // the sheet sticks to the bottom of the window; nudge the page when it still hangs below
      requestAnimationFrame(() => {
        if (!s.sheet.isConnected) return
        const over = s.sheet.getBoundingClientRect().bottom - window.innerHeight
        if (over > 0) window.scrollBy(0, over + 8)
      })
      return s
    }
    function footNote(sheet) {
      const f = sheet.querySelector(':scope > footer')
      const n = el('<span class="hm-footnote" aria-live="polite"></span>')
      f.insertBefore(n, f.firstChild)
      return n
    }
    function finish(t, summary, text) {
      t.state = 'done'; t.summary = summary; t.snoozed = null
      draw()
      toast(text)
    }

    function cashSheet(t) {
      const vname = VEN[curVenue()].name
      const total = t.till.cash + t.till.card
      const tender = (key, label, ico, countLabel) => `
        <div class="m-cardlet">
          <header>${icon(ico)}<span>${label}</span></header>
          <div class="m-pad m-form">
            <div class="hm-till"><span class="m-label">Till takings <span class="m-pill info">from the till</span></span><b class="num">${gbp(t.till[key])}</b></div>
            <div class="m-field" id="hm-cf-${key}"><label for="hm-c-${key}">${countLabel}</label><input class="m-input num" id="hm-c-${key}" inputmode="decimal" autocomplete="off" placeholder="0.00"><span class="err" hidden></span></div>
          </div>
          <div class="hm-var" id="hm-cv-${key}">The variance shows when you type the amount.</div>
        </div>`
      const s = openSheet({
        title: 'Cash-up for ' + t.day + ' · ' + vname,
        body: `<p class="hm-note">The till's takings are already filled in from the till. Count the drawer, read the card machine and type both totals.</p>
          ${tender('cash', 'Cash', 'cash', 'Counted cash (£)')}
          ${tender('card', 'Card', 'tag', 'Card machine total (£)')}
          <div class="hm-sum">
            <div><span>Till takings</span><b class="num">${gbp(total)}</b></div>
            <div><span>Counted</span><b class="num wait" id="hm-c-counted">Not typed yet</b></div>
            <div><span>Variance</span><b class="num wait" id="hm-c-var">Not typed yet</b></div>
          </div>
          <div class="m-field"><label for="hm-c-note">Note for the office (optional)</label><textarea class="m-textarea" id="hm-c-note" placeholder="For example: one refund paid from the drawer"></textarea></div>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Submit cash-up', kind: 'primary', onClick(sheet, close) {
            const cash = parseMoney(inp.cash.value), card = parseMoney(inp.card.value)
            setErr(fld.cash, cash == null ? 'Type the counted cash as pounds and pence, for example 1484.00' : '')
            setErr(fld.card, card == null ? 'Type the card machine total, for example 2310.45' : '')
            if (cash == null || card == null) { (cash == null ? inp.cash : inp.card).focus(); return }
            const counted = cash + card
            close()
            finish(t, 'Counted ' + gbp(counted) + ' against ' + gbp(total) + ' from the till · ' + varWords(counted - total) + ' · submitted ' + NOW + ' by ' + who().name, 'Cash-up for ' + t.dayShort + ' submitted.')
          } },
        ],
      })
      const q = sel => s.sheet.querySelector(sel)
      const inp = { cash: q('#hm-c-cash'), card: q('#hm-c-card') }
      const fld = { cash: q('#hm-cf-cash'), card: q('#hm-cf-card') }
      const note = footNote(s.sheet)
      const pill = v => `<span class="m-pill ${v === 0 ? 'ok' : 'now'}">${esc(cap(varWords(v)))}</span>`
      const update = () => {
        const val = { cash: parseMoney(inp.cash.value), card: parseMoney(inp.card.value) }
        ;['cash', 'card'].forEach(k => {
          if (val[k] != null) setErr(fld[k], '')
          q('#hm-cv-' + k).innerHTML = val[k] == null ? 'The variance shows when you type the amount.' : 'Counted ' + gbp(val[k]) + ' against ' + gbp(t.till[k]) + ' ' + pill(val[k] - t.till[k])
        })
        const both = val.cash != null && val.card != null
        const counted = (val.cash || 0) + (val.card || 0)
        q('#hm-c-counted').textContent = both ? gbp(counted) : 'Not typed yet'
        q('#hm-c-var').textContent = both ? cap(varWords(counted - total)) : 'Not typed yet'
        q('#hm-c-counted').classList.toggle('wait', !both)
        q('#hm-c-var').classList.toggle('wait', !both)
        note.innerHTML = both ? 'Variance: <b class="num">' + esc(varWords(counted - total)) + '</b>' : 'Type both totals to see the variance'
      }
      inp.cash.addEventListener('input', update)
      inp.card.addEventListener('input', update)
      update()
    }

    function fridgeSheet(t) {
      const vname = VEN[curVenue()].name
      const units = extra(curVenue()).units
      const freezer = u => /freezer/i.test(u)
      const s = openSheet({
        title: t.title + ' · ' + vname,
        body: `<p class="hm-note">${esc(vname)} has ${units.length} units at this check. Type each temperature. A fridge must be 8 °C or colder and the freezer \u221218 °C or colder.</p>
          <div>${units.map((u, i) => `
            <div class="hm-unit" data-unit="${i}">
              <div class="hm-uname"><label for="hm-t-${i}">${esc(u)}</label><span>${freezer(u) ? '\u221218 °C or colder' : '8 °C or colder'}</span></div>
              <div class="hm-temp">
                ${freezer(u) ? `<button type="button" class="m-btn hm-sign" data-sign="${i}" aria-pressed="true" aria-label="Below zero">\u2212</button>` : ''}
                <input class="m-input num" id="hm-t-${i}" inputmode="decimal" autocomplete="off" aria-describedby="hm-tb-${i}">
                <span class="hm-deg">°C</span>
                <span class="m-pill" id="hm-tb-${i}">No reading</span>
              </div>
              <div class="m-field hm-fix" id="hm-tf-${i}" hidden><label for="hm-ta-${i}">Corrective action for ${esc(u)}</label>
                <textarea class="m-textarea" id="hm-ta-${i}" placeholder="What did you do? For example: moved the stock to another fridge and called the engineer"></textarea><span class="err" hidden></span></div>
            </div>`).join('')}</div>
          <p class="hm-formerr" id="hm-t-err" role="alert" hidden></p>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Save checks', kind: 'primary', onClick(sheet, close) {
            const rs = units.map((_, i) => read(i))
            let first = null
            rs.forEach((r, i) => {
              const miss = r.v == null
              rows[i].classList.toggle('miss', miss)
              const needs = !miss && r.out && !fix[i].value.trim()
              setErr(fixField[i], needs ? 'Type what you did about it before saving.' : '')
              if (!first && (miss || needs)) first = miss ? temp[i] : fix[i]
            })
            const missing = rs.filter(r => r.v == null).length
            const needFix = rs.filter((r, i) => r.v != null && r.out && !fix[i].value.trim()).length
            err.textContent = missing ? plural(missing, 'unit has', 'units have') + ' no reading yet. Type a temperature for each one.'
              : needFix ? plural(needFix, 'reading is', 'readings are') + ' out of range. Type the corrective action, then save.' : ''
            err.hidden = !err.textContent
            if (first) { first.focus(); return }
            const outs = rs.filter(r => r.out).length
            close()
            finish(t, units.length + ' units logged, ' + (outs ? outs + ' out of range with a corrective action' : 'all in range') + ' · saved ' + NOW + ' by ' + who().name, t.title + ' saved.')
          } },
        ],
      })
      const q = sel => s.sheet.querySelector(sel)
      const rows = units.map((_, i) => q('[data-unit="' + i + '"]'))
      const temp = units.map((_, i) => q('#hm-t-' + i))
      const back = units.map((_, i) => q('#hm-tb-' + i))
      const fixField = units.map((_, i) => q('#hm-tf-' + i))
      const fix = units.map((_, i) => q('#hm-ta-' + i))
      const sign = units.map((_, i) => q('[data-sign="' + i + '"]'))
      const err = q('#hm-t-err')
      const note = footNote(s.sheet)
      const setSign = (i, minus) => { sign[i].setAttribute('aria-pressed', String(minus)); sign[i].textContent = minus ? '\u2212' : '+'; sign[i].setAttribute('aria-label', minus ? 'Below zero' : 'Above zero') }
      function read(i) {
        const raw = temp[i].value.trim()
        if (!raw) return { v: null }
        let v = parseTemp(raw)
        if (v == null) return { v: null, bad: true }
        if (sign[i]) {
          if (/^[-\u2212]/.test(raw)) setSign(i, true)
          else if (sign[i].getAttribute('aria-pressed') === 'true') v = -Math.abs(v)
        }
        return { v, out: freezer(units[i]) ? v > -18 : v > 8 }
      }
      function show(i) {
        const r = read(i)
        back[i].className = 'm-pill' + (r.v == null ? (r.bad ? ' now' : '') : r.out ? ' late' : ' ok')
        back[i].textContent = r.v == null ? (r.bad ? 'Not a number' : 'No reading') : fmtTemp(r.v) + (r.out ? ' out of range' : ' in range')
        rows[i].classList.toggle('out', !!r.out)
        if (r.v != null) rows[i].classList.remove('miss')
        fixField[i].hidden = !r.out
        if (!r.out) setErr(fixField[i], '')
        const typed = units.filter((_, k) => read(k).v != null).length
        note.innerHTML = '<b class="num">' + typed + ' of ' + units.length + '</b> typed'
        err.hidden = true
      }
      units.forEach((_, i) => {
        temp[i].addEventListener('input', () => show(i))
        fix[i].addEventListener('input', () => { if (fix[i].value.trim()) setErr(fixField[i], '') })
        if (sign[i]) sign[i].addEventListener('click', () => { setSign(i, sign[i].getAttribute('aria-pressed') !== 'true'); show(i) })
      })
      show(0)
    }

    function checklistSheet(t) {
      const vname = VEN[curVenue()].name
      const s = openSheet({
        title: t.title + ' · ' + vname,
        body: `<div class="hm-ticks">${CHECKLIST.map((c, i) => `<label class="hm-tick" for="hm-k-${i}"><input type="checkbox" id="hm-k-${i}" ${t.ticks[i] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Save checklist', kind: 'primary', onClick(sheet, close) {
            t.ticks = boxes.map(b => b.checked)
            const n = t.ticks.filter(Boolean).length
            close()
            if (n === t.ticks.length) return finish(t, n + ' of ' + n + ' ticked · saved ' + NOW + ' by ' + who().name, t.title + ' saved. Every line is ticked.')
            draw()
            toast('Checklist saved. ' + (t.ticks.length - n) + ' left to tick.')
          } },
        ],
      })
      const boxes = Array.from(s.sheet.querySelectorAll('.hm-tick input'))
      const note = footNote(s.sheet)
      const update = () => { note.innerHTML = '<b class="num">' + boxes.filter(b => b.checked).length + ' of ' + boxes.length + '</b> ticked' }
      boxes.forEach(b => b.addEventListener('change', update))
      update()
    }

    function targetSheet(t) {
      const vname = VEN[curVenue()].name
      const supplier = t.title.replace(/ (delivery|order cut-off)$/, '')
      const T = {
        delivery: ['Book in the delivery', 'Here the real panel would open: <b>the receiving panel for this order</b>, from the Purchasing page, with the lines ordered from ' + esc(supplier) + '. You would type what arrived and what was short, then save.', 'Today this task links to the Purchasing page. Opening the panel in a sheet from Home is the target.'],
        order: ['Fill the order', 'Here the real panel would open: <b>the order form for ' + esc(supplier) + '</b>, from the Purchasing page, with the order list and its pars. You would check the quantities and place the order before the cut-off.', 'Today the order form is on the Purchasing page. Opening it in a sheet from Home is the target.'],
        rota: ['Open the rota', 'Here the real page would open: <b>the Rota at ' + esc(vname) + '</b> for the week of Monday 23 November, with the unfilled shifts marked.', 'Today the Rota page cannot be opened at a venue and a week from a link. That address is the target.'],
      }[t.form] || ['Open', 'Here the real page for this task would open.', 'This mock-up stops here.']
      openSheet({
        title: T[0] + ' · ' + t.title,
        body: `<p>${T[1]}</p><p class="hm-hint"><span class="m-pill pepper">Target, not built</span> ${T[2]}</p>`,
        actions: [{ label: 'Close', kind: '' }],
      })
    }

    function pinSheet() {
      const mine = state.pins[state.role]
      const s = openSheet({
        title: 'Pin a page',
        body: `<p class="hm-note">Tick the pages you want on your Home, up to twelve. Pins belong to you and follow you to any device. <span class="m-pill pepper">Target, not built</span></p>
          <div class="hm-ticks">${PAGES.map((p, i) => `<label class="hm-tick" for="hm-p-${i}"><input type="checkbox" id="hm-p-${i}" value="${esc(p[0])}" ${mine.indexOf(p[0]) >= 0 ? 'checked' : ''}>${icon(p[1])}<span>${esc(p[0])}</span></label>`).join('')}</div>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Save pins', kind: 'primary', onClick(sheet, close) {
            const picked = boxes.filter(b => b.checked).map(b => b.value)
            // keep the person's order, then add the new ones
            state.pins[state.role] = mine.filter(p => picked.indexOf(p) >= 0).concat(picked.filter(p => mine.indexOf(p) < 0))
            close(); draw(); toast('Pins saved.')
          } },
        ],
      })
      const boxes = Array.from(s.sheet.querySelectorAll('.hm-tick input'))
      const note = footNote(s.sheet)
      const update = () => { note.innerHTML = '<b class="num">' + boxes.filter(b => b.checked).length + ' of 12</b> pinned' }
      boxes.forEach(b => b.addEventListener('change', update))
      update()
    }

    const openTask = t => (({ cashup: cashSheet, fridges: fridgeSheet, checklist: checklistSheet })[t.form] || targetSheet)(t)

    // ── Events ──────────────────────────────────────────────────
    const task = id => (state.feeds[curVenue()] || []).find(t => t.id === id)
    const panel = id => main.querySelector('#hm-not-' + id)
    function closePanels(except) {
      main.querySelectorAll('.hm-not').forEach(p => {
        if (p === except) return
        p.hidden = true
        p.querySelector('.hm-skip').hidden = true
      })
      main.querySelectorAll('[data-act="more"]').forEach(b => b.setAttribute('aria-expanded', String(!!except && b.getAttribute('aria-controls') === except.id && !except.hidden)))
    }
    const toAsk = () => { const i = main.querySelector('#hm-ask-input'); if (i) i.blur(); App.go('ask') }

    main.addEventListener('click', e => {
      const b = e.target.closest('[data-act]')
      if (!b || !main.contains(b)) return
      const act = b.dataset.act
      const t = b.dataset.id ? task(b.dataset.id) : null
      if (act === 'ask') return toAsk()
      if (act === 'review') return App.go('review')
      if (act === 'page') return toast(b.dataset.page + ' would open here' + (curVenue() ? ' at ' + VEN[curVenue()].name : '') + '. That page is outside this mock-up.')
      if (act === 'pinpage') return pinSheet()
      if (act === 'venue') { state.venue = b.dataset.venue; toasts.innerHTML = ''; draw(); return toTop() }
      if (act === 'back') { state.venue = null; toasts.innerHTML = ''; draw(); return toTop() }
      if (!t) return
      if (act === 'open') return openTask(t)
      if (act === 'more') {
        const p = panel(t.id)
        p.hidden = !p.hidden
        if (p.hidden) p.querySelector('.hm-skip').hidden = true
        return closePanels(p)
      }
      if (act === 'snooze') {
        t.snoozed = b.dataset.until
        draw()
        return toast(t.title + ' snoozed until ' + t.snoozed + '.', { undo() { t.snoozed = null; draw() } })
      }
      if (act === 'wake') { t.snoozed = null; draw(); return toast(t.title + ' is back in the list.') }
      if (act === 'askskip') {
        const box = panel(t.id).querySelector('.hm-skip')
        box.hidden = false
        return box.querySelector('input').focus()
      }
      if (act === 'cancelskip') { panel(t.id).hidden = true; panel(t.id).querySelector('.hm-skip').hidden = true; return closePanels(null) }
      if (act === 'skip') {
        const field = main.querySelector('#hm-whyf-' + t.id)
        const why = field.querySelector('input').value.trim()
        setErr(field, why ? '' : 'Type a reason before you skip this task.')
        if (!why) return field.querySelector('input').focus()
        t.state = 'skipped'; t.reason = why; t.by = who().name; t.snoozed = null
        draw()
        return toast(t.safety ? 'Skipped. The reason is recorded and shown above the store.' : 'Skipped. The reason is kept with the task.', { undo() { t.state = 'open'; t.reason = ''; draw() } })
      }
      if (act === 'unskip') { t.state = 'open'; t.reason = ''; draw(); return toast(t.title + ' is back in the list.') }
    })

    // The ask bar is a doorway here: using it opens the ask bar mock-up. Reaching
    // it with the Tab key alone does not, so the keyboard can get past it.
    let tabAt = 0
    document.addEventListener('keydown', e => { if (e.key === 'Tab') tabAt = Date.now() }, true)
    main.addEventListener('focusin', e => { if (e.target.id === 'hm-ask-input' && Date.now() - tabAt > 300) toAsk() })
    main.addEventListener('keydown', e => {
      if (e.target.id !== 'hm-ask-input' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' || e.key === ' ' || e.key.length === 1) { e.preventDefault(); toAsk() }
    })
    mock.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets() })
    mock.querySelectorAll('.m-side [data-nav]').forEach(a => a.addEventListener('click', () => {
      if (a.dataset.nav === 'For review') App.go('review')
      if (a.dataset.nav === 'Pepper') App.go('ask')
    }))

    root.querySelector('#hm-role').addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      closeSheets()
      toasts.innerHTML = ''
      state.role = b.dataset.role
      state.venue = null
      draw()
    })
    root.querySelector('#hm-reset').addEventListener('click', () => {
      closeSheets()
      toasts.innerHTML = ''
      Object.assign(state, seed(), { venue: null })
      draw()
    })

    draw()
  },
})
