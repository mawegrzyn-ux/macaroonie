// src/pages/docs/cash-recon.jsx
// The Docs page's "Cash Reconciliation" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'cash-recon'
export const label = 'Cash Reconciliation'
export const order = 140

// ── CASH RECONCILIATION ────────────────────────────
export function Section() {
  return (
    <section id="cash-recon" data-doc="">
      <H2>Cash Reconciliation</H2>
      <P>
        Daily till declaration + weekly reconciliation, per venue (migration 027). Config
        tables (income sources, payment channels, SC sources, expense categories, staff)
        are all drag-reorderable lists scoped by <Mono>venue_id</Mono>; daily figures live
        on <Mono>cash_daily_reports</Mono> + child entry tables; wages are a separate weekly
        cycle.
      </P>
      <H3>Service charge sources — signed Takings/Income effect</H3>
      <P>
        Migration 096. <Mono>cash_sc_sources.takings_effect</Mono> and{' '}
        <Mono>income_effect</Mono> are each <Mono>'none' | 'add' | 'subtract'</Mono> (replacing
        the earlier <Mono>included_in_takings</Mono>/<Mono>included_in_income</Mono>{' '}
        booleans from migrations 033/034, which only supported a fixed direction per flag —
        see the shared <Mono>scEffectAmount(effect, amount)</Mono> helper in{' '}
        <Mono>CashRecon.jsx</Mono>: <Mono>'add'</Mono> → <Mono>+amount</Mono>,{' '}
        <Mono>'subtract'</Mono> → <Mono>-amount</Mono>, <Mono>'none'</Mono> → <Mono>0</Mono>.
      </P>
      <P>
        The variance adjustment for one source is{' '}
        <Mono>scEffectAmount(takings_effect, amount) + scEffectAmount(income_effect,
        amount)</Mono>, summed across all active SC sources — computed identically in{' '}
        <Mono>variance(date)</Mono> (the week spreadsheet grid) and the{' '}
        <Mono>scAdjustment</Mono> useMemo (the day-declaration summary), both in{' '}
        <Mono>CashRecon.jsx</Mono>. There is no server-side duplicate of this math —{' '}
        <Mono>week-detail</Mono> returns raw <Mono>cash_sc_entries</Mono> rows only, the
        frontend computes variance client-side against the loaded{' '}
        <Mono>config.sc_sources</Mono>.
      </P>
      <InfoBox type="info">
        Migration 096's data migration maps the old booleans onto the new columns so every
        existing source computes an IDENTICAL adjustment number before and after:{' '}
        <Mono>included_in_takings = true</Mono> → <Mono>takings_effect = 'add'</Mono>;{' '}
        <Mono>included_in_income = true</Mono> → <Mono>income_effect = 'subtract'</Mono>. This
        looks asymmetric (why does "income" default to subtract, not add?) because the OLD
        hardcoded formula was itself asymmetric — see migration 034's comment table. The new
        model has no such asymmetry: both effects use the same <Mono>add</Mono>/{' '}
        <Mono>subtract</Mono> vocabulary and either can go either way per source.
      </InfoBox>
      <H3>Variance sign (migration 097 fix)</H3>
      <P>
        Variance is <Mono>Takings − (Income + scAdjustment)</Mono> — actual minus expected, the
        standard reconciliation convention. Positive means a surplus (took in more than
        declared), negative means a shortfall (took in less). This is computed independently
        in three places that must stay in sync: <Mono>variance(date)</Mono> in{' '}
        <Mono>SpreadsheetView</Mono> (week grid), the day-view's <Mono>const variance</Mono>,
        and <Mono>WeekView</Mono>'s 7-day cards, which now reads the{' '}
        <Mono>variance</Mono> field the <Mono>GET /:venueId/cash-recon/week/:week_start</Mono>{' '}
        route already returns (<Mono>total_takings − total_income</Mono>) instead of
        recomputing its own.
      </P>
      <InfoBox type="warn">
        Before migration 097 the formula was inverted (<Mono>Income − Takings</Mono>) in all
        three places — a surplus showed as negative and a shortfall as positive. The amber/red
        colour thresholds (<Mono>variance &gt; 0</Mono> → amber, <Mono>&lt; 0</Mono> → red)
        were left unchanged; flipping the underlying number's sign alone was enough to make
        them read correctly (shortfall → red, surplus → amber).
      </InfoBox>
      <H3>Variance with till payouts (supersedes the formula above)</H3>
      <P>
        Staff pay the day's expenses and the week's cash wages out of the till before counting,
        so counted cash is what is banked and is already short by those payouts. Variance adds
        them back. Day: <Mono>Takings + cash expenses + cash wages paid that day − (Income +
        scAdjustment)</Mono>. Week: sum of day variances <Mono>+ weekUnassignedWages()</Mono>{' '}
        (cash wages with no <Mono>paid_date</Mono>, or one outside the visible days).
        <Mono>cash_wage_entries.paid_date</Mono> (migration 112) is the day a wage came out of
        the till; <Mono>GET .../week-detail</Mono> returns <Mono>wages_cash_by_date</Mono>{' '}
        (<Mono>reconCalc().dayWages()</Mono>), <Mono>GET .../week</Mono> returns each day's{' '}
        <Mono>wages_cash</Mono> and <Mono>wages.unassigned_cash_wages</Mono> (wages on a day
        with no daily report count as unassigned there, since that route only has variances for
        reported days). The day view reads the same week-detail query. Paid date is validated to
        the week (422 otherwise) on the whole-list <Mono>PUT /wages/:week_start</Mono>, the only
        wage write route since migration 137 (the per-entry <Mono>/paid</Mono> and{' '}
        <Mono>/paid-date</Mono> PATCHes and wage submit/unsubmit were removed).{' '}
        <Mono>PaidDaySelect</Mono> is exported from <Mono>CashRecon.jsx</Mono> and used by{' '}
        <Mono>WeekWagesEditor</Mono>; rota fill-wages never touches <Mono>paid_date</Mono>.
        Implemented
        once in <Mono>reconCalc()</Mono> (<Mono>variance(date)</Mono>,{' '}
        <Mono>weekVariance()</Mono>), mirrored by the day view's <Mono>const variance</Mono>{' '}
        and by the <Mono>GET .../week/:week_start</Mono> route's per-day <Mono>variance</Mono>{' '}
        (used by <Mono>WeekView</Mono> and <Mono>MobileCashUp.jsx</Mono>, which adds{' '}
        <Mono>wages.unassigned_cash_wages</Mono> for its week figure). That route now computes each
        total in its own subquery with the same filters as <Mono>reconCalc()</Mono> (active
        sources/channels, <Mono>exclude_from_recon</Mono> income left out, SC effects,{' '}
        <Mono>!paid_by_card</Mono> expenses); the old version joined income and takings entries
        together and summed, which multiplied both totals whenever a day had more than one row
        of each. Net Cash and Cash to bank were removed: the grid, the day view and the
        dashboard balance widgets end at the variance.
      </P>
      <H3>Net Cash / Cash to bank — cash-only channels (removed)</H3>
      <P>
        <Mono>cash_payment_channels.counts_as_cash</Mono> (migration 097, boolean, default{' '}
        <Mono>true</Mono> only where <Mono>type = 'cash'</Mono>) flags which Takings channels
        actually become physical cash in the till. <Mono>Net Cash</Mono> and the week-grid's
        final row (relabelled <Mono>Cash to bank</Mono>, was "Net Position") sum only channels
        where <Mono>counts_as_cash !== false</Mono> — see <Mono>cashChannels</Mono> /{' '}
        <Mono>cashTakingsTotal(date)</Mono> in <Mono>CashRecon.jsx</Mono>.{' '}
        <Mono>Total Takings</Mono> and <Mono>Variance</Mono> are unaffected and still sum every
        active channel regardless of the flag — only the two cash-specific rows are filtered. A
        "Non-cash" badge renders next to any such channel in both the week-grid row label and
        the day-view Takings list.
      </P>
      <H3>Wages schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['cash_staff', 'Per-venue staff list with a default_rate, pay_type (hourly | fixed, migration 104), and since migration 106 role_id (staff_roles) and pay_basis (week | day | shift, used by fixed staff). default_rate is £/hr for hourly, £ per week/day/shift for fixed. pay_type seeds entry_type when the person is added to a week. CRUD and reorder moved to /api/rota/venues/:venueId/staff* (see Staff & Rota); GET /cash-recon/config still returns the rows.'],
          ['cash_wage_reports', 'One per venue per ISO week (week_start) plus notes. status / submitted_at were dropped in migration 137: wages are never submitted or locked (days are).'],
          ['cash_wage_entries', 'One per staff member per report. total is the full wage cost; bank_amount (migration 140) is the part paid by bank transfer; cash_amount is the cash actually handed over. Cash due = total − bank_amount. A part-paid row (cash_amount > 0 and cash_amount + bank_amount < total) carries total − bank_amount − cash_amount into next week\'s rota pay (carried_owed, see Staff & Rota). Only cash_amount counts in Cash Recon variance. The whole-list PUT keeps an entry\'s id when the client sends one that was already in that week (anything else gets a new id).'],
          ['cash_wage_defaults', "(migration 093) tenant_id, venue_id, staff_id, entry_type, sort_order — UNIQUE(venue_id, staff_id). The venue's saved default staff list for 'Set as default'; entries without a staff_id (ad-hoc) are never included since there's no stable identity to carry over week to week."],
        ]}
      />
      <H3>WeekWagesEditor (one wages editor)</H3>
      <P>
        <Mono>components/cashRecon/WagesTable.jsx</Mono> exports <Mono>WeekWagesEditor</Mono>{' '}
        (<Mono>{'{ venueId, weekStart, defaultPaidDay, showWeekNotes, layout }'}</Mono>), used by
        the Cash Recon Wages page (<Mono>WagesView</Mono>), both Cash Dashboard wage widgets
        (<Mono>cash_wages_paid</Mono> and <Mono>cash_week_staff</Mono> render the same editor,
        with <Mono>defaultPaidDay = ctx.selectedDay</Mono>) and <Mono>MobileWages.jsx</Mono>{' '}
        (<Mono>layout="cards"</Mono>). Columns: Name, Total, Paid (<Mono>cash_amount</Mono>, with a
        Full button), Paid on, Notes. Pay type, hours and rate are not shown: <Mono>toRow()</Mono>{' '}
        / <Mono>toPayload()</Mono> carry them through unchanged, except that typing a Total sets{' '}
        <Mono>entry_type = 'fixed'</Mono> and clears hours/rate. Edits live in a local draft
        (reset when venue or week changes) and are written by Save with the whole-list PUT;
        Discard drops them. A payment defaults its <Mono>paid_date</Mono> to{' '}
        <Mono>defaultPaidDay</Mono>, else today when it is in the week; a row with no cash paid
        is sent with <Mono>paid_date: null</Mono>. Set as default posts each staff member's own{' '}
        <Mono>cash_staff.pay_type</Mono> as the entry_type (types aren't edited here). Layout is
        a table row per person from 640px of its own width (<Mono>ResizeObserver</Mono>), cards
        below. Save invalidates the wages, week, week-detail and <Mono>rota-pay</Mono> queries
        (a part-paid row changes next week's rota pay).
      </P>
      <H3>Filling a week's wage entries</H3>
      <P>
        <Mono>CashRecon.jsx</Mono> exports the one implementation used by{' '}
        <Mono>WagesView</Mono>, <Mono>MobileWages.jsx</Mono> and the Cash Dashboard's{' '}
        <Mono>cash_week_staff</Mono> widget: <Mono>wageEntryForStaff(staff, entryType)</Mono>{' '}
        (hourly puts <Mono>default_rate</Mono> in <Mono>rate</Mono>, fixed puts it in{' '}
        <Mono>total</Mono>; <Mono>entryType</Mono> defaults to the staff member's{' '}
        <Mono>pay_type</Mono>), <Mono>defaultWageEntries(config, weekStart)</Mono> (the{' '}
        <Mono>wage_defaults</Mono> list with its own entry_type, else every active staff member
        by pay_type; both leave out people whose <Mono>left_on</Mono> is before{' '}
        <Mono>weekStart</Mono>, via <Mono>leftBeforeWeek()</Mono>, which the Add person list uses
        too), plus <Mono>PAY_TYPES</Mono> and <Mono>staffRateLabel()</Mono>. Change how a
        new week is filled there, not in a page.
      </P>
      <H3>Cash-only net balance</H3>
      <P>
        Both wage-total queries in <Mono>cashRecon.js</Mono> (<Mono>week-detail</Mono> and{' '}
        <Mono>week</Mono> routes) select <Mono>SUM(total)</Mono> AND{' '}
        <Mono>SUM(cash_amount)</Mono> side by side. The frontend's net-position calculations
        (<Mono>weekNetPosition()</Mono> in <Mono>SpreadsheetView</Mono>, the Wages card in{' '}
        <Mono>WeekView</Mono>) subtract only the cash-amount sum. Wherever wages are shown,
        an <Mono>AlertTriangle</Mono> flag appears when the two sums don't match.
      </P>
      <P>
        <Mono>POST /:venueId/cash-recon/wages/:week_start/set-default</Mono> replaces the
        venue's <Mono>cash_wage_defaults</Mono> rows from the current week's entries
        (staff_id + entry_type only, filtering out entries with no staff_id). The wages{' '}
        <Mono>GET /config</Mono> response includes the resolved default list (joined with
        staff name/rate) as <Mono>wage_defaults</Mono>; the frontend's auto-populate{' '}
        <Mono>useEffect</Mono> falls through defaults → full active-staff roster → empty, in
        that order, whenever a week has no saved entries yet.
      </P>
      <InfoBox type="warn">
        A resolved <Mono>null</Mono> from a TanStack Query is not the same as{' '}
        <Mono>undefined</Mono>. <Mono>GET .../wages/:week_start</Mono> returns{' '}
        <Mono>null</Mono> (not 404) when no wage report exists yet for that week — a guard
        like <Mono>if (!wagesData || !config) return</Mono> treats that confirmed-empty{' '}
        <Mono>null</Mono> the same as "still loading" (<Mono>undefined</Mono>), so a
        brand-new week never reached the auto-populate branch. Check{' '}
        <Mono>wagesData === undefined</Mono> specifically when a query's success value can
        legitimately be <Mono>null</Mono>.
      </InfoBox>
      <H3>Expense VAT amount (migration 099)</H3>
      <P>
        <Mono>cash_expenses.vat_amount</Mono> (numeric, default 0) is a second figure
        alongside the existing <Mono>amount</Mono> — purely informational. <Mono>amount</Mono>{' '}
        is, and remains, the gross (VAT-inclusive) figure every reconciliation calculation
        already uses (<Mono>total_expenses</Mono>, <Mono>Net Cash</Mono>/<Mono>Cash to
        bank</Mono>); <Mono>vat_amount</Mono> is never added to or subtracted from anything —
        it's recorded purely so the VAT portion is available for bookkeeping. All three
        write paths accept it identically: the whole-day <Mono>PUT /daily/:date</Mono> (via{' '}
        <Mono>ExpenseEntrySchema</Mono>), and the individual{' '}
        <Mono>POST /:venueId/cash-recon/expenses</Mono> /{' '}
        <Mono>PUT /:venueId/cash-recon/expenses/:expenseId</Mono> routes. Shown as a small
        "VAT £x" line under the gross amount wherever an expense is listed, and as a second
        "VAT amount" input next to "Gross amount" in both the add/edit forms
        (<Mono>CashRecon.jsx</Mono>'s <Mono>ExpensesSection</Mono> and{' '}
        <Mono>MobileExpenses.jsx</Mono>'s <Mono>ExpenseModal</Mono>).
      </P>
      <H3>Reading a receipt (migration 197)</H3>
      <P>
        The expense forms (<Mono>ExpensesSection</Mono> in <Mono>CashRecon.jsx</Mono>,{' '}
        <Mono>ExpenseModal</Mono> in <Mono>MobileExpenses.jsx</Mono>) show{' '}
        <Mono>ReadReceiptButton</Mono> (<Mono>components/cashRecon/ReceiptRead.jsx</Mono>) when Pepper
        can be used: the photo or PDF goes to <Mono>POST /api/ai/receipts/read</Mono>{' '}
        (<Mono>services/receiptReadAi.js</Mono>, effort low, the venue's active expense category names
        sent along), which returns the form's fields; <Mono>applyReceipt()</Mono> lays them over the form
        and the photo becomes the pending receipt (uploaded by the usual receipt route on save). VAT is
        kept only when printed and not above the total; a category only when Pepper names one of the
        venue's exactly. <Mono>ReceiptNote</Mono> says when the receipt has another date; the phone
        form can create the expense on that day (<Mono>onSave(body, photo, date)</Mono>). Nothing is saved
        by reading.
      </P>
      <H3>Expense paid by card (migration 100)</H3>
      <P>
        <Mono>cash_expenses.paid_by_card</Mono> (boolean, default false) marks an expense
        paid by card instead of from the till. Card-paid rows are still stored in full
        (receipt, VAT, category) but are excluded from every cash figure: the week-detail
        route's per-day <Mono>total_expenses</Mono> now sums only{' '}
        <Mono>!paid_by_card</Mono> rows and returns the card sum separately as{' '}
        <Mono>total_card_expenses</Mono>. Because <Mono>SpreadsheetView</Mono>'s{' '}
        <Mono>dayExpenses()</Mono> reads <Mono>total_expenses</Mono>, the variance drops card
        expenses with no further change. The day view's{' '}
        <Mono>totalExpenses</Mono> memo filters the same way client-side, and so does{' '}
        <Mono>MobileExpenses.jsx</Mono>'s day total. All three write paths accept the flag
        (<Mono>ExpenseEntrySchema</Mono> for the whole-day PUT, plus the individual POST/PUT
        expense routes). Shared UI lives in <Mono>CashRecon.jsx</Mono>:{' '}
        <Mono>PaidByCardToggle</Mono> (form checkbox) and <Mono>CardBadge</Mono> (list tag),
        both reused by the mobile page. Card totals are shown as a separate "Paid by card
        (not in recon)" line in the day summary, the week grid and the mobile day total.
      </P>
      <P>
        <strong>Expenses on a submitted day.</strong> Adding (<Mono>POST .../expenses</Mono>) and
        the whole-day PUT already refused a submitted report; changing and deleting one expense
        didn&apos;t, so a submitted day&apos;s figures could move after sign-off.{' '}
        <Mono>assertExpenseOpen()</Mono> in <Mono>cashRecon.js</Mono> (the expense must be the
        venue&apos;s and its report not submitted, else 404 / 422 "unsubmit first") now runs
        before <Mono>PUT</Mono> and <Mono>DELETE .../expenses/:expenseId</Mono>. A receipt can
        still be added or removed on a submitted day (it changes no figure).
      </P>
      <H3>Admin theming — SectionCard</H3>
      <P>
        <Mono>SectionCard</Mono> (used by every Cash Recon section — Income, Service
        Charges &amp; Tips, Takings, Wages, Expenses) has a coloured <Mono>header</Mono> bar
        using the <Mono>--site-accent</Mono> CSS variable (see <Mono>/api/me:
        site_theme</Mono> in the Navigation &amp; Launcher section). The optional{' '}
        <Mono>footer</Mono> prop (the "Total ..." row in each daily-declaration section) is
        deliberately plain (<Mono>bg-muted/30</Mono>, no accent) — an earlier version
        coloured it to match the header, but two accent bars per card (top and bottom) read
        as too heavy/repetitive for a running total; header-only is the current design.
      </P>
      <InfoBox type="warn">
        <Mono>SectionCard</Mono>'s own <Mono>mb-4</Mono> margin was removed — spacing between
        stacked cards on the daily-declaration page now comes entirely from{' '}
        <Mono>space-y-4</Mono> on the page's outer wrapper (it had been{' '}
        <Mono>space-y-0</Mono>, relying on each card's own margin, which visually produced
        zero gap between a section's footer and the next section's header — colour-matched
        accent bars touching directly with no visible seam). Two sources of spacing for the
        same layout (a component's own margin + a parent's <Mono>space-y</Mono>) is exactly
        the kind of thing that looks fine until one of the two silently stops applying —
        pick one mechanism per layout and keep spacing there, not split across both.
      </InfoBox>
      <H3>Fields filled by other systems</H3>
      <P>
        <Mono>GET /api/venues/:venueId/cash-recon/links</Mono> (Cash Recon view) returns,
        from <Mono>reconLinks()</Mono> in <Mono>services/reconLinks.js</Mono>,{' '}
        <Mono>{'{ sources: [{ key, label, where, note, fields }], fields: { "income:<id>": [{ source, label, terms: [{ label, sign }] }] } }'}</Mono>.
        Groups are <Mono>income</Mono>, <Mono>takings</Mono> (payment channels) and{' '}
        <Mono>sc</Mono>, the same keys every filler maps by. <Mono>LINK_SOURCES</Mono> holds one
        entry per system: <Mono>pos</Mono> (<Mono>pos_settings.recon_map</Mono>, revenue
        streams and tenders by name, set in Store tech, <Mono>where.route</Mono>),{' '}
        <Mono>loyverse</Mono> and <Mono>gloriafood</Mono> (<Mono>*_venue_links.mappings</Mono>,
        worded by each one's <Mono>termLabel()</Mono>, <Mono>where.tab</Mono>). A system not set
        up at the venue is left out; a field nothing fills has no entry. The settings tabs
        (<Mono>useReconLinks()</Mono>, <Mono>LinkedFrom</Mono>, <Mono>LinkedSystems</Mono> in{' '}
        <Mono>CashRecon.jsx</Mono>) read it on every visit, since the Loyverse and GloriaFood
        tabs change it. A new system that fills Cash Recon through <Mono>fillReconDay()</Mono>{' '}
        adds its entry to <Mono>LINK_SOURCES</Mono>; the tabs show it with no other change.
      </P>
      <H3>Loyverse (migration 154)</H3>
      <P>
        Fills a day's income, SC and takings rows from the venue's Loyverse POS sales. Two
        tables: <Mono>loyverse_connections</Mono> (a tenant's Loyverse account: an access token
        stored as typed and never returned by any route, <Mono>token_hint</Mono> = last 4,
        business name / currency from <Mono>GET /merchant</Mono>, <Mono>last_error</Mono> when
        Loyverse rejects it) and <Mono>loyverse_venue_links</Mono> (one per venue: connection,
        <Mono>store_id</Mono>, <Mono>day_starts_at</Mono> HH:MM, <Mono>mappings</Mono> jsonb).
        <Mono>cash_daily_reports.loyverse_filled_at</Mono> / <Mono>loyverse_filled_by</Mono>{' '}
        record the last fill; <Mono>GET .../week-detail/:week</Mono> returns them (and
        GloriaFood's) per day as <Mono>days[date].filled</Mono>{' '}
        <Mono>{'{ loyverse, gloriafood }'}</Mono>, each <Mono>{'{ at, by }'}</Mono> or null,
        for the dashboard's import widget (<Mono>cash_import</Mono>, migration 212).
      </P>
      <P>
        Mapping: <Mono>{'{ income: { sourceId: [term] }, takings: { channelId: [term] }, sc: { sourceId: [term] } }'}</Mono>,
        term <Mono>{'{ sign: 1 | -1, kind, ref?, label? }'}</Mono>. A field's value is the signed
        sum of its terms; a field with no terms is never written. All figure maths is in{' '}
        <Mono>shared/loyverse.js</Mono> (<Mono>summariseReceipts()</Mono>, <Mono>sumTerms()</Mono>,{' '}
        <Mono>termLabel()</Mono>, <Mono>TOTAL_KINDS</Mono>, <Mono>REF_KINDS</Mono>), in pence.
      </P>
      <DataTable
        head={['kind', 'Value for a trading day']}
        rows={[
          ['gross_sales', 'Sum of line gross_total_money on SALE receipts.'],
          ['refunds', 'Sum of line gross_total_money on REFUND receipts (positive).'],
          ['discounts / taxes / tips / surcharges', 'Receipt total_discount / total_tax / tip / surcharge: sales minus refunds.'],
          ['net_sales', 'gross_sales - refunds - discounts (the Loyverse sales summary definition).'],
          ['total_collected', 'Receipt total_money: sales minus refunds.'],
          ['item (ref = item_id)', 'Line total_money (after discounts) for that item: sales minus refunds.'],
          ['category (ref = category_id)', 'Same, for every item whose category is ref (item to category from GET /items, only read when a mapping uses a category).'],
          ['payment_type (ref = payment_type_id)', 'payments[].money_amount for that type: sales minus refunds.'],
        ]}
      />
      <P>
        Receipts: <Mono>services/loyverseSvc.js</Mono> <Mono>venueDays()</Mono> reads{' '}
        <Mono>GET /receipts?store_id=&amp;created_at_min=&amp;created_at_max=</Mono> once for the
        whole run of days (cursor paging, 250 a page), with <Mono>created_at_max</Mono> two days past
        the last day so receipts a till synced late are found, then places each receipt by{' '}
        <Mono>receipt_date</Mono> in a trading day: <Mono>[day_starts_at on the date,
        day_starts_at the next day)</Mono> in the venue time zone (<Mono>tradingDay()</Mono>, via{' '}
        <Mono>zonedToUtc()</Mono>). Cancelled receipts (<Mono>cancelled_at</Mono>) are left out;
        refunds count on the day they were refunded; refund amounts are taken as positive
        whichever way they are signed. Base URL <Mono>LOYVERSE_API_URL</Mono> (default{' '}
        <Mono>https://api.loyverse.com/v1.0</Mono>, changed only for tests). Loyverse failures become
        a 422 with a plain message (<Mono>LoyverseError</Mono>); a rejected token also sets the
        connection's <Mono>last_error</Mono>.
      </P>
      <DataTable
        head={['Route (/api/loyverse)', 'Access', 'What it does']}
        rows={[
          ['GET /connections', 'cash_recon view', 'Accounts without tokens, with venue_count.'],
          ['POST /connections, PATCH /connections/:id', 'owner/admin + cash_recon manage', 'Add / rename / replace token. A new token is checked with GET /merchant first and refused if Loyverse rejects it.'],
          ['POST /connections/:id/test, DELETE /connections/:id', 'owner/admin + manage', 'Check the saved token (sets last_error); remove the account and its venue links.'],
          ['GET /connections/:id/catalog', 'owner/admin + manage', 'Stores, payment types, categories, items (deleted ones left out) for the mapping editor.'],
          ['GET /venues/:venueId/link', 'cash_recon view', 'The link and mapping, or null (also decides whether Fill buttons show).'],
          ['PUT /venues/:venueId/link', 'owner/admin + manage', 'Store must be on the account (checked with Loyverse); mapping keeps only this venue\'s active fields and valid terms.'],
          ['DELETE /venues/:venueId/link', 'owner/admin + manage', 'Unlink.'],
          ['POST /venues/:venueId/preview', 'cash_recon view', 'from/to (31 days max): per day the Loyverse value and current Cash Recon value of each mapped field, totals, payments with a mapped flag, status.'],
          ['POST /venues/:venueId/apply', 'cash_recon manage', 'dates[]: reads Loyverse again (never takes figures from the browser), then per day creates the report if needed, skips submitted days, replaces only each mapped field\'s entry (keeping its notes; income VAT split by the source\'s rate as the day view does) and sets loyverse_filled_*.'],
        ]}
      />
      <P>
        Income, takings and SC entry amounts may be negative (a day where refunds beat sales);
        the day PUT's Zod schemas no longer have <Mono>min(0)</Mono>, and the day view's amount
        input has no <Mono>min</Mono>. Expenses and wages stay at 0 or more. Admin:{' '}
        <Mono>components/cashRecon/Loyverse.jsx</Mono> (<Mono>LoyverseSettings</Mono> as the
        Loyverse tab of Cash Recon settings, <Mono>LoyverseFillButton</Mono> /{' '}
        <Mono>LoyverseFillModal</Mono> on the day view (body row in <Mono>hideHeader</Mono> mode for{' '}
        <Mono>/mobile/cash-up</Mono>), the week grid and the week cards). After a fill the modal
        invalidates <Mono>cash-recon-daily</Mono>, <Mono>cash-recon-week-detail</Mono> and{' '}
        <Mono>cash-recon-week</Mono>; the grid clears its local overrides.
      </P>
      <InfoBox type="warn">
        The Loyverse API was built from its documented v1.0 shape and tested against a stand-in
        server, not a live Loyverse account. Check the first real fill against the Loyverse
        Back Office sales summary for the same day and store.
      </InfoBox>
      <H3>GloriaFood (migration 159)</H3>
      <P>
        Stores the venue&apos;s accepted GloriaFood online orders, fills a day&apos;s income, SC and
        takings rows from them like Loyverse, and can show them on the Online orders board.
        GloriaFood&apos;s Accepted Orders API v2 only hands an order over when it is accepted (push to
        our URL, or a pop that returns each order once), so every order is stored on arrival in{' '}
        <Mono>gloriafood_orders</Mono> (upserted by <Mono>(tenant_id, gf_order_id)</Mono>; an older{' '}
        <Mono>updated_at</Mono> never overwrites a newer one; money in pence; dishes in{' '}
        <Mono>items</Mono> for the board; <Mono>payload</Mono> is the order as sent minus guest
        details). <Mono>gloriafood_venue_links</Mono> is one per venue: <Mono>method</Mono> push |
        poll, <Mono>push_token</Mono> (24 random bytes, the URL&apos;s only check, never in the link
        view), <Mono>poll_key</Mono> (never returned, <Mono>poll_key_hint</Mono>), the restaurant
        learned from the first order (<Mono>gf_restaurant_id</Mono>; other restaurants&apos; orders
        are refused with <Mono>last_error</Mono>), <Mono>day_basis</Mono> fulfill | accepted,{' '}
        <Mono>day_starts_at</Mono>, <Mono>show_on_board</Mono>, <Mono>mappings</Mono> (Loyverse&apos;s
        shape). Filled days record <Mono>cash_daily_reports.gloriafood_filled_at</Mono> /{' '}
        <Mono>_by</Mono> through <Mono>fillReconDay()</Mono>.
      </P>
      <P>
        <Mono>shared/gloriafood.js</Mono>: <Mono>orderFromPayload()</Mono> (items = type item rows;
        discounts = item_discount of promo_cart / promo_item / promo_cart_item rows, so children are not
        counted twice; delivery, tip, service fees net of cash_discount; checked against both GloriaFood
        sample orders: items - discounts = sub_total_price), <Mono>summariseOrders()</Mono> (only{' '}
        <Mono>status = &apos;accepted&apos;</Mono>, never <Mono>source = &apos;admin&apos;</Mono> test
        orders; counts cancelled and split payments), <Mono>sumTerms()</Mono>. Figures: total,
        net_total, subtotal, items, discounts, delivery_fees, tips, service_fees, tax; refs payment
        (GloriaFood&apos;s <Mono>payment</Mono>: ONLINE, CASH, CARD, CARD_PHONE or others) and order_type.
        An order paid two ways (<Mono>used_payment_methods</Mono> has 2) counts under{' '}
        <Mono>payment</Mono>: GloriaFood doesn&apos;t send the split amounts.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['POST /webhooks/gloriafood/:token', 'gloriafoodWebhookRoutes (root, no auth, 240/min per token). Looks the venue up by push_token, takes { count, orders }, an array or one order, ingests, answers { ok, stored, updated, refused }. XML or text: 415 and last_error says to switch the integration to JSON. Unknown token: 404.'],
          ['services/gloriafoodSvc.js', 'popOrders(key) (POST {GLORIAFOOD_API_URL}/pos/order/pop, Authorization = key, Glf-Api-Version 2; 401/403 = key problem), ingestWithTx() (locks the link row, learns / checks the restaurant, upserts, sets last_order_at / last_error), pollVenue() (pop and store in one transaction under pg_try_advisory_xact_lock per link; orders popped but not stored are written to the log), pollAll() (every poll venue, then clears client_name / phone / address older than 30 days), venueDays() (trading-day windows from tradingDay(), by fulfill_at or accepted_at), boardOrders() / boardOrder().'],
          ['jobs/queues.js', 'gloriafood-poll queue, repeat every 60 s, worker started in server.js (every API process; one run per tick).'],
          ['GET|PUT|DELETE /api/gloriafood/venues/:venueId/link', 'View (no token or key), save (owner/admin + cash_recon manage; a new poll key is checked by polling with it, waiting orders are stored, a rejected key restores the old one or removes a new link), unlink (orders kept).'],
          ['GET .../push-url, POST .../push-url/new, POST .../restaurant/reset, POST .../poll', 'The address (setup only), a new token, forget the learned restaurant, check GloriaFood now (cash_recon manage, poll venues only).'],
          ['GET .../orders, GET .../seen', 'Latest stored orders (view), payment methods and order types known plus seen (setup).'],
          ['POST .../preview, POST .../apply', 'As Loyverse (31 days max). Preview polls a poll venue first (poll_error on failure, never thrown) and returns values[key].source; apply works only from stored orders, skips submitted days, keeps notes.'],
          ['Board', 'GET /api/orders appends boardOrders() (status accepted or canceled, fulfill_at on the board day in venue time) when show_on_board, sorted by promised_at, and returns gloriafood.show_on_board. For a day before today (venue time) it passes includeImported, so imported orders come too, with imported: true, import_file / import_line and is_asap false. POST /api/orders/gloriafood/:id/status { to: accepted | preparing | ready | completed } (web_orders manage) changes board_status only; a cancelled or imported order is 422. Broadcasts order.created / order.updated with source gloriafood.'],
          ['GET .../day?date=YYYY-MM-DD', 'dayOrders(): every stored order (any status, live or imported) whose fulfill_at or accepted_at (link day_basis) falls in that trading day (tradingDay() with day_starts_at, as venueDays()), up to 2,000, ordered by time. Returns { date, timezone, day_basis, day_starts_at, currency, figures, orders }: figures from summariseOrders() (orders, cancelled, test_orders, not_counted, total / subtotal / tips / delivery / service fees / tax in pence, payments and types with counts), so they match the fill preview; each order has its pence columns, status_label, counts (countsInRecon()), labels, used_payment_labels, received_via, imported + import_file / import_line and its dishes. No guest details or notes. cash_recon view; 422 when the venue isn\'t linked.'],
        ]}
      />
      <P>
        Admin: <Mono>components/cashRecon/GloriaFood.jsx</Mono> (<Mono>GloriaFoodSettings</Mono> = the
        GloriaFood tab of Cash Recon settings, <Mono>GloriaFoodFillButton</Mono> next to every Loyverse
        button). The mapping editor and the fill window are shared with Loyverse in{' '}
        <Mono>components/cashRecon/reconShared.jsx</Mono> (<Mono>MappingGroups</Mono>,{' '}
        <Mono>ReconFillModal</Mono> with a <Mono>source</Mono> config, <Mono>TermChip</Mono>,{' '}
        <Mono>useReconLinkPerms()</Mono>). Board: <Mono>isGloriaFood()</Mono>,{' '}
        <Mono>GloriaFoodBadge</Mono>, <Mono>ImportedBadge</Mono>, <Mono>GloriaFoodOrderModal</Mono> (imported
        orders: a note, no guest block, print or status buttons) and the <Mono>gfStatus</Mono> action in{' '}
        <Mono>components/orders/shared.jsx</Mono>; on a past day the board opens Done by itself, and its
        order count leaves out <Mono>is_test</Mono> orders. A day&apos;s orders:{' '}
        <Mono>GloriaFoodOrdersButton</Mono> (day view header, and the button strip of the header-less day view
        in <Mono>/mobile/cash-up</Mono>; shown whenever the venue has a link, also on submitted days and to
        cash_recon view) opens <Mono>GloriaFoodDayOrders</Mono>: day arrows, figure tiles, payments, one
        expandable row per order (<Mono>DayOrderRow</Mono>).
      </P>
      <InfoBox type="warn">
        Built from GloriaFood&apos;s published Accepted Orders API v2 and its two sample orders, and
        tested against a stand-in server, not a live GloriaFood restaurant. Check the first real
        orders (amounts, payment, fulfil time) against GloriaFood&apos;s own order list, and that the
        integration accepts our address.
      </InfoBox>
      <H3>GloriaFood: importing past orders (migration 162)</H3>
      <P>
        The API has no history, so days before the link come from the order list GloriaFood&apos;s
        admin exports. Imported orders go into <Mono>gloriafood_orders</Mono> with{' '}
        <Mono>received_via = &apos;import&apos;</Mono> (migration 162 widens the CHECK) and{' '}
        <Mono>board_status = &apos;completed&apos;</Mono>, no <Mono>items</Mono> and a{' '}
        <Mono>payload</Mono> of only <Mono>{'{ imported: { file, line } }'}</Mono>, so{' '}
        <Mono>venueDays()</Mono> / <Mono>summariseOrders()</Mono> fill Cash Recon from them unchanged.
        They are left out of today&apos;s board (<Mono>boardOrders()</Mono> takes them only with{' '}
        <Mono>includeImported</Mono>, for past days, view only), the settings tab&apos;s latest orders and its
        Orders received count; <Mono>GET .../day</Mono> lists them with the live ones.{' '}
        <Mono>gloriafood_venue_links.last_import_at</Mono> /{' '}
        <Mono>_by</Mono> / <Mono>_file</Mono> record the last import.
      </P>
      <P>
        <Mono>shared/gloriafood.js</Mono>: <Mono>IMPORT_COLUMNS</Mono> (key, header, need: required |
        date | recommended | optional, heading aliases), <Mono>matchImportColumns()</Mono> (headings
        matched by <Mono>importHeading()</Mono>: lower case, letters and digits only; order doesn&apos;t
        matter; required = Order ID, Outcome, Total plus a Fulfillment or Confirmed date + time pair),{' '}
        <Mono>importOrderFromRow()</Mono> (amounts with or without £ and thousands commas; dates
        YYYY-MM-DD or DD/MM/YYYY; times with or without AM/PM; an id in Excel&apos;s 1.25E+09 form is a
        row problem; service fees = on subtotal + on total - cash discounts; the day is the fulfilment
        time, else confirmed, else placed; <Mono>accepted_at</Mono> = confirmed),{' '}
        <Mono>importMissingFigures()</Mono> (items and discounts are never in the export). Guest
        columns are never read.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['importExport(tx, { tenantId, venueId, timezone, cells, fileName, apply, by })', 'Needs a link (locked FOR UPDATE when applying). Finds the header row, refuses a file missing a needed column (422 naming them) or over 50,000 rows, converts local times with zonedToUtc() in the venue time zone, last row wins for a repeated id. Each order is new, update (already imported for this venue), live (sent by push / poll: never touched), after_live (at or after the earliest push / poll order: left out so nothing counts twice) or other_venue (the id belongs to another venue: left out). Returns counts, the accepted total by payment and type, mapping_gaps (mapped figures the file lacks), not_in_file and the first 50 problems with row numbers. With apply, upserts in batches of 500; ON CONFLICT updates only rows still received_via import.'],
          ['ingestWithTx()', 'A pushed or polled copy of an imported order replaces it and switches received_via to push / poll.'],
          ['GET /api/gloriafood/venues/:venueId/import', 'Imported count and date range plus the last import (cash_recon view).'],
          ['POST .../import { file_name, data (base64), apply }', 'Preview (apply false, writes nothing) or import. CSV or .xlsx up to 16 MB, read by readFile() from routes/deliveroo.js. Owner/admin + cash_recon manage.'],
          ['DELETE .../import', 'Removes the venue\'s imported orders only (owner/admin + cash_recon manage).'],
          ['GET /api/gloriafood/import-template', 'A CSV with every IMPORT_COLUMNS heading (cash_recon view).'],
          ['POST .../preview', 'Also returns imported { count, from, to }, so the fill window doesn\'t claim no orders exist when only imported ones do.'],
        ]}
      />
      <P>
        Admin: <Mono>ImportPastOrders</Mono> in <Mono>components/cashRecon/GloriaFood.jsx</Mono>, below
        the mapping on the GloriaFood tab: columns it needs, Template, choose file, preview, Import,
        Remove imported orders (inline confirm). <Mono>checkImportReply()</Mono> turns a reply without
        <Mono>counts</Mono> / <Mono>summary</Mono> (an HTML page from a proxy, an empty body) into an error in the
        card, and a file the browser can&apos;t read (cloud placeholder, aborted read) says so; both are also
        logged to the console.
      </P>
      <InfoBox type="warn">
        Built from one real export (478 orders, all read). It assumes the export&apos;s Order ID is the
        id the API sends; if it isn&apos;t, the live cutoff still stops imported and live orders
        overlapping, except for orders a poll venue&apos;s queue still holds from before the import.
      </InfoBox>
      <H3>Day PUT and the week grid</H3>
      <P>
        <Mono>PUT /:venueId/cash-recon/daily/:date</Mono> only changes the day note when the body
        has a <Mono>notes</Mono> key: the week grid saves a day without loading its note and used to
        wipe it. The grid now also sends each expense's <Mono>vat_amount</Mono> and{' '}
        <Mono>paid_by_card</Mono> (they were reset to 0 / false on every grid save).{' '}
        <Mono>GET .../week-detail/:week_start</Mono> uses <Mono>openDatesOrNull()</Mono>, so a venue
        with no booking schedule shows every day (it showed none).
      </P>
      <H3>Submitting once a week (migration 259)</H3>
      <P>
        <Mono>cash_venue_settings.submit_mode</Mono> <Mono>daily | weekly</Mono> over the per-day status, which
        stays the store. <Mono>PATCH .../cash-recon/settings</Mono> takes any of the venue settings, a field left out
        kept (COALESCE). Weekly: <Mono>POST .../daily/:date/submit</Mono> answers 422.{' '}
        <Mono>POST .../week/:week_start/submit</Mono> (Use, every mode) runs <Mono>submitWeek()</Mono>: one
        transaction, the week&apos;s days up to the venue&apos;s today, a draft submitted, a day with no report
        made and submitted only with <Mono>allow_bulk_submit</Mono> and an open day (<Mono>openDatesOrNull()</Mono>);
        422 when nothing is left. <Mono>POST .../week/:week_start/unsubmit</Mono> (owner / admin + Manage).{' '}
        <Mono>GET .../week/:week_start</Mono> returns <Mono>submit_mode</Mono>. Admin: <Mono>WeekSubmitButton</Mono>{' '}
        (exported from <Mono>CashRecon.jsx</Mono>; the grid flushes its unsaved cells first), on the grid, the week
        cards and <Mono>MobileCashUp</Mono>; <Mono>DayView</Mono> passes <Mono>weekly</Mono> and{' '}
        <Mono>canSubmit</Mono> false. Today feed (<Mono>cash</Mono> source): a day with a report is done; task{' '}
        <Mono>cash_week:&lt;monday&gt;</Mono> for last week&apos;s drafts from the Monday, late from the Tuesday.
        Pepper: <Mono>submit_cash_week</Mono>; <Mono>submit_cash_day</Mono> refuses at a weekly venue.
      </P>
      <H3>Retrieve and the scheduled fill (migration 260)</H3>
      <P>
        <Mono>services/reconRetrieve.js</Mono>: <Mono>RETRIEVE_SOURCES</Mono> (Loyverse, GloriaFood),{' '}
        <Mono>linkedSources()</Mono>, <Mono>retrieveDays()</Mono> (each linked system&apos;s own fill,{' '}
        <Mono>applyLoyverseDays()</Mono> / <Mono>applyGloriaFoodDays()</Mono> exported from their routes; one
        failing doesn&apos;t stop the other; over several days <Mono>onlyWithSales</Mono> leaves out days with no
        sales and days after the venue&apos;s today, as the preview leaves them unticked).{' '}
        <Mono>GET / POST .../cash-recon/retrieve</Mono> (View / Use). Settings: <Mono>retrieve_skip_preview</Mono>,{' '}
        <Mono>auto_fill</Mono>, <Mono>auto_fill_at</Mono> (venue time), and the last
        run (<Mono>auto_fill_ran_at</Mono>, <Mono>auto_fill_result</Mono>, <Mono>auto_fill_error</Mono>).{' '}
        <Mono>sweepAutoFill()</Mono> (worker <Mono>cash-autofill</Mono>, every five minutes) claims each venue&apos;s
        day with one UPDATE of <Mono>auto_fill_last_on</Mono> and fills <Mono>autoFillDates()</Mono>: the day just
        ended and two before, with <Mono>keepHandEdits</Mono>.
      </P>
      <P>
        <Mono>cash_fill_values</Mono> (forced RLS, one row per report and field) holds the amount each fill last
        wrote: <Mono>fillReconDay()</Mono> writes it on every fill (the till&apos;s Z too) and, with{' '}
        <Mono>keepHandEdits</Mono>, skips a field where <Mono>changedByHand(current, lastFilled)</Mono>: not empty
        or zero and not what the last fill wrote (zero counts as empty: the day view saves untouched fields as 0).
        Admin: <Mono>components/cashRecon/Retrieve.jsx</Mono> (<Mono>RetrieveButton</Mono> in place of the two fill
        buttons: each system&apos;s window in turn, or straight away with a result panel;{' '}
        <Mono>RetrieveSettings</Mono> in Settings → General).
      </P>
    </section>
  )
}
