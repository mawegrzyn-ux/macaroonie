// Evidence: what the market ships, what scrutiny says, what the model costs
// and what the rules require. Every figure, date, name and link here is
// taken from reports/AI first back office strategy.md (22 Nov 2026) as it is
// written there. Nothing on this view is example data, and nothing is added
// from memory: where the report is silent a cell says "Not stated".
App.view('evidence', {
  label: 'Evidence',
  group: 'Evidence and plan',
  render(root) {
    const { icon, esc } = App

    // ── Sources: only addresses that are in the report ─────────
    const S = {
      squaremates: ['Square', 'https://squareup.com/us/en/press/introducing-squaremates'],
      managerbot: ['Square', 'https://squareup.com/us/en/press/managerbot-open-beta'],
      squareHelp: ['Square help centre', 'https://squareup.com/help/us/en/article/8617'],
      squareUK: ['Square UK', 'https://squareup.com/gb/en/press/square-ai'],
      pymnts: ['PYMNTS', 'https://www.pymnts.com/artificial-intelligence-2/2026/new-square-ai-agent-automates-daily-tasks-for-main-street-sellers'],
      shopifyWinter: ['Shopify', 'https://www.shopify.com/news/winter-26-edition-merchant'],
      shopifyHelp: ['Shopify Help Center', 'https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/features?term=SEO'],
      retailTP: ['Retail TouchPoints', 'https://www.retailtouchpoints.com/topics/retail-technology/ai-ar-vr/shopify-credits-ai-for-34-revenue-growth-in-q2-2026'],
      nrnToast: ['NRN', 'https://www.nrn.com/restaurant-technology/toast-unveils-an-array-of-new-ai-agents-for-restaurants'],
      toastIQ: ['Toast', 'https://pos.toasttab.com/products/toast-iq'],
      toastEco: ['Toast support', 'https://support.toasttab.com/en/article/Toast-IQ-Intelligence-Ecosystem'],
      toastAgents: ['Toast support', 'https://support.toasttab.com/en/article/Toast-IQ-Agents-Overview'],
      toastTrends: ['Toast', 'https://pos.toasttab.com/blog/data/q1-2026-restaurant-ai-pos-trends'],
      lightspeed: ['Lightspeed', 'https://www.lightspeedhq.com/news/lightspeed-ai-expands-from-insights-to-action-with-new-agentic-capabilities-for-retail/'],
      lightspeedFinviz: ['Lightspeed via Finviz', 'https://finviz.com/news/339502/lightspeed-commerce-launches-ai-powered-automation-to-help-retailers-eliminate-manual-inventory-entry'],
      lightspeedCall: ['Lightspeed call highlights', 'https://finance.yahoo.com/markets/stocks/articles/lightspeed-commerce-q4-earnings-call-151036920.html'],
      caterer: ['The Caterer', 'https://www.thecaterer.com/indepth/deliverect-launches-ai-agents-and-smart-assistants-to-supercharge-restaurant-sales'],
      msLearn: ['Microsoft Learn', 'https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/whatsnew/whatsnew-update-29-0'],
      oracle: ['Oracle release via Webull', 'https://www.webull.com/news/15814430728966144'],
      sage: ['Sage', 'https://www.sage.com/en-us/news/press-releases/2026/11/sage-intacct-sets-out-its-vision-for-an-agentic-finance-platform-with-ai-workspaces/'],
      xero: ['Xero', 'https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/'],
      xeroJax: ['Xero', 'https://www.xero.com/au/ai-in-accounting/jax/'],
      spotonBW: ['Business Wire', 'https://www.businesswire.com/news/home/20260602225359/en/SpotOn-Introduces-Profit-AI-Delivering-Proactive-Profit-Recommendations-to-Independent-Restaurants'],
      spotonMenu: ['SpotOn', 'https://www.spoton.com/solutions/ai-menu-assistant/'],
      fourth: ['Fourth', 'https://www.fourth.com/press-release/fourth-launches-fourth-iq-3-0'],
      accessTrail: ['Access Group', 'https://www.theaccessgroup.com/en-gb/hospitality/software/checklists/'],
      accessEvo: ['Access Group', 'https://www.theaccessgroup.com/en-gb/hospitality/evo-early-access/'],
      tenzo: ['IT Brief UK', 'https://itbrief.co.uk/story/tenzo-launches-ai-connector-for-hospitality-operators'],
      flipdish: ['Flipdish', 'https://www.flipdish.com/gb/resources/blog/introducing-flipdish-ai-phone-agent-for-restaurants'],
      crunchtime: ['Crunchtime', 'https://www.crunchtime.com/press/crunchtime-introduces-four-new-ai-capabilities-to-elevate-operations-management-lifecycle'],
      googleResearch: ['Google Research', 'https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/'],
      dynamicBusiness: ['Dynamic Business', 'https://dynamicbusiness.com/ai-tools/toast-iq-team-ai-labor-management-software.html'],
      techeu: ['Tech.eu', 'https://tech.eu/2025/09/16/nory-closes-37m-series-b-to-automate-restaurant-operations-with-ai/'],
      rtn: ['Restaurant Technology News', 'https://restauranttechnologynews.com/2026/08/marginedge-raises-80-million-as-competition-for-the-ai-powered-restaurant-back-office-intensifies/'],
      emarketer: ['eMarketer', 'https://www.emarketer.com/content/toast-q4-2025-earnings-reveal-all-in-ai-strategy'],
      fool: ['Motley Fool transcript', 'https://www.fool.com/earnings/call-transcripts/2026/05/07/toast-tost-q1-2026-earnings-call-transcript/'],
      toast8k: ['Toast 8-K', 'https://www.sec.gov/Archives/edgar/data/0001650164/000165016426000214/tost-20260930xexhibit991.htm'],
      arxiv2605: ['arXiv 2605.31287', 'https://arxiv.org/pdf/2605.31287'],
      arxiv2608: ['arXiv 2608.19551', 'https://arxiv.org/pdf/2608.19551'],
      arxiv2505: ['arXiv 2505.18878', 'https://arxiv.org/abs/2505.18878'],
      arxiv2604: ['arXiv 2604.25149', 'https://arxiv.org/abs/2604.25149'],
      acl: ['ACL Anthology', 'https://aclanthology.org/2026.findings-emnlp.1971/'],
      roTurnover: ['Restaurant Online', 'https://www.restaurantonline.co.uk/Article/2025/09/30/internal-promotions-driving-lower-staff-turnover-in-hospitality-report-says'],
      roTop100: ['Restaurant Online', 'https://www.restaurantonline.co.uk/Article/2026/08/24/the-uks-top-100-restaurant-groups-see-profits-fall-by-nearly-half/'],
      helpnet: ['Help Net Security', 'https://helpnetsecurity.com/2026/10/20/frontline-worker-authentication-passwordless'],
      ncsc: ['NCSC', 'https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection'],
      anthropicInj: ['Anthropic', 'https://www.anthropic.com/research/prompt-injection-defenses'],
      anthropicPricing: ['Anthropic', 'https://platform.claude.com/docs/en/about-claude/pricing.md'],
      nbc: ['NBC News', 'https://www.nbcnews.com/business/business-news/mcdonalds-end-ai-drive-test-ibm-rcna157603'],
      bloomberg: ['Bloomberg', 'https://www.bloomberg.com/news/articles/2025-05-08/klarna-turns-from-ai-to-real-person-customer-service'],
      gibson: ['Gibson Dunn', 'https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/'],
      usercentrics: ['Usercentrics', 'https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/'],
      clifford: ['Clifford Chance', 'https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/key-aspects-of-the-data--use-and-access--act-take-effect.html'],
      stevens: ['Stevens & Bolton', 'https://www.stevens-bolton.com/insights/102mpf8/the-data-use-and-access-act-2025-draft-guidance-on-automated-decision-making-i/'],
      taylor: ['Taylor Wessing', 'https://www.taylorwessing.com/en/insights-and-events/insights/2026/03/aq-ai-agents-cma-publishes-guidance-on-complying-with-consumer-law'],
      candc: ['C&C Solicitors', 'https://www.candcsolicitors.co.uk/blog/owens-law-spring-2026-fsa-allergen-review/'],
      govuk: ['GOV.UK', 'https://www.gov.uk/paye-for-employers/keeping-records'],
    }
    // A source is a key, or [key, the words to show] where two share a name.
    const link = s => {
      const k = Array.isArray(s) ? s[0] : s
      const words = Array.isArray(s) ? s[1] : S[k][0]
      return '<a href="' + esc(S[k][1]) + '" target="_blank" rel="noopener">' + esc(words) + '</a>'
    }
    const links = list => list.map(link).join(', ')

    // ── Confidence: the report's words, three colours ──────────
    const CONF_CLASS = { 'High': 'high', 'Medium to high': 'medium', 'Medium': 'medium', 'Medium to low': 'low', 'Low': 'low' }
    const confTag = (c, tail) => c === 'code'
      ? '<span class="tag high">High for the code</span><span class="tag">None for use</span>'
      : '<span class="tag ' + CONF_CLASS[c] + '">' + esc(c) + (tail ? ' ' + tail : '') + '</span>'
    const UNRATED = 'The report\'s table does not rate this on its own, so it takes the level the report gives any single outside figure.'
    const LAW = 'Taken from law-firm and vendor summaries. The primary texts were not read, and this is no legal advice.'
    const CODE = 'Counted from the files on 22 November 2026. Nothing was checked at run time and no usage data exists.'

    // ── Findings ───────────────────────────────────────────────
    const CATS = [['trends', 'Trends'], ['scrutiny', 'Scrutiny'], ['cost', 'Cost'], ['regulation', 'Regulation'], ['macaroonie', 'Macaroonie today']]
    const CAT_NAME = {}
    CATS.forEach(c => { CAT_NAME[c[0]] = c[1] })
    const findings = [
      {
        cat: 'trends', conf: 'High',
        title: `The agent has moved from a side panel to the first screen.`,
        detail: `Square's Squaremates became generally available to US sellers on 12 November 2026, and Square describes it as "the front door to Square Dashboard". Shopify's Sidekick puts a personalised task list on the merchant's home screen.`,
        why: `Shipped products, controlled studies and documented reversals agree.`,
        src: ['squaremates', 'shopifyWinter'],
      },
      {
        cat: 'trends', conf: 'High',
        title: `The leading agents wait for a person's approval before they change anything.`,
        detail: `Square's agent "proposes an action, waits for the seller's approval and then executes", and Toast and Shopify say the same of theirs. The one exception found is Deliverect, whose menu agents re-rank digital menus toward a goal the operator sets, a change that is reversible and guest-facing.`,
        why: `Vendor practice, security guidance and Macaroonie's own design agree.`,
        src: ['pymnts', 'toastIQ', 'shopifyHelp', 'caterer'],
      },
      {
        cat: 'trends', conf: 'Medium',
        title: `The new screen is a place to review what agents drafted.`,
        detail: `Microsoft's Business Central made a task pane for all agents generally available in its October 2026 release, while its Copilot chat stayed in public preview. NetSuite and Sage Intacct both announced AI Workspaces that put people, agents and approvals in one place.`,
        why: `Generally available at ERP vendors. No outcome data has been published.`,
        src: ['msLearn', 'oracle', 'sage'],
      },
      {
        cat: 'trends', conf: 'Medium to low',
        title: `Vendors send the operator a short list of things that need attention.`,
        detail: `Toast's scheduled agents check data and send a notification or email, for example about missed breaks or sold-out items. The UK checklist product Trail is organised around the day's checklists, with over 245 million tasks completed by its vendor's count.`,
        why: `For a task feed as Home this is a reasoned bet, backed by vendor direction and one set of usage logs. No controlled test exists.`,
        src: ['toastAgents', 'accessTrail'],
      },
      {
        cat: 'trends', conf: 'Medium',
        title: `No vendor found has replaced its fixed forms with forms made on the fly.`,
        detail: `Where products generate an interface, a person builds an app, a report or a view once and then keeps it. Free generation is still slow: Google says its generated pages "can sometimes take a minute or more" with "occasional inaccuracies".`,
        why: `An absence across the sources found. The search for restaurant products did not run, so the report records this as not found.`,
        src: ['shopifyWinter', 'oracle', 'googleResearch'],
      },
      {
        cat: 'trends', conf: 'Medium to low',
        title: `The agents that act are American, and franchises are served last.`,
        detail: `Squaremates is for US sellers. UK Square sellers received the earlier read-only Square AI in February 2026, and the Managerbot beta covered "most non-franchise" sellers.`,
        why: `Availability searches did not run. The absence rests on one search per vendor.`,
        src: [['squaremates', 'Square (Squaremates)'], 'squareUK', ['managerbot', 'Square (Managerbot beta)']],
      },
      {
        cat: 'trends', conf: 'Low',
        title: `Food safety, cash, tips and wages carry almost no vendor AI.`,
        detail: `Food safety is almost untouched apart from Crunchtime's photo checks. Cash reconciliation, tips and wages appeared in no vendor's AI announcement found.`,
        why: UNRATED + ` It is an absence in the announcements found.`,
        src: ['crunchtime'],
      },
      {
        cat: 'scrutiny', conf: 'Low', kind: 'Vendor-reported',
        title: `More than half of one vendor's sites tried its assistant. About a fifth to a quarter use it weekly.`,
        detail: `More than half of Toast locations had tried Toast IQ within four months of launch. 40,000 locations were weekly active in the first quarter of 2026, against a base that reached about 189,000 two quarters later, so the share is an order of magnitude from figures in different quarters.`,
        why: `The report rates adoption percentages low. These are the vendor's own numbers.`,
        src: ['emarketer', 'fool', 'toast8k'],
      },
      {
        cat: 'scrutiny', conf: 'High',
        title: `Chat lowers effort. It does not save time or improve accuracy.`,
        detail: `Among 134 industrial decision-makers a conversational interface lowered perceived workload against a dashboard, neither was more accurate, and its advantages "diminished as task complexity increased". In a 73-person study users "did not appear to avoid delegating riskier actions", so the product has to apply the extra friction.`,
        why: `Shipped products, controlled studies and documented reversals agree. Nothing found contradicts it.`,
        src: ['arxiv2605', 'arxiv2608'],
      },
      {
        cat: 'scrutiny', conf: 'Low', kind: 'Vendor-reported in part',
        title: `Frontline staff are often new, share devices and ask from a phone during service.`,
        detail: `Team turnover in UK hospitality ran at 67% in the year to autumn 2025, and 95% of IT and security decision-makers had seen frontline staff stay signed in or share credentials in the past year. One US vendor's assistant logs, with no published method, show 54% of prompts coming from phones and 53% arriving during peak lunch or dinner service.`,
        why: UNRATED + ` The logs are one vendor's own.`,
        src: ['roTurnover', 'helpnet', 'toastTrends'],
      },
      {
        cat: 'scrutiny', conf: 'Medium to high',
        title: `Open-ended agents fail about two tasks in three. A defined task and a curated catalogue do far better.`,
        detail: `On a benchmark of sales and service tasks, leading agents succeed about 35% of the time in multi-turn settings and above 83% when executing a defined workflow. Model-written SQL reaches 39.1% on an enterprise-scale variant of a standard benchmark against 82.0% on the original, and a curated description of the data adds 17 to 23 percentage points on a small benchmark of 100 questions.`,
        why: `A consistent direction across benchmarks. The two semantic-layer benchmarks are small.`,
        src: ['arxiv2505', 'acl', 'arxiv2604'],
      },
      {
        cat: 'scrutiny', conf: 'High',
        title: `Prompt injection cannot be fully prevented.`,
        detail: `The UK's National Cyber Security Centre says prompt injection "may never be totally mitigated", because a model draws no inherent line between data and instruction. Anthropic's own measurement has its best-defended model still successfully attacked 1.4% of the time under adaptive attack.`,
        why: `This supports typed actions and confirmation of a preview the system builds, where vendor practice, security guidance and Macaroonie's own design agree.`,
        src: ['ncsc', 'anthropicInj'],
      },
      {
        cat: 'scrutiny', conf: 'High',
        title: `The firms that reversed kept the technology and brought back a conventional route.`,
        detail: `McDonald's on drive-through voice ordering and Klarna on customer service are the report's examples. No documented failure of an assistant inside a restaurant back office was found, which the report puts down to how new such products are more than to how safe they are.`,
        why: `Shipped products, controlled studies and documented reversals agree.`,
        src: ['nbc', 'bloomberg'],
      },
      {
        cat: 'cost', conf: 'Medium to low', kind: 'Researchers\' estimate',
        title: `If every click became a model call, a mid-tier model would take a third or more of a site's subscription.`,
        detail: `At 3,000 requests a month the mid tier costs about US$135 a site, which the report puts at 35% to 70% of a bundled price of £150 to £300. On the small model the same volume costs US$9.`,
        why: `Published token prices with assumed token counts. The product's own usage record should replace them.`,
        src: ['anthropicPricing'],
      },
      {
        cat: 'cost', conf: 'Low', kind: 'Secondary source',
        title: `The assistant is given away. Vendors charge for agents that do a job.`,
        detail: `Squaremates and Xero's JAX chat carry no extra charge. Toast IQ Team is reported from US$60 a month plus US$9 per employee, a figure from a secondary source.`,
        why: UNRATED,
        src: ['squaremates', 'xeroJax', 'dynamicBusiness'],
      },
      {
        cat: 'cost', conf: 'Low', kind: 'Researchers\' arithmetic',
        title: `Buyers work on thin margins, so value is counted in hours saved.`,
        detail: `The UK's 100 largest restaurant groups made £204m of profit on £13.3bn of revenue in the year to mid-2026, about 1.5%. By the researchers' own arithmetic a saved frontline hour is worth about £16 to £17 fully loaded, so a £100 a month product breaks even at about six saved hours a month.`,
        why: UNRATED,
        src: ['roTop100'],
      },
      {
        cat: 'regulation', conf: 'Medium', kind: 'Law-firm summary',
        title: `The law leaves responsibility with the operator.`,
        detail: `The UK competition regulator's March 2026 guidance holds a business responsible for its AI agent's conduct toward consumers, even where a third party supplies it. Payroll records must be kept for three years, so a stored record has to stand apart from the conversation that produced it.`,
        why: LAW,
        src: ['taylor', 'govuk'],
      },
      {
        cat: 'regulation', conf: 'Medium', kind: 'Law-firm summary',
        title: `A token human check is not enough.`,
        detail: `The UK's automated decision-making reforms took effect on 5 February 2026. The regulator's draft guidance says the person must have real authority to override and must understand the basis.`,
        why: LAW,
        src: ['clifford', 'stevens'],
      },
      {
        cat: 'macaroonie', conf: 'code',
        title: `Macaroonie has built most of the safety model the leaders use. None of it is proven in use.`,
        detail: `Pepper has 159 staff tools, 97 of them change tools behind a Confirm card, and a 136-subject report catalogue in which nobody, person or model, writes SQL. Tool search, the report tools, streaming, model routing and the document readers are each recorded as tested only against a stand-in, and no evaluation set or usage record exists.`,
        why: CODE,
        files: ['api/src/ai/tools/index.js', 'api/src/reports/catalogue', 'docs/claude/OUTSTANDING.md'],
      },
      {
        cat: 'macaroonie', conf: 'code',
        title: `Finding a page by words is close. Generated forms are far.`,
        detail: `Destinations, descriptions, search words and permissions are already data, and the missing half is the venue, day and tab in the address. The admin has 699 hand-built inputs, and 7 client-side validation schemas against 560 in the API's routes.`,
        why: CODE,
        files: ['docs/PEPPER_FIRST.md', 'admin/src', 'api/src/routes'],
      },
    ]

    // ── Who has shipped what ───────────────────────────────────
    const NS = '<span class="muted">Not stated</span>'
    const SECTORS = [['restaurant', 'Restaurant'], ['retail', 'Retail'], ['erp', 'Accounting and ERP']]
    const SECTOR_NAME = {}
    SECTORS.forEach(s => { SECTOR_NAME[s[0]] = s[1] })
    const st = (cls, word, rest) => '<span class="tag ' + cls + '">' + esc(word) + '</span>' + (rest ? '<span class="ev-rest">' + esc(rest) + '</span>' : '')
    const vendors = [
      {
        sectors: ['restaurant'], vendor: 'Square', product: 'Squaremates',
        what: `Square calls it "the front door to Square Dashboard", where sellers ask questions, see what needs attention and get work done. A connector lets an outside assistant "ask questions and make changes" through a defined set of actions.`,
        acts: `Acts`,
        approval: `Proposes an action, waits for the seller's approval and then executes. An action can be undone by asking the agent to reverse it.`,
        status: st('built', 'Generally available', 'To US sellers on 12 November 2026. It followed Managerbot, in open beta from 28 April 2026.'),
        uk: `For US sellers. UK sellers received the earlier read-only Square AI in February 2026.`,
        src: ['squaremates', 'pymnts', 'squareHelp', 'squareUK'],
      },
      {
        sectors: ['restaurant'], vendor: 'Toast', product: 'Toast IQ, with Grow and Team agents',
        what: `An assistant over the operator's own data. Two families of named agents: Grow for marketing and Team for labour. Scheduled agents check data and send a notification or email, for example about missed breaks or sold-out items.`,
        acts: `Acts`,
        approval: `Acts "with your approval" and within the user's existing permissions.`,
        status: st('medium', 'Beta or early access', 'Most agents, in October 2026. The assistant launched in October 2025.'),
        uk: null,
        src: ['nrnToast', 'toastIQ', ['toastEco', 'Toast support (ecosystem)'], ['toastAgents', 'Toast support (agents)']],
      },
      {
        sectors: ['restaurant'], vendor: 'Deliverect', product: 'Menu agents and smart assistants',
        what: `Menu agents re-rank digital menus toward a goal the operator sets. Its assistants "never modify the actual food items themselves".`,
        acts: `Acts`,
        approval: `No approval for each change. The operator sets the goal, and the change is reversible and guest-facing.`,
        status: st('', 'Shipped', 'Stage not stated.'),
        uk: `Listed with the UK-rooted vendors.`,
        src: ['caterer'],
      },
      {
        sectors: ['restaurant'], vendor: 'SpotOn', product: 'Profit AI and the AI menu assistant',
        what: `Profit AI delivers "proactive profit recommendations". The menu assistant makes bulk edits to existing records from a prompt.`,
        acts: `Recommends. The menu assistant edits records.`,
        approval: null, status: NS, uk: null,
        src: ['spotonBW', 'spotonMenu'],
      },
      {
        sectors: ['restaurant'], vendor: 'Fourth', product: 'Fourth iQ 3.0',
        what: `Adds "a new layer of above-store AI" that surfaces risks and recommended actions across an estate.`,
        acts: `Recommends`,
        approval: null,
        status: st('', 'Shipped', 'Stage not stated.'),
        uk: `Listed with the UK-rooted vendors.`,
        src: ['fourth'],
      },
      {
        sectors: ['restaurant'], vendor: 'Access Group', product: 'Evo Copilot',
        what: `Natural-language questions over its till and checklist products.`,
        acts: `Answers questions`,
        approval: null,
        status: st('', 'Shipped', 'Stage not stated.'),
        uk: `Listed with the UK-rooted vendors.`,
        src: ['accessEvo'],
      },
      {
        sectors: ['restaurant'], vendor: 'Access Group', product: 'Trail',
        what: `A checklist product organised around the day's checklists, with over 245 million tasks completed by its vendor's count. Its assistant answers questions on the job.`,
        acts: `Answers questions`,
        approval: null,
        status: st('', 'Offered', 'The assistant comes in a higher tier.'),
        uk: `A UK product.`,
        src: ['accessTrail'],
      },
      {
        sectors: ['restaurant'], vendor: 'Tenzo', product: 'AI connector',
        what: `Answers questions inside ChatGPT, Claude, Gemini or Copilot, pitched as "a shift away from dashboards and towards direct answers".`,
        acts: `Answers questions`,
        approval: null,
        status: st('', 'Shipped', 'Stage not stated.'),
        uk: `A UK analytics vendor.`,
        src: ['tenzo'],
      },
      {
        sectors: ['restaurant'], vendor: 'Flipdish', product: 'AI phone agent',
        what: `A phone agent. The report gives no more detail.`,
        acts: null, approval: null,
        status: st('', 'Shipped', 'Stage not stated.'),
        uk: `Listed with the UK-rooted vendors.`,
        src: ['flipdish'],
      },
      {
        sectors: ['restaurant'], vendor: 'Crunchtime', product: 'Product not named',
        what: `Voice for stock counts and photos for compliance checks.`,
        acts: `Takes data in by voice and photo`,
        approval: null, status: NS, uk: null,
        src: ['crunchtime'],
      },
      {
        sectors: ['retail'], vendor: 'Shopify', product: 'Sidekick',
        what: `Carries out multi-step tasks, builds automations and generates custom admin apps that a merchant tests and installs. Puts a personalised task list on the merchant's home screen.`,
        acts: `Acts`,
        approval: `Sidekick "is never allowed to make changes to your shop without your approval".`,
        status: st('', 'In use', 'Stage not stated. Merchants held nearly 34 million conversations with it in the second quarter of 2026.'),
        uk: null,
        src: ['shopifyWinter', 'shopifyHelp', 'retailTP'],
      },
      {
        sectors: ['retail', 'restaurant'], vendor: 'Lightspeed', product: 'Retail agent',
        what: `A retail agent dated October 2026, and document reading for supplier paperwork. Lightspeed also reports about 20% of target restaurant locations adopting its restaurant AI.`,
        acts: `Acts`,
        approval: `The retailer approves every change.`,
        status: st('medium', 'Beta', 'Opt-in, October 2026.'),
        uk: null,
        src: ['lightspeed', 'lightspeedFinviz', 'lightspeedCall'],
      },
      {
        sectors: ['erp'], vendor: 'Microsoft', product: 'Business Central',
        what: `A task pane for all agents: a place to review what agents drafted.`,
        acts: `Agents draft`,
        approval: `People approve what agents draft.`,
        status: st('built', 'Generally available', 'The task pane, in the October 2026 release. The Copilot chat stayed in public preview.'),
        uk: null,
        src: ['msLearn'],
      },
      {
        sectors: ['erp'], vendor: 'NetSuite', product: 'AI Workspaces and AI Portlets',
        what: `AI Workspaces put people, agents and approvals in one place. AI Portlets build a dashboard from a sentence.`,
        acts: `Agents draft`,
        approval: `People approve what agents draft.`,
        status: st('target', 'Announced'),
        uk: null,
        src: ['oracle'],
      },
      {
        sectors: ['erp'], vendor: 'Sage', product: 'Sage Intacct AI Workspaces',
        what: `AI Workspaces put people, agents and approvals in one place.`,
        acts: `Agents draft`,
        approval: `People approve what agents draft.`,
        status: st('target', 'Announced'),
        uk: null,
        src: ['sage'],
      },
      {
        sectors: ['erp'], vendor: 'Xero', product: 'JAX',
        what: `Matches high-confidence transactions to bank feeds and explains each match. The JAX chat carries no extra charge.`,
        acts: `Acts`,
        approval: `The customer approves each step where it matches documents to transactions.`,
        status: NS, uk: null,
        src: [['xero', 'Xero (release)'], ['xeroJax', 'Xero (JAX)']],
      },
    ]

    // ── What the model costs a site (the report's table) ───────
    // Thousandths of a US dollar per request, so the sums stay whole.
    const TIERS = [
      { id: 'small', name: 'Small', model: 'Haiku 5.5', milli: 3 },
      { id: 'mid', name: 'Mid', model: 'Sonnet 5.5', milli: 45 },
      { id: 'upper', name: 'Upper', model: 'Opus 5.5', milli: 90 },
    ]
    // The report gives no exchange rate. It says US$135 is 35% of £300 and
    // 70% of £150, so US$135 stands for £105, and shares are scaled from that.
    const GBP_PER_USD = 105 / 135
    const whole = n => Math.abs(n - Math.round(n)) < 0.005
    const usd = milli => { const d = milli / 1000; return 'US$' + (whole(d) ? Math.round(d).toLocaleString('en-GB') : d.toFixed(2)) }
    const gbp = v => '£' + (whole(v) ? Math.round(v).toLocaleString('en-GB') : v.toFixed(2))
    const pct = p => (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%'
    const count = n => Number(n).toLocaleString('en-GB')

    // ── Rules and dates ────────────────────────────────────────
    const rules = [
      {
        when: '5 February 2026', title: 'UK automated decision-making reforms took effect',
        tags: [['built', 'In force'], ['', 'Guidance in draft']],
        means: `Token human oversight is not enough. The regulator's draft guidance says the person must have real authority to override and must understand the basis.`,
        src: ['clifford', 'stevens'],
      },
      {
        when: 'March 2026', title: 'UK competition regulator\'s guidance on AI agents',
        tags: [['built', 'Guidance published']],
        means: `A business is responsible for its AI agent's conduct toward consumers, even where a third party supplies the agent.`,
        src: ['taylor'],
      },
      {
        when: '2 August 2026', title: 'EU transparency duties',
        tags: [['built', 'Reported in force']],
        means: `Reported to have applied since this date. The report gives the date only and does not set out what the duties ask of a back office.`,
        src: ['usercentrics'],
      },
      {
        when: '2 December 2027', title: 'EU high-risk AI obligations, which include worker management',
        tags: [['medium', 'Upcoming']],
        means: `Moved to this date. The report's line: rota, pay and tip proposals stay drafts a manager edits, and Pepper does not rank or score individual staff.`,
        src: ['gibson'],
      },
      {
        when: 'Not enacted', title: 'Mandatory written allergen information',
        tags: [['low', 'Proposed']],
        means: `Proposed and not enacted. The report's line: allergen data read by a model needs a named person's sign-off.`,
        src: ['candc'],
      },
      {
        when: 'Standing rule', title: 'Payroll records kept for three years',
        tags: [['built', 'In force']],
        means: `The report's line: the stored record and its audit trail stand independently of the conversation that produced them.`,
        src: ['govuk'],
      },
    ]

    // ── How far to trust each conclusion (the report's table) ──
    const trust = [
      ['Ask first with screens underneath beats chat-only', 'High', 'Shipped products, controlled studies and documented reversals agree; nothing found contradicts it'],
      ['Typed actions, the person\'s own permissions, and confirmation of a system-built preview', 'High', 'Vendor practice, security guidance and Macaroonie\'s own design agree'],
      ['A curated catalogue over model-written SQL', 'Medium to high', 'Consistent direction across benchmarks; the two semantic-layer benchmarks are small'],
      ['No vendor replaces transaction forms with generated ones', 'Medium', 'Absence across the sources found; the sector-specific search did not run'],
      ['A task feed as Home beats dashboards and menus for site staff', 'Medium to low', 'A reasoned bet backed by vendor direction and one telemetry set; no controlled test exists'],
      ['Filled forms reduce effort without raising errors', 'Medium to low', 'Supported by related studies; no direct study of model-filled forms was found'],
      ['A review queue is the right next surface', 'Medium', 'Generally available at ERP vendors; no outcome data published'],
      ['Hold-to-talk voice for small, checkable entries', 'Medium to low', 'Vendor claims and noise research; no independent kitchen measurement'],
      ['The UK lags and franchises are under-served', 'Medium to low', 'Availability searches did not run; absence on one search per vendor'],
      ['Unit-cost estimates', 'Medium to low', 'Published token prices with assumed token counts; the product\'s own usage record should replace them'],
      ['Market sizes, adoption percentages, hours saved', 'Low', 'Report sellers and vendor surveys, with estimates that differ by up to nine times for "AI in restaurants"'],
      ['Regulatory dates and duties', 'Medium', 'Law-firm and vendor summaries, not primary texts; not legal advice'],
      ['Macaroonie\'s internal counts', 'code', 'Counted from files on 22 November 2026; nothing verified at run time and no usage data exists'],
    ]

    // ── What was not researched ────────────────────────────────
    const notRun = [
      'Independent reviews and operator complaints about Toast IQ and Square\'s assistants',
      'UK availability of the US vendors\' AI features',
      'Natural-language navigation and generated forms in restaurant products',
      'Controlled studies of model-filled forms',
      'Command bars in other products',
      'Several frontline task platforms',
      'Voice in warehouses and on wearables',
      'UK digital-skills and accessibility data',
      'Regulator guidance on AI and allergen information',
      'Other providers\' model prices',
      'Analyst and benchmark reports',
      'The catalogue data models of the main retail platforms',
    ]
    const missing = [
      'No independent time-use study of restaurant or shop managers',
      'No controlled test of a task feed against dashboards',
      'No independent measurement of speech recognition in a working kitchen',
    ]

    const JUMPS = [['ev-findings', 'Findings'], ['ev-vendors', 'Who has shipped what'], ['ev-cost', 'What the model costs'], ['ev-rules', 'Rules and dates'], ['ev-trust', 'How far to trust it'], ['ev-gaps', 'What was not researched']]

    const style = `<style>
      #view-evidence .ev-sec { display: grid; gap: 12px; scroll-margin-top: 120px; min-width: 0; }
      #view-evidence .ev-all { display: grid; gap: 28px; }
      #view-evidence .ev-sec > .seg, #view-evidence .ev-ctl > .seg { justify-self: start; }
      #view-evidence .ev-limits { border-left: 4px solid var(--warn); scroll-margin-top: 120px; }
      #view-evidence .ev-limits h2, #view-evidence .ev-over { display: flex; align-items: center; gap: 8px; }
      #view-evidence .ev-over svg { width: 16px; height: 16px; flex: none; color: var(--bad); }
      #view-evidence .ev-n { font-variant-numeric: tabular-nums; opacity: 0.7; margin-left: 5px; font-size: 12px; }
      #view-evidence .ev-finding { gap: 8px; }
      #view-evidence .ev-finding h3 { font-size: 16.5px; line-height: 1.25; }
      #view-evidence .ev-meta { font-size: 12.5px; color: var(--ink-2); overflow-wrap: anywhere; }
      #view-evidence .ev-meta b { font-weight: 600; color: var(--ink); }
      #view-evidence .ev-vt { min-width: 1120px; }
      #view-evidence .ev-vt td:nth-child(1) { min-width: 150px; }
      #view-evidence .ev-vt td:nth-child(2) { min-width: 270px; }
      #view-evidence .ev-vt td:nth-child(4) { min-width: 200px; }
      #view-evidence .ev-vt td:nth-child(5) { min-width: 190px; }
      #view-evidence .ev-vt td:nth-child(6) { min-width: 150px; }
      #view-evidence .ev-vt .ev-who { display: grid; gap: 4px; justify-items: start; }
      #view-evidence .ev-rest { display: block; margin-top: 4px; font-size: 12.5px; color: var(--ink-2); }
      #view-evidence .ev-cost { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
      #view-evidence .ev-cost > * { min-width: 0; display: grid; gap: 14px; align-content: start; }
      @media (max-width: 860px) { #view-evidence .ev-cost { grid-template-columns: minmax(0, 1fr); } }
      #view-evidence .ev-ctl { display: grid; gap: 6px; min-width: 0; }
      #view-evidence .ev-ctl .ev-lab { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; justify-content: space-between; font-size: 13px; font-weight: 600; }
      #view-evidence .ev-ctl output { font-family: var(--font-display); font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
      #view-evidence .ev-range { width: 100%; min-height: 44px; margin: 0; accent-color: var(--brand); touch-action: manipulation; }
      #view-evidence .ev-ends { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-2); margin-top: -6px; }
      #view-evidence .ev-tiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); }
      #view-evidence .ev-tile { display: grid; gap: 2px; align-content: start; min-width: 0; }
      #view-evidence .ev-tile .ev-k { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
      #view-evidence .ev-big { font-family: var(--font-display); font-size: clamp(34px, 6vw, 46px); font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--ink); }
      #view-evidence .ev-meterwrap { display: grid; gap: 6px; }
      #view-evidence .ev-meter { position: relative; height: 16px; }
      #view-evidence .ev-meter span { position: absolute; top: 0; bottom: 0; left: 0; display: block; }
      #view-evidence .ev-track { background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--line); border-radius: 4px; }
      #view-evidence .ev-fill { background: var(--brand); border-radius: 4px; }
      #view-evidence .ev-more { background: var(--bad); border-radius: 0 4px 4px 0; }
      #view-evidence .ev-meter.over .ev-fill { border-radius: 4px 0 0 4px; }
      #view-evidence .ev-scale { font-size: 12px; color: var(--ink-2); }
      #view-evidence .ev-scale span { display: inline-block; min-width: max-content; text-align: right; }
      #view-evidence .ev-time { list-style: none; margin: 0; padding: 0; display: grid; }
      #view-evidence .ev-time li { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 0 18px; }
      #view-evidence .ev-when { font-weight: 600; font-variant-numeric: tabular-nums; padding-top: 1px; text-align: right; }
      #view-evidence .ev-what { position: relative; border-left: 2px solid var(--line); padding: 0 0 22px 20px; display: grid; gap: 6px; min-width: 0; }
      #view-evidence .ev-time li:last-child .ev-what { padding-bottom: 2px; }
      #view-evidence .ev-what::before { content: ""; position: absolute; left: -7px; top: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px var(--surface); }
      @media (max-width: 640px) {
        #view-evidence .ev-time li { grid-template-columns: minmax(0, 1fr); }
        #view-evidence .ev-when { text-align: left; padding: 0 0 4px 22px; border-left: 2px solid var(--line); }
        #view-evidence .ev-what::before { top: -17px; }
      }
      #view-evidence .ev-ct { min-width: 520px; }
      #view-evidence .ev-ct td { white-space: nowrap; }
      #view-evidence .ev-tt td:nth-child(1) { min-width: 200px; font-weight: 500; }
      #view-evidence .ev-tt td:nth-child(2) { white-space: nowrap; }
      #view-evidence .ev-gapgrid { display: grid; gap: 14px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
      @media (max-width: 900px) { #view-evidence .ev-gapgrid { grid-template-columns: minmax(0, 1fr); } }
      #view-evidence .ev-two { columns: 2 260px; column-gap: 28px; display: block; }
      #view-evidence .ev-two li { break-inside: avoid; margin-bottom: 6px; }
    </style>`

    const findingCard = f => `
      <article class="card ev-finding" data-cat="${f.cat}">
        <span class="eyebrow">${esc(CAT_NAME[f.cat])}</span>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.detail)}</p>
        <div class="row">${confTag(f.conf, 'confidence')}${f.kind ? '<span class="tag">' + esc(f.kind) + '</span>' : ''}</div>
        <p class="ev-meta"><b>Why this level.</b> ${esc(f.why)}</p>
        <p class="ev-meta"><b>${f.src ? (f.src.length > 1 ? 'Sources' : 'Source') : 'From the code'}.</b> ${f.src ? links(f.src) : f.files.map(x => '<span class="mono">' + esc(x) + '</span>').join(', ')}</p>
      </article>`

    const vendorRow = v => `
      <tr data-sectors="${v.sectors.join(' ')}">
        <td><div class="ev-who"><b>${esc(v.vendor)}</b><span>${esc(v.product)}</span><span class="tag">${esc(v.sectors.map((s, i) => i ? SECTOR_NAME[s].toLowerCase() : SECTOR_NAME[s]).join(' and '))}</span><span class="ev-meta">${links(v.src)}</span></div></td>
        <td>${esc(v.what)}</td>
        <td>${v.acts ? esc(v.acts) : NS}</td>
        <td>${v.approval ? esc(v.approval) : NS}</td>
        <td>${v.status}</td>
        <td>${v.uk ? esc(v.uk) : NS}</td>
      </tr>`

    root.innerHTML = style + `
      <div class="view-head">
        <span class="eyebrow">Evidence · research of 22 November 2026</span>
        <h1>The evidence: what the market ships and what scrutiny says</h1>
        <p class="lede">The trends in AI-led back-office software, the scrutiny of them, what the model costs and what the rules require. Nothing here is example data: every figure, date and name comes from the research report as it is written.</p>
        <nav class="row" id="ev-jump" aria-label="On this page">
          ${JUMPS.map(j => `<button type="button" class="btn" data-jump="${j[0]}">${esc(j[1])}</button>`).join('')}
        </nav>
      </div>

      <div class="ev-all">
        <section class="card ev-limits" id="ev-limits" aria-labelledby="ev-limits-h">
          <div class="row"><h2 id="ev-limits-h">${icon('alert')} Read this first: the limits</h2><span class="spacer"></span><span class="tag medium">Direction: medium to high</span><span class="tag low">Individual figures: low</span></div>
          <ul class="list">
            <li>Almost no source page could be opened from the research environment. Nearly every finding rests on a search engine's summary of the page.</li>
            <li>Several planned searches never ran. They are listed at the end of this page.</li>
            <li>Most adoption and outcome figures are reported by vendors about their own products, with definitions that differ between them.</li>
            <li>Nothing has been tested with Macaroonie's users. The product has none yet.</li>
          </ul>
          <p>Confidence in the direction is medium to high. Confidence in any single figure is low. Check a quotation or a date at its link before repeating it.</p>
        </section>

        <section class="ev-sec" id="ev-findings" aria-labelledby="ev-findings-h">
          <div class="row"><h2 id="ev-findings-h">Findings</h2><span class="spacer"></span><span class="small muted" id="ev-fcount" role="status"></span></div>
          <p class="muted" style="max-width:78ch">Each card gives one finding, the detail behind it and where it comes from. The tag is the report's confidence in the conclusion the finding supports, taken from its own table. A finding the table does not cover is tagged low, the level the report gives any single outside figure.</p>
          <div class="seg" id="ev-fseg" role="group" aria-label="Show findings about">
            <button type="button" data-cat="all" aria-pressed="true">All<span class="ev-n">${findings.length}</span></button>
            ${CATS.map(c => `<button type="button" data-cat="${c[0]}" aria-pressed="false">${esc(c[1])}<span class="ev-n">${findings.filter(f => f.cat === c[0]).length}</span></button>`).join('')}
          </div>
          <div class="grid c2" id="ev-cards">${findings.map(findingCard).join('')}</div>
        </section>

        <section class="ev-sec" id="ev-vendors" aria-labelledby="ev-vendors-h">
          <div class="row"><h2 id="ev-vendors-h">Who has shipped what</h2><span class="spacer"></span><span class="small muted" id="ev-vcount" role="status"></span></div>
          <p class="muted" style="max-width:78ch">The vendors the report names, and only what it states about each. A cell says Not stated where the report is silent.</p>
          <div class="seg" id="ev-vseg" role="group" aria-label="Show vendors in">
            <button type="button" data-sector="all" aria-pressed="true">All<span class="ev-n">${vendors.length}</span></button>
            ${SECTORS.map(s => `<button type="button" data-sector="${s[0]}" aria-pressed="false">${esc(s[1])}<span class="ev-n">${vendors.filter(v => v.sectors.indexOf(s[0]) >= 0).length}</span></button>`).join('')}
          </div>
          <div class="tblwrap">
            <table class="tbl ev-vt">
              <thead><tr><th scope="col">Product</th><th scope="col">What it does</th><th scope="col">Acts or only answers</th><th scope="col">How changes are approved</th><th scope="col">Status</th><th scope="col">UK</th></tr></thead>
              <tbody id="ev-vbody">${vendors.map(vendorRow).join('')}</tbody>
            </table>
          </div>
          <div class="note">No operator-facing assistant was found for Zonal, Tevalis, Vita Mojo, Storekit or Loyverse, on one search each, which the report calls weak evidence. Money is going to operations layers above the till: Nory raised US$37m in September 2025 and MarginEdge US$80m in August 2026 (${link('techeu')}, ${link('rtn')}).</div>
        </section>

        <section class="ev-sec" id="ev-cost" aria-labelledby="ev-cost-h">
          <div class="row"><h2 id="ev-cost-h">What the model costs a site</h2><span class="spacer"></span><span class="tag low">Estimate, not measured</span></div>
          <p class="muted" style="max-width:78ch">Move the controls to see what a month of Pepper requests would cost one site, and how much of the subscription that takes.</p>
          <div class="card">
            <div class="ev-cost">
              <div>
                <div class="ev-ctl">
                  <label class="ev-lab" for="ev-req"><span>Requests per site per month</span><output id="ev-reqval" for="ev-req">600</output></label>
                  <input class="ev-range" type="range" id="ev-req" min="100" max="5000" step="100" value="600">
                  <div class="ev-ends" aria-hidden="true"><span>100</span><span>5,000</span></div>
                  <div class="row" id="ev-quick">
                    <button type="button" class="btn" data-req="600" aria-pressed="true">600, a typical site</button>
                    <button type="button" class="btn" data-req="3000" aria-pressed="false">3,000, an AI-first site</button>
                  </div>
                </div>
                <div class="ev-ctl">
                  <span class="ev-lab" id="ev-mlab"><span>Model</span><span class="small muted num" id="ev-mrate" style="font-weight:400"></span></span>
                  <div class="seg" id="ev-mseg" role="group" aria-labelledby="ev-mlab">
                    ${TIERS.map(t => `<button type="button" data-tier="${t.id}" aria-pressed="${t.id === 'mid'}">${esc(t.name)} · ${esc(t.model)}</button>`).join('')}
                  </div>
                </div>
                <div class="ev-ctl">
                  <label class="ev-lab" for="ev-sub"><span>Subscription price per site per month</span><output id="ev-subval" for="ev-sub">£150</output></label>
                  <input class="ev-range" type="range" id="ev-sub" min="150" max="300" step="5" value="150">
                  <div class="ev-ends" aria-hidden="true"><span>£150</span><span>£300</span></div>
                </div>
              </div>
              <div>
                <div class="ev-tiles">
                  <div class="ev-tile"><span class="ev-k">Model cost a month</span><span class="ev-big" id="ev-out-cost"></span><span class="small muted" id="ev-out-gbp"></span></div>
                  <div class="ev-tile"><span class="ev-k" id="ev-share-k"></span><span class="ev-big" id="ev-out-share"></span><span class="small muted" id="ev-out-range"></span></div>
                </div>
                <div class="ev-meterwrap">
                  <div class="ev-meter" id="ev-meter" role="img"><span class="ev-track"></span><span class="ev-fill"></span><span class="ev-more" hidden></span></div>
                  <div class="ev-scale"><span id="ev-scale"></span></div>
                  <p class="small ev-over" id="ev-over" hidden>${icon('alert')} <span>The model would cost more than the whole subscription.</span></p>
                </div>
                <div class="note">This is the researchers' estimate from published token prices (${link('anthropicPricing')}) and assumed token counts: a three-call tool loop per request over a cached 20,000-token prefix. It is an estimate and no usage has been measured.</div>
              </div>
            </div>
          </div>
          <div class="grid c2">
            <div class="tblwrap">
              <table class="tbl ev-ct">
                <thead><tr><th scope="col">Model tier (Nov 2026 prices)</th><th scope="col">Cost per request</th><th scope="col">Typical site, 600 a month</th><th scope="col">AI-first site, 3,000 a month</th></tr></thead>
                <tbody>${TIERS.map(t => `<tr><td>${esc(t.name)} (${esc(t.model)})</td><td class="num">about US$${t.milli / 1000}</td><td class="num">${usd(t.milli * 600)}</td><td class="num">${usd(t.milli * 3000)}</td></tr>`).join('')}</tbody>
              </table>
            </div>
            <div class="card">
              <h3>How the share is worked out</h3>
              <p>The report prices the model in US dollars and the subscription in pounds, and gives no exchange rate. The share here uses the report's own percentages: US$135 is 35% of £300 and 70% of £150, which puts a dollar at about 78p.</p>
              <p class="muted">Macaroonie starts chats on the small model and moves to the main model for files and heavy tools. Its default allowance of 2,000,000 units a month for a group is about US$8 of model spend.</p>
              <p class="muted">The report's conclusion: an AI-first product at UK prices works only if page jumps cost no model call, routine work runs on the small model, and each venue has a fair-use ceiling.</p>
            </div>
          </div>
        </section>

        <section class="ev-sec" id="ev-rules" aria-labelledby="ev-rules-h">
          <h2 id="ev-rules-h">Rules and dates</h2>
          <div class="card">
            <ol class="ev-time">
              ${rules.map(r => `<li>
                <div class="ev-when">${esc(r.when)}</div>
                <div class="ev-what">
                  <div class="row"><h3>${esc(r.title)}</h3>${r.tags.map(t => '<span class="tag ' + t[0] + '">' + esc(t[1]) + '</span>').join('')}</div>
                  <p>${esc(r.means)}</p>
                  <p class="ev-meta">${links(r.src)}</p>
                </div>
              </li>`).join('')}
            </ol>
          </div>
          <div class="note">A summary of secondary sources. The dates come from law-firm summaries and the primary texts were not read. None of this is legal advice.</div>
        </section>

        <section class="ev-sec" id="ev-trust" aria-labelledby="ev-trust-h">
          <h2 id="ev-trust-h">How far to trust each conclusion</h2>
          <p class="muted" style="max-width:78ch">The report's own table. The direction rests on agreement between what the leading products ship, what controlled studies measure, what the firms that reversed went back to, and what regulators require.</p>
          <div class="tblwrap">
            <table class="tbl ev-tt">
              <thead><tr><th scope="col">Conclusion</th><th scope="col">Confidence</th><th scope="col">Basis and limit</th></tr></thead>
              <tbody>${trust.map(t => `<tr><td>${esc(t[0])}</td><td><span class="row" style="flex-wrap:nowrap;gap:6px">${confTag(t[1])}</span></td><td>${esc(t[2])}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </section>

        <section class="ev-sec" id="ev-gaps" aria-labelledby="ev-gaps-h">
          <h2 id="ev-gaps-h">What was not researched</h2>
          <div class="ev-gapgrid">
            <div class="card">
              <h3>Planned searches that never ran</h3>
              <p class="muted">Each researcher's shared search budget ran out after 24 to about 43 searches. These ${notRun.length} topics were planned and not searched.</p>
              <ul class="list ev-two">${notRun.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
            </div>
            <div class="card">
              <h3>Missing from the evidence that was found</h3>
              <ul class="list">${missing.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
              <p class="muted">Nothing has been tested with Macaroonie's users, because the product is pre-production. Every internal count is static, from the files, on one date.</p>
            </div>
          </div>
        </section>
      </div>`

    // ── Jump to a section ──────────────────────────────────────
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.querySelector('#ev-jump').addEventListener('click', e => {
      const b = e.target.closest('button[data-jump]')
      const to = b && root.querySelector('#' + b.dataset.jump)
      if (to) to.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
    })

    // ── Findings filter ────────────────────────────────────────
    const cards = Array.from(root.querySelectorAll('#ev-cards .ev-finding'))
    const fcount = root.querySelector('#ev-fcount')
    const showCat = cat => {
      let n = 0
      cards.forEach(c => { const on = cat === 'all' || c.dataset.cat === cat; c.hidden = !on; if (on) n++ })
      root.querySelectorAll('#ev-fseg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)))
      fcount.textContent = 'Showing ' + n + ' of ' + cards.length + ' findings'
    }
    root.querySelector('#ev-fseg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showCat(b.dataset.cat) })
    showCat('all')

    // ── Vendor filter ──────────────────────────────────────────
    const rows = Array.from(root.querySelectorAll('#ev-vbody tr'))
    const vcount = root.querySelector('#ev-vcount')
    const showSector = sec => {
      let n = 0
      rows.forEach(r => { const on = sec === 'all' || r.dataset.sectors.split(' ').indexOf(sec) >= 0; r.hidden = !on; if (on) n++ })
      root.querySelectorAll('#ev-vseg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sector === sec)))
      vcount.textContent = 'Showing ' + n + ' of ' + rows.length + ' products'
    }
    root.querySelector('#ev-vseg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showSector(b.dataset.sector) })
    showSector('all')

    // ── The cost estimate ──────────────────────────────────────
    const $ = id => root.querySelector('#' + id)
    const req = $('ev-req'), sub = $('ev-sub')
    let tier = 'mid'
    const draw = () => {
      const n = Number(req.value), price = Number(sub.value)
      const t = TIERS.filter(x => x.id === tier)[0]
      const milli = n * t.milli
      const pounds = milli / 1000 * GBP_PER_USD
      const share = pounds / price * 100
      $('ev-reqval').textContent = count(n)
      $('ev-subval').textContent = gbp(price)
      $('ev-mrate').textContent = 'about US$' + (t.milli / 1000) + ' a request'
      $('ev-out-cost').textContent = usd(milli)
      $('ev-out-gbp').textContent = 'About ' + gbp(pounds) + ' at the rate the report\'s percentages imply'
      $('ev-share-k').textContent = 'Share of a ' + gbp(price) + ' subscription'
      $('ev-out-share').textContent = pct(share)
      $('ev-out-range').textContent = 'Across the report\'s price range: ' + pct(pounds / 150 * 100) + ' at £150 and ' + pct(pounds / 300 * 100) + ' at £300'
      // The meter is drawn to scale. Its track is the whole subscription;
      // when the cost is more than that, the scale grows to fit the cost.
      const over = share > 100
      const max = Math.max(100, share)
      const subAt = 100 / max * 100
      const meter = $('ev-meter')
      meter.classList.toggle('over', over)
      meter.querySelector('.ev-track').style.width = subAt + '%'
      meter.querySelector('.ev-fill').style.width = (over ? subAt : share) + '%'
      const more = meter.querySelector('.ev-more')
      more.hidden = !over
      more.style.left = 'calc(' + subAt + '% + 2px)'
      more.style.right = '0'
      meter.setAttribute('aria-label', 'The model cost is ' + pct(share) + ' of the ' + gbp(price) + ' subscription')
      $('ev-scale').style.width = subAt + '%'
      $('ev-scale').textContent = gbp(price) + ', the whole subscription'
      $('ev-over').hidden = !over
      root.querySelectorAll('#ev-quick button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.req) === n)))
      root.querySelectorAll('#ev-mseg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tier === tier)))
    }
    req.addEventListener('input', draw)
    sub.addEventListener('input', draw)
    $('ev-quick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { req.value = b.dataset.req; draw() } })
    $('ev-mseg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { tier = b.dataset.tier; draw() } })
    draw()
  },
})
