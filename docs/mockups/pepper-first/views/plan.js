// The plan: nine steps with a measure each, the two measures that run through
// every step, seven flows to prototype, the owner's eleven decisions and the
// conclusion. Source: reports/AI first back office strategy.md (22 Nov 2026).
// The owner's answers stay in this browser (App.store, key "decisions") and
// leave the page only as plain text the owner copies and pastes.
App.view('plan', {
  label: 'Plan and decisions',
  group: 'Evidence and plan',
  render(root) {
    const { icon, esc } = App

    // A button that opens another tab, worded with that tab's own label.
    const TABS = { home: 'Home', ask: 'Ask bar', form: 'Filled form', confirm: 'Confirm card', registry: 'Registry', review: 'For review', phone: 'Phone' }
    const tabLabel = n => { const t = document.querySelector('#tabs [data-tab="' + n + '"]'); return (t && t.textContent.trim()) || TABS[n] || n }
    const goBtn = n => `<button type="button" class="btn" data-go="${esc(n)}">${esc(tabLabel(n))} ${icon('right')}</button>`

    const steps = [
      {
        short: 'Prove and instrument', name: 'Prove and instrument', go: [],
        first: 'Measurement comes before any new screen. Pepper\'s accuracy, speed and cost against the live model are unknown, and nothing records what people open or ask, so nothing could show whether a new home helps.',
        build: ['Run Pepper against the live model', 'A test set of 20 to 50 tasks, each checked by the state it leaves, on a test group with seeded data', 'A record of pages opened and bar queries', 'Cost per request by model'],
        measure: ['Tasks Pepper already passes keep passing, near 100%, on every tool or prompt change', 'Tool-search hit rate, median response time and model cost per request are known numbers'],
      },
      {
        short: 'Addresses', name: 'Addresses and one page record', go: [],
        build: ['Addresses that open Timeline, Bookings, Rota, Food safety, Online orders and Cash Recon at a venue, a day or week, and a tab', 'One record per page per area', 'One page matcher'],
        measure: ['The six pages open at a venue, day and tab from an address', 'The open_page tool returns links with context', 'A new page touches one list where it now touches five'],
      },
      {
        short: 'Home and ask bar', name: 'One home and the ask bar', go: ['home', 'ask'],
        build: ['Home at / with the rail, the bar, pins, the Today feed and the week strip', 'The bar as an overlay on every other page', 'Nav cards', 'Pins kept on the server', 'Launcher mode retired'],
        measure: ['Every page jump with a local match uses no model call', 'Median taps from sign-in to the first task opened falls', 'The share of sessions that use the bar, and the share handed to Pepper, are tracked'],
      },
      {
        short: 'Filled forms', name: 'Filled forms', go: ['form'],
        build: ['Values from words, a photo or voice placed into the form sheet, with a mark on each field', 'The saved summary line with Edit', 'Drafts across devices', 'The four missing form types', 'One form list'],
        measure: ['Share of pre-filled fields saved unchanged', 'Median time for the ten commonest tasks through a filled form, against the page', 'Changes reversed within 24 hours, against the manual rate'],
      },
      {
        short: 'Registry and undo', name: 'Action registry, undo and audit', go: ['confirm', 'registry'],
        build: ['Each change tool declares its class, its preconditions with a message for each, an idempotency key (so a retry cannot write twice) and its inverse', 'Before and after, and editable fields, on Confirm cards', 'Undo', 'The Done by Pepper log'],
        measure: ['97 of 97 change tools declare a class', 'Share with a working undo', 'The mix of approved, edited and rejected cards', 'No duplicate write on a retried action'],
      },
      {
        short: 'For review', name: 'For review and the task store', go: ['review'],
        build: ['Tasks with an owner, snooze, skip with a reason, escalation and history', 'The Waiting tab for drafts and unanswered cards', 'The missing Today sources', 'Pepper reading the feed'],
        measure: ['Share of feed items acted on inside their window', 'Median age of items waiting', 'Sources pruned for low action'],
      },
      {
        short: 'Phone', name: 'Phone and shared devices', go: ['phone'],
        build: ['Person switch by PIN', 'Capture to For review', 'Venue vocabulary for speech', 'Push and scanner proven on a device', 'The second phone platform'],
        measure: ['Share of changes on shared devices tied to a named person', 'Weekly active staff on the phone', 'Share of voice entries corrected before saving'],
      },
      {
        short: 'Suggestions', name: 'Suggestions and above-store Home', go: ['home'],
        build: ['Up to four rule-based suggestions, each with a reason', 'Venues ranked by exceptions', 'Completion by site'],
        measure: ['Tap-through on suggestions', 'Weekly active sites at 25% to 40% of all sites, against about a quarter at Toast', '"How do I" questions answered in the product without a support ticket, against over 80% of tickets resolved by AI at Lightspeed'],
      },
      {
        short: 'Framework and retail', name: 'Framework extensions and retail', go: ['registry'],
        build: ['The joined registry', 'Synonyms and examples on catalogue fields', 'The generic renderer for flat set-up forms', 'Custom fields for each customer', 'A rule built from a sentence, using the same actions', 'Item type, product code and stock on hand'],
        measure: ['A new capability is added in one file', 'A question outside the catalogue gets "not covered", never a guess', 'Model spend per site per month stays under a set share of price'],
      },
    ]

    const flows = [
      { flow: 'Do yesterday\'s cash-up', on: 'Tablet', go: 'home', calls: ['None', ''],
        screen: 'Home shows Cash-up not submitted under Late. One tap opens the cash-up sheet, with the till\'s takings filled in where a till is connected. The person counts and types the cash, then taps Submit. The task clears and a summary line stays.' },
      { flow: 'Open next week\'s rota at another venue', on: 'Desk', go: 'ask', calls: ['None', ''],
        screen: 'Type "rota". The first result is the Rota page, with chips for venue and week. Two taps, and the page opens at that venue and week.' },
      { flow: 'Mark a dish sold out', on: 'Phone, mid-service', go: 'phone', calls: ['One', ' short turn on the small model'],
        screen: 'Hold to talk: "sold out of sea bass". A card shows the transcript, the matched dish and venue, and where it applies (till, online, menu screens). Tap Confirm. Done, with Undo.' },
      { flow: 'Log the fridge checks', on: 'Kitchen tablet', go: 'home', calls: ['None', ', or speech only'],
        screen: 'Tap the Now task. The sheet lists this venue\'s fridges for this check time. Key or speak each temperature and see it shown back. A reading out of range asks for a corrective action. Save.' },
      { flow: 'Enter a supplier invoice', on: 'Phone, then desk', go: 'review', calls: ['One', ' reader call on the main model'],
        screen: 'Photograph the invoice. It appears under For review with the photo beside the lines read from it, and changed prices marked. Correct a line, then Approve. The change is listed under Done by Pepper.' },
      { flow: 'Ask for a figure', on: 'Any device', go: 'ask', calls: ['One', ' turn. The report engine computes the figures'],
        screen: '"How did Friday compare with the Friday before?" A data card shows both figures, what was counted, and Open report, which lands on the rows.' },
      { flow: 'Start an area manager\'s day', on: 'Desk', go: 'home', calls: ['None', ''],
        screen: 'Home lists venues ranked by late and missed tasks. Tap a venue for its feed. For review shows orders awaiting approval across venues.' },
    ]

    const decisions = [
      { n: 1, short: 'What AI-first means', q: 'What should AI-first mean in the product and in the pitch?',
        rec: 'Pepper-first Home and bar in the product. Sell hours saved and one platform with Pepper included. Avoid AI-first as the headline claim to franchisees and staff.',
        why: 'No evidence was found of a buyer choosing a platform because it was AI-first. Duolingo\'s AI-first announcement drew a user backlash.',
        src: ['TechCrunch', 'https://techcrunch.com/2025/04/30/duolingo-launches-148-courses-created-with-ai-after-sharing-plans-to-replace-contractors-with-ai'] },
      { n: 2, short: 'Default or switched on', q: 'Is the new Home the default, or switched on for each group, role and device?',
        ctx: 'This is the open question in the chat-first plan.',
        rec: 'The new Home is the default for every group and role, because it is the Today feed and a search bar and not a chat. A full-screen conversation is never a landing page.',
        why: 'The firms that reversed had removed the conventional route. None of the products found removed menus.' },
      { n: 3, short: 'Generated forms', q: 'Should Pepper generate forms on the fly?',
        rec: 'Accept the reframing: a growing catalogue of real forms that arrive filled, and a renderer that draws flat set-up forms the same way every time. The rule that the AI never makes up fields stays.',
        why: 'Every vendor that lets AI change records constrains it to approved components. No controlled evidence for generated forms was found.' },
      { n: 4, short: 'Confirm on every change', q: 'Does every change keep needing a Confirm?',
        rec: 'Keep it until undo exists and the first customers produce reversal data. Then let a group move a short, named list of reversible, low-cost actions to Done, with Undo. Never money, pay, prices, allergens, deletions or anything about a person.',
        why: 'People tire of approving and approve by habit, and they hand over risky and safe actions alike. The switch that lets a spoken yes confirm four check tools is the precedent.' },
      { n: 5, short: 'Scope of the data framework', q: 'How far should the data framework go?',
        rec: 'A registry over what exists, in the per-area records the parallel-work plan proposes. Catalogue subject names as the vocabulary. Custom fields later. No tables defined by each customer.',
        why: 'Metadata engines were built that way from their first day. The six open decisions in the parallel-work plan gate step 1.' },
      { n: 6, short: 'Identity on shared devices', q: 'How do people say who they are on a shared device, and what about kitchen staff with no office login?',
        rec: 'A PIN person switch before any change. A till PIN is enough for logging checks and nothing else.',
        why: 'People work around login friction. An audit trail needs a named person, and a device cannot stand in for one.' },
      { n: 7, short: 'Skipping a compliance task', q: 'Can a compliance task be skipped?',
        rec: 'Allow a skip only with a reason, recorded and visible above the store.',
        why: 'A judgement by analogy with replenishment research, where bounded overrides did better than free overrides or none.',
        src: ['arXiv 2607.00420', 'https://arxiv.org/abs/2607.00420'] },
      { n: 8, short: 'Usage data about people', q: 'Who sees usage and performance data about people?',
        rec: 'Managers see task completion by site. The record of pages a person opens stays that person\'s own, as the parked plan proposes. Pepper does not rank individuals.',
        why: 'The regulator\'s monitoring guidance, and the EU\'s treatment of worker evaluation as high-risk. This pulls against area managers\' wish to see who uses the tools.' },
      { n: 9, short: 'Model writes to allergens and pay', q: 'May a model write allergen and pay data?',
        rec: 'A named person signs off any allergen data a model read, and any change to pay or tips. No exception by voice or batch.',
        why: 'The food business stays responsible for the written record. Pay records must be reproducible for years.' },
      { n: 10, short: 'Price and cost of Pepper', q: 'What should Pepper cost the customer, and how much may it cost to run?',
        rec: 'Included in every plan, with a fair-use allowance per venue. A ceiling on model spend as a share of price. No paid agent until one has a measured result.',
        why: 'The market gives the assistant away. On this report\'s estimates, inference at AI-first volumes on a mid-tier model takes 35% to 70% of a UK subscription.' },
      { n: 11, short: 'Segment and retail', q: 'Which customers come first, and how far into retail?',
        rec: 'Franchised and multi-site quick-service first. Retail limited to food-led and franchise retail, after stock on hand, as a test.',
        why: 'Branded quick-service is the growing part of UK eating out, at a forecast £18.0bn in 2026. Square\'s agent beta left franchise sellers out.',
        src: ['Lumina Intelligence', 'https://www.lumina-intelligence.com/?p=42383'] },
    ]
    const CHOICES = [['agree', 'Agree'], ['unsure', 'Not sure'], ['disagree', 'Disagree']]
    const CHOICE_LABEL = { agree: 'Agree', unsure: 'Not sure', disagree: 'Disagree' }
    const NOTE_MAX = 300

    const li = items => items.map(t => `<li>${esc(t)}</li>`).join('')
    const noModel = flows.filter(f => f.calls[0] === 'None').length
    const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']

    root.innerHTML = `
      <style>
        #view-plan h4 { margin: 0; }
        #view-plan .pl-sec { scroll-margin-top: 120px; }
        #view-plan .pl-sec > h2:focus { outline: none; }
        #view-plan .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        #view-plan .pl-steps { display: grid; grid-template-columns: minmax(0, 250px) minmax(0, 1fr); gap: 14px; align-items: start; }
        #view-plan .pl-rail { display: grid; gap: 6px; min-width: 0; }
        #view-plan .pl-step { justify-content: flex-start; min-height: 48px; width: 100%; min-width: 0; }
        #view-plan .pl-step .pl-name { min-width: 0; overflow-wrap: anywhere; }
        #view-plan .pl-n { width: 26px; height: 26px; flex: none; border-radius: 50%; border: 1.5px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
        #view-plan .pl-panel { min-height: 480px; }
        #view-plan .pl-title { font-size: 21px; }
        #view-plan .pl-flip svg { transform: rotate(180deg); }
        #view-plan .pl-flows { min-width: 760px; }
        #view-plan .pl-flows .btn { white-space: nowrap; }
        #view-plan .pl-flows td:first-child { min-width: 150px; }
        #view-plan .pl-dec { grid-template-columns: minmax(0, 1fr) minmax(0, 320px); gap: 12px 28px; align-items: start; }
        #view-plan .pl-dec[data-choice="agree"] { box-shadow: inset 4px 0 0 var(--good); }
        #view-plan .pl-dec[data-choice="unsure"] { box-shadow: inset 4px 0 0 var(--warn); }
        #view-plan .pl-dec[data-choice="disagree"] { box-shadow: inset 4px 0 0 var(--bad); }
        #view-plan .pl-dec p { max-width: 72ch; }
        #view-plan .pl-choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
        #view-plan .pl-choices .btn { padding-inline: 6px; min-height: 48px; min-width: 0; }
        #view-plan textarea { display: block; width: 100%; min-height: 64px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 16px; line-height: 1.4; resize: vertical; }
        #view-plan textarea[readonly] { background: var(--surface-2); font-family: var(--font-mono); font-size: 13px; line-height: 1.55; }
        #view-plan .pl-pips { display: inline-flex; gap: 3px; align-items: center; }
        #view-plan .pl-pips i { display: block; width: 14px; height: 8px; border-radius: 4px; background: var(--line); }
        #view-plan .pl-pips i.agree { background: var(--good); }
        #view-plan .pl-pips i.unsure { background: var(--warn); }
        #view-plan .pl-pips i.disagree { background: var(--bad); }
        #view-plan .pl-danger { background: var(--bad); color: var(--surface); border-color: transparent; }
        @media (max-width: 860px) {
          #view-plan .pl-steps { grid-template-columns: minmax(0, 1fr); }
          #view-plan .pl-rail { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          #view-plan .pl-step { flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 4px; padding: 8px 10px; font-size: 13px; line-height: 1.25; }
          #view-plan .pl-panel { min-height: 0; }
          #view-plan .pl-dec { grid-template-columns: minmax(0, 1fr); }
          #view-plan .pl-ask > span { flex: 1 1 100%; }
        }
        /* Under 800px the flows table reads as one block per flow, so nothing sits off to the side. */
        @media (max-width: 800px) {
          #view-plan .pl-flows { min-width: 0; display: block; }
          #view-plan .pl-flows thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
          #view-plan .pl-flows tbody { display: block; }
          #view-plan .pl-flows tr { display: grid; gap: 8px; padding: 14px 12px; border-bottom: 1px solid var(--line); }
          #view-plan .pl-flows tr:last-child { border-bottom: 0; }
          #view-plan .pl-flows td { display: block; padding: 0; border: 0; min-width: 0; }
          #view-plan .pl-flows td[data-label]::before { content: attr(data-label); display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 2px; }
        }
      </style>

      <div class="view-head">
        <span class="eyebrow">Plan · from the report of 22 November 2026</span>
        <h1>The plan: nine steps, each with a number that says it worked</h1>
        <p class="lede">Nine steps in the order the work depends on, starting with measurement. Then the flows to prototype, and eleven decisions that are yours, each with the report's recommendation.</p>
        <div class="row" style="margin-top:6px"><button type="button" class="btn" id="pl-jump">Go to the eleven decisions ${icon('down')}</button></div>
      </div>

      <div class="stack" style="gap:26px">
        <section class="stack pl-sec" id="pl-sec-steps">
          <h2>Nine steps</h2>
          <p class="muted">The order follows what the code and the parked plan depend on. Pick a step to see what gets built and how you would know it worked.</p>
          <div class="pl-steps">
            <div class="pl-rail" id="pl-rail" role="group" aria-label="The nine steps">
              ${steps.map((s, i) => `<button type="button" class="btn pl-step" data-step="${i}" aria-pressed="${i === 0}"><span class="pl-n">${i}</span><span class="pl-name">${esc(s.short)}</span></button>`).join('')}
            </div>
            <article class="card pl-panel" aria-labelledby="pl-step-title">
              <div class="row">
                <span class="eyebrow" id="pl-step-no">Step 0</span>
                <span class="spacer"></span>
                <button type="button" class="btn pl-flip" id="pl-prev">${icon('right')} Previous</button>
                <button type="button" class="btn" id="pl-next">Next ${icon('right')}</button>
              </div>
              <h3 class="pl-title" id="pl-step-title"></h3>
              <div class="stack" id="pl-step-body"></div>
            </article>
          </div>
          <p class="note">The targets are suggestions, anchored where a benchmark exists. Before the first franchise is onboarded, the measures that can be used are task success, reversal rate, time per task and cost per request on test groups. The adoption measures need live customers.</p>
        </section>

        <section class="stack pl-sec" id="pl-sec-measures">
          <h2>Two measures through every step</h2>
          <div class="grid c2">
            <article class="card">
              <span class="m-ico" style="background:var(--brand-soft);color:var(--brand)">${icon('chart')}</span>
              <h3>Depth</h3>
              <p>The share of all changes in each area made through Pepper or a filled form, and not through the page.</p>
              <p class="muted">Why: it is the truest reading of AI-first, and it will differ widely between food safety checks and menu design.</p>
            </article>
            <article class="card">
              <span class="m-ico" style="background:var(--brand-soft);color:var(--brand)">${icon('clock')}</span>
              <h3>Hours saved per site per month</h3>
              <p>For the commonest tasks, timed in the product.</p>
              <p class="muted">Why: it is the figure a buyer on a 1.5% margin will ask for.</p>
            </article>
          </div>
        </section>

        <section class="stack pl-sec" id="pl-sec-flows">
          <h2>Seven flows to prototype</h2>
          <div class="tblwrap">
            <table class="tbl pl-flows">
              <thead><tr><th>Flow</th><th>What happens on screen</th><th>Model calls</th><th>Mock-up</th></tr></thead>
              <tbody>
                ${flows.map(f => `<tr>
                  <td><b>${esc(f.flow)}</b><br><span class="muted small">${esc(f.on)}</span></td>
                  <td data-label="What happens on screen">${esc(f.screen)}</td>
                  <td data-label="Model calls"><b>${esc(f.calls[0])}</b>${esc(f.calls[1])}</td>
                  <td>${goBtn(f.go)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p id="pl-flow-count">${WORDS[noModel]} of the seven need no model call, or speech only. The other ${WORDS[flows.length - noModel].toLowerCase()} need one call each.</p>
        </section>

        <section class="stack pl-sec" id="pl-sec-decisions">
          <h2 id="pl-dec-h" tabindex="-1">Eleven decisions for you</h2>
          <p class="muted">Each card gives the report's recommendation and the reason for it. Say whether you agree, and add a note if you want to. When you are done, copy your answers and paste them into the conversation with Claude.</p>
          <div class="card">
            <div class="row">
              <b class="num" id="pl-progress" aria-live="polite">0 of ${decisions.length} answered</b>
              <span class="pl-pips" id="pl-pips" aria-hidden="true">${decisions.map(() => '<i></i>').join('')}</span>
              <span class="muted small" id="pl-tally"></span>
              <span class="spacer"></span>
              <button type="button" class="btn" id="pl-clear">Clear answers</button>
              <span class="row pl-ask" id="pl-clear-ask" hidden>
                <span>Clear every answer and note?</span>
                <button type="button" class="btn" id="pl-clear-no">Keep them</button>
                <button type="button" class="btn pl-danger" id="pl-clear-yes">Clear them</button>
              </span>
            </div>
            <p class="small muted" id="pl-kept"></p>
          </div>

          <div class="stack" id="pl-decisions">
            ${decisions.map(d => `
              <article class="card pl-dec" id="pl-dec-${d.n}" data-n="${d.n}">
                <div class="stack" style="gap:8px">
                  <div class="row"><span class="pl-n">${d.n}</span><span class="eyebrow">${esc(d.short)}</span></div>
                  <h3>${esc(d.q)}</h3>
                  ${d.ctx ? `<p class="muted small">${esc(d.ctx)}</p>` : ''}
                  <p><b>Recommendation.</b> ${esc(d.rec)}</p>
                  <p class="muted"><b>Why.</b> ${esc(d.why)}${d.src ? ` <a href="${esc(d.src[1])}" target="_blank" rel="noopener noreferrer">Source: ${esc(d.src[0])}</a>` : ''}</p>
                </div>
                <div class="stack" style="gap:8px">
                  <div class="pl-choices" role="group" aria-label="Your answer to decision ${d.n}">
                    ${CHOICES.map(c => `<button type="button" class="btn" data-choice="${c[0]}" aria-pressed="false">${c[1]}</button>`).join('')}
                  </div>
                  <div class="row small muted"><label for="pl-note-${d.n}">Note (optional)</label><span class="spacer"></span><span class="num" id="pl-len-${d.n}">0 of ${NOTE_MAX}</span></div>
                  <textarea id="pl-note-${d.n}" data-n="${d.n}" maxlength="${NOTE_MAX}" rows="2"></textarea>
                </div>
              </article>`).join('')}
          </div>

          <p class="note">The other open questions in the existing plans (which push channel, and the decisions in the catalogue and sales-import plans) do not block steps 0 to 4.</p>

          <div class="card" id="pl-copy-card">
            <h3>Take your answers back to Claude</h3>
            <p>This page sends nothing anywhere. Copy your answers, then paste them into the conversation with Claude.</p>
            <div class="row">
              <button type="button" class="btn primary" id="pl-copy">${icon('file')} Copy my answers</button>
              <span class="small" id="pl-copy-status" role="status"></span>
            </div>
            <label class="small muted" for="pl-summary">What gets copied</label>
            <textarea id="pl-summary" readonly rows="13" spellcheck="false"></textarea>
          </div>
        </section>

        <section class="stack pl-sec" id="pl-sec-changes">
          <h2>What this changes</h2>
          <div class="grid c3">
            <article class="card">
              <h3>The market has settled the question</h3>
              <p>Whether the back office should be AI-first has a settled answer: an agent on the first screen, approval before change, and conventional screens underneath. Macaroonie's existing principles already say the same.</p>
              <div class="row"><span class="tag high">High confidence</span></div>
            </article>
            <article class="card">
              <h3>Where Macaroonie can be better</h3>
              <p>Everyone rents the model, and the chat is no advantage either. The advantage is the registry: one schema across till, rota, purchasing, cash and food safety, with every action's consequence declared, so Pepper, the Confirm card, the audit trail, the simple forms and the reports are all drawn from the same definition.</p>
              <p>It lands on ground the incumbents have left empty. Food safety, cash, tips and wages carry almost no vendor AI, and franchise structures are being served last.</p>
              <div class="row"><span class="tag low">Empty ground: medium to low confidence</span></div>
            </article>
            <article class="card">
              <h3>Two things follow</h3>
              <p><b>The window is real but short.</b> The US leaders' agents are likely to leave beta and reach larger and franchise customers during 2027. Whether they reach the UK on that timetable is not known.</p>
              <p><b>The first real franchise is the only test that counts.</b> The instruments (the evaluation set, the usage record, the reversal rate, the cost per request) should exist before that customer does.</p>
              <p class="muted">AI-first then becomes a number Macaroonie reports for each area: the share of changes that went through Pepper and stayed unreversed.</p>
            </article>
          </div>
        </section>
      </div>`

    const $ = id => root.querySelector('#' + id)

    // Every button that opens another tab (the step panel redraws, so one listener on the view).
    root.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) App.go(b.dataset.go) })
    $('pl-jump').addEventListener('click', () => {
      $('pl-sec-decisions').scrollIntoView({ block: 'start' })
      $('pl-dec-h').focus({ preventScroll: true })
    })

    // ── The nine steps ───────────────────────────────────────────
    let step = 0
    const prev = $('pl-prev'), next = $('pl-next')
    function showStep(i) {
      step = Math.max(0, Math.min(steps.length - 1, i))
      const s = steps[step]
      $('pl-step-no').textContent = 'Step ' + step
      $('pl-step-title').textContent = s.name
      $('pl-step-body').innerHTML = `
        ${s.first ? `<p class="note"><b>Why this comes first.</b> ${esc(s.first)}</p>` : ''}
        <div class="grid c2">
          <div class="card flat"><h4 class="eyebrow">Build</h4><ul class="list">${li(s.build)}</ul></div>
          <div class="card tint"><h4 class="eyebrow">Measure of success</h4><ul class="list">${li(s.measure)}</ul></div>
        </div>
        ${s.go.length
          ? `<div class="row"><span class="muted small">See it in the mock-ups:</span>${s.go.map(goBtn).join('')}</div>`
          : '<p class="muted small">No mock-up tab shows this step. It is work under the screens.</p>'}`
      root.querySelectorAll('#pl-rail .pl-step').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.step) === step)))
      const moveFocus = document.activeElement === prev || document.activeElement === next
      prev.disabled = step === 0
      next.disabled = step === steps.length - 1
      if (moveFocus && prev.disabled) next.focus()
      if (moveFocus && next.disabled) prev.focus()
    }
    $('pl-rail').addEventListener('click', e => { const b = e.target.closest('.pl-step'); if (b) showStep(Number(b.dataset.step)) })
    prev.addEventListener('click', () => showStep(step - 1))
    next.addEventListener('click', () => showStep(step + 1))
    showStep(0)

    // ── The eleven decisions ─────────────────────────────────────
    // state[n] = { choice: '' | 'agree' | 'unsure' | 'disagree', note }. Read
    // once from this browser; whatever is stored is treated as untrusted.
    const stored = App.store.get('decisions', {})
    const state = {}
    decisions.forEach(d => {
      const s = stored && typeof stored === 'object' ? stored[d.n] : null
      state[d.n] = {
        choice: s && typeof s.choice === 'string' && Object.prototype.hasOwnProperty.call(CHOICE_LABEL, s.choice) ? s.choice : '',
        note: s && typeof s.note === 'string' ? s.note.slice(0, NOTE_MAX) : '',
      }
    })
    const flat = t => t.replace(/\s+/g, ' ').trim()
    const answered = () => decisions.filter(d => state[d.n].choice).length
    const anything = () => decisions.some(d => state[d.n].choice || flat(state[d.n].note))

    /** Write the answers to this browser and say plainly whether it kept them. */
    function keep() {
      App.store.set('decisions', state)
      const back = App.store.get('decisions', null)
      $('pl-kept').textContent = back && typeof back === 'object'
        ? 'Your answers are kept in this browser only, so they are still here when you come back. Nothing is sent anywhere.'
        : 'This browser is not keeping answers between visits. Copy them before you close the page. Nothing is sent anywhere.'
    }

    function summary() {
      const lines = ['My answers to the eleven decisions in the Pepper-first plan (' + answered() + ' of ' + decisions.length + ' answered). Agree means I accept the report\'s recommendation.']
      decisions.forEach(d => {
        const s = state[d.n], note = flat(s.note)
        lines.push(d.n + '. ' + d.short + ': ' + (s.choice ? CHOICE_LABEL[s.choice] : 'No answer yet') + (note ? '. Note: ' + note : ''))
      })
      return lines.join('\n')
    }

    const box = $('pl-summary'), status = $('pl-copy-status')
    function draw() {
      const n = answered()
      $('pl-progress').textContent = n + ' of ' + decisions.length + ' answered'
      const tally = CHOICES.map(c => [decisions.filter(d => state[d.n].choice === c[0]).length, c[1].toLowerCase()]).filter(t => t[0])
      $('pl-tally').textContent = tally.map(t => t[0] + ' ' + t[1]).join(', ')
      const pips = $('pl-pips').children
      decisions.forEach((d, i) => {
        const s = state[d.n], card = $('pl-dec-' + d.n)
        pips[i].className = s.choice
        card.dataset.choice = s.choice
        card.querySelectorAll('[data-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.choice === s.choice)))
        $('pl-len-' + d.n).textContent = s.note.length + ' of ' + NOTE_MAX
      })
      $('pl-clear').disabled = !anything()
      box.value = summary()
      box.style.height = 'auto'
      if (box.scrollHeight) box.style.height = (box.scrollHeight + 2) + 'px'
    }

    const list = $('pl-decisions')
    list.addEventListener('click', e => {
      const b = e.target.closest('button[data-choice]')
      if (!b) return
      const s = state[b.closest('.pl-dec').dataset.n]
      s.choice = s.choice === b.dataset.choice ? '' : b.dataset.choice   // a second tap takes the answer back
      status.textContent = ''
      keep(); draw()
    })
    list.addEventListener('input', e => {
      const t = e.target
      if (!t.matches || !t.matches('textarea[data-n]')) return
      state[t.dataset.n].note = t.value.slice(0, NOTE_MAX)
      status.textContent = ''
      keep(); draw()
    })

    // Clear: asked once, here on the page.
    const clear = $('pl-clear'), ask = $('pl-clear-ask')
    const askClear = on => { clear.hidden = on; ask.hidden = !on }
    clear.addEventListener('click', () => { askClear(true); $('pl-clear-no').focus() })
    $('pl-clear-no').addEventListener('click', () => { askClear(false); clear.focus() })
    $('pl-clear-yes').addEventListener('click', () => {
      decisions.forEach(d => { state[d.n] = { choice: '', note: '' }; $('pl-note-' + d.n).value = '' })
      status.textContent = ''
      askClear(false); keep(); draw()
      $('pl-dec-h').focus({ preventScroll: true })
    })

    // Copy: the clipboard call sits in the click itself. Where the browser
    // refuses, the same text is selected in the box to copy by hand.
    const WHERE = ' Paste it into the conversation with Claude.'
    $('pl-copy').addEventListener('click', () => {
      const text = summary()
      box.value = text
      const say = t => { status.textContent = t }
      const byHand = () => {
        let ok = false
        try { box.focus({ preventScroll: true }); box.select(); box.setSelectionRange(0, text.length); ok = document.execCommand('copy') } catch (err) { ok = false }
        say(ok ? 'Copied.' + WHERE + ' If nothing pastes, the text is selected below to copy by hand.'
          : 'This browser blocked the copy. The text is selected below: copy it by hand, then paste it into the conversation with Claude.')
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say('Copied.' + WHERE), byHand)
        else byHand()
      } catch (err) { byHand() }
    })

    decisions.forEach(d => { $('pl-note-' + d.n).value = state[d.n].note })
    keep(); draw()
  },
})
