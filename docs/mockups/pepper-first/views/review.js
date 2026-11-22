// For review: one page with two tabs. Waiting holds what a person has to
// look at before it takes effect: documents the readers turned into lines,
// supplier orders awaiting approval and Confirm cards nobody answered. Done by
// Pepper is the audit view: who asked, on which device, what was proposed, who
// confirmed, what changed, with Undo where an inverse exists.
// Everything is made-up data held in this file. No model runs: the lines "read
// from the photo" are scripted. Source: reports/AI first back office
// strategy.md ("For review", the invoice flow, decisions 4 and 9).
App.view('review', {
  label: 'For review',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, money } = App
    const D = App.data
    const person = id => D.people.find(p => p.id === id) || D.people[0]
    const supplier = id => (D.suppliers.find(s => s.id === id) || D.suppliers[0]).name
    const dish = id => (D.dishes.find(d => d.id === id) || D.dishes[0]).name
    const me = person('tom'), anna = person('anna'), somchai = person('somchai'), mia = person('mia')
    const V = D.venues.map(v => v.name)
    const ware = V[0], hertford = V[1] || V[0], hitchin = V[2] || V[0]
    const venueName = v => (v === 'all' ? 'All venues' : v)
    const allVenues = V.length > 1 ? V.slice(0, -1).join(', ') + ' and ' + V[V.length - 1] : V[0]
    const bakery = supplier('eastbake'), lea = supplier('lea'), harlow = supplier('harlow')

    // ── Small helpers ───────────────────────────────────────────
    const pence = v => { const t = String(v).trim().replace(',', '.'); const n = Number(t); return t === '' || !isFinite(n) ? NaN : Math.round(n * 100) }
    const whole = v => (/^\d{1,4}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN)
    const plain = p => (p / 100).toFixed(2)
    const diff = (a, b) => '<span class="m-diff"><s>' + esc(a) + '</s>' + icon('right') + '<b>' + esc(b) + '</b></span>'
    const tight = (a, b) => '<span class="m-diff"><s>' + esc(a) + '</s><b>' + esc(b) + '</b></span>' // old then new, for a narrow column
    const pct = (from, to) => (Math.abs(to - from) / from * 100).toFixed(1) + '%'
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
    const pad2 = n => String(n).padStart(2, '0')
    let clock = 10 * 60 + 44 // the example's clock: each decision is a minute later
    const stamp = () => { const t = pad2(Math.floor(clock / 60)) + ':' + pad2(clock % 60); clock += 1; return t }
    const ALLERGENS = ['Celery', 'Peanuts', 'Sesame', 'Soya']
    const UNTIL = { today: 'The end of today', hand: 'Someone turns it back on' }
    const LOCK = { money: 'Money: approved on its own', allergens: 'Allergens: signed off on its own', pay: 'Pay: signed off on its own' }

    // ── Waiting: the example items ──────────────────────────────
    const soldOut = (id, dishId, venue, time, expires) => ({
      id, kind: 'soldout', state: 'waiting', venue, touches: '', noun: 'change', title: 'Mark ' + dish(dishId) + ' sold out at ' + venue,
      dish: dish(dishId), until: 'today',
      from: { icon: 'sparkles', html: 'A Confirm card from Pepper. <b>' + esc(me.name) + '</b> asked on his phone at ' + time + ' and did not answer it.' },
      wait: 'Today this card would have expired at ' + expires + ' and vanished. Here it waits.',
      asked: { who: me.name, device: 'Phone', when: 'Today ' + time },
    })
    const items = [
      {
        id: 'inv', kind: 'invoice', state: 'waiting', venue: ware, touches: 'money', noun: 'invoice', title: 'Invoice from ' + bakery,
        from: { icon: 'camera', html: 'A photo taken by <b>' + esc(mia.name) + '</b> on her phone at 07:52. Pepper\'s invoice reader turned it into the lines beside it.' },
        asked: { who: mia.name, device: 'Phone', when: 'Today 07:52' },
        ref: 'EB-20418', printed: 11380,
        lines: [
          { id: 'roti', name: 'Roti, pack of 10', paper: 'Roti x10', qty: 12, price: 320, was: 320, photo: 12 },
          { id: 'bao', name: 'Bao buns, pack of 12', paper: 'Bao buns x12', qty: 8, price: 410, was: 385, photo: 8 },
          { id: 'pastry', name: 'Spring roll pastry, 50 sheets', paper: 'Spring roll pastry x50', qty: 6, price: 295, was: 295, photo: 8, unsure: true },
          { id: 'sponge', name: 'Pandan sponge, tray', paper: 'Pandan sponge tray', qty: 2, price: 950, was: 900, photo: 2 },
        ],
      },
      {
        id: 'ord', kind: 'order', state: 'waiting', venue: ware, touches: 'money', noun: 'order', title: 'Order to ' + lea,
        from: { icon: 'list', html: 'Built from the ' + esc(lea) + ' order list: each quantity is the par less Saturday night\'s stock count. <b>' + esc(somchai.name) + '</b> asked for it on the kitchen tablet at 08:35.' },
        asked: { who: somchai.name, device: 'Kitchen tablet', when: 'Today 08:35' },
        delivery: 'Tuesday 24 November',
        lines: [
          { id: 'basil', name: 'Thai basil, bunch', why: 'par 12, on hand 4', qty: 8, price: 110 },
          { id: 'limes', name: 'Limes, box of 40', why: 'par 4, on hand 1', qty: 3, price: 950 },
          { id: 'sprouts', name: 'Bean sprouts, 1 kg', why: 'par 10, on hand 2', qty: 8, price: 160 },
          { id: 'onions', name: 'Spring onions, bunch', why: 'par 20, on hand 6', qty: 14, price: 65 },
          { id: 'coriander', name: 'Coriander, bunch', why: 'par 15, on hand 5', qty: 10, price: 80 },
          { id: 'pakchoi', name: 'Pak choi, 5 kg case', why: 'par 6, on hand 2', qty: 4, price: 1120 },
        ],
      },
      {
        id: 'pl', kind: 'pricelist', state: 'waiting', venue: hitchin, touches: 'money', noun: 'price list', title: 'Price list from ' + harlow,
        from: { icon: 'file', html: 'A file, harlow-dairy-prices.pdf, 2 pages, emailed by ' + esc(harlow) + ' to the ' + esc(hitchin) + ' orders inbox at 08:05. Pepper\'s price list reader compared it with the prices on file.' },
        asked: { who: harlow + ', by email', device: hitchin + ' orders inbox', when: 'Today 08:05' },
        read: 38,
        lines: [
          { id: 'milk', name: 'Whole milk 2 L', was: 185, price: 190 },
          { id: 'cream', name: 'Double cream 1 L', was: 390, price: 405 },
          { id: 'butter', name: 'Unsalted butter 250 g', was: 215, price: 205 },
          { id: 'eggs', name: 'Free-range eggs, tray of 30', was: 620, price: 650 },
          { id: 'oat', name: 'Oat milk 1 L', was: 0, price: 165 },
        ],
      },
      soldOut('so1', 'greencurry', hitchin, '09:41', '10:11'),
      soldOut('so2', 'springrolls', hitchin, '09:42', '10:12'),
      {
        id: 'al', kind: 'allergen', state: 'waiting', venue: 'all', touches: 'allergens', noun: 'change', title: 'Add Celery to the allergens of ' + dish('tomyum'),
        dish: dish('tomyum'), base: ['Crustaceans', 'Fish'], adds: ['Celery'],
        from: { icon: 'sparkles', html: 'A Confirm card from Pepper. <b>' + esc(somchai.name) + '</b> asked on the kitchen tablet at ' + esc(ware) + ' at 08:20 and it was not answered.' },
        wait: 'Today this card would have expired at 08:50 and vanished. Here it waits for a named person.',
        asked: { who: somchai.name, device: 'Kitchen tablet, ' + ware, when: 'Today 08:20' },
      },
    ]
    items.forEach(it => (it.lines || []).forEach(l => { l.q0 = l.qty; l.p0 = l.price }))
    const byId = {}
    items.forEach(it => { byId[it.id] = it })
    const total = it => it.lines.reduce((t, l) => t + l.qty * l.price, 0)
    const corrected = it => (it.lines || []).filter(l => l.qty !== l.q0 || l.price !== l.p0).length
    const allergensAfter = it => it.base.concat(it.adds).sort()
    const blocked = it => it.kind === 'invoice' && total(it) !== it.printed
    // Who hears about a rejection: the person who asked. A file that came by email has nobody to tell.
    const told = it => (it.kind === 'pricelist' ? '' : it.asked.who)

    // ── Done by Pepper: rows from before this visit ─────────────
    const done = [
      { id: 'd1', when: 'Today 09:58', who: somchai.name, device: 'Kitchen tablet', venue: ware, proposed: 'Mark ' + dish('tomyum') + ' sold out at ' + ware, by: somchai.name, note: '', changed: esc(dish('tomyum')) + ' at ' + esc(ware) + ': ' + diff('On sale', 'Sold out'), undo: dish('tomyum') + ' is back on sale at ' + ware },
      { id: 'd2', when: 'Today 08:50', who: mia.name, device: 'Phone', venue: ware, proposed: 'Send the order to ' + bakery + ', 12 lines, £86.40', by: mia.name, note: '', changed: 'Purchase order for £86.40 emailed to ' + esc(bakery), undo: 'The ' + bakery + ' order is cancelled and the supplier is told' },
      { id: 'd3', when: 'Yesterday 16:15', who: me.name, device: 'Office desktop', venue: 'all', proposed: 'Change ' + dish('tomyum') + ' from £7.00 to £7.50', by: me.name, note: '', changed: esc(dish('tomyum')) + ' on the Main menu: ' + diff('£7.00', '£7.50'), undo: dish('tomyum') + ' is back at £7.00' },
      { id: 'd4', when: 'Yesterday 11:05', who: mia.name, device: 'Phone', venue: ware, proposed: 'Invoice from ' + lea + ', read from a photo, £148.60', by: anna.name, note: '1 line corrected first', changed: 'Invoice added to Purchasing at ' + esc(ware) + '. 2 supplier prices updated.', undo: 'The invoice is removed and the 2 prices are put back' },
      { id: 'd5', when: 'Yesterday 10:30', who: me.name, device: 'Phone', venue: hertford, proposed: 'Send the Okafor booking its confirmation again', by: me.name, note: '', changed: 'Booking confirmation sent to the guest a second time', undo: '', noUndo: 'an email cannot be unsent' },
      { id: 'd6', when: 'Friday 17:20', who: me.name, device: 'Phone', venue: hitchin, proposed: 'Refund £12.00 on check 0987', by: me.name, note: '', changed: 'Check 0987 at ' + esc(hitchin) + ': ' + diff('£41.50 paid', '£29.50 after the refund'), undo: '', noUndo: 'money sent back to a card cannot be recalled' },
    ]
    done.forEach(r => { r.status = 'done'; r.undone = '' })

    // ── State (this view only) ──────────────────────────────────
    let tab = 'waiting', seq = 0
    const picked = {} // item id: ticked for Approve selected
    const mode = {} // item id: 'edit' | 'reject' | 'sign'
    let fVenue = 'all', fPerson = 'all'

    // ── What each item proposes and what approving it changes ───
    function proposedOf(it) {
      if (it.kind === 'invoice') return 'Invoice ' + it.ref + ' from ' + bakery + ', read from a photo, ' + money(total(it))
      if (it.kind === 'order') return 'Order to ' + lea + ' for ' + it.delivery + ', ' + money(total(it))
      if (it.kind === 'pricelist') return 'Price list from ' + harlow + ': ' + plural(it.lines.filter(l => l.was).length, 'price', 'prices') + ' changed, ' + plural(it.lines.filter(l => !l.was).length, 'new item', 'new items')
      return it.kind === 'allergen' ? 'Add ' + it.adds.join(', ') + ' to the allergens of ' + it.dish : it.title
    }
    function changedOf(it) {
      if (it.kind === 'invoice') {
        const ch = it.lines.filter(l => l.price !== l.was)
        return 'Invoice ' + esc(it.ref) + ' added to Purchasing at ' + esc(it.venue) + '.' + (ch.length ? ' Supplier prices updated: ' + ch.map(l => esc(l.name) + ' ' + diff(money(l.was), money(l.price))).join(', ') + '.' : '')
      }
      if (it.kind === 'order') return 'Purchase order for ' + money(total(it)) + ' emailed to ' + esc(lea) + ' from ' + esc(it.venue)
      if (it.kind === 'pricelist') return it.lines.map(l => esc(l.name) + ' ' + (l.was ? diff(money(l.was), money(l.price)) : 'added at ' + money(l.price))).join(', ')
      if (it.kind === 'soldout') return esc(it.dish) + ' at ' + esc(it.venue) + ': ' + diff('On sale', 'Sold out') + ', until ' + esc(UNTIL[it.until].toLowerCase())
      return esc(it.dish) + ' allergens: ' + diff(it.base.join(', '), allergensAfter(it).join(', '))
    }
    const UNDO = {
      invoice: () => 'The invoice is removed and the supplier prices are put back',
      order: () => 'The order is cancelled and ' + lea + ' is told',
      pricelist: () => 'The old ' + harlow + ' prices are put back',
      soldout: it => it.dish + ' is back on sale at ' + it.venue,
    }

    // ── Drawing an item ─────────────────────────────────────────
    const cell = (label, html) => '<span class="c" data-l="' + label + '">' + html + '</span>'
    const qtyIn = l => '<input class="m-input" data-f="qty" inputmode="numeric" autocomplete="off" value="' + l.qty + '" aria-label="Quantity of ' + esc(l.name) + '">'
    const priceIn = (l, what) => '<input class="m-input" data-f="price" inputmode="decimal" autocomplete="off" value="' + plain(l.price) + '" aria-label="' + what + ' of ' + esc(l.name) + ', in pounds">'
    const lineRow = (l, name, cells, marks) => '<div class="rv-l" data-line="' + l.id + '"><div class="n">' + name + '</div>' + cells + (marks ? '<div class="marks">' + marks + '</div>' : '') + '</div>'
    const head = cols => '<div class="rv-lh">' + cols.map(c => '<span>' + c + '</span>').join('') + '</div>'
    const noteHtml = (kind, ico, text) => '<div class="rv-note ' + kind + '">' + icon(ico) + '<span>' + text + '</span></div>'

    function paperHtml(it) {
      return `
        <figure class="rv-photo">
          <div class="rv-paper">
            <div class="two"><b>${esc(bakery.toUpperCase())}</b><b>INVOICE</b></div>
            <div class="two"><span>4 Mead Lane<br>Hertford</span><span class="r nw">No. ${esc(it.ref)}<br>21 Nov 2026</span></div>
            <div>To: ${esc(D.group)}, ${esc(it.venue)}</div>
            <table>
              <tr><th>Qty</th><th>Item</th><th class="r">Unit</th><th class="r">Total</th></tr>
              ${it.lines.map(l => `<tr><td>${l.unsure ? '<span class="rv-smudge">' + l.photo + '</span>' : l.photo}</td><td>${esc(l.paper)}</td><td class="r">${plain(l.p0)}</td><td class="r">${plain(l.photo * l.p0)}</td></tr>`).join('')}
            </table>
            <div class="two tot"><span>TOTAL GBP</span><span>${plain(it.printed)}</span></div>
            <div class="two"><span>Received by</span><span class="rv-sig">M Clarke</span></div>
          </div>
          <figcaption>The photo, taken on ${esc(mia.name)}'s phone</figcaption>
        </figure>`
    }

    function bodyHtml(it, editing) {
      if (it.kind === 'invoice') {
        const sum = total(it), ch = it.lines.filter(l => l.price !== l.was).length
        return '<div class="rv-doc">' + paperHtml(it) + '<div class="rv-read"><div class="rv-lines">' +
          head(['Read from the photo', 'Qty', 'Unit price', 'Total']) +
          it.lines.map(l => lineRow(l, '<b>' + esc(l.name) + '</b>',
            cell('Qty', editing ? qtyIn(l) : String(l.qty)) +
            cell('Unit price', editing ? priceIn(l, 'Unit price') : l.price !== l.was ? tight(money(l.was), money(l.price)) : money(l.price)) +
            cell('Total', money(l.qty * l.price)),
            (l.unsure && l.qty === l.q0 ? '<span class="m-pill now">Smudged in the photo: check the quantity</span>' : '') +
            (l.price !== l.was ? '<span class="m-pill late">Price ' + (l.price > l.was ? 'up ' : 'down ') + pct(l.was, l.price) + ' since the last invoice</span>' : '') +
            (l.qty !== l.q0 || l.price !== l.p0 ? '<span class="m-pill info">Corrected by ' + esc(me.name) + '</span>' : ''))).join('') +
          '<div class="rv-lt"><span>The lines add up to</span><b>' + money(sum) + '</b></div></div>' +
          (sum === it.printed
            ? noteHtml('ok', 'check', 'The lines add up to the total on the invoice, ' + money(it.printed) + '.')
            : noteHtml('warn', 'alert', 'The lines add up to ' + money(sum) + '. The invoice says ' + money(it.printed) + '. Check the quantities against the photo.')) +
          '<p class="rv-sub">When approved: the invoice is added to Purchasing at ' + esc(it.venue) + (ch ? ' and ' + plural(ch, 'supplier price is', 'supplier prices are') + ' updated' : '') + '.</p></div></div>'
      }
      if (it.kind === 'order') {
        return '<div class="rv-lines">' + head(['Item, and why this quantity', 'Qty', 'Unit price', 'Total']) +
          it.lines.map(l => lineRow(l, '<b>' + esc(l.name) + '</b><small>' + esc(l.why) + '</small>' + (l.qty !== l.q0 ? '<small>' + esc(me.name) + ' changed ' + l.q0 + ' to ' + l.qty + '</small>' : ''),
            cell('Qty', editing ? qtyIn(l) : String(l.qty)) + cell('Unit price', money(l.price)) + cell('Total', money(l.qty * l.price)), '')).join('') +
          '<div class="rv-lt"><span>Order total, for delivery on ' + esc(it.delivery) + '</span><b>' + money(total(it)) + '</b></div></div>' +
          '<p class="rv-sub">When approved: a purchase order is emailed to ' + esc(lea) + ' from ' + esc(it.venue) + '. The quantities come from the pars and the count, never from the model.</p>'
      }
      if (it.kind === 'pricelist') {
        const ch = it.lines.filter(l => l.was).length, nw = it.lines.length - ch
        return '<div class="rv-chips"><span class="m-pill">' + it.read + ' lines read</span><span class="m-pill late">' + plural(ch, 'price', 'prices') + ' changed</span><span class="m-pill info">' + plural(nw, 'new item', 'new items') + '</span><span class="m-pill">' + (it.read - it.lines.length) + ' the same</span></div>' +
          '<div class="rv-lines rv-pl">' + head(['Changed and new lines', 'Was', 'New price', 'Change']) +
          it.lines.map(l => lineRow(l, '<b>' + esc(l.name) + '</b>',
            cell('Was', l.was ? money(l.was) : 'Not listed') +
            cell('New price', editing ? priceIn(l, 'New price') : '<b>' + money(l.price) + '</b>') +
            cell('Change', l.was ? (l.price === l.was ? 'None' : (l.price > l.was ? 'Up ' : 'Down ') + pct(l.was, l.price)) : 'New item'),
            l.price !== l.p0 ? '<span class="m-pill info">Corrected by ' + esc(me.name) + ', read as ' + money(l.p0) + '</span>' : '')).join('') + '</div>' +
          '<p class="rv-sub">When approved: the ' + esc(harlow) + ' prices on file change and the new item is added. Orders placed afterwards use the new prices.</p>'
      }
      const rows = it.kind === 'soldout'
        ? [['Change', esc(it.dish) + ' at ' + esc(it.venue) + ': ' + diff('On sale', 'Sold out')],
          ['Until', editing ? '<select class="m-select" data-f="until" aria-label="Sold out until">' + Object.keys(UNTIL).map(k => '<option value="' + k + '"' + (k === it.until ? ' selected' : '') + '>' + UNTIL[k] + '</option>').join('') + '</select>' : UNTIL[it.until]],
          ['Applies to', 'Till, online ordering, kiosk and menu screens at ' + esc(it.venue)]]
        : [['Change', esc(it.dish) + ' allergens: ' + diff(it.base.join(', '), allergensAfter(it).join(', '))],
          ['Add', editing ? '<div class="rv-boxes">' + ALLERGENS.map(a => '<label><input type="checkbox" data-f="add" value="' + a + '"' + (it.adds.indexOf(a) >= 0 ? ' checked' : '') + '>' + a + '</label>').join('') + '</div>' : it.adds.map(a => '<span class="m-pill late">' + esc(a) + '</span>').join(' ')],
          ['Signed off by', 'Whoever approves it, by name. That is ' + esc(me.name) + ', ' + esc(me.role) + ', if you approve.'],
          ['Applies to', 'Main menu at ' + esc(allVenues) + ': till, online ordering, kiosk, menu screens and the printed allergen sheet']]
      return '<div class="rv-rows">' + rows.map(r => '<div class="rv-row"><span class="k">' + r[0] + '</span><div class="v">' + r[1] + '</div></div>').join('') + '</div>' +
        noteHtml('', 'clock', esc(it.wait))
    }

    function footHtml(it) {
      const m = mode[it.id]
      if (m === 'edit') return '<button type="button" class="m-btn primary" data-act="save">' + icon('check') + 'Save changes</button><button type="button" class="m-btn ghost" data-act="back">Cancel</button><span class="rv-err" role="alert" hidden></span>'
      if (m === 'reject') {
        return '<div class="m-field rv-why"><label for="rv-why-' + it.id + '">Why are you rejecting this ' + it.noun + '? ' + (told(it) ? esc(told(it)) + ' is told.' : 'The reason is kept on the record.') + '</label>' +
          '<textarea class="m-textarea" id="rv-why-' + it.id + '" data-f="why"></textarea><span class="err" role="alert" hidden>Give a reason before you reject it</span></div>' +
          '<button type="button" class="m-btn danger" data-act="reject-go">' + icon('x') + 'Reject ' + it.noun + '</button><button type="button" class="m-btn ghost" data-act="back">Back</button>'
      }
      if (m === 'sign') {
        return '<p class="rv-ask">Sign off as <b>' + esc(me.name) + '</b>, ' + esc(me.role) + '? Your name is kept on the record with this allergen change.</p>' +
          '<button type="button" class="m-btn primary" data-act="approve-go">' + icon('check') + 'Sign off and approve</button><button type="button" class="m-btn ghost" data-act="back">Back</button>'
      }
      const off = blocked(it)
      return '<button type="button" class="m-btn primary" data-act="approve"' + (off ? ' disabled' : '') + '>' + icon('check') + 'Approve ' + it.noun + '</button>' +
        '<button type="button" class="m-btn" data-act="edit">' + icon('edit') + 'Edit</button>' +
        '<button type="button" class="m-btn" data-act="reject">' + icon('x') + 'Reject</button>' +
        (off ? '<span class="rv-sub">Approve is off until the lines add up to the total on the invoice. Tap Edit to correct a line.</span>' : '')
    }

    function itemHtml(it) {
      if (it.state !== 'waiting') {
        const ok = it.state === 'approved'
        return '<div class="m-card rv-strip"><span class="m-ico">' + icon(ok ? 'check' : 'x') + '</span><div class="what"><b>' + (ok ? 'Approved: ' : 'Rejected: ') + esc(it.title) + '</b>' +
          '<span>' + (ok ? 'It has taken effect and is listed under Done by Pepper.' : (told(it) ? esc(told(it)) + ' is told why: ' : 'Nothing changed. The reason is kept: ') + esc(it.reason)) + '</span></div>' +
          '<button type="button" class="m-btn" data-act="show-done">See it in Done by Pepper' + icon('right') + '</button></div>'
      }
      const lock = it.touches
      return '<article class="m-card rv-item" aria-label="' + esc(it.title) + '">' +
        '<div class="m-head"><label class="rv-pick"><input type="checkbox" data-pick="' + it.id + '"' + (picked[it.id] ? ' checked' : '') + (lock ? ' disabled' : '') +
        ' aria-label="' + (lock ? 'Cannot be approved together with others: ' + esc(LOCK[lock]) : 'Approve together with others: ' + esc(it.title)) + '"></label>' +
        '<span class="rv-t">' + esc(it.title) + '</span>' +
        (lock ? '<span class="m-pill now">' + icon('lock') + esc(LOCK[lock]) + '</span>' : '<span class="m-pill ok">Low cost, reversible: can be approved together</span>') +
        '<span class="count">' + esc(venueName(it.venue)) + '</span></div>' +
        '<div class="m-pad"><div class="m-understood">' + icon(it.from.icon) + '<span>' + it.from.html + '</span></div>' + bodyHtml(it, mode[it.id] === 'edit') + '</div>' +
        '<div class="rv-foot">' + footHtml(it) + '</div></article>'
    }

    // ── Drawing Done by Pepper ──────────────────────────────────
    const rowHtml = r => '<div class="rv-arow' + (r.undone ? ' undone' : '') + '" data-row="' + r.id + '">' +
      '<div data-l="Asked by, on"><b>' + esc(r.who) + '</b><small>' + esc(r.device) + ' · ' + esc(venueName(r.venue)) + '</small><small>' + esc(r.when) + '</small></div>' +
      '<div data-l="Proposed">' + esc(r.proposed) + '</div>' +
      '<div data-l="' + (r.status === 'rejected' ? 'Rejected by' : 'Confirmed by') + '">' + (r.status === 'rejected' ? '<span class="m-pill late">Rejected</span>' : '') + '<span>' + esc(r.by) + '</span>' + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</div>' +
      '<div data-l="What changed"><span class="chg">' + r.changed + '</span>' + (r.undone ? '<small>Undone by ' + esc(me.name) + ' at ' + esc(r.undone) + '. ' + esc(r.undo) + '.</small>' : '') + '</div>' +
      '<div class="act">' + (r.undone ? '<span class="m-pill">Undone</span>'
        : r.undo ? '<button type="button" class="m-btn" data-undo="' + r.id + '">' + icon('undo') + 'Undo</button>'
          : '<small>No undo: ' + esc(r.noUndo) + '</small>') + '</div></div>'

    // ── The page ────────────────────────────────────────────────
    const src = (label, url) => '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'
    root.innerHTML = `
      <style>
        #view-review #rv-mock { color-scheme: light; } /* tick boxes and selects stay light, as the mock-up does */
        #view-review .m-main { container-type: inline-size; container-name: rvmain; }
        #view-review .m-main > *, #view-review .rv-panel > * { min-width: 0; }
        #view-review .m-head { flex-wrap: wrap; }
        #view-review .m-head svg, #view-review .m-understood svg, #view-review .m-diff svg, #view-review .rv-note svg { width: 15px; height: 15px; flex: none; }
        #view-review .m-pill { gap: 4px; }
        #view-review .m-pill svg { width: 12px; height: 12px; flex: none; }
        #view-review .m-head .m-pill, #view-review .rv-l .m-pill { white-space: normal; height: auto; min-height: 20px; padding-block: 2px; }
        #view-review .m-understood { align-items: flex-start; flex-wrap: nowrap; }
        #view-review .m-understood svg, #view-review .rv-note svg { margin-top: 2px; }
        #view-review .m-understood > span { min-width: 0; }
        #view-review .m-diff { flex-wrap: wrap; }
        #view-review .rv-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
        #view-review .rv-n { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--m-hover); color: var(--m-ink); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
        #view-review .m-btn.primary .rv-n { background: var(--m-primary-ink); color: var(--m-primary); }
        #view-review .rv-panel, #view-review .rv-list { display: grid; gap: 12px; }
        #view-review .rv-batch { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        #view-review .rv-batch > div { flex: 1 1 240px; min-width: 0; display: grid; gap: 2px; }
        #view-review .rv-sub, #view-review .rv-batch span { font-size: 12.5px; color: var(--m-muted); }
        #view-review .rv-pick { width: 48px; height: 48px; margin: -8px 0 -8px -10px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
        #view-review .rv-pick input, #view-review .rv-boxes input { width: 22px; height: 22px; margin: 0; flex: none; accent-color: var(--m-primary); }
        #view-review .rv-t { flex: 1 1 160px; min-width: 0; font-size: 14px; }
        #view-review .rv-doc { display: grid; gap: 14px; align-items: start; }
        #view-review .rv-read { display: grid; gap: 10px; min-width: 0; }
        #view-review .rv-photo { margin: 0; background: var(--m-bezel); border-radius: 8px; padding: 18px 14px 10px; display: grid; gap: 10px; justify-items: center; overflow: hidden; }
        #view-review .rv-paper { width: 100%; max-width: 252px; background: var(--m-surface); color: var(--m-ink); font-family: var(--font-mono); font-size: 10.5px; line-height: 1.45; padding: 12px 10px 10px; transform: rotate(-1.6deg); box-shadow: 0 6px 16px var(--m-scrim); display: grid; gap: 7px; }
        #view-review .rv-paper .two { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }
        #view-review .rv-paper .r { text-align: right; }
        #view-review .rv-paper .nw { white-space: nowrap; }
        #view-review .rv-paper table { width: 100%; border-collapse: collapse; font: inherit; }
        #view-review .rv-paper th, #view-review .rv-paper td { text-align: left; padding: 2px 3px 2px 0; font-weight: 400; vertical-align: top; }
        #view-review .rv-paper th { border-bottom: 1px solid var(--m-ink); font-weight: 500; }
        #view-review .rv-paper th.r, #view-review .rv-paper td.r { text-align: right; padding: 2px 0 2px 8px; white-space: nowrap; }
        #view-review .rv-paper .tot { border-top: 1px solid var(--m-ink); padding-top: 5px; font-weight: 500; }
        #view-review .rv-smudge { display: inline-block; position: relative; filter: blur(0.5px); }
        #view-review .rv-smudge::after { content: ""; position: absolute; inset: 1px -5px 1px -4px; border-radius: 45%; background: var(--m-muted); opacity: 0.4; filter: blur(1.6px); }
        #view-review .rv-sig { font-family: var(--font-display); font-style: italic; font-size: 13px; transform: rotate(-4deg); }
        #view-review .rv-photo figcaption { color: var(--m-surface); font-size: 11.5px; opacity: 0.85; text-align: center; }
        #view-review .rv-lines { display: grid; min-width: 0; }
        #view-review .rv-lh { display: none; }
        #view-review .rv-l { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; align-items: start; padding: 9px 0; border-top: 1px solid var(--m-line); }
        #view-review .rv-lines > .rv-l:first-of-type { border-top: 0; padding-top: 0; }
        #view-review .rv-l .n, #view-review .rv-l .marks { grid-column: 1 / -1; min-width: 0; }
        #view-review .rv-l .n { display: grid; gap: 1px; }
        #view-review .rv-l .n small { font-size: 12.5px; color: var(--m-muted); }
        #view-review .rv-l .marks { display: flex; flex-wrap: wrap; gap: 6px; }
        #view-review .rv-l .c { min-width: 0; display: grid; gap: 2px; align-content: start; font-variant-numeric: tabular-nums; }
        #view-review .rv-l .c::before { content: attr(data-l); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--m-muted); font-weight: 600; }
        #view-review .rv-l .m-input { padding: 0 8px; }
        #view-review .rv-lt { display: flex; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 2px solid var(--m-line); font-weight: 600; }
        #view-review .rv-lt b { font-variant-numeric: tabular-nums; white-space: nowrap; }
        #view-review .rv-note { display: flex; gap: 8px; align-items: flex-start; padding: 9px 12px; border-radius: 8px; background: var(--m-hover); color: var(--m-muted); font-size: 13px; }
        #view-review .rv-note.warn { background: var(--m-warn-soft); color: var(--m-warn); font-weight: 600; }
        #view-review .rv-note.ok { background: var(--m-good-soft); color: var(--m-good); font-weight: 600; }
        #view-review .rv-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        #view-review .rv-rows { display: grid; }
        #view-review .rv-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 4px 10px; padding: 8px 0; border-top: 1px solid var(--m-line); align-items: center; }
        #view-review .rv-row:first-child { border-top: 0; padding-top: 0; }
        #view-review .rv-row .k { font-size: 12px; font-weight: 600; color: var(--m-muted); }
        #view-review .rv-row .v { min-width: 0; overflow-wrap: anywhere; }
        #view-review .rv-boxes { display: flex; flex-wrap: wrap; gap: 4px 16px; }
        #view-review .rv-boxes label { display: inline-flex; align-items: center; gap: 8px; min-height: 48px; }
        #view-review .rv-foot { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 12px; border-top: 1px solid var(--m-line); background: var(--m-page); }
        #view-review .rv-foot .rv-sub, #view-review .rv-foot .rv-ask, #view-review .rv-foot .rv-why { flex: 1 1 100%; min-width: 0; }
        #view-review .rv-ask { font-size: 13.5px; }
        #view-review .rv-err { flex: 1 1 100%; font-size: 12.5px; font-weight: 600; color: var(--m-bad); }
        #view-review .rv-strip { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; }
        #view-review .rv-strip .what { flex: 1 1 200px; min-width: 0; display: grid; gap: 1px; }
        #view-review .rv-strip .what span { font-size: 12.5px; color: var(--m-muted); overflow-wrap: anywhere; }
        #view-review .rv-empty { padding: 14px 12px; color: var(--m-muted); font-size: 13.5px; }
        #view-review .rv-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 12px; align-items: end; }
        #view-review .rv-ahead { display: none; }
        #view-review .rv-arow { display: grid; gap: 8px; padding: 12px; border-top: 1px solid var(--m-line); align-items: start; }
        #view-review .rv-arow > div { min-width: 0; display: grid; gap: 2px; align-content: start; justify-items: start; font-size: 13.5px; overflow-wrap: anywhere; }
        #view-review .rv-arow > div[data-l]::before { content: attr(data-l); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--m-muted); font-weight: 600; }
        #view-review .rv-arow small { font-size: 12.5px; color: var(--m-muted); }
        #view-review .rv-arow.undone .chg, #view-review .rv-arow.undone .chg b { text-decoration: line-through; color: var(--m-muted); }
        @container rvmain (min-width: 600px) {
          #view-review .rv-doc { grid-template-columns: 236px minmax(0, 1fr); }
          #view-review .rv-lh { display: grid; padding-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--m-muted); font-weight: 600; }
          #view-review .rv-lh, #view-review .rv-l { grid-template-columns: minmax(0, 1fr) 62px 96px 66px; gap: 4px 8px; align-items: center; }
          #view-review .rv-pl .rv-lh, #view-review .rv-pl .rv-l { grid-template-columns: minmax(0, 1fr) 84px 92px 88px; }
          #view-review .rv-lh span + span, #view-review .rv-l .c { text-align: right; }
          #view-review .rv-lines > .rv-l:first-of-type { border-top: 1px solid var(--m-line); padding-top: 9px; }
          #view-review .rv-l .n { grid-column: auto; }
          #view-review .rv-l .c { display: block; }
          #view-review .rv-l .c::before { content: none; }
          #view-review .rv-l .c .m-diff { justify-content: flex-end; gap: 2px 4px; }
          #view-review .rv-l .m-input { text-align: right; }
          #view-review .rv-ahead { display: grid; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--m-muted); font-weight: 600; border-bottom: 1px solid var(--m-line); }
          #view-review .rv-ahead, #view-review .rv-arow { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1.5fr) 96px; gap: 12px; }
          #view-review .rv-arow > div[data-l]::before { content: none; }
          #view-review .rv-ahead + .rv-arow { border-top: 0; }
        }
      </style>
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>For review: where drafts wait and Pepper's changes are listed</h1>
        <p class="lede">One page with two tabs. Waiting holds what a person has to look at before it takes effect. Done by Pepper is the record of what changed, who asked and who confirmed.</p>
      </div>
      <div class="stage">
        ${App.brief({
          what: 'The place where proposals wait for a person, each beside the source it came from, and the list of what Pepper has changed. This is ' + esc(me.name) + '\'s view as ' + esc(me.role.toLowerCase()) + ', across ' + V.length + ' venues.',
          tryThis: [
            'On the invoice, compare the pastry line with the photo. Tap <b>Edit</b>, set its quantity to 8, save, then approve it.',
            'Tick the two sold-out changes and tap <b>Approve selected</b>.',
            'Try to tick the invoice or the allergen change. The header says why each is approved on its own.',
            'Reject the supplier order. It asks for a reason first.',
            'Open <b>Done by Pepper</b>, filter by venue or person, and undo a change.',
          ],
          why: [
            { text: 'A review surface where agents draft and people approve is generally available at ERP vendors (' + src('Microsoft Learn', 'https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/whatsnew/whatsnew-update-29-0') + '). No outcome data has been published.', confidence: 'medium' },
            { text: 'No vendor found lets an agent write business data without a person\'s approval. Vendor practice, security guidance and Macaroonie\'s own design agree on confirming a preview that the system built.', confidence: 'high' },
            { text: 'Practitioner guidance in 2026 converges on friction tiered by consequence, and warns that approving everything turns the system into another approval queue (' + src('Towards AI', 'https://pub.towardsai.net/designing-for-ai-agents-8-ux-patterns-that-build-trust-in-2026-713a0c926933') + ', ' + src('DZone', 'https://dzone.com/articles/human-in-the-loop-approval-enterprise-ai-agents') + '). So low-cost items can be approved together.', confidence: 'medium' },
            { text: 'In one study of 73 people, users handed risky operations to an agent as readily as safe ones (' + src('arXiv 2608.19551', 'https://arxiv.org/pdf/2608.19551') + '). So the page decides what may be approved together.', confidence: 'medium' },
          ],
          status: [
            { kind: 'built', text: '97 change tools sit behind one Confirm card, built from the stored plan.' },
            { kind: 'built', text: 'A card left unanswered expires after 30 minutes and vanishes.' },
            { kind: 'target', text: 'The Waiting list, lines you can edit before approving, the Done by Pepper list and Undo.' },
            { kind: 'target', text: 'A named person signs off allergen data a model read and any change to pay or tips, never in a batch.' },
          ],
          calls: 'None to draw the list or a card. Both are built from stored data. In the product, reading the invoice photo takes one reader call when the photo is taken. Here the lines are scripted.',
        })}
        <div class="stack">
          <div class="mock" id="rv-mock">
            ${App.mockBar('office.macaroonie.com/review')}
            <div class="mock-body">
              ${App.sidebar('For review')}
              <div class="m-main">
                <div class="m-title"><h2>For review</h2><span class="m-pill">${esc(me.name)} · ${esc(me.role)} · ${esc(me.venue)}</span><span class="m-pill info">Example data: ${esc(D.group)}</span></div>
                <div class="rv-tabs" role="tablist" aria-label="For review">
                  <button type="button" class="m-btn primary" role="tab" id="rv-t-waiting" data-tab="waiting" aria-selected="true" aria-controls="rv-p-waiting">Waiting <span class="rv-n" id="rv-n-waiting"></span></button>
                  <button type="button" class="m-btn" role="tab" id="rv-t-done" data-tab="done" aria-selected="false" aria-controls="rv-p-done">Done by Pepper <span class="rv-n" id="rv-n-done"></span></button>
                </div>
                <div class="rv-panel" id="rv-p-waiting" role="tabpanel" aria-labelledby="rv-t-waiting">
                  <div class="m-card"><div class="m-pad rv-batch">
                    <div><b>Approve several together</b><span>Tick low-cost, reversible changes of the same kind. Anything touching money, pay or allergens cannot be ticked: each is approved on its own.</span></div>
                    <button type="button" class="m-btn primary" id="rv-batch" data-act="batch" disabled></button>
                  </div></div>
                  <div class="rv-list" id="rv-list"></div>
                  <p class="rv-empty" id="rv-none" hidden>Nothing is waiting.</p>
                </div>
                <div class="rv-panel" id="rv-p-done" role="tabpanel" aria-labelledby="rv-t-done" hidden>
                  <div class="m-card"><div class="m-pad rv-filters">
                    <div class="m-field"><label for="rv-fv">Venue</label><select class="m-select" id="rv-fv"><option value="all">All venues</option>${V.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('')}</select></div>
                    <div class="m-field"><label for="rv-fp">Person who asked or confirmed</label><select class="m-select" id="rv-fp"><option value="all">Everyone</option>${D.people.map(p => '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>').join('')}</select></div>
                    <p class="rv-sub" id="rv-shown" aria-live="polite"></p>
                  </div></div>
                  <div class="m-card">
                    <div class="m-head">${icon('list')}Done by Pepper<span class="count">Newest first</span></div>
                    <div class="rv-audit" id="rv-audit"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`

    const $ = sel => root.querySelector(sel)
    const mock = $('#rv-mock'), listEl = $('#rv-list'), auditEl = $('#rv-audit'), batchBtn = $('#rv-batch')
    items.forEach(it => { const w = document.createElement('div'); w.dataset.item = it.id; listEl.appendChild(w) })
    const wrapOf = it => listEl.querySelector('[data-item="' + it.id + '"]')

    function drawItem(it) { wrapOf(it).innerHTML = itemHtml(it) }
    function drawCounts() {
      const waiting = items.filter(i => i.state === 'waiting')
      const n = waiting.filter(i => picked[i.id]).length
      $('#rv-n-waiting').textContent = waiting.length
      $('#rv-n-done').textContent = done.length
      $('#rv-none').hidden = waiting.length > 0
      batchBtn.disabled = n === 0
      batchBtn.innerHTML = icon('check') + 'Approve selected' + (n ? ' (' + n + ')' : '')
    }
    function drawDone() {
      const rows = done.filter(r => (fVenue === 'all' || r.venue === fVenue || r.venue === 'all') && (fPerson === 'all' || r.who === fPerson || r.by === fPerson))
      auditEl.innerHTML = '<div class="rv-ahead"><span>Asked by, on</span><span>Proposed</span><span>Confirmed by</span><span>What changed</span><span>Undo</span></div>' +
        (rows.length ? rows.map(rowHtml).join('') : '<p class="rv-empty">Nothing matches these filters.</p>')
      $('#rv-shown').textContent = 'Showing ' + rows.length + ' of ' + done.length + (fVenue === 'all' ? '' : '. Changes to all venues are included.')
    }
    function setTab(next) {
      tab = next
      ;['waiting', 'done'].forEach(t => {
        const on = t === tab, b = $('#rv-t-' + t)
        $('#rv-p-' + t).hidden = !on
        b.setAttribute('aria-selected', String(on))
        b.classList.toggle('primary', on)
      })
      const bar = document.querySelector('.topbar')
      const top = mock.getBoundingClientRect().top, under = (bar ? bar.offsetHeight : 0) + 8
      if (top < 0) window.scrollTo(0, window.scrollY + top - under) // the tabs had scrolled away: bring them back
    }

    // ── Decisions ───────────────────────────────────────────────
    function record(it, extra) {
      const row = Object.assign({ id: 'a' + (++seq), when: 'Today ' + stamp(), who: it.asked.who, device: it.asked.device, venue: it.venue, proposed: proposedOf(it), by: me.name, note: '', status: 'done', undone: '', undo: '', noUndo: '' }, extra)
      done.unshift(row)
      return row
    }
    function approve(it) {
      const n = corrected(it)
      record(it, {
        changed: changedOf(it),
        note: it.kind === 'allergen' ? 'Signed off by name' : n ? plural(n, 'line', 'lines') + ' corrected first' : '',
        undo: UNDO[it.kind] ? UNDO[it.kind](it) : '',
        noUndo: UNDO[it.kind] ? '' : 'changing it back is a new change with its own sign-off',
      })
      it.state = 'approved'
      delete picked[it.id]; delete mode[it.id]
      drawItem(it)
    }
    function save(it, card) {
      const err = card.querySelector('.rv-err')
      const fail = msg => { err.textContent = msg; err.hidden = false }
      if (it.lines) {
        const next = []
        for (let i = 0; i < it.lines.length; i++) {
          const l = it.lines[i], row = card.querySelector('[data-line="' + l.id + '"]')
          const qi = row.querySelector('[data-f="qty"]'), pi = row.querySelector('[data-f="price"]')
          const q = qi ? whole(qi.value) : l.qty, p = pi ? pence(pi.value) : l.price
          if (qi && isNaN(q)) return fail('The quantity of ' + l.name + ' must be a whole number.')
          if (pi && (isNaN(p) || p <= 0)) return fail('The price of ' + l.name + ' must be pounds and pence, such as 4.10.')
          next.push([l, q, p])
        }
        next.forEach(n => { n[0].qty = n[1]; n[0].price = n[2] })
      } else if (it.kind === 'soldout') {
        it.until = card.querySelector('[data-f="until"]').value
      } else {
        const adds = Array.prototype.slice.call(card.querySelectorAll('[data-f="add"]')).filter(b => b.checked).map(b => b.value)
        if (!adds.length) return fail('Tick at least one allergen to add, or reject the change.')
        it.adds = adds
        it.title = 'Add ' + adds.join(', ') + ' to the allergens of ' + it.dish
      }
      delete mode[it.id]
      drawItem(it)
    }

    // ── Events ──────────────────────────────────────────────────
    mock.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]')
      if (t) return setTab(t.dataset.tab)
      const u = e.target.closest('[data-undo]')
      if (u) {
        const r = done.find(x => x.id === u.dataset.undo)
        if (r && r.undo && !r.undone) { r.undone = stamp(); drawDone() }
        return
      }
      const b = e.target.closest('[data-act]')
      if (!b || b.disabled) return
      const act = b.dataset.act
      if (act === 'batch') {
        items.filter(i => i.state === 'waiting' && picked[i.id] && !i.touches).forEach(approve)
        drawCounts(); drawDone()
        return
      }
      if (act === 'show-done') return setTab('done')
      const w = b.closest('[data-item]'), it = w ? byId[w.dataset.item] : null
      if (!it || it.state !== 'waiting') return
      if (act === 'edit' || act === 'reject') { mode[it.id] = act; drawItem(it); const f = w.querySelector(act === 'edit' ? '.m-input, .m-select, [data-f="add"]' : 'textarea'); if (f) f.focus() }
      else if (act === 'back') { delete mode[it.id]; drawItem(it) }
      else if (act === 'save') save(it, w)
      else if (act === 'approve' && it.touches === 'allergens') { mode[it.id] = 'sign'; drawItem(it) }
      else if (act === 'approve' || act === 'approve-go') { if (!blocked(it)) { approve(it); drawCounts(); drawDone() } }
      else if (act === 'reject-go') {
        const why = w.querySelector('[data-f="why"]'), reason = why.value.trim()
        if (!reason) { w.querySelector('.rv-why .err').hidden = false; w.querySelector('.rv-why').classList.add('error'); why.focus(); return }
        record(it, { status: 'rejected', changed: 'Nothing changed. Reason: ' + esc(reason), noUndo: 'nothing was changed' })
        it.state = 'rejected'; it.reason = reason
        delete picked[it.id]; delete mode[it.id]
        drawItem(it); drawCounts(); drawDone()
      }
    })
    mock.addEventListener('change', e => {
      const t = e.target
      if (t.dataset.pick) { const it = byId[t.dataset.pick]; if (it && !it.touches) picked[it.id] = t.checked; drawCounts() }
      else if (t.id === 'rv-fv') { fVenue = t.value; drawDone() }
      else if (t.id === 'rv-fp') { fPerson = t.value; drawDone() }
    })

    items.forEach(drawItem)
    drawCounts()
    drawDone()
  },
})
