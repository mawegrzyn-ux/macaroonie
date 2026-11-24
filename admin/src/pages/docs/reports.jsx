// src/pages/docs/reports.jsx
// The Docs page's "Reports (report builder)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable, InfoBox } from './parts.jsx'

export const id = 'reports'
export const label = 'Reports (report builder)'
export const order = 370

export function Section() {
  return (
    <section id="reports" data-doc="">
      <H2>Reports (report builder)</H2>
      <P>
        Migrations 243, 244 and 247. The plan is <Mono>docs/REPORTS.md</Mono>; this section is what is built so far: its
        groundwork, the engine with a viewer, the builder, drill-downs, charts and the print page (till sales, online orders and bookings,
        since phase 3a the kitchen screens, self-order kiosk visits, loyalty, purchasing, and food safety, checklists and the
        H&amp;S action log, and since phase 3b Cash Recon days and weeks, staff and the rota with their pay and tips, each
        venue&apos;s H&amp;S day and supplier orders sent after their deadline). One engine
        serves every way of making a report: a report is a JSON definition, checked by one shared function,
        looked up in a data catalogue kept in code, turned into SQL by the server and run as the person
        looking at it, inside their tenant, read only. Nobody writes SQL and no report holds any.
      </P>

      <H3>The definition</H3>
      <P>
        <Mono>shared/reports/spec.js</Mono>. <Mono>normaliseReport(raw)</Mono> returns the one known shape
        from anything (never throws) and <Mono>reportProblems(spec)</Mono> lists what is wrong with it as
        sentences; a definition is stored (<Mono>reports.spec</Mono>) and run only after both. Version 1:
      </P>
      <Code>{`{ version: 1, kind: 'list' | 'summary' | 'matrix', subject: 'till.lines',
  also:    [{ key: 's2', subject: 'rota.weeks', label: 'Rota', filters: [...] }],  // summaries only: 3 at most
  params:  [{ key, type: 'period' | 'venues' | 'value', label, default }],
  rows:    ['section.name', { field: 'date', bucket: 'week' }],   // groupings (a list's columns)
  columns: [{ field: 'sent_at', bucket: 'hour' }],                 // a matrix's column groupings (2 at most)
  values:  [{ measure: 'net_sales' }, { agg: 'count' }, { agg: 'sum', field: 'qty' },
            { calc: 'net_sales / total(net_sales)', label: 'Share', format: 'percent' },
            { measure: 'hours_total', from: 's2' }],                  // a figure of another subject
  filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' },
            { any: [...] }, { all: [...] }, { has: 'payments', where: [...], not: false },
            { counted: ['net_sales'] }],                           // the rows these figures count (drill-downs)
  sort:    [{ by: 'net_sales', dir: 'desc' }],
  limit:   { top: 25, rest_as: 'Every other dish' },
  totals:  { grand: true, subtotals: ['section.name'] },
  compare: { with: 'previous_period' | 'last_year' },             // summaries only
  drill:   { down: [{ field: 'name' }, { field: 'sent_at', bucket: 'hour' }], rows: ['check.number', 'name', 'net'] },
  view:    { kind: 'table' | 'bar' | 'line' | 'area' | 'combo' | 'parts' | 'figures' | 'heat',
             x: 'date:week', y: ['net_sales'], line: 'average_spend', stacked, sideways, table_below } }`}</Code>
      <P>
        The kind is worked out from the parts when it isn&apos;t given (columns: matrix; else values: summary;
        else list), and a part that makes no sense with the rest is dropped (a list&apos;s values, a
        summary&apos;s columns). A path walks the catalogue&apos;s links (<Mono>check.server.name</Mono>,
        four links at most). <Mono>LIMITS</Mono> caps every list (8 row groupings, 30 list columns, 20 values,
        30 filters three deep, 12 parameters, top 500). Beside it: <Mono>period.js</Mono> (named periods and
        what they mean on a day: <Mono>resolvePeriod()</Mono>, Monday weeks, <Mono>comparePeriod()</Mono>,{' '}
        <Mono>periodText()</Mono>, <Mono>todayIn(tz)</Mono>), <Mono>expr.js</Mono> (a calculation&apos;s small
        language: <Mono>parseExpr()</Mono>, <Mono>exprProblem()</Mono>, <Mono>evalExpr()</Mono>,{' '}
        <Mono>exprToSql()</Mono>; arithmetic, comparisons, <Mono>round</Mono>, <Mono>abs</Mono>, <Mono>min</Mono>,{' '}
        <Mono>max</Mono>, <Mono>if</Mono>, and over a summary&apos;s rows <Mono>total</Mono>, <Mono>running</Mono>,{' '}
        <Mono>rank</Mono>, <Mono>change</Mono>, <Mono>previous</Mono>; never SQL), <Mono>paths.js</Mono> (<Mono>resolvePath()</Mono>,{' '}
        <Mono>pathLabel()</Mono>: a column&apos;s heading, <Mono>bucketsFor()</Mono>),{' '}
        <Mono>format.js</Mono> (<Mono>formatValue()</Mono> for the page, <Mono>plainValue()</Mono> /{' '}
        <Mono>plainHeading()</Mono> / <Mono>csvCell()</Mono> for files) and <Mono>drill.js</Mono>{' '}
        (<Mono>cleanDrill()</Mono>, <Mono>drillSpec()</Mono>: the definition a drill step runs, made by the
        server from the report&apos;s own). The admin imports them as <Mono>@shared/reports/...</Mono>.
      </P>
      <P>
        A summary&apos;s <Mono>also</Mono> names up to three other subjects (<Mono>LIMITS.also</Mono>), each{' '}
        <Mono>{'{ key, subject, label?, filters }'}</Mono> (a key given is kept when it is unique, the rest are
        numbered s2, s3, s4); a value with <Mono>from</Mono> is one of that subject&apos;s figures, and a
        calculation (never <Mono>from</Mono>) may read values of every subject.{' '}
        <Mono>normaliseReport()</Mono> keeps <Mono>also</Mono> on a summary only and drops a value naming a key it
        doesn&apos;t have; <Mono>reportProblems()</Mono> refuses another subject with no figure, or with a filter
        of its own on its day (its days are the report&apos;s period); <Mono>valueSubject(spec, value)</Mono>{' '}
        gives the subject a value&apos;s figure comes from. Below, Figures from other subjects.
      </P>

      <H3>The data catalogue</H3>
      <P>
        <Mono>api/src/reports/catalogue/</Mono>: the only place table and column names come from. A subject
        (<Mono>subject()</Mono> in <Mono>define.js</Mono>) names its table or sub-select, the rows that count,
        the module that may report on it, its built-in <Mono>venue</Mono> link and <Mono>date</Mono> field,
        fields (<Mono>text</Mono>, <Mono>number</Mono>, <Mono>money</Mono>, <Mono>percent</Mono>,{' '}
        <Mono>yesno</Mono>, <Mono>choice</Mono>, <Mono>moment</Mono>, <Mono>duration</Mono>; options{' '}
        <Mono>pii</Mono>, <Mono>needs</Mono>, <Mono>adds</Mono>), measures (<Mono>sum</Mono>,{' '}
        <Mono>avg</Mono>, <Mono>count</Mono>, <Mono>countDistinct</Mono>, <Mono>ratio</Mono>, each with an
        optional <Mono>where</Mono>) and links (<Mono>one</Mono>, <Mono>many</Mono>). SQL is written as
        templates: <Mono>{'{t}'}</Mono> the subject&apos;s row, <Mono>{'{linkname}'}</Mono> a joined row,{' '}
        <Mono>{'{tz}'}</Mono> the row&apos;s venue&apos;s time zone. Values leave in everyday units (money in
        pounds, a percentage as a fraction, a duration in seconds, a day as YYYY-MM-DD, a moment as the
        venue&apos;s wall time). <Mono>index.js</Mono> puts the subjects together and checks them when the API
        starts (a link to nothing, a template naming a link the subject lacks: the start fails, never a
        report): <Mono>CATALOGUE</Mono>, <Mono>AREAS</Mono>, <Mono>catalogueView(levels)</Mono> (what the
        browser gets: labels, types and links, no SQL, only what the role may see; a subject says{' '}
        <Mono>base</Mono> when the role may start a report from it, the others being there to look things
        up, a server&apos;s name on a check; a measure says <Mono>across</Mono> when it can also be a figure
        of a report about something that has several of these rows),{' '}
        <Mono>canReportOn()</Mono>, <Mono>canSee()</Mono>, <Mono>listColumns()</Mono>,{' '}
        <Mono>worksAcross()</Mono> / <Mono>ACROSS_AGGS</Mono> (a total, a count, a smallest or a largest, or
        a ratio of two of those: the one list both <Mono>across</Mono> and the engine&apos;s refusal come
        from).
      </P>
      <DataTable
        head={['Area (module)', 'Subjects']}
        rows={[
          ['Till sales (pos_reports; roles and floor areas pos_setup)', 'sales.checks, sales.dishes, sales.tenders (every till: our projections UNION ALL another till\'s stored sales, with source; catalogue/sales.js, see Integrations, Readers), till.days (trading days), till.checks, till.lines (dishes sold), till.voids, till.cancelled, till.payments, till.discounts, till.charges, till.vat, till.activity (every till or kiosk change, from pos_events: when made, when it reached the cloud, Sent later = over two minutes; its words from EVENT_LABELS in till.js, which the catalogue test holds to every event type in shared/pos/checks.js), and to group by: till.takers (staff and kiosks), till.streams, till.order_types, till.courses, till.roles, till.floor_areas'],
          ['Store tech (pos_setup; changes refused and card machine payments pos_reports; menu screens screens)', 'till.devices (removed ones kept, so sales keep a name), till.card_readers, till.printers, till.print_jobs (printed, failed, waiting, how long each waited), till.refusals (Till reports\' Conflicts: changes the cloud refused, sorted out or not; kitchen taps left out), till.card_payments (every card machine sale and refund, declines included; Approved, not on a bill = money no check shows), screens.screens (what each shows: its wall\'s board or playlist when in a wall, as screenView() works it out; online = talked to us in the last 150 s), screens.boards, screens.playlists, screens.walls'],
          ['Online orders (web_orders; promotions promotions)', 'online.orders, online.items, online.promotions, online.sales (own orders and GloriaFood in one list, each with its tender: the rules of onlineTransactions()), online.order_events (each order\'s history, status by status, by staff, the guest or the system), online.sold_out (the dishes sold out now, as the tills are told: one whose time has ended is never listed), online.promotion_list (the Promotions page\'s list)'],
          ['Bookings (bookings; emails email_templates)', 'bookings.bookings, bookings.deposits, bookings.tables, bookings.sections, bookings.combinations, bookings.emails (the Sent emails list: bookings, online orders and test emails, sent or failed)'],
          ['Kitchen screens (pos_reports)', 'kitchen.stations, kitchen.tickets (every bump in kds_log), kitchen.remakes, kitchen.orders (the kitchen\'s copy of each order)'],
          ['Self-order kiosks (pos_reports; designs pos_setup)', 'kiosks.visits (every guest visit, kiosk_sessions), kiosks.designs, till.receipts (receipts by QR code or email: opened, emailed, waiting for payment; addresses never read)'],
          ['Loyalty (loyalty_members; rewards and stamp cards loyalty)', 'loyalty.members, loyalty.ledger (every points or stamps change), loyalty.redemptions, loyalty.member_rewards, loyalty.rewards, loyalty.stamp_cards'],
          ['Purchasing (purchasing; the catalogue purchasing_setup)', 'purchasing.orders (purchase orders, with when each first went, its order deadline and whether it went after it), purchasing.order_lines, purchasing.invoices, purchasing.restaurant_orders, and purchasing.suppliers, purchasing.items, purchasing.categories, purchasing.prices, purchasing.price_changes. Money (prices, goods, spend, VAT, the average order, lines invoiced above their price) needs purchasing_setup on every subject'],
          ['Food safety and H&S (food_safety, checklists, hs_action_log)', 'safety.days (each venue\'s H&S day as the Overview judges it, worked out for each run), safety.fridges, safety.fridge_checks, safety.hold_stations, safety.hold_checks, safety.cooking_sessions, safety.cooking_items, safety.cooking_checks, safety.delivery_checks; safety.checklist_templates, safety.checklist_tasks, safety.checklists, safety.checklist_ticks; safety.action_categories, safety.actions'],
          ['Cash reconciliation (cash_recon)', 'cash.days and cash.weeks (worked out for each run by Cash Recon\'s own rule), cash.income, cash.takings, cash.service_charges, cash.expenses, cash.wages, cash.reports, cash.wage_lists, and to group by: cash.income_sources, cash.payment_channels, cash.sc_sources, cash.expense_categories'],
          ['Staff and rota (rota; pay rota_pay, points and tips rota_tips, the wage list beside the rota cash_recon, people, roles, time off and tip pots staff)', 'rota.staff_weeks, rota.weeks, rota.days, rota.pot_weeks, rota.tip_shares (worked out for each run by the Rota page\'s own rules), rota.entries, rota.pay_adjustments, rota.tip_moves, rota.shifts, and staff.people, staff.roles, staff.time_off, rota.tip_pots'],
          ['Local info (local_info)', 'local.weather (the weather at each venue, one row a day from the Local info weather capture: recorded once the day is over, else the latest forecast, with what was forecast beside it), local.weather_hours (22 Nov 2026: one row an hour of the same day row, unnesting data.hours: hour 00-23 as a choice, recorded or forecast with its chance of rain, the forecast kept beside a recorded hour; the starter Weather by the hour), local.items (every other Local info item, captured or typed; hidden ones left out, a group-wide one only with every venue; how many staff flagged each relevant or not; since migration 249 entries only, with how many other reports of the same event are in each and whether one was kept apart), local.captures (how often each runs, when it last ran, its problem, since migration 248 whether it learns from staff flags and what it learned, and since 249 a problem putting the same events together)'],
          ['Menus (menus)', 'menu.releases (each publish and its state: Live, Earlier, Scheduled, Cancelled, by liveRows()\'s rule), menu.option_groups, menu.options, menu.tags, menu.dish_tags (the allergen matrix\'s levels), menu.dish_option_groups, menu.dish_option_prices, menu.dish_own_options, menu.tax_rates (the usual rate). Everything but releases is the draft the Menus pages edit'],
          ['Website and reviews (website)', 'website.reviews (as the Reviews page holds them, checked or in the To check inbox), website.pages (the draft, each with its address worked out as pagePath() does), website.media, website.media_categories'],
          ['Pepper (ai_assistant; use by person, changes and chats Manage on it)', 'pepper.usage (ai_usage, a row a UTC month and channel: requests, units, tokens, web searches; the Settings tab\'s figures), pepper.people (ai_usage_people, each person\'s UTC day: the units their daily share counts; Person links to group.team with team), pepper.actions (ai_actions: what each change was in ACTION_LABELS\' words, where, who asked, whether it went through, cleared; input and result never read), pepper.chats (ai_conversations: where, who started it, model, closed and why, its changes; title, system_prompt and guest_key never read)'],
          ['Your group (team, venues, issue_log, feature_requests; roles none)', 'group.team (users: name, email, built-in role, Has a custom role as the Team page counts one, active, last signed in, days since; its role by effectiveRoleId()\'s rule in SQL, who invited them), group.roles (tenant_roles, the Access page\'s list; the stored permissions never read), group.openings (store_openings: where it got to, who started it, when the location was made, rounds, follow-ups left; what was typed and Pepper\'s plan never read), group.issues (issue_log), group.requests (feature_requests: the group\'s own, with every group\'s votes)'],
          ['Shared', 'venue (no module), menu.menus / menu.sections / menu.dishes (menus; a dish\'s Has a price counts options that price it, Allergens tagged counts every level; Type resolves dish, section, menu, food like itemType() (migration 267); a menu\'s Sells; product code and barcode are skipped, to keep Dishes sold inside the smart builder\'s budget), guests.customers (customers)'],
        ]}
      />
      <P>
        132 subjects (phase 3d added 43: the till, online and bookings extras, menus, reviews and the
        website, menu screens, Store tech&apos;s devices and printers, local info, Pepper&apos;s use,
        changes and chats, and the group&apos;s team, roles, new locations, issues and feature requests),
        in the areas of <Mono>AREAS</Mono>: Store tech (<Mono>tech</Mono>), Website and reviews (
        <Mono>website</Mono>) and Pepper (<Mono>pepper</Mono>) are new. A subject can ask for more than View
        on its module (<Mono>{"level: 'use' | 'manage'"}</Mono>, checked at start: a level needs a module):
        Pepper&apos;s use by person, changes and chats ask for Manage on Pepper, as the Settings tab&apos;s
        people and the Activity tab do. <Mono>canReportOn()</Mono> compares with{' '}
        <Mono>permissionAtLeast()</Mono>, compiling a report on such a subject without it is a 403 (Your
        role can&apos;t report on ...), and <Mono>runsFor()</Mono> says what a starter needs as Manage on
        Pepper (AI assistant). A subject whose rows each sit on their week&apos;s Monday says so on its day,{' '}
        <Mono>{"date: { sql, label, grain: 'week' }"}</Mono> (the rota and Cash Recon weeks), and{' '}
        <Mono>catalogueView()</Mono> passes <Mono>grain</Mono> on: such a subject lines up with another
        subject&apos;s days only by week or longer. A field, figure or link can name a module of its own (<Mono>needs</Mono>): a role without
        it doesn&apos;t see it, and <Mono>CATALOGUE_MODULES</Mono> (every module a subject, field, figure or
        link asks for) is what the routes read a person&apos;s levels for. The start-up check refuses a{' '}
        <Mono>needs</Mono> that isn&apos;t a module, on figures too.
      </P>
      <P>
        Each area&apos;s subjects are a file of their own in <Mono>api/src/reports/catalogue/</Mono>{' '}
        exporting <Mono>order</Mono> (where its subjects come), <Mono>subjects</Mono> and{' '}
        <Mono>decisions</Mono>; the starters likewise in <Mono>api/src/reports/starters/</Mono>{' '}
        (<Mono>order</Mono>, <Mono>starters</Mono>). Nothing lists the files:{' '}
        <Mono>gather(import.meta.url, name)</Mono> (<Mono>catalogue/gather.js</Mono>) reads every file
        of the asking file&apos;s folder that exports <Mono>name</Mono>, by order, then file name, for{' '}
        <Mono>catalogue/index.js</Mono>, <Mono>decisions.js</Mono> and <Mono>starters/index.js</Mono>{' '}
        (22 Nov 2026). <Mono>runs.js</Mono> exports <Mono>subjects</Mono> as a function given the
        others&apos; subjects and <Mono>AREAS</Mono>, so it comes last. The files are listed by name
        in <Mono>catalogue/files.js</Mono> and <Mono>starters/files.js</Mono> (a folder read at load time
        deadlocked against Pepper&apos;s tool list), and a catalogue or starter file never imports one of
        the three, which would see it half-built.
      </P>
      <P>
        Every table in the database has a decision: read by a subject, planned for
        a later phase (things that happen, or things to group by), settings, or left out with a reason.
        The table&apos;s area file says it in its <Mono>decisions</Mono> export,{' '}
        <Mono>{"{ settings: [...], out: { reason: [tables] }, planned? }"}</Mono>, and{' '}
        <Mono>decisions.js</Mono> gathers them into <Mono>SETTINGS</Mono>, <Mono>LEFT_OUT</Mono> and{' '}
        <Mono>PLANNED</Mono> (a reason two files give is one reason).{' '}
        <Mono>coverage.js</Mono> works out what the catalogue reads; <Mono>api/test/reports-catalogue.test.mjs</Mono>{' '}
        compares both with <Mono>information_schema</Mono> and fails on a table with no decision and on an id
        column of a catalogue table that no field, link or <Mono>skip</Mono> entry accounts for.{' '}
        <Mono>node api/scripts/report-catalogue.js</Mono> prints where things stand, and with a table name or{' '}
        <Mono>--area</Mono> drafts subjects from the columns, checks and foreign keys; it also prints the
        counts below, which the test no longer pins (22 Nov 2026). After phase 3d the
        decisions were <Mono>{'{ subject: 127, planned: 1, settings: 57, out: 49 }'}</Mono> over 234 tables
        (migration 248&apos;s <Mono>local_info_feedback</Mono>, staff flags on local info, is left out: its
        counts are on each item), the one table planned being <Mono>report_runs</Mono>; phase 4a made it the
        Report runs subject and left migration 250&apos;s <Mono>report_files</Mono> out (a run&apos;s kept
        file is a field of its run), so they are <Mono>{'{ subject: 128, planned: 0, settings: 57, out: 50 }'}</Mono>{' '}
        over 235 tables, with nothing left planned. Till buttons tapped (migration 266, <Mono>pos_till_taps</Mono>)
        made it <Mono>{'{ subject: 129, planned: 0, settings: 57, out: 57 }'}</Mono> over 243 tables. What was said to Pepper (<Mono>ai_actions</Mono> input and result,{' '}
        <Mono>ai_conversations</Mono> title, system_prompt and guest_key) and a new location&apos;s words
        and Pepper&apos;s plan (<Mono>store_openings</Mono> input, steps, ai, overrides, plan, results) stay
        in their subjects&apos; <Mono>skip</Mono> lists: a test in <Mono>reports-catalogue.test.mjs</Mono>{' '}
        fails if a template reads one, or if any subject&apos;s SQL names those tables. Columns holding a key, a code, a password or a guest&apos;s
        address (sealed or not) stay in their subject&apos;s <Mono>skip</Mono> list, so no report can read
        them (a screen&apos;s link to its device is its key, so whether one is linked now can&apos;t be
        reported; when a code last linked one can). <Mono>api/test/reports-extras.test.mjs</Mono> holds the
        phase 3d subjects against their pages&apos; own routes: a check&apos;s history, Till reports&apos;
        Conflicts, Store tech&apos;s card machine payments and printer tickets, an online order&apos;s
        history, what the tills are told is sold out, the Promotions page&apos;s uses, the Sent emails list,
        and Store tech&apos;s own lists. <Mono>api/test/reports-content.test.mjs</Mono> does the same for the
        menus, screens, website and local info subjects: each menu&apos;s Publishing window, Variant groups,
        Allergens & dietary and the allergen matrix, a dish&apos;s options in the menu editor, Tax rates, the
        Menu screens pages, the Reviews page and its figures, Pages & modals, the Media page, the Local info
        calendar and each venue&apos;s Captures window (rows only a device, a review site, an upload or a
        capture&apos;s run makes are written by SQL there). <Mono>api/test/reports-group.test.mjs</Mono> (9)
        holds Pepper&apos;s and the group&apos;s subjects to theirs: the Settings tab&apos;s month figures
        and people, the Activity tab, each chat, the New location page&apos;s openings, the Issue log and
        Feature requests lists, the Team page (people, Has a custom role counted only when the role
        isn&apos;t built in) and the Access page&apos;s roles; the levels each needs (View on Pepper can
        report on its use by month and nothing more), the words of each kind of change, and the other
        group&apos;s rows never shown.
      </P>
      <P>
        A yes / no worked out by comparing a column that can be empty says No for empty, through{' '}
        <Mono>COALESCE(..., false)</Mono>: a menu screen that has never connected isn&apos;t online, an open
        H&S action with no due day isn&apos;t overdue. Left as plain SQL such a cell is empty, shows blank
        instead of No, and a filter on No misses the row. A test in <Mono>reports-build.test.mjs</Mono> reads
        every subject&apos;s own yes / no fields on every row and fails on an empty one, except the fields in{' '}
        <Mono>MAY_BE_EMPTY</Mono>, where empty means not known (a card machine&apos;s Online when its provider
        didn&apos;t say, an order&apos;s Sent late until it is judged). It reads only subjects with rows in
        its data and lists the others, so a new subject with a worked-out yes / no needs a row there.
      </P>

      <H3>Figures with rules in code</H3>
      <P>
        A report never works out again what code already decides. The till: migration 243 stores three more
        breakdowns per check, <Mono>pos_check_discounts</Mono>, <Mono>pos_check_charges</Mono> and{' '}
        <Mono>pos_check_vat</Mono>, written by <Mono>saveCheckBreakdowns()</Mono> (<Mono>services/posSvc.js</Mono>,
        on every check save) from <Mono>checkBreakdowns()</Mono> in <Mono>shared/pos/reports.js</Mono>, which
        reads <Mono>checkTotals()</Mono> the way <Mono>dayFigures()</Mono> does; plus columns for a cancelled
        order (<Mono>cancelled_at</Mono>, <Mono>cancel_reason</Mono>, <Mono>cancel_value</Mono>,{' '}
        <Mono>cancelled_by</Mono>, <Mono>cancel_approved_by</Mono>, <Mono>cancel_day_id</Mono>), a void
        (<Mono>voided_at</Mono>, <Mono>void_approved_by</Mono>, <Mono>void_waste</Mono>) and a refund&apos;s
        approver. <Mono>pos_checks.proj_v</Mono> says which checks have them;{' '}
        <Mono>backfillCheckProjections()</Mono> fills in older checks when the API starts (a venue at a time
        under its sequencer lock, 200 a transaction, one process at a time). Online: what counts as a sale,
        a GloriaFood order&apos;s trading day and each order&apos;s tender are written as SQL from{' '}
        <Mono>services/onlineSalesSvc.js</Mono>&apos;s own lists (<Mono>OWN_COUNTED</Mono>,{' '}
        <Mono>ownTenderKey()</Mono>, <Mono>TENDERS</Mono>). Bookings: the Bookings page&apos;s rule (cancelled
        and no-shows aren&apos;t bookings or guests). Three reconciliation tests hold the reports against the
        pages&apos; own routes for the same days: <Mono>reports-till.test.mjs</Mono> (the Z report&apos;s
        figures), <Mono>reports-online.test.mjs</Mono> (<Mono>/api/orders/transactions</Mono> and{' '}
        <Mono>/api/orders/report</Mono>) and <Mono>reports-bookings.test.mjs</Mono> (<Mono>/api/bookings</Mono>).
      </P>
      <P>
        Phase 3a&apos;s areas copy their pages&apos; own rules (<Mono>api/test/reports-areas.test.mjs</Mono> holds
        each against them). Kitchen: the Kitchen report&apos;s, a ticket is a bump that wasn&apos;t brought back
        (<Mono>recalled_at</Mono>), its time from reaching the station to the bump, on time within the
        station&apos;s <Mono>target_mins</Mono> and late over its <Mono>late_mins</Mono> (8 and 12 unless set).
        Kiosks: Kiosk analytics&apos; (<Mono>aggregateJourneys()</Mono> in <Mono>shared/kioskJourney.js</Mono>):
        ordered by the visit&apos;s outcome, sales the totals of visits that ordered, left in baskets the order
        value of the ones that didn&apos;t, bounced when a visit ended without opening a dish. Loyalty: a
        member&apos;s points are what their ledger adds up to, as the member page shows them (an erased
        member&apos;s points are zeroed without a ledger row). Purchasing: a purchase order is on its delivery
        day; cancelled orders count for nothing in spend. Food safety: a reading is unresolved when it is out of
        range with no corrective action written (any words, as <Mono>computeHsStatus()</Mono> reads it); a
        checklist sits on the first day of its period (<Mono>periodStartFor()</Mono>).
      </P>
      <P>
        Phase 3b&apos;s figures follow rules too long to write in SQL, so they are worked out in code for each run
        (next part) by the functions the pages use. Cash Recon: <Mono>shared/cashRecon.js</Mono> is the one rule
        for the day view, the week grid and its widgets, the week route and the reports. A day&apos;s variance is
        takings plus cash expenses plus cash wages paid that day, less income and the service charge adjustment; a
        week&apos;s is its days&apos; plus the week&apos;s cash wages not paid on one of those days. Only the
        venue&apos;s switched-on sources and channels count, as set up now; card expenses never do.{' '}
        <Mono>services/cashReconSvc.js</Mono> (<Mono>loadCashDays()</Mono>, <Mono>loadCashWeeks()</Mono>) reads
        days and weeks for the week route and the reports. Rota: <Mono>services/rotaWeeks.js</Mono> is the one
        loader of a venue&apos;s week (<Mono>computeWeek()</Mono> for the Rota page&apos;s routes,{' '}
        <Mono>loadRotaWeeks()</Mono> for many weeks at once, with the carry from earlier weeks and a memo for
        the run), then <Mono>computeRotaWeek()</Mono>; days come from <Mono>computeRotaDays()</Mono> and carry
        hours only, since pay belongs to the week. A tip move counts as the Rota page counts it (taken out is a
        minus). H&amp;S days: <Mono>computeHsStatus()</Mono> (<Mono>services/hsStatus.js</Mono>, with{' '}
        <Mono>{'{ venueIds }'}</Mono>) for each day of the period up to today at each venue, expecting the checks
        set up now. It counts a reading as done only for a fridge, hold station and check time still set up
        (the Overview tiles, Pepper&apos;s hs_status and the day briefing count the same way). Orders sent late
        (migration 247): <Mono>purchase_orders.first_sent_at</Mono>, <Mono>deadline_at</Mono> and{' '}
        <Mono>sent_late</Mono>, judged once when an order first goes (<Mono>judgeFirstSend()</Mono>, called by
        Mark as sent and <Mono>emailPo()</Mono> in their transactions, by <Mono>sendLateness()</Mono>:{' '}
        <Mono>orderDeadline()</Mono> and <Mono>deadlinePassed()</Mono> with the supplier&apos;s settings for the
        venue at that moment). A resend never moves it; a delivery booked in without an order is never judged;
        orders sent before 247 are judged when the API starts with today&apos;s settings
        (<Mono>backfillSentLate()</Mono>), except an order changed after sending, which doesn&apos;t know when it
        first went. Each is held against its page by a test: <Mono>reports-cash.test.mjs</Mono>,{' '}
        <Mono>reports-rota.test.mjs</Mono>, <Mono>reports-hs-days.test.mjs</Mono> and{' '}
        <Mono>reports-sent-late.test.mjs</Mono>.
      </P>

      <H3>Rows worked out for each run</H3>
      <P>
        A subject whose rows are worked out in code says <Mono>{"from: { work: '<name>', tables: [...] }"}</Mono>{' '}
        (the tables are what the rows come from, for the catalogue test). <Mono>api/src/reports/work/index.js</Mono>{' '}
        holds <Mono>WORKS</Mono>: each work&apos;s columns, <Mono>tenant_id</Mono> first, and{' '}
        <Mono>fill(tx, {'{ tenantId, venueIds, ranges, levels, memo }'})</Mono>. Before a run&apos;s statements,{' '}
        <Mono>fillWorks()</Mono> makes a temporary table for each work they read (<Mono>pg_temp.rpt_&lt;name&gt;</Mono>,
        dropped with the transaction), fills it in chunks for the run&apos;s venues (from the report&apos;s
        venues choice; none = every venue) and its period and the one it is compared with, and ANALYZEs it. It
        runs in <Mono>withReport()</Mono>&apos;s <Mono>before</Mono> step (<Mono>config/db.js</Mono>); the
        transaction is then made <Mono>READ ONLY</Mono>, so nothing from the person&apos;s report can write. The
        compiler reads such a subject from its table and filters <Mono>tenant_id</Mono> as on any other rows.
        No link may lead to a work subject (the rows behind a link aren&apos;t known before the run), and{' '}
        <Mono>workProblems()</Mono> (at start and in the catalogue test) checks that every column a template
        reads is one the work fills. The works: <Mono>cash_days</Mono> and <Mono>cash_weeks</Mono>{' '}
        (<Mono>services/cashReconSvc.js</Mono>); <Mono>rota_staff_weeks</Mono>, <Mono>rota_weeks</Mono>,{' '}
        <Mono>rota_pot_weeks</Mono>, <Mono>rota_tip_shares</Mono> and <Mono>rota_days</Mono>{' '}
        (<Mono>work/rota.js</Mono>; a venue week is worked out when anything is stored for it, and a week with
        nothing on the rota and no tips isn&apos;t a row); <Mono>hs_days</Mono> (<Mono>work/safety.js</Mono>;
        up to <Mono>MAX_DAYS</Mono> 1,100 days a period, a report over every day starting at the first check
        logged).
      </P>

      <H3>The engine</H3>
      <P>
        <Mono>api/src/reports/compile.js</Mono> (pure): <Mono>compileReport(spec, ctx)</Mono> looks every name
        up in the catalogue and returns the statement(s) with numbered parameters. Every value a person gave
        is a parameter, never text in the statement; <Mono>$1</Mono> is the tenant id, on the base rows and on
        every joined row. A list is a SELECT with a totals statement; a summary is one statement with
        GROUPING SETS (rows, each subtotal level and the grand total, so an average or a count of different
        things is right at every level); a matrix adds the column groupings. A figure through a{' '}
        <Mono>one</Mono> link may only be how many different, smallest or largest (a sum would count the
        check once per line); through a <Mono>many</Mono> link it is added up per base row in a LATERAL
        subquery first (a total, a count, a smallest or a largest only: <Mono>ACROSS_AGGS</Mono>). A
        condition takes a statement parameter only on the path that uses it, since Postgres refuses a
        statement with a parameter nothing reads. A list column the role can&apos;t see is left out with a note; grouping, filtering or
        sorting by one is refused (403). A value the role can&apos;t see is left out with a note, and so is a
        calculation that reads one, however many calculations away (a share of hidden spend would give it
        away: &quot;Share of spend is left out: your role can&apos;t see what it is worked out from&quot;); a
        summary sorted by a hidden value keeps its rows in the order of its groupings, and one with no figure
        left is refused (403). <Mono>run.js</Mono>: <Mono>runReport(ctx, spec, params, opts)</Mono>{' '}
        runs the plan through <Mono>withReport()</Mono> (<Mono>config/db.js</Mono>: the report builder&apos;s own
        pool <Mono>reportSql</Mono>, <Mono>REPORT_POOL_SIZE</Mono> 4, a REPEATABLE READ READ ONLY transaction
        as the tenant with a statement timeout) and <Mono>shape.js</Mono> puts the rows in order (subtotals,
        top N with everything else, compared periods, calculations, the matrix&apos;s cells and totals).
      </P>
      <DataTable
        head={['Guard', 'What happens']}
        rows={[
          ['The definition has problems', '422 with each problem as a sentence (problems[])'],
          ['The role may not report on the subject, or groups / filters / sorts by something it can\'t see', '403'],
          ['Two reports already running for the group', 'Waits up to 5 s for one of two advisory-lock slots, then 429'],
          ['The planner\'s cost estimate is over REPORT_MAX_COST (3,000,000; ten times that for a file)', '422 "narrow the period", before anything runs (EXPLAIN)'],
          ['20 s on screen, 120 s for a file', '422 "took too long"'],
          ['More than 5,000 rows in a list on screen', 'The first 5,000, meta.truncated and the full count; a file holds them all'],
          ['The same person, definition and choices within a minute', 'The kept result (per process, 200 results); fresh: true reads again'],
        ]}
      />
      <P>
        A result: <Mono>{'{ kind, subject, spec, columns, rows, totals, meta }'}</Mono>. Columns carry{' '}
        <Mono>key</Mono>, <Mono>label</Mono>, <Mono>type</Mono>, <Mono>role</Mono> (row | value | compare |
        change | total), a choice&apos;s <Mono>labels</Mono>, <Mono>pii</Mono>, <Mono>adds</Mono> on a value
        whose rows add up to its total (a sum or a count, not an average, a rate or a calculation: only
        those are stacked or cut into parts by a chart), and for a matrix{' '}
        <Mono>group</Mono> (the heading above), <Mono>of</Mono> (the value&apos;s key) and <Mono>at</Mono>{' '}
        (the column&apos;s place across). Rows are <Mono>{'{ cells, kind: row | subtotal | rest, level, k }'}</Mono>;{' '}
        <Mono>meta</Mono> has the period and its words, the compared period, currency, time zone, today at the
        venues, <Mono>across</Mono> (a matrix&apos;s column groupings in words), <Mono>row_count</Mono>,{' '}
        <Mono>truncated</Mono> and <Mono>notes</Mono>. A cell is 0 where rows
        exist but none count for the figure, and empty where there are no rows.
      </P>

      <H3>Figures from other subjects</H3>
      <P>
        13-14 Nov 2026, no migration (<Mono>docs/REPORTS.md</Mono> 7.1, phase 3c): sales beside the hours on
        the rota, guests booked beside guests served, sales beside the weather. How a row of the report is
        found in another subject is one rule, <Mono>shared/reports/also.js</Mono>, for the engine, the builder
        and Pepper. <Mono>matchRow(catalogue, mainKey, row, otherKey, name)</Mono> answers for one grouping:
        the report&apos;s day is the other subject&apos;s own day grouped the same way (a weekly subject only by{' '}
        <Mono>WEEKLY_BUCKETS</Mono>: week, month, quarter or year; <Mono>grainOf()</Mono>); a thing both lead
        to (a venue, a dish, a server) is the same field of it through the other subject&apos;s own one-row
        links (<Mono>routesTo()</Mono>, <Mono>ALSO_HOPS</Mono> 2, never through a list of rows, whose rows
        would repeat); anything else lines up only when the other subject is the report&apos;s own subject
        again (lunch beside dinner, each with filters of its own). <Mono>matchRows(catalogue, spec, otherKey,
        name)</Mono> checks every grouping: <Mono>{'{ ok, fields, missing: [{ row, why }] }'}</Mono>, where{' '}
        <Mono>why</Mono> is a sentence (&quot;The rota can&apos;t be lined up by dish: it belongs to dishes sold
        only.&quot;) naming the subject by <Mono>name</Mono>, the report&apos;s own label for it, when given.{' '}
        <Mono>isShared(f)</Mono> says which of the report&apos;s filters apply to it too (those on its day and
        its venue: the period and venues choices), <Mono>translateFilter()</Mono> /{' '}
        <Mono>sharedFilters()</Mono> write them in the other subject&apos;s own paths and{' '}
        <Mono>heldFilters()</Mono> holds it to a drilled row.
      </P>
      <P>
        The engine: <Mono>compileParts()</Mono> in <Mono>compile.js</Mono> compiles each other subject as a
        summary of its own (the report&apos;s groupings in its paths, the shared filters, its own filters, no
        sort, top or compare of its own) in a statement of its own, plus one for the compared period and one
        for a top N&apos;s everything-else row; <Mono>summaryShaper(plan, rows, compareRows, partRows)</Mono>{' '}
        (<Mono>shape.js</Mono>) puts every statement&apos;s figures side by side by the groupings&apos; values
        (every key any statement has; a subject with no rows for a key shows its figures over no rows).
        Nothing is joined row to row, so nothing is counted twice, and totals, subtotals, the compared period
        and a top N work for every subject. A subject the role can&apos;t see, or one that can&apos;t line up with
        the rows, is left out with a note (&quot;Figures from weather are left out: your role can&apos;t see
        them&quot;, or <Mono>why</Mono> + &quot; Its figures are left out.&quot;), with the calculations that read its
        figures; saving refuses it instead (<Mono>checkedSpec(raw, p, {'{ strict: true }'})</Mono> →{' '}
        <Mono>compileReport(..., {'{ strictParts: true }'})</Mono>: 422, or 403 when it is the role), as do the
        starters&apos; start-up check and Pepper&apos;s answers. A weekly subject beside a period that isn&apos;t whole
        weeks gets a note; a daily subject beside a weekly report reads up to six days past the period so its
        last week is whole (<Mono>widen</Mono>, <Mono>rangesOf()</Mono> in <Mono>run.js</Mono>); worked-out
        subjects are filled for the other subjects&apos; statements too.
      </P>
      <P>
        Drill-downs: breaking a row down keeps the other subjects, each held to the row (<Mono>drillSpec(spec,
        step, {'{ catalogue, listColumns, extra }'})</Mono>; <Mono>listColumns</Mono> may be a function of a
        subject&apos;s key; one that can&apos;t line up with the new grouping goes, with its figures and the
        calculations reading them). The rows behind another subject&apos;s figure are that subject&apos;s rows
        (<Mono>countedBy(spec, key, {'{ from }'})</Mono>, <Mono>readsFrom(spec, key)</Mono>: a calculation&apos;s
        when every value it reads is one subject&apos;s), <Mono>meta.drill.of_values</Mono> names them per value
        (the catalogue label: &quot;The rota weeks behind Hours worked&quot; in the window, &quot;Rota weeks behind
        ...&quot; on the trail), and <Mono>per_figure</Mono> is set when the figures count different subjects&apos;
        rows.
      </P>
      <P>
        The builder: <Mono>alsoChoices(catalogue, spec)</Mono> (<Mono>{'[{ key, label, area, ok, why }]'}</Mono>:
        every subject the role can build on, the report&apos;s own too, and why one can&apos;t line up),{' '}
        <Mono>addAlso(spec, subjectKey, {'{ key, label, filters }'})</Mono>, <Mono>removeAlso()</Mono>,{' '}
        <Mono>updateAlso()</Mono>, <Mono>alsoKeyFor()</Mono>, <Mono>alsoProblems()</Mono> (the subjects that
        can&apos;t line up any more, as sentences) and <Mono>addValue()</Mono> with <Mono>from</Mono> (another
        subject&apos;s figure is another value even when the figure is the same); <Mono>addColumn()</Mono> refuses a
        table across while other subjects are in; <Mono>valueName()</Mono> names a figure with its subject.
        Admin: <Mono>AlsoPart</Mono> / <Mono>AlsoCard</Mono> in <Mono>builder/SetUp.jsx</Mono> (<Mono>setup-also</Mono>,{' '}
        <Mono>also-add</Mono>, <Mono>also-card</Mono> <Mono>data-key</Mono> <Mono>data-subject</Mono>,{' '}
        <Mono>also-name</Mono>, <Mono>also-values</Mono>, <Mono>also-no-values</Mono>, <Mono>also-unlined</Mono>,{' '}
        <Mono>also-hidden</Mono>, <Mono>also-filter</Mono>, <Mono>also-filter-open</Mono>,{' '}
        <Mono>also-filter-remove</Mono>, <Mono>also-readers</Mono>, <Mono>also-add-value</Mono>,{' '}
        <Mono>also-add-filter</Mono>, <Mono>also-remove</Mono>, <Mono>also-matrix</Mono>), <Mono>AlsoWindow</Mono>{' '}
        in <Mono>pages/ReportBuilder.jsx</Mono> (<Mono>also-search</Mono>, <Mono>also-area</Mono>,{' '}
        <Mono>also-choice</Mono> <Mono>data-subject</Mono> <Mono>data-ok</Mono>, <Mono>also-why</Mono>,{' '}
        <Mono>also-none</Mono>), the Data panel&apos;s subject list (<Mono>data-subject</Mono>,{' '}
        <Mono>data-also-hint</Mono>; another subject&apos;s fields are values with <Mono>from</Mono> or filters
        on fields that aren&apos;t shared, never groupings), the <Mono>filter-also</Mono> and{' '}
        <Mono>value-also</Mono> lines in <Mono>Windows.jsx</Mono>. Across the top is closed while another
        subject is in, and Save and Save as wait while <Mono>alsoProblems()</Mono> says anything. The builder
        offers fixed values only for another subject&apos;s filters; a definition may still ask for one, and its
        choice shows like any other.
      </P>
      <P>
        Pepper and plans: the smart builder&apos;s answer has <Mono>also</Mono>{' '}
        (<Mono>{'[{ name, subject (an S ref), label, filters }]'}</Mono>) and a value&apos;s <Mono>from</Mono>;{' '}
        <Mono>toSpec()</Mono> adds them through the builder&apos;s edits, leaves out (in couldnt, with the
        reason) what can&apos;t line up or is over three, keeps the report&apos;s period and venues for them, and asks
        once more with a subject listed only in a line now listed in full (<Mono>rankSubjects()</Mono> takes{' '}
        <Mono>pinned</Mono> as a key or a list; <Mono>buildSlice()</Mono> gives <Mono>fIn()</Mono> /{' '}
        <Mono>refIn()</Mono> per subject). Plans: <Mono>PLAN.also</Mono>{' '}
        (<Mono>{'[{ subject, name?, label?, filters? }]'}</Mono>) and a figure&apos;s <Mono>from</Mono> (an also
        name, or a subject key, added when missing); <Mono>planOf()</Mono> writes them back and{' '}
        <Mono>planProblems()</Mono> names a <Mono>from</Mono> that names nothing (<Mono>unknown.froms</Mono>) and
        another subject&apos;s unknown paths (<Mono>paths[].subject</Mono>). Pepper&apos;s report tools say whose
        figures are whose.
      </P>
      <P>
        The weather: <Mono>local.weather</Mono> (<Mono>api/src/reports/catalogue/local.js</Mono>, area Local
        info, module <Mono>local_info</Mono>), one row per venue and day from <Mono>local_info_items</Mono> of
        kind weather holding a weather day: the one read last for that day (<Mono>DISTINCT ON</Mono> venue and
        day by <Mono>updated_at</Mono>), days hidden on Local info left out. Its figures are the day as known
        (recorded once the day is over, else the forecast); <Mono>recorded</Mono> says which, and{' '}
        <Mono>forecast_conditions</Mono>, <Mono>forecast_high</Mono>, <Mono>forecast_low</Mono>,{' '}
        <Mono>forecast_rain</Mono> are what was forecast (the kept <Mono>data.forecast</Mono> for a recorded day,
        the day itself before), with a <Mono>recorded_days</Mono> figure. Fields: the weather and its kind
        from the code (<Mono>weatherCodes()</Mono>, <Mono>WEATHER_GROUPS</Mono>, <Mono>weatherGroup()</Mono> in{' '}
        <Mono>shared/localInfo.js</Mono>, never the row&apos;s title), how it shows, highest and lowest, rain and
        snow, strongest wind, wet (<Mono>WET_DAY_MM</Mono> 1 mm, the line the Local info summary starts saying
        how much from), when the forecast was last read; figures: days, wet and dry days, days with a weather
        warning, share of days wet, average highest and lowest, hottest, coldest, average rain, wettest day,
        windiest. Starters: Sales against the weather and Sales, labour and bookings by venue (<Mono>till.js</Mono>),
        Labour against sales by week (<Mono>staff.js</Mono>). Tests: <Mono>shared/test/reportAlso.test.mjs</Mono>,
        the other-subject tests in <Mono>reportBuild.test.mjs</Mono>, <Mono>api/test/reports-also.test.mjs</Mono>{' '}
        (9: lining up by venue, day and week, the period before, a top N, roles, rows that can&apos;t line up,
        part weeks, a daily subject beside a weekly report, opening rows up), <Mono>reports-weather.test.mjs</Mono>{' '}
        (7), the other subjects in <Mono>reports-smart.test.mjs</Mono>, and every starter run in{' '}
        <Mono>reports-api.test.mjs</Mono> (a starter with a weekly subject beside a daily one runs over the week
        holding today).
      </P>

      <H3>Who may do what</H3>
      <P>
        Module <Mono>reports</Mono> (group <Mono>reports</Mono>; View, Use and Manage; owner and admin Manage,
        operator View, viewer none). <Mono>api/src/reports/access.js</Mono>: <Mono>reportPerson(req)</Mono>{' '}
        (the caller&apos;s level on Reports and on every catalogue module), <Mono>rightsOn(row, person)</Mono>{' '}
        and the same rule as SQL in <Mono>openTo()</Mono> (open: Manage, the owner, shared with everyone or
        with the person&apos;s role, or a starter the group offers; edit: Manage, or the owner with Use; share:
        Manage), <Mono>runsFor(subject, levels)</Mono> (<Mono>runs</Mono>, else <Mono>needs</Mono>: the area
        the role lacks), <Mono>checkedSpec()</Mono>, <Mono>refuseOtherVenues()</Mono> (a definition or a run
        naming another group&apos;s venue: 404, as everywhere), <Mono>recordRun()</Mono>. What data a person
        sees is never stored on a report: every run is compiled against the runner&apos;s own module levels, so
        a shared report shows each person only what their role may see.
      </P>

      <H3>Routes</H3>
      <DataTable
        head={['Route (/api/reports)', 'Level', 'What it does']}
        rows={[
          ['GET /catalogue', 'View', 'The subjects, fields, measures and links the person may report on'],
          ['GET /', 'View', 'reports (saved ones the person can open), starters (each with runs / needs), areas'],
          ['POST /', 'Use', 'Save a new report (300 per person)'],
          ['POST /preview', 'Use', 'Run a definition that isn\'t saved (rows 1 to 5000, 200 unless given); not recorded'],
          ['POST /export', 'Use', 'A CSV or Excel file of a definition that isn\'t saved'],
          ['GET /:id', 'View', 'One report with its definition, runs / needs and what the person may do with it'],
          ['PUT /:id, DELETE /:id', 'Use', 'Its owner, or Manage'],
          ['PATCH /:id/sharing', 'Manage', 'shared private | roles | everyone, role_ids (the group\'s own), is_starter'],
          ['POST /:id/run', 'View', 'params (the period, venues and other choices), drill (steps, 10 at most), fresh'],
          ['POST /:id/export', 'Use', 'format csv | xlsx, params, drill'],
          ['POST /:id/print-link', 'View', 'params, drill, trail (the trail\'s words), table (shown under the chart or not), hidden (series switched off): a link to the print page that works for 15 minutes'],
          ['GET /print/:linkId', 'No login', 'The print page (its own plugin, reportPrintRoutes): the link is the key; ?print=1 opens the print window'],
          ['GET /runs', 'View', 'Past runs (phase 4a): scope mine | all (all needs Manage), report (an id or starter:<key>), file (a kept file\'s id), files 1 (runs that kept a file), before (the cursor the last page gave), limit (50 unless given, 200 at most) → { runs, next, can_manage }'],
          ['POST /:id/files', 'Use', 'Keep a CSV or Excel file of a report to download later: format, params, drill (as /export) → 201 { file }; 422 when the group keeps 500 MB already'],
          ['GET /files/:fileId', 'Use', 'Download a kept file: its maker only (404 for anyone else), while it is kept (410) and while their role sees the report the same way (403); counted'],
          ['DELETE /files/:fileId', 'View', 'Its maker takes a kept file off at once (204; again is no error)'],
          ['POST /:id/copy', 'Use', 'A copy of a report or a starter as the person\'s own'],
          ['POST /:id/star, DELETE /:id/star', 'View', 'The person\'s own stars (report_stars)'],
        ]}
      />
      <P>
        <Mono>:id</Mono> is a saved report&apos;s id or <Mono>starter:&lt;key&gt;</Mono>. Tables{' '}
        <Mono>reports</Mono>, <Mono>report_stars</Mono> and <Mono>report_runs</Mono> (forced RLS). A run or a
        file is recorded in <Mono>report_runs</Mono> (who, which report, rows, milliseconds, any error) with
        the period and venues it was run for; any other choice is kept as a number or yes / no, typed words
        only as <Mono>{'{ set: true }'}</Mono>, and a drill as the fields it went through without their
        values. Records go after 400 days (<Mono>cleanUpReportRuns()</Mono>, hourly with the AI clean-up).
      </P>

      <H3>Files</H3>
      <P>
        <Mono>api/src/reports/export/</Mono>. <Mono>table.js</Mono> turns a result into headings and plain
        cells (<Mono>resultTable()</Mono>: Subtotal and Total labelled, everything else as its words, units in
        the headings; <Mono>fileName()</Mono>). <Mono>csv.js</Mono>: UTF-8 with a byte order mark, CRLF, text
        cells made safe against formulas; a list is streamed a thousand rows at a time from a cursor (up to
        250,000 rows, the last line saying so when cut), a summary or matrix written from its result.{' '}
        <Mono>xlsx.js</Mono> (SheetJS): real numbers, percentages and dates with formats, column widths and an
        About sheet (report, period, venues, who and when, notes); built in memory, so 200,000 cells at most,
        a longer list cut with a note on the About sheet. A list&apos;s file has no totals row. The admin
        downloads with <Mono>api.postDownload(path, body, fallbackName)</Mono> (<Mono>lib/api.js</Mono>).
      </P>

      <H3>Past runs and kept files (phase 4a, migration 250)</H3>
      <P>
        A file can be kept on the server to download later, from the report&apos;s page (More → Keep a CSV
        file / Keep an Excel file) or by Pepper (<Mono>export_report</Mono>), and every run, download, print
        and kept file is listed on Past runs (<Mono>/reports/runs</Mono>, <Mono>pages/ReportRuns.jsx</Mono>).
        Table <Mono>report_files</Mono> (forced RLS): its run (<Mono>run_id</Mono>), who made it, the
        definition and choices it was made from (<Mono>spec</Mono>, <Mono>params</Mono>, <Mono>drill</Mono>),
        the maker&apos;s module levels then (<Mono>levels</Mono>), name, format, bytes, rows, whether it holds
        people&apos;s details (<Mono>personal</Mono>: any column the catalogue marks <Mono>pii</Mono>), where
        it is stored (<Mono>storage_key</Mono>), <Mono>expires_at</Mono>, downloads and the last one,{' '}
        <Mono>removed_at</Mono>.
      </P>
      <P>
        <Mono>api/src/services/privateStore.js</Mono> keeps the files outside anything the web server
        serves: under <Mono>PRIVATE_DIR</Mono> (default <Mono>/home/ubuntu/macaroonie-private</Mono>, never
        under <Mono>UPLOAD_DIR</Mono>), folders 0700 and files 0600, keys{' '}
        <Mono>reports/YYYY-MM-DD/&lt;uuid&gt;.csv|xlsx</Mono> checked by a pattern before any path is built,
        written with <Mono>wx</Mono> (never over another file). <Mono>api/src/reports/files.js</Mono>:{' '}
        <Mono>keepReportFile()</Mono> (the group&apos;s room checked first, <Mono>GROUP_MB</Mono> 500: a
        refusal records no run; the file written by the same exporters as a download, then its run and its
        row in one transaction; a failure removes the half-written file and records a failed run),{' '}
        <Mono>openFile()</Mono> (its maker only: 404 for anyone else, Manage included; 410 once removed or
        past <Mono>expires_at</Mono>: <Mono>FILE_DAYS</Mono> 30, <Mono>PERSONAL_DAYS</Mono> 7 with
        people&apos;s details; 403 when the maker&apos;s role would see the report differently now:{' '}
        <Mono>reachOf()</Mono> compiles the definition with the levels then and now and compares the columns
        or values and the notes, a change to an area the report doesn&apos;t read changing nothing),{' '}
        <Mono>countDownload()</Mono>, <Mono>removeFile()</Mono> (the row stays, its definition and levels
        cleared), <Mono>cleanUpReportFiles()</Mono> (hourly with the AI clean-up: files past their time
        taken off, and day folders older than 32 days removed whatever they hold), <Mono>fileView()</Mono>.
        Customer and loyalty member erasure takes off every live personal file of the group in its own
        transaction (<Mono>forgetPersonalFiles()</Mono> in <Mono>reports/fileErasure.js</Mono>, the stored
        files removed after it commits), since such a file may hold that person&apos;s name.
      </P>
      <P>
        <Mono>api/src/reports/runs.js</Mono>: <Mono>pastRuns()</Mono> reads <Mono>report_runs</Mono> newest
        first with each run&apos;s kept file, in pages of <Mono>RUNS_PAGE</Mono> 50 (<Mono>RUNS_MAX</Mono>{' '}
        200) by a cursor of the last row&apos;s time and id compared in SQL (a JS <Mono>Date</Mono> would drop
        microseconds, so the time is read as text and sent back as text, <Mono>::text::timestamptz</Mono>:
        postgres.js writes a timestamptz parameter through a <Mono>Date</Mono>); a run says what was done (ran, printed, kept, downloaded), its report (name, whether
        the person may open it now), the person (with <Mono>mine</Mono>), by Pepper, rows, time, any error,
        its choices in words (typed values only as &quot;a value typed in&quot;) and the rows opened up.
        Pepper&apos;s <Mono>report_runs</Mono> and <Mono>export_report</Mono> read and write through these
        routes as the person; a file Pepper keeps is the person&apos;s, downloaded by them from Past runs
        (Pepper never sees its rows). The catalogue&apos;s Report runs subject (<Mono>group.report_runs</Mono>{' '}
        in <Mono>catalogue/runs.js</Mono>, area Your group, Manage on Reports) counts the same rows:
        runs, on screen, downloads, files kept, prints, failures, by Pepper, people, reports, average and
        slowest time; who ran each is their email, and the link to their team record (name, role) needs the team module. The deploy prints the machine&apos;s cores, memory,
        disk and PM2 processes in its log (read only), for the PDF decision in phase 4d.
      </P>
      <P>
        The viewer&apos;s More (<Mono>pages/ReportView.jsx</Mono>) is on every report now: Past runs of this
        report (<Mono>more-runs</Mono>, to <Mono>/reports/runs?report=</Mono>) is for anyone who can open the
        report, Keep a file (<Mono>more-keep</Mono>, <Mono>more-keep-csv</Mono>, <Mono>more-keep-xlsx</Mono>)
        needs Use and a report the role can run, and the button&apos;s <Mono>aria-label</Mono> lists what the
        window holds (More: past runs, keep a file, copy, rename, share, delete). After keeping, a note
        (<Mono>report-kept</Mono>) gives the file&apos;s name, how long it is kept and{' '}
        <Mono>report-kept-open</Mono> (Open Past runs, on that file).
      </P>
      <P>
        Tests: <Mono>api/test/reports-files.test.mjs</Mono> (a kept file byte for byte the download, on disk
        0600 under its key; seven days with people&apos;s details; only its maker; who sees Past runs, its
        filters and pages; expiry and the clean-up; a role that sees the report differently; the
        group&apos;s room; taking one off; erasure; Pepper on the connector and in the chat; the Report runs
        subject against Past runs); the fixtures keep a file, so the tenant sweep sends the file routes as
        the other group.
      </P>

      <H3>Schedules and emailed reports (phase 4b, migration 251)</H3>
      <P>
        A saved report or a starter can be sent by email on a schedule, or once from the viewer
        (<strong>Email it now</strong>). The rules are one shared file, <Mono>shared/reports/schedule.js</Mono>,
        used by the API, the schedule window and Pepper: timing (<Mono>normaliseTiming()</Mono>,{' '}
        <Mono>timingText()</Mono>, <Mono>nextRunAt(timing, now, tz)</Mono>: every day, chosen weekdays, or
        once a month on a day, the last day or a weekday such as the first Monday, at a time on the
        venue&apos;s clock), delivery (<Mono>normaliseDelivery()</Mono>: the figures in the message, a CSV
        or Excel file attached, or both, and whether the file is kept in Past runs), the condition
        (<Mono>normaliseCondition()</Mono>: every time, only when there are rows, or only when one of the
        report&apos;s figures is over, at least, under, at most or more than an amount either way, in
        total or on any row) and who it goes to (<Mono>normaliseRecipients()</Mono>,{' '}
        <Mono>recipientsProblem()</Mono>, 50 addresses at most). A schedule&apos;s period must be a
        relative one (<Mono>periodProblem()</Mono>). The report&apos;s venues and the time zone its clock
        runs on come from <Mono>venueScope(venues, spec, params)</Mono> in{' '}
        <Mono>shared/reports/spec.js</Mono>: the first venue in scope, venues in the order they were made.
      </P>
      <P>
        <strong>Tables.</strong> <Mono>report_schedules</Mono> (forced RLS): the report or its starter key,
        its owner, name and message, <Mono>timing</Mono>, <Mono>params</Mono>, <Mono>delivery</Mono>,{' '}
        <Mono>condition</Mono> and <Mono>recipients</Mono> as jsonb, <Mono>personal_outside</Mono>,{' '}
        <Mono>enabled</Mono>, <Mono>paused_reason</Mono>, <Mono>next_run_at</Mono>, <Mono>retry_of</Mono>,{' '}
        <Mono>running_until</Mono>, <Mono>failures</Mono> and the last run, send, status and error.{' '}
        <Mono>report_runs.kind</Mono> gains <Mono>scheduled</Mono> and <Mono>emailed</Mono>, with{' '}
        <Mono>schedule_id</Mono> and a <Mono>delivery</Mono> record that holds counts and masked addresses
        only.
      </P>
      <P>
        <strong>The sweep.</strong> <Mono>sweepSchedules()</Mono> (<Mono>api/src/reports/schedules.js</Mono>)
        runs every minute from <Mono>jobs/report-schedules.js</Mono> (BullMQ
        queue <Mono>report-schedules</Mono>). It claims each due schedule with a ten-minute lease
        (<Mono>running_until</Mono>, <Mono>FOR UPDATE SKIP LOCKED</Mono>), writes its next regular time
        before anything is sent, so a crash never sends a run twice, and runs the report as the
        schedule&apos;s owner, loaded afresh each time (<Mono>ownerPerson()</Mono>), with the time it was
        due as its today. Runs missed while the worker was down run once, and only when the last is
        under 6 hours late (<Mono>LATE_HOURS</Mono>); otherwise the run is marked late and not sent. A
        send that fails for a passing reason is tried again 5, 20, 50, 110, 230 and 350 minutes after
        it was due (<Mono>RETRY_MINUTES</Mono>, the due time kept in <Mono>retry_of</Mono>); one the
        provider refuses waits for the next run; five failures in a row (<Mono>MAX_FAILURES</Mono>)
        pause the schedule. It also pauses when its owner has left, can no longer open the report or
        has lost the access it needs, when the report needs changing, or when nothing could go out,
        and <Mono>tellPaused()</Mono> emails the owner and the group&apos;s owners.
      </P>
      <P>
        <strong>The sender.</strong> <Mono>api/src/reports/send.js</Mono>: <Mono>prepareSend()</Mono> checks
        and plans a send (also the dry run behind the window&apos;s notes and Pepper&apos;s cards), and{' '}
        <Mono>deliver()</Mono> runs the report, judges the condition, makes the file, sends and records
        the run. A message holds the first 100 rows (<Mono>EMAIL_ROWS</Mono>), an attached list 20,000
        rows (<Mono>LIST_CAP</Mono>) and an attachment 5 MB (<Mono>MAX_ATTACH_MB</Mono>).{' '}
        <Mono>mailSender()</Mono> picks the venue whose email settings send: a venue in the report&apos;s
        scope with a provider, else any venue with one, else a venue in scope, the default widget
        venue, the first made; replies go to the owner. Sending to yourself needs Use, to people on
        the team Manage, to outside addresses an owner or admin, and people&apos;s details are held
        back from outside addresses unless an owner or admin switched <Mono>personal_outside</Mono> on.
        Messages to outside addresses carry no link into the app.
      </P>
      <P>
        <strong>Routes</strong> (<Mono>api/src/routes/reportSchedules.js</Mono>):{' '}
        <Mono>GET /api/reports/recipients</Mono>, <Mono>GET /api/reports/schedules</Mono> (yours, or
        everyone&apos;s with Manage; <Mono>report=</Mono> narrows),{' '}
        <Mono>GET /api/reports/schedules/:scheduleId</Mono>, <Mono>GET</Mono> and{' '}
        <Mono>POST /api/reports/:id/schedules</Mono>, <Mono>PATCH</Mono> and{' '}
        <Mono>DELETE /api/reports/schedules/:scheduleId</Mono> (409 while it runs; changing someone
        else&apos;s makes it yours), <Mono>POST .../pause</Mono>, <Mono>.../resume</Mono> and{' '}
        <Mono>.../send</Mono> (Send now, whatever its condition), and{' '}
        <Mono>POST /api/reports/:id/send</Mono> (Email it now). Save, change, resume and send take{' '}
        <Mono>dry_run</Mono>. Pepper&apos;s tools (<Mono>api/src/ai/tools/reportSchedules.js</Mono>):{' '}
        <Mono>schedule_report</Mono>, <Mono>change_schedule</Mono>, <Mono>pause_schedule</Mono> and{' '}
        <Mono>send_report</Mono>, each behind a Confirm card made from the route&apos;s dry run. Admin:{' '}
        <Mono>components/reports/ScheduleWindow.jsx</Mono> (the schedule and send windows),{' '}
        <Mono>pages/ReportSchedules.jsx</Mono> (<Mono>/reports/schedules</Mono>), the viewer&apos;s More,
        and Past runs&apos; Sent by a schedule, Skipped by a schedule and Emailed.
      </P>
      <P>
        <strong>Tests and limits.</strong> <Mono>shared/test/reportSchedule.test.mjs</Mono> (13),{' '}
        <Mono>api/test/reports-schedule-routes.test.mjs</Mono> (9),{' '}
        <Mono>reports-schedules.test.mjs</Mono> (10, the sweep called directly) and{' '}
        <Mono>reports-schedule-pepper.test.mjs</Mono> (13); no real email provider is used. The screens
        had one short browser pass at 1280 px and on a touch phone at 390 px: what someone with Use
        sees, taking over a schedule, the outside-address refusal, a skipped run, a failed send and
        the time zone hint are covered by API tests only. Limits: one time zone per schedule; a run
        over 6 hours late is skipped; a send is known only as far as the provider taking the
        message; files are CSV or Excel until PDFs (phase 4d); nothing goes to Slack or Teams.
      </P>

      <H3>Data links and posting to a web address (phase 5, migration 256)</H3>
      <P>
        <strong>Data links.</strong> <Mono>report_data_links</Mono> (forced RLS; a saved report or a
        starter, name, <Mono>key_hash</Mono> = sha256 of the key and <Mono>key_hint</Mono> its last 4,{' '}
        <Mono>params</Mono>, <Mono>open_params</Mono>, <Mono>personal</Mono>, <Mono>rate_per_hour</Mono>,{' '}
        <Mono>expires_at</Mono>, <Mono>enabled</Mono>, its maker, uses and the rate window). Rules in{' '}
        <Mono>api/src/reports/dataLinks.js</Mono> (<Mono>LINK_LIMITS</Mono>, <Mono>newKey()</Mono> = <Mono>mrd_</Mono>{' '}
        + 24 random bytes, <Mono>makeLink()</Mono>, <Mono>serveLink()</Mono>, <Mono>assertLinkMaker()</Mono>: owners and
        admins with Manage). Routes <Mono>routes/reportDataLinks.js</Mono>: <Mono>GET /api/reports/data-links?report=</Mono>,{' '}
        <Mono>POST /api/reports/:id/data-links</Mono> (answers the key once), <Mono>PATCH</Mono> /{' '}
        <Mono>DELETE /api/reports/data-links/:linkId</Mono>, <Mono>POST .../new-key</Mono>; public{' '}
        <Mono>GET /api/report-data/:linkId</Mono> (no login; the key in <Mono>Authorization: Bearer</Mono>,{' '}
        <Mono>X-Report-Key</Mono> or <Mono>?key=</Mono>; logged at warn only). Each read runs as the maker,
        loaded afresh (<Mono>ownerPerson()</Mono>), with <Mono>outsideCopy()</Mono> unless <Mono>personal</Mono> and
        the maker is an owner; <Mono>?period=</Mono> / <Mono>?venues=</Mono> only when open; JSON pages
        (<Mono>?cursor=</Mono> of offset and the result&apos;s fingerprint, 409 when the figures changed; ETag
        and 304) through <Mono>export/json.js</Mono> (<Mono>resultJson()</Mono>), CSV whole; 429 with Retry-After
        over the rate. Each read is a run, kind <Mono>link</Mono> with <Mono>link_id</Mono>. Admin:{' '}
        <Mono>components/reports/DataLinks.jsx</Mono> (<Mono>DataLinksWindow</Mono>, the viewer&apos;s{' '}
        <Mono>more-links</Mono>).
      </P>
      <P>
        <strong>Push.</strong> <Mono>report_schedules.push_url</Mono> and <Mono>push_secret</Mono> (sealed,{' '}
        <Mono>mps_</Mono> + 32 random bytes, answered once by save as <Mono>push_secret</Mono>; a new one when the
        address changes or <Mono>new_push_secret</Mono>). <Mono>services/webPush.js</Mono>: <Mono>pushUrlProblem()</Mono>{' '}
        (https, no user name, no private host), <Mono>isPrivateAddress()</Mono> (checked again on every address the
        host resolves to before each post, the connection made to the address checked, no redirects),{' '}
        <Mono>postSigned()</Mono> with <Mono>X-Macaroonie-Signature: t=&lt;secs&gt;,v1=&lt;hex HMAC-SHA256 of
        &quot;t.body&quot;&gt;</Mono>. <Mono>deliver()</Mono> posts <Mono>resultJson()</Mono> (1,000 rows) after the
        emails; a push-only schedule has no recipients; a failed post is tried again like a failed email.
        Owners and admins with Manage only (<Mono>can_push</Mono> on <Mono>/reports/recipients</Mono>); a report
        showing people&apos;s details needs <Mono>personal_outside</Mono>. Admin: the Post to a web address part of{' '}
        <Mono>ScheduleWindow.jsx</Mono> (<Mono>sched-push-url</Mono>, <Mono>sched-secret</Mono>). Tests:{' '}
        <Mono>api/test/reports-data-links.test.mjs</Mono> (6).
      </P>

      <H3>Reports on dashboards, the phone, the menu search and Today (phase 5, migration 257)</H3>
      <P>
        <strong>Widget.</strong> Widget type <Mono>report</Mono> (migration 257 widens the
        <Mono>widget_type</Mono> CHECK; <Mono>WIDGET_MODULE</Mono> <Mono>report: &apos;reports&apos;</Mono>, so adding one
        needs View on Reports), on every dashboard kind. The report is the widget&apos;s{' '}
        <Mono>settings.report</Mono> (a saved id or <Mono>starter:&lt;key&gt;</Mono>), options{' '}
        <Mono>chart_only</Mono> / <Mono>table_only</Mono>. <Mono>components/reports/ReportWidget.jsx</Mono>:{' '}
        <Mono>useRunnableReports()</Mono> (the <Mono>[&apos;reports&apos;]</Mono> list, saved reports and starters
        with <Mono>runs</Mono>), <Mono>ReportPicker</Mono>, <Mono>ReportPeek</Mono> (<Mono>POST /reports/:id/run</Mono>{' '}
        as the person looking, every 5 minutes, <Mono>shownResult()</Mono> then <Mono>ResultCard</Mono>),{' '}
        <Mono>ReportWidget</Mono> (loaded lazily by <Mono>widgetTypes.jsx</Mono>, so the dashboards don&apos;t
        carry the report pages&apos; code; on the phone its link opens the phone page).
      </P>
      <P>
        <strong>Phone.</strong> <Mono>pages/mobile/MobileReports.jsx</Mono> (<Mono>MobileReportList</Mono> at{' '}
        <Mono>/mobile/reports</Mono>: starred, own and the team&apos;s, starters, a search;{' '}
        <Mono>MobileReport</Mono> at <Mono>/mobile/reports/:ref</Mono>: the period and{' '}
        <Mono>ReportPeek</Mono>, read only; a page of reports says to open it on the office pages),
        lazy routes in <Mono>admin/src/routes/reports.jsx</Mono>, the <Mono>reports</Mono> tile in <Mono>mobile/registry.js</Mono>,{' '}
        <Mono>opsLink()</Mono> mapping <Mono>/reports/:id</Mono> to the phone page.
      </P>
      <P>
        <strong>Menu search.</strong> <Mono>searchReports(list, query)</Mono> in <Mono>shared/navSearch.js</Mono>{' '}
        (every term in the name or the description, a name hit 2, a description hit 1, a plural half a
        point less, starred a quarter more, <Mono>REPORT_RESULTS_MAX</Mono> 5);{' '}
        <Mono>useReportMatches()</Mono> in <Mono>components/layout/AskBar.jsx</Mono> (from two letters,
        saved reports that run and starred starters; <Mono>ask-reports</Mono>,{' '}
        <Mono>ask-report</Mono> <Mono>data-id</Mono>), drawn under the pages in the ask bar for people
        with Reports.
      </P>
      <P>
        <strong>Today.</strong> A schedule&apos;s <Mono>delivery.today</Mono> (<Mono>normaliseDelivery()</Mono>{' '}
        keeps it only when true; never on Email it now). With it a schedule may have no recipients;
        its runs record <Mono>delivery.today</Mono> when the condition was met (<Mono>deliver()</Mono>, format{' '}
        <Mono>today</Mono> when nothing else went). <Mono>GET /api/reports/alerts?venue_id=&amp;date=</Mono>{' '}
        (Reports View; <Mono>routes/reportSchedules.js</Mono>): each schedule&apos;s latest such run on the
        venue&apos;s day, the report still runnable by the person (<Mono>runsFor()</Mono>) and the venue in its
        scope (<Mono>venueScope()</Mono>). <Mono>services/opsToday.js</Mono> source <Mono>report_alerts</Mono>{' '}
        (area module <Mono>reports</Mono>): a <Mono>report_alert</Mono> task in Now, opening the report.
        Admin: the On Today part of <Mono>ScheduleWindow.jsx</Mono> (<Mono>sched-today</Mono>,{' '}
        <Mono>sched-today-only</Mono>), <Mono>KIND_ICON</Mono> in{' '}
        <Mono>Home.jsx</Mono>. Tests: <Mono>api/test/reports-phase5.test.mjs</Mono> (4), the
        report search test in <Mono>shared/test/navSearch.test.mjs</Mono>.
      </P>

      <H3>Layout templates, Page reports and PDFs (phase 4c and 4d, migration 253)</H3>
      <P>
        <strong>Layouts.</strong> <Mono>report_layouts</Mono> (forced RLS; name unique per group, at most one{' '}
        <Mono>is_default</Mono>, 20 a group) holds settings, not a canvas: <Mono>shared/reports/layout.js</Mono>{' '}
        (<Mono>normaliseLayout()</Mono>, <Mono>BUILT_IN</Mono> = the print page as it was, <Mono>paperBox()</Mono>,{' '}
        <Mono>pageRule()</Mono>, <Mono>negativeText()</Mono>, <Mono>cssString()</Mono>, <Mono>layoutWords()</Mono>).{' '}
        <Mono>reports.layout_id</Mono> picks one (null: the default, else built-in). Routes{' '}
        <Mono>routes/reportLayouts.js</Mono>: <Mono>GET /api/reports/layouts</Mono> (View),{' '}
        <Mono>POST</Mono> / <Mono>PUT</Mono> / <Mono>DELETE /api/reports/layouts/:layoutId</Mono> (Manage),{' '}
        <Mono>PUT /api/reports/:id/layout</Mono> (whoever may edit the report). The print page and PDFs draw by
        it (<Mono>api/src/reports/export/print.js</Mono>); <Mono>report_print_links.layout</Mono> keeps the
        layout as it was when Print was pressed, <Mono>preview</Mono> marks the editor&apos;s framable preview
        (<Mono>POST /api/reports/:id/print-link</Mono> with <Mono>{'{ layout, preview: true }'}</Mono>, Manage;
        never recorded).
      </P>
      <P>
        <strong>Page reports.</strong> A row of <Mono>reports</Mono> with subject <Mono>page</Mono> and its
        blocks in <Mono>spec</Mono> (<Mono>shared/reports/page.js</Mono>: report, text, break;{' '}
        <Mono>normalisePage()</Mono> drops a break first, two in a row and at the end). Blocks are references:{' '}
        <Mono>api/src/reports/pages.js</Mono> (<Mono>checkedPage()</Mono>, <Mono>pageReports()</Mono>,{' '}
        <Mono>pageChoice()</Mono>, <Mono>resolveBlocks()</Mono>) finds and runs each as the person looking.{' '}
        <Mono>GET /api/reports/:id</Mono> gives a page <Mono>report_kind: &apos;page&apos;</Mono> and{' '}
        <Mono>reports</Mono> by ref; <Mono>POST /api/reports/:id/blocks/:blockId/run</Mono> runs one block with
        the visitor&apos;s period and venues; Print and export (PDF only) take the page&apos;s choice;{' '}
        <Mono>report_print_links.blocks</Mono> keeps the resolved blocks. A page can&apos;t be run, kept or
        scheduled. Admin: <Mono>pages/ReportPageEditor.jsx</Mono> (<Mono>/reports/new-page</Mono>,{' '}
        <Mono>/reports/:id/page</Mono>), <Mono>components/reports/PageBody.jsx</Mono> (<Mono>pageChoiceOf()</Mono>,
        the blocks in the viewer).
      </P>
      <P>
        <strong>PDFs.</strong> <Mono>services/pdfBrowser.js</Mono> prints the print page with a headless Chrome
        (<Mono>--print-to-pdf</Mono>; <Mono>PDF_BROWSER_PATH</Mono>, else Chrome or Chromium where their
        packages put them; <Mono>scripts/ensure-pdf-browser.sh</Mono> installs Google Chrome on deploy). One at a
        time on the machine (a lock file plus a queue per process), every host name resolving to nothing, the
        page made with <Mono>printHtml({'{ pdf: true }'})</Mono> (no scripts, pictures as data).{' '}
        <Mono>pdfAvailable()</Mono> gives <Mono>can_pdf</Mono> on report views; without a browser PDFs are
        refused (422). Format <Mono>pdf</Mono> on export, kept files (<Mono>report_files.format</Mono>) and
        schedule attachments. Admin: <Mono>pages/ReportLayouts.jsx</Mono> (<Mono>/reports/layouts</Mono>),{' '}
        <Mono>components/reports/LayoutPick.jsx</Mono> (More, How it looks on paper), the PDF button and Keep a PDF
        in <Mono>pages/ReportView.jsx</Mono>. Tests: <Mono>api/test/reports-layouts.test.mjs</Mono>,{' '}
        <Mono>reports-pages.test.mjs</Mono>.
      </P>

      <H3>Starter reports</H3>
      <P>
        <Mono>api/src/reports/starters/</Mono>: 88 definitions in code (<Mono>till.js</Mono> 17,{' '}
        <Mono>online.js</Mono> 6, <Mono>bookings.js</Mono> 7, <Mono>cash.js</Mono> 8, <Mono>staff.js</Mono> 8,{' '}
        <Mono>purchasing.js</Mono> 8, <Mono>safety.js</Mono> 9, <Mono>loyalty.js</Mono> 4,{' '}
        <Mono>kitchen.js</Mono> 3, <Mono>kiosks.js</Mono> 2, <Mono>menus.js</Mono> 4, <Mono>guests.js</Mono> 2
        (newsletter sign-ups, reviews), <Mono>tech.js</Mono> 3, <Mono>local.js</Mono> 1 and{' '}
        <Mono>app.js</Mono> 6: booking emails, Pepper&apos;s use by month and by person, Pepper&apos;s
        changes, team sign-ins, issues; the Reports page lists each under its subject&apos;s area), each made with <Mono>starter()</Mono>{' '}
        (<Mono>define.js</Mono>: adds the <Mono>period</Mono> and <Mono>venues</Mono> parameters and their
        filters) and checked when the API starts: one that <Mono>normaliseReport()</Mono> would change, that
        has a problem, or whose other subjects can&apos;t line up with its rows (compiled with{' '}
        <Mono>strictParts</Mono>), stops the start. They are never rows in <Mono>reports</Mono>; a copy is. A starter
        on an area the role can&apos;t see is still listed, with <Mono>runs: false</Mono> and what it needs.
        Whether a starter runs is decided by its subject&apos;s module only, at the level the subject asks for
        (View, or Manage on Pepper for use by person and changes), so every starter must run for a
        role with just that: a figure needing another module drops out with a note (Spend by supplier for
        a role without Purchasing setup shows how many orders). <Mono>reports-areas.test.mjs</Mono> runs every
        starter, its rows and each of its breakdowns that way; the start-up check compiles every starter as
        someone with Manage on every module (<Mono>EVERYTHING</Mono>), as the tests&apos; <Mono>LEVELS</Mono> do.
      </P>

      <H3>The builder</H3>
      <P>
        13 Nov 2026, no migration (<Mono>docs/REPORTS.md</Mono> 9). <Mono>shared/reports/build.js</Mono> is the
        builder&apos;s one set of rules, for the admin now and Pepper later. It knows the catalogue only as{' '}
        <Mono>catalogueView()</Mono> gives it, and every edit returns a whole definition that has been through{' '}
        <Mono>normaliseReport()</Mono>, or the very same object when nothing changes (so <Mono>===</Mono> says
        &quot;it is in the report already&quot;). <Mono>pathUses(catalogue, subject, path)</Mono> says what a
        field, figure or link can be in a report about a subject:
      </P>
      <DataTable
        head={['Path', 'What it can be']}
        rows={[
          ['A measure of the subject itself', 'A value. Through a "one" link it isn\'t offered: each figure would count once for every one of the report\'s rows.'],
          ['A field of the subject, or of something each row has one of (server.name)', 'A grouping (group, with buckets for a date or a moment) and a list column; a filter by value (not a time of day or an id). As a value: a number\'s smallest and largest, its total (own rows only, and only a field that adds) and its average (own rows only); anything else as how many different.'],
          ['A "one" link itself (a check\'s server)', 'How many different; the link to venue is also the venues filter (filter: \'venues\').'],
          ['Through a "many" link (a customer\'s bookings), straight off the subject and through no second list', 'Only what adds up for each row first: a measure the catalogue marks across, or the total, smallest or largest of a number field that adds. No grouping, column or filter.'],
        ]}
      />
      <P>
        <Mono>dataTree(catalogue, subject, {'{ depth: 2 }'})</Mono> is the Data panel (figures, fields, a folder
        per link, two links deep; lists of rows only straight off the subject, and only when something in
        them adds up; never round in a circle, never the same thing twice (a line&apos;s check&apos;s venue is the
        line&apos;s own venue), and a link to another row of the same kind offered once, straight off the
        subject), with <Mono>treeNodes()</Mono> and <Mono>searchTree()</Mono> (every word must be found;
        names that start with the first word, then names that hold every word, then matches in a folder&apos;s
        name or in what a thing is about). The edits: <Mono>startReport()</Mono>,{' '}
        <Mono>setKind()</Mono>, <Mono>addRow()</Mono> / <Mono>addColumn()</Mono> / <Mono>removeRow()</Mono> /{' '}
        <Mono>removeColumn()</Mono> / <Mono>moveRow()</Mono> / <Mono>moveColumn()</Mono> /{' '}
        <Mono>updateRow()</Mono> (heading, bucket, rows to columns and back, a subtotal),{' '}
        <Mono>addValue()</Mono> / <Mono>updateValue()</Mono> / <Mono>removeValue()</Mono> /{' '}
        <Mono>moveValue()</Mono> / <Mono>valueReaders()</Mono> (the calculations that read a value),{' '}
        <Mono>addFilter()</Mono> / <Mono>setFilter()</Mono> (<Mono>ask</Mono> makes a parameter,{' '}
        <Mono>venues</Mono> the venues one) / <Mono>removeFilter()</Mono> (a parameter nothing asks for goes
        with it), <Mono>setParamDefault()</Mono>, <Mono>setSort()</Mono>, <Mono>setLimit()</Mono> /{' '}
        <Mono>limitOf()</Mono>, <Mono>setTotals()</Mono>, <Mono>setCompare()</Mono> /{' '}
        <Mono>compareProblem()</Mono>, <Mono>roomLeft()</Mono>, <Mono>sortChoices()</Mono>. Because every edit
        normalises, parts that no longer fit go by themselves: a top few with its last grouping or its last
        shown value, a subtotal with its grouping, the comparison when something goes across the top. The
        words: <Mono>rowName()</Mono>, <Mono>valueName()</Mono>, <Mono>valueKindText()</Mono>,{' '}
        <Mono>filterParts()</Mono> / <Mono>filterWords()</Mono>, <Mono>paramWords()</Mono>,{' '}
        <Mono>linkTrail()</Mono>. A filter&apos;s value: <Mono>filterOps(type, bucket)</Mono>,{' '}
        <Mono>filterShape(op)</Mono> (none | one | two | many | period), <Mono>filterValueKind()</Mono>,{' '}
        <Mono>filterValueOk()</Mono>, <Mono>blankValue()</Mono> (the one rule for &quot;nothing picked&quot;),{' '}
        <Mono>shownNumber()</Mono> / <Mono>storedNumber()</Mono> (a percentage is typed as per cent, a
        duration in minutes). What a report asks for: <Mono>usedParams()</Mono>,{' '}
        <Mono>paramInputs(catalogue, spec)</Mono> (each with the subject its field belongs to: a condition
        inside a <Mono>has</Mono> filter is a path from the linked rows), <Mono>paramKeyFor()</Mono>.
      </P>
      <P>
        <Mono>api/test/reports-build.test.mjs</Mono> keeps the builder and the engine together: for every
        subject it runs every grouping, column, value and way of filtering the Data panel offers, and checks
        that what the builder leaves out is refused by the engine. Its first run found the engine fault fixed
        here: a date or moment filtered by is empty / isn&apos;t empty took the time zone as a statement
        parameter and then didn&apos;t use it, which Postgres refuses; <Mono>conditionSql()</Mono> now looks
        at the operator first.
      </P>
      <P>
        <Mono>pages/ReportBuilder.jsx</Mono> (its own chunk): <Mono>/reports/new</Mono> is{' '}
        <Mono>SubjectPicker</Mono> (subjects with <Mono>base</Mono>, by area),{' '}
        <Mono>/reports/new?subject=&lt;key&gt;</Mono> a new report, <Mono>/reports/new?from=&lt;id&gt;</Mono>{' '}
        a copy of a starter or of a report the person can&apos;t change (a starter&apos;s key is kept as{' '}
        <Mono>starter_key</Mono>), <Mono>/reports/:id/edit</Mono> a saved report (someone who may not change
        it gets a copy instead; with View on Reports the builder&apos;s addresses lead back to Reports, or
        from a report&apos;s edit address to the report). <Mono>Builder</Mono> lays the
        three parts side by side from 860 px of the page&apos;s own room (<Mono>useWidth()</Mono>,{' '}
        <Mono>WIDE</Mono>; the Data panel open to begin with from <Mono>ROOMY</Mono> 1000), else as three
        tabs. One <Mono>DndContext</Mono> (pointer distance 6, touch delay 180, keyboard;{' '}
        <Mono>collide()</Mono>: the entry under the pointer, else the shelf): fields drag from the Data panel
        only side by side; entries drag into order within Rows, Across the top and Values, and between Rows
        and Across the top, at any width.{' '}
        <Mono>act()</Mono> answers a tap in the Data panel with <Mono>{'{ ok, text }'}</Mono>,{' '}
        <Mono>dropNode()</Mono> / <Mono>onDragEnd()</Mono> a drop, <Mono>switchKind()</Mono> keeps what a
        summary and a list each had while the page is open (<Mono>stash</Mono>). The preview is{' '}
        <Mono>POST /reports/preview</Mono> with 200 rows, 600 ms after the last change, the result before
        kept dimmed meanwhile; the choices above it change the parameters&apos; defaults. <Mono>save()</Mono>{' '}
        is <Mono>PUT /reports/:id</Mono>, or <Mono>POST /reports</Mono> for a new report and for Save as
        (<Mono>SaveAsWindow</Mono>); Save waits for a name and for a definition with no problems. Back and
        View ask before leaving with changes not saved, and <Mono>beforeunload</Mono> covers closing the
        tab. Messages said for a moment (<Mono>say()</Mono>, the Data panel&apos;s own) are overlays, so
        nothing moves under a drag.
      </P>
      <DataTable
        head={['File (components/reports/)', 'What is in it']}
        rows={[
          ['builder/DataPanel.jsx', 'The Data panel: search, Figures / the subject\'s fields / Linked folders, actionsFor(node, spec, mode) (what a tap offers; one choice acts at once), usedPaths() (ticked when in the report), grips with useDraggable. mode = a shelf\'s Add window.'],
          ['builder/SetUp.jsx', 'Kind of report, Rows / Columns, Across the top, Values + Calculation, Filters, Sort (three levels), Show (every row, top, bottom, everything else), Totals, Compare with. accepts(node, shelf, spec) says whether a dragged field may land on a shelf; Shelf / Entry (sortable); WordsBox and CountBox keep what is typed while they have the focus.'],
          ['builder/Windows.jsx', 'RowWindow (heading, bucket, subtotal, across the top, take off), ValueWindow (heading, format, decimals, Only for calculations, a calculation checked by calcProblem()), FilterWindow (operator, value, Ask each time, the values found in the data through /reports/preview).'],
          ['ValueInput.jsx', 'A filter\'s value by kind (filterValueKind(): text, choice, number, yes / no, day, day of the week, hour, period) and shape (one, two or many values). NumberBox sends NaN for something typed that isn\'t a number.'],
          ['ParamInputs.jsx', 'The choices a report asks for: the viewer\'s (for the visit) and the builder\'s (what it starts with). showsInputs().'],
          ['ResultCard.jsx, shared.jsx', 'The result\'s bar, notes and table, one drawing for the viewer and the preview; Problems (a refusal with its reasons), reasons(), editPath(), customisePath().'],
        ]}
      />
      <P>
        Test ids: <Mono>report-builder</Mono> (<Mono>data-layout</Mono> wide | tabs, <Mono>data-dirty</Mono>),{' '}
        <Mono>builder-name</Mono>, <Mono>builder-save</Mono>, <Mono>builder-save-note</Mono>,{' '}
        <Mono>builder-save-as</Mono>, <Mono>builder-view</Mono>, <Mono>builder-leave</Mono>,{' '}
        <Mono>builder-tab-data|setup|preview</Mono>, <Mono>builder-preview</Mono> (<Mono>data-waiting</Mono>),{' '}
        <Mono>builder-problems</Mono>, <Mono>builder-starts</Mono>, <Mono>builder-said</Mono>;{' '}
        <Mono>data-panel</Mono>, <Mono>data-search</Mono>, <Mono>data-node</Mono>, <Mono>data-node-button</Mono>,{' '}
        <Mono>data-action</Mono>, <Mono>data-grip</Mono>, <Mono>data-said</Mono>;{' '}
        <Mono>shelf-rows|columns|values|filters</Mono>, <Mono>shelf-entry</Mono>, <Mono>shelf-open</Mono>,{' '}
        <Mono>shelf-remove</Mono>, <Mono>shelf-grip</Mono>, <Mono>shelf-add-&lt;shelf&gt;</Mono>,{' '}
        <Mono>shelf-add-calc</Mono>, <Mono>setup-kind</Mono>, <Mono>setup-sort</Mono>, <Mono>setup-limit</Mono>,{' '}
        <Mono>setup-totals</Mono>, <Mono>setup-compare</Mono>; <Mono>row-apply</Mono>, <Mono>value-apply</Mono>,{' '}
        <Mono>filter-apply</Mono>; in the viewer <Mono>report-edit</Mono>, <Mono>report-customise</Mono>,{' '}
        <Mono>report-more</Mono>, <Mono>more-copy</Mono>, <Mono>more-rename</Mono>, <Mono>more-share</Mono>,{' '}
        <Mono>more-delete</Mono>, <Mono>report-choices</Mono>, <Mono>value-choice-button</Mono>.
      </P>

      <H3>Drill-downs</H3>
      <P>
        13 Nov 2026, no migration (<Mono>docs/REPORTS.md</Mono> 8). A row of a summary, or a figure of a
        table across, can be opened: into the same figures broken down by another field, or into the rows
        behind it. A definition says what its rows offer in <Mono>drill</Mono>: <Mono>down</Mono> (up to 8
        fields, each <Mono>{'{ field, bucket? }'}</Mono>, in the order offered) and <Mono>rows</Mono> (the
        columns of the list behind a row, up to 30; none = the subject&apos;s usual list columns, from{' '}
        <Mono>listColumns()</Mono>). Nobody sends a drilled definition: the page sends steps and the
        server makes each definition from the saved report&apos;s own, so someone who may only run a
        report can still open its rows.
      </P>
      <Code>{`// a step, sent as drill: [...] (10 at most) with POST /:id/run, /:id/export, /preview and /export
{ at: [{ field: 'date', value: '2026-11-13' }, { field: 'name', value: 'Pad Thai' }],
  //   the row: each grouping it sits in, held to its value (null = the row for "none")
  to: 'rows' | { field: 'section.name' } | { field: 'sent_at', bucket: 'hour' },
  value: 'net_sales' }       // rows only: the figure whose rows are meant

// with every summary and matrix result, for the person asking
meta.drill = { down: [{ field, bucket?, label }], rows: true, of: 'Dishes sold', per_figure: true } | null`}</Code>
      <P>
        <Mono>shared/reports/drill.js</Mono>: <Mono>cleanDrill(raw)</Mono> tidies a step (a value key only
        with rows) and <Mono>drillSpec(spec, step, {'{ listColumns, also }'})</Mono> returns{' '}
        <Mono>{'{ spec }'}</Mono> or <Mono>{'{ problem }'}</Mono>. A held grouping must be one the report
        has (its rows, its columns across, its <Mono>drill.down</Mono>, or one named in{' '}
        <Mono>also</Mono>: the currency the engine groups by on its own for venues in two currencies) and
        becomes an <Mono>is</Mono> or <Mono>empty</Mono> filter beside the report&apos;s own. To rows: a
        list of <Mono>drill.rows</Mono>, else the usual columns. To a level: a summary with that one
        grouping, the same values and comparison, ordered only by the report&apos;s figures (never by
        where its rows were), a total, and a <Mono>drill</Mono> holding the levels not used yet and the
        same row columns, so each field is offered once on the way down. A list isn&apos;t drilled: its
        rows open the record itself (Opening the record from a row, below).
      </P>
      <P>
        The rows behind a figure are the rows that figure counts. <Mono>countedBy(spec, valueKey)</Mono>{' '}
        gives the catalogue measures the tapped value is made of (every shown value when none is named; a
        calculation through the values it reads), or null when one of them is a plain total, average or
        count of the rows themselves, which leaves nothing out. They go into the list as a fifth filter
        form, <Mono>{'{ counted: [measure paths] }'}</Mono>, which <Mono>compile.js</Mono> turns into the
        measures&apos; own <Mono>where</Mono> rules joined by OR (<Mono>countedParts()</Mono>,{' '}
        <Mono>countedRules()</Mono>; a ratio is its two parts): a row is listed when at least one of the
        figures counts it. A figure with no rule of its own, or one reached through a link, means every
        row counts, so the filter leaves nothing out; a path that isn&apos;t a measure is a 422. The list
        then says so in a note (&quot;Only the dishes sold that count towards Net sales are
        listed&quot;; more than three figures: &quot;the figures&quot;), on screen and in a file.{' '}
        <Mono>countedKey()</Mono> gives which rows a set of figures counts as one string to compare.
      </P>
      <P>
        <Mono>drillOffers(spec, envc)</Mono> in <Mono>run.js</Mono> writes <Mono>meta.drill</Mono>: the
        levels of <Mono>drill.down</Mono> the report isn&apos;t grouped by already and the role may group
        by, <Mono>rows</Mono> when there are columns to list, <Mono>of</Mono> the subject&apos;s name, and{' '}
        <Mono>per_figure</Mono> when the shown values count different rows (their{' '}
        <Mono>countedKey()</Mono>s differ). Null for a list and when there is nothing to offer. The routes
        run the steps one after another through <Mono>drilled(spec, steps, levels)</Mono>{' '}
        (<Mono>routes/reports.js</Mono>): each step is made from the definition the step before it gave,
        one that can&apos;t be made is a 422 with its reason, and the last definition is what runs or
        goes into the file. A run&apos;s record keeps each step as{' '}
        <Mono>{'{ to, at: [grouping ids], value? }'}</Mono>, never the held values
        (<Mono>drillRecord()</Mono> in <Mono>access.js</Mono>).
      </P>
      <P>
        Admin: <Mono>components/reports/drill.jsx</Mono> decides nothing; it reads{' '}
        <Mono>meta.drill</Mono>. <Mono>tapTarget(result, row, colIndex)</Mono> and{' '}
        <Mono>totalTarget()</Mono> say what a tap stands for (<Mono>at</Mono> from the row&apos;s{' '}
        <Mono>k</Mono> and, in a table across, the tapped column&apos;s <Mono>at</Mono>; its words and
        figures; the tapped figure only with <Mono>per_figure</Mono>), <Mono>drillChoices()</Mono> what
        it can open into, <Mono>stepOf()</Mono> makes the step, <Mono>drillBody()</Mono> leaves the
        words out of what is sent, <Mono>drillHint()</Mono> is the line under the bar,{' '}
        <Mono>DrillWindow</Mono> the choices (skipped when there is one) and <Mono>DrillTrail</Mono> the
        way back. <Mono>ResultTable</Mono> takes <Mono>onTap(target)</Mono>: a row is tappable as a
        whole (48 px tall on touch screens) with a real button in its first cell for the keyboard, and
        in a table across each figure is its own button; the &quot;everything else&quot; row, a list
        (its rows take <Mono>onOpen</Mono> instead) and a result being replaced aren&apos;t tappable. <Mono>ReportView.jsx</Mono> keeps the steps
        in state for the visit (query key <Mono>[&apos;report-run&apos;, id, params, drill]</Mono>) and
        sends them with the run and the downloads.
      </P>
      <P>
        Builder: a Drill-down part of Set up for summaries and tables across, with two shelves, and the
        edits in <Mono>shared/reports/build.js</Mono>: <Mono>addDrillLevel()</Mono> (a field the report
        could be grouped by; a day bucket is stored as none), <Mono>removeDrillLevel()</Mono>,{' '}
        <Mono>moveDrillLevel()</Mono>, <Mono>updateDrillLevel()</Mono> (its bucket),{' '}
        <Mono>setDrillRows()</Mono> (the columns, or none for the usual ones), <Mono>drillLevels()</Mono>{' '}
        (each level with its words and whether the report is grouped by it already) and{' '}
        <Mono>drillRoom()</Mono>. Each keeps <Mono>drill.open</Mono>. The Data panel&apos;s modes{' '}
        <Mono>drill</Mono> and <Mono>drillrows</Mono> are the shelves&apos; Add windows. The preview can
        be tapped like the viewer, with steps of its own (query key{' '}
        <Mono>[&apos;report-preview&apos;, live, drill]</Mono>); any change to the definition clears them.
      </P>
      <P>
        Test ids: <Mono>report-drill-hint</Mono>, <Mono>tr[data-drill=&quot;1&quot;]</Mono>,{' '}
        <Mono>report-row-open</Mono>, <Mono>report-cell-open</Mono>, <Mono>drill-window</Mono>,{' '}
        <Mono>drill-figures</Mono>, <Mono>drill-choice</Mono> (<Mono>data-to</Mono>),{' '}
        <Mono>drill-trail</Mono>, <Mono>drill-crumb</Mono> (<Mono>data-step</Mono>,{' '}
        <Mono>data-current</Mono>); in the builder <Mono>setup-drill</Mono>, <Mono>shelf-drill</Mono>,{' '}
        <Mono>shelf-drillrows</Mono>, <Mono>drill-bucket</Mono>, <Mono>drill-rows-usual</Mono>,{' '}
        <Mono>drill-rows-usual-note</Mono>, <Mono>builder-drilled</Mono>. Tests:{' '}
        <Mono>shared/test/reportSpec.test.mjs</Mono> and <Mono>reportBuild.test.mjs</Mono> (the rules),{' '}
        <Mono>api/test/reports-engine.test.mjs</Mono> (the counted filter, what a result offers,
        currencies), <Mono>reports-api.test.mjs</Mono> (steps through the routes, files, the record,
        refusals) and <Mono>reports-build.test.mjs</Mono> (every level the builder offers runs).
      </P>

      <H3>Charts</H3>
      <P>
        13 Nov 2026 (<Mono>docs/REPORTS.md</Mono> 12). <Mono>shared/reports/chart.js</Mono> is the one
        chart renderer, with no dependency and no DOM: a result in, an SVG string out, with where each
        mark sits. The viewer, the builder&apos;s preview and the print page all draw with it, and every
        word that reaches the SVG is escaped there. A definition&apos;s <Mono>view</Mono> says which kind
        and what of the report it draws; a view the report doesn&apos;t fit is kept (the page says why
        and shows the table), and a drilled definition is always a table.
      </P>
      <DataTable
        head={['Function', 'What it gives']}
        rows={[
          ['chartChoices(spec)', 'Which kinds a definition can be drawn as, and why not the others: [{ kind, label, ok, why }] (the builder\'s Chart part)'],
          ['chartValues(kind, shown, view)', 'Which of the shown values a kind draws: { ys, line }. One rule for the drawing and for the builder\'s ticks'],
          ['chartModel(result, { view })', 'What to draw: { ok: true, kind, form: plot | stack | heat | figures, ... } or { ok: false, why } (why null = nothing to draw, say nothing)'],
          ['drawChart(model, { width, brand, hidden, legend })', '{ svg, width, height, targets: [{ x, y, w, h, cat, series? }], legend: [{ key, label, colour, mark, hidden, toggle }], label }. legend: \'inside\' draws the legend in the SVG (print)'],
          ['renderChart(result, opts)', 'The model and the drawing together: { ok, svg, model, why }'],
          ['chartTip(model, target, opts)', 'The words for one mark: { title, lines: [{ label, value, colour }], none? }, with Share for parts of a whole and Total for a stack'],
          ['chartMark(model, target)', 'What a mark stands for, to open it up: { at, label, value } (null for everything else, a gap, a figure tile)'],
        ]}
      />
      <P>
        The kinds: <Mono>bar</Mono> (side by side or stacked, upright or sideways), <Mono>line</Mono>,{' '}
        <Mono>area</Mono>, <Mono>combo</Mono> (bars with a line), <Mono>parts</Mono> (parts of a whole:
        one bar cut into up to six parts with their shares; more parts as sideways bars with shares, any
        below zero as bars without; a value that doesn&apos;t add up is refused), <Mono>figures</Mono>{' '}
        (each value&apos;s total as a tile, with the change when the report compares and a trend when it
        runs by date) and <Mono>heat</Mono> (a matrix, or a summary with two groupings, shaded on one
        ramp). Rules the drawing keeps: figures of different kinds never share a scale (each kind gets
        a plot of its own, one above the other, three at most); a scale starts at zero; eight series
        at most (<Mono>MAX_SERIES</Mono>: a ninth is added into Everything else when the value{' '}
        <Mono>adds</Mono>, else the eight largest are drawn and a note says so); 60 rows, or 400 along
        a date or time; colours go with the series in a fixed order (<Mono>SERIES_COLOURS</Mono>,
        checked for colour-blind separation) and never move when one is hidden; a single series takes
        the brand&apos;s main colour when <Mono>brandColour()</Mono> says it stands out on white; words
        are never in a series colour. An area of different values is lines until the view says{' '}
        <Mono>stacked</Mono> and they add up. No chart for a list or for a result with a currency
        column. Widths come from <Mono>textWidth()</Mono> (an estimate: a server has no font to measure
        with).
      </P>
      <P>
        <Mono>shared/reports/table.js</Mono> holds what a table says, for the screen and the paper:{' '}
        <Mono>rightAligned()</Mono>, <Mono>cellText()</Mono>, <Mono>tableHeadings(columns)</Mono>,{' '}
        <Mono>rowText()</Mono>, <Mono>totalText()</Mono> and <Mono>tableModel(result)</Mono>{' '}
        (<Mono>{'{ head, align, rows: [{ kind, level, cells }], total, first_is_row, groupings, count }'}</Mono>).{' '}
        <Mono>ResultTable</Mono> draws from <Mono>tableHeadings()</Mono>, <Mono>rowText()</Mono> and{' '}
        <Mono>totalText()</Mono>, the print page from <Mono>tableModel()</Mono>, so the paper says what
        the screen says. <Mono>changeText()</Mono> moved to <Mono>format.js</Mono>.
      </P>
      <P>
        Admin: <Mono>components/reports/ReportChart.jsx</Mono> gives the drawing the room it measures
        (<Mono>ResizeObserver</Mono>), the legend as buttons (a series switched off stays off for the
        series there are; one always shows), the figures of the mark under the pointer, and a tap or
        click that holds them with a button to open the mark (<Mono>markTarget()</Mono> in{' '}
        <Mono>drill.jsx</Mono> makes the same target a tapped row does). Hovering figures take no
        pointer events; held ones hand a tap on their words to the mark underneath; in a narrow chart
        a column&apos;s figures hang under the chart; arrow keys walk the marks, Enter opens, Escape
        lets go. <Mono>ResultCard</Mono> works the model out (<Mono>chartModel(result)</Mono>), shows
        the chart above the table with Hide the table / Show the table (the report&apos;s{' '}
        <Mono>table_below</Mono> to begin with; always open when the chart can&apos;t be drawn), and
        keeps two refs up to date for Print: whether the table shows and which series are off. The
        builder&apos;s Chart part (<Mono>ChartPart</Mono> in <Mono>builder/SetUp.jsx</Mono>, summaries
        and tables across) reads <Mono>viewOptions(catalogue, spec)</Mono> and edits with{' '}
        <Mono>setView(spec, patch)</Mono>, both in <Mono>shared/reports/build.js</Mono>.
      </P>
      <P>
        Test ids: <Mono>report-chart</Mono> (<Mono>data-kind</Mono>, <Mono>data-form</Mono>),{' '}
        <Mono>chart-none</Mono>, <Mono>chart-legend</Mono>, <Mono>chart-legend-item</Mono>{' '}
        (<Mono>data-key</Mono>, <Mono>data-hidden</Mono>), <Mono>chart-svg</Mono>,{' '}
        <Mono>chart-marks</Mono>, <Mono>chart-mark-on</Mono>, <Mono>chart-tip</Mono>{' '}
        (<Mono>data-held</Mono>), <Mono>chart-tip-title</Mono>, <Mono>chart-tip-line</Mono>,{' '}
        <Mono>chart-open</Mono>, <Mono>chart-notes</Mono>, <Mono>report-table-toggle</Mono>; in the
        builder <Mono>setup-chart</Mono>, <Mono>chart-kinds</Mono>, <Mono>chart-kind</Mono>{' '}
        (<Mono>data-kind</Mono>, <Mono>data-ok</Mono>), <Mono>chart-why</Mono>, <Mono>chart-unfit</Mono>,{' '}
        <Mono>chart-values</Mono>, <Mono>chart-value</Mono>, <Mono>chart-value-one</Mono>,{' '}
        <Mono>chart-line</Mono>, <Mono>chart-x</Mono>, <Mono>chart-stacked</Mono>,{' '}
        <Mono>chart-sideways</Mono>, <Mono>chart-table-below</Mono>. Tests:{' '}
        <Mono>shared/test/reportChart.test.mjs</Mono>, <Mono>reportTable.test.mjs</Mono> and the view
        tests in <Mono>reportBuild.test.mjs</Mono>.
      </P>

      <H3>The print page</H3>
      <P>
        13 Nov 2026, migration 244 (<Mono>docs/REPORTS.md</Mono> 13). A new browser tab can&apos;t send
        the admin&apos;s login, so Print makes a link and opens it, the way a draft menu&apos;s print
        preview does. <Mono>POST /api/reports/:id/print-link</Mono> (Reports View) checks the report
        and its steps as a run would, and stores in <Mono>report_print_links</Mono> (forced RLS) what
        is on the person&apos;s screen: the definition, their choices, the drill steps with the
        trail&apos;s words, whether the table shows under the chart, the series switched off, who they
        are and their module levels. The id (a random uuid) is the key, for 15 minutes
        (<Mono>PRINT_MINUTES</Mono>); the person&apos;s own run-out links go when they make a new one,
        and anyone&apos;s a day after running out (when someone in the group next prints, and by{' '}
        <Mono>cleanUpPrintLinks()</Mono> in <Mono>reports/access.js</Mono> from the hourly clean-up,
        since a link holds the choices typed for the visit). The day is so a page opened late says
        it has run out rather than that it never was.
      </P>
      <P>
        <Mono>GET /api/reports/print/:linkId</Mono> is its own plugin with no login: it finds the link
        in system mode, runs the report as that person with those levels through{' '}
        <Mono>runReport()</Mono> (so the page shows what their role could see when they pressed Print,
        and no more), records it in <Mono>report_runs</Mono> as an export with format{' '}
        <Mono>print</Mono>, and sends HTML with <Mono>Cache-Control: private, no-store</Mono>,{' '}
        <Mono>Referrer-Policy: no-referrer</Mono>, <Mono>X-Robots-Tag: noindex, nofollow</Mono> and a
        Content-Security-Policy that allows inline styles, the one script by its nonce, images, and
        no frame. An unknown link is a 404 page and a run-out one a 410 page, both saying to press
        Print again; a report the stored levels can&apos;t run is a page with the reason. The print
        window opens by itself only with <Mono>?print=1</Mono>, which the viewer adds.
      </P>
      <P>
        <Mono>api/src/reports/export/print.js</Mono>: <Mono>printHtml(page)</Mono> writes the page (the
        group&apos;s name and logo, the report&apos;s name and description, the facts: Period, Compared
        with, each other choice, Opened up, Rows; the engine&apos;s notes; the chart through{' '}
        <Mono>renderChart()</Mono> with <Mono>legend: &apos;inside&apos;</Mono> and its notes; the table
        from <Mono>tableModel()</Mono>; Figures as of and Printed by) and{' '}
        <Mono>messageHtml()</Mono> a page that only says something. <Mono>printLayout(model)</Mono>{' '}
        decides how a table goes on paper from estimated widths: upright, else on its side, else in
        smaller text, else in parts with the leading column repeated (&quot;Part 1 of 3&quot;). The
        page learnt from the menu print pages: <Mono>@page</Mono> names only the way round and the
        margins (the paper size is the print window&apos;s choice), the body keeps padding of its own
        in print, backgrounds carry <Mono>print-color-adjust: exact</Mono>, headings repeat
        (<Mono>thead</Mono>) and a row is never split, and the Total is the table&apos;s last row, not
        a <Mono>tfoot</Mono>. On screen the paper keeps its own width (190 mm upright, 277 mm on its
        side) inside a sheet that scrolls sideways on a phone. Chromium numbers the sheets from the{' '}
        <Mono>@page</Mono> margin box.
      </P>
      <P>
        Admin: <Mono>print()</Mono> in <Mono>pages/ReportView.jsx</Mono> opens the tab first (inside
        the click, so the browser lets it), asks for the link, then sends the tab to it; when the link
        can&apos;t be made the tab closes and the page says why (<Mono>report-print</Mono>,{' '}
        <Mono>report-problems</Mono>). Tests: <Mono>api/test/reports-print.test.mjs</Mono>, the print
        page in <Mono>system-paths.test.mjs</Mono>, and the fixtures make a link for the tenant sweep
        (<Mono>/api/reports/print/</Mono> is in its <Mono>PUBLIC</Mono> list).
      </P>

      <H3>Opening the record from a row</H3>
      <P>
        13 Nov 2026, no migration (<Mono>docs/REPORTS.md</Mono> 8). A row of a list opens the record
        itself on its own page in the app. A subject says which page shows one of its rows with{' '}
        <Mono>open</Mono> in the catalogue, either an object or the key of a link to a subject that has
        one (a dish sold, a payment, a discount: <Mono>&apos;check&apos;</Mono>). The object needs a page
        in the app with <Mono>:id</Mono> in it, the module that page asks for, and one value for every
        other name in the page (<Mono>with</Mono>, a column or <Mono>{'{ sql }'}</Mono>); its{' '}
        <Mono>id</Mono> may be a template too (an online sale has an order only when it is your own,
        not a GloriaFood one). <Mono>subject()</Mono> in <Mono>define.js</Mono> refuses anything else
        when the API starts.
      </P>
      <Code>{`open: { page: '/pos/reports?check=:id&venue=:venue', module: 'pos_reports', with: { venue: 'venue_id' } }
open: { page: '/menus?edit=:menu&dish=:id', module: 'menus', with: { menu: { sql: '{section}.menu_id' } } }
open: 'check'      // the record this row belongs to opens instead

// a definition may choose (spec.drill.open): '' = the subject's own, 'self', 'none', or a
// path of at most 2 one-to-one links ('day', 'section.menu'); LIMITS.open_hops
// with every list result, for the person asking
meta.open = { page: '/pos/reports?check=:id&venue=:venue', label: 'Open the check' } | null
row.open  = { id: '01J...', venue: '8f0c...' }      // only when every value is there`}</Code>
      <P>
        <Mono>openTarget(subjectKey, want, levels)</Mono> (<Mono>catalogue/index.js</Mono>) follows the
        choice for the person asking: null for none, for more than <Mono>LIMITS.open_hops</Mono> links,
        a list of rows (a <Mono>many</Mono> link), a link their role can&apos;t see, or a page whose
        module they lack. <Mono>buildList()</Mono> in <Mono>compile.js</Mono> then adds the page&apos;s
        values to the list&apos;s select as text (<Mono>_o_id</Mono>, <Mono>_o_&lt;name&gt;</Mono>,
        through the links&apos; joins), and <Mono>shapeList()</Mono> gives a row <Mono>open</Mono> only
        when every value is there. <Mono>run.js</Mono> puts <Mono>meta.open</Mono> on a list result;
        files never carry it (<Mono>open: false</Mono> for exports, and <Mono>streamList()</Mono>{' '}
        compiles without it). Rows listed behind a summary&apos;s row open too: a drilled definition
        keeps the summary&apos;s <Mono>drill.open</Mono>. <Mono>catalogueView()</Mono> gives each
        subject <Mono>page</Mono> (its words, when the role can open it) and <Mono>opens</Mono>.
      </P>
      <P>
        The rules in <Mono>shared/reports/</Mono>: <Mono>spec.js</Mono> keeps{' '}
        <Mono>drill.open</Mono> on lists and summaries (a path of more than two links is dropped);{' '}
        <Mono>openChoices(catalogue, spec)</Mono> in <Mono>build.js</Mono> gives the builder&apos;s
        choices (<Mono>{'{ value, choices, usual }'}</Mono>: the usual one, each one-to-one link two
        deep whose subject has a page the role can open, and Nothing) and{' '}
        <Mono>setOpen(spec, value)</Mono> sets one.
      </P>
      <P>
        The pages a row opens read the record from their address and go to its venue and day
        themselves: <Mono>/pos/reports?check=:id&amp;venue=:venue</Mono> and{' '}
        <Mono>?day=:id&amp;venue=:venue</Mono> (Till reports, which also switches venue; an unknown
        venue says so; <Mono>GET /api/pos/checks/:id</Mono> now returns <Mono>venue_id</Mono>,{' '}
        <Mono>day_id</Mono> and <Mono>names.staff</Mono>, and an id that isn&apos;t a ULID is a 404),{' '}
        <Mono>/orders?order=:id</Mono> (the order&apos;s window, on its venue and day),{' '}
        <Mono>/bookings?booking=:id</Mono> (the booking&apos;s panel, on its venue and day),{' '}
        <Mono>/customers?customer=:id</Mono> and <Mono>/menus?edit=:menu</Mono> with{' '}
        <Mono>&amp;section=:id</Mono> or <Mono>&amp;dish=:id</Mono> (the panel open; one that isn&apos;t on
        the menu any more says so). Each reads its names through <Mono>useLinked()</Mono>{' '}
        (<Mono>lib/linked.js</Mono>) and calls its <Mono>clear()</Mono> once the record is closed or the
        page moves on, so a reload doesn&apos;t open it again; <Mono>clear()</Mono> keeps the history
        entry&apos;s state.
      </P>
      <P>
        Admin: <Mono>components/reports/open.js</Mono> fills the address in (<Mono>recordHref()</Mono>:
        only an address in the app, never another site) and words the line under the bar
        (<Mono>openHint()</Mono>: Tap a row to open the check, or Tap an underlined row when only some
        open). <Mono>ResultTable</Mono> takes <Mono>onOpen(row, href)</Mono>: a row that opens is a
        whole-row tap target (48 px on touch screens) whose first cell is a real link, so a keyboard
        reaches it, and Ctrl or Cmd with a click, a middle click or Shift go to the browser (a new tab
        without the way back); a click that ends a selection of words doesn&apos;t open.{' '}
        <Mono>ResultCard</Mono> passes <Mono>onOpen</Mono> only while the result is current.{' '}
        <Mono>openRecord()</Mono> in <Mono>pages/ReportView.jsx</Mono> first writes the visit (choices,
        drill steps, where the page and the table were scrolled to) into the report&apos;s own history
        entry, then opens the record with <Mono>state.fromReport</Mono>{' '}
        <Mono>{'{ id, name, path, idx, visit }'}</Mono>. <Mono>FromReport</Mono>{' '}
        (<Mono>components/reports/FromReport.jsx</Mono>, drawn by <Mono>AppShell</Mono> above the page)
        shows Back to the report while that state is there, and goes back through the history to the
        report&apos;s entry (else opens its path with the visit). The viewer restores the page&apos;s
        scroll once the result is in and <Mono>ResultTable</Mono> its own (<Mono>startAt</Mono>), once
        per shape of table, which React&apos;s StrictMode double effects can&apos;t undo. In the builder
        the Set up part <Mono>OpenPart</Mono> (<Mono>Tap a row: open it</Mono> for a list,{' '}
        <Mono>Rows a tapped row lists: open</Mono> for a summary) offers{' '}
        <Mono>openChoices()</Mono>; the preview&apos;s rows don&apos;t open.
      </P>
      <P>
        Test ids: <Mono>report-open-hint</Mono>, <Mono>tr[data-open]</Mono>,{' '}
        <Mono>report-record-open</Mono>, <Mono>from-report</Mono>, <Mono>from-report-back</Mono>,{' '}
        <Mono>setup-open</Mono>, <Mono>open-choice</Mono>, <Mono>open-hint</Mono>,{' '}
        <Mono>link-not-found</Mono>, <Mono>day-back</Mono>, <Mono>day-checks</Mono>,{' '}
        <Mono>check-back</Mono>, <Mono>dish-panel-close</Mono>, <Mono>section-panel-close</Mono>.
        Tests: <Mono>shared/test/reportSpec.test.mjs</Mono> and <Mono>reportBuild.test.mjs</Mono> (the
        rules), <Mono>api/test/reports-open.test.mjs</Mono> (every subject&apos;s page, choices, roles,
        files, drilled rows, the check route).
      </P>

      <H3>The smart builder (Pepper builds a report)</H3>
      <P>
        <Mono>POST /api/ai/reports/build</Mono> (<Mono>routes/reportAi.js</Mono>, under{' '}
        <Mono>/api/ai</Mono> for the 5-minute proxy timeout; Reports Use and Pepper view, Pepper switched
        on, 10 a minute) takes <Mono>{'{ request, previous?: { spec, requests, name }, files?: [{ name, data }] }'}</Mono>{' '}
        and answers <Mono>{'{ spec, name, about, assumed, couldnt, questions, result, problem }'}</Mono>.
        Nothing is saved and the run isn&apos;t recorded (a preview isn&apos;t). Files: JPEG, PNG, WebP or GIF
        photos up to 5 MB and PDFs up to 10 MB, checked from their first bytes by <Mono>detectFile()</Mono>,
        10 files and 20 MB at most. <Mono>previous</Mono> is a report built before that the request changes
        (&quot;only Fridays&quot;); its venues go through <Mono>refuseOtherVenues()</Mono>.
      </P>
      <P>
        <Mono>smartBuild()</Mono> in <Mono>api/src/reports/smart.js</Mono>: (1) <Mono>rankSubjects()</Mono>{' '}
        ranks the subjects the person&apos;s role can build on (<Mono>catalogueView(levels)</Mono>,{' '}
        <Mono>base</Mono>) by BM25 over their words (the names of the subject and its figures, fields and
        links, and what its fields are about; not what its figures are about, words most till subjects
        share, which pushed the subject a request is about out of the few listed in full;{' '}
        <Mono>stem()</Mono> and a few <Mono>SYNONYMS</Mono>). A linked subject&apos;s words count once per
        link, and the words of a field&apos;s choices once each: Pepper&apos;s changes name nearly a hundred
        kinds, several about bookings (Made a booking, Moved a booking...), and every &quot;booking&quot; among them made it the best
        fit for requests about bookings. Words that say when, compare or count
        (week, monthly, last year, versus, how many) are left out (<Mono>STOP</Mono>): any report can do
        those, and their echoes in labels (Week, Day) pulled the wrong subjects in. Another word for one
        typed counts for less than the word itself (<Mono>SYNONYM_WEIGHT</Mono> 0.7), never for more because
        it is rarer; ties go by the catalogue&apos;s order of areas (sales first), then to the subject with
        more figures. <Mono>buildSlice()</Mono> lists the best few in full (3 to 8,
        about 7,000 tokens) and every other one in a line. A subject is an S ref and each figure, field and
        link of a listed subject an F ref: the model never sees a table or column name and never writes
        one. (2) One structured call through <Mono>askForJson()</Mono> on the main model with adaptive
        thinking: the system prompt is two cached blocks (<Mono>SYSTEM</Mono>, then the slice), the answer{' '}
        <Mono>ANSWER_SCHEMA</Mono> (every property required, empty for unset), the user message today at
        the venues, the group&apos;s venue names, for a change the report as it is now in refs with its name
        (<Mono>answerOf()</Mono>) and the requests that made it, then the request. (3){' '}
        <Mono>toSpec()</Mono> makes the definition only through the builder&apos;s edits in{' '}
        <Mono>shared/reports/build.js</Mono>, so it can only be what the builder could have made; a ref
        that doesn&apos;t resolve or fit is left out and said in <Mono>couldnt</Mono>. Venue names are matched
        among the group&apos;s venues (<Mono>matchNames()</Mono>), names in the data (a dish, a server) among
        the report&apos;s own rows (<Mono>findNames()</Mono>, 3 lookups of 500 rows at most). (4) The
        definition goes through <Mono>reportProblems()</Mono> and <Mono>checkedSpec()</Mono>, then{' '}
        <Mono>runReport()</Mono> as the person (200 rows). An answer that can&apos;t be used goes back once with
        the reasons (<Mono>retryText()</Mono>), and a subject listed in a line only once listed in full: two
        calls at most, and a report too slow or too big isn&apos;t asked again. (5){' '}
        <Mono>describeReport()</Mono> (<Mono>shared/reports/describe.js</Mono>) says what the report shows in
        one sentence from the definition, never in the model&apos;s words.
      </P>
      <P>
        Questions: several matches for a name become a question whose choices carry changes,{' '}
        <Mono>{'{ venues: { from, to } }'}</Mono> or <Mono>{'{ filter: { index, from, to } }'}</Mono>, applied by{' '}
        <Mono>applyChange()</Mono> (<Mono>shared/reports/choices.js</Mono>) to the report as it is then and
        run through <Mono>POST /api/reports/preview</Mono>, so answers to two questions add up. The
        model&apos;s own questions (2 at most, 2 to 4 choices) carry no change: the choice goes back to Pepper
        in words. 3 questions at most, 6 notes each for assumed and couldn&apos;t. <Mono>askForJson()</Mono>{' '}
        (<Mono>services/aiJson.js</Mono>) gained <Mono>system</Mono> as a list of cached blocks,{' '}
        <Mono>thinking</Mono> and <Mono>words</Mono> (its messages for a refusal, a request Claude can&apos;t
        take and an answer too long).
      </P>
      <P>
        Admin: <Mono>components/reports/SmartBuild.jsx</Mono>. <Mono>DescribeCard</Mono> sits above the
        subjects on <Mono>/reports/new</Mono> when <Mono>useAiStatus().can_chat</Mono> (the box, examples for
        the areas the role can report on, Add a photo or PDF, Take a photo on a touch screen, Build it with
        the seconds counting). <Mono>SmartAnswer</Mono> shows the requests, the name, What this shows, what
        Pepper assumed and couldn&apos;t do, the questions, the result (<Mono>ResultCard</Mono>), Save it
        (<Mono>SaveWindow</Mono>: name and description filled in, <Mono>POST /api/reports</Mono>, then the
        report replaces the page), Change it, Open in the builder (<Mono>/reports/new?subject=</Mono> with{' '}
        <Mono>state.draft</Mono>; the builder&apos;s Back goes back to the answer), Ask in other words and Start
        again. The answer lives in the page&apos;s own history entry (<Mono>location.state.smart</Mono>, written
        with <Mono>replace</Mono>): a reload and Back keep it, and saving replaces the page so one answer
        can&apos;t be saved twice.
      </P>
      <P>
        Checking it against the live model, by hand before a release (every request is a paid call):{' '}
        <Mono>api/scripts/report-requests.js</Mono> (78 requests the way people type them, in every area the catalogue has, each with what a
        right answer must contain, a few with a change asked afterwards; <Mono>checkAnswer()</Mono>,{' '}
        <Mono>listProblems()</Mono>) and <Mono>api/scripts/report-smart-check.js</Mono> (<Mono>--tenant</Mono>,{' '}
        <Mono>--email</Mono>, <Mono>--platform</Mono>, <Mono>--only</Mono>, <Mono>--area</Mono>,{' '}
        <Mono>--no-changes</Mono>, <Mono>--out</Mono>, <Mono>--list</Mono>: runs them as one person of a group
        through <Mono>smartBuild()</Mono> and prints each miss, the times and the allowance used). Test ids:{' '}
        <Mono>smart-describe</Mono>, <Mono>smart-request</Mono>, <Mono>smart-example</Mono>,{' '}
        <Mono>smart-add-file</Mono>, <Mono>smart-camera</Mono>, <Mono>smart-file</Mono>,{' '}
        <Mono>smart-build</Mono>, <Mono>smart-building</Mono>, <Mono>smart-error</Mono>,{' '}
        <Mono>smart-answer</Mono>, <Mono>smart-card</Mono>, <Mono>smart-name</Mono>, <Mono>smart-about</Mono>,{' '}
        <Mono>smart-assumed</Mono>, <Mono>smart-couldnt</Mono>, <Mono>smart-question</Mono>,{' '}
        <Mono>smart-choice</Mono> (<Mono>data-kind</Mono> change | words), <Mono>smart-save</Mono>,{' '}
        <Mono>smart-change-open</Mono>, <Mono>smart-open-builder</Mono>, <Mono>smart-ask-again</Mono>,{' '}
        <Mono>smart-start-again</Mono>, <Mono>smart-result</Mono>. Tests:{' '}
        <Mono>shared/test/reportChoices.test.mjs</Mono>, <Mono>reportDescribe.test.mjs</Mono>,{' '}
        <Mono>api/test/reports-smart.test.mjs</Mono> (a stand-in Claude: refs only, the role&apos;s subjects
        only, names and questions, the retry, the second ask, a change keeping the name, files, nothing
        fits, refusals; the request list against the catalogue).
      </P>

      <H3>Plans: a report in the catalogue&apos;s own words</H3>
      <P>
        <Mono>api/src/reports/plan.js</Mono>. A plan is the smart builder&apos;s answer written with the
        catalogue&apos;s own paths (<Mono>till.lines</Mono>, <Mono>net_sales</Mono>,{' '}
        <Mono>check.server.name</Mono>) where the answer has refs:{' '}
        <Mono>{'{ subject, list?, by, across, figures, filters, period, venues, sort, top, compare, chart, totals, name }'}</Mono>{' '}
        (<Mono>PLAN</Mono>, a Zod schema that is also the tools&apos; input). A period is relative, from
        and to, or <Mono>{'{ any: true }'}</Mono>: every day, no period, for what is so now whatever the
        day a row is dated (actions still open, the points members hold); left out it is last week, and a
        period named wins over <Mono>any</Mono>. The smart builder&apos;s answer has the same{' '}
        <Mono>period.any</Mono>, and <Mono>answerOf()</Mono> says it of a dated report with no period on
        its day. A figure is named by its place
        (v1, v2, in the order of <Mono>figures</Mono>) in calculations, sorting, a top N and a chart;{' '}
        <Mono>count: true</Mono> is how many rows there are. <Mono>planAnswer()</Mono> makes the answer{' '}
        <Mono>toSpec()</Mono> takes with <Mono>pathSlice()</Mono> (a slice whose refs are paths), so a plan
        becomes a definition only through the builder&apos;s edits, then <Mono>runBuilt()</Mono> (in{' '}
        <Mono>smart.js</Mono>, shared with the smart builder): the checks, names found among the
        group&apos;s venues and in the report&apos;s own rows, a run as the person, what it shows in words.{' '}
        <Mono>planProblems()</Mono> says what in a plan names nothing the role can build with, with the
        near ones (<Mono>unknown</Mono>: subjects, paths, names); nothing runs then.{' '}
        <Mono>planOf(catalogue, spec, venues, name)</Mono> writes a definition back as a plan, with{' '}
        <Mono>kept</Mono>: what a plan can&apos;t say (filters made of several parts, drill-down settings,
        averages of a calculation), kept when a changed plan is applied to that report while it stays about
        the same rows. Every starter written as a plan comes back unchanged (a test).
      </P>
      <P>
        <Mono>POST /api/reports/plan</Mono> (Reports Use) takes{' '}
        <Mono>{'{ plan, report?, rows? }'}</Mono> and answers{' '}
        <Mono>{'{ spec, name, about, assumed, couldnt, questions, result, problem, unknown }'}</Mono>; nothing is
        saved, no model is called, the report&apos;s venues go through <Mono>refuseOtherVenues()</Mono>, and
        the run is recorded only when Pepper asked for it (below).
      </P>

      <H3>Pepper&apos;s report tools</H3>
      <P>
        <Mono>api/src/ai/tools/reports.js</Mono>, section <Mono>reports</Mono> (module{' '}
        <Mono>reports</Mono>): thirteen tools in the chat and on the staff connector. Each goes through the
        report routes as the person with <Mono>callApi()</Mono>, so the role&apos;s subjects, fields and
        venues, the tenant filters and the venue checks are the routes&apos; own; a plan never carries SQL
        or a table name.
      </P>
      <DataTable
        head={['Tool', 'Needs', 'What it does']}
        rows={[
          ['find_fields', 'View', 'The subjects for a topic (rankSubjects(), five at most; the best two with the figures and fields that match), or one subject in full (figures, fields and a folder per link, two links deep), one line each: path | name | kind | what it can be | about.'],
          ['explain_figure', 'View', 'What a figure counts (its catalogue about sentence), how it adds up (a total, a count, how many different, an average, the smallest or largest), a rate\'s two parts, a field\'s choices, the subject a link leads to, personal data.'],
          ['list_reports', 'View', 'The reports the person can open and the starters, with a link each; by words, area, or starred / mine / starters / saved; 30 at most.'],
          ['get_report', 'View', 'One report: what it shows (describeReport()), its choices and their values, whose it is, who can change it, and its plan (planOf()) with kept_when_changed.'],
          ['run_report', 'View', 'A saved report or a starter as it is, or for another period and other venues (POST /:id/run), read back as the page\'s table (tableModel()): 40 rows unless asked, 200 at most.'],
          ['ask_data', 'Use', 'A plan built and run as the person (POST /plan): the rows, what it shows, what was assumed and couldn\'t be done, the questions. Nothing saved.'],
          ['build_report', 'Use, card', 'Saves a plan as the person\'s report (POST /api/reports). The card shows what it shows and its first rows and pins the definition (spec) it was worked out with: Confirm saves exactly that.'],
          ['change_report', 'Use, card', 'A saved report\'s plan, name or description (PUT /:id), one the person may change. The card shows it now and after and pins the report and the definition. With nothing to change it is refused, on the card and in run() (the connector calls run() without a card).'],
          ['copy_report', 'Use, card', 'A copy of a report or a starter as the person\'s own (POST /:id/copy).'],
          ['delete_report', 'Use, card', 'Deletes a saved report the person may delete (DELETE /:id); the card says who loses it.'],
          ['share_report', 'Manage, card', 'Only its owner, some roles (by name; the card pins their ids) or everyone, and offered among the starters or not (PATCH /:id/sharing).'],
          ['report_runs', 'View', 'Past runs (GET /runs): the person\'s own, or everyone\'s with Manage (everyone: true), one report\'s, or kept files only; 20 unless asked, 50 at most; each run\'s what, report, choices, rows, time, by Pepper, failed, and its file with a link to download it from Past runs (only its maker can).'],
          ['export_report', 'Use, card', 'Keeps a CSV or Excel file of a report for the person (POST /:id/files), for the period and venues asked; the card says the choices and how long it is kept, and pins the report and its choices. The answer is a link to Past runs: Pepper never sees the file\'s rows.'],
        ]}
      />
      <P>
        Pepper&apos;s runs: <Mono>run_report</Mono>, <Mono>ask_data</Mono> and the change cards&apos; plans send{' '}
        <Mono>x-maca-via: pepper</Mono> (<Mono>PEPPER_HEADER</Mono> in <Mono>reports/access.js</Mono>), believed
        only beside the internal-call secret (<Mono>viaPepper()</Mono> in <Mono>routes/reports.js</Mono>):
        every in-process call, and every API test request, carries the secret, so the secret alone
        doesn&apos;t mean Pepper, and the header alone isn&apos;t believed, so a browser can&apos;t mark its runs
        as Pepper&apos;s. Such runs are recorded with <Mono>params.via = &apos;pepper&apos;</Mono> and held to{' '}
        <Mono>PEPPER_RUNS_PER_MINUTE</Mono> (20) per person by <Mono>limitPepperRuns()</Mono> (429), counted
        from <Mono>report_runs</Mono>, which every API process writes. The catalogue&apos;s figures carry an{' '}
        <Mono>about</Mono> sentence on what they count (95 of 105), which <Mono>find_fields</Mono> and{' '}
        <Mono>explain_figure</Mono> read. The staff prompt&apos;s Reports paragraph says to use{' '}
        <Mono>ask_data</Mono> for figures over a period rather than adding up other tools&apos; answers, to
        read totals, averages and rates from the rows, and to say the period and what was assumed. The
        refusals name the Reports levels (<Mono>DENIED.reports</Mono> in <Mono>ai/context.js</Mono>); chat
        labels are each tool&apos;s <Mono>activity</Mono> (gathered into <Mono>ACTIVITY</Mono> in{' '}
        <Mono>chat.js</Mono>), Activity labels and details <Mono>ACTION_LABELS</Mono>{' '}
        (<Mono>shared/pepperActions.js</Mono>) and <Mono>changeDetail()</Mono> in{' '}
        <Mono>AiAssistant.jsx</Mono>.
      </P>

      <H3>What the report pages tell Pepper</H3>
      <P>
        <Mono>pages/ReportView.jsx</Mono> calls{' '}
        <Mono>{'usePepperPage({ report: { id, from, to, venue_ids }, label })'}</Mono> (the period from the
        result&apos;s <Mono>meta.period</Mono>, the venues picked when the report asks for venues) and the
        builder (<Mono>Builder</Mono> in <Mono>ReportBuilder.jsx</Mono>){' '}
        <Mono>{'usePepperPage({ report: { id?, subject }, label })'}</Mono>. <Mono>label</Mono> is for the
        drawer&apos;s chip only (About: Reports · Sales by day · 2 Nov to 8 Nov) and is never sent. In{' '}
        <Mono>pageNote()</Mono>, <Mono>reportNote()</Mono> names a report only when the person can open it:
        its name and id come from <Mono>GET /api/reports/:id</Mono> called as them, so another
        person&apos;s private report or another group&apos;s report names nothing; in the builder a subject
        is named only when <Mono>runsFor(subject, levels).runs</Mono>, with levels from{' '}
        <Mono>staffPermissionLevels(ctx, CATALOGUE_MODULES)</Mono>. Then the period in words with its dates
        (<Mono>rangeText()</Mono>) and the venues picked, by name, from the group&apos;s own. A line reads{' '}
        <Mono>{'[Sent from the Reports page (/reports/starter:till_sales_by_day), showing the report "Sales by day" (report_id starter:till_sales_by_day) for 2 to 8 Nov 2026 (2026-11-02 to 2026-11-08) at Zqx Hertford, Zqx Ware.]'}</Mono>;
        in the builder it adds that what is on screen may not be saved yet, or names{' '}
        <Mono>a new report on Checks (subject till.checks)</Mono>. The prompt says &quot;this report&quot;
        and &quot;why is Tuesday low?&quot; mean the report in the line, run with its period and venues.
      </P>
      <P>
        Tests: <Mono>api/test/reports-plan.test.mjs</Mono> (7: a plan made through the builder and run as
        the person with no model call; totals, hidden figures, decimals, the table under a chart; what a
        plan names that isn&apos;t there, with the near ones; names among the group&apos;s venues and the
        report&apos;s rows; a plan applied to a report keeping what a plan can&apos;t say; every starter as a
        plan; who may) and <Mono>api/test/reports-pepper.test.mjs</Mono> (12: the connector&apos;s tool list
        per role; each reading tool; build, change, copy, share and delete on the connector; changes only to
        one&apos;s own reports; the chat card pinning its definition; the report page line; the run limit and
        a browser claiming the mark; another group&apos;s reports, venues and roles).
      </P>

      <H3>Admin pages</H3>
      <P>
        <Mono>pages/Reports.jsx</Mono> (<Mono>/reports</Mono>, Home menu after Dashboards: search, area
        buttons, Starred / Your reports / From your team / Starter reports by area, stars, New report with
        Use) and <Mono>pages/ReportView.jsx</Mono> (<Mono>/reports/:id</Mono>: the period, venues and any
        other choice the report asks for, for this visit only, through <Mono>ParamInputs</Mono>; the
        result with its chart, notes, Refresh; Print; CSV and Excel with Use, for the choices showing; Edit for a report the
        person may change, else Customise with Use; More: Make a copy (<Mono>POST /:id/copy</Mono>, then
        the copy opens), Name and details (<Mono>RenameWindow</Mono>, a <Mono>PUT</Mono> of the name and
        description), Share (<Mono>ShareWindow</Mono>, <Mono>PATCH /:id/sharing</Mono>, with Manage) and
        Delete, which asks first). Components in <Mono>components/reports/</Mono>:{' '}
        <Mono>ResultTable</Mono> (one drawing for list, summary and matrix; sticky headings, first column
        and totals), <Mono>ResultCard</Mono>, <Mono>ReportChart</Mono>, <Mono>PeriodPicker</Mono> (named periods and two dates from{' '}
        <Mono>shared/reports/period.js</Mono>), <Mono>VenuesPicker</Mono>, <Mono>ParamInputs</Mono>,{' '}
        <Mono>ValueInput</Mono>, <Mono>shared.jsx</Mono> (<Mono>StarButton</Mono>, <Mono>reportPath()</Mono>,{' '}
        <Mono>Problems</Mono>, <Mono>retryUnlessRefused</Mono>: the pages&apos; queries don&apos;t try a
        refusal again, so no access or no such report shows at once). Someone with Manage sees other
        people&apos;s private reports under From your team, marked Not shared. The three pages load as
        their own chunks. <Mono>admin/tailwind.config.js</Mono> has a <Mono>touch:</Mono> variant
        (<Mono>:root[data-touch] &amp;</Mono>) beside <Mono>notouch:</Mono>; the builder uses it to keep
        its messages clear of the floating Mobile view button on a phone.
      </P>

      <InfoBox>
        Limits of the builder: no undo; filters made of several parts (<Mono>any</Mono>,{' '}
        <Mono>all</Mono>, <Mono>has</Mono>) are said in words and can be taken off, never made or edited on
        screen; tags aren&apos;t edited; the Data panel walks two links deep (a deeper path a starter uses
        still shows and runs); a top or bottom few ranks by a value that is shown; the question before
        leaving covers the builder&apos;s own Back and View and closing the tab, not the app&apos;s menu or
        the browser&apos;s Back; sharing needs Manage; Save as never carries a starter&apos;s key; the
        values a text filter offers are the 60 most common in the report&apos;s period. Limits of the
        engine: a filter naming a parameter the report doesn&apos;t have is dropped by{' '}
        <Mono>normaliseReport()</Mono> without a word; everything else shows only when the definition gives{' '}
        <Mono>limit.rest_as</Mono>; grouping by a link itself isn&apos;t offered; the kept results are per API
        process (another process reads again), while the two running slots are database locks shared by
        every process; the Bookings list route puts a booking on the
        database&apos;s day while reports use the venue&apos;s (they differ only between midnight and 1am in
        summer time); a named period (Today, Yesterday) is the calendar day at the venues while till
        subjects are dated by their trading day (<Mono>pos_days.business_date</Mono>), so between midnight
        and the trading day&apos;s start tonight&apos;s sales are under Yesterday; platform-wide starters live in
        code, not in a table. Limits of drill-downs: the steps aren&apos;t in the address (a reload goes
        back to the report); a report can&apos;t name another report to open into; levels are the
        report&apos;s own list (the catalogue has no hierarchies); in a summary a tap means the row,
        and the figure tapped only where the report&apos;s figures count different rows; a figure with
        no rule of its own, or one reached through a list of other rows, lists every row; the row for
        everything else can&apos;t be opened; a share of the total in an opened row is of what is on
        the page. Limits of charts: no pie or ring (parts of a whole is a cut bar; a copy of a starter
        made before 13 Nov 2026 that said <Mono>pie</Mono> reads as a table until a chart is picked
        again); never two scales on one plot; colours, titles and scales aren&apos;t set per report
        (no target lines, no forecast, no labels on every mark); with a comparison only a single
        value gets the period before beside it; with two or more groupings one value at a time; 8
        series, 60 rows (400 along a date or time), a heat table 40 across by 60 down, 8 figure
        tiles; a chart isn&apos;t downloaded as a picture (print it, or save the print page as a PDF)
        and isn&apos;t in the CSV or Excel file. Limits of printing: the page has one layout (layout
        templates and PDFs made by the server are phase 4); the paper size and margins are the
        browser&apos;s print window&apos;s; a list prints the rows the page holds (5,000 at most: the
        file has them all); widths are estimates, so a table that only just fits may go on its side
        or into parts with room to spare; sheets are numbered where the browser supports page margin
        boxes (Chromium does); for its 15 minutes the link opens with no login for anyone who has
        it, showing what the person who pressed Print could see then. Limits of the smart builder:
        tested only against a stand-in Claude (run <Mono>report-smart-check.js</Mono> against the live
        model before relying on it); one subject per report with figures from up to three others beside its
        own, as in the builder; names typed for another subject&apos;s filters aren&apos;t looked up; names in the data are
        looked for among the first 500 values of the report&apos;s period; filters made of several parts,
        tags, drill settings and what a row opens aren&apos;t set by Pepper (Open in the builder for those);
        a file is read for what it asks, not checked against your figures. Limits of Pepper&apos;s report
        tools: tested only against a stand-in Claude; one subject per report with figures from up to three
        others beside its own; a plan can&apos;t make filters
        of several parts, tags, drill-down settings or what a row opens (a report that has them keeps them
        when its plan is changed); <Mono>run_report</Mono> changes only the period and the venues (other
        choices go through <Mono>get_report</Mono>&apos;s plan and <Mono>ask_data</Mono>); Pepper reads 200
        rows of a result at most and runs 20 reports a person a minute; the report pages tell Pepper the
        report as saved with the period and venues showing, not changes in the builder that aren&apos;t
        saved or rows opened up.
      </InfoBox>
      <H3>The catalogue&apos;s context: synonyms, instructions, examples (Pepper-first 8A2)</H3>
      <P>
        Any field or measure may carry <Mono>synonyms</Mono> (other words people use: a list),{' '}
        <Mono>instructions</Mono> (a sentence or two on using it right, never how it counts: that is{' '}
        <Mono>about</Mono> and the SQL) and <Mono>examples</Mono> (questions it answers), the{' '}
        <Mono>ai_context</Mono> idea (<Mono>define.js</Mono>); <Mono>build()</Mono> in{' '}
        <Mono>catalogue/index.js</Mono> refuses other shapes at start-up and <Mono>catalogueView()</Mono> passes
        them on (<Mono>context()</Mono>). 54 fields and figures have them (till, bookings, cash, staff, safety,
        online). They are used by the smart builder&apos;s word index (<Mono>subjectDocs()</Mono>: synonyms count
        as a name but not towards a subject&apos;s length) and its slice (<Mono>contextParts()</Mono>: also,
        note, e.g. on the subject&apos;s own lines), by <Mono>searchTree()</Mono> in{' '}
        <Mono>shared/reports/build.js</Mono> (<Mono>dataTree()</Mono> nodes carry them), and by Pepper&apos;s{' '}
        <Mono>find_fields</Mono> (its matcher and its lines) and <Mono>ask_data</Mono>{' '}
        (<Mono>figure_notes</Mono>: the instructions of the figures a plan counts).{' '}
        <Mono>topicCoverage()</Mono> (<Mono>smart.js</Mono>) splits a topic&apos;s words into found and missing;
        a topic none of whose words any subject has gets <Mono>covered: false</Mono> from{' '}
        <Mono>find_fields</Mono> (<Mono>notCovered()</Mono>: the nearest fields by spelling,{' '}
        <Mono>NEAR_LIKENESS</Mono>, or the areas reports cover), and words found nowhere are listed as{' '}
        <Mono>not_found</Mono>. Instructions never name a subject key (the smart builder is shown refs only).
        Tests: <Mono>api/test/reports-context.test.mjs</Mono>; evaluation tasks <Mono>covers_by_slang</Mono> and{' '}
        <Mono>not_in_reports</Mono> (<Mono>api/eval/tasks/reports.mjs</Mono>, <Mono>expect: &apos;answer&apos;</Mono>).
      </P>
      <H3>A group&apos;s own fields in the catalogue (Pepper-first 8B1)</H3>
      <P>
        The catalogue is per request: <Mono>reportPerson()</Mono> reads <Mono>tenantCatalogue(tenantId)</Mono>{' '}
        (<Mono>catalogue/index.js</Mono>), the built-in <Mono>CATALOGUE</Mono> with the group&apos;s own fields
        (<Mono>custom_fields</Mono>, migration 285) added to their objects&apos; subjects as{' '}
        <Mono>cf_&lt;key&gt;</Mono> (<Mono>customCatalogue()</Mono>; SQL from <Mono>fieldSql()</Mono> in{' '}
        <Mono>shared/customFields.js</Mono>, typed, null when a value doesn&apos;t fit). It goes on{' '}
        <Mono>p.catalogue</Mono> and <Mono>ctx.catalogue</Mono>; <Mono>catalogueView(levels, catalogue)</Mono>{' '}
        shows it to the builder and Pepper; <Mono>compileReport()</Mono> reads <Mono>env.catalogue</Mono> for the
        call; <Mono>runReport()</Mono> / <Mono>streamList()</Mono> read it when a run comes without one. Stock on
        hand is the subject <Mono>purchasing.stock</Mono> (work <Mono>stock_on_hand</Mono>, migration 287).
      </P>
    </section>
  )
}
