// Pepper-first back office mock-ups: the page's core (docs/mockups/pepper-first).
// Views register themselves with App.view(name, def); the tab bar and the
// address (#name) are built from them. Everything here is a mock-up: the
// data below is made up (a group called Thai House), nothing calls a server
// and no AI model runs. What "Pepper" says is scripted.
(function () {
  const views = {}
  const order = []
  const GROUPS = ['The answer', 'Mock-ups', 'Underneath', 'Evidence and plan']

  // ── Icons (inline SVG, 24 box, stroke) ───────────────────────
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sparkles: '<path d="M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7l4.9-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
    undo: '<path d="M4 9h10a5 5 0 0 1 0 10H8"/><path d="m8 5-4 4 4 4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
    thermometer: '<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    store: '<path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
    utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 4-3 7h3v11"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/>',
    flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  }
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.right) + '</svg>'

  // ── Small helpers ────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  /** An element from an HTML string (the first element in it). */
  const el = html => { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild }
  const money = p => '£' + (Number(p || 0) / 100).toFixed(2)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pf_' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
    set(k, v) { try { localStorage.setItem('pf_' + k, JSON.stringify(v)) } catch (e) { /* private mode */ } },
  }

  /**
   * The brief beside a mock-up. All parts optional:
   *   what    one or two sentences (HTML allowed)
   *   tryThis [strings]: things to do in the mock-up
   *   why     [{ text, confidence: 'high' | 'medium' | 'low' }] the evidence
   *   status  [{ text, kind: 'built' | 'target' | 'no' }] what exists today
   *   calls   words on what it costs in model calls
   */
  function brief({ what, tryThis = [], why = [], status = [], calls = null }) {
    const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }
    const KIND = { built: 'Built today', target: 'Target, not built', no: 'Do not build' }
    return '<aside class="brief">' +
      (what ? '<section><h3>What this is</h3><p>' + what + '</p></section>' : '') +
      (tryThis.length ? '<section><h3>Try this</h3><ul class="try">' + tryThis.map(t => '<li>' + t + '</li>').join('') + '</ul></section>' : '') +
      (why.length ? '<section><h3>Why</h3>' + why.map(w => '<p>' + w.text + (w.confidence ? ' <span class="tag ' + w.confidence + '">' + CONF[w.confidence] + '</span>' : '') + '</p>').join('') + '</section>' : '') +
      (status.length ? '<section><h3>Where Macaroonie is</h3>' + status.map(s => '<p><span class="tag ' + s.kind + '">' + KIND[s.kind] + '</span> ' + s.text + '</p>').join('') + '</section>' : '') +
      (calls ? '<section><h3>Model calls</h3><p>' + calls + '</p></section>' : '') +
      '</aside>'
  }

  /** A toast inside a mock-up; undo (optional) is called on Undo. Goes after 5 s. */
  function toast(mock, text, { undo = null, ms = 5000 } = {}) {
    mock.querySelectorAll('.m-toast').forEach(t => t.remove())
    const t = el('<div class="m-toast" role="status"><span>' + esc(text) + '</span>' + (undo ? '<button type="button">Undo</button>' : '') + '</div>')
    if (undo) t.querySelector('button').addEventListener('click', () => { t.remove(); undo() })
    mock.appendChild(t)
    setTimeout(() => t.remove(), ms)
    return t
  }

  /**
   * A form sheet over a mock-up. { title, body (HTML), actions: [{ label,
   * kind: 'primary' | 'ghost' | 'danger' | '', onClick(sheet, close) }] }.
   * Returns { sheet, close }. A tap on the scrim or the X closes it.
   */
  function sheet(mock, { title, body, actions = [] }) {
    const scrim = el('<div class="m-scrim"><div class="m-sheet" role="dialog" aria-label="' + esc(title) + '">' +
      '<header><span style="flex:1;min-width:0">' + esc(title) + '</span><button type="button" class="m-iconbtn" aria-label="Close">' + icon('x') + '</button></header>' +
      '<div class="body">' + body + '</div><footer></footer></div></div>')
    const close = () => scrim.remove()
    const foot = scrim.querySelector('footer')
    actions.forEach(a => {
      const b = el('<button type="button" class="m-btn ' + (a.kind || '') + '">' + esc(a.label) + '</button>')
      b.addEventListener('click', () => a.onClick ? a.onClick(scrim.querySelector('.m-sheet'), close) : close())
      foot.appendChild(b)
    })
    if (!actions.length) foot.remove()
    scrim.addEventListener('click', e => { if (e.target === scrim) close() })
    scrim.querySelector('header .m-iconbtn').addEventListener('click', close)
    ;(mock.querySelector('.mock-body') || mock).appendChild(scrim)
    return { sheet: scrim.querySelector('.m-sheet'), close }
  }

  /** The browser-like bar on top of a desk or tablet mock-up. */
  const mockBar = addr => '<div class="mock-bar"><span class="dots"><i></i><i></i><i></i></span><span class="addr">' + esc(addr) + '</span></div>'

  /** Macaroonie's sidebar, short. on = the label to mark current. */
  function sidebar(on) {
    const items = [['HOME'], ['Home', 'home'], ['Pepper', 'sparkles'], ['For review', 'list'], ['SERVICE'], ['Timeline', 'calendar'], ['Bookings', 'calendar'], ['Online orders', 'box'],
      ['MONEY'], ['Till reports', 'chart'], ['Cash recon', 'cash'], ['PEOPLE'], ['Rota', 'users'], ['SAFETY'], ['Food safety', 'thermometer'], ['Checklists', 'check'], ['STOCK'], ['Purchasing', 'truck'], ['MENUS'], ['Menus', 'utensils']]
    return '<nav class="m-side" aria-label="Menu (mock-up)"><div class="org"><i></i>Thai House</div>' + items.map(i => i.length === 1
      ? '<h4>' + i[0] + '</h4>'
      : '<a href="#" data-nav="' + esc(i[0]) + '" class="' + (i[0] === on ? 'on' : '') + '" onclick="return false">' + icon(i[1]) + esc(i[0]) + '</a>').join('') + '</nav>'
  }

  // ── Made-up data every view shares ───────────────────────────
  const data = {
    group: 'Thai House',
    today: 'Sunday 22 November',
    venues: [
      { id: 'ware', name: 'Ware', late: 2, due: 3, review: 2 },
      { id: 'hertford', name: 'Hertford', late: 0, due: 2, review: 1 },
      { id: 'hitchin', name: 'Hitchin', late: 4, due: 1, review: 3 },
    ],
    people: [
      { id: 'anna', name: 'Anna Novak', role: 'General manager', venue: 'Ware' },
      { id: 'somchai', name: 'Somchai P.', role: 'Head chef', venue: 'Ware' },
      { id: 'mia', name: 'Mia Clarke', role: 'Shift lead', venue: 'Ware' },
      { id: 'tom', name: 'Tom Reid', role: 'Area manager', venue: 'All venues' },
    ],
    dishes: [
      { id: 'padthai', name: 'Pad Thai', price: 1250, section: 'Noodles' },
      { id: 'greencurry', name: 'Green Curry', price: 1350, section: 'Curries' },
      { id: 'seabass', name: 'Steamed Sea Bass', price: 1700, section: 'Mains' },
      { id: 'tomyum', name: 'Tom Yum Soup', price: 750, section: 'Soups' },
      { id: 'springrolls', name: 'Spring Rolls', price: 650, section: 'Starters' },
    ],
    suppliers: [{ id: 'lea', name: 'Lea Valley Produce' }, { id: 'harlow', name: 'Harlow Dairy' }, { id: 'eastbake', name: 'East Bakery' }],
    fridges: ['Walk-in fridge', 'Prep fridge 1', 'Prep fridge 2', 'Bar fridge', 'Freezer'],
    // Today's tasks at Ware (rules and data make these, never the model)
    tasks: [
      { id: 'cashup', when: 'late', icon: 'cash', title: 'Cash-up for Saturday not submitted', sub: 'Ware · due by 10:00', form: 'cashup' },
      { id: 'fridge-am', when: 'late', icon: 'thermometer', title: 'Morning fridge checks', sub: 'Ware · due 09:00 · 5 units', form: 'fridges' },
      { id: 'delivery', when: 'now', icon: 'truck', title: 'Lea Valley Produce delivery', sub: 'Ware · expected 11:00 to 12:00', form: 'delivery' },
      { id: 'opening', when: 'now', icon: 'check', title: 'Opening checklist', sub: 'Ware · 9 of 14 done', form: 'checklist' },
      { id: 'order', when: 'next', icon: 'box', title: 'Harlow Dairy order cut-off', sub: 'Order by 15:00 for Tuesday', form: 'order' },
      { id: 'rota', when: 'next', icon: 'users', title: 'Publish next week\'s rota', sub: 'Ware · 3 shifts unfilled', form: 'rota' },
      { id: 'fridge-pm', when: 'later', icon: 'thermometer', title: 'Evening fridge checks', sub: 'Ware · due 21:00', form: 'fridges' },
    ],
  }

  // ── Views, tabs and the address ──────────────────────────────
  function view(name, def) {
    views[name] = { name, group: GROUPS[1], ...def, rendered: false }
    order.push(name)
  }
  function start() {
    const tabs = document.getElementById('tabs')
    const main = document.getElementById('views')
    GROUPS.forEach(g => {
      const mine = order.filter(n => views[n].group === g)
      if (!mine.length) return
      const grp = el('<div class="grp"><span>' + esc(g) + '</span></div>')
      mine.forEach(n => grp.appendChild(el('<a class="tab" href="#' + n + '" data-tab="' + n + '">' + esc(views[n].label) + '</a>')))
      tabs.appendChild(grp)
    })
    order.forEach(n => main.appendChild(el('<section class="view" id="view-' + n + '" hidden></section>')))
    const show = () => {
      const name = views[location.hash.slice(1)] ? location.hash.slice(1) : order[0]
      order.forEach(n => { document.getElementById('view-' + n).hidden = n !== name })
      tabs.querySelectorAll('.tab').forEach(t => { if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current') })
      const v = views[name]
      if (!v.rendered) {
        v.rendered = true
        const root = document.getElementById('view-' + name)
        try { v.render(root) } catch (err) { root.innerHTML = '<p class="note">This view failed to draw: ' + esc(err.message) + '</p>'; console.error(err) }
      }
      const cur = tabs.querySelector('[aria-current="page"]')
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', show)
    show()
  }

  window.App = { view, start, icon, esc, el, money, store, brief, toast, sheet, mockBar, sidebar, data, go: name => { location.hash = name } }
})()
