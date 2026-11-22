// The registry: one record per business object and one declaration per
// action. Everything under "What is drawn from that one declaration" is made
// by the code below from the selected action's declaration object, never
// written by hand per action: the Confirm card, the audit entry, the words
// Pepper's tool gets, the refusal and the flat form.
// Source: reports/AI first back office strategy.md (22 Nov 2026), "Under the
// surface: one registry that describes what exists", and docs/CATALOGUE.md.
App.view('registry', {
  label: 'The registry',
  group: 'Underneath',
  render(root) {
    const { icon, esc, money, data } = App
    const venue = data.venues[0].name
    const who = data.people[0].name
    const chef = data.people[1].name
    const shiftLead = data.people[2].name
    const area = data.people[3].name
    const supplier = data.suppliers[0].name
    const fridge = data.fridges[1]
    const dish = id => data.dishes.filter(d => d.id === id)[0] || data.dishes[0]

    // ── Words for the declared values ─────────────────────────
    const MODULES = { cash_recon: 'Cash recon', web_orders: 'Online orders', menus: 'Menus', food_safety: 'Food safety', rota: 'Rota', purchasing: 'Purchasing', bookings: 'Bookings' }
    const LEVELS = { view: 'View', use: 'Use', manage: 'Manage' }
    const TYPE = { venue: 'venue', day: 'day', week: 'week', text: 'text', longtext: 'long text', money: 'money, in pounds', number: 'whole number', choice: 'one of a list', yesno: 'yes or no', temp: 'temperature, in °C', time: 'time', phone: 'phone number', email: 'email address', lines: 'lines', ref: 'record' }
    // The consequence class sets the confirmation rule (the report's four levels; destructive and personal share one).
    const CLASSES = {
      read: { label: 'Read', tag: '', pill: '', rule: 'No card. It runs straight away and is logged.' },
      reversible: { label: 'Reversible', tag: 'built', pill: 'ok', rule: 'A Confirm card and one tap.' },
      consequential: { label: 'Consequential', tag: 'low', pill: 'now', rule: 'A Confirm card with before and after. It always waits for a tap.' },
      destructive: { label: 'Destructive', tag: 'no', pill: 'late', rule: 'A Confirm card and a typed word. Never confirmed by voice.' },
      personal: { label: 'Personal', tag: 'no', pill: 'late', rule: 'A Confirm card and a typed word. Never confirmed by voice.' },
    }
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const fmtDay = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d.getTime()) ? String(iso) : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() }

    // ── The registry (example data) ───────────────────────────
    const inp = (name, type, label, eg, more) => Object.assign({ name, type, label, eg, required: true }, more || {})
    const CATEGORIES = ['Supplies', 'Repairs', 'Staff meals', 'Travel']
    const dayOpen = { rule: 'day_open', check: 'The cash day is not submitted yet', message: 'Saturday\'s cash-up at ' + venue + ' is already submitted. A manager can reopen the day, then try again.' }

    const OBJECTS = [
      {
        id: 'expense', label: 'Expense', icon: 'cash', table: 'cash_expenses', subject: 'cash.expenses', subjectLabel: 'Expenses', module: 'cash_recon',
        page: '/cash-recon?venue=:venue&day=:day', pageEg: '/cash-recon?venue=ware&day=2026-11-21', pageBuilt: false, panel: null,
        actions: [
          {
            name: 'add_expense', real: true, title: 'Add an expense', ask: 'Add this expense?', go: 'Add expense', done: 'Added an expense',
            about: 'Adds a petty cash expense to a day\'s cash-up.', module: 'cash_recon', level: 'use', cls: 'reversible', form: 'flat',
            inputs: [
              inp('venue', 'venue', 'Venue', venue),
              inp('day', 'day', 'Day', '2026-11-21'),
              inp('description', 'text', 'What it was', 'Bin bags'),
              inp('amount', 'money', 'Amount with VAT', 18.4),
              inp('vat_amount', 'money', 'VAT in it', 3.07, { required: false }),
              inp('category', 'choice', 'Category', 'Supplies', { required: false, options: CATEGORIES }),
              inp('paid_by_card', 'yesno', 'Paid by card', false, { required: false, help: 'A card expense is kept for its receipt and VAT. It does not count as cash out of the till.' }),
            ],
            pre: [dayOpen, { rule: 'category_known', check: 'The category is one of the group\'s own', message: 'There is no expense category called Supplies. Pick one from the list, or add it in Cash recon settings.' }],
            key: ['venue', 'day', 'description', 'amount'], inverse: 'remove_expense',
          },
          {
            name: 'change_expense', real: false, title: 'Change an expense', ask: 'Change this expense?', go: 'Save change', done: 'Changed an expense',
            about: 'Changes the amount, VAT or category of an expense on a day that is still open.', module: 'cash_recon', level: 'use', cls: 'consequential', form: 'flat',
            inputs: [
              inp('expense', 'ref', 'Expense', 'Bin bags, Sat 21 Nov', { subject: 'cash.expenses' }),
              inp('amount', 'money', 'Amount with VAT', 21.4, { was: 18.4 }),
              inp('vat_amount', 'money', 'VAT in it', 3.57, { required: false, was: 3.07 }),
              inp('category', 'choice', 'Category', 'Supplies', { required: false, options: CATEGORIES }),
            ],
            pre: [dayOpen, { rule: 'expense_on_day', check: 'The expense is on that day', message: 'There is no expense called Bin bags on Saturday at ' + venue + '. Pick one of Saturday\'s expenses.' }],
            key: ['expense', 'amount', 'vat_amount'], inverse: 'change_expense', inverseNote: 'with the old figures',
          },
          {
            name: 'remove_expense', real: false, title: 'Remove an expense', ask: 'Remove this expense?', go: 'Remove expense', done: 'Removed an expense',
            about: 'Removes an expense and its receipt photo from a day that is still open.', module: 'cash_recon', level: 'use', cls: 'destructive', form: 'card',
            inputs: [inp('expense', 'ref', 'Expense', 'Bin bags, £18.40, Sat 21 Nov', { subject: 'cash.expenses' })],
            pre: [dayOpen], key: ['expense'], inverse: null,
          },
        ],
      },
      {
        id: 'dish', label: 'Dish', icon: 'utensils', table: 'menu_items', subject: 'menu.dishes', subjectLabel: 'Menu dishes', module: 'menus',
        page: '/menus?edit=:menu&dish=:id', pageEg: '/menus?edit=main&dish=pad-thai', pageBuilt: true,
        panel: { id: 'DishEditor', name: 'Dish editor', why: 'Options, allergens and tax sit on the dish, and a menu is saved whole.' },
        actions: [
          {
            name: 'set_sold_out', real: true, title: 'Mark a dish sold out', ask: 'Mark this dish sold out?', go: 'Mark sold out', done: 'Marked a dish sold out',
            about: 'Marks a dish sold out, or back on sale, at one venue.', module: 'web_orders', level: 'manage', cls: 'reversible', form: 'card',
            applies: 'Till, online ordering and menu screens',
            inputs: [
              inp('venue', 'venue', 'Venue', venue),
              inp('dish', 'ref', 'Dish', dish('seabass').name, { subject: 'menu.dishes' }),
              inp('sold_out', 'yesno', 'Sold out', true),
              inp('until', 'choice', 'Until', 'End of today', { required: false, options: ['End of today', 'Switched back by hand'] }),
            ],
            pre: [{ rule: 'dish_is_live', check: 'The dish is on a menu that is live at the venue', message: dish('seabass').name + ' is not on a live menu at ' + venue + ', so there is nothing to mark sold out.' }],
            key: ['venue', 'dish', 'sold_out'], inverse: 'set_sold_out', inverseNote: 'back on sale',
          },
          {
            name: 'change_prices', real: true, title: 'Change a dish price', ask: 'Change this price?', go: 'Change price', done: 'Changed a menu price',
            about: 'Changes the price of a dish on the draft menu.', module: 'menus', level: 'manage', cls: 'consequential', form: 'panel',
            applies: 'The draft menu. Guests see it after the next publish',
            inputs: [
              inp('menu', 'ref', 'Menu', 'Main menu', { subject: 'menu.menus' }),
              inp('dish', 'ref', 'Dish', dish('padthai').name, { subject: 'menu.dishes' }),
              inp('price', 'money', 'Price', 12.95, { was: dish('padthai').price / 100 }),
            ],
            pre: [
              { rule: 'price_not_locked', check: 'The group has not locked the price', message: 'The price of ' + dish('padthai').name + ' is locked by the group. Ask ' + area + ' to change it for every venue.' },
              { rule: 'no_publish_running', check: 'The menu is not being published', message: 'Main menu is being published right now. Try again in a minute.' },
            ],
            key: ['menu', 'dish', 'price'], inverse: 'change_prices', inverseNote: 'back to the old price',
          },
          {
            name: 'remove_dishes', real: true, title: 'Remove a dish', ask: 'Remove this dish?', go: 'Remove dish', done: 'Removed a dish',
            about: 'Takes a dish off the draft menu for good.', module: 'menus', level: 'manage', cls: 'destructive', form: 'card',
            inputs: [inp('menu', 'ref', 'Menu', 'Main menu', { subject: 'menu.menus' }), inp('dish', 'ref', 'Dish', dish('tomyum').name, { subject: 'menu.dishes' })],
            pre: [{ rule: 'not_in_a_meal_deal', check: 'No meal deal uses the dish', message: dish('tomyum').name + ' is part of the Lunch deal. Take it out of the deal first.' }],
            key: ['menu', 'dish'], inverse: null,
          },
        ],
      },
      {
        id: 'fridge_check', label: 'Fridge check', icon: 'thermometer', table: 'fs_temp_logs', subject: 'safety.fridge_checks', subjectLabel: 'Fridge and freezer checks', module: 'food_safety',
        page: '/food-safety?venue=:venue&day=:day&tab=fridges', pageEg: '/food-safety?venue=ware&day=2026-11-22&tab=fridges', pageBuilt: false,
        panel: { id: 'FridgeChecks', name: 'Fridge checks panel', why: 'It lists this venue\'s units for the check time and asks for a corrective action when a reading is out of range.' },
        actions: [
          {
            name: 'log_temperature', real: true, title: 'Log a fridge temperature', ask: 'Log this reading?', go: 'Log reading', done: 'Logged a fridge temperature',
            about: 'Logs one fridge or freezer reading for a check time.', module: 'food_safety', level: 'use', cls: 'reversible', form: 'panel',
            inputs: [
              inp('venue', 'venue', 'Venue', venue),
              inp('day', 'day', 'Day', '2026-11-22'),
              inp('fridge', 'ref', 'Unit', fridge, { subject: 'safety.fridges' }),
              inp('check_time', 'choice', 'Check time', 'Morning', { options: ['Morning', 'Afternoon', 'Evening'] }),
              inp('temperature', 'temp', 'Reading', 3.5, { help: 'Typed or spoken by the person. Pepper never works it out.' }),
              inp('corrective_action', 'longtext', 'What was done about it', '', { required: false }),
            ],
            pre: [
              { rule: 'unit_at_venue', check: 'The unit belongs to the venue', message: venue + ' has no unit called ' + fridge + '. Pick one of the units set up for ' + venue + '.' },
              { rule: 'out_of_range_has_action', check: 'A reading out of range comes with a corrective action', message: '9.5°C is above the 8°C limit for ' + fridge + '. Say what was done about it, then save.' },
            ],
            key: ['venue', 'day', 'fridge', 'check_time'], inverse: 'remove_fridge_check',
          },
          {
            name: 'add_corrective_action', real: true, title: 'Add a corrective action', ask: 'Add this corrective action?', go: 'Add corrective action', done: 'Added a corrective action',
            about: 'Records what was done about a reading that was out of range.', module: 'food_safety', level: 'use', cls: 'reversible', form: 'flat',
            inputs: [
              inp('fridge_check', 'ref', 'Reading', fridge + ', this morning, 9.5°C', { subject: 'safety.fridge_checks' }),
              inp('action', 'longtext', 'What was done', 'Moved the stock to the walk-in fridge. Engineer called.'),
              inp('done_by', 'ref', 'Done by', chef, { subject: 'staff.people', required: false }),
            ],
            pre: [{ rule: 'reading_out_of_range', check: 'The reading is out of range', message: 'That reading is in range, so there is nothing to correct.' }],
            key: ['fridge_check', 'action'], inverse: null,
          },
        ],
      },
      {
        id: 'rota_shift', label: 'Rota shift', icon: 'users', table: 'rota_entries', subject: 'rota.entries', subjectLabel: 'Rota entries', module: 'rota',
        page: '/rota?venue=:venue&week=:week', pageEg: '/rota?venue=ware&week=2026-11-23', pageBuilt: false,
        panel: { id: 'RotaDay', name: 'Rota day panel', why: 'A rota week is saved whole, so the panel sends back every entry, also the ones it did not change.' },
        actions: [
          {
            name: 'set_rota', real: true, title: 'Change a rota day', ask: 'Change the rota?', go: 'Change rota', done: 'Changed the rota',
            about: 'Puts a person on or off the rota for a day, with a shift.', module: 'rota', level: 'manage', cls: 'consequential', form: 'panel',
            inputs: [
              inp('venue', 'venue', 'Venue', venue),
              inp('day', 'day', 'Day', '2026-11-27'),
              inp('person', 'ref', 'Person', shiftLead, { subject: 'staff.people' }),
              inp('status', 'choice', 'Status', 'On', { was: 'Off', options: ['On', 'Off', 'Sick', 'Holiday'] }),
              inp('shift', 'choice', 'Shift', 'Evening, 17:00 to 23:00', { required: false, was: '', options: ['Morning, 09:00 to 17:00', 'Evening, 17:00 to 23:00'] }),
            ],
            pre: [
              { rule: 'works_at_venue', check: 'The person works at the venue', message: shiftLead + ' is not on the staff list at ' + venue + '. Add her to ' + venue + ' first, or pick someone else.' },
              { rule: 'no_time_off', check: 'No time off is booked for the day', message: shiftLead + ' has holiday booked on Friday 27 November. Remove the time off first.' },
            ],
            key: ['venue', 'day', 'person'], inverse: 'set_rota', inverseNote: 'back to the old entry',
          },
          {
            name: 'copy_rota_week', real: true, title: 'Copy a rota week', ask: 'Copy this rota week?', go: 'Copy week', done: 'Copied a rota week',
            about: 'Copies one week\'s rota into another week at the same venue.', module: 'rota', level: 'manage', cls: 'consequential', form: 'card',
            inputs: [inp('venue', 'venue', 'Venue', venue), inp('from_week', 'week', 'Copy from', '2026-11-23'), inp('to_week', 'week', 'Copy into', '2026-11-30')],
            pre: [{ rule: 'target_week_empty', check: 'The week copied into is empty', message: 'The week of 30 November already has 14 entries at ' + venue + '. Clear that week first, or copy into an empty one.' }],
            key: ['venue', 'from_week', 'to_week'], inverse: 'clear_rota_week', inverseNote: 'clears the copied week',
          },
        ],
      },
      {
        id: 'supplier_invoice', label: 'Supplier invoice', icon: 'file', table: 'purchase_invoices', subject: 'purchasing.invoices', subjectLabel: 'Supplier invoices', module: 'purchasing',
        page: '/purchasing?po=:id', pageEg: '/purchasing?po=1042', pageBuilt: true, pageNote: 'An invoice opens through its supplier order.',
        panel: { id: 'Receiving', name: 'Receiving panel', why: 'It shows the photographed invoice beside the lines read from it, against the order.' },
        actions: [
          {
            name: 'receive_delivery', real: true, title: 'Book in a delivery', ask: 'Book in this delivery?', go: 'Book in delivery', done: 'Booked in a delivery',
            about: 'Books a delivery in against its invoice or delivery note.', module: 'purchasing', level: 'manage', cls: 'consequential', form: 'panel',
            inputs: [
              inp('venue', 'venue', 'Venue', venue),
              inp('supplier', 'ref', 'Supplier', supplier, { subject: 'purchasing.suppliers' }),
              inp('invoice_number', 'text', 'Invoice number', 'LV-20418'),
              inp('invoice_date', 'day', 'Invoice date', '2026-11-22'),
              inp('lines', 'lines', 'Lines', '12 lines read from the photo'),
              inp('total', 'money', 'Invoice total', 286.4),
            ],
            pre: [
              { rule: 'not_booked_in_already', check: 'The invoice number is not booked in already', message: 'Invoice LV-20418 from ' + supplier + ' was booked in on Friday. Open it to check before adding it again.' },
              { rule: 'lines_match_total', check: 'The lines add up to the invoice total', message: 'The lines add up to £279.90 and the invoice says £286.40. Check the lines against the photo.' },
            ],
            key: ['supplier', 'invoice_number'], inverse: null,
          },
          {
            name: 'remove_invoice', real: false, title: 'Remove an invoice', ask: 'Remove this invoice?', go: 'Remove invoice', done: 'Removed an invoice',
            about: 'Removes an invoice that was read by mistake.', module: 'purchasing', level: 'manage', cls: 'destructive', form: 'card',
            inputs: [inp('invoice', 'ref', 'Invoice', 'LV-20418, ' + supplier + ', £286.40', { subject: 'purchasing.invoices' })],
            pre: [{ rule: 'no_prices_from_it', check: 'No supplier price came from the invoice', message: 'Three supplier prices were updated from invoice LV-20418. Change those prices back first.' }],
            key: ['invoice'], inverse: null,
          },
        ],
      },
      {
        id: 'booking', label: 'Booking', icon: 'calendar', table: 'bookings', subject: 'bookings.bookings', subjectLabel: 'Bookings', module: 'bookings',
        page: '/bookings?booking=:id', pageEg: '/bookings?booking=bk-58213', pageBuilt: true,
        panel: { id: 'BookingWindow', name: 'Booking window', why: 'Free times are worked out when they are asked for, so the panel shows live times.' },
        actions: [
          {
            name: 'change_booking', real: true, title: 'Move a booking', ask: 'Move this booking?', go: 'Move booking', done: 'Moved a booking',
            about: 'Moves a booking to another time, party size or table.', module: 'bookings', level: 'manage', cls: 'consequential', form: 'panel',
            inputs: [
              inp('booking', 'ref', 'Booking', 'Patel, Fri 27 Nov', { subject: 'bookings.bookings' }),
              inp('time', 'time', 'Time', '19:30', { was: '19:00' }),
              inp('guests', 'number', 'Guests', 6, { was: 4 }),
              inp('table', 'ref', 'Table', 'Tables 12 and 13', { subject: 'bookings.tables', required: false, was: 'Table 12' }),
            ],
            pre: [
              { rule: 'time_is_free', check: 'A table is free at the new time', message: 'There is no table for 6 at 19:30 on Friday at ' + venue + '. The nearest free times are 18:45 and 20:15.' },
              { rule: 'not_started', check: 'The booking has not started', message: 'This booking started at 19:00. Change its status instead.' },
            ],
            key: ['booking', 'time', 'guests'], inverse: 'change_booking', inverseNote: 'back to the old time and table',
          },
          {
            name: 'update_guest_details', real: true, title: 'Update guest details', ask: 'Update these guest details?', go: 'Update details', done: 'Updated guest details',
            about: 'Changes the name, phone or email on a booking.', module: 'bookings', level: 'manage', cls: 'personal', form: 'flat',
            inputs: [
              inp('booking', 'ref', 'Booking', 'Patel, Fri 27 Nov', { subject: 'bookings.bookings' }),
              inp('guest_name', 'text', 'Guest name', 'Priya Patel'),
              inp('phone', 'phone', 'Phone', '07700 900456', { required: false, was: '07700 900123' }),
              inp('email', 'email', 'Email', 'priya.patel@example.com', { required: false }),
            ],
            pre: [{ rule: 'guest_not_erased', check: 'The guest\'s details have not been erased', message: 'This guest asked for their details to be erased, so there is nothing to update.' }],
            key: ['booking', 'phone', 'email'], inverse: 'update_guest_details', inverseNote: 'back to the old details',
          },
        ],
      },
    ]

    // ── State: the selection, and the edits made to the declaration ──
    const st = { obj: 0, act: 0, cls: 'reversible', inv: true, fail: -1 }
    const obj = () => OBJECTS[st.obj]
    const act = () => obj().actions[st.act]
    const pick = (o, a) => { st.obj = o; st.act = a; st.cls = act().cls; st.inv = !!act().inverse; st.fail = -1 }
    const invName = a => a.inverse || 'undo_' + a.name
    const edited = () => st.cls !== act().cls || st.inv !== !!act().inverse

    // ── Reading a declaration ─────────────────────────────────
    const showVal = (i, v) => {
      if (v == null || v === '') return 'None'
      switch (i.type) {
        case 'money': return money(Math.round(v * 100))
        case 'yesno': return v ? 'Yes' : 'No'
        case 'temp': return Number(v).toFixed(1) + '°C'
        case 'day': return fmtDay(v)
        case 'week': return 'Week of ' + fmtDay(v)
        default: return String(v)
      }
    }
    const typeWords = i => i.type === 'ref' ? 'a ' + i.subject + ' record' : i.type === 'choice' ? 'one of ' + i.options.join(', ') : TYPE[i.type] || i.type
    const lower = s => s.charAt(0).toLowerCase() + s.slice(1)
    const word = a => a.go.split(' ')[0].toUpperCase()
    const typed = () => st.cls === 'destructive' || st.cls === 'personal'
    const confirmRule = () => CLASSES[st.cls].rule + (st.cls !== 'reversible' ? '' : st.inv ? ' With an inverse declared, a group can later choose Done, with Undo.' : ' With no inverse there is no Undo, so it stays a card.')
    const q = s => '\'' + String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'') + '\''

    // The declarations as code, wrapped to the width of the pane beside the readable card.
    const WIDE = 48
    const wrapList = (head, items, tail, ind) => {
      const lines = []
      let cur = head
      items.forEach((it, n) => {
        const piece = it + (n < items.length - 1 ? ',' : '')
        if (n === 0) cur += piece
        else if ((cur + ' ' + piece).length > WIDE) { lines.push(cur); cur = ind + piece }
        else cur += ' ' + piece
      })
      lines.push(cur + tail)
      return lines.join('\n')
    }
    const wrapText = (text, ind) => {
      const out = []
      let cur = ''
      text.split(' ').forEach(w => { if (cur && (cur + ' ' + w).length > WIDE - ind.length - 5) { out.push(cur + ' '); cur = w } else cur = cur ? cur + ' ' + w : w })
      out.push(cur)
      return ind + out.map(q).join(' +\n' + ind)
    }
    const fit = (line, ind) => line.length <= WIDE ? line : line.replace(/^(\s*\w+:) /, '$1\n' + ind)

    const recordCode = o => [
      'object(' + q(o.id) + ', {',
      '  label: ' + q(o.label) + ',',
      '  table: ' + q(o.table) + ',',
      '  subject: ' + q(o.subject) + ',',
      '  module: ' + q(o.module) + ',',
      fit('  open: ' + q(o.page) + ',', '    '),
      wrapList('  actions: [', o.actions.map(a => q(a.name)), '],', '    '),
      '  form: ' + (o.panel ? '{ panel: ' + q(o.panel.id) + ' }' : '{ drawn: \'from the rules\' }') + ',',
      '})',
    ].join('\n')

    const inputCode = i => {
      const tail = (i.required ? '.required()' : '') + ','
      if (i.type === 'choice') return wrapList('    ' + i.name + ': choice(', i.options.map(q), ')' + tail, '      ')
      const line = '    ' + i.name + ': ' + (i.type === 'ref' ? 'ref(' + q(i.subject) + ')' : i.type + '()')
      return (line + tail).length > WIDE && i.required ? line + '\n      ' + tail : line + tail
    }
    const declCode = a => [
      'action(' + q(a.name) + ', {',
      '  title: ' + q(a.title) + ',',
      '  inputs: {',
    ].concat(a.inputs.map(inputCode), [
      '  },',
      wrapList('  needs: { ', ['module: ' + q(a.module), 'level: ' + q(a.level)], ' },', '    '),
      '  preconditions: [',
    ], a.pre.map(p => '    { rule: ' + q(p.rule) + ', message:\n' + wrapText(p.message, '        ') + ' },'), [
      '  ],',
      '  class: ' + q(st.cls) + ',',
      wrapList('  key: [', a.key.map(q), '],', '    '),
      '  inverse: ' + (st.inv ? q(invName(a)) : 'null') + ',',
      '})',
    ]).join('\n')

    // ── The five surfaces, each drawn from the declaration ────
    function cardHtml(a) {
      const C = CLASSES[st.cls]
      if (st.fail >= 0) {
        const p = a.pre[st.fail]
        return '<div class="m-cardlet rg-refuse"><header>' + icon('alert') + '<span style="flex:1;min-width:0">Can\'t ' + esc(lower(a.title)) + '</span><span class="m-pill late">Not done</span></header>' +
          '<div class="m-pad"><p>' + esc(p.message) + '</p><div class="m-understood"><span>Rule checked: <span class="mono">' + esc(p.rule) + '</span>. Nothing was changed.</span></div></div></div>'
      }
      if (st.cls === 'read') {
        return '<div class="m-cardlet"><header>' + icon('eye') + '<span style="flex:1;min-width:0">No Confirm card</span><span class="m-pill">Read</span></header>' +
          '<div class="m-pad"><p>A read changes nothing, so it runs straight away and is logged.</p><div class="m-understood"><span>Runs as ' + esc(who) + ' · ' + esc(MODULES[a.module]) + ', ' + esc(LEVELS[a.level]) + '</span></div></div></div>'
      }
      const diff = st.cls !== 'reversible'
      const any = a.inputs.some(i => i.was !== undefined)
      const rows = (diff && !any ? '<tr><td class="rg-k">Before</td><td>Nothing yet. This is new.</td></tr>' : '') + a.inputs.map(i => '<tr><td class="rg-k">' + esc(i.label) + '</td><td>' +
        (diff && i.was !== undefined ? '<span class="m-diff"><s>' + esc(showVal(i, i.was)) + '</s>' + icon('right') + '<b>' + esc(showVal(i, i.eg)) + '</b></span>' : esc(showVal(i, i.eg))) + '</td></tr>').join('')
      const after = st.cls === 'reversible'
        ? (st.inv ? 'One tap. Undo afterwards runs <span class="mono">' + esc(invName(a)) + '</span>.' : 'One tap. No inverse is declared, so there is no Undo.')
        : st.cls === 'consequential' ? 'Shows before and after and always waits for a tap.' : 'Needs the typed word. A spoken yes is never accepted.'
      return '<div class="m-cardlet"><header>' + icon('sparkles') + '<span style="flex:1;min-width:0">' + esc(a.ask) + '</span><span class="m-pill ' + C.pill + '">' + esc(C.label) + '</span></header>' +
        '<div class="m-scroll"><table class="m-table">' + rows + '</table></div>' +
        '<div class="m-pad">' +
          (a.applies ? '<div class="m-understood"><span>Applies to: ' + esc(a.applies) + '.</span></div>' : '') +
          '<div class="m-understood"><span>Runs as ' + esc(who) + ' · ' + esc(MODULES[a.module]) + ', ' + esc(LEVELS[a.level]) + '</span></div>' +
          '<div class="m-understood"><span>' + after + '</span></div>' +
          (typed() ? '<div class="m-field"><label for="rg-word-in">Type ' + esc(word(a)) + ' to confirm</label><input class="m-input" id="rg-word-in" data-word-need="' + esc(word(a)) + '" autocomplete="off" autocapitalize="characters" placeholder="' + esc(word(a)) + '"></div>' : '') +
        '</div>' +
        '<footer><button type="button" class="m-btn ' + (typed() ? 'danger' : 'primary') + '" data-do="go"' + (typed() ? ' disabled' : '') + '>' + esc(a.go) + '</button><button type="button" class="m-btn ghost" data-do="cancel">Cancel</button></footer></div>'
    }

    const keyValue = a => a.key.map(k => { const i = a.inputs.filter(x => x.name === k)[0]; return i ? String(i.eg).toLowerCase() : k }).join(' / ')

    function auditHtml(o, a) {
      const head = n => '<div class="m-head">' + icon('list') + 'Done by Pepper<span class="count">' + n + '</span></div>'
      if (st.fail >= 0) return '<div class="m-card">' + head('no entry') + '<div class="m-pad"><p>No entry. Nothing changed, so nothing is listed and there is nothing to undo.</p></div></div>'
      if (st.cls === 'read') {
        return '<div class="m-card">' + head('1 entry') + '<div class="m-task"><span class="m-ico">' + icon('eye') + '</span><div class="what"><b>Looked something up</b><span>' + esc(venue) + ' · asked by ' + esc(who) + ' · 10:42</span></div><span class="m-pill">Read</span></div>' +
          '<div class="m-pad"><p class="rg-mut">A read is logged. It has nothing to undo.</p></div></div>'
      }
      const ctx = [venue].concat(a.inputs.filter(i => i.type === 'day' || i.type === 'week').map(i => showVal(i, i.eg)))
      const changed = a.inputs.filter(i => i.was !== undefined).map(i => i.label + ': ' + showVal(i, i.was) + ' to ' + showVal(i, i.eg))
      const what = changed.length ? changed : a.inputs.filter(i => ['venue', 'day', 'week', 'longtext'].indexOf(i.type) < 0).slice(0, 2).map(i => showVal(i, i.eg))
      return '<div class="m-card">' + head('1 entry') +
        '<div class="m-task"><span class="m-ico">' + icon(o.icon) + '</span><div class="what"><b>' + esc(a.done) + '</b><span>' + esc(ctx.join(' · ')) + '</span><span>' + esc(what.join(' · ')) + '</span></div>' +
          (st.inv ? '<button type="button" class="m-btn" data-do="undo">' + icon('undo') + 'Undo</button>' : '<span class="m-pill">No undo</span>') + '</div>' +
        '<div class="m-pad"><dl class="rg-kv">' +
          '<dt>Asked by</dt><dd>' + esc(who) + ', office tablet, 10:42</dd>' +
          '<dt>Confirmed by</dt><dd>' + esc(who) + (typed() ? ', by typing ' + esc(word(a)) : ', one tap') + '</dd>' +
          '<dt>Class</dt><dd>' + esc(CLASSES[st.cls].label) + '</dd>' +
          '<dt>Undo</dt><dd>' + (st.inv ? 'Runs <span class="mono">' + esc(invName(a)) + '</span>' + (a.inverse && a.inverseNote ? ', ' + esc(a.inverseNote) : '') : 'None. The action declares no inverse.') + '</dd>' +
          '<dt>Key</dt><dd class="mono">' + esc(keyValue(a)) + '</dd>' +
        '</dl></div></div>'
    }

    function toolText(a) {
      const asks = st.cls === 'read' ? 'no. A read runs and is logged.'
        : st.cls === 'reversible' ? 'yes, one tap on a Confirm card.'
        : st.cls === 'consequential' ? 'yes. The card shows before and after and waits for a tap.'
        : 'yes. The person types ' + word(a) + ' on the card. A spoken yes is not accepted.'
      const eg = a.inputs.map(i => i.name + ': ' + (i.type === 'lines' ? '[12 lines]' : JSON.stringify(i.eg))).join(', ')
      return [a.name, a.about, '', 'Needs: ' + MODULES[a.module] + ', ' + LEVELS[a.level] + '. Runs as the person asking.', 'Inputs:']
        .concat(a.inputs.map(i => '  ' + i.name + ': ' + typeWords(i) + (i.required ? ', needed' : ', optional') + (i.help ? '. ' + i.help : '')))
        .concat(['Works only when:'], a.pre.map(p => '  ' + p.check + '.'))
        .concat(['Asks first: ' + asks, 'Undo: ' + (st.inv ? invName(a) + '.' : 'none.'), 'Asked twice: done once (key: ' + a.key.join(' + ') + ').', 'Example: ' + a.name + '({ ' + eg + ' })'])
    }
    // Each line of the tool's words keeps its indent when it wraps.
    const toolHtml = a => toolText(a).map(l => { const lead = l.length - l.replace(/^ +/, '').length; return '<div style="padding-left:' + (lead + 2) + 'ch;text-indent:-2ch">' + (esc(l.trim()) || '&nbsp;') + '</div>' }).join('')

    function whyHtml(a) {
      return '<div class="m-card"><div class="m-head">' + icon('shield') + 'Rules checked first<span class="count">' + a.pre.length + (a.pre.length === 1 ? ' rule' : ' rules') + '</span></div><div class="m-list">' +
        a.pre.map((p, n) => '<button type="button" class="m-task rg-pre" data-pre="' + n + '" aria-pressed="' + (st.fail === n) + '">' +
          '<span class="m-ico">' + icon(st.fail === n ? 'x' : 'check') + '</span>' +
          '<span class="what"><b>' + esc(p.check) + '</b><span>' + (st.fail === n ? 'The person reads: ' : 'If it fails, the person reads: ') + esc(p.message) + '</span></span>' +
          '<span class="m-pill ' + (st.fail === n ? 'late">Fails' : 'ok">Passes') + '</span></button>').join('') +
        '</div><div class="m-pad"><p class="rg-mut">' + (st.fail >= 0 ? 'The Confirm card above has become the refusal. Tap the rule again to let it pass.' : 'Tap a rule to make it fail.') + '</p></div></div>'
    }

    function fieldHtml(i, n) {
      const id = 'rg-f-' + n
      const v = i.eg
      let ctl
      if (i.type === 'venue') ctl = '<select class="m-select" id="' + id + '">' + data.venues.map(x => '<option' + (x.name === v ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>'
      else if (i.type === 'choice') ctl = '<select class="m-select" id="' + id + '">' + (i.required ? '' : '<option value="">None</option>') + i.options.map(x => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
      else if (i.type === 'yesno') ctl = '<select class="m-select" id="' + id + '"><option' + (v ? '' : ' selected') + '>No</option><option' + (v ? ' selected' : '') + '>Yes</option></select>'
      else if (i.type === 'ref') ctl = '<select class="m-select" id="' + id + '"><option>' + esc(v) + '</option></select>'
      else if (i.type === 'day' || i.type === 'week') ctl = '<span class="rg-date"><button type="button" class="m-btn" tabindex="-1">' + icon('calendar') + '<span>' + esc(showVal(i, v)) + '</span></button><input type="date" id="' + id + '" value="' + esc(v) + '" data-kind="' + i.type + '"></span>'
      else if (i.type === 'longtext') ctl = '<textarea class="m-textarea" id="' + id + '">' + esc(v) + '</textarea>'
      else if (i.type === 'money') ctl = '<input class="m-input" id="' + id + '" inputmode="decimal" value="' + esc(Number(v).toFixed(2)) + '">'
      else if (i.type === 'temp') ctl = '<input class="m-input" id="' + id + '" inputmode="decimal" value="' + esc(v) + '">'
      else if (i.type === 'number') ctl = '<input class="m-input" id="' + id + '" inputmode="numeric" value="' + esc(v) + '">'
      else if (i.type === 'phone') ctl = '<input class="m-input" id="' + id + '" type="tel" inputmode="tel" value="' + esc(v) + '">'
      else if (i.type === 'email') ctl = '<input class="m-input" id="' + id + '" type="email" inputmode="email" value="' + esc(v) + '">'
      else if (i.type === 'time') ctl = '<input class="m-input" id="' + id + '" type="time" value="' + esc(v) + '">'
      else ctl = '<input class="m-input" id="' + id + '" value="' + esc(v) + '">'
      return '<div class="m-field' + (i.type === 'longtext' ? ' wide' : '') + '" data-f="' + n + '"><label for="' + id + '">' + esc(i.label) + (i.type === 'money' ? ' (£)' : i.type === 'temp' ? ' (°C)' : '') + (i.required ? '' : ' <span class="m-pill">Optional</span>') + '</label>' +
        ctl + (i.help ? '<span class="help">' + esc(i.help) + '</span>' : '') + '<span class="err" hidden></span></div>'
    }

    function formHtml(o, a) {
      if (a.form === 'flat') {
        return '<div class="m-card"><div class="m-head">' + icon('edit') + esc(a.title) + '<span class="count">' + a.inputs.length + ' fields from ' + a.inputs.length + ' inputs</span></div>' +
          '<div class="m-pad"><div class="m-form">' + a.inputs.map(fieldHtml).join('') + '</div><div class="rg-stop" id="rg-form-stop" role="alert" hidden></div>' +
          '<div class="row"><button type="button" class="m-btn primary" data-do="save">' + esc(a.go) + '</button></div></div></div>'
      }
      if (a.form === 'panel') {
        return '<div class="m-card"><div class="m-head">' + icon('lock') + esc(o.panel.name) + '<span class="count">hand-built panel</span></div>' +
          '<div class="m-pad"><p>This action keeps its hand-built panel. ' + esc(o.panel.why) + '</p><p class="rg-mut">The registry names the panel, so Pepper can open it already filled. It does not draw it.</p></div></div>'
      }
      return '<div class="m-card"><div class="m-head">' + icon('check') + 'No form<span class="count">' + a.inputs.length + (a.inputs.length === 1 ? ' input' : ' inputs') + '</span></div>' +
        '<div class="m-pad"><p>The Confirm card carries everything this action needs, so there is no form to draw.</p></div></div>'
    }

    // ── Part 4 and part 5 data ────────────────────────────────
    const WORDS = [
      { w: 'takings', hit: true }, { w: 'revenue', hit: true }, { w: 'sales after discounts', hit: true }, { w: 'profit', hit: false },
    ]
    const ITEM_TYPES = {
      food: { label: 'Food', icon: 'utensils', item: dish('padthai').name, price: dish('padthai').price, listed: 'Menu', addr: 'office.macaroonie.com/menus?edit=main&dish=pad-thai' },
      goods: { label: 'Goods', icon: 'tag', item: 'Thai House T-shirt', price: 1800, listed: 'Catalogue', addr: 'office.macaroonie.com/menus?edit=shop&dish=t-shirt' },
      service: { label: 'Service', icon: 'clock', item: 'Thai cooking class', price: 6500, listed: 'Catalogue', addr: 'office.macaroonie.com/menus?edit=classes&dish=cooking-class' },
    }
    const ITEM_FIELDS = [
      { label: 'Allergens and diet tags', icon: 'alert', food: ['on', 'Peanuts, egg, fish, soy. Checked for completeness.'], goods: ['hidden'], service: ['hidden'] },
      { label: 'Calories', icon: 'chart', food: ['on', '640 kcal'], goods: ['hidden'], service: ['hidden'] },
      { label: 'Kitchen screens, tickets and courses', icon: 'utensils', food: ['on', 'Wok station, main course'], goods: ['hidden', 'Off, unless switched on for the section.'], service: ['hidden'] },
      { label: 'SKU', icon: 'tag', food: ['optional', 'None set'], goods: ['on', 'TH-TEE'], service: ['optional', 'CLASS-2H, a service code'] },
      { label: 'Barcode (GTIN)', icon: 'box', food: ['optional', 'None set'], goods: ['on', '5012345678900, check digit passes'], service: ['optional', 'None set'] },
      { label: 'Variants with their own code and price', icon: 'list', food: ['on', 'Options, as now: chicken, prawn, tofu'], goods: ['on', 'S, M and L, each with a SKU and a barcode'], service: ['on', 'Length: 2 hours or 3 hours'] },
      { label: 'Stock per location', icon: 'store', food: ['recipes', 'Food stock goes through recipes.'], goods: ['on', data.venues.map((v, n) => v.name + ' ' + [14, 9, 0][n]).join(', ')], service: ['hidden'] },
      { label: 'Duration', icon: 'clock', food: ['hidden'], goods: ['hidden'], service: ['on', '2 hours'] },
      { label: 'Staff role', icon: 'users', food: ['hidden'], goods: ['hidden'], service: ['on', 'Head chef'] },
    ]
    const PILL = { on: '<span class="m-pill ok">On</span>', optional: '<span class="m-pill info">Optional</span>', hidden: '<span class="m-pill">Hidden</span>', recipes: '<span class="m-pill">Via recipes</span>' }
    let itemType = 'food'
    function itemHtml() {
      const t = ITEM_TYPES[itemType]
      const on = ITEM_FIELDS.filter(f => f[itemType][0] === 'on').length
      return App.mockBar(t.addr) + '<div class="m-main">' +
        '<div class="m-card"><div class="m-head">' + icon(t.icon) + esc(t.item) + '<span class="count">' + esc(money(t.price)) + '</span></div>' +
          '<div class="m-pad"><dl class="rg-kv"><dt>Type</dt><dd>' + esc(t.label) + '. Set on the menu, a section or the item. The most specific wins, as tax does.</dd><dt>Listed in a</dt><dd>' + esc(t.listed) + '</dd></dl></div></div>' +
        '<div class="m-card"><div class="m-head">' + icon('list') + 'Fields the type switches<span class="count">' + on + ' of ' + ITEM_FIELDS.length + ' on</span></div><div class="m-list">' +
          ITEM_FIELDS.map(f => { const s = f[itemType]; const hid = s[0] === 'hidden'
            return '<div class="m-task' + (hid ? ' rg-hid' : '') + '"><span class="m-ico">' + icon(f.icon) + '</span><div class="what"><b>' + esc(f.label) + '</b><span>' + (hid ? 'Hidden for ' + esc(lower(t.label)) + '. Values kept. ' : '') + esc(s[1] || '') + '</span></div>' + PILL[s[0]] + '</div>' }).join('') +
        '</div></div></div>'
    }

    // ── The page ──────────────────────────────────────────────
    const link = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener">' + esc(text) + '</a>'
    const part = (n, title) => '<div class="rg-part"><span class="eyebrow">Part ' + n + '</span><h2>' + esc(title) + '</h2></div>'

    root.innerHTML = `
      <style>
        #view-registry .rg-part { display: grid; gap: 4px; }
        #view-registry .rg-chip { border-radius: 999px; }
        #view-registry .rg-ico { width: 34px; height: 34px; flex: none; border-radius: 8px; background: var(--brand-soft); color: var(--brand); display: inline-flex; align-items: center; justify-content: center; }
        #view-registry .rg-ico svg { width: 17px; height: 17px; }
        #view-registry .rg-in, #view-registry .rg-vocab { min-width: 0; }
        #view-registry .rg-nm { display: inline-block; margin-right: 18px; white-space: nowrap; }
        @media (max-width: 640px) { #view-registry .rg-nm { display: block; margin-right: 0; } }
        #view-registry .rg-start { align-content: start; }
        #view-registry .rg-wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
        #view-registry .rg-edit { gap: 8px; }
        @media (min-width: 981px) { #view-registry .rg-edit { position: sticky; top: var(--rg-top, 110px); z-index: 5; box-shadow: var(--shadow); } }
        #view-registry .rg-pvs { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); align-items: start; }
        #view-registry .rg-pvs > * { min-width: 0; }
        #view-registry .rg-full { grid-column: 1 / -1; }
        #view-registry .rg-pv.rg-flash { outline: 2px solid var(--rose); outline-offset: 2px; }
        #view-registry .mock svg { width: 16px; height: 16px; flex: none; }
        #view-registry .mock p { font-size: 13.5px; }
        #view-registry .mock .rg-mut { color: var(--m-muted); font-size: 12.5px; }
        #view-registry .mock .rg-k { color: var(--m-muted); width: 40%; }
        #view-registry .mock .m-diff { flex-wrap: wrap; }
        #view-registry .mock .m-diff svg { width: 14px; height: 14px; color: var(--m-muted); }
        #view-registry .mock .rg-refuse > header { background: var(--m-bad-soft); color: var(--m-bad); }
        #view-registry .mock button.rg-pre { width: 100%; text-align: left; background: transparent; border: 0; border-top: 1px solid var(--m-line); color: var(--m-ink); font-size: 14px; touch-action: manipulation; }
        #view-registry .mock button.rg-pre:first-child { border-top: 0; }
        #view-registry .mock button.rg-pre[aria-pressed="true"] { background: var(--m-bad-soft); }
        #view-registry .mock .m-form .m-field { align-content: start; }
        #view-registry .mock .m-form .m-field > label { min-height: 20px; }
        #view-registry .mock .rg-date { position: relative; display: block; }
        #view-registry .mock .rg-date .m-btn { width: 100%; justify-content: flex-start; }
        #view-registry .mock .rg-date input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
        #view-registry .mock .rg-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; font-size: 13px; margin: 0; }
        #view-registry .mock .rg-kv dt { color: var(--m-muted); }
        #view-registry .mock .rg-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
        #view-registry .mock .rg-stop { background: var(--m-bad-soft); color: var(--m-bad); border-radius: 8px; padding: 10px 12px; font-size: 13.5px; font-weight: 500; }
        #view-registry .mock .rg-hid .what b, #view-registry .mock .rg-hid .m-ico { color: var(--m-muted); font-weight: 500; }
      </style>

      <div class="view-head">
        <span class="eyebrow">Underneath · the data framework</span>
        <h1>Under the surface: one registry that describes what exists</h1>
        <p class="lede">The data framework the owner asked for is a registry. It gives each business object one record and each action one declaration. The Confirm card, the audit trail, Pepper's tools and the simple forms are then drawn from those, so they cannot disagree.</p>
      </div>

      <div class="stack" style="gap:30px">
        <div class="stage">
          ${App.brief({
            what: 'One record per business object names its table, its report subject, the page that opens one, the actions that change it and the form that edits it. Each action is declared once, as data. Everything in part 3 is drawn from that declaration by code.',
            tryThis: [
              'Pick an object, then one of its actions.',
              'Switch the class to Destructive and watch the Confirm card.',
              'Turn off Has an inverse. Undo leaves the audit entry.',
              'Make a precondition fail and read the refusal.',
              'On Expense, empty the Amount field and press Add expense.',
            ],
            why: [
              { text: 'Typed actions, the person\'s own permissions and confirmation of a preview the system builds. Vendor practice, security guidance and Macaroonie\'s own design agree.', confidence: 'high' },
              { text: 'A curated catalogue beats queries written by the model. Two 2026 benchmarks report a semantic layer adding 17 to 23 points, and 98.2% against 90.0%. Both are small or vendor-run. <span class="tag medium">Medium to high confidence</span>' },
              { text: 'Usage examples on tools raised accuracy on complex parameters from 72% to 90% in the model maker\'s own tests (' + link('https://www.anthropic.com/engineering/advanced-tool-use', 'Anthropic') + ').' },
              { text: 'The action as the unit of safety follows Palantir\'s published action types: an action can be submitted only if all its criteria pass (' + link('https://palantir.com/docs/foundry/action-types/submission-criteria/', 'Palantir') + ').' },
            ],
            status: [
              { kind: 'built', text: 'A report catalogue of 136 subjects, 46 permission modules, 77 shared rule files, 159 typed tools and 560 server validation schemas.' },
              { kind: 'target', text: 'There is no single registry of objects, actions or forms yet. The existing lists share only a module key.' },
            ],
            calls: 'None. The registry is data, and code draws every surface on this page from it.',
          })}

          <div class="stack" style="gap:26px">
            <div class="note">Example names and data. Thai House is made up. Table, subject and tool names follow Macaroonie's real ones where they exist. The registry itself, the actions marked as examples and the addresses marked as targets are proposals.</div>

            <section class="stack">
              ${part(1, 'One record per business object')}
              <div class="row" id="rg-objects" role="group" aria-label="Business object">
                ${OBJECTS.map((o, n) => `<button type="button" class="btn rg-chip" data-obj="${n}" aria-pressed="${n === 0}">${icon(o.icon)}${esc(o.label)}</button>`).join('')}
              </div>
              <div class="card" id="rg-record"></div>
            </section>

            <section class="stack">
              ${part(2, 'One action, declared once')}
              <div class="row" id="rg-actions" role="group" aria-label="Action"></div>
              <div class="card" id="rg-decl"></div>
              <p class="small muted">Today a tool declares its inputs and its permission. Preconditions with their messages, the class, the key and the inverse are step 4 of the plan.</p>
            </section>

            <section class="stack">
              ${part(3, 'What is drawn from that one declaration')}
              <div class="card rg-edit">
                <div class="row"><h3>Edit the declaration</h3><span class="tag target" id="rg-edited" hidden>Edited</span><span class="spacer"></span><span class="small muted" id="rg-edit-name"></span></div>
                <div class="row">
                  <div class="seg" id="rg-class" role="group" aria-label="Consequence class">${Object.keys(CLASSES).map(k => `<button type="button" data-cls="${k}" aria-pressed="false">${esc(CLASSES[k].label)}</button>`).join('')}</div>
                </div>
                <div class="row">
                  <button type="button" class="btn" id="rg-inv" aria-pressed="true">${icon('undo')}Has an inverse</button>
                  <button type="button" class="btn" id="rg-fail" aria-pressed="false">${icon('alert')}Make a precondition fail</button>
                  <button type="button" class="btn" id="rg-reset">Put the declared values back</button>
                </div>
              </div>
              <div class="rg-pvs">
                <div class="stack">
                  <article class="card rg-pv" id="rg-pv-card"><h3>The Confirm card</h3><p class="small muted">From the title, the inputs, the class and the inverse.</p><div class="mock"><div class="m-pad" id="rg-card"></div></div></article>
                  <article class="card rg-pv" id="rg-pv-why"><h3>The reason it will not run</h3><p class="small muted">From the preconditions and their messages.</p><div class="mock"><div class="m-pad" id="rg-why"></div></div></article>
                </div>
                <div class="stack">
                  <article class="card rg-pv" id="rg-pv-audit"><h3>The audit entry</h3><p class="small muted">From the title, the class, the key and the inverse.</p><div class="mock"><div class="m-pad" id="rg-audit"></div></div></article>
                  <article class="card rg-pv" id="rg-pv-tool"><h3>What Pepper's tool is told</h3><p class="small muted">From every part of the declaration, with one worked example.</p><pre class="code rg-wrap" id="rg-tool"></pre></article>
                </div>
                <article class="card rg-pv rg-full" id="rg-pv-form"><h3>The form, when the action is flat</h3><p class="small muted">From the inputs: one field per input, the same checks the server makes, one Save.</p><div class="mock"><div class="m-pad" id="rg-form"></div></div></article>
              </div>
              <div class="row"><button type="button" class="btn" data-go="confirm">Open the Confirm card mock-up ${icon('right')}</button><button type="button" class="btn" data-go="review">Open For review ${icon('right')}</button></div>
            </section>
          </div>
        </div>

        <section class="stack">
          ${part(4, 'One vocabulary')}
          <p class="muted" style="max-width:70ch">Today one thing has a different name in each layer. The registry uses the report catalogue's subject names everywhere, so a person, a page, a report and Pepper mean the same thing by the same word.</p>
          <div class="tblwrap"><table class="tbl rg-vocab">
            <thead><tr><th>Thing</th><th>Names today</th><th>The catalogue's name</th></tr></thead>
            <tbody>
              ${[['Staff', 'cash_staff', 'staff', 'list_staff', 'staff.people'], ['Dishes', 'menu_items', 'menus', 'find_dishes', 'menu.dishes'], ['Online orders', 'orders', 'web_orders', 'online_orders', 'online.orders']].map(r => `
              <tr><td>${r[0]}</td><td>${['table', 'module', 'tool'].map((kind, n) => `<span class="rg-nm"><span class="mono">${r[n + 1]}</span> <span class="muted small">${kind}</span></span>`).join('')}</td><td class="mono"><b>${r[4]}</b></td></tr>`).join('')}
            </tbody>
          </table></div>
          <div class="card">
            <div class="row"><h3>A measure made easier for Pepper</h3><span class="tag target">Target, not built</span></div>
            <div class="grid c2">
              <div class="stack rg-start">
                <dl class="kv">
                  <dt>Measure</dt><dd>Net sales <span class="mono muted">till.checks.net_sales</span></dd>
                  <dt>Means</dt><dd>Gross sales less discounts. VAT is included; charges and tips are not.</dd>
                  <dt>Also called</dt><dd>takings, revenue, sales after discounts</dd>
                  <dt>Example</dt><dd>What were takings at ${esc(venue)} on Friday?</dd>
                  <dt>Maps to</dt><dd>Net sales, ${esc(venue)}, ${esc(fmtDay('2026-11-20'))}. The report engine works out the figure.</dd>
                </dl>
                <p class="small muted">Try a word a manager might use.</p>
                <div class="row" id="rg-words" role="group" aria-label="Word in a question">${WORDS.map((x, n) => `<button type="button" class="btn rg-chip" data-word="${n}" aria-pressed="${n === 0}">${esc(x.w)}</button>`).join('')}</div>
                <div class="note" id="rg-word-out" role="status"></div>
              </div>
              <pre class="code">${esc([
                'measure(\'net_sales\', {',
                '  subject: \'till.checks\',',
                '  label: \'Net sales\',',
                '  about: \'Gross sales less discounts. VAT is \' +',
                '    \'included; charges and tips are not.\',',
                '  ai_context: {',
                '    synonyms: [\'takings\', \'revenue\',',
                '      \'sales after discounts\'],',
                '    examples: [{',
                '      ask: \'What were takings at ' + venue + ' on Friday?\',',
                '      plan: { measure: \'till.checks.net_sales\',',
                '        venue: \'' + venue + '\', day: \'2026-11-20\' },',
                '    }],',
                '  },',
                '})',
              ].join('\n'))}</pre>
            </div>
            <p class="small muted">Synonyms and a worked example per field are the idea a semantic-layer standard calls <span class="mono">ai_context</span> (${link('https://github.com/open-semantic-interchange/OSI/blob/main/core-spec/spec.md', 'Ossie specification')}). The report calls them the cheapest accuracy gain available.</p>
          </div>
        </section>

        <section class="stack">
          ${part(5, 'Restaurant and retail in one catalogue')}
          <div class="stage">
            ${App.brief({
              what: 'One catalogue holds food, retail goods and services. Each item has a type, and the type switches fields on and off.',
              tryThis: ['Switch between Food, Goods and Service and watch which fields turn on.'],
              why: [{ text: 'A restaurant platform\'s first additions for retail are an item type, a product code and barcode, and stock per location.' }],
              status: [{ kind: 'target', text: 'Designed in docs/CATALOGUE.md and not built. Today a menu has no type and items have no SKU or barcode.' }],
            })}
            <div class="stack">
              <div class="row"><span class="small muted">Item type</span><div class="seg" id="rg-types" role="group" aria-label="Item type">${Object.keys(ITEM_TYPES).map(k => `<button type="button" data-type="${k}" aria-pressed="${k === itemType}">${esc(ITEM_TYPES[k].label)}</button>`).join('')}</div></div>
              <div class="mock" id="rg-item"></div>
              <p class="small muted">Changing an item's type deletes nothing. Hidden fields keep their values, so switching back loses nothing.</p>
              <div class="note">Nothing in the evidence shows an opening in general retail for a newcomer that starts in hospitality. Food-led and franchise retail, after stock on hand exists, is a hypothesis to test.</div>
            </div>
          </div>
        </section>

        <section class="stack">
          ${part(6, 'What the registry is not')}
          <div class="grid c3">
            <article class="card"><div class="row"><span class="tag no">Do not build</span></div><h3>A run-time metadata engine</h3><p class="muted">Tables, forms and screens generated from metadata while the app runs.</p></article>
            <article class="card"><div class="row"><span class="tag no">Do not build</span></div><h3>Customer-defined tables</h3><p class="muted">A group adding tables of its own. Custom fields, if they come, go in the same field registry, so reports, simple forms and Pepper pick them up.</p></article>
            <article class="card"><div class="row"><span class="tag no">Do not build</span></div><h3>Queries written by the model</h3><p class="muted">Pepper names a measure from the catalogue. The report engine writes the query and does the sums.</p></article>
          </div>
          <div class="note">Platforms that generate everything from metadata were built that way from their first day (${link('https://github.com/frappe/frappe', 'Frappe')}). Retrofitting that onto about 245 existing tables is a rewrite. Describing what exists is not.</div>
        </section>

        <section class="stack">
          ${part(7, 'Two standards worth a place now')}
          <div class="grid c2">
            <div class="card">
              <h3>A product code (GTIN) on inventory items and supplier products</h3>
              <p class="muted">The number under the barcode. One field on each, checked by its last digit.</p>
              <dl class="kv">
                <dt>Inventory item</dt><dd>Coconut milk, 400 ml tin</dd>
                <dt>Supplier product</dt><dd>${esc(supplier)}, case of 12</dd>
              </dl>
              <pre class="code">${esc([
                'inventory_item({',
                '  name: \'Coconut milk, 400 ml tin\',',
                '  gtin: \'5012345678948\',',
                '})',
                'supplier_product({',
                '  supplier: \'' + supplier + '\',',
                '  pack: \'case of 12\',',
                '  gtin: \'5060123456783\',',
                '})',
              ].join('\n'))}</pre>
            </div>
            <div class="card">
              <h3>Supplier invoices held as structured data</h3>
              <p>UK mandatory e-invoicing for domestic business invoices is confirmed from April 2029 (${link('https://kpmg.com/us/en/taxnewsflash/news/2026/10/uk-b2b-e-invoicing-roadmap-april-2029.html', 'KPMG')}). The date rests on secondary sources, so check it before relying on it. <span class="tag medium">Medium confidence</span></p>
              <pre class="code">${esc([
                'invoice({',
                '  supplier: \'' + supplier + '\',',
                '  number: \'LV-20418\', date: \'2026-11-22\',',
                '  lines: [',
                '    { gtin: \'5060123456783\', qty: 4,',
                '      unit_price: 14.20, vat_rate: 0 },',
                '    // 11 more lines',
                '  ],',
                '  net: 262.10, vat: 24.30, total: 286.40,',
                '})',
              ].join('\n'))}</pre>
            </div>
          </div>
          <p class="small muted">These two and nothing more for now.</p>
        </section>
      </div>`

    // ── Drawing ───────────────────────────────────────────────
    const $ = sel => root.querySelector(sel)
    const TARGETS = { card: 'rg-pv-card', why: 'rg-pv-why', audit: 'rg-pv-audit', tool: 'rg-pv-tool', form: 'rg-pv-form' }
    const drawn = {} // what each preview last showed, so only the ones that change are drawn again

    function drawRecord() {
      const o = obj()
      root.querySelectorAll('#rg-objects [data-obj]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.obj) === st.obj)))
      $('#rg-record').innerHTML =
        '<div class="row"><span class="rg-ico">' + icon(o.icon) + '</span><h3>' + esc(o.label) + '</h3><span class="spacer"></span><span class="small muted">one record in the registry</span></div>' +
        '<div class="grid c2"><dl class="kv">' +
          '<dt>Table</dt><dd class="mono">' + esc(o.table) + '</dd>' +
          '<dt>Report subject</dt><dd><span class="mono">' + esc(o.subject) + '</span> <span class="muted">' + esc(o.subjectLabel) + ', the catalogue\'s name</span></dd>' +
          '<dt>Opens at</dt><dd><span class="mono">' + esc(o.page) + '</span><br><span class="muted small">For example ' + esc(o.pageEg) + '. ' + esc(o.pageNote || '') + '</span> <span class="tag ' + (o.pageBuilt ? 'built">Works today' : 'target">Target, not built') + '</span></dd>' +
          '<dt>Changed by</dt><dd><div class="row">' + o.actions.map((a, n) => '<button type="button" class="btn mono" data-act="' + n + '" aria-pressed="' + (n === st.act) + '">' + esc(a.name) + '</button>').join('') + '</div></dd>' +
          '<dt>Edited in</dt><dd>' + (o.panel ? 'A hand-built panel: ' + esc(o.panel.name) : 'A form drawn from the rules') + '</dd>' +
          '<dt>Permission</dt><dd><span class="mono">' + esc(o.module) + '</span> <span class="muted">' + esc(MODULES[o.module]) + '</span></dd>' +
        '</dl><pre class="code">' + esc(recordCode(o)) + '</pre></div>'
    }

    function drawDecl() {
      const o = obj(), a = act(), C = CLASSES[st.cls]
      $('#rg-actions').innerHTML = o.actions.map((x, n) => '<button type="button" class="btn rg-chip mono" data-act="' + n + '" aria-pressed="' + (n === st.act) + '">' + esc(x.name) + '</button>').join('')
      root.querySelectorAll('#rg-record [data-act]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.act) === st.act)))
      $('#rg-decl').innerHTML =
        '<div class="row"><h3 class="mono">' + esc(a.name) + '</h3><span class="muted">' + esc(a.title) + '</span><span class="spacer"></span><span class="tag ' + (a.real ? 'built">A Pepper tool today' : '">Example action') + '</span></div>' +
        '<div class="grid c2"><div class="stack">' +
          '<div class="tblwrap"><table class="tbl rg-in"><thead><tr><th>Input</th><th>Type</th><th>Needed</th></tr></thead><tbody>' +
            a.inputs.map(i => '<tr><td class="mono">' + esc(i.name) + '</td><td>' + (i.type === 'ref' ? '<span class="mono">' + esc(i.subject) + '</span> record' : esc(TYPE[i.type] || i.type)) + '</td><td>' + (i.required ? 'Yes' : 'No') + '</td></tr>').join('') +
          '</tbody></table></div>' +
          '<dl class="kv">' +
            '<dt>Permission</dt><dd>' + esc(MODULES[a.module]) + ', ' + esc(LEVELS[a.level]) + ' <span class="mono muted">' + esc(a.module) + ' · ' + esc(a.level) + '</span></dd>' +
            '<dt>Preconditions</dt><dd><ol class="list">' + a.pre.map(p => '<li><b>' + esc(p.check) + '</b> <span class="mono muted small">' + esc(p.rule) + '</span><br><span class="muted">If it fails, the person reads: ' + esc(p.message) + '</span></li>').join('') + '</ol></dd>' +
            '<dt>Class</dt><dd><span class="tag ' + C.tag + '">' + esc(C.label) + '</span>' + (st.cls !== a.cls ? ' <span class="muted small">declared as ' + esc(lower(CLASSES[a.cls].label)) + ', edited in part 3</span>' : '') + '</dd>' +
            '<dt>So it confirms by</dt><dd>' + esc(confirmRule()) + '</dd>' +
            '<dt>Idempotency key</dt><dd><span class="mono">' + esc(a.key.join(' + ')) + '</span><br><span class="muted small">The same request sent twice is done once.</span></dd>' +
            '<dt>Inverse</dt><dd>' + (st.inv ? '<span class="mono">' + esc(invName(a)) + '</span>' + (a.inverse && a.inverseNote ? ' <span class="muted">' + esc(a.inverseNote) + '</span>' : '') + (a.inverse ? '' : ' <span class="muted small">added in part 3</span>') : 'None' + (a.inverse ? ' <span class="muted small">removed in part 3</span>' : '')) + '</dd>' +
          '</dl></div>' +
          '<pre class="code">' + esc(declCode(a)) + '</pre></div>'
    }

    function drawPreviews(flash) {
      const o = obj(), a = act()
      const made = { card: cardHtml(a), why: whyHtml(a), audit: auditHtml(o, a), tool: toolHtml(a), form: formHtml(o, a) }
      Object.keys(made).forEach(k => {
        if (drawn[k] === made[k]) return
        drawn[k] = made[k]
        $('#rg-' + k).innerHTML = made[k]
        $('#' + TARGETS[k]).querySelectorAll('.m-toast').forEach(t => t.remove())
        if (flash) {
          const pv = $('#' + TARGETS[k])
          pv.classList.add('rg-flash')
          setTimeout(() => pv.classList.remove('rg-flash'), 1100)
        }
      })
      root.querySelectorAll('#rg-class [data-cls]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cls === st.cls)))
      $('#rg-inv').setAttribute('aria-pressed', String(st.inv))
      $('#rg-fail').setAttribute('aria-pressed', String(st.fail >= 0))
      $('#rg-edited').hidden = !edited()
      $('#rg-edit-name').textContent = a.name
    }

    const drawAll = flash => { drawRecord(); drawDecl(); drawPreviews(flash) }
    const drawEdit = () => { drawDecl(); drawPreviews(true) }

    function drawWord(n) {
      const x = WORDS[n]
      root.querySelectorAll('#rg-words [data-word]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.word) === n)))
      $('#rg-word-out').innerHTML = x.hit
        ? '<b>' + esc(x.w) + '</b> is a synonym of Net sales, so Pepper asks the report engine for <span class="mono">till.checks.net_sales</span>.'
        : '<b>' + esc(x.w) + '</b> matches nothing in the catalogue, so Pepper says: That is not something reports cover yet. It does not guess.'
    }

    function drawItem() {
      root.querySelectorAll('#rg-types [data-type]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === itemType)))
      $('#rg-item').innerHTML = itemHtml()
    }

    // The form's Save: the checks come from the same inputs the form was drawn from.
    function saveForm(btn) {
      const a = act(), mock = btn.closest('.mock')
      let first = null
      a.inputs.forEach((i, n) => {
        const f = mock.querySelector('[data-f="' + n + '"]'), c = mock.querySelector('#rg-f-' + n)
        if (!f || !c) return
        const v = String(c.value || '').trim()
        let err = ''
        if (i.required && !v) err = i.label + ' is needed.'
        else if (v && i.type === 'money' && !/^\d+(\.\d{1,2})?$/.test(v)) err = i.label + ' must be an amount in pounds, like 18.40.'
        else if (v && i.type === 'phone' && !/^[\d +()-]{7,}$/.test(v)) err = i.label + ' must be a phone number.'
        else if (v && i.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) err = i.label + ' must be an email address.'
        f.classList.toggle('error', !!err)
        const e = f.querySelector('.err'); e.textContent = err; e.hidden = !err
        if (err && !first) first = c
      })
      const stop = mock.querySelector('#rg-form-stop')
      stop.hidden = true
      if (first) {
        // Keep the field clear of the bars that stick to the top of the page.
        first.focus({ preventScroll: true })
        const r = first.getBoundingClientRect(), edit = root.querySelector('.rg-edit').getBoundingClientRect()
        if (r.top < Math.max(edit.bottom, 0) + 8 || r.bottom > window.innerHeight) first.scrollIntoView({ block: 'center' })
        return
      }
      if (st.fail >= 0) { stop.textContent = a.pre[st.fail].message; stop.hidden = false; return }
      App.toast(mock, a.done + '. Mock-up: nothing is stored.')
    }

    root.addEventListener('click', e => {
      const t = e.target.closest('button')
      if (!t || !root.contains(t)) return
      const d = t.dataset
      if (d.go) return App.go(d.go)
      if (d.obj !== undefined) { pick(Number(d.obj), 0); return drawAll(false) }
      if (d.act !== undefined) { pick(st.obj, Number(d.act)); return drawAll(false) }
      if (d.cls) { st.cls = d.cls; return drawEdit() }
      if (t.id === 'rg-inv') { st.inv = !st.inv; return drawEdit() }
      if (t.id === 'rg-fail') { st.fail = st.fail >= 0 ? -1 : 0; return drawEdit() }
      if (t.id === 'rg-reset') { pick(st.obj, st.act); return drawEdit() }
      if (d.pre !== undefined) {
        st.fail = st.fail === Number(d.pre) ? -1 : Number(d.pre)
        drawEdit()
        const again = root.querySelector('[data-pre="' + d.pre + '"]')
        if (again) again.focus()
        return
      }
      if (d.word !== undefined) return drawWord(Number(d.word))
      if (d.type) { itemType = d.type; return drawItem() }
      const mock = t.closest('.mock')
      if (d.do === 'go') return App.toast(mock, act().done + '. Mock-up: nothing is stored.', st.inv ? { undo: () => App.toast(mock, 'Undone by ' + invName(act()) + '.') } : {})
      if (d.do === 'cancel') return App.toast(mock, 'Cancelled. Nothing changed.')
      if (d.do === 'undo') return App.toast(mock, 'Undone by ' + invName(act()) + '.')
      if (d.do === 'save') return saveForm(t)
    })
    root.addEventListener('input', e => {
      const t = e.target
      if (t.id === 'rg-word-in') {
        const go = t.closest('.m-cardlet').querySelector('[data-do="go"]')
        go.disabled = t.value.trim().toUpperCase() !== t.dataset.wordNeed
      } else if (t.type === 'date' && t.closest('.rg-date')) {
        if (t.value) t.closest('.rg-date').querySelector('button span').textContent = (t.dataset.kind === 'week' ? 'Week of ' : '') + fmtDay(t.value)
      } else if (t.closest && t.closest('.m-field.error')) {
        const f = t.closest('.m-field'); f.classList.remove('error'); f.querySelector('.err').hidden = true
      }
    })

    // The edit bar sticks under the page's own bar on a wide screen.
    const setTop = () => { const bar = document.querySelector('.topbar'); root.style.setProperty('--rg-top', ((bar ? bar.offsetHeight : 100) + 10) + 'px') }
    setTop()
    window.addEventListener('resize', setTop)

    pick(0, 0)
    drawAll(false)
    drawWord(0)
    drawItem()
  },
})
