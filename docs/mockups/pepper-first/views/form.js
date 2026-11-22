// The filled form: the answer to "dynamically generated forms".
// Part 1: a real form panel opens with the values Pepper proposed from typed
// words, speech or a photographed delivery note. Each proposed value is marked
// until the person checks it, a measured value is confirmed by the person, the
// panel applies its own rules, there is one Save, and the conversation keeps a
// summary line with Edit.
// Part 2: the two kinds of form behind that pattern: a hand-built panel (a
// cash-up) and flat set-up forms drawn by one small renderer from a definition.
// Source: reports/AI first back office strategy.md (22 Nov 2026), "The filled
// form". Everything is scripted: no model runs and nothing is saved.
App.view('form', {
  label: 'Filled form',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, money } = App
    const D = App.data
    const TODAY = '2026-11-22'
    const YESTERDAY = '2026-11-21'
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const SUPPLIERS = D.suppliers.map(s => s.name)
    const VENUES = D.venues.map(v => v.name)

    /** 2026-11-22 as Sun 22 Nov 2026 ('' when it is not a day). */
    const niceDate = iso => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
      if (!m) return ''
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      return DAY[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1]
    }
    /** A typed number, or null when the text is not one. */
    const num = s => {
      const t = String(s == null ? '' : s).trim().replace(/^£/, '').replace(/,/g, '')
      return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null
    }
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
    /** Sets an element's HTML only when it changed, so a control keeps its focus. */
    const put = (node, html) => { if (node && node.fmHtml !== html) { node.fmHtml = html; node.innerHTML = html } }

    // ── Controls: one per field type, used by the panels and the renderer ──
    function control(f, id, value) {
      const v = value == null ? '' : String(value)
      const hint = f.example != null ? 'e.g. ' + f.example : (f.placeholder || '')
      const ph = hint ? ' placeholder="' + esc(hint) + '"' : ''
      const base = ' id="' + id + '" data-f="' + f.name + '"'
      if (f.type === 'select') {
        return '<select class="m-select"' + base + '><option value="">Choose</option>' +
          f.options.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>'
      }
      if (f.type === 'date') {
        // The product's date control: a styled face with the real date input lying over it, unseen.
        const empty = f.example ? 'e.g. ' + niceDate(f.example) : 'Choose a day'
        return '<span class="fm-date"><span class="m-input fm-face' + (v ? '' : ' none') + '" data-empty="' + esc(empty) + '">' + icon('calendar') +
          '<span>' + esc(niceDate(v) || empty) + '</span></span><input type="date"' + base + ' value="' + esc(v) + '"></span>'
      }
      if (f.type === 'yesno') {
        return '<span class="fm-yn" role="group" aria-labelledby="' + id + '-l">' + ['Yes', 'No'].map(o =>
          '<button type="button" class="m-btn" data-f="' + f.name + '" data-yn="' + o + '" aria-pressed="' + (v === o) + '">' + o + '</button>').join('') + '</span>'
      }
      if (f.type === 'textarea') return '<textarea class="m-textarea"' + base + ph + '>' + esc(v) + '</textarea>'
      const kind = { text: 'type="text"', number: 'type="text" inputmode="decimal"', email: 'type="email" inputmode="email"', phone: 'type="tel" inputmode="tel"' }[f.type]
      const input = '<input class="m-input" ' + kind + ' autocomplete="off"' + base + ' value="' + esc(v) + '"' + ph + '>'
      if (!f.unit) return input
      const unit = '<span>' + esc(f.unit) + '</span>'
      return '<span class="fm-unit">' + (f.unitFirst ? unit + input : input + unit) + '</span>'
    }
    /** A field: label (with a slot for a mark), control (with a slot for a button), help, error. */
    function fieldHtml(f, id, value, mark) {
      const head = '<span>' + esc(f.label) + '</span><span data-pill>' + (mark || '') + '</span>'
      const label = f.type === 'yesno' ? '<span class="m-label" id="' + id + '-l">' + head + '</span>' : '<label for="' + id + '">' + head + '</label>'
      return '<div class="m-field' + (f.wide ? ' wide' : '') + '" data-field="' + f.name + '">' + label +
        '<div class="fm-ctl"><div class="fm-in">' + control(f, id, value) + '</div><span class="fm-act" data-act hidden></span></div>' +
        (f.help ? '<div class="help">' + esc(f.help) + '</div>' : '') +
        '<div class="err" data-err hidden></div></div>'
    }
    /** Reports every change in a box of controls: onChange(field name, value). */
    function wire(box, onChange) {
      const changed = e => {
        const t = e.target
        if (!t.dataset || !t.dataset.f || t.dataset.yn) return
        if (t.type === 'date') {
          const face = t.parentNode.querySelector('.fm-face')
          face.classList.toggle('none', !t.value)
          face.lastElementChild.textContent = niceDate(t.value) || face.dataset.empty
        }
        onChange(t.dataset.f, t.value)
      }
      box.addEventListener('input', changed)
      box.addEventListener('change', changed)
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-yn]')
        if (!b) return
        b.parentNode.querySelectorAll('[data-yn]').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
        onChange(b.dataset.f, b.dataset.yn)
      })
    }

    // ── Part 1: the two panels Pepper can choose, with their own rules ────
    const FORMS = {
      delivery: {
        icon: 'truck', title: 'Delivery check', save: 'Save check', done: 'Delivery check saved', ruleAfter: 'chilled',
        fields: [
          { name: 'supplier', label: 'Supplier', type: 'select', options: SUPPLIERS },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'short', label: 'Items short or rejected', type: 'text', wide: true, placeholder: 'Leave empty if everything arrived' },
          { name: 'temp', label: 'Van temperature', type: 'number', unit: '°C', help: 'A measured value. You type it or say it. Pepper never infers one.' },
          { name: 'chilled', label: 'Chilled goods accepted', type: 'yesno' },
          { name: 'action', label: 'Corrective action', type: 'text', wide: true, placeholder: 'What you did about it' },
          { name: 'notes', label: 'Notes', type: 'textarea', wide: true, placeholder: 'Anything else about this delivery' },
        ],
        hot(v) { const t = num(v.temp); return t != null && t > 5 && t <= 40 },
        needs(v) { return this.hot(v) ? { chilled: true, action: true } : {} },
        rule(v) { return this.hot(v) ? 'The van is over 5\u00a0°C. Before this saves, the form needs an answer on chilled goods and a corrective action. This rule belongs to the form. Pepper did not add it.' : '' },
        check(v, s) {
          const e = {}
          const t = num(v.temp)
          if (!v.supplier) e.supplier = 'Choose the supplier.'
          if (!v.date) e.date = 'Choose the day.'
          if (!String(v.temp).trim()) e.temp = 'Type the temperature shown on the van.'
          else if (t == null || t < -30 || t > 40) e.temp = 'Type a temperature between -30 and 40.'
          else if (s.origin.temp === 'said' && !s.checked.temp) e.temp = 'Confirm the ' + s.ex.said.temp + ' you said, or type the reading.'
          if (this.hot(v)) {
            if (!v.chilled) e.chilled = 'The van is over 5\u00a0°C. Say if the chilled goods were accepted.'
            if (!String(v.action).trim()) e.action = 'The van is over 5\u00a0°C. Say what you did about it.'
          }
          return e
        },
        summary(v) {
          return [v.supplier, niceDate(v.date), String(v.short).trim() || 'Nothing short', 'Van ' + String(v.temp).trim() + '\u00a0°C',
            v.chilled ? 'Chilled goods ' + (v.chilled === 'Yes' ? 'accepted' : 'not accepted') : '',
            String(v.action).trim() ? 'Action: ' + String(v.action).trim() : '', String(v.notes).trim() ? 'Note: ' + String(v.notes).trim() : ''].filter(Boolean)
        },
      },
      expense: {
        icon: 'cash', title: 'Expense', save: 'Save expense', done: 'Expense saved',
        fields: [
          { name: 'amount', label: 'Amount', type: 'number', unit: '£', unitFirst: true },
          { name: 'supplier', label: 'Supplier', type: 'select', options: SUPPLIERS },
          { name: 'category', label: 'Category', type: 'select', options: ['Food and drink', 'Cleaning', 'Repairs', 'Staff', 'Other'] },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'paid', label: 'Paid from', type: 'select', options: ['Petty cash', 'Till', 'Company card'] },
          { name: 'note', label: 'Note', type: 'text', placeholder: 'What it was for' },
        ],
        needs() { return {} },
        rule() { return '' },
        check(v) {
          const e = {}
          const a = num(v.amount)
          if (a == null || a <= 0) e.amount = 'Enter an amount over £0.00.'
          if (!v.supplier) e.supplier = 'Choose the supplier.'
          if (!v.category) e.category = 'Choose a category.'
          if (!v.date) e.date = 'Choose the day.'
          if (!v.paid) e.paid = 'Choose where the money came from.'
          return e
        },
        summary(v) {
          return [money(Math.round(num(v.amount) * 100)), v.supplier, v.category, niceDate(v.date), 'Paid from ' + String(v.paid).toLowerCase(), String(v.note).trim()].filter(Boolean)
        },
      },
    }

    // The three scripted examples. fill = what the words or the note state; nothing else is filled.
    const NOTE = '<div class="fm-note"><div class="fm-note-row"><b>Lea Valley Produce</b><span>Delivery note 48213</span></div>' +
      '<div class="fm-note-row"><span>Date 22 Nov 2026</span><span>To Thai House, Ware</span></div>' +
      '<table><thead><tr><th>Item</th><th class="q">Ordered</th><th class="q">Sent</th></tr></thead><tbody>' +
      '<tr><td>Chicken thigh, chilled</td><td class="q">10 kg</td><td class="q">10 kg</td></tr>' +
      '<tr><td>Pak choi</td><td class="q">6 kg</td><td class="q">4 kg</td></tr>' +
      '<tr><td>Thai basil</td><td class="q">2 kg</td><td class="q">2 kg</td></tr></tbody></table>' +
      '<div class="fm-note-row"><span>3 lines</span><span>Received by: ........</span></div></div>'
    const EX = {
      typed: {
        form: 'delivery', words: 'bread delivery, 14 loaves short, van was 6 degrees',
        pepper: 'I chose the delivery check for Ware and put in what you told me. Check it and save.',
        understood: ['Form: Delivery check', 'Supplier: East Bakery, your bread supplier', 'Short: 14 loaves', 'Van: 6\u00a0°C, as you said', 'Day: today'],
        fill: { supplier: 'East Bakery', date: TODAY, short: '14 loaves short', temp: '6' },
        said: { temp: '6\u00a0°C' },
        helps: { temp: 'Pepper never infers a measured value. It shows back what you said, and you confirm it.' },
      },
      spoken: {
        form: 'expense', words: 'add expense forty two fifty, milk from Harlow Dairy, yesterday',
        pepper: 'I chose the expense form for Ware and put in what I heard. Check it and save.',
        understood: ['Form: Expense', 'Amount: £42.50', 'Supplier: Harlow Dairy', 'Day: yesterday, Saturday 21 November', 'For: milk'],
        fill: { amount: '42.50', supplier: 'Harlow Dairy', date: YESTERDAY, note: 'Milk' },
        helps: { amount: 'Heard as forty two fifty.' },
      },
      photo: {
        form: 'delivery',
        pepper: 'I read the note and chose the delivery check for Ware. The note has no van temperature, so that field is empty.',
        understood: ['Form: Delivery check', 'Supplier: Lea Valley Produce', 'Date: 22 Nov 2026', 'Short: pak choi, 4 kg sent of 6 kg'],
        fill: { supplier: 'Lea Valley Produce', date: TODAY, short: 'Pak choi: 4 kg sent of 6 kg ordered' },
        helps: { temp: 'Pepper never infers a measured value. The note has no temperature, so read the van and type it.' },
      },
    }
    const meHtml = key => {
      const ex = EX[key]
      if (key === 'spoken') return '<div class="fm-said">' + icon('mic') + '<span>' + esc(ex.words) + '</span></div><div class="fm-cap">Spoken. Written down as heard.</div>'
      if (key === 'photo') return '<div class="fm-cap">' + icon('camera') + '<span>Photo of a delivery note</span></div>' + NOTE
      return esc(ex.words)
    }

    // ── Part 2: three flat forms, each one definition ─────────────────────
    // The same object draws the form, checks it and is printed as the text beside it.
    const DEFS = [
      {
        key: 'add_supplier', tool: 'add_supplier', pick: 'Add a supplier', title: 'Add a supplier', icon: 'truck', save: 'Save supplier', done: 'Supplier saved',
        fields: [
          { name: 'name', type: 'text', required: true, label: 'Supplier name', help: 'The name on their invoices.', example: 'Lea Valley Produce', max: 80 },
          { name: 'order_via', type: 'select', required: true, label: 'How orders are sent', help: 'Where a purchase order goes.', options: ['Email', 'Phone', 'Their website'], example: 'Email' },
          { name: 'email', type: 'email', required: false, label: 'Orders email', help: 'Purchase orders are sent here.', example: 'orders@leavalley.example' },
          { name: 'phone', type: 'phone', required: false, label: 'Phone', help: 'For the day an order is late.', example: '01632 960114' },
          { name: 'min_order', type: 'number', required: false, label: 'Minimum order in pounds', help: 'Leave empty if they have none.', example: '50', min: 0 },
          { name: 'chilled', type: 'yesno', required: true, label: 'Delivers chilled goods', help: 'Adds a van temperature check.', example: 'Yes' },
        ],
      },
      {
        key: 'add_staff_member', tool: 'add_staff_member', pick: 'Add a staff member', title: 'Add a staff member', icon: 'users', save: 'Save staff member', done: 'Staff member saved',
        fields: [
          { name: 'name', type: 'text', required: true, label: 'Full name', help: 'As it shows on the rota.', example: 'Priya Shah', max: 60 },
          { name: 'role', type: 'select', required: true, label: 'Role', help: 'Sets which shifts they can be given.', options: ['Manager', 'Chef', 'Front of house'], example: 'Front of house' },
          { name: 'venue', type: 'select', required: true, label: 'Home venue', help: 'Where they usually work.', options: VENUES, example: 'Ware' },
          { name: 'start', type: 'date', required: true, label: 'First day', help: 'Shifts can start from this day.', example: '2026-12-01' },
          { name: 'mobile', type: 'phone', required: false, label: 'Mobile', help: 'For rota messages.', example: '07700 900123' },
          { name: 'under_18', type: 'yesno', required: true, label: 'Under 18', help: 'Applies the rules for young workers.', example: 'No' },
        ],
      },
      {
        key: 'add_closure', tool: 'close_dates', pick: 'Add a closure', title: 'Add a closure', icon: 'calendar', save: 'Save closure', done: 'Closure saved',
        fields: [
          { name: 'venue', type: 'select', required: true, label: 'Venue', help: 'The venue that closes.', options: VENUES, example: 'Ware' },
          { name: 'date', type: 'date', required: true, label: 'First day closed', help: 'Guests cannot book from this day.', example: '2026-12-25', notBefore: TODAY },
          { name: 'days', type: 'number', required: true, label: 'Days closed in a row', help: '1 for a single day.', example: '2', min: 1, max: 14, whole: true },
          { name: 'reason', type: 'text', required: true, label: 'Reason', help: 'Staff see this on the timeline.', example: 'Christmas', max: 60 },
          { name: 'website', type: 'yesno', required: true, label: 'Show on the website', help: 'Guests see it under opening times.', example: 'Yes' },
        ],
      },
    ]
    const TYPE_WORD = { text: 'text', number: 'number', date: 'date', select: 'select', yesno: 'yes or no', email: 'email', phone: 'phone' }
    const limitsOf = f => {
      if (f.type === 'text' && f.max) return 'up to ' + f.max + ' characters'
      if (f.type === 'date' && f.notBefore) return 'today or later'
      if (f.type !== 'number') return ''
      const range = f.min != null && f.max != null ? f.min + ' to ' + f.max : f.min != null ? f.min + ' or more' : f.max != null ? f.max + ' or less' : ''
      return [range, f.whole ? 'whole number' : ''].filter(Boolean).join(', ')
    }
    /** The definition as text a person can read. */
    function describe(def) {
      const col = s => (s + '           ').slice(0, 11)
      const lines = [col('form') + def.key, col('title') + def.title, col('tool') + def.tool, '']
      def.fields.forEach(f => {
        lines.push(col(f.name) + TYPE_WORD[f.type] + ', ' + (f.required ? 'required' : 'optional'))
        lines.push('  ' + col('label').slice(0, 9) + f.label)
        lines.push('  ' + col('help').slice(0, 9) + f.help)
        if (f.options) lines.push('  ' + col('options').slice(0, 9) + f.options.join(' | '))
        if (limitsOf(f)) lines.push('  ' + col('limits').slice(0, 9) + limitsOf(f))
        lines.push('  ' + col('example').slice(0, 9) + f.example)
        lines.push('')
      })
      return lines.join('\n').trim()
    }
    /** Checks values against a definition: { field name: message }. */
    function checkDef(def, v) {
      const e = {}
      def.fields.forEach(f => {
        const raw = v[f.name] == null ? '' : String(v[f.name]).trim()
        if (!raw) {
          if (f.required) e[f.name] = f.type === 'yesno' ? f.label + ': answer yes or no.' : f.label + ' is needed.'
          return
        }
        if (f.type === 'text' && f.max && raw.length > f.max) e[f.name] = 'Keep this to ' + f.max + ' characters.'
        else if (f.type === 'number') {
          const n = num(raw)
          if (n == null) e[f.name] = 'Type a number.'
          else if (f.whole && n % 1 !== 0) e[f.name] = 'Type a whole number.'
          else if (f.min != null && n < f.min) e[f.name] = 'This must be ' + f.min + ' or more.'
          else if (f.max != null && n > f.max) e[f.name] = 'This must be ' + f.max + ' or less.'
        } else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) e[f.name] = 'This does not look like an email address.'
        else if (f.type === 'phone' && !/^\+?[\d ]{7,16}$/.test(raw)) e[f.name] = 'Use digits and spaces, such as ' + f.example + '.'
        else if (f.type === 'date' && !niceDate(raw)) e[f.name] = 'Choose a day.'
        else if (f.type === 'date' && f.notBefore && raw < f.notBefore) e[f.name] = 'Choose today or a later day.'
        else if (f.type === 'select' && f.options.indexOf(raw) < 0) e[f.name] = 'Choose one from the list.'
        else if (f.type === 'yesno' && raw !== 'Yes' && raw !== 'No') e[f.name] = f.label + ': answer yes or no.'
      })
      return e
    }

    // The cash-up's lines: takings by tender from the till, in pence.
    const TILL = [
      { key: 'cash', name: 'Cash', till: 64250, counted: 'Counted cash' },
      { key: 'card', name: 'Card', till: 187320, counted: 'Card machine total' },
      { key: 'online', name: 'Online orders', till: 41200 },
    ]
    const TEN = ['fridge and freezer checks', 'hot and cold hold checks', 'cooking checks', 'delivery checks', 'a checklist', 'the cash-up', 'wages', 'expenses', 'sold out', 'the rota for a day']

    const CSS = `
#view-form .fm-grow { flex: 1; min-width: 0; }
#view-form .mock .m-head svg, #view-form .m-cardlet > header svg, #view-form .m-msg svg, #view-form .fm-rule svg, #view-form .fm-face svg { width: 16px; height: 16px; flex: none; }
#view-form .mock .m-iconbtn { width: 48px; height: 48px; }
#view-form .m-head .m-iconbtn { margin: -6px -8px -6px 0; }
#view-form #fm-mock .m-main { container-type: inline-size; }
#view-form .fm-cols { display: grid; gap: 12px; align-items: start; grid-template-columns: minmax(0, 1fr); }
@container (min-width: 700px) { #view-form .fm-cols { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); } }
#view-form .fm-conv { position: relative; }
#view-form .fm-conv .m-pad > *, #view-form .fm-talk > * { min-width: 0; }
#view-form .fm-talk { display: grid; gap: 10px; }
#view-form .fm-talk .m-msg { display: grid; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
#view-form .fm-said { display: flex; gap: 8px; align-items: flex-start; }
#view-form .fm-said svg { margin-top: 2px; }
#view-form .fm-cap { display: flex; gap: 6px; align-items: center; font-size: 12px; opacity: 0.85; }
#view-form .fm-note { background: var(--m-surface); color: var(--m-ink); border-radius: 3px; padding: 10px; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.4; display: grid; gap: 6px; transform: rotate(-1deg); margin: 2px 2px 6px; box-shadow: 0 2px 6px var(--m-scrim); }
#view-form .fm-note-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; }
#view-form .fm-note table { width: 100%; border-collapse: collapse; }
#view-form .fm-note th, #view-form .fm-note td { text-align: left; font-weight: 400; padding: 3px 6px 3px 0; border-bottom: 1px dashed var(--m-line); vertical-align: top; }
#view-form .fm-note th { color: var(--m-muted); border-bottom-style: solid; }
#view-form .fm-note .q { text-align: right; padding: 3px 0 3px 10px; white-space: nowrap; }
#view-form .m-understood .m-pill { height: auto; min-height: 20px; padding: 2px 8px; border-radius: 10px; white-space: normal; }
#view-form .fm-sum { padding: 8px 12px; font-size: 13.5px; overflow-wrap: anywhere; }
#view-form .fm-quiet { font-size: 12.5px; color: var(--m-muted); align-self: center; }
#view-form .fm-closed { color: var(--m-muted); font-size: 13.5px; gap: 4px; }
#view-form .fm-closed b { color: var(--m-ink); }
#view-form .fm-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--m-line); font-size: 13px; font-weight: 500; }
#view-form .fm-bar > span { flex: 1 1 170px; min-width: 0; }
#view-form .mock .m-field { align-content: start; }
#view-form .fm-ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
#view-form .fm-in { flex: 1 1 130px; min-width: 0; }
#view-form .fm-act { flex: none; display: flex; }
#view-form .fm-tick { width: 48px; height: 48px; flex: none; border-radius: 8px; border: 1px solid var(--m-accent); background: var(--m-surface); color: var(--m-primary); display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; }
#view-form .fm-tick:hover { background: var(--m-accent-soft); }
#view-form .fm-tick svg { width: 18px; height: 18px; }
#view-form .fm-unit { display: flex; align-items: center; gap: 6px; }
#view-form .fm-unit .m-input { flex: 1; min-width: 0; }
#view-form .fm-unit > span { flex: none; font-size: 13px; font-weight: 600; color: var(--m-muted); }
#view-form .fm-date { position: relative; display: block; }
#view-form .fm-face { display: flex; align-items: center; gap: 6px; padding: 0 10px; white-space: nowrap; }
#view-form .fm-face > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#view-form .fm-face svg { color: var(--m-muted); }
#view-form .fm-face.none > span { color: var(--m-muted); }
#view-form .fm-date input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; opacity: 0; cursor: pointer; }
#view-form .fm-date input::-webkit-calendar-picker-indicator { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; cursor: pointer; }
#view-form .fm-date:focus-within .fm-face { outline: 3px solid var(--m-accent); outline-offset: 2px; }
#view-form .fm-yn { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#view-form .fm-yn .m-btn[aria-pressed="true"] { background: var(--m-primary); color: var(--m-primary-ink); border-color: transparent; }
#view-form .m-field.error .m-select, #view-form .m-field.error .m-textarea, #view-form .m-field.error .fm-yn .m-btn { border-color: var(--m-bad); }
#view-form .fm-opt { font-weight: 400; }
#view-form .fm-one { grid-template-columns: minmax(0, 1fr); }
#view-form #fm-panel .m-form { grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); }
#view-form .fm-rule { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px; background: var(--m-warn-soft); color: var(--m-warn); font-size: 13px; }
#view-form .fm-rule svg { margin-top: 2px; }
#view-form .fm-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--m-line); background: var(--m-page); }
#view-form .fm-foot .msg { flex: 1 1 170px; min-width: 0; font-size: 13px; color: var(--m-muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#view-form .fm-foot .msg.bad { color: var(--m-bad); font-weight: 500; }
#view-form .fm-askbox { flex: 1 1 100%; display: grid; gap: 8px; padding: 10px; border-radius: 8px; background: var(--m-warn-soft); color: var(--m-warn); font-size: 13.5px; font-weight: 500; }
#view-form .fm-askbox > span:last-child { display: flex; flex-wrap: wrap; gap: 8px; }
#view-form #fm-cash { max-width: 560px; }
#view-form .fm-sub { padding: 10px 12px 2px; }
#view-form .fm-line { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 10px 12px; border-top: 1px solid var(--m-line); }
#view-form .fm-line .what { flex: 1 1 170px; min-width: 0; display: grid; gap: 1px; }
#view-form .fm-line .what span, #view-form .fm-nocount { font-size: 12.5px; color: var(--m-muted); }
#view-form .fm-line .cnt { flex: 0 0 150px; }
#view-form .fm-line .var { flex: 0 0 110px; margin-left: auto; display: grid; gap: 4px; justify-items: end; }
#view-form .fm-line.total { background: var(--m-page); }
#view-form .fm-pair { align-items: start; }
#view-form .fm-pair > * { min-width: 0; }
`

    root.innerHTML = `<style>${CSS}</style>
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>The filled form: Pepper proposes, you check and save</h1>
        <p class="lede">This is the answer to dynamically generated forms. Which form opens, what it holds and which values are already in it change with what you say. What a field is, how it is checked and how it saves stay fixed.</p>
        <p class="note">Example data: Thai House is a made-up group, shown at its Ware venue on ${esc(D.today)}. What Pepper says is scripted and nothing is saved.</p>
      </div>

      <div class="stack" style="gap:30px">
        <section class="stack">
          <h2>A real form that arrives filled</h2>
          <div class="stage">
            ${App.brief({
              what: 'A real Macaroonie form that opens with values already in it. Pepper chooses the form and proposes only what your words or the note state. The form checks the values with its own rules, and you save.',
              tryThis: [
                'Switch between <b>Typed</b>, <b>Spoken</b> and <b>Photo</b>. Pepper chooses a different form or fills different fields.',
                'Tick one value Pepper filled, then press <b>Accept all</b>.',
                'Press <b>Save check</b> before you confirm the 6&nbsp;°C. Then confirm it and see what the form still asks for.',
                'Save while some values are unchecked. The form asks once.',
                'After saving, press <b>Edit</b> on the summary line.',
                'In <b>Spoken</b>, change the amount to 0 and save.',
                'In <b>Photo</b>, type a van temperature of 3, then 8.',
              ],
              why: [
                { text: 'Every vendor found that lets AI change business records keeps it to approved components: the product owns the form, and the model picks one and fills it.', confidence: 'medium' },
                { text: 'The studies point to language for getting many values in, and to the form for overview and correction. No controlled study of model-filled forms against manual entry was found, so the claim that filled forms reduce effort without raising errors is a reasoned bet. <span class="tag low">Medium to low confidence</span>' },
              ],
              status: [
                { kind: 'built', text: 'Ten real form panels that Pepper can open from the chat. Today they open for the person to fill in.' },
                { kind: 'target', text: 'Values already in place when the form opens.' },
                { kind: 'target', text: 'The mark on each value Pepper filled, with the tick and Accept all.' },
                { kind: 'target', text: 'The read-only summary line with Edit after Save.' },
              ],
              calls: 'One short turn to choose the form and propose values. None to draw the form or to check it.',
            })}
            <div class="stack">
              <div class="row">
                <div class="seg" id="fm-mode" role="group" aria-label="How the values come in">
                  <button type="button" data-mode="typed" aria-pressed="true">Typed</button>
                  <button type="button" data-mode="spoken" aria-pressed="false">Spoken</button>
                  <button type="button" data-mode="photo" aria-pressed="false">Photo</button>
                </div>
                <span class="spacer"></span>
                <button type="button" class="btn" id="fm-reset">${icon('undo')}Start again</button>
              </div>
              <div class="mock" id="fm-mock">
                ${App.mockBar('office.macaroonie.com/pepper')}
                <div class="mock-body">
                  <div class="m-main">
                    <div class="m-title"><h2>Pepper</h2><span class="m-pill">Ware</span><span class="m-pill">${esc(D.today)}</span></div>
                    <div class="fm-cols">
                      <div class="m-card fm-conv" id="fm-conv">
                        <div class="m-head">${icon('sparkles')}<span>Conversation</span></div>
                        <div class="m-pad">
                          <div class="fm-talk" id="fm-talk" aria-live="polite"></div>
                          <div class="m-ask">
                            <input type="text" id="fm-say" placeholder="Tell Pepper" aria-label="Tell Pepper what happened" autocomplete="off">
                            <button type="button" class="m-iconbtn" id="fm-cam" aria-label="Use the photo example">${icon('camera')}</button>
                            <button type="button" class="m-iconbtn" id="fm-mic" aria-label="Use the spoken example">${icon('mic')}</button>
                            <button type="button" class="m-iconbtn primary" id="fm-send" aria-label="Send">${icon('send')}</button>
                          </div>
                        </div>
                      </div>
                      <div id="fm-right"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="stack">
          <h2>Two kinds of form behind the one pattern</h2>
          <div class="stage">
            ${App.brief({
              what: 'Forms with lines, grids or rules of their own are built by hand. Flat set-up forms can be drawn by one renderer from the definition that already checks the request on the server, so the same definition always gives the same form.',
              tryThis: [
                'In <b>Hand-built panel</b>, change the counted cash and watch the variance and the reason it asks for.',
                'Switch to <b>Drawn from the rules</b> and open each of the three forms.',
                'Read the definition beside the form. Every label, help line and example comes from it.',
                'Save an empty form, then type an email address without an @.',
                'Press <b>Fill in the examples</b>, then save.',
              ],
              why: [
                { text: 'Free generation of an interface at run time remains slow and unreliable. <a href="https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/" target="_blank" rel="noopener">Google</a> says its generated pages can take a minute or more, with occasional inaccuracies.' },
                { text: 'Forms drawn from a schema break down once they depend on state or grow large, on the account of <a href="https://dev.to/surveyjs/react-json-schema-forms-in-practice-why-they-break-down-and-how-surveyjs-fixes-the-architecture-17ik" target="_blank" rel="noopener">a vendor that sells an alternative</a>. So the renderer stops at flat forms.' },
                { text: 'The boundary matches the one the <a href="https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/client/elicitation.mdx" target="_blank" rel="noopener">Model Context Protocol</a> draws for forms a tool may request: a flat object of simple fields with no nesting.' },
              ],
              status: [
                { kind: 'built', text: 'The rules already live on the server: 560 validation schemas in the API routes, against 7 in the admin.' },
                { kind: 'target', text: 'The generic renderer, with a label, help line and example added to each field.' },
                { kind: 'target', text: 'The hand-built catalogue grows from ten panels to the fourteen already specified.' },
                { kind: 'no', text: 'Fields, layout or validation made up by the model for each request.' },
              ],
              calls: 'None. Drawing and checking both run from the definition.',
            })}
            <div class="stack">
              <div class="row">
                <div class="seg" id="fm-kind" role="group" aria-label="Kind of form">
                  <button type="button" data-kind="hand" aria-pressed="true">Hand-built panel</button>
                  <button type="button" data-kind="drawn" aria-pressed="false">Drawn from the rules</button>
                </div>
                <span class="spacer"></span>
                <span class="callcount">Fields made up by the model: <b>0</b></span>
              </div>

              <div class="stack" id="fm-hand">
                <div class="mock" id="fm-cash"><div class="m-main"><div class="m-card">
                  <div class="m-head">${icon('cash')}<span>Cash-up, Saturday 21 November</span><span class="count">Ware</span></div>
                  <div class="m-label fm-sub">Takings by tender, from the till</div>
                  <div id="fm-lines">
                    ${TILL.map(t => `<div class="fm-line">
                      <div class="what"><b>${esc(t.name)}</b><span>From the till: ${money(t.till)}</span></div>
                      ${t.counted ? `<div class="cnt m-field" data-cfield="${t.key}"><label for="fm-c-${t.key}">${esc(t.counted)}</label>
                        <span class="fm-unit"><span>£</span><input class="m-input" id="fm-c-${t.key}" data-c="${t.key}" type="text" inputmode="decimal" autocomplete="off"></span>
                        <div class="err" data-err hidden></div></div>
                      <div class="var"><span class="m-label">Variance</span><span data-var="${t.key}"></span></div>`
                      : '<div class="fm-nocount">Paid online. Nothing to count.</div>'}
                    </div>`).join('')}
                    <div class="fm-line total"><div class="what"><b>Total</b><span>From the till: ${money(TILL.reduce((a, t) => a + t.till, 0))}</span></div>
                      <div class="var"><span class="m-label">Variance</span><b class="num" id="fm-c-total"></b></div></div>
                  </div>
                  <div class="m-pad">
                    <div class="m-field" data-cfield="reason"><label for="fm-c-reason"><span>Reason for the difference</span><span data-pill></span></label>
                      <input class="m-input" id="fm-c-reason" data-c="reason" type="text" autocomplete="off" placeholder="e.g. Float topped up from the safe">
                      <div class="help">A difference of more than £5.00 needs a reason before this saves. The rule is the panel's own. Counts are measured values: a person types them and Pepper never fills one.</div>
                      <div class="err" data-err hidden></div></div>
                  </div>
                  <div class="fm-foot"><span class="msg" id="fm-c-msg"></span><button type="button" class="m-btn primary" id="fm-c-save">Save cash-up</button></div>
                </div></div></div>
                <p class="note">Forms with lines, grids or rules of their own stay hand-built: a cash-up, a rota day, a week's wages, an order.</p>
                <div class="row"><span class="callcount">Form panels today: <b>10</b></span><span class="callcount">Specified: <b>14</b></span></div>
                <p class="small muted">The ten today: ${esc(TEN.join(', '))}.</p>
              </div>

              <div class="stack" id="fm-drawn" hidden>
                <div class="row">
                  <div class="seg" id="fm-which" role="group" aria-label="Which form">
                    ${DEFS.map((d, i) => `<button type="button" data-which="${i}" aria-pressed="${i === 0}">${esc(d.pick)}</button>`).join('')}
                  </div>
                  <span class="spacer"></span>
                  <button type="button" class="btn" id="fm-fill">${icon('edit')}Fill in the examples</button>
                </div>
                <div class="grid c2 fm-pair">
                  <div class="card">
                    <h3>The definition</h3>
                    <pre class="code" id="fm-def" tabindex="0" aria-label="The form's definition"></pre>
                    <p class="small muted">One definition does three jobs: it checks the request on the server, it defines Pepper's tool, and it draws this form.</p>
                  </div>
                  <div class="stack">
                    <div class="mock" id="fm-drawnmock"><div class="m-main" id="fm-drawnform"></div></div>
                    <p class="small muted">Drawn by one renderer. The same definition and role always give the same form, and the checks run from the definition.</p>
                  </div>
                </div>
                <p class="note">The boundary: flat single-record forms only. No nesting, no grids. A form with lines or rules of its own stays a hand-built panel.</p>
              </div>
            </div>
          </div>
        </section>
      </div>`

    const $ = sel => root.querySelector(sel)
    const press = (seg, attr, value) => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(value))))

    // ── Part 1: the conversation and the open form ────────────────────────
    const talk = $('#fm-talk')
    const right = $('#fm-right')
    const conv = $('#fm-conv')
    let mode = 'typed'
    let st = null

    function begin(key) {
      mode = key
      const ex = EX[key]
      const F = FORMS[ex.form]
      st = { key, ex, F, vals: {}, origin: {}, checked: {}, edited: {}, tried: false, asked: false, asking: false, open: true, saved: null, unknown: '' }
      F.fields.forEach(f => {
        const filled = has(ex.fill, f.name)
        st.vals[f.name] = filled ? ex.fill[f.name] : ''
        if (filled) st.origin[f.name] = ex.said && ex.said[f.name] ? 'said' : 'pepper'
      })
      press($('#fm-mode'), 'data-mode', key)
      conv.querySelectorAll('.m-toast').forEach(t => t.remove())
      drawTalk()
      drawPanel()
    }

    function drawTalk() {
      const F = st.F
      let card
      if (st.saved) {
        card = '<div class="m-cardlet"><header>' + icon('check') + '<span class="fm-grow">' + esc(F.done) + '</span><span class="m-pill ok">Saved</span></header>' +
          '<div class="fm-sum" id="fm-summary">' + F.summary(st.saved).map(esc).join(' · ') + '</div>' +
          '<footer>' + (st.open ? '<span class="fm-quiet">Open for editing.</span>' : '<button type="button" class="m-btn" data-open>' + icon('edit') + 'Edit</button>') + '</footer></div>'
      } else {
        card = '<div class="m-cardlet"><header>' + icon(F.icon) + '<span class="fm-grow">' + esc(F.title) + ' · Ware</span>' +
          '<span class="m-pill ' + (st.open ? 'info">Open' : 'now">Not saved') + '</span></header>' +
          '<div class="fm-sum">' + (st.open ? 'Open in the form. Nothing is saved until you press ' + esc(F.save) + '.' : 'Closed without saving. Your values are kept.') + '</div>' +
          (st.open ? '' : '<footer><button type="button" class="m-btn" data-open>' + icon(F.icon) + 'Open form</button></footer>') + '</div>'
      }
      talk.innerHTML = '<div class="m-msg me">' + meHtml(st.key) + '</div>' +
        '<div class="m-msg pepper"><div>' + esc(st.ex.pepper) + '</div><div class="m-understood"><span>Understood</span>' +
        st.ex.understood.map(u => '<span class="m-pill">' + esc(u) + '</span>').join('') + '</div></div>' + card +
        (st.unknown ? '<div class="m-msg me">' + esc(st.unknown) + '</div><div class="m-msg pepper">This mock-up only knows the examples above.</div>' : '')
    }

    function drawPanel() {
      const F = st.F
      if (!st.open) {
        right.innerHTML = '<div class="m-card"><div class="m-pad fm-closed"><b>No form open</b><span>' + (st.saved
          ? 'The form closed when it saved. Edit on the summary line opens it again with the saved values.'
          : 'Nothing is saved. Open form brings it back as you left it.') + '</span></div></div>'
        return
      }
      const helps = st.saved ? {} : (st.ex.helps || {})
      right.innerHTML = '<div class="m-card" id="fm-panel">' +
        '<div class="m-head">' + icon(F.icon) + '<span class="fm-grow">' + esc(F.title) + ' · Ware</span>' +
        '<button type="button" class="m-iconbtn" id="fm-close" aria-label="Close the form">' + icon('x') + '</button></div>' +
        '<div class="fm-bar"><span id="fm-count" aria-live="polite"></span><button type="button" class="m-btn" id="fm-all">' + icon('check') + 'Accept all</button></div>' +
        '<div class="m-pad"><div class="m-form">' + F.fields.map(f =>
          fieldHtml(Object.assign({}, f, { help: helps[f.name] || f.help }), 'fm-a-' + f.name, st.vals[f.name]) +
          (F.ruleAfter === f.name ? '<div class="fm-rule wide" data-rule hidden>' + icon('alert') + '<span></span></div>' : '')).join('') + '</div></div>' +
        '<div class="fm-foot"><div class="fm-askbox" id="fm-askbox" role="alert" hidden><span></span><span>' +
        '<button type="button" class="m-btn primary" id="fm-anyway">Save anyway</button><button type="button" class="m-btn" id="fm-back">Check them first</button></span></div>' +
        '<span class="msg" id="fm-msg"></span><button type="button" class="m-btn primary" id="fm-save">' + esc(F.save) + '</button></div></div>'
      paint()
    }

    /** Brings the marks, the count, the rule and the errors in line with the state. */
    function paint() {
      const panel = right.querySelector('#fm-panel')
      if (!panel) return
      const F = st.F
      const need = F.needs(st.vals)
      const errs = st.tried ? F.check(st.vals, st) : {}
      let filled = 0, done = 0, pepperLeft = 0
      F.fields.forEach(f => {
        const box = panel.querySelector('[data-field="' + f.name + '"]')
        const o = st.origin[f.name]
        const ok = !!st.checked[f.name]
        if (o) { filled++; if (ok) done++; else if (o === 'pepper') pepperLeft++ }
        box.classList.toggle('filled', !!o && !ok)
        box.classList.toggle('error', !!errs[f.name])
        let pill = '', act = ''
        if (o === 'pepper' && !ok) {
          pill = '<span class="m-pill pepper">Filled by Pepper</span>'
          act = '<button type="button" class="fm-tick" data-tick="' + f.name + '" aria-label="Accept ' + esc(f.label) + '">' + icon('check') + '</button>'
        } else if (o === 'said' && !ok) {
          pill = '<span class="m-pill now">You said ' + esc(st.ex.said[f.name]) + '</span>'
          act = '<button type="button" class="m-btn" data-tick="' + f.name + '">' + icon('check') + 'Confirm ' + esc(st.ex.said[f.name]) + '</button>'
        } else if (o) {
          pill = '<span class="m-pill ok">' + (o === 'said' ? (st.edited[f.name] ? 'Typed by you' : 'Confirmed by you') : (st.edited[f.name] ? 'Changed by you' : 'Checked')) + '</span>'
        } else if (need[f.name] && !String(st.vals[f.name]).trim()) {
          pill = '<span class="m-pill now">Needed</span>'
        }
        put(box.querySelector('[data-pill]'), pill)
        const a = box.querySelector('[data-act]')
        put(a, act)
        a.hidden = !act
        const er = box.querySelector('[data-err]')
        er.textContent = errs[f.name] || ''
        er.hidden = !errs[f.name]
      })
      panel.querySelector('#fm-count').textContent = filled
        ? filled + ' of ' + F.fields.length + ' filled by Pepper, ' + done + ' checked'
        : 'Saved values. Change what is wrong and save again.'
      const all = panel.querySelector('#fm-all')
      all.hidden = !filled
      all.disabled = !pepperLeft
      const rule = panel.querySelector('[data-rule]')
      if (rule) { const words = F.rule(st.vals); rule.hidden = !words; rule.lastElementChild.textContent = words }
      const n = Object.keys(errs).length
      const left = filled - done
      const ask = panel.querySelector('#fm-askbox')
      ask.hidden = !st.asking
      ask.firstElementChild.textContent = left + (left === 1 ? ' value filled by Pepper has' : ' values filled by Pepper have') + ' not been checked: save anyway?'
      const msg = panel.querySelector('#fm-msg')
      msg.hidden = st.asking
      msg.className = 'msg' + (n ? ' bad' : '')
      msg.textContent = n ? n + (n === 1 ? ' thing' : ' things') + ' to put right before this saves.' : 'One Save, through the same route the page uses.'
      panel.querySelector('#fm-save').hidden = st.asking
    }

    function accept(name) {
      if (st.origin[name]) st.checked[name] = true
      st.asking = false
      paint()
    }
    function save() {
      st.tried = true
      if (Object.keys(st.F.check(st.vals, st)).length) {
        st.asking = false
        paint()
        const first = right.querySelector('.m-field.error')
        if (first) first.scrollIntoView({ block: 'nearest' })
        return
      }
      const left = Object.keys(st.origin).filter(k => !st.checked[k]).length
      if (left && !st.asked) { st.asked = true; st.asking = true; paint(); return }
      commit()
    }
    function commit() {
      const again = !!st.saved
      st.saved = Object.assign({}, st.vals)
      st.origin = {}; st.checked = {}; st.edited = {}
      st.tried = false; st.asked = false; st.asking = false; st.open = false
      drawPanel()
      drawTalk()
      App.toast(conv, again ? 'Changes saved' : st.F.done)
      const line = talk.querySelector('.m-cardlet')
      if (line) line.scrollIntoView({ block: 'nearest' })
    }

    wire(right, (name, value) => {
      st.vals[name] = value
      if (st.origin[name]) { st.checked[name] = true; st.edited[name] = true }
      st.asking = false
      paint()
    })
    right.addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.dataset.tick) accept(b.dataset.tick)
      else if (b.id === 'fm-all') { Object.keys(st.origin).forEach(k => { if (st.origin[k] === 'pepper') st.checked[k] = true }); st.asking = false; paint() }
      else if (b.id === 'fm-save') save()
      else if (b.id === 'fm-anyway') commit()
      else if (b.id === 'fm-back') { st.asking = false; paint() }
      else if (b.id === 'fm-close') { st.open = false; drawPanel(); drawTalk() }
    })
    talk.addEventListener('click', e => {
      if (!e.target.closest('[data-open]')) return
      st.open = true
      drawPanel()
      drawTalk()
      right.scrollIntoView({ block: 'nearest' })
    })
    $('#fm-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) begin(b.dataset.mode) })
    $('#fm-reset').addEventListener('click', () => begin(mode))
    $('#fm-cam').addEventListener('click', () => begin('photo'))
    $('#fm-mic').addEventListener('click', () => begin('spoken'))
    const say = $('#fm-say')
    const plain = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const send = () => {
      const words = say.value.trim()
      if (!words) return
      say.value = ''
      const hit = ['typed', 'spoken'].filter(k => plain(EX[k].words) === plain(words))[0]
      if (hit) begin(hit)
      else { st.unknown = words; drawTalk() }
    }
    $('#fm-send').addEventListener('click', send)
    say.addEventListener('keydown', e => { if (e.key === 'Enter') send() })
    begin('typed')

    // ── Part 2: the hand-built cash-up ────────────────────────────────────
    const cash = { cash: '630.00', card: '1873.20', reason: '', tried: false, saved: false }
    const cashMock = $('#fm-cash')
    const signed = p => (p < 0 ? '-' : '') + money(Math.abs(p))
    const varianceOf = t => { const n = num(cash[t.key]); return n == null || n < 0 ? null : Math.round(n * 100) - t.till }
    function paintCash() {
      let total = 0, known = true, needReason = false
      const errs = {}
      TILL.filter(t => t.counted).forEach(t => {
        const v = varianceOf(t)
        if (v == null) { known = false; errs[t.key] = t.key === 'cash' ? 'Type the cash you counted.' : 'Type the total from the card machine.' }
        else { total += v; if (Math.abs(v) > 500) needReason = true }
        put(cashMock.querySelector('[data-var="' + t.key + '"]'), v == null ? '<span class="m-pill">No count</span>'
          : v === 0 ? '<span class="m-pill ok">Matches</span>'
            : v < 0 ? '<span class="m-pill late">' + money(-v) + ' short</span>' : '<span class="m-pill now">' + money(v) + ' over</span>')
      })
      if (needReason && !cash.reason.trim()) errs.reason = 'Say why the count is different from the till.'
      $('#fm-c-total').textContent = known ? signed(total) : 'No count'
      put(cashMock.querySelector('[data-cfield="reason"] [data-pill]'), needReason && !cash.reason.trim() ? '<span class="m-pill now">Needed</span>' : '')
      cashMock.querySelectorAll('[data-cfield]').forEach(box => {
        const message = cash.tried ? errs[box.dataset.cfield] : ''
        box.classList.toggle('error', !!message)
        const er = box.querySelector('[data-err]')
        er.textContent = message || ''
        er.hidden = !message
      })
      const n = Object.keys(errs).length
      const msg = $('#fm-c-msg')
      msg.className = 'msg' + (cash.tried && n ? ' bad' : '')
      put(msg, cash.tried && n ? n + (n === 1 ? ' thing' : ' things') + ' to put right before this saves.'
        : cash.saved ? '<span class="m-pill ok">Saved</span>' : 'The variance is worked out by the panel.')
      return errs
    }
    cashMock.querySelectorAll('[data-c]').forEach(input => { input.value = cash[input.dataset.c] })
    cashMock.addEventListener('input', e => {
      const key = e.target.dataset && e.target.dataset.c
      if (!key) return
      cash[key] = e.target.value
      cash.saved = false
      paintCash()
    })
    $('#fm-c-save').addEventListener('click', () => {
      cash.tried = true
      if (Object.keys(paintCash()).length) return
      cash.tried = false
      cash.saved = true
      paintCash()
      App.toast(cashMock, 'Cash-up saved')
    })
    paintCash()

    // ── Part 2: the renderer ──────────────────────────────────────────────
    const drawnBox = $('#fm-drawnform')
    const drawnMock = $('#fm-drawnmock')
    const drawn = DEFS.map(() => ({ vals: {}, tried: false, saved: false }))
    let which = 0
    /** Draws a form from its definition. Nothing here knows which form it is. */
    function renderForm(def, vals) {
      return '<div class="m-card"><div class="m-head">' + icon(def.icon) + '<span>' + esc(def.title) + '</span><span class="count">' + def.fields.length + ' fields</span></div>' +
        '<div class="m-pad"><div class="m-form fm-one">' + def.fields.map(f =>
          fieldHtml(f, 'fm-d-' + f.name, vals[f.name], f.required ? '' : '<span class="fm-opt">optional</span>')).join('') + '</div></div>' +
        '<div class="fm-foot"><span class="msg" id="fm-d-msg"></span><button type="button" class="m-btn primary" id="fm-d-save">' + esc(def.save) + '</button></div></div>'
    }
    function paintDrawn() {
      const def = DEFS[which]
      const s = drawn[which]
      const errs = s.tried ? checkDef(def, s.vals) : {}
      def.fields.forEach(f => {
        const box = drawnBox.querySelector('[data-field="' + f.name + '"]')
        box.classList.toggle('error', !!errs[f.name])
        const er = box.querySelector('[data-err]')
        er.textContent = errs[f.name] || ''
        er.hidden = !errs[f.name]
      })
      const n = Object.keys(errs).length
      const msg = drawnBox.querySelector('#fm-d-msg')
      msg.className = 'msg' + (n ? ' bad' : '')
      put(msg, n ? n + (n === 1 ? ' field does' : ' fields do') + ' not pass the definition.'
        : s.saved ? '<span class="m-pill ok">Saved</span><span>Every field passed the definition.</span>' : 'Checked against the definition when you save.')
    }
    function drawDrawn() {
      const def = DEFS[which]
      press($('#fm-which'), 'data-which', which)
      $('#fm-def').textContent = describe(def)
      drawnMock.querySelectorAll('.m-toast').forEach(t => t.remove())
      drawnBox.innerHTML = renderForm(def, drawn[which].vals)
      paintDrawn()
    }
    wire(drawnBox, (name, value) => {
      drawn[which].vals[name] = value
      drawn[which].saved = false
      paintDrawn()
    })
    drawnBox.addEventListener('click', e => {
      const b = e.target.closest('#fm-d-save')
      if (!b) return
      const def = DEFS[which]
      const s = drawn[which]
      s.tried = true
      s.saved = !Object.keys(checkDef(def, s.vals)).length
      paintDrawn()
      if (s.saved) { s.tried = false; App.toast(drawnMock, def.done) }
      else { const first = drawnBox.querySelector('.m-field.error'); if (first) first.scrollIntoView({ block: 'nearest' }) }
    })
    $('#fm-which').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { which = +b.dataset.which; drawDrawn() } })
    $('#fm-fill').addEventListener('click', () => {
      const vals = {}
      DEFS[which].fields.forEach(f => { vals[f.name] = f.example })
      drawn[which] = { vals, tried: false, saved: false }
      drawDrawn()
    })
    $('#fm-kind').addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      press($('#fm-kind'), 'data-kind', b.dataset.kind)
      $('#fm-hand').hidden = b.dataset.kind !== 'hand'
      $('#fm-drawn').hidden = b.dataset.kind !== 'drawn'
    })
    drawDrawn()
  },
})
