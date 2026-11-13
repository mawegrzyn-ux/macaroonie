# Report builder: plan

**Status: the plan, with phase 0 and the first two parts of phase 1 built: the engine, the catalogue for till sales, online orders and bookings and a viewer (migration 243), then the builder (13 Nov 2026).** Written 12 Nov 2026 against the schema at migration 241. The eight decisions in section 22 were answered on 12 Nov 2026: every recommended answer was accepted. What is built, how it differs from this plan and what comes next are in `CLAUDE.md` (Outstanding item 41) and the admin's Docs page (Reports (report builder)); the rest of this file is the plan as written.

The ask (12 Nov 2026): "i need AI and traditional report builder. All data from all modules available to the tool. tradiotional interface with automatic data linked accross tables (relations), ability to build reports with drilldowns, smart builder where user enter in prompt report reqs. Ability to configure report template. Basic charts, printing templates. etc. Scheduling and manual. Export of report as API, CSV, other formats. full pepper toolkit"

Contents

1. [Summary](#1-summary)
2. [What was asked, and where it is covered](#2-what-was-asked-and-where-it-is-covered)
3. [What is there today](#3-what-is-there-today)
4. [The shape: one engine, two builders](#4-the-shape-one-engine-two-builders)
5. [The data catalogue](#5-the-data-catalogue)
6. [The report definition](#6-the-report-definition)
7. [The query engine](#7-the-query-engine)
8. [Drill-downs](#8-drill-downs)
9. [The traditional builder](#9-the-traditional-builder)
10. [The smart builder (AI)](#10-the-smart-builder-ai)
11. [Templates](#11-templates)
12. [Charts](#12-charts)
13. [Printing and PDF](#13-printing-and-pdf)
14. [Running: by hand and on a schedule](#14-running-by-hand-and-on-a-schedule)
15. [Export and the report API](#15-export-and-the-report-api)
16. [Pepper toolkit](#16-pepper-toolkit)
17. [Access, privacy and safety](#17-access-privacy-and-safety)
18. [New tables, routes and files](#18-new-tables-routes-and-files)
19. [Tests](#19-tests)
20. [Phases](#20-phases)
21. [Risks](#21-risks)
22. [Decisions needed](#22-decisions-needed)
- [Appendix A: every table and what happens to it](#appendix-a-every-table-and-what-happens-to-it)
- [Appendix B: starter reports](#appendix-b-starter-reports)

---

## 1. Summary

- **One engine, two ways in.** The traditional builder and the AI builder both produce the same thing: a report definition (a small JSON document). The server checks it and turns it into SQL. Nobody, person or model, ever writes SQL. That is what makes the AI builder safe, and it means a report Pepper made can be opened and changed by hand.
- **A data catalogue sits between reports and the database.** People pick from named subjects (Sales lines, Bookings, Purchase orders) and named fields, not from 226 tables. The catalogue knows how subjects link to each other, so picking a field from a linked subject just works. A test fails when a table has no catalogue decision, so "all data from all modules" stays true as the schema grows.
- **Figures that have rules in code are not worked out again in SQL.** Rota pay and tips, cash variance, H&S status and the till's day figures each have one implementation today. Reports read stored results of those same functions.
- **Reports run as the person looking at them.** Each subject belongs to a permission module; fields can need a further permission (supplier prices, pay, tips, guest contact details). Row-level security stays on for every query.
- **Biggest pieces of work**: the catalogue (curating about 140 subjects from 226 tables), the query engine (joins that can't double-count), and the builder screen. The AI builder is small once those exist.
- **Phases 0 to 6**, each shippable. Phase 1 gives a working builder for till sales, online orders and bookings with tables, charts, drill-downs, CSV and Excel. See [Phases](#20-phases).
- **Eight decisions are needed from you** before building. See [Decisions needed](#22-decisions-needed).

## 2. What was asked, and where it is covered

| Asked for | Where | Phase |
|---|---|---|
| AI and traditional report builder | Sections 9 and 10, on one engine (section 4) | 1 and 2 |
| All data from all modules | The catalogue (section 5), the inventory (Appendix A) | 1 for the core, 3 for the rest |
| Data linked across tables automatically | Relations in the catalogue (5.3), the engine's joins (7.1) | 1 |
| Drill-downs | Section 8 | 1 |
| Smart builder from a prompt | Section 10 | 2 |
| Configure report templates | Section 11 (starting-point templates and layout templates) | 1 and 4 |
| Basic charts | Section 12 | 1 |
| Printing templates | Sections 11 and 13 | 4 |
| Scheduled and manual runs | Section 14 | 1 (manual), 4 (scheduled) |
| Export as API, CSV, other formats | Section 15 | 1 (CSV, Excel), 4 (PDF), 5 (API) |
| Full Pepper toolkit | Section 16 | 2, growing with each phase |

## 3. What is there today

Counted from a database migrated to 241.

| Fact | Number |
|---|---|
| Tables | 226 |
| Tables with a tenant | 215 (the other 11: the table of groups itself, nine platform-wide tables and one child table) |
| Tables with a venue | 110 |
| Declared links between tables (foreign keys) | 541 |
| Links that are not declared (an id column with no foreign key) | 35 |
| Columns | 2,759 |
| JSON columns | 117 |
| Date-and-time columns | 446, plus 32 date columns |
| Permission modules | 44, in 18 groups |

Things the plan has to work with:

- **The most important link in sales reporting is not declared.** A till line points at its dish by `pos_check_lines.item_id` with no foreign key, and so does an online order line (`order_items.menu_item_id`). This is on purpose: saving a menu deletes and re-inserts its dishes. Only 5 foreign keys point at `menu_items`. The catalogue has to carry these links itself, and cope with a dish that is no longer on the menu (the line keeps its own copy of the name).
- **Money is stored three ways.** Whole pence in columns named `*_pence` (orders, loyalty, menus: 39 columns in 17 tables). Whole pence in plain integer columns (the till: `pos_checks.total`, `pos_check_lines.net`, `pos_payments.amount` and 15 more, in 5 tables). Pounds with decimals (cash reconciliation, rota, purchasing, deposits: 32 columns in 21 tables).
- **Dates are stored several ways.** The till has trading days (`pos_days.business_date`). Online orders have `service_date`. Bookings have a moment in time (`starts_at`) that has to be turned into the venue's local day. Cash reconciliation, the rota and food safety each have their own date column. Each venue has its own time zone.
- **Some figures have their rules in code, in one place each.** `computeRotaWeek()` (hours, pay, tips), `reconCalc()` and the `/week` route (cash variance), `dayFigures()` (the till's day), `computeHsStatus()` (checks expected, done, unresolved), `onlineTransactions()` (online sales and their tenders). CLAUDE.md's Common mistakes section is full of bugs caused by a second copy of one of these.
- **The till is event sourced.** `pos_events` is the record; `pos_checks`, `pos_check_lines` and `pos_payments` are kept up to date from it. Report figures come from those three, never from replaying events. The events are offered only as an activity list (who did what, on which till, and who approved it), read a trading day at a time, without their contents.
- **Fixed reports already exist**: Till reports (days, checks, X and Z), the kitchen report, the online orders report and transactions, kiosk analytics, the cash reconciliation week grid, rota pay and tips, the loyalty members CSV. Each has its own route and its own screen.
- **Pieces to build on**: `xlsx` is already a dependency of the API. `sendEmail()` takes attachments. BullMQ runs seven queues, and local info has a claim-and-lease pattern for scheduled work. `askForJson()` gives structured answers from Pepper with the usage checks built in. Pepper's tool registry has sections, permissions per section and confirm cards. Dashboards have a widget catalogue. Brand & theme gives colours and fonts.
- **Pieces that are missing**: the admin has no chart library. The only PDF writer is `pdfDoc.js` (151 lines, Helvetica only, used for purchase orders). There is no way to keep a private file: `storageSvc` on the local driver puts files under `/uploads`, which anyone with the address can read. No server-side headless browser.
- **Limits to respect**: the API runs as a PM2 cluster on one Lightsail machine with Postgres and Redis beside it, each API process restarted at 512 MB and holding up to 20 database connections. The admin's main bundle is 5.18 MB against a 6 MiB limit that fails the deploy when crossed.

## 4. The shape: one engine, two builders

```
 Traditional builder            Smart builder (Pepper)         Pepper tools / MCP
 (pick fields, drag, set)       (describe it in words)         (run, build, schedule)
          \                            |                              /
           \                           v                             /
            +----------------> Report definition (JSON) <-----------+
                                       |
                              checked by one function
                              (shared/reports/spec.js)
                                       |
                                       v
        Catalogue  ------------>  Query engine  ---------->  Postgres
        (subjects, fields,        (definition to SQL,        (as the person's tenant,
         links, measures,          joins that can't           read only, time limit,
         who may see what)         double-count)              row-level security on)
                                       |
                                       v
                                    Result
              +-----------+-----------+-----------+-----------+
              |           |           |           |           |
           On screen    Print      CSV, Excel,  Scheduled   Report API,
           (table,      and PDF    JSON         email       dashboards
            chart,
            drill)
```

Rules that follow from this shape:

1. **The definition is the only way in.** Every screen, tool and schedule goes through `normaliseReport()`, the same function on the server, in the admin and for Pepper's answers. This is the pattern `normaliseDesign()` (kiosks) and `normaliseTillLayout()` (till layouts) already follow.
2. **Names in SQL come only from the catalogue.** Table and column names are never taken from a request. Values are always parameters.
3. **One renderer per output.** Tables, charts and pages are drawn by shared code used on screen, on paper and in emails. The codebase's most repeated bug is two renderers drifting apart (the page builder canvas against the live site).

## 5. The data catalogue

### 5.1 Why not show the tables

- 117 JSON columns, 35 undeclared links and three ways of storing money would land on the person building a report.
- Secrets sit in ordinary columns (sealed keys, token hashes, PIN hashes, manage links).
- Figures such as pay, tips and variance are not in any column.
- A model given 2,759 column names guesses. Given 30 well-named fields with descriptions, it picks.

### 5.2 What the catalogue holds

Code, not database rows: one file per area in `api/src/reports/catalogue/`, reviewed and tested like the rest. A sketch of one subject:

```js
// api/src/reports/catalogue/till.js
export const salesLines = subject({
  key: 'till.lines',
  label: 'Sales lines (till)',
  about: 'One row for each dish on a till check. Use it for what sold, to whom, when and for how much.',
  words: 'sales items dishes sold product mix pmix',
  module: 'pos_reports',                 // who may see it at all
  from: 'pos_check_lines',
  key_column: 'id',
  venue: 'venue_id',
  date: { via: 'day', column: 'business_date', kind: 'local_date' },   // the trading day
  open: null,                            // lines open their check
  fields: {
    name:     text('name', 'Dish (as sold)'),
    qty:      number('qty', 'Quantity', { sum: true }),
    gross:    money('gross', 'Gross', { unit: 'pence' }),
    discount: money('discount', 'Discount', { unit: 'pence' }),
    net:      money('net', 'Net sales', { unit: 'pence' }),
    vat:      money('vat', 'VAT', { unit: 'pence' }),
    vat_rate: percent('vat_rate', 'VAT rate'),
    status:   choice('status', 'Status', { new: 'Not sent', sent: 'Sent', voided: 'Voided' }),
    seat:     number('seat', 'Seat'),
    sent_at:  moment('sent_at', 'Sent to the kitchen'),
    void_reason: text('void_reason', 'Void reason'),
  },
  measures: {
    net_sales: sum('net', { where: "status <> 'voided'", label: 'Net sales' }),
    items_sold: sum('qty', { where: "status <> 'voided'", label: 'Items sold' }),
    voided_value: sum('gross', { where: "status = 'voided'", label: 'Voided value' }),
  },
  links: {
    check:   one('till.checks', 'check_id'),                         // declared
    day:     one('till.days', 'day_id', { soft: true }),             // no foreign key
    dish:    one('menu.dishes', 'item_id', { soft: true, missing: 'No longer on the menu' }),
    section: one('menu.sections', 'section_id', { soft: true }),
    stream:  one('till.streams', 'revenue_stream_id', { soft: true }),
    course:  one('till.courses', 'course_id', { soft: true }),
    added_by:  one('staff.people', 'added_by', { label: 'Added by' }),
    voided_by: one('staff.people', 'voided_by', { label: 'Voided by' }),
  },
})
```

The parts:

| Part | What it is |
|---|---|
| Subject | A kind of row a report can be about: a sales line, a booking, a purchase order line, a fridge reading. Has a label, a plain description, search words, the module that owns it, its venue column and its report date. |
| Field | A named value with a type (text, number, money, percent, date, moment, time, duration, yes/no, choice). Carries how to show it, whether it can be summed, and flags: personal data, or needs a further permission. |
| Measure | A named total with its rule written once: Net sales, Covers, Hours worked. Reports use measures so that "net sales" means the same thing everywhere. |
| Link | How one subject reaches another. `one` is a lookup (a line has one check); `many` is the reverse (a check has many lines). |
| Shared dimension | A subject that many others link to, so different subjects can be laid side by side: Venue, Calendar, Staff, Dish, Section, Customer, Supplier, Order type, Revenue stream. |
| Hierarchy | An order to drill through: Year, Quarter, Month, Week, Day, Hour. Menu, Section, Dish. Supplier, Product. |

### 5.3 Automatic links

This is the "data linked across tables" part of the ask.

- **A generator reads the database.** `node api/scripts/report-catalogue.js` reads `information_schema` and writes a draft: every table, column, type and the 541 foreign keys as links. People then curate: names, descriptions, what to leave out.
- **Undeclared links are written by hand, once.** The 35 id columns with no foreign key (`pos_check_lines.item_id`, `pos_checks.server_id`, `order_items.menu_item_id`, `pos_payments.staff_id` and the rest) get a `soft: true` link. A test lists every `*_id` uuid column that has neither a foreign key nor a catalogue link, so a new one cannot be missed.
- **The builder offers what can be reached.** From Sales lines the field list shows the line's own fields, then "Check", "Dish", "Section", "Venue", "Trading day", "Added by" and so on, each opening to its own fields. Picking `Venue: Name` adds the two hops (line to check to venue) without the person seeing a join.
- **Two ways to the same place are named, not guessed.** A line links to Staff twice (added by, voided by). Each link has its own label, and the definition stores which was picked.
- **Links can need care a foreign key would not show.** Whoever took a till order is a staff member or, for a kiosk order, the kiosk itself. The catalogue's "Taken by" link looks in both, as Till reports do; a plain join to staff would show every kiosk sale as unknown.
- **Hubs.** 114 foreign keys point at `venues` and 10 at `cash_staff` (plus the till's undeclared staff ids). These, with the calendar, are what let sales, labour, bookings and purchasing sit in one report.

### 5.4 Figures with their rules in code

Rota pay cannot be a SQL sum: it depends on shift rates, pay basis, overrides, adjustments, carried amounts and tip pots, all in `computeRotaWeek()`. Writing that again in SQL would be a second copy of the rule.

Instead these become **stored results**: small tables written by the existing functions, read by reports like any other subject.

| Stored result | One row per | Written by | Refreshed |
|---|---|---|---|
| `rpt_rota_staff_week` | venue, week, person | `computeRotaWeek()` | when the week's rota, pay or tips change; nightly check |
| `rpt_rota_staff_day` | venue, day, person | the same run (hours and pay per day) | the same |
| `rpt_cash_day` | venue, day | the cash reconciliation rule, moved to `shared/` first | when the day or the week's wages change |
| `rpt_hs_day` | venue, day, kind of check | `computeHsStatus()` | when a check is logged; nightly for past days |
| `rpt_till_day` | venue, trading day | `dayFigures()`: stored on `pos_days.figures` at the Z, worked out live for the open day | at the Z |

Each row carries when it was worked out. A report that reads one says so ("Pay figures as at 12 Nov 14:02"). When a report asks for a period whose stored result is stale, the engine refreshes it first if that is a handful of weeks, and otherwise runs with what it has and says which periods are being brought up to date.

One piece of groundwork comes out of this: **the cash variance rule lives in the admin today** (`reconCalc()` in `CashRecon.jsx`), mirrored by hand in the `/week` route. It moves to `shared/` so the server, the screens and reports use one copy.

### 5.5 Money, time and trading days

- **Money.** Each money field says how it is stored (`pence` or `pounds`). The engine turns everything into pounds with two decimals in results. A venue has a currency; a report across venues with different currencies shows a total per currency and no grand total.
- **Report date.** Each subject names the date that reports group it by: the trading day for till subjects, `service_date` for online orders, the venue-local day of `starts_at` for bookings, `report_date` for cash, `work_date` for the rota, the delivery day for purchase orders. "Last week" then means the same seven days in every subject.
- **Moments.** A date-and-time field is shown in its row's venue's time zone, whatever the viewer's.
- **Weeks** run Monday to Sunday, as everywhere else in the app.
- **Calendar.** A generated subject (date, weekday, week, month, quarter, year) that every dated subject links to. Local info hangs off it too, so "sales against the weather" is an ordinary two-subject report.

### 5.6 Every table gets a decision

A test compares the database with the catalogue and fails when a table is in neither the catalogue nor the left-out list. Each left-out entry needs a reason. New columns on a known table are listed as "not offered yet" in the test's output without failing it, so adding a column does not block a deploy, and a count shows how many are waiting.

A first pass over all 226 tables (the full list is Appendix A):

| Kind | Tables | What it means |
|---|---|---|
| Things that happen | 64 | Rows with a date: sales, bookings, checks, deliveries. What reports count and sum. |
| Things to group by | 73 | Names, people, places, categories. |
| Settings | 46 | A few named fields offered (a venue's booking rules), the rest left out. |
| Left out | 43 | Secrets, tokens, layout JSON, internal state, platform tables. |

### 5.7 When the catalogue changes

Saved reports name fields by their catalogue key, so the catalogue is a promise.

- A label or description can change freely. A key cannot: renaming one keeps the old key as an alias.
- A field that is taken away is not dropped from saved reports in silence. The report opens with "This report used Tip pot, which no longer exists", and its schedules pause until someone looks.
- A test loads every starter report against the current catalogue.

## 6. The report definition

A report is a JSON document stored in `reports.spec`. An example: net sales by dish, last week, top 20, as a bar chart, with drill-downs.

```json
{
  "version": 1,
  "subject": "till.lines",
  "params": [
    { "key": "period", "type": "period", "default": { "relative": "last_week" } },
    { "key": "venues", "type": "venues", "default": "all" }
  ],
  "rows": [ { "field": "section.name" }, { "field": "name" } ],
  "columns": [],
  "values": [
    { "measure": "items_sold" },
    { "measure": "net_sales" },
    { "calc": "net_sales / total(net_sales)", "label": "Share of sales", "format": "percent" }
  ],
  "filters": [
    { "field": "date", "op": "in_period", "param": "period" },
    { "field": "venue", "op": "in", "param": "venues" }
  ],
  "sort": [ { "by": "net_sales", "dir": "desc" } ],
  "limit": { "top": 20, "rest_as": "Everything else" },
  "totals": { "grand": true, "subtotals": [ "section.name" ] },
  "compare": { "with": "previous_period" },
  "drill": {
    "down": [ "section.name", "name" ],
    "rows": [ "check.number", "check.opened_at", "name", "qty", "net", "added_by.name" ],
    "open": "check"
  },
  "view": { "kind": "bar", "x": "name", "y": [ "net_sales" ], "table_below": true }
}
```

`date` and `venue` in the filters are the subject's own report date and venue, whichever columns hold them (5.5).

What a definition can say:

| Part | Choices |
|---|---|
| Kind of report | List (one row per record), Summary (grouped, with subtotals), Matrix (rows against columns), Chart, Figures (big numbers), Page (several of these in order, for printing) |
| Fields | From the subject and anything reachable through lookups |
| Values | Measures from the catalogue; sums, averages, counts, smallest, largest of a field; calculations |
| Filters | Is, is not, one of, contains, greater or less, between, empty; grouped with all-of or any-of; "has a related row where" (checks that include a given dish) |
| Period | Today, yesterday, this or last week, month, quarter, year; to date; last N days; a chosen range. Kept relative, so a saved report always means "last week" |
| Parameters | Asked when the report is run: venues, period, any filter marked "ask each time" |
| Compare | Previous period, same period last year: adds a change column |
| Calculations | A small formula language: `+ - * /`, `round`, `if`, `total()`, `running()`, `rank()`, `change()`. Parsed and checked, never passed to the database as text |
| Sort and limit | By any value; top or bottom N with the rest rolled into one row |
| Drill | Which levels to drill through, which columns to show for the underlying rows, what a row opens |
| Look | Table settings, chart type and axes, number formats, the print template |

Two or more subjects in one report (sales and labour by week) are written as a list of blocks that share their grouping. See 7.1.

## 7. The query engine

### 7.1 From definition to SQL

1. **Check.** `normaliseReport()` drops anything it does not know. Then every field is looked up in the catalogue as the person. A column they may not see is left out with a note; a filter or grouping on one stops the run, with its name (section 17).
2. **Plan the joins.** Each field's path of links becomes joins. Only lookups (many-to-one) are joined directly.
3. **Never double-count.** The classic report bug: join checks to lines to payments and every figure is multiplied. The engine's rule:
   - Grouping fields and filters come from the subject and its lookups.
   - A figure from a "many" link (lines per check, payments per check) is added up in its own sub-query first, then joined.
   - Two subjects in one report (sales and hours) are each grouped on their shared dimensions (week, venue) in separate queries, then matched on those. They are never joined row to row.
4. **Tenant and venue.** Every table in the query gets `tenant_id = $1` itself, and the whole query runs inside `withTenant()`, so row-level security is a second lock. Tables with no tenant column (`table_combination_members`) are only reachable through their parent.
5. **Dates.** Periods become ranges in each venue's local time. Grouping by hour, day, week, month and weekday is done after converting to the venue's zone.
6. **Calculations.** Row calculations go in before grouping, summary calculations after (as window functions where needed). Division by nothing gives an empty cell, not an error.

### 7.2 Running safely

| Guard | Setting |
|---|---|
| Read only | The transaction is set read only before the query |
| Time limit | 20 seconds on screen, 120 seconds for exports and schedules |
| Rows | 5,000 shown on screen (totals are still over everything); 250,000 in a CSV; 100,000 in Excel |
| Cost check | The database's own estimate is read first; a query far over the line is refused with "narrow the dates, or schedule it" |
| Its own connections | A small separate pool (4), so a heavy report cannot use up the connections the tills and bookings need |
| Its own process | Exports, PDFs and scheduled runs happen in a worker process, not in the API processes that serve tills and bookings |
| Per group | At most 2 runs at once per restaurant group, the rest wait |
| Cache | A result is kept for a minute, keyed by the definition, its parameters and who is asking |

If volumes grow past what one machine reads comfortably, the next steps in order are: indexes on each subject's venue and report date; nightly roll-up tables for the biggest subjects (sales by day and dish) that the engine uses when a report needs no more detail than they hold; a read replica.

## 8. Drill-downs

Three kinds, all from the same definition.

1. **Down a level.** Tap a row or a bar: the report runs again with that value fixed and the next level as its grouping. Sales by section, tap Mains, sales by dish in Mains, tap Pad Thai, sales of Pad Thai by day. A trail at the top (All, Mains, Pad Thai) steps back up. Levels come from the catalogue's hierarchies or from the definition's own `drill.down`.
2. **To the rows behind a figure.** Tap any number, then "Show the rows": the records that make it up, with the same filters. Net sales on Friday at Ware becomes the list of checks; a check becomes its lines. Each subject has a default set of columns for this.
3. **To the record in the app.** A row can open the thing itself: the check in Till reports, the booking in its drawer, the purchase order on its page. Only offered when the person can open that page.

A report can also name another report as its drill target, passing values across (a group summary that opens a venue's detail report).

Drill-downs work in charts (tap a bar) and tables (tap a row or cell), with 48 px targets, and never depend on hover.

## 9. The traditional builder

Pages: **Reports** (`/reports`: mine, shared with me, starter reports, scheduled, past runs; reports can be starred and tagged), a report's own page (`/reports/:id`), and the builder (`/reports/:id/edit`). Loaded as their own chunks so the admin's main bundle does not grow.

Starting a report offers three ways: **Describe it** (section 10), **Start from a starter report**, **Build it yourself**.

The builder at tablet width:

```
+--------------------------------------------------------------------------------+
| < Reports   Sales by dish                       [Run] [Save] [Save as] [More]  |
+----------------------+------------------------------------+--------------------+
| DATA                 |  Period: Last week   Venues: All   | SET UP             |
| [search fields     ] |                                    |                    |
|                      |  +------------------------------+  | Rows               |
| Sales lines (till)   |  |        chart or table        |  |  Section           |
|   Dish (as sold)     |  |      (real data, live)       |  |  Dish (as sold)    |
|   Quantity           |  |                              |  | Columns            |
|   Net sales          |  +------------------------------+  |  (none)            |
|   ...                |                                    | Values             |
| > Check              |  Section   Dish        Sold   Net  |  Items sold        |
| > Dish               |  Mains     Pad Thai     212  2,544 |  Net sales         |
| > Section            |  Mains     Green curry  171  2,137 |  Share of sales    |
| > Venue              |  ...                               | Filters            |
| > Trading day        |                                    |  Period, Venues    |
| > Added by           |  20 of 143 rows · 0.4 s · just now | Sort · Top 20      |
| + Add another subject|                                    | Chart · Drill · Look|
+----------------------+------------------------------------+--------------------+
```

- **Data panel.** Search across every field the person may see. The subject's fields first, then each linked subject as a folder. Tap a field to add it, or drag it onto a shelf (pointer and touch sensors, as in the other designers).
- **Shelves.** Rows, Columns, Values, Filters. Each entry opens its own settings: label, format, how to total, sort.
- **Preview.** Real data, capped, re-run after each change with a short pause. Shows rows, time taken and how fresh the data is.
- **Linked data, explained.** Each field from a linked subject has a "How this is linked" line in plain words (Sales line, its check, the check's venue). Where two links exist, a choice.
- **Guard rails in the screen.** A field that would double-count is offered as a count or a total instead. Subjects that cannot sit side by side say which shared dimensions they lack.
- **Explicit Save**, Save as, a leave guard, and View-only for people who can run but not build. No autosave.
- **Phone**: a viewer at `/mobile/reports` (run, change the period and venues, drill, share). Building stays on a tablet or desktop.

## 10. The smart builder (AI)

The person types what they need. Pepper answers with a working report, not with advice.

**What the person sees**

1. A box: "Describe the report you need", with examples ("Net sales by dish for last month at Ware, top 20", "Labour cost as a share of sales by week this quarter, per venue", "Fridge checks missed by day last month"). A file can be attached: a photo or PDF of a report they already use, to be rebuilt.
2. Pepper's answer: the report itself with real data; **What this shows** in one sentence; **What I assumed** (net of discounts, voids left out, last month is October); **What I couldn't do** (profit margin: Macaroonie holds no recipe costs); and up to three questions with choices when the request could mean two things.
3. Three buttons: **Save it**, **Change it** (a box for "add quantity", "only weekends", "split by venue"), **Open in the builder**.

**What happens underneath**

1. **Find the relevant slice of the catalogue.** A word index over subjects, fields and their descriptions (the way `helpIndex.js` indexes the Help page), limited to what the person may see. The best 6 to 10 subjects go to the model with their fields, measures and links, each field under a short reference (F1, F2).
2. **One structured call.** `askForJson()` with the report definition as its schema, on the main model. The model answers with references, never names: the server maps them back, and an unknown reference is dropped. This is the pattern invoice reading and the menu search already use.
3. **Names of real things are resolved by the server.** "Ware", "Pad Thai", "Bidfood" in the request come back as text; the server finds the venue, dish or supplier with `pickByName()` and asks when two fit.
4. **Check, compile, try.** The definition goes through the same checks as one built by hand, then runs with a small limit. If it fails, one more call with the error.
5. **Say what was built in words.** The server writes the one-sentence description from the definition itself, so it always matches what will run.

**Rules**

- The model sees the catalogue (names and descriptions), never rows, unless the person asks for a written summary of a result (a later phase; personal data is left out of what it reads).
- It cannot save, schedule, share or send. Those are buttons or Pepper's confirm cards.
- It counts towards the group's monthly allowance and the person's daily share, like every other Pepper call.
- Routes sit under `/api/ai/` for the five-minute proxy timeout.

**Checking it works**: tests against a stand-in Claude for the plumbing, plus a list of about 60 real requests with what a right answer must contain, run by hand against the live model before each release of this part.

## 11. Templates

"Template" can mean two things. Both are in the plan.

**Starter reports** (what to report on)

- A library of ready-made reports per area: about 65 to begin with (Appendix B). They live in code, so they improve with releases.
- "Use this" copies one into the group's own reports, where it can be changed freely.
- A group can mark its own report as a starter for its team. Platform admins can publish one to every group.
- Each starter report has a test that its totals equal the existing screen's figures for the same test data (section 19).

**Layout templates** (how a report looks on paper, in a PDF, in an email)

Settings, not a free canvas, in the first version:

| Part | Settings |
|---|---|
| Page | A4 or Letter, upright or wide, margins |
| Header | Logo, group name, venue, report title, period, when it was run and by whom |
| Footer | Page N of M, a line of the group's own words |
| Style | Colours and fonts from Brand & theme (the `kitFromBrand()` route the designers use), table density, striped rows, how negatives show |
| Front page | Optional: title, period, a paragraph |
| Blocks | For a Page report: the order of its figures, charts, tables, text and page breaks |
| Email | Subject and message with merge fields (report name, period, venue), and whether the report goes in the message, as an attachment, or both |

A group has one default layout and can add more (Board pack, Accountant, Kitchen noticeboard). A report picks one. The layout editor previews with the report's real data.

A drag-and-drop page designer like the menu print designer is possible later on the same block renderer. It is not in the first version: layouts by settings cover headers, footers, branding and block order, which is what printing a report needs.

## 12. Charts

The admin has no chart library. The plan is **one small chart renderer of our own in `shared/`**: data and options in, SVG out. The same function draws on screen, on the print page, in the PDF and (as a picture) in emails, so a chart cannot look different on paper.

| Chart | Notes |
|---|---|
| Bar | Upright or sideways, grouped or stacked |
| Line and area | Several series, gaps for missing days |
| Bar with a line | Sales as bars, labour share as a line, a second scale |
| Pie and ring | Up to 8 slices, the rest as "Everything else" |
| Figures | Big numbers with the change against the comparison and a small trend line |
| Heat table | A table shaded by value: hours down, weekdays across |

On screen: tap for the values, tap to drill, tap the legend to hide a series. Every chart has its table one tap away. Colours come from the brand with a fallback set that stays readable for colour-blind people. `print-color-adjust: exact` on everything coloured, as the menu print pages do.

The alternative, a library such as Recharts in the admin, would still need a second renderer on the server for PDFs and emails, which is the two-renderers problem again, and would add to a bundle that is 1.1 MB from its limit.

## 13. Printing and PDF

- **Print from the browser.** A print page drawn by the shared block renderer with the layout template: page sizes in viewport units, table headings repeated on every page, rows kept whole, page breaks where the definition says. These are the rules the menu print pages already learnt the hard way. A new browser tab cannot send the admin's login, so the page opens through a short-lived signed link, the way a draft menu's print preview does.
- **PDF made by the server** is needed for scheduled emails and the API. Two ways:

| | Headless Chromium in the worker | Our own PDF writer, extended |
|---|---|---|
| Looks like the print page | Exactly: it is the print page | No: a second layout, plainer |
| Brand fonts, logo, charts | Yes | One built-in font; charts drawn again by hand |
| Cost | About 300 MB of memory while a PDF is being made, about 150 MB on disk, system libraries to install | Almost none |
| Risk | Memory on a machine that also runs Postgres | Two layouts to keep in step, for ever |

  **Recommended: Chromium, in the worker process, one PDF at a time, with a time limit**, after measuring memory on the live machine. If the machine cannot spare it, fall back to plain PDFs from the extended writer (tables only) and keep the branded version for browser printing. This is decision 3 in section 22.

## 14. Running: by hand and on a schedule

**By hand.** Run on the report's page with its parameters. Anything over a few seconds moves to the background and the page says when it is ready.

**Schedules**

- **When**: daily, chosen weekdays, monthly (a date, or the first Monday), at a time in the venue's own zone. Later: after an event (when the day's Z is done, when a cash day is submitted).
- **What period**: relative (yesterday, last week, month to date).
- **To whom**: team members, and other addresses if allowed (decision 5).
- **How**: email with the report in the message, attached (PDF, Excel, CSV) or both; saved to the report's past runs; posted to a web address (section 15). Emails go out through the email settings of the report's venue, or for a report across venues the first venue with email set up, as loyalty sign-in codes do.
- **Only when**: always, only if there are rows, or only when a figure crosses a line (variance over £20). The last one is how reports become alerts, and a later step can raise a task on Today.
- **Runs as its owner.** A schedule uses the access of the person who made it, checked at every run. If they leave or lose the access, the schedule pauses and an owner is told. People it is sent to see what is in it, whatever their own access: the schedule window says so.
- **Mechanics**: a job each minute claims due schedules (`FOR UPDATE SKIP LOCKED`, a lease, always moving the next run on), the pattern local info captures use. A run missed while the server was down runs once on recovery if it is under six hours late.

**Past runs.** Every run is recorded: who or which schedule, when, parameters, rows, time taken, the files, any error. Files are kept 30 days (7 if they hold personal data), the record 400 days.

**Private files.** Run files must not go under `/uploads`. A private store is added (a folder the web server does not serve, or private S3 objects) and files are only downloaded through a signed-in route.

## 15. Export and the report API

| Format | Notes |
|---|---|
| CSV | UTF-8, cells made safe against spreadsheet formulas (as the online transactions export does), streamed so size is not held in memory |
| Excel | Real numbers and dates with their formats, column widths, one sheet per block, through `xlsx` (which writes values and formats, little styling) |
| PDF | Section 13 |
| JSON | Columns with types, rows, and what was run |
| Print page | The HTML itself |
| Picture | A chart as PNG or SVG |

**A report as an API.** Any saved report can be given a **data link**: an address that returns its current data as JSON or CSV, for Google Sheets, Power BI, Looker Studio or the accountant's own tools.

- A link has a secret key shown once (only its hash is kept), an end date, a rate limit and a count of uses. It can be switched off at any time.
- Its parameters are fixed when it is made (always "last 30 days, all venues"), or named ones can be set by the caller.
- It carries the access of the person who made it, checked on every call. Personal data is left out unless an owner turns it on for that link.
- `GET /api/report-data/:link` with the key in a header, or in the address for tools that can only fetch an address (Sheets). Results page by cursor; an unchanged result answers "not modified".
- **Push**: a schedule can post its result to a web address, signed so the receiver can check it came from us.

Made and managed by owners and admins only. Every call is counted and the last use shown.

Not planned: a general query API, or a SQL endpoint. The catalogue is the contract.

## 16. Pepper toolkit

A new section, `reports`, in Pepper's tool registry, available in the chat and over the staff connector (MCP), with the same permission and confirm-card rules as the rest.

| Tool | What it does | Changes anything |
|---|---|---|
| `list_reports` | Reports the person can open: theirs, shared, starters. Search by words | No |
| `get_report` | What a report shows, in words, with its parameters and schedule | No |
| `run_report` | Runs a saved report with given venues and period. Returns the top rows, the totals and a link to the page | No |
| `ask_data` | Answers a question with numbers ("net sales last week by venue") by building a one-off definition and running it. Says what it counted | No |
| `find_fields` | What data there is on a topic ("what do we hold about tips?") | No |
| `explain_figure` | How a measure is worked out, from the catalogue | No |
| `report_runs` | Past runs and what is scheduled | No |
| `build_report` | Makes a report from a description; the card shows what it will show before it is saved | Yes |
| `change_report` | Changes a saved report ("add a column for covers") | Yes |
| `copy_report`, `delete_report` | Delete asks twice | Yes |
| `schedule_report`, `change_schedule`, `pause_schedule` | The card names who will receive it | Yes |
| `send_report` | Runs now and emails named people | Yes |
| `export_report` | Makes a file and gives its link | No (a run is recorded) |
| `share_report` | Which roles can open it | Yes |
| `add_report_to_dashboard` | Puts a report on a dashboard as a widget | Yes |
| `make_data_link` | Owners and admins; the key is shown once | Yes |

`run_report` and `ask_data` hand a chat a few hundred rows at most; anything bigger comes back as a file link. Both are limited per person per minute.

`ask_data` is the one that changes what Pepper can do day to day. Today Pepper answers a figures question only when someone has written a tool for it. With the catalogue behind it, one tool covers every area: Pepper fills in a small definition (subject, measures, grouping, filters, period), the engine runs it as the person, and the answer comes back with the rule it used.

Also: the builder page tells Pepper what is on screen (`usePepperPage()`), so "why is Tuesday low?" is asked about the open report. The day briefing can include a pinned report's figures.

## 17. Access, privacy and safety

**Who can do what.** A new module group, Reports, with one module and three levels (the Use level added in migration 229):

| Level | Can |
|---|---|
| View | Open and run reports shared with their role; change the period and venues; drill; print |
| Use | Build and save their own reports; export; schedule to themselves |
| Manage | Share with roles; schedule to others; layout templates; starter reports for the group |
| Owner or admin as well | Data links; sending to addresses outside the team; personal data in exports to others |

**What data a person sees**

- A subject is offered only to someone with View on the module that owns it. Sales lines need Till reports; pay needs Rota pay.
- A field can need more: supplier prices need Purchasing setup (the rule the purchasing screens follow), pay and tips their own modules, guest contact details Customers, loyalty members' details Loyalty members.
- A shared report runs as the person opening it. Columns they may not see are left out with a note ("2 columns left out: pay"). If a filter depends on one, the report is refused, since the result would give the hidden value away.
- Access is per group today, not per venue. If per-venue access is added later, the engine's venue filter is the place to enforce it.

**Personal data**

- Fields are flagged in the catalogue: guest and member names, emails, phones, addresses, staff personal details.
- They are left out of anything Pepper reads back, out of data links, and out of emails to outside addresses, unless an owner turns them on for that report.
- Reports read live data, so a customer anonymised under GDPR disappears from every report at once. Stored run files that held personal data are kept 7 days.
- Every run and export is recorded with who and what.

**Never in the catalogue**: sealed keys and passwords, token and code hashes, PIN hashes and salts, booking manage links, public order tokens, Pepper's chat messages and attached files, device secrets, platform tables. The coverage test requires each of these to be written down with its reason.

**Cross-tenant safety**

- Every table in every query is filtered by tenant, and the query runs with row-level security on.
- Report, schedule, link and layout rows have a tenant and forced row-level security like every other table.
- The tenant sweep test is extended: every report route called as another group, with the first group's report ids, field names and filter values.

**The engine's own guards**: names only from the catalogue, values only as parameters, a whitelist of functions in calculations, limits on joins, groupings, rows and time, read-only transactions, its own connection pool.

## 18. New tables, routes and files

**Tables** (all with a tenant and forced row-level security)

| Table | Holds |
|---|---|
| `reports` | Name, description, the definition, owner, who it is shared with (private, roles, everyone), its layout, whether it is a starter, when it last ran |
| `report_layouts` | Layout templates and the group's default |
| `report_schedules` | When, parameters, formats, recipients, conditions, next run, lease, last error |
| `report_runs` | Each run: who or which schedule, parameters, rows, time, files, error, when its files expire |
| `report_links` | Data links: key hash, parameters, end date, uses, last used |
| `rpt_*` | The stored results of 5.4 |

Plus a `report` widget type for dashboards and a private file store.

**Routes**

| Route | For |
|---|---|
| `GET /api/reports/catalogue` | The subjects and fields the person may use |
| `POST /api/reports/preview` | Run an unsaved definition (the builder) |
| `/api/reports`, `/api/reports/:id` | List, read, save, copy, delete |
| `POST /api/reports/:id/run`, `GET .../export`, `POST .../print-link` | Run, export, a signed link to the print page |
| `/api/reports/:id/schedules`, `/api/reports/runs` | Schedules and past runs |
| `/api/reports/layouts` | Layout templates |
| `/api/reports/:id/links` | Data links |
| `GET /api/report-data/:link` | The report API (by key, no login) |
| `POST /api/ai/reports/build`, `/refine` | The smart builder |

**Files**

| Where | What |
|---|---|
| `shared/reports/spec.js` | `normaliseReport()`, the one check for a definition |
| `shared/reports/expr.js` | The formula language |
| `shared/reports/format.js` | Numbers, money, dates |
| `shared/reports/chart.js` | The chart renderer |
| `shared/reports/layout.js` | Blocks to HTML, for screen and print |
| `api/src/reports/catalogue/*.js` | One file per area |
| `api/src/reports/compile.js`, `run.js` | Definition to SQL; running with the guards |
| `api/src/reports/computed/*.js` | Writers of the stored results |
| `api/src/reports/export/*.js` | CSV, Excel, PDF, JSON |
| `api/src/reports/schedule.js`, `ai.js`, `starters/*.js` | The schedule sweep, the smart builder, starter reports |
| `api/src/routes/reports.js`, `reportData.js` | Routes |
| `api/src/ai/tools/reports.js` | Pepper's tools |
| `admin/src/pages/Reports.jsx`, `ReportView.jsx`, `ReportBuilder.jsx` | Pages, loaded on demand |
| `admin/src/components/reports/*` | Field tree, shelves, filters, chart panel, drill trail, schedule and export windows, layout editor, smart builder |
| A second PM2 process | The worker for exports, PDFs and schedules |

Menu: a Reports entry with its description and search words (the rules migration 241 brought in), and a migration to add it to existing menus.

## 19. Tests

| Kind | What |
|---|---|
| Shared unit tests | The definition check, the formula language, formatting, the chart renderer's output, period maths across time zones and week edges |
| Engine tests | Definition in, SQL out, for each join shape. Double-counting cases with test data built to catch them. Two subjects side by side. Venue time zones |
| Reconciliation | Each starter report's totals equal the existing screen's API for the same data: sales against `dayFigures()`, online against `onlineTransactions()`, pay against `computeRotaWeek()`, variance against the cash week route. This is the test that matters most |
| Catalogue | Every table decided; every undeclared id column linked or left out; every field's module exists; no left-out column reachable |
| Access | Viewer, operator, a custom role with Use: what each can see, build, run and export. Hidden columns. Schedules after the owner loses access |
| Tenant sweep | Every report route as another group |
| AI | The smart builder and Pepper's tools against a stand-in Claude; the hand-run list of real requests |
| Browser | The builder, viewer, drill-downs, print page and schedule window at 1280, 1015 and 390 px; view only |
| Load | A till sales generator on the Test data page (useful by itself), then timings at a year of trading for ten venues |

## 20. Phases

Each phase ends with something usable. Sizes compare with work already shipped: S is about the menu search, M about order flows on the till, L about loyalty, XL more than loyalty and in several pull requests.

| Phase | What ships | Size | Needs |
|---|---|---|---|
| **0. Groundwork** | Decisions from section 22. The catalogue format and generator. The coverage test with every table decided. Memory check for PDFs on the live machine. The Reports module and menu entry. The private file store | S | Your answers |
| **1. The builder, on the core** | Catalogue for till sales, online orders and bookings with the shared dimensions (venue, calendar, staff, dish, section, order type, revenue stream, customer). The definition and its check. The engine with lookups, measures, filters, periods, comparisons, calculations. The builder and viewer. Tables, summaries, matrices, charts. All three drill-downs. Save and share. CSV and Excel. Browser printing with a default layout. About 25 starter reports. Reconciliation tests | XL | 0 |
| **2. Pepper** | The smart builder with refinement and file attachments. Pepper's reading and building tools, `ask_data` included. The list of real requests | M | 1 |
| **3. Every module** | Catalogue for the rest: cash, rota and pay, purchasing and inventory, food safety and checklists, loyalty, kiosks, kitchen, menus, reviews, local info, emails, Pepper's own usage, devices. The stored results of 5.4, with the cash rule moved to `shared/`. Two subjects in one report. About 40 more starter reports. The coverage test at "everything decided and offered" | L | 1 |
| **4. Paper and post** | Layout templates and their editor. Page reports. The PDF renderer. Schedules, conditions, email delivery, past runs. Pepper's schedule and send tools | L | 1, decision 3 |
| **5. Out of the app** | Data links and the report API. Push to a web address. Reports as dashboard widgets. The phone viewer. Saved reports in the menu search. Alerts that raise a task on Today | M | 4 |
| **6. Later** | Written summaries of a result by Pepper. Schedules set off by events. A drag-and-drop page designer. Roll-up tables if volumes need them. Renaming fields per group | open | as wanted |

Phases 2, 3 and 4 can go in any order once phase 1 is in. The order above gets AI in front of you soonest, on three areas. Every module first gives the AI the whole catalogue from its first day. Paper and post first gets scheduled emails out soonest.

Each phase ships with its Help and Docs sections, a changelog entry and its tests, as every change does.

## 21. Risks

| Risk | Why it matters | What the plan does |
|---|---|---|
| A report disagrees with a screen | Two numbers for "net sales" and nobody trusts either | Measures defined once in the catalogue; stored results for figures with rules in code; a reconciliation test per starter report |
| Double-counting from joins | Wrong totals with no error | The engine's rule in 7.1; test data built to catch it |
| Reports slow the tills | One machine runs everything | Read-only, time limits, cost check, own pool, own process, per-group limit; figures never come from replaying the till's event log, and its activity list is read a trading day at a time |
| Data reaches someone who should not have it | Shared reports, schedules and data links all move data | Runs as the viewer or owner with access checked every time; fields with their own permission; personal data off by default; owners only for links and outside addresses; the sweep test |
| The AI builds something plausible and wrong | A confident chart of the wrong thing | It can only pick catalogue fields; the server says in words what was built; real data in the preview; assumptions listed; nothing saved or sent without a person |
| The catalogue is a lot of careful work | About 140 subjects to name, describe and link | A generator for the draft; one area at a time; the coverage test keeps count |
| The schema keeps changing | Pre-production: tables are renamed and dropped freely | The coverage test turns a schema change into a catalogue change in the same pull request |
| JSON-heavy tables | Kitchen orders, kiosk visits and check state are mostly JSON | Only named, extracted fields are offered; the rest stays out until asked for |
| PDFs need a browser on the server | Memory on a shared machine | Measured first; one at a time in the worker; a plain fallback |
| The admin bundle limit | Crossing it fails the deploy | Report pages and the chart renderer load on demand |
| Sales that have not reached the cloud | A till trading through its venue hub with the internet down sends its sales later | Reports show what the cloud holds and say when tills have sales still to send, as the till's Close the day screen does |
| It grows without end | "All data" and "full toolkit" have no natural edge | Phases that each stand alone; a list of what is not planned (below) |

**Not planned**: free SQL. Reports across restaurant groups. Writing data back from a report. Live-updating reports (a report is run; a dashboard widget re-runs on a timer). Forecasting. Joins on anything but the catalogue's links.

## 22. Decisions needed

| # | Question | Recommended |
|---|---|---|
| 1 | **Who builds reports?** Owners and admins only, or any role given the level | One Reports module with View, Use and Manage, so you decide per role |
| 2 | **Which areas first?** Phase 1 covers till sales, online orders and bookings | Those three. If labour against sales matters most, the rota moves up into phase 1 |
| 3 | **PDFs**: a headless browser on the server (identical to the printed page, about 300 MB while working) or plain PDFs from our own writer | The browser, after a memory check. What size is the Lightsail machine? |
| 4 | **The report API**: data links with a key, for Sheets and Power BI | Yes, owners and admins only, personal data off unless switched on per link |
| 5 | **Scheduled emails to people outside the team** (an accountant, an area manager without a login) | Yes, set by owners and admins, with personal data off by default |
| 6 | **What comes after the builder?** Pepper (phase 2), every module (3) or printing and scheduled emails (4): they can go in any order | Pepper first: it shows early whether the definition can say what people ask for |
| 7 | **The existing fixed reports** (Till reports, online orders report, kitchen report): keep, or rebuild on the engine | Keep them. Rebuild one at a time later, once their starter report matches to the penny |
| 8 | **Your ten must-have reports.** The starter list in Appendix B is a guess | Mark the ones you would open every week, and add what is missing |

Also useful to know, though nothing waits on it: how many venues and roughly how many till checks a day to plan for, and how far back reports should reach.

---

## Appendix A: every table and what happens to it

A first pass, to be settled in phase 0. Counts are tables.

| Area | Happen | Group by | Settings | Left out | All |
|---|---|---|---|---|---|
| Till (POS) | 9 | 12 | 8 | 3 | 32 |
| Kitchen screens | 2 | 2 | 0 | 2 | 6 |
| Kiosks | 1 | 1 | 0 | 0 | 2 |
| Online ordering | 7 | 1 | 5 | 1 | 14 |
| Bookings | 4 | 3 | 14 | 4 | 25 |
| Customers and reviews | 1 | 1 | 0 | 1 | 3 |
| Menus | 1 | 10 | 2 | 4 | 17 |
| Cash reconciliation | 7 | 4 | 2 | 0 | 13 |
| Staff and rota | 8 | 6 | 2 | 0 | 16 |
| Purchasing | 6 | 11 | 1 | 0 | 18 |
| Food safety, checklists, H&S | 7 | 7 | 3 | 0 | 17 |
| Loyalty | 3 | 4 | 0 | 5 | 12 |
| Menu screens | 0 | 4 | 0 | 2 | 6 |
| Website and media | 0 | 3 | 6 | 1 | 10 |
| Local info | 1 | 1 | 0 | 0 | 2 |
| Pepper (AI) | 4 | 0 | 1 | 8 | 13 |
| Venues, team, support | 3 | 3 | 2 | 6 | 14 |
| Platform (not for tenants) | 0 | 0 | 0 | 6 | 6 |
| **All** | **64** | **73** | **46** | **43** | **226** |

**Things that happen** (64)

- Till: `pos_checks`, `pos_check_lines`, `pos_payments`, `pos_days`, `pos_card_payments`, `pos_print_jobs`, `pos_event_rejections`, `pos_events` (an activity list: who did what, when, on which till, and who approved it; never its contents, and never the source of a figure), `pos_receipts` (counts; the address is sealed and left out)
- Kitchen: `kds_log`, `kds_orders`
- Kiosks: `kiosk_sessions` (the summary columns; the recorded touches stay out)
- Online ordering: `orders`, `order_items`, `order_payments`, `order_promotions`, `order_events`, `gloriafood_orders`, `ordering_item_availability`
- Bookings: `bookings`, `payments` (deposits), `email_log`, `notification_log`
- Reviews: `reviews`
- Menus: `menu_releases` (publishing history)
- Cash: `cash_daily_reports`, `cash_income_entries`, `cash_takings_entries`, `cash_sc_entries`, `cash_expenses`, `cash_wage_reports`, `cash_wage_entries`
- Rota: `rota_entries`, `rota_pay_adjustments`, `rota_tip_moves`, `rota_tip_move_lines`, `rota_week_staff`, `rota_week_pot_lines`, `rota_week_pot_manual`, `staff_rota_off`
- Purchasing: `purchase_orders`, `purchase_order_lines`, `purchase_invoices`, `supply_orders`, `supply_order_lines`, `inv_price_history`
- Food safety and H&S: `fs_temp_logs`, `fs_hold_checks`, `fs_cooking_checks`, `fs_delivery_checks`, `checklist_instances`, `checklist_instance_items`, `hs_action_log`
- Loyalty: `loyalty_ledger`, `loyalty_redemptions`, `loyalty_member_rewards`
- Local info: `local_info_items`
- Pepper: `ai_usage`, `ai_usage_people`, `ai_actions`, `ai_conversations` (counts and dates only)
- Other: `store_openings`, `issue_log`, `feature_requests` (the group's own issues and requests)

**Things to group by** (73)

- Till: `pos_devices`, `pos_revenue_streams`, `pos_courses`, `pos_roles`, `pos_discounts`, `pos_charges`, `pos_printers`, `pos_card_readers`, `floor_areas`, `order_types`, `tax_rates`, `tax_rate_values`
- Kitchen and kiosks: `kds_stations`, `kds_flows`, `kiosk_designs`
- Online ordering: `promotions`
- Bookings: `tables`, `venue_sections`, `table_combinations`
- Customers: `customers`
- Menus: `menus`, `menu_sections`, `menu_items`, `menu_variant_groups`, `menu_variant_options`, `menu_dietary_tags`, `menu_item_dietary`, `menu_item_variant_groups`, `menu_item_variant_prices`, `menu_item_variants`
- Cash: `cash_income_sources`, `cash_payment_channels`, `cash_sc_sources`, `cash_expense_categories`
- Staff: `cash_staff`, `staff_roles`, `rota_shifts`, `tip_pots`, `tip_pot_lines`, `staff_shift_rates`
- Purchasing: `suppliers`, `supplier_venues`, `inv_items`, `inv_categories`, `inv_quotes`, `inv_quote_venue_prices`, `inv_preferred`, `order_lists`, `order_list_items`, `order_list_pars`, `order_list_venues`
- Food safety and H&S: `fs_equipment`, `fs_hold_stations`, `fs_cooking_sessions`, `fs_cooking_items`, `checklist_templates`, `checklist_template_items`, `hs_action_categories`
- Loyalty: `loyalty_members`, `loyalty_programmes`, `loyalty_rewards`, `loyalty_stamp_cards`
- Screens: `screens`, `screen_designs`, `screen_playlists`, `screen_walls`
- Website: `website_pages`, `media_items`, `media_categories`
- Local info: `local_info_sources`
- Group: `venues`, `users`, `tenant_roles`

**Settings: a few named fields offered** (46)

`pos_settings`, `pos_charge_rules`, `pos_stream_order_types`, `pos_till_layouts`, `pos_order_flows`, `pos_card_accounts` (name and provider only), `print_designs`, `print_design_uses`, `ordering_settings`, `gloriafood_venue_links`, `deliveroo_settings`, `deliveroo_item_links`, `loyverse_venue_links`, `booking_rules`, `deposit_rules`, `venue_schedule_templates`, `venue_sittings`, `sitting_slot_caps`, `schedule_date_overrides`, `override_sittings`, `override_slot_caps`, `schedule_exceptions`, `exception_day_templates`, `exception_sittings`, `exception_sitting_slot_caps`, `disallowed_table_pairs`, `email_templates`, `menu_times`, `menu_translations`, `cash_venue_settings`, `cash_wage_defaults`, `rota_settings`, `rota_week_pot_payees`, `purchasing_settings`, `fs_capture_times`, `fs_hold_capture_times`, `fs_cooking_settings`, `tenant_site`, `website_config`, `website_opening_hours`, `website_menu_documents`, `website_allergen_info`, `website_gallery_images`, `ai_settings`, `tenant_modules`, `tenants` (the group's own name)

**Left out** (43), with the reason

- Secrets and keys: `platform_secrets`, `loyverse_connections`, `venue_email_settings`, `loyalty_wallet_settings`, `staging_access`
- Tokens, codes and sessions: `pos_pairings`, `screen_pairings`, `menu_preview_links`, `loyalty_codes`, `loyalty_sessions`, `loyalty_wallet_devices`, `ai_access_tokens`, `ai_oauth_clients`, `ai_oauth_grants`, `ai_booking_codes`, `ai_booking_grants`
- Conversations and files: `ai_messages`, `ai_attachments`, `ai_pending_actions`
- Layout and design JSON with nothing to count: `print_design_variations`, `menu_print_designs`, `menu_callouts`, `menu_allergen_notice`, `screen_playlist_items`, `nav_items`, `dashboard_tiles`, `hs_dashboards`, `hs_dashboard_widgets`
- Working state: `pos_venue_state`, `kds_flow_edges`, `kds_balance_turns`, `booking_holds`, `table_occupancy`, `review_scrape_jobs`
- Reached only through their parent: `table_combination_members`, `feature_request_upvotes`
- Shared across groups: `loyalty_identities`
- Platform: `platform_admins`, `platform_interest`, `platform_settings`, `backlog_items`, `schema_migrations`, `changelog_entries` (the app's own What's new list, the same for every group)

## Appendix B: starter reports

A first list, to be corrected by decision 8.

| Area | Reports |
|---|---|
| Till sales | Sales by day. Sales by hour and weekday. Sales by dish. Sales by section. Sales by server. Sales by order type and revenue stream. Payments by tender. Discounts and comps, by whom and why. Voids and cancelled orders, by whom and why. Charges and tips. Average spend per check and per guest. VAT by rate. Trading days: cash declared against expected |
| Online orders | Orders and sales by day and channel. Top dishes online. Promotions used and discount given. Time from placed to accepted to ready. Refunds. GloriaFood beside our own ordering |
| Kiosks | Visits to orders by day. Where guests gave up |
| Bookings | Guests by day and sitting. Bookings by source. No-shows and cancellations. How far ahead people book. Party sizes. Deposits taken and refunded. New and returning guests |
| Labour | Hours and pay by person and week. Labour cost as a share of net sales by week. Time off by kind. Tips by person and pot. Wages due against paid |
| Cash | Variance by day. Takings by channel. Expenses by category, with VAT. Income against takings |
| Purchasing | Spend by supplier and month. Spend by category. Price changes. Deliveries short or damaged. Orders sent late. Invoice price against ordered price. Products out of stock |
| Food safety and H&S | Checks done against expected, by day and venue. Readings out of range and what was done. Checklists completed. Open H&S actions by age. Delivery checks failed |
| Loyalty | Members joined by week. Points given and spent. Rewards used. Stamp cards filled |
| Kitchen | Ticket times by station and hour. Remakes and why |
| Menus | Dishes with no photo, price or allergens. Allergen matrix. Price list. Publishing history |
| Guests | Newsletter sign-ups. Reviews by rating, site and month |
| Across areas | Sales against the weather. Sales, labour and bookings by week, per venue |
| Running the app | Emails sent and failed. Pepper's use by person. Team sign-ins |
