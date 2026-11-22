// The answer: the three verdicts on the owner's vision, the rule that ties
// them together, what Macaroonie already has, and keep / change / do not
// build. Source: reports/AI first back office strategy.md (22 Nov 2026).
App.view('strategy', {
  label: 'The answer',
  group: 'The answer',
  render(root) {
    const { icon, esc, el } = App
    const verdicts = [
      {
        part: 'Natural-language input and navigation', verdict: 'Yes, as the first place to ask', kind: 'built', icon: 'search', go: 'ask', goLabel: 'Open the ask bar mock-up',
        build: 'One bar that searches instantly without the model, hands over to Pepper on Enter, and answers with a link into a real page, a real form or a sourced figure.',
        not: 'A full-screen chat that replaces the menu, or page jumps that depend on a model call.',
      },
      {
        part: 'Dynamically generated forms', verdict: 'Not as stated', kind: 'low', icon: 'file', go: 'form', goLabel: 'Open the filled form mock-up',
        build: 'Real form panels that open sized to the task and already filled in, plus plain set-up forms drawn the same way every time from the server\'s own rules. Pepper chooses the form and proposes values.',
        not: 'Fields, layout or validation made up by the model for each request.',
      },
      {
        part: 'A data framework like a smart ERP', verdict: 'Yes, and it is the most valuable part', kind: 'built', icon: 'box', go: 'registry', goLabel: 'Open the registry mock-up',
        build: 'One registry that joins each business object to its table, report subject, page, actions and form, with every action\'s consequence declared.',
        not: 'A run-time metadata engine, tables defined by each customer, or database queries written by the model.',
      },
    ]
    const rules = [
      ['Navigation never needs the model', 'Finding a page is a local search. A model call is for questions and for filling forms.'],
      ['Every answer is a place you can find again', 'Pepper answers with a real page or form, so it teaches the product instead of hiding it.'],
      ['The product sets the friction', 'How much checking an action needs comes from what the action does, because people approve risky and safe things alike.'],
      ['Everyone in a role sees the same frame', 'Only a person\'s own pins and a small, labelled strip of suggestions adapt.'],
      ['Voice and photos fill a form', 'They are ways to get values in, never ways to skip the form.'],
      ['Everything still works with the model off', 'A provider outage is a slower day, not a closed one.'],
    ]
    const kcd = {
      Keep: [
        'Tasks, figures and card contents come from rules and data; the model words, ranks, picks and routes',
        'Change tools call the page\'s own routes as the signed-in person',
        'The Confirm card is built from the stored plan, never from the model\'s text',
        'The report catalogue is the only source of figures',
        'Real panels in the form sheet and one explicit Save',
        'A small always-loaded set of tools, the rest found by search; usage caps per group and person',
        'Voice in steps; a spoken yes only for four check tools, off by default',
        'The staff connector for outside assistants, limited by the person\'s permissions',
        'Every page reachable from the menu, and each group\'s own menu tree',
        'Customer text treated as data in prompts; links checked before they are drawn',
      ],
      Change: [
        'Three home pages into one',
        'Three page matchers into one',
        'Venue, day and tab move into the address, so a link opens the right place',
        'Six shortcut mechanisms into per-person pins kept on the server',
        'Confirm on every change into friction set by declared consequence, once undo exists',
        'Cards that expire after 30 minutes into items that wait under For review',
        'Hand-kept lists (pages, forms, prompt lines, labels) into one record per area',
        'Testing against a stand-in into a live evaluation set and a usage record',
        'Mixed names for staff, dishes, orders and venues into the report catalogue\'s names',
        'A Today feed without memory into a task store with owner, snooze, skip and history',
      ],
      'Do not build': [
        'A chat-only landing page, or any removal of menus',
        'Forms whose fields or layout the model makes up',
        'Database queries or arithmetic written by the model',
        'Always-listening voice, or voice as a route to a destructive action',
        'Unattended writes to money, pay, tips, prices, allergens or deletions',
        'Pepper ranking or scoring individual staff, or rotas set on personal traits',
        'Layouts that reorder themselves per person or per visit',
        'A run-time metadata engine, customer-defined tables, or an agent that changes the schema',
        'A paid Pepper add-on before an outcome has been measured',
        'A general retail push before stock on hand exists',
      ],
    }
    const has = [['159', 'Pepper tools', '58 read, 97 change, every change behind a Confirm card'], ['136', 'report subjects', 'the catalogue Pepper answers figures from'],
      ['10', 'form cards', 'real page panels Pepper can open'], ['93', 'menu links', 'in 12 sections; 118 routes in all'], ['46', 'permission modules', 'Pepper acts with the person\'s own access'], ['0', 'usage records', 'nothing yet logs what people open or ask']]
    const lacks = ['Addresses that open a page at a venue, day and tab', 'One home in place of three', 'A review queue for drafts and unanswered cards', 'Undo, and a list of what Pepper changed', 'A record of pages opened and questions asked', 'Any test of Pepper against the live model']

    root.innerHTML = `
      <div class="view-head">
        <span class="eyebrow">Research answer · 22 November 2026</span>
        <h1>Lead with Pepper, keep every screen</h1>
        <p class="lede">Make Pepper the first place to ask, and let the day arrive as a short list of things to do. Every change still lands in a real, stable screen that a person checks and saves. That is what the leading products ship, what the studies support, and what Macaroonie's own principles already say.</p>
      </div>

      <div class="stack" style="gap:22px">
        <section class="stack">
          <h2>Three parts of the vision, three verdicts</h2>
          <div class="grid c3" id="st-verdicts">
            ${verdicts.map(v => `
              <article class="card">
                <div class="row"><span class="m-ico" style="background:var(--brand-soft);color:var(--brand)">${icon(v.icon)}</span><span class="tag ${v.kind}">${esc(v.verdict)}</span></div>
                <h3>${esc(v.part)}</h3>
                <p><b>Build it as.</b> ${esc(v.build)}</p>
                <p class="muted"><b>Not as.</b> ${esc(v.not)}</p>
                <div class="row"><button type="button" class="btn" data-go="${v.go}">${esc(v.goLabel)} ${icon('right')}</button></div>
              </article>`).join('')}
          </div>
        </section>

        <section class="card tint">
          <h2>The one rule</h2>
          <div class="grid c3">
            <div><h3>The model</h3><p>words, ranks, picks and routes.</p></div>
            <div><h3>Rules and data</h3><p>decide tasks, figures and what a card says.</p></div>
            <div><h3>The person</h3><p>types measured values and confirms.</p></div>
          </div>
        </section>

        <section class="stack">
          <h2>Six working rules</h2>
          <div class="grid c3">
            ${rules.map((r, i) => `<article class="card"><span class="eyebrow">Rule ${i + 1}</span><h3>${esc(r[0])}</h3><p class="muted">${esc(r[1])}</p></article>`).join('')}
          </div>
        </section>

        <section class="stack">
          <div class="row"><h2>Keep, change, do not build</h2><span class="spacer"></span>
            <div class="seg" id="st-kcd-seg" role="group" aria-label="Which list">${Object.keys(kcd).map((k, i) => `<button type="button" data-k="${esc(k)}" aria-pressed="${i === 0}">${esc(k)}</button>`).join('')}</div>
          </div>
          <div class="card"><ul class="list" id="st-kcd"></ul></div>
        </section>

        <section class="stack">
          <h2>Macaroonie already owns the hard half</h2>
          <div class="grid c3">
            ${has.map(h => `<article class="card"><div style="font-family:var(--font-display);font-size:34px;font-weight:700;line-height:1" class="num">${h[0]}</div><h3>${esc(h[1])}</h3><p class="muted small">${esc(h[2])}</p></article>`).join('')}
          </div>
          <div class="card">
            <h3>What it lacks</h3>
            <ul class="list">${lacks.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
            <p class="note">Counted from the code on 22 November 2026. Nothing here was measured in use: the product has no customers yet.</p>
          </div>
        </section>

        <section class="card">
          <div class="row"><h2>How far to trust this</h2><span class="tag high">Direction: solid</span><span class="tag low">Figures: soft</span></div>
          <p>The direction rests on agreement between what the leading products ship, what controlled studies measure, what the firms that reversed went back to, and what regulators require. Individual figures deserve much less weight: almost no source page could be opened from this environment, so findings rest on search-result summaries, and several planned searches never ran.</p>
          <div class="row"><button type="button" class="btn" data-go="evidence">See the evidence ${icon('right')}</button><button type="button" class="btn" data-go="plan">See the plan and the decisions ${icon('right')}</button></div>
        </section>
      </div>`

    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => App.go(b.dataset.go)))
    const list = root.querySelector('#st-kcd')
    const show = k => {
      list.innerHTML = kcd[k].map(t => `<li>${esc(t)}</li>`).join('')
      root.querySelectorAll('#st-kcd-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)))
    }
    root.querySelector('#st-kcd-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.k) })
    show('Keep')
  },
})
