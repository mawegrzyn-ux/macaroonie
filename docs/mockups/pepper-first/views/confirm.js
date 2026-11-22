// The Confirm card: the one card Pepper shows before it changes anything.
// Each example action below declares its class, the permission it needs, its
// preconditions with a plain message each, an idempotency key and an inverse.
// The card, the entry under Done by Pepper and the refusal are all drawn from
// that declaration. Friction follows the class: reads run and are logged,
// reversible changes take one tap (or Done, with Undo where a group chooses
// it), consequential changes show before and after and wait, destructive or
// personal changes also need a typed word and can never be confirmed by voice.
// Nothing here calls a model. Source: reports/AI first back office strategy.md
// ("The Confirm card", decisions 4 and 9).
App.view('confirm', {
  label: 'Confirm card',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, money } = App
    const D = App.data
    const person = id => D.people.find(p => p.id === id) || D.people[0]
    const dish = id => D.dishes.find(d => d.id === id) || D.dishes[0]
    const supplier = id => (D.suppliers.find(s => s.id === id) || D.suppliers[0]).name
    const me = person('anna'), mia = person('mia'), somchai = person('somchai'), tom = person('tom')
    const first = p => p.name.split(' ')[0]
    const ware = D.venues[0].name
    const names = D.venues.map(v => v.name)
    const allVenues = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]
    const harlow = supplier('harlow'), bakery = supplier('eastbake')
    const padthai = dish('padthai'), seabass = dish('seabass'), curry = dish('greencurry'), tomyum = dish('tomyum')

    // ── Small helpers ───────────────────────────────────────────
    const pence = v => { const t = String(v).trim().replace(',', '.'); const n = Number(t); return t === '' || !isFinite(n) ? NaN : Math.round(n * 100) }
    const whole = v => (/^\d{1,4}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN)
    const gbp = p => (isNaN(p) ? 'no amount' : money(p))
    const plain = p => (isNaN(p) ? 'not a number' : (p / 100).toFixed(2))
    const diff = (a, b) => '<span class="m-diff"><s>' + esc(a) + '</s>' + icon('right') + '<b>' + esc(b) + '</b></span>'
    const pct = (from, to) => (Math.abs(to - from) / from * 100).toFixed(1) + '%'
    const pad2 = n => String(n).padStart(2, '0')
    let clock = 10 * 60 + 42 // the example's clock: each change is a minute later
    const nowText = () => pad2(Math.floor(clock / 60)) + ':' + pad2(clock % 60)
    const stamp = () => { const t = nowText(); clock += 1; return t }

    // ── The four declared classes ───────────────────────────────
    const CLASSES = {
      1: { key: 'read', name: 'Reads', rule: 'Run and logged. No card.', tag: '', pill: '', confirmation: 'none: it runs, shows the result and is logged' },
      2: { key: 'reversible', name: 'Reversible and low cost', rule: 'The card and one tap. A group can choose Done, with Undo.', tag: 'built', pill: 'ok', confirmation: 'the card and one tap; a group may allow Done, with Undo' },
      3: { key: 'consequential', name: 'Consequential', rule: 'Before and after on the card. Always waits for a tap.', tag: 'low', pill: 'now', confirmation: 'the card with before and after; always waits for a tap' },
      4: { key: 'destructive or personal', name: 'Destructive or personal', rule: 'A typed word as well as a tap. Never by voice.', tag: 'no', pill: 'late', confirmation: 'the card, a typed word, then a tap; never by voice' },
    }

    // ── The example actions, as declared data ───────────────────
    const ORDER = [
      { id: 'milk', name: 'Whole milk 2 L', on: 4, qty: 12, price: 185 },
      { id: 'cream', name: 'Double cream 1 L', on: 2, qty: 6, price: 390 },
      { id: 'butter', name: 'Unsalted butter 250 g', on: 10, qty: 20, price: 215 },
      { id: 'eggs', name: 'Free-range eggs, tray of 30', on: 2, qty: 8, price: 620 },
      { id: 'yoghurt', name: 'Coconut yoghurt 1 kg', on: 2, qty: 10, price: 460 },
    ]
    const ORDER_SUM = ORDER.reduce((t, l) => t + l.qty * l.price, 0) // 18420
    const ORDER_MIN = 5000
    const orderTotal = s => ORDER.reduce((t, l) => t + whole(s.vals[l.id]) * l.price, 0)
    const PAID = 5840 // check 1042
    const RATE = 1310, HOURS = 32 // Mia's rate and her hours on next week's rota
    const signRow = { k: 'Signed off by', v: '<b>' + esc(me.name) + '</b>, ' + esc(me.role) + '<small>Her name is kept on the record with this change</small>' }

    const ACTIONS = [
      {
        id: 'sales', cls: 1, label: 'Show Friday\'s sales at ' + ware, said: 'Show Friday\'s sales at ' + ware,
        title: 'Sales for a day', tool: 'ask_data', needs: 'Till reports, view',
        understood: ['Net sales', ware, 'Friday 20 November'],
        inputs: () => [['measure', 'net sales'], ['venue', ware], ['day', '2026-11-20']],
        pre: [{ rule: 'the person can see this venue\'s sales', msg: () => 'You do not have access to sales at ' + ware, ok: () => true }],
        key: () => 'none: a read changes nothing',
        inverse: null, noInverse: 'there is nothing to reverse',
      },
      {
        id: 'soldout', cls: 2, label: 'Mark ' + seabass.name + ' sold out', said: 'Sold out of sea bass',
        title: 'Mark a dish sold out', tool: 'set_sold_out', needs: 'Online orders, manage',
        understood: [seabass.name, ware, 'today'],
        inputs: () => [['venue', ware], ['dish', seabass.name], ['sold_out', 'yes'], ['until', 'end of today']],
        rows: () => [
          { k: 'Dish', v: '<b>' + esc(seabass.name) + '</b><small>' + esc(seabass.section) + ' · ' + money(seabass.price) + '</small>' },
          { k: 'Change', v: diff('On sale', 'Sold out') },
          { k: 'Until', v: 'The end of today' },
          { k: 'Applies to', v: 'Till, online ordering, kiosk and menu screens at ' + esc(ware) },
        ],
        go: () => 'Confirm sold out',
        pre: [{ rule: 'the dish is on a menu that is live at the venue', msg: () => seabass.name + ' is not on a live menu at ' + ware + ', so there is nothing to mark sold out', ok: () => true }],
        key: () => 'ware / steamed sea bass / sold out / 2026-11-22',
        inverse: { text: 'set_sold_out, back on sale', undone: () => seabass.name + ' is back on sale at ' + ware },
        done: () => 'Marked ' + seabass.name + ' sold out at ' + ware,
      },
      {
        id: 'tick', cls: 2, label: 'Tick the morning fridge check', said: 'Tick the morning fridge check',
        title: 'Tick a checklist item', tool: 'tick_checklist', needs: 'Checklists, use', voice: 'check',
        understood: ['Opening checklist', ware, D.today, 'Morning fridge check'],
        inputs: () => [['venue', ware], ['checklist', 'Opening checklist'], ['day', '2026-11-22'], ['item', 'Morning fridge check']],
        rows: () => [
          { k: 'Checklist', v: '<b>Opening checklist</b><small>' + esc(ware) + ' · ' + esc(D.today) + '</small>' },
          { k: 'Item', v: 'Morning fridge check' },
          { k: 'Change', v: diff('Not ticked', 'Ticked by ' + me.name) },
          { k: 'Progress', v: diff('9 of 14 done', '10 of 14 done') },
          { k: 'Applies to', v: 'Today\'s opening checklist at ' + esc(ware) + '<small>Pepper ticks the item. The temperatures are typed by a person on the fridge check form.</small>' },
        ],
        go: () => 'Confirm tick',
        pre: [
          { rule: 'today\'s checklist is still open', msg: () => 'Today\'s opening checklist at ' + ware + ' is closed. A manager can reopen it.', ok: () => true },
          { rule: 'the item is not ticked yet', msg: () => 'The morning fridge check is already ticked', ok: () => true },
        ],
        key: () => 'ware / opening checklist / 2026-11-22 / morning fridge check',
        inverse: { text: 'tick_checklist, tick taken off', undone: () => 'The morning fridge check is not ticked' },
        done: () => 'Ticked the morning fridge check on the opening checklist at ' + ware,
      },
      {
        id: 'resend', cls: 2, label: 'Re-send a booking email', said: 'Send the Patel booking its confirmation again',
        title: 'Send a booking email again', tool: 'resend_booking_email', needs: 'Bookings, use',
        understood: ['Booking for R. Patel', '6 guests', 'Friday 27 November, 19:30', ware],
        inputs: () => [['booking', 'R. Patel, 27 Nov 19:30'], ['email', 'booking confirmation']],
        rows: () => [
          { k: 'Booking', v: '<b>R. Patel</b>, 6 guests<small>Friday 27 November at 19:30 · ' + esc(ware) + '</small>' },
          { k: 'Email', v: 'Booking confirmation<small>First sent on Thursday 19 November</small>' },
          { k: 'To', v: 'r.patel@example.com' },
          { k: 'Change', v: diff('Sent once', 'Sent twice') },
          { k: 'Applies to', v: 'One email to the guest. The booking itself does not change.' },
        ],
        go: () => 'Confirm send',
        pre: [
          { rule: 'the booking has an email address', msg: () => 'This booking has no email address. Add one first.', ok: () => true },
          { rule: 'the booking is not cancelled', msg: () => 'This booking is cancelled, so no email was sent', ok: () => true },
        ],
        key: () => 'booking r. patel 27 nov / confirmation / ' + nowText(),
        inverse: { text: 'cancel the email while it is queued, 10 seconds', undone: () => 'The email was stopped before it left', seconds: 10 },
        done: () => 'Sent the booking confirmation to R. Patel again',
      },
      {
        id: 'price', cls: 3, label: 'Change ' + padthai.name + ' from ' + plain(padthai.price) + ' to 13.00', said: 'Put ' + padthai.name + ' up to 13 pounds',
        title: 'Change a dish price', tool: 'change_prices', needs: 'Menus, manage', live: true,
        understood: [padthai.name, 'Main menu', 'all ' + names.length + ' venues'],
        vals: { price: '13.00' },
        inputs: s => [['menu', 'Main menu'], ['dish', padthai.name], ['price', plain(pence(s.vals.price))]],
        rows: () => [
          { k: 'Dish', v: '<b>' + esc(padthai.name) + '</b><small>' + esc(padthai.section) + ' · Main menu</small>' },
          { k: 'Price', out: 'diff' },
          { k: 'New price', edit: { name: 'price', unit: '£', mode: 'decimal', label: 'New price in pounds' } },
          { k: 'Applies to', v: 'The draft Main menu at ' + esc(allVenues) + '<small>Guests see it on the till, online ordering, kiosk and menu screens after the next publish</small>' },
        ],
        outs: s => {
          const p = pence(s.vals.price), ok = p > 0
          return {
            diff: diff(money(padthai.price), ok ? money(p) : 'no price') + (ok && p !== padthai.price ? '<small>' + (p > padthai.price ? 'Up ' : 'Down ') + money(Math.abs(p - padthai.price)) + ', ' + pct(padthai.price, p) + '</small>' : ''),
            go: 'Confirm price' + (ok ? ', ' + money(p) : ''),
          }
        },
        go: () => 'Confirm price',
        pre: [
          { rule: 'the new price is more than £0.00', msg: () => 'A price must be more than £0.00', ok: s => pence(s.vals.price) > 0 },
          { rule: 'the new price is different from the current one', msg: () => padthai.name + ' is already ' + money(padthai.price) + ', so there is nothing to change', ok: s => pence(s.vals.price) !== padthai.price },
          { rule: 'the group has not locked the price', msg: () => 'The price of ' + padthai.name + ' is locked by the group. Ask ' + tom.name + ' to change it for every venue.', ok: () => true },
        ],
        key: s => 'main menu / pad thai / ' + plain(pence(s.vals.price)),
        inverse: { text: 'change_prices, back to ' + plain(padthai.price), undone: () => padthai.name + ' is back at ' + money(padthai.price) },
        done: s => 'Changed ' + padthai.name + ' from ' + money(padthai.price) + ' to ' + gbp(pence(s.vals.price)) + ' on the Main menu',
      },
      {
        id: 'order', cls: 3, label: 'Place the ' + harlow + ' order, ' + plain(ORDER_SUM), said: 'Place the ' + harlow + ' order',
        title: 'Place a supplier order', tool: 'place_order', needs: 'Purchasing, manage', live: true,
        understood: [harlow, ware, 'delivery on Tuesday 24 November'],
        vals: ORDER.reduce((o, l) => { o[l.id] = String(l.qty); return o }, {}),
        inputs: s => [['venue', ware], ['supplier', harlow], ['delivery', '2026-11-24'], ['lines', ORDER.map(l => l.id + ' ' + (isNaN(whole(s.vals[l.id])) ? '?' : whole(s.vals[l.id]))).join(', ')]],
        rows: () => [
          { k: 'Supplier', v: '<b>' + esc(harlow) + '</b>' },
          { k: 'Delivery', v: 'Tuesday 24 November<small>Their cut-off is today at 15:00</small>' },
          { lines: true },
          { k: 'Total', out: 'total' },
          { k: 'Applies to', v: 'A purchase order emailed to ' + esc(harlow) + ' from ' + esc(ware) },
        ],
        outs: s => {
          const o = {}
          ORDER.forEach(l => {
            const q = whole(s.vals[l.id])
            o['on-' + l.id] = isNaN(q) ? 'On hand ' + l.on : 'On hand ' + diff(String(l.on), String(l.on + q))
            o['lt-' + l.id] = isNaN(q) ? '' : money(q * l.price)
          })
          const t = orderTotal(s)
          o.total = isNaN(t) ? 'Check the quantities' : t === ORDER_SUM ? '<b>' + money(t) + '</b>' : diff(money(ORDER_SUM), money(t)) + '<small>Suggested total, then yours</small>'
          o.go = 'Confirm order' + (isNaN(t) ? '' : ', ' + money(t))
          return o
        },
        go: () => 'Confirm order',
        pre: [
          { rule: 'every quantity is a whole number', msg: () => 'Quantities must be whole numbers', ok: s => !isNaN(orderTotal(s)) },
          { rule: 'the order meets the supplier\'s minimum of ' + money(ORDER_MIN), msg: () => harlow + '\'s minimum order is ' + money(ORDER_MIN) + '. Add items or wait for the next order.', ok: s => isNaN(orderTotal(s)) || orderTotal(s) >= ORDER_MIN },
          { rule: 'the cut-off for the delivery day has not passed', msg: () => 'The cut-off for Tuesday was 15:00. Choose the next delivery day.', ok: () => true },
        ],
        key: () => 'ware / harlow dairy / 2026-11-24',
        inverse: { text: 'cancel_purchase_order, until the cut-off at 15:00', undone: () => 'The ' + harlow + ' order is cancelled' },
        done: s => 'Placed the ' + harlow + ' order, ' + gbp(orderTotal(s)) + ', for Tuesday 24 November',
      },
      {
        id: 'rota', cls: 3, label: 'Publish next week\'s rota at ' + ware, said: 'Publish next week\'s rota at ' + ware,
        title: 'Publish a rota week', tool: 'publish_rota_week', needs: 'Rota, manage',
        understood: ['Rota', ware, 'week of Monday 23 November'],
        inputs: () => [['venue', ware], ['week', '2026-11-23']],
        rows: () => [
          { k: 'Week', v: '<b>Monday 23 to Sunday 29 November</b><small>' + esc(ware) + '</small>' },
          { k: 'Change', v: diff('Draft', 'Published') },
          { k: 'Shifts', v: '38 in the week: 35 filled, 3 unfilled<small>Tuesday 17:00 to 22:00, kitchen porter</small><small>Friday 17:00 to 23:00, front of house</small><small>Saturday 11:00 to 16:00, line cook</small>' },
          { k: 'Applies to', v: '11 staff at ' + esc(ware) + ' are sent their shifts' },
        ],
        go: () => 'Confirm publish',
        fix: { label: 'Open the rota at ' + ware, note: 'In the product this opens the rota at ' + ware + ' for the week of 23 November.' },
        pre: [
          { rule: 'every shift is filled or marked open', msg: () => '3 shifts are unfilled: fill them or mark them open first', ok: () => false },
          { rule: 'the week has not started', msg: () => 'That week has started. Change single shifts instead.', ok: () => true },
        ],
        key: () => 'ware / rota / week of 2026-11-23',
        inverse: { text: 'unpublish_rota_week, staff are told it changed', undone: () => 'The rota for that week is a draft again' },
        done: () => 'Published the rota at ' + ware + ' for the week of 23 November',
      },
      {
        id: 'refund', cls: 3, label: 'Refund 23.50 on check 1042', said: 'Refund 23.50 on check 1042',
        title: 'Refund part of a check', tool: 'refund_check', needs: 'Till, manage', live: true,
        understood: ['Check 1042', ware, 'Saturday 21 November, 19:42', 'table 12'],
        vals: { amount: '23.50' },
        inputs: s => [['check', '1042'], ['amount', plain(pence(s.vals.amount))], ['to', 'the card that paid']],
        rows: () => [
          { k: 'Check', v: '<b>1042</b>, table 12<small>Saturday 21 November at 19:42 · ' + esc(ware) + '</small>' },
          { k: 'Paid', v: money(PAID) + ' by card ending 4421' },
          { k: 'Refund', edit: { name: 'amount', unit: '£', mode: 'decimal', label: 'Refund in pounds' } },
          { k: 'Left on the check', out: 'left' },
          { k: 'Applies to', v: 'Back to the card that paid<small>Shows on Saturday\'s till report and cash-up at ' + esc(ware) + '</small>' },
        ],
        outs: s => {
          const r = pence(s.vals.amount), ok = r > 0 && r <= PAID
          return { left: ok ? diff(money(PAID), money(PAID - r)) : money(PAID), go: 'Confirm refund' + (ok ? ', ' + money(r) : '') }
        },
        go: () => 'Confirm refund',
        pre: [
          { rule: 'the refund is more than £0.00', msg: () => 'A refund must be more than £0.00', ok: s => pence(s.vals.amount) > 0 },
          { rule: 'the refund is no more than was paid', msg: () => 'Check 1042 was paid ' + money(PAID) + '. A refund cannot be more than that.', ok: s => !(pence(s.vals.amount) > PAID) },
          { rule: 'the check is paid and closed', msg: () => 'Check 1042 is still open. Take the dish off the check instead.', ok: () => true },
        ],
        key: s => 'check 1042 / refund / ' + plain(pence(s.vals.amount)),
        inverse: null, noInverse: 'money sent back to a card cannot be recalled',
        done: s => 'Refunded ' + gbp(pence(s.vals.amount)) + ' on check 1042 at ' + ware,
      },
      {
        id: 'delete', cls: 4, label: 'Delete a customer', said: 'Delete James Whitlock from our customers',
        title: 'Delete a customer', tool: 'delete_customer', needs: 'Customers, manage', word: 'DELETE', danger: true,
        understood: ['James Whitlock', 'j.whitlock@example.com', '14 bookings since March 2025'],
        inputs: () => [['customer', 'James Whitlock']],
        rows: () => [
          { k: 'Customer', v: '<b>James Whitlock</b><small>j.whitlock@example.com</small>' },
          { k: 'Change', v: diff('On the customer list', 'Deleted') },
          { k: 'Removed for good', v: 'Name, email, phone, notes and loyalty card with 320 points' },
          { k: 'Kept without a name', v: '14 past bookings, so the figures stay right' },
          { k: 'Applies to', v: 'The customer list, loyalty and email lists at ' + esc(allVenues) + '<small>This cannot be undone</small>' },
        ],
        go: () => 'Confirm delete',
        pre: [{ rule: 'the customer has no booking still to come', msg: () => 'James Whitlock has a booking still to come. Cancel or move it first.', ok: () => true }],
        key: () => 'customer james whitlock / delete',
        inverse: null, noInverse: 'a deleted customer cannot be brought back',
        done: () => 'Deleted the customer James Whitlock',
      },
      {
        id: 'pay', cls: 4, label: 'Change ' + first(mia) + '\'s hourly rate', said: 'Put ' + first(mia) + ' up to 13.60 an hour from Monday',
        title: 'Change an hourly rate', tool: 'set_pay_rate', needs: 'Rota, manage, with pay', word: 'PAY', signoff: true, live: true,
        understood: [mia.name, mia.role, mia.venue],
        vals: { rate: '13.60' },
        inputs: s => [['staff', mia.name], ['hourly_rate', plain(pence(s.vals.rate))], ['from', '2026-11-23']],
        rows: () => [
          { k: 'Staff member', v: '<b>' + esc(mia.name) + '</b><small>' + esc(mia.role) + ' · ' + esc(mia.venue) + '</small>' },
          { k: 'Hourly rate', out: 'rate' },
          { k: 'New rate', edit: { name: 'rate', unit: '£', mode: 'decimal', label: 'New hourly rate in pounds' } },
          { k: 'From', v: 'Monday 23 November' },
          { k: 'Next week\'s pay', out: 'week' },
          signRow,
          { k: 'Applies to', v: 'Rota pay and wages at ' + esc(mia.venue) + ' from that day' },
        ],
        outs: s => {
          const p = pence(s.vals.rate), ok = p > 0
          return {
            rate: diff(money(RATE), ok ? money(p) : 'no rate'),
            week: (ok ? diff(money(RATE * HOURS), money(p * HOURS)) : money(RATE * HOURS)) + '<small>' + HOURS + ' hours on next week\'s rota</small>',
          }
        },
        go: () => 'Confirm pay change',
        pre: [
          { rule: 'the new rate is more than £0.00', msg: () => 'An hourly rate must be more than £0.00', ok: s => pence(s.vals.rate) > 0 },
          { rule: 'the new rate is different from the current one', msg: () => first(mia) + ' is already on ' + money(RATE) + ' an hour, so there is nothing to change', ok: s => pence(s.vals.rate) !== RATE },
          { rule: 'the person asking can see pay at this venue', msg: () => 'You do not have access to pay at ' + mia.venue, ok: () => true },
        ],
        key: s => 'mia clarke / hourly rate / ' + plain(pence(s.vals.rate)) + ' / 2026-11-23',
        inverse: null, noInverse: 'changing it back is a new change with its own sign-off',
        done: s => 'Changed ' + mia.name + '\'s hourly rate from ' + money(RATE) + ' to ' + gbp(pence(s.vals.rate)) + ' from Monday 23 November',
      },
      {
        id: 'allergens', cls: 4, label: 'Edit the allergens of ' + curry.name, said: 'Add peanuts to the allergens on ' + curry.name,
        title: 'Change a dish\'s allergens', tool: 'update_dish_allergens', needs: 'Menus, manage, with allergen sign-off', word: 'ALLERGENS', signoff: true,
        understood: [curry.name, 'Main menu', 'all ' + names.length + ' venues'],
        inputs: () => [['menu', 'Main menu'], ['dish', curry.name], ['add', 'Peanuts']],
        rows: () => [
          { k: 'Dish', v: '<b>' + esc(curry.name) + '</b><small>' + esc(curry.section) + ' · Main menu</small>' },
          { k: 'Allergens', v: diff('Crustaceans, Fish', 'Crustaceans, Fish, Peanuts') },
          { k: 'Added', v: '<span class="m-pill late">Peanuts</span>' },
          signRow,
          { k: 'Applies to', v: 'Till, online ordering, kiosk and menu screens at ' + esc(allVenues) + '<small>The printed allergen sheet needs printing again</small>' },
        ],
        go: () => 'Confirm allergens',
        pre: [
          { rule: 'the person asking holds allergen sign-off', msg: () => 'Allergen changes need someone with allergen sign-off. Ask ' + somchai.name + ' or ' + tom.name + '.', ok: () => true },
          { rule: 'the menu is not being published', msg: () => 'Main menu is being published right now. Try again in a minute.', ok: () => true },
        ],
        key: () => 'main menu / green curry / allergens / +peanuts',
        inverse: null, noInverse: 'changing it back is a new change with its own sign-off',
        done: () => 'Added Peanuts to the allergens of ' + curry.name,
      },
    ]
    const byId = {}
    ACTIONS.forEach(a => { byId[a.id] = a })

    // ── State (this view only) ──────────────────────────────────
    let cur = 'order'
    let seq = 0
    let showAll = false // the list under the card shows the latest five until asked for more
    const SHORT = 5
    const st = {} // per action: where its card is and what was typed on it
    const allow = {} // per action: has the group switched on Done, with Undo
    const fresh = a => ({ phase: 'ask', vals: Object.assign({}, a.vals || {}), typed: '', entry: '', at: '', how: '' })
    const state = id => st[id] || (st[id] = fresh(byId[id]))
    const log = [ // Done by Pepper, newest first; two entries from earlier today
      { id: 'e-b', actionId: '', who: somchai.name, what: 'Marked ' + tomyum.name + ' sold out at ' + ware, when: '09:58', how: 'confirmed on the card', undo: tomyum.name + ' is back on sale at ' + ware, noUndo: '', until: 0, undone: '' },
      { id: 'e-a', actionId: '', who: mia.name, what: 'Sent the order to ' + bakery + ', 12 lines, £86.40', when: '08:50', how: 'confirmed on the card', undo: 'The ' + bakery + ' order is cancelled', noUndo: '', until: 0, undone: '' },
    ]
    const failed = (a, s) => a.pre.filter(p => !p.ok(s))
    const wordOk = (a, s) => !a.word || s.typed.trim().toUpperCase() === a.word
    const canUndo = e => !!e.undo && !e.undone && (!e.until || Date.now() < e.until)
    const voiceWhy = a => a.cls === 4 ? 'This can never be confirmed by voice'
      : a.voice === 'check' ? 'A spoken yes is allowed for this check tool where the group has switched it on. In this mock-up a tap stands for the spoken yes.'
        : 'A spoken yes is only for the four check tools'

    // ── The declaration, as readable data ───────────────────────
    const WIDE = 42
    function wrap(lead, text, indent) {
      const lines = []
      let line = lead, empty = true
      String(text).split(' ').forEach(w => {
        if (!empty && line.length + 1 + w.length > WIDE) { lines.push(line); line = ' '.repeat(indent) + w } else { line += (empty ? '' : ' ') + w; empty = false }
      })
      lines.push(line)
      return lines.join('\n')
    }
    function declText(a, s) {
      const c = CLASSES[a.cls]
      const out = [wrap('action: ', a.tool, 2), wrap('class: ', c.key, 2), wrap('confirmation: ', c.confirmation, 2), wrap('permission: ', a.needs, 2), 'inputs:']
      a.inputs(s).forEach(i => out.push(wrap('  ' + i[0] + ': ', i[1], 4)))
      out.push('preconditions:')
      a.pre.forEach(p => { out.push(wrap('  - rule: ', p.rule, 4)); out.push(wrap('    message: ', p.msg(s), 6)); out.push('    now: ' + (p.ok(s) ? 'passes' : 'fails')) })
      out.push('idempotency_key:')
      out.push(wrap('  ', a.key(s), 4))
      out.push(wrap('inverse: ', a.inverse ? a.inverse.text : 'none, ' + a.noInverse, 2))
      out.push(wrap('voice: ', a.cls === 1 ? 'not needed' : a.cls === 4 ? 'never' : a.voice === 'check' ? 'a spoken yes, where the group allows it' : 'no, check tools only', 2))
      if (a.signoff) out.push(wrap('sign_off: ', 'a named person, kept on the record', 2))
      return out.join('\n')
    }

    // ── The page ────────────────────────────────────────────────
    const src = (label, url) => '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'
    root.innerHTML = `
      <style>
        #view-confirm .cf-pick { gap: 8px; }
        #view-confirm .cf-grp { display: grid; grid-template-columns: minmax(0, 190px) minmax(0, 1fr); gap: 6px 12px; align-items: start; padding-top: 8px; border-top: 1px solid var(--line); }
        #view-confirm .cf-grp:first-child { border-top: 0; padding-top: 0; }
        #view-confirm .cf-grp .who { display: grid; gap: 3px; justify-items: start; min-width: 0; }
        #view-confirm .cf-grp .btn { min-height: 40px; padding: 4px 10px; font-size: 13px; }
        @media (max-width: 640px) { #view-confirm .cf-grp { grid-template-columns: minmax(0, 1fr); } }
        #view-confirm .cf-work { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); align-items: start; }
        #view-confirm .cf-work > *, #view-confirm .cf-decl > *, #view-confirm .m-main > * { min-width: 0; }
        #view-confirm .cf-dwu { display: flex; gap: 12px; align-items: center; padding: 10px 14px; }
        #view-confirm .cf-dwu > div { min-width: 0; display: grid; gap: 2px; }
        #view-confirm .cf-switch { flex: none; width: 56px; height: 44px; padding: 0; border: 0; background: transparent; display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; }
        #view-confirm .cf-switch i { display: block; width: 52px; height: 30px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); position: relative; transition: background 0.15s; }
        #view-confirm .cf-switch i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--ink-2); transition: transform 0.15s; }
        #view-confirm .cf-switch[aria-checked="true"] i { background: var(--brand); border-color: transparent; }
        #view-confirm .cf-switch[aria-checked="true"] i::after { transform: translateX(22px); background: var(--brand-ink); }
        #view-confirm .cf-switch:disabled { opacity: 0.45; cursor: not-allowed; }
        #view-confirm #cf-mock { color-scheme: light; } /* inputs stay light, as the mock-up does */
        #view-confirm .cf-conv { display: grid; gap: 10px; }
        #view-confirm .m-cardlet > header { flex-wrap: wrap; }
        #view-confirm .m-cardlet > header svg, #view-confirm .m-head svg, #view-confirm .m-understood svg, #view-confirm .m-diff svg, #view-confirm .cf-block svg, #view-confirm .cf-why svg { width: 15px; height: 15px; flex: none; }
        #view-confirm .m-cardlet > header svg, #view-confirm .m-head svg { color: var(--m-primary); }
        #view-confirm .m-cardlet > footer { align-items: center; }
        #view-confirm .m-understood .m-pill { white-space: normal; height: auto; min-height: 20px; padding-block: 2px; }
        #view-confirm .m-diff { flex-wrap: wrap; }
        #view-confirm .cf-rows { display: grid; }
        #view-confirm .cf-row { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 4px 10px; padding: 8px 0; border-top: 1px solid var(--m-line); align-items: center; }
        #view-confirm .cf-row:first-child { border-top: 0; padding-top: 0; }
        #view-confirm .cf-row > .k { font-size: 12px; font-weight: 600; color: var(--m-muted); }
        #view-confirm .cf-row > .v { min-width: 0; overflow-wrap: anywhere; }
        #view-confirm .cf-row small, #view-confirm .cf-line small { display: block; font-size: 12.5px; font-weight: 400; color: var(--m-muted); }
        #view-confirm .cf-in { display: flex; align-items: center; gap: 6px; max-width: 150px; font-weight: 600; }
        #view-confirm .cf-lines { display: grid; border-top: 1px solid var(--m-line); }
        #view-confirm .cf-line { display: grid; grid-template-columns: minmax(0, 1fr) 64px 62px; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--m-line); }
        #view-confirm .cf-line:first-child { border-top: 0; }
        #view-confirm .cf-line .what { min-width: 0; }
        #view-confirm .cf-line .m-input { padding: 0 8px; text-align: right; }
        #view-confirm .cf-line .t { text-align: right; font-variant-numeric: tabular-nums; }
        #view-confirm .cf-block { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: var(--m-bad-soft); color: var(--m-bad); font-weight: 600; font-size: 13.5px; }
        #view-confirm .cf-block svg { margin-top: 2px; }
        #view-confirm .cf-why { flex-basis: 100%; min-width: 0; font-size: 12.5px; color: var(--m-muted); display: flex; gap: 6px; align-items: flex-start; }
        #view-confirm .cf-why svg { margin-top: 2px; }
        #view-confirm .cf-fig { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
        #view-confirm .cf-word b { font-family: var(--font-mono); color: var(--m-ink); letter-spacing: 0.04em; }
        #view-confirm #cf-mock > .m-toast { top: 46px; bottom: auto; }
        #view-confirm .m-task .m-btn { flex: none; }
        #view-confirm .cf-none { flex: none; max-width: 120px; font-size: 12px; color: var(--m-muted); text-align: right; }
        #view-confirm .cf-more { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--m-line); background: var(--m-page); }
        #view-confirm .cf-more .m-btn svg { width: 16px; height: 16px; }
      </style>
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>The Confirm card: show the change, set friction by what it does</h1>
        <p class="lede">Pepper shows one card before it changes anything. The card states the change in the terms a person would check, and how much it asks of that person depends on the class the action declares.</p>
      </div>
      <div class="stage">
        ${App.brief({
          what: 'The card Pepper shows before a change. It is drawn from what the action declares, never from the model\'s words, and the checking it asks for follows the action\'s class.',
          tryThis: [
            'Pick an action from each of the four classes and see what its card asks for.',
            'On the ' + esc(padthai.name) + ' price or the ' + esc(harlow) + ' order, change a figure on the card. The total follows.',
            'Pick <b>Publish next week\'s rota at ' + esc(ware) + '</b>. It is refused, with the reason and no Confirm button.',
            'Pick <b>Delete a customer</b>. Type the word on the card, and look at the voice button.',
            'Pick <b>Mark ' + esc(seabass.name) + ' sold out</b> and switch on Done, with Undo. Then tap Undo.',
            'Confirm a change, then undo it in the Done by Pepper list.',
          ],
          why: [
            { text: 'Practitioner guidance in 2026 converges on friction tiered by consequence, and warns that approving everything turns the system into another approval queue (' + src('Towards AI', 'https://pub.towardsai.net/designing-for-ai-agents-8-ux-patterns-that-build-trust-in-2026-713a0c926933') + ', ' + src('DZone', 'https://dzone.com/articles/human-in-the-loop-approval-enterprise-ai-agents') + ').', confidence: 'medium' },
            { text: 'In one study of 73 people, users handed risky operations to an agent as readily as safe ones (' + src('arXiv 2608.19551', 'https://arxiv.org/pdf/2608.19551') + '). So the product has to set the friction.', confidence: 'medium' },
            { text: 'No vendor found lets an agent write business data without a person\'s approval. Where an agent acts without approval for each change, the change is reversible and guest-facing, such as re-ranking a digital menu. Vendor practice, security guidance and Macaroonie\'s own design agree on confirming a preview that the system built.', confidence: 'high' },
          ],
          status: [
            { kind: 'built', text: '97 change tools sit behind one Confirm card, built from the stored plan.' },
            { kind: 'built', text: 'A card expires after 30 minutes and then vanishes.' },
            { kind: 'target', text: 'Declared classes, before and after, fields you can edit on the card, Undo and the Done by Pepper list.' },
            { kind: 'target', text: 'Done, with Undo waits until undo exists and first customers give reversal figures. It is never for money, pay, prices, allergens, deletions or anything about a person.' },
            { kind: 'target', text: 'A named person signs off allergen data a model read and any change to pay or tips, with no exception by voice or in a batch.' },
          ],
          calls: 'None to draw a card. It is built from stored data: the plan and the action\'s declaration. No model runs on this page: the cards are scripted from the example actions.',
        })}
        <div class="stack">
          <div class="card cf-pick" id="cf-pick" role="group" aria-label="Example actions, by class"></div>
          <div class="cf-work">
            <div class="stack">
              <div class="card cf-dwu">
                <button type="button" class="cf-switch" id="cf-dwu" role="switch" aria-checked="false" aria-labelledby="cf-dwu-label"><i></i></button>
                <div><b id="cf-dwu-label">This group allows Done, with Undo for this action</b><span class="muted small" id="cf-dwu-why"></span></div>
              </div>
              <div class="mock" id="cf-mock">
                ${App.mockBar('office.macaroonie.com/pepper')}
                <div class="m-main">
                  <div class="m-title"><h2>Pepper</h2><span class="m-pill">${esc(me.name)} · ${esc(me.role)} · ${esc(ware)}</span><span class="m-pill info">Example data: ${esc(D.group)}</span></div>
                  <div class="cf-conv" id="cf-conv" aria-live="polite"></div>
                  <div class="m-card">
                    <div class="m-head">${icon('list')}Done by Pepper<span class="count" id="cf-log-n"></span></div>
                    <div class="m-list" id="cf-log"></div>
                    <div class="cf-more" id="cf-more"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="card cf-decl">
              <h3>What this action declares</h3>
              <pre class="code" id="cf-decl" tabindex="0" aria-label="The action's declaration"></pre>
              <p class="small">The card, the audit entry in Done by Pepper and the refusal message are all drawn from this declaration.</p>
              <div class="row"><button type="button" class="btn" id="cf-reg">Open the registry mock-up ${icon('right')}</button></div>
            </div>
          </div>
        </div>
      </div>`

    const $ = sel => root.querySelector(sel)
    const pick = $('#cf-pick'), mock = $('#cf-mock'), conv = $('#cf-conv'), logEl = $('#cf-log'), declEl = $('#cf-decl'), dwu = $('#cf-dwu'), dwuWhy = $('#cf-dwu-why')

    // ── Drawing ─────────────────────────────────────────────────
    function drawPick() {
      pick.innerHTML = [1, 2, 3, 4].map(c => `
        <div class="cf-grp">
          <div class="who"><span class="tag ${CLASSES[c].tag}">Class ${c}</span><b>${esc(CLASSES[c].name)}</b><span class="muted small">${esc(CLASSES[c].rule)}</span></div>
          <div class="row">${ACTIONS.filter(a => a.cls === c).map(a => `<button type="button" class="btn" data-a="${a.id}" aria-pressed="${a.id === cur}">${esc(a.label)}</button>`).join('')}</div>
        </div>`).join('')
    }

    function drawSwitch() {
      const a = byId[cur], on = a.cls === 2 && !!allow[cur]
      dwu.disabled = a.cls !== 2
      dwu.setAttribute('aria-checked', String(on))
      dwuWhy.textContent = a.cls === 1 ? 'Not needed: a read has no card.'
        : a.cls === 3 ? 'Never offered here: prices, orders, a rota and refunds always wait for a tap.'
          : a.cls === 4 ? 'Never offered here: deletions, pay, allergens and anything about a person always wait for a person.'
            : on ? 'On: this action runs at once and offers Undo. A group setting. Target, not built.'
              : 'Off: the card waits for Confirm. A group setting, off by default. Target, not built.'
    }

    const rowHtml = (r, s) => r.lines
      ? '<div class="cf-lines">' + ORDER.map(l => `
          <div class="cf-line">
            <div class="what"><b>${esc(l.name)}</b><small data-out="on-${l.id}"></small></div>
            <input class="m-input" id="cf-q-${l.id}" data-edit="${l.id}" inputmode="numeric" autocomplete="off" value="${esc(s.vals[l.id])}" aria-label="Quantity of ${esc(l.name)}">
            <span class="t" data-out="lt-${l.id}"></span>
          </div>`).join('') + '</div>'
      : '<div class="cf-row"><span class="k">' + esc(r.k) + '</span><div class="v">' +
        (r.out ? '<span data-out="' + r.out + '"></span>'
          : r.edit ? '<label class="cf-in"><span>' + esc(r.edit.unit) + '</span><input class="m-input" id="cf-in-' + r.edit.name + '" data-edit="' + r.edit.name + '" inputmode="' + r.edit.mode + '" autocomplete="off" value="' + esc(s.vals[r.edit.name]) + '" aria-label="' + esc(r.edit.label) + '"></label>'
            : r.v) + '</div></div>'

    function drawConv() {
      const a = byId[cur], s = state(cur), c = CLASSES[a.cls]
      const entry = log.find(e => e.id === s.entry)
      const pill = a.cls === 1 ? '<span class="m-pill">Read</span>'
        : s.phase === 'done' ? '<span class="m-pill ok">Done ' + esc(s.at) + '</span>'
          : s.phase === 'undone' ? '<span class="m-pill">Undone</span>'
            : s.phase === 'cancelled' ? '<span class="m-pill">Cancelled</span>'
              : '<span class="m-pill ' + c.pill + '">Class ' + a.cls + ' · ' + esc(c.name) + '</span>'
      const understood = '<div class="m-understood"><b>Understood</b>' + a.understood.map(u => '<span class="m-pill">' + esc(u) + '</span>').join('') + '</div>'
      const again = '<button type="button" class="m-btn ghost" data-act="again">Ask again</button>'
      let body = '', foot = ''
      if (a.cls === 1) {
        body = `
          <div><div class="cf-fig">£4,286.50</div><div class="m-understood"><span>Net sales at ${esc(ware)} on Friday 20 November · 187 checks · £22.92 a check</span></div></div>
          <div class="cf-rows">
            <div class="cf-row"><span class="k">What was counted</span><div class="v">Sales after discounts and refunds, before service charge. The report engine worked it out.</div></div>
            <div class="cf-row"><span class="k">Logged</span><div class="v">${esc(nowText())}: ${esc(me.name)} read Till sales at ${esc(ware)}<small>Nothing changed, so there is no card to approve</small></div></div>
          </div>`
        foot = '<button type="button" class="m-btn" data-act="note" data-note="In the product this opens Till reports at ' + esc(ware) + ' for Friday 20 November.">' + icon('chart') + 'Open report</button>'
      } else if (s.phase === 'ask') {
        const stuck = failed(a, s).length > 0 && !a.live // nothing on the card can fix it: no Confirm at all
        body = '<div class="cf-rows">' + a.rows(s).map(r => rowHtml(r, s)).join('') + '</div>' +
          '<div class="cf-block" data-block role="alert" hidden></div>' +
          '<div class="m-understood" data-checks></div>' +
          (a.word && !stuck ? '<div class="m-field cf-word"><label for="cf-word">Type <b>' + a.word + '</b> to confirm</label><input class="m-input" id="cf-word" data-word autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(s.typed) + '"><span class="help">A second, different check. A tap alone is not enough for this class.</span></div>' : '')
        foot = stuck
          ? (a.fix ? '<button type="button" class="m-btn" data-act="note" data-note="' + esc(a.fix.note) + '">' + icon('right') + esc(a.fix.label) + '</button>' : '') + '<button type="button" class="m-btn ghost" data-act="cancel">Close</button>'
          : '<button type="button" class="m-btn ' + (a.danger ? 'danger' : 'primary') + '" data-act="confirm">' + icon('check') + '<span data-out="go">' + esc(a.go(s)) + '</span></button>' +
            '<button type="button" class="m-btn ghost" data-act="cancel">Cancel</button>' +
            '<button type="button" class="m-btn" data-act="voice" aria-describedby="cf-voice-why"' + (a.voice === 'check' ? '' : ' disabled') + '>' + icon('mic') + 'Say yes</button>' +
            '<span class="cf-why" id="cf-voice-why">' + icon('mic') + '<span>' + esc(voiceWhy(a)) + '</span></span>'
      } else if (s.phase === 'done') {
        body = '<div class="cf-rows"><div class="cf-row"><span class="k">Done at ' + esc(s.at) + '</span><div class="v">' + esc(entry ? entry.what : a.done(s)) +
          (s.how === 'auto' ? '<small>It ran at once: this group allows Done, with Undo for this action</small>' : s.how === 'voice' ? '<small>Confirmed by a spoken yes</small>' : a.signoff ? '<small>Signed off by ' + esc(me.name) + '</small>' : '') +
          (entry && entry.until && canUndo(entry) ? '<small>It waits ' + a.inverse.seconds + ' seconds in the queue. Undo stops it.</small>' : '') + '</div></div></div>'
        foot = (entry && canUndo(entry) ? '<button type="button" class="m-btn" data-act="undo">' + icon('undo') + 'Undo</button>' : '') + again +
          (entry && !canUndo(entry) ? '<span class="cf-why">' + icon('lock') + '<span>' + esc(a.inverse ? 'It has left the queue, so it is too late to undo' : 'No undo: ' + a.noInverse) + '</span></span>' : '')
      } else if (s.phase === 'undone') {
        body = '<div class="cf-rows"><div class="cf-row"><span class="k">Undone</span><div class="v">' + esc(entry ? entry.undo : '') + '<small>The entry stays in Done by Pepper, marked as undone</small></div></div></div>'
        foot = again
      } else {
        body = '<div class="cf-rows"><div class="cf-row"><span class="k">Cancelled</span><div class="v">Nothing was changed</div></div></div>'
        foot = again
      }
      conv.innerHTML = '<div class="m-msg me">' + esc(a.said) + '</div>' +
        '<div class="m-cardlet" id="cf-card"><header>' + icon(a.cls === 1 ? 'chart' : 'sparkles') + '<span style="flex:1;min-width:0">' + esc(a.title) + '</span>' + pill + '</header>' +
        '<div class="m-pad">' + understood + body + '</div><footer>' + foot + '</footer></div>'
      paint()
    }

    // Everything on the card that follows a typed figure: totals, the before and after, the refusal, the button.
    function paint() {
      const a = byId[cur], s = state(cur)
      declEl.textContent = declText(a, s)
      const card = conv.querySelector('#cf-card')
      if (!card || a.cls === 1 || s.phase !== 'ask') return
      const o = a.outs ? a.outs(s) : {}
      card.querySelectorAll('[data-out]').forEach(n => { const h = o[n.dataset.out]; if (h != null) n.innerHTML = h })
      const bad = failed(a, s)
      const block = card.querySelector('[data-block]'), checks = card.querySelector('[data-checks]')
      block.hidden = !bad.length
      block.innerHTML = bad.length ? icon('alert') + '<span>' + esc(bad[0].msg(s)) + '</span>' : ''
      checks.hidden = !!bad.length
      checks.innerHTML = icon('shield') + '<span>' + a.pre.length + (a.pre.length === 1 ? ' rule' : ' rules') + ' checked: ' + (a.pre.length === 1 ? 'it passes' : 'all pass') + '</span>'
      const go = card.querySelector('[data-act="confirm"]'), voice = card.querySelector('[data-act="voice"]'), why = card.querySelector('#cf-voice-why')
      if (go) { go.hidden = !!bad.length; go.disabled = !wordOk(a, s) }
      if (voice) voice.hidden = !!bad.length
      if (why) why.hidden = !!bad.length
    }

    function drawLog() {
      $('#cf-log-n').textContent = log.length + ' today'
      const shown = showAll ? log : log.slice(0, SHORT)
      $('#cf-more').innerHTML = (log.length > SHORT ? '<button type="button" class="m-btn" data-act="more">' + (showAll ? 'Show the latest ' + SHORT : 'Show all ' + log.length) + '</button>' : '') +
        '<button type="button" class="m-btn ghost" data-act="review">Open For review' + icon('right') + '</button>'
      logEl.innerHTML = shown.map(e => `
        <div class="m-task${e.undone ? ' done' : ''}" data-entry="${e.id}">
          <span class="m-ico">${icon(e.undone ? 'undo' : 'check')}</span>
          <div class="what"><b>${esc(e.what)}</b><span>${esc(e.who)} · ${esc(e.when)} · ${esc(e.how)}</span>${e.undone ? '<span>Undone at ' + esc(e.undone) + ' by ' + esc(me.name) + '. ' + esc(e.undo) + '.</span>' : ''}</div>
          ${canUndo(e) ? '<button type="button" class="m-btn" data-undo="' + e.id + '">' + icon('undo') + 'Undo</button>'
            : e.undone ? '<span class="m-pill">Undone</span>'
              : '<span class="cf-none">' + esc(e.undo ? 'Sent. Too late to undo.' : 'No undo: ' + e.noUndo) + '</span>'}
        </div>`).join('')
    }

    function draw() { drawPick(); drawSwitch(); drawConv(); drawLog() }

    // ── Doing and undoing ───────────────────────────────────────
    const HOW = { card: 'confirmed on the card', voice: 'confirmed by a spoken yes', auto: 'Done, with Undo' }
    function run(how) {
      const a = byId[cur], s = state(cur)
      if (a.cls === 1 || s.phase !== 'ask' || failed(a, s).length) return
      if (how === 'auto' ? !(a.cls === 2 && allow[a.id]) : !wordOk(a, s)) return
      if (how === 'voice' && a.voice !== 'check') return
      const when = stamp()
      const e = {
        id: 'e' + (++seq), actionId: a.id, who: me.name, what: a.done(s), when,
        how: (a.word ? 'typed ' + a.word + ' and confirmed' : HOW[how]) + (a.signoff ? ', signed off by ' + me.name : ''),
        undo: a.inverse ? a.inverse.undone(s) : '', noUndo: a.inverse ? '' : a.noInverse,
        until: a.inverse && a.inverse.seconds ? Date.now() + a.inverse.seconds * 1000 : 0, undone: '',
      }
      log.unshift(e)
      s.phase = 'done'; s.entry = e.id; s.at = when; s.how = how
      if (e.until) setTimeout(() => { drawLog(); if (cur === a.id && state(a.id).phase === 'done') drawConv() }, a.inverse.seconds * 1000 + 60)
      draw()
      if (how === 'auto') App.toast(mock, 'Done. ' + e.what + '.', { undo: () => undo(e.id) })
    }
    function undo(id) {
      const e = log.find(x => x.id === id)
      if (!e || !canUndo(e)) return
      e.undone = stamp()
      const s = e.actionId ? st[e.actionId] : null
      if (s && s.entry === e.id) s.phase = 'undone'
      mock.querySelectorAll('.m-toast').forEach(t => t.remove())
      draw()
    }

    // ── Events ──────────────────────────────────────────────────
    pick.addEventListener('click', e => {
      const b = e.target.closest('[data-a]')
      if (!b) return
      cur = b.dataset.a
      mock.querySelectorAll('.m-toast').forEach(t => t.remove()) // a toast belongs to the card it came from
      draw()
    })
    dwu.addEventListener('click', () => {
      const a = byId[cur]
      if (a.cls !== 2) return
      allow[cur] = !allow[cur]
      if (allow[cur] && state(cur).phase === 'ask') run('auto'); else draw()
    })
    mock.addEventListener('input', e => {
      const t = e.target, s = state(cur)
      if (t.dataset.edit) { s.vals[t.dataset.edit] = t.value; paint() } else if (t.hasAttribute('data-word')) { s.typed = t.value; paint() }
    })
    mock.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.hasAttribute('data-word')) run('card') })
    mock.addEventListener('click', e => {
      const u = e.target.closest('[data-undo]')
      if (u) return undo(u.dataset.undo)
      const b = e.target.closest('[data-act]')
      if (!b || b.disabled) return
      const a = byId[cur], s = state(cur), act = b.dataset.act
      if (act === 'confirm') run('card')
      else if (act === 'voice') run('voice')
      else if (act === 'cancel') { s.phase = 'cancelled'; draw() }
      else if (act === 'undo') undo(s.entry)
      else if (act === 'note') App.toast(mock, b.dataset.note)
      else if (act === 'more') { showAll = !showAll; drawLog() }
      else if (act === 'review') App.go('review')
      else if (act === 'again') { st[cur] = fresh(a); if (a.cls === 2 && allow[cur]) run('auto'); else draw() }
    })
    $('#cf-reg').addEventListener('click', () => App.go('registry'))

    draw()
  },
})
