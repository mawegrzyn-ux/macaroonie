# Estimates against actuals

The owner asked (22 Nov 2026) to record, for every feature step, the estimate made before it
and what it actually took, with the model and effort used, so estimates get more accurate over
the next 50 or so backlog items. Revise the scale after each feature, and compare the next
feature's estimates with its actuals.

## How each step is recorded

- **Estimate**: written before the step starts, in agent sessions (the scale below), and never
  changed afterwards. A revised scale applies to the next feature, not the current one.
- **Build**: from the first tool call on the step to its commit (code, tests, Help, Docs, notes,
  changelog done and checked).
- **Merge**: from opening the pull request to merging it (CI and fixes). Waiting for the agent to
  come back to a green pull request counts: it is real time to done.
- **Total**: build plus merge. Deploy time is noted but not counted (the server, not the work).
- **Model and effort**: from the session (`get_session`: `session_context.model`, `effort_level`).
- **Cost**: the session's `cost_usd` only updates between turns, so it is read where a step
  starts and ends on a turn boundary, else left blank.
- Times are UTC from the container clock. Steps that overlap (one building while another waits
  on CI) are timed on their own clocks and the overlap noted.
- **Detail** (since 22 Nov 2026): `node scripts/session-timings.mjs --log <session log> --from <ISO>
  --to <ISO> --commits <a>..<b>` reads the session's own log (`~/.claude/projects/<project>/<session>.jsonl`)
  and gives, for the window: tool calls and model messages, time in tools by phase (find and read
  code, edits, test runs, builds, waits for background runs and CI, pull requests), the model's own
  time between calls, the slowest calls, tokens and an estimated cost at list prices, and the lines
  the commits changed by kind (code, tests, docs and notes, migrations). Phases are guessed from the
  tool and the shell command's words. Add its numbers to the step's detail below.

## Scale used for the 22 Nov 2026 backlog estimates

One session = one focused agent task of roughly 2 to 4 hours ending in a tested pull request.
XS under half a session, S about 1, M 2 to 3, L 4 to 8, XL more than 8.

## Steps

| Feature step | Estimate | Build | Merge | Total | Size | Model / effort | Notes |
|---|---|---|---|---|---|---|---|
| 48.1 Catalogue type: migration, shared rule, release, editor | 1.5 to 2 sessions (3 to 8 h) | 9 min (18:00:08 to 18:08:53) | 13 min (PR #491 opened 18:13:10, CI green 18:19:00, merged 18:26:30) | **22 min** | 15 files, +326 lines, migration 267 | claude-opus-5-5 / high | Plus 4 min showing the owner D1 to D4 before. Design fully written in `docs/CATALOGUE.md`; followed the tax inheritance path. Merge waited 7 min on the agent after CI went green. No browser check. Deploy 699 to 700 not counted. |
| 48.2 Allergen surfaces leave non-food out | 1 to 2 sessions (2 to 8 h) | 14 min (18:13:21 to 18:27:07) | 5 min (PR #492 opened 18:27:51, CI green 18:32:23, merged 18:32:32) | **19 min** | 16 files, +133 lines | claude-opus-5-5 / high | Built while 48.1's CI ran (overlap about 6 min). 65 related test files (391 tests) run once. |
| 48.3 Kitchen skips retail and services | 1 session (2 to 4 h) | 6 min (18:28:03 to 18:34:02) | 5 min (PR #493 opened 18:34:15, CI green 18:39:03, merged 18:39:08) | **11 min** | 15 files, +71 lines | claude-opus-5-5 / high | Built while 48.2's CI ran. Not covered by a test: the online order and kiosk paths (the till rule is). No per-section switch back on. |
| 48.4 Codes, barcodes, option codes, till scan | 2 to 3 sessions (4 to 12 h) | 12 min (18:39:19 to 18:50:59) | 5 min (PR #494 opened 18:51:13, CI green 18:56:25, merged 18:56:30) | **17 min** | 20 files, migration 268, a new table | claude-opus-5-5 / high | Chose a new table for option codes over the plan's reuse of the price rows (they mean "own price" to the editor, reports and release). Till scan not tried with a real scanner; kiosk and online ordering don't scan. |
| 48.5 Menu or Catalogue words, group setting | 1 session (2 to 4 h) | 7 min (18:56:46 to 19:04:05) | 6 min (PR #495 opened 19:04:15, CI green 19:10:07, merged 19:10:12) | **13 min** | 15 files, migration 269 | claude-opus-5-5 / high | About 4 of the 7 min was waiting on the related tests. The website's own words and the phone app's Menus tile aren't changed. |
| 48.6 Type in reports | 1 session (2 to 4 h) | 25 min (19:04:25 to 19:29:54) | 6 min (PR #496 opened 19:29:58, CI green 19:35:58, merged 19:36:05) | **31 min** | 10 files | claude-opus-5-5 / high | About 12 min went on a smart builder test that failed: the new dish fields, linked into every subject reaching dishes, pushed Dishes sold out of DETAIL_BUDGET. Fixed by keeping product code and barcode out of reports. Built while 48.5's CI ran. |
| Timing script and feature 48's detail (not a backlog item) | not estimated | 1.8 min (19:36:36 to 19:38:21) | 6 min (PR #497 opened 19:43:11, CI green 19:48:54, merged 19:48:59) | **8 min** | script +165, docs +57 | claude-opus-5-5 / high | Build: 7 tool calls, 15 messages, 0.6 min of the model's time, about $3. Merge: 5 calls, 5.7 of its 6 min waiting on CI, about $0.90. A docs-and-script change still waits a full CI run. |
| 44.11.1a Deep link plumbing: what each page accepts, `useDeepLink()`, `pageLink()` | revised scale: 20 to 30 min build + 6 merge | 5 min (19:55:08 to 20:00:07) | one PR, below | | 12 files, +265 | claude-opus-5-5 / high, fresh agent | Estimated 19:54 before starting. Followed `useLinked()`; slow part was two existing checks to adjust (nav file test, area map). 70 calls, 3.4 min model time, about $5.70. |
| 44.11.1b Six pages open at a venue, day or week, and tab (Timeline, Bookings, Rota, Food safety, Online orders, Cash Recon) | revised scale, doubled: 40 to 60 min build + 6 merge | 8 min (20:00:07 to 20:08:07) | one PR, below | | 9 files, +108 | claude-opus-5-5 / high, fresh agent | Three pages quick; three had a "pick the first venue" effect or a time-zone reset that overwrote the link, found by reading the code. Browser harness setup 1.6 min. 64 calls, 3.9 min model time, about $6. |
| 44.11.1c `open_page` links with context, and one page matcher | revised scale: 20 to 40 min build + 6 merge | 10 min (20:08:07 to 20:17:55) | 6 min for 1a to 1c: PR #498 opened 20:18:40, CI green 20:24:23, merged 20:24:29 | **29 min for 1a to 1c** (19:55:08 to 20:24:29) | 19 files, +275 | claude-opus-5-5 / high, fresh agent | Slow part: deciding how many pages to offer once the menu search's ranking replaced the old scorer (tests expected exact answers). 79 calls, 4.7 min model time, about $11. Browser: 31 Playwright checks on the six pages and a chat link, 1280 px only. Lead session's own share (brief, merge-in, PR, CI wait, merge): 16 messages, about $3. |
| 44.11.0a Usage record: pages opened and menu search / ask bar queries, each person's own (decision 8), 90 days | second revision, doubled (the plan names it in one line): 10 to 20 min build | 24 min (20:54:18 to 21:18:47) | one PR, below | | 28 files, +804, migration 270 | claude-opus-5-5 / high, fresh agent | Estimated 22 Nov 2026 before starting. Slow: reading the notes and the report engine (about 8 min) to find that no subject could be "each person's own", so `{me}` went into the compiler; about 6 min waiting on the sweep and report tests. Quick: the table, route and admin queue. |
| 44.11.0b Model requests by model: tokens, units, time per request, and cost per request in reports | second revision, doubled: 10 to 20 min build | 7 min after 0a's commit (21:18:47 to 21:26:10); about 6 min more written while 0a's tests ran | one PR, below | | 27 files, +324, migration 271 | claude-opus-5-5 / high, fresh agent | Quick: one cost rule (`costMicros()`) for units and dollars, and `use` / `ms` on the ten `addUsage()` callers. Slow part: the test run (sweep and readers) in the background. |
| 44.11.0c Pepper evaluation set: 20 to 50 tasks checked by the end state on a seeded tenant, a runner, proven against the stand-in model | second revision, doubled: 10 to 20 min build (writing 20+ tasks may run over) | 9 min after 0b's commit (21:26:10 to about 21:35); the harness and the 27 tasks were written while 0a's and 0b's tests ran (from about 21:20) | 6 min for 0a to 0c: a privacy fix by the lead before the PR (21:36 to 21:37), PR #499 opened 21:37:34, CI green 21:43:48, merged 21:43:55 | **50 min for 0a to 0c** (20:54:18 to 21:43:55) | claude-opus-5-5 / high, fresh agent | The live run waits for the owner's go-ahead and a key. One pull request for 0a to 0c, 6 min. Slow: four rounds of the 85 s harness test, each finding a real gap (the fixtures already had a dish sold out, a delivery check and local events of their own; the booking route wants an email; a booking's background work changes its row). Not run live. |
| 44.11.2a Pins kept on the server, per person (replacing the Overview's per-browser Quick access) | thin plan, scale 10 to 20 min build | 13 min (23:11:55 to 23:24:47) | one PR, below | | 20 files, +613 -220, migration 272 | claude-opus-5-5 / high, fresh agent | Estimated 22 Nov 2026 before starting. 111 calls, 8.5 min model time, about $14.70. Most of it reading the nav records, the shell and the Overview's Quick access before writing; the table and route were quick. |
| 44.11.2b One Home at `/`: ask bar, pins, the Today feed and the week strip; Overview tiles at /overview, /today goes to Home | 15 to 25 min (assembles existing parts; touches the shell) | 7 min (23:24:47 to 23:31:25) | one PR, below | | 39 files, +392 -375, migration 273 | claude-opus-5-5 / high, fresh agent | Quick: put together from parts that existed (Today feed, week strip, pins). 50 calls, 4 min model time, about $8.20. |
| 44.11.2c The ask bar: instant local matches with no model call, Enter hands to Pepper, the same bar over any page; nav cards in Pepper's replies | 15 to 25 min | 20 min (23:31:25 to 23:51:27) | one PR, below | | 33 files, +675 -867 | claude-opus-5-5 / high, fresh agent | The slowest sub-step: five rounds of the browser check (18 to 35 s each) on the bar's keys and the hand-over to Pepper's drawer, and moving the `open_page` tests out of the nav-search test it removed. 127 calls, 9.9 min model time, about $26.40. |
| 44.11.2d Launcher mode retired (nav style, tiles, page) | 10 to 20 min | 10 min (23:51:27 to 2026-11-23 00:01:04) | 29 min for 2a to 2d: PR #500 opened 00:01:55, CI red 00:07:55 (3 parts), fixed and pushed 00:10, red again 00:21 (2 parts), fixed and pushed 00:24, green 00:29:58, merged 00:30:10 | **78 min for 2a to 2d** (23:11:55 to 00:30:10) | 20 files, +157 -403, migration 274 | claude-opus-5-5 / high, fresh agent | One pull request for 2a to 2d, estimated 6 min. Build: 5.5 of its 10 min waiting on its own test run. Merge: two rounds of CI fixes (below). Lead's share about $4.50 for the merge, about $1 for the brief. |
| 52 follow-up: the ask bar carries on the remembered chat (the owner's choice, 23 Nov 2026) | 5 to 10 min build + 6 merge (a small change in two components, then docs) | about 8 min (00:40 to 00:48, lead, no agent) | 6 min (PR #501 opened 00:48:50, CI green about 00:54, merged 00:54:40) | **14 min** | 10 files, about +35 -35 | claude-opus-5-5 / high, lead | Estimated before starting. Checked by reading and a build, not in a browser. |
| 49 follow-up: open_page by the person's own menu (names, Not in your menu; the owner's choice, 23 Nov 2026) | 15 to 25 min build + 6 merge | about 4 min (00:54:48 to 00:58:30, lead, no agent; plus 1 min restarting Postgres) | | | 9 files, test +45 | claude-opus-5-5 / high, lead | Estimated before starting (to the owner). |
| 44.11.3a One form list: `OPEN_FORMS` (api) and `FORMS` (FormSheet) from one file in `shared/` | 10 to 15 min build (thin plan; a move) | 7 min (15:31:59 to 15:38:51, reading the notes included) | one PR, below | | 4 files, +92 -29 | claude-opus-5-5 / high, fresh agent | Estimated 23 Nov 2026 before starting. 71 calls, about $8 (most of it the first reading). |
| 44.11.3b Pepper's values in the form: `open_form` passes only what the person said or a document states, checked against the form's fields; the sheet marks each filled field until touched (F4, F7) | 15 to 25 min | 7 min (to 15:46:07) | one PR, below | | 13 files, +585 -121 | claude-opus-5-5 / high, fresh agent | 30 calls, about $5.30. |
| 44.11.3c A saved form becomes a summary line with Edit in the chat (F9) | 10 to 20 min | 4 min (to 15:50:25) | one PR, below | | 8 files, +224 -41 | claude-opus-5-5 / high, fresh agent | Kept like Confirm outcomes (a hidden note in the chat). About $4. |
| 44.11.3d Drafts that survive a reload or another device (F6): kept on the server per person | 15 to 25 min (a table) | 7 min (to 15:57:36) | one PR, below | | 10 files, +355 -10, migration 275 | claude-opus-5-5 / high, fresh agent | Fixture and report decision added up front (last step's lesson): no CI surprise. About $6.80. |
| 44.11.3e The four missing forms: order form, corrective action, H&S action, booking create / change (F1) | 20 to 40 min | 6 min after 3d (to 16:03:57), coded while 3d's tests ran | one PR, below | | 9 files, +515 -82 | claude-opus-5-5 / high, fresh agent | Each reuses the page's own panel. About $6.60. |
| 44.11.3f Fixes from the first live evaluation (not estimated: found during the step) | not estimated | 3 min (to 16:06:43), then docs and the browser check 8 min (to 16:14:51) | 7 min for 3a to 3f: PR #504 opened 16:20:20, CI green first time 16:26:36, merged 16:27 | **56 min for 3a to 3f** (15:31:25 to 16:27, 5 of it the hand-back) | 42 files in all | claude-opus-5-5 / high, fresh agent | Fixes about $2.80, docs about $13. Agent about $47, lead about $3; the live run $0.12. |
| 44.11.4a Every change tool declares its class (read, reversible, consequential, destructive or personal) and its preconditions; a test fails a change tool without one | third revision: 10 to 20 min (about 100 tools, mechanical) | 5 min (19:44 to 19:49), after 6 min reading the notes and code (19:38 to 19:44, about $7) | one PR, below | | 19 files, +339 -8 | claude-opus-5-5 / high, fresh agent | Estimated 23 Nov 2026 before starting. 101 staff change tools: 24 reversible, 59 consequential, 18 destructive. About $6. |
| 44.11.4b Confirm cards by class: before and after, fields editable in place, a typed word for destructive or personal changes and never by voice | 15 to 25 min | 7 min (to 19:56) | one PR, below | | 15 files, +531 -86 | claude-opus-5-5 / high, fresh agent | About $6.80. |
| 44.11.4c No duplicate write on a retried action (an idempotency key per confirmed action) | 10 to 20 min | 2 min (to 19:58) | one PR, below | | 7 files, +150 -11, migration 276 | claude-opus-5-5 / high, fresh agent | The card was already a natural key. About $2. |
| 44.11.4d Undo for reversible changes: each declares its inverse, an Undo button on the done card for a while | 15 to 25 min | 4 min (to 20:02) | one PR, below | | 9 files, +322 -23 | claude-opus-5-5 / high, fresh agent | Six tools with an inverse. About $4.40. |
| 44.11.4e The Done by Pepper log: a page of Pepper's changes with Undo where it can | 10 to 20 min (a page, its menu record and migration) | 14 min with the full test run, the browser check and the docs (to 20:16) | 7 min for 4a to 4e: PR #505 opened 20:16:30, CI green first time 20:22:48, merged 20:23 | **45 min for 4a to 4e** (19:37:41 to 20:23) | 19 files, +569 -11, migration 277 | claude-opus-5-5 / high, fresh agent | Two test files fixed before the PR (a delete card's word, the new audit columns' report decision). About $18.60 for the window. Agent about $45, lead about $3; a live eval run on the merged code passed 27 of 27 ($0.06). |
| 44.11.5a The task store: each Today task's owner, snooze, skip with a reason, done, and its history, kept per task | fourth revision: 3 to 8 min | 18 min with the reading (21:33 to 21:51) | one PR, below | | 11 files, +894 -29, migration 278 (three tables) | claude-opus-5-5 / high, fresh agent | Estimated 23 Nov 2026 before starting; plus 6 reading. Over: three tables, the feed applying states, routes and the report decision; 4 minutes reading the feed's code. About $14.50. |
| 44.11.5b Task actions on Home and the phone: assign, snooze, skip with a reason (decision 7: shown above the store), escalation of late tasks | 3 to 8 min | 3 min (to 21:54) | one PR, below | | 4 files, +430 -29 | claude-opus-5-5 / high, fresh agent | About $2.70. |
| 44.11.5c For review: the Waiting tab (unanswered Confirm cards kept, supplier orders awaiting approval, documents read into lines), Approve, Edit, Reject, same-kind reversible items together | 8 to 15 min (a page and a change to how cards expire) | 6 min (to 22:00) | one PR, below | | 13 files, +677 -22, migration 279 | claude-opus-5-5 / high, fresh agent | About $6.30. |
| 44.11.5d Six of the missing Today sources | 8 to 15 min (six functions in `SOURCES`) | 6 min (to 22:06) | one PR, below | | 5 files, +287 -5 | claude-opus-5-5 / high, fresh agent | About $2.90. |
| 44.11.5e Pepper reads the feed and acts on tasks (snooze, skip, assign through cards) | 3 to 8 min | 6 min (to 22:12), then tests, browser and docs 7.5 (to 22:19:30) | 16 min for 5a to 5e: the lead's review and a permission fix 1 min, PR #506 opened 22:21, CI red 22:28 (2 parts), fixed and pushed 22:29, green 22:34:34, merged 22:35 | **63 min for 5a to 5e** (21:32:18 to 22:35) | 8 files, +482 -4; docs 16 files | claude-opus-5-5 / high, fresh agent | Tests and docs about $10.80; agent about $41, lead about $4; live eval on the merged code 29 of 29 ($0.06). |
| 44.11.6a Shared devices: a device marked shared asks who is acting by PIN before any change; a till PIN is enough for logging checks only (decision 6); changes recorded against that person | fourth revision, raised for auth: 10 to 15 min | 18 min with the reading (23:55 to 00:13) | one PR, below | | 32 files, +1,657 -66, migration 280 (five tables) | claude-opus-5-5 / high, fresh agent | Estimated 23 Nov 2026 before starting; plus 6 reading. The largest sub-step yet: a guard in requireAuth, two PIN kinds, lockouts, the admin's switch. About $17.80. |
| 44.11.6b Capture to For review: a photo, a voice note or a line from the phone waits in For review | 5 to 10 min | 5 min (to 00:18) | one PR, below | | 18 files, +654 -21, migration 281 | claude-opus-5-5 / high, fresh agent | About $5.80. |
| 44.11.6c The venue's own words for speech: fridge, dish, staff and supplier names help dictation and talk mode | 5 to 10 min | 3 min (to 00:21) | one PR, below | | 12 files, +412 -14 | claude-opus-5-5 / high, fresh agent | About $4.70. |
| 44.11.6d The iPhone app: the office app's iOS config and the parts that differ from Android (no device build here) | 5 to 10 min | 4 min (to 00:25), then tests, browser at 1280 and 390, docs 11.5 (to 00:36:30) | 19 min for 6a to 6d: the lead's review and making iOS opt-in 1 min, PR #507 opened 00:38, CI red 00:46:30 (a Tuesday-only cash test), fixed 00:47, green 00:55:15, merged 00:55:30 | **61 min for 6a to 6d** (23:54:19 to 00:55:30) | 16 files, +317 -41 | claude-opus-5-5 / high, fresh agent | Push and the scanner on a real device need the owner's phone. Agent about $51, lead about $4; live eval on the merged code 29 of 29 ($0.06). |
| 44.11.7a Suggestions on Home: up to four, rule-based, each with its reason, dismissable (no model) | fourth revision: 5 to 10 min | 7 min (01:44:35 to 01:51:52), after 4 reading | one PR, below | | 11 files, +706 -8, migration 282 | claude-opus-5-5 / high, fresh agent | Estimated 24 Nov 2026 before starting; plus 6 reading. Six rules, about $5.50 (reading $4.40). |
| 44.11.7b The Team signal: a manager suggests a page to a role, shown with who suggested it | 5 to 8 min | 8 min (to 01:59:48, 4 of it the sweep, with 7c written meanwhile) | one PR, below | | 9 files, +481 -9, migration 283 | claude-opus-5-5 / high, fresh agent | About $7.50. |
| 44.11.7c Above the store: for people over several sites, venues ranked by what needs them, completion by site today and this week | 8 to 15 min | about 5 min, written during 7b's sweep (committed 02:00:41) | one PR, below | | 6 files, +357 -3 | claude-opus-5-5 / high, fresh agent | Two queries per request, no cache. |
| 44.11.7d Measuring suggestions: shown, tapped, dismissed in the usage record, a report figure for tap-through | 3 to 8 min | 3.5 min (to 02:04:13), then tests, browser at two widths and docs 11.6 (to 02:15:49; two fixes the browser found) | 14 min for 7a to 7d: PR #508 opened 02:17, CI green first time 02:26:16; a live run's one failure was the task's wording, fixed and re-run 6 of 6, CI again green 02:29:52, merged 02:30 | **50 min for 7a to 7d** (01:40:05 to 02:30) | 7 files, +143 -7, migration 284 | claude-opus-5-5 / high, fresh agent | Agent about $29 (the cheapest step), lead about $3; live runs $0.26 and $0.01. |
| 44.11.8a1 The object registry: one record per business object (table, report subject, page and address, actions with class and preconditions, form), per area, gathered; "why not" messages from it | fourth revision, raised (shared, many areas): 10 to 15 min | 10 min (07:28 to 07:38), after 6 reading | PR A, below | | 27 files, +1,155 -2 | claude-opus-5-5 / high, fresh agent | Estimated 24 Nov 2026 before starting; plus 6 reading. About 60 objects over 19 areas, every report subject and change tool placed. About $16.50 (reading $5.60). |
| 44.11.8a2 The catalogue's synonyms, instructions and examples per field and measure; "not covered" for questions outside it | 8 to 12 min | 16 min (to 07:54, with a fix for a shared test) | PR A, below | | 19 files, +478 -76 | claude-opus-5-5 / high, fresh agent | Over: writing 54 fields' context by hand. About $21. |
| 44.11.8a3 The plain renderer for flat set-up forms (supplier, staff member, expense, closure) from the schema with labels, help and examples | 8 to 12 min | 27 min with the full test run (551 files' tests), the browser check and docs (to 08:22) | 21 min for PR A: PR #509 opened 08:23, CI green 08:30; the live eval found Pepper asking Help about a figure, fixed and re-run 8 of 8 by 08:35, CI green again 08:42:32, merged 08:42:45 | **81 min for PR A** (07:21:16 to 08:42:45) | 30 files, +1,113 -125 | claude-opus-5-5 / high, fresh agent | Over: four routes' schemas exported and four pages moved onto one renderer. About $28 (docs $4). Agent about $65, lead about $4; live runs about $0.11. |
| 44.11.8b1 Custom fields per group on a few objects, registered so reports, simple forms and Pepper pick them up | 10 to 15 min | 20 min with reading (08:35:44 to 08:55) | PR B, below | | migration 285 | claude-opus-5-5 / high, fresh agent | Plus 6 reading. Over: four objects' routes, pages and Pepper tools, and the report catalogue made per group. |
| 44.11.8b2 A rule built from a sentence, using the registry's actions, confirmed before it runs | 10 to 15 min | 19 min (to 09:14) | PR B, below | | migration 286 | claude-opus-5-5 / high, fresh agent | Over: two tables, four trigger hooks in other areas' routes, the never-list checked three times. |
| 44.11.8b3 Product codes (GTIN) on inventory and supplier products, and stock on hand | 8 to 12 min | 8 min (to 09:22), then tests, browser at 1280 and docs 21 (to 09:44) | 27 min for PR B: PR #510 opened 09:45, CI green 09:53:52; the live eval found the rule reader failing on every real call (six cache marks, the API takes four) and Pepper writing the rule itself; fixed, 5 of 5 then 32 of 32 live, CI green again 10:10:43, merged 10:11 | **95 min for PR B** (08:35:44 to 10:11) | 95 files, +3,819 -128, migrations 285 to 287 | claude-opus-5-5 / high, fresh agent | Agent about $75, lead about $6; live runs about $0.11. |
| 44.11.9a Rules: change a rule in Settings and through Pepper (no new sentence), Undo of make_rule from Done by Pepper, an order's total kept out of notices to people who can't see prices | fourth revision with the step 8 lessons: 10 to 15 min | | one PR, below | | | | Estimated 24 Nov 2026 before starting (Pepper-first follow-ups, outstanding 62 and 63); plus 6 reading. |
| 44.11.9b Pepper's stock tools: stock on hand by item and venue, a count from Pepper (card), barcodes on supplier prices | 5 to 8 min | | one PR, below | | | | |
| 44.11.9c Barcodes in the inventory CSV / Excel import and the price list update | 5 to 8 min | | one PR, below | | | | |
| 44.11.9d A group's own fields everywhere a row is made by a person: the Inventory page's New item, and the customer and inventory imports by column name | 8 to 12 min (two areas, about 4 each) | | one PR, below | | | | |
| 44.11.9e Pepper knows the group's own field names from its per-group context, not one extra turn | 3 to 5 min | | one PR: tests, browser and docs 12 to 15, a live run before the PR 5, PR 7 | | | | |

## Running totals

| Features done | Steps | Estimated (h, low to high) | Actual (h) | Actual / estimate (midpoint) |
|---|---|---|---|---|
| 48 Menus as catalogues | 6 of 6 merged | 17 to 48 (8.5 to 12 sessions) | 1.88 (113 min) | about 0.06 (actual / estimate midpoint of 32.5 h) |
| 44.11 step 1 (deep links, one matcher), revised scale | 3 sub-steps, 1 PR | 1.4 to 2.3 (estimates 80 to 130 min build + 18 merge) | 0.48 (29 min; build 23, merge 6) | about 0.24 |
| 44.11 step 0 (usage record, model requests, evaluation set), second revision | 3 sub-steps, 1 PR | 0.6 to 1.1 (30 to 60 min build + 6 merge) | 0.83 (50 min; build 41, fix and merge 9) | about 0.97 |
| 44.11 step 2 (pins, one Home, the ask bar, Launcher retired), second revision | 4 sub-steps, 1 PR | 0.9 to 1.6 (50 to 90 min build + 6 merge) | 1.3 (78 min; build 49, fix and merge 29) | about 1.03 (build alone 0.70, merge 4.8) |
| 44.11 step 3 (filled forms, drafts, four forms) plus live-eval fixes, second revision | 5 sub-steps + 1 found, 1 PR | 1.3 to 2.4 (70 to 125 min build + 6 to 16 merge) | 0.93 (56 min; build 43, hand-back 5, merge 7) | about 0.52 |
| 44.11 step 4 (action classes, cards by class, one write per card, Undo, Done by Pepper), third revision | 5 sub-steps, 1 PR | 1.25 to 2.1 (60 to 110 min build + 8 to 10 docs + 7 PR) | 0.75 (45 min; build 38, merge 7) | about 0.45 |
| 44.11 step 5 (task store, escalation, six sources, For review, Pepper task tools), fourth revision | 5 sub-steps, 1 PR | 0.8 to 1.3 (50 to 80 min) | 1.05 (63 min; build 46.5, review 1, merge 16) | about 0.97 |
| 44.11 step 6 (shared devices and PINs, capture, venue words, iPhone-ready), fourth revision | 4 sub-steps, 1 PR | 0.8 to 1.2 (50 to 73 min) | 1.02 (61 min; build 41.5, review 1, merge 19) | about 0.99 |
| 44.11 step 7 (suggestions, Team signal, Your sites, measuring), fourth revision | 4 sub-steps, 1 PR | 0.77 to 1.15 (46 to 69 min) | 0.83 (50 min; build 35, merge 14) | about 0.87 |
| 44.11 step 8 part A (registry, catalogue context, plain renderer), fourth revision | 3 sub-steps, 1 PR | 0.85 to 1.1 (51 to 67 min) | 1.35 (81 min; build 60, merge 21) | about 1.37 |
| 44.11 step 8 part B (custom fields, rules from a sentence, product codes and stock), fourth revision | 3 sub-steps, 1 PR | 0.88 to 1.17 (53 to 70 min) | 1.58 (95 min; build 68, merge 27) | about 1.54 |

## The backlog estimates being tested (22 Nov 2026)

From the backlog review of 22 Nov 2026 (all open work / the parts that matter, in sessions).
Kept here unchanged so actuals can be compared with them.

| Item | All open | Matters | | Item | All open | Matters |
|---|---|---|---|---|---|---|
| 4 RBAC | 1 to 1.5 | 1 | | 30 Card machines | 9 to 14 | 2.5 |
| 5 Custom domains | 1 to 1.5 | 1 | | 31 Venue wizard | 3 | 1.5 |
| 6 Email loose ends | XS | XS | | 32 Invoices | 2 to 4 | 0.7 |
| 8 Test suite | 5 to 9 | 2 | | 33 Kiosk analytics | 3 to 4 | 1 |
| 9 More phone pages | 2 to 3 | 1 | | 34 Loyalty | 12 to 20 | 2.5 |
| 13 Sticky headers | XS | XS | | 35 Android app | 4 to 8 | 1.5 |
| 14 Web ordering | 12 to 17 | 3 | | 36 Stripe | 9 to 14 | 2.5 |
| 15 Pepper | 10 to 20 | 2.5 | | 37 Today | 1 | 0.5 |
| 16 Purchasing | 15 to 28 | 6.3 | | 38 Use level | 2 to 4 | 1 to 2 |
| 17 Loyverse | 2 | not code | | 39 Order flows | 5 to 7 | 2.5 |
| 18 POS | 18 to 35 | 6.5 | | 40 Menu entries | 4 to 6 | 0 |
| 19 Deliveroo file | 4 to 8 | 2 | | 41 Report builder | 8 to 15 | 2.5 |
| 20 GloriaFood | 3 to 5 | 1 | | 43 Local info | 4 to 6 | 1 |
| 21 Publishing | 4 to 7 | 3 | | 44 leftovers (1, 6, 8, 9) | about 5 | about 5 |
| 22 Menu screens | 5 to 7 | 1.5 | | 44.11 Pepper-first steps 0 to 8 | 32 to 55 | 0 to 4: about 20 |
| 23 Kitchen screens | 10 to 18 | 3.5 | | 45 Platform board | 2 to 4 | 1 |
| 24 Tax and types | 3 to 6 | 2.5 | | 46 Phase 3 worker | 1 to 2 | 0 |
| 25 Combos | 4 to 8 | 2.5 | | 47 Sales import | 16 to 24 | 1, 2, 4: about 10 |
| 26 Kiosks | 4 to 8 | 1.5 | | 48 Catalogues | 7 to 10 | 1 and 2: about 3 |
| 27 Installer | 3 | 1 | | | | |
| 28 New location | 2 | not code | | | | |
| 29 Kiosk previews | 2 | 0 | | | | |

Item 48's steps as estimated: 1: 1.5 to 2, 2: 1 to 2, 3: 1, 4: 2 to 3, 5: 1, 6: 1.

## What feature 48 says about the scale (22 Nov 2026)

- All six steps together: estimated 8.5 to 12 sessions (17 to 48 hours); actual 113 minutes from first tool call to the last merge, about 4 to 11% of the estimate. Build was 73 minutes of it, merging (CI and waiting) 40.
- Per step the build took 6 to 25 minutes; a merge 5 to 13 minutes, nearly all of it CI (about 5 minutes since CI runs in parallel parts).
- What made it fast: the design was written (`docs/CATALOGUE.md`), the decisions were taken first, the steps followed paths the code already had (tax inheritance, the release diff), and one agent kept the context from step to step. Steps were built while the previous one's CI ran.
- What cost time: one test that failed for a reason the plan didn't foresee (the smart builder's budget, 12 minutes), and the related test runs (2 to 5 minutes each).
- Not counted: the owner's review, a browser check of the editor and the till scan, a real barcode scanner.
- **Revised scale for the next planned feature** (a design written and decisions taken, one area, one agent): estimate each step in minutes, about 10 to 30 minutes to build plus about 6 minutes to merge; a step with a migration and a new table at the top of that range; double it for a step that touches something the plan didn't look at. Keep the old session scale for work with no design yet, or that needs live accounts or devices.

## Detail by step (from `scripts/session-timings.mjs`)

Model claude-opus-5-5 at high effort for every step. "Tools" is time inside tool calls (a test run,
a build, a wait), "model" the model's own time between them (reading results, deciding, writing the
next edit). Cost is estimated from each message's tokens at list prices; cached reads are most of it
(the session's context was about 550,000 tokens, re-read on every message).

| Step | Wall | Calls / messages | Tools by phase | Model | Changed (files, +lines) | Tokens out / cached read | Cost |
|---|---|---|---|---|---|---|---|
| 48.1 | 8.8 min | 38 / 69 | tests 4.0, builds 0.7, reading code 0.1 (18 calls), edits 0.1 (9) | 2.2 min | code 5 (+140), tests 2 (+128), docs 7 (+43), migration (+15) | 50k / 36M | about $9 |
| 48.2 | 13.8 min | 28 / 55 | tests 10.1 (one run of 65 files blocked 10 min in the foreground), builds 0.4 | 1.6 min | code 7 (+51), tests 2 (+61), docs 7 (+21) | 41k / 32M | about $8 |
| 48.3 | 6.0 min | 37 / 61 | waiting on background tests 1.3, tests 0.7, builds 0.6, reading 22 calls | 1.6 min | code 7 (+35), tests 1 (+17), docs 7 (+19) | 37k / 39M | about $9 |
| 48.4 | 11.7 min | 32 / 59 | waiting on background tests 6.3, tests 0.9, builds 0.4 | 2.1 min | code 8 (+260), tests 3 (+75), docs 8 (+33), migration (+28) | 60k / 40M | about $10 |
| 48.5 | 7.5 min | 26 / 40 | waiting on background tests 4.3, tests 0.5, builds 0.3 | 1.5 min | code 7 (+109), tests 2 (+43), docs 6 (+20), migration (+7) | 31k / 29M | about $7 |
| 48.6 | 25.5 min | 46 / 76 | finding and rerunning a failing test 8.1, waiting on background tests 9.6, waiting on 48.5's and its own CI 10.2 | 2.1 min | code 1 (+13), tests 1 (+26), docs 8 (+15) | 57k / 58M | about $13 |
| **48 whole** (18:00 to 19:36) | **96 min** | **233 / 406** | **tests 24.2, background waits 22.7, CI waits 20.3**, builds 2.3, pull requests 1.0, reading code 0.5 (88 calls), edits 0.5 (37 calls), git 0.3 | **12.6 min** | code 22 (+598), tests 4 (+350), docs and notes 18 (+201), migrations 3 (+50) | 323k / 263M | **about $62** |

### What was quick and what was slow

- **Writing the code was the smallest part.** Edits took 0.5 minutes of tool time over 37 calls,
  reading code 0.5 minutes over 88 calls, and the model's own time 12.6 minutes in all. About 70% of
  the 96 minutes was waiting: test runs (24 min), background test runs (23 min) and CI (20 min).
- **Quick: code that followed an existing path.** The type on menu, section and dish (48.1) copied
  the tax inheritance through the schema, the load, the tree save, the copy body and the release;
  the kitchen skip (48.3) was one flag set where lines are made and one filter where they're sent;
  the word (48.5) one shared rule used in four places. Each was 1.5 to 2 minutes of the model's time.
- **Quick: shared rules with unit tests.** `shared/catalogue.js` (types, barcodes, codes, words) was
  written and tested in seconds each; unit tests run in under a second.
- **Slow: finding a cause the plan didn't foresee.** 48.6 added three report fields in under a
  minute, then a smart builder test failed: the fields, linked into every subject that reaches dishes,
  pushed Dishes sold out of the builder's budget. Finding it took about 12 minutes (a debug print,
  then comparing the subjects listed in full with and without the change).
- **Slow: the broad test runs.** Running every related API test file after each step took 4 to 10
  minutes (36 to 65 files). Running them in the background while writing the docs hid most of it;
  48.2's run was started in the foreground and blocked the agent for 10 minutes.
- **Slow: CI.** About 5 to 6 minutes per pull request with the API tests in parallel parts. Steps
  2 to 6 were built while the previous step's CI ran, so most of it overlapped.
- **Expensive: a long session.** About $62 for the feature, most of it re-reading the session's
  context (about 550,000 tokens) on each of 406 messages. The same steps in a fresh agent with a
  small context would cost a fraction; the time would be about the same, since waiting dominates.

### What to change next time

- Start broad test runs in the background from the first one, and write the docs meanwhile.
- Run the smart builder test (`reports-smart.test.mjs`) whenever a report field is added to a
  subject many others link to.
- For cost, build a feature in a fresh agent (or a new session) that reads only the plan and the
  area notes, not in a session that already holds a day of context.

### 44.11 step 1 against the revised scale (22 Nov 2026)

- Estimated 80 to 130 minutes of build (the revised scale, with 1b doubled) plus 6 minutes a merge; actual 23 minutes of build and one 6-minute merge: about a quarter of the estimate. The revised scale was about 4 times too high, against about 16 times for the old one on feature 48.
- Built by a fresh agent (328 messages, 214 tool calls, 23 minutes): about $23 for the agent and $3 for the lead, about $26 in all. That is no cheaper per minute of build than feature 48's long session (the agent's own context grows as it reads: 77 million cached tokens read in 23 minutes), but it did more checking: 31 browser checks with Playwright, which feature 48 never had.
- Where the time went: the model's own time 12.1 minutes, reading code 2.5 minutes (116 calls), building and browser harness 1.4 minutes, tests 0.4 minutes. The agent ran only the related test files, in short runs, and waited on no long run.
- Slow parts named by the agent: page effects that overwrote the link's venue or day (found by reading, 1b), and choosing how many pages `open_page` offers once the shared ranking replaced its own scorer (1c).
- **Second revision of the scale:** for planned work in one area, about 5 to 10 minutes per sub-step to build, 10 to 20 where the plan doesn't look inside the code it changes, plus 6 minutes a pull request (one per feature where the steps can go together). Cost: about $5 to $10 per sub-step at this model and effort.

### 44.11 step 0 against the second revision (22 Nov 2026)

- Estimated 30 to 60 minutes of build (each sub-step doubled, because the plan names step 0 in one line) plus 6 for the pull request; actual 41 minutes of build, about 1.5 for a privacy fix before the pull request and 6.4 for it: 50 minutes against 36 to 66. **On the estimate** (about 97% of the midpoint): the first time the scale was right.
- By sub-step: 0a took 24 minutes against 10 to 20 (it needed a change to the report engine, `{me}`, that the plan didn't foresee); 0b 7 against 10 to 20; 0c 9 against 10 to 20, but its 27 tasks were written while 0a's and 0b's tests ran in the background, so its real work started earlier.
- Detail from the agent's own log (`--agent`): 432 messages, 279 tool calls; the model's own time 22.5 minutes, time in tools only 8.1 (tests ran in the background while it kept writing: 2.3 minutes of test calls in the foreground); 1,397 lines of code, 343 of tests, 295 of docs, 2 migrations. About $38 for the agent and $7.50 for the lead, about $46 in all.
- What the lead's review caught: a report on a person's own record could be scheduled or emailed, sending it to others (decision 8). The agent had noticed it and logged it as a limit; the lead fixed it before the pull request (1.5 minutes).
- **The scale stays** for planned work with a thin plan: 10 to 20 minutes a sub-step, plus 6 a pull request. A sub-step that needs a change to a shared engine (here the report engine) can take 25.

### 44.11 step 2 against the second revision (23 Nov 2026)

- Estimated 50 to 90 minutes of build (10 to 25 a sub-step) plus 6 for the pull request; actual 49 minutes of build and 29 for the pull request: 78 minutes against 56 to 96. **On the estimate overall** (about 103% of the midpoint), but for the wrong reason: the build came in under (70% of its midpoint) and the merge took almost five times its 6 minutes.
- By sub-step: 2a 13 against 10 to 20; 2b 7 against 15 to 25 (it assembled parts that existed); 2c 20 against 15 to 25 (browser checks on the bar's keys and the hand-over to Pepper); 2d 10 against 10 to 20.
- Detail from the agent's own log (`--agent`): 500 messages, 318 tool calls; the model's own time 23.6 minutes, time in tools 12.6 (5.5 of it waiting on its last test run); 1,269 lines of code added and 1,300 removed, 280 of tests, 469 of docs, 3 migrations. About $56 for the agent and $5.50 for the lead, about $62 in all: the dearest step so far, from the long reads of the shell and nav code (2a, 2c) at a large cached context.
- **Why the merge took 29 minutes.** The agent ran the tests near what it changed, not all of them; CI ran all of them and found two real gaps and two tests that only fail at midnight on a Monday (CI happened to run at 00:02 UTC on Monday 23 Nov):
  - real: the new `home_pins` table had no report decision (`reports-catalogue` test), and `tech-board`'s test replays migration 263, which names the launcher column 274 drops;
  - the date: the kiosk visits test made visits ten minutes ago (yesterday, just after midnight), and the weekly cash test's "yesterday" is last week's Sunday on a Monday, so last week had three days, not two.
  - The lead also lost 7 minutes to a local run without `--test-force-exit`, which never exits.
- **What to change:** a step that adds a table runs `reports-catalogue`; a step that drops a column searches the tests for it (`grep -l <column> api/test`, migration replays included). With those two the first CI run would have been the date flakes only. The scale stays: 10 to 20 minutes a sub-step (5 to 10 where it assembles existing parts), 6 a pull request, and budget about 10 more when the step removes things other tests may use.

### 44.11 step 3 against the second revision (23 Nov 2026)

- Estimated 70 to 125 minutes of build plus 6 to 16 for the pull request; actual 43 minutes of build (including a sub-step found on the way, the live-eval fixes), 5 for the hand-back and 7 for the pull request: 56 minutes, **about half the midpoint**.
- Every sub-step came in under its range: 3a 7 (10 to 15), 3b 7 (15 to 25), 3c 4 (10 to 20), 3d 7 (15 to 25), 3e 6 (20 to 40; written while 3d's tests ran). The docs and the browser check took 8, more than any one sub-step.
- **The merge took one CI run** (7 minutes against 29 last step): the agent added the fixture row and the report decision with the new table, and searched the tests for removed names, as the notes from step 2 now say.
- Cost: about $47 for the agent (the first reading and the docs are the dearest windows, $8 and $13), about $3 for the lead.
- **Third revision of the scale:** 5 to 10 minutes per sub-step where the code it builds on exists and the area notes are current, 10 to 20 where the plan doesn't look inside the code, plus 8 to 10 minutes for docs and checks per step, and 7 per pull request when the notes' test rules are followed.

### 44.11 step 4 against the third revision (23 Nov 2026)

- Estimated 75 to 127 minutes in all; actual 45: **about 45% of the midpoint**, the second step in a row at about half. Build 38 minutes (6 reading, 5, 7, 2, 4, then 14 for 4e with the full test run, the browser check and the docs), the pull request 7 with CI green first time.
- The sub-steps the plan described in one line took 2 to 7 minutes each, under even the third revision's 10 to 20. What still takes time: reading at the start (6 minutes, about $7), and the last window (tests over 42 files, a browser check, docs: 14 minutes, about $19).
- **Fourth revision of the scale, for planned Pepper-first steps on code this session knows:** 3 to 8 minutes a sub-step, plus 6 for reading, 12 to 15 for the full tests, browser check and docs, and 7 for the pull request. A step of five sub-steps is then about 45 minutes. Keep the third revision for an area the notes don't cover yet.

### 44.11 step 5 against the fourth revision (23 Nov 2026)

- Estimated 50 to 80 minutes in all; actual 63: **on the estimate (97% of the midpoint)**.
- Build 46.5: 5a took 18 (three tables and the feed applying them, with the reading) against 9 to 14; the other four 3 to 6 each, inside or under their ranges; tests, browser and docs 7.5 against 12 to 15.
- The pull request took 16 against 7: CI found two things the agent's 31 test files missed: a viewer could list Pepper's new task change tools on the staff connector (they sit in an open section; now they name their modules and need Use), and an access test that lists the feed's areas a person can't see needed the six new sources. Lesson for the brief: a new open-section change tool, and new feed sources, need `secrets-and-tokens` and `access-use-dashboards` in the run.
- The lead's review caught one rule break before the PR (View could snooze or skip where a module has no Use; now Manage, rule 5): from the brief's own wording.
- Cost about $45. **The fourth revision holds** for steps on code the notes cover; a sub-step that adds several tables and changes a shared feed is 10 to 15 minutes, not 3 to 8.

### 44.11 step 6 against the fourth revision (24 Nov 2026)

- Estimated 50 to 73 minutes in all; actual 61: **on the estimate (99% of the midpoint)**, the second in a row on the fourth revision.
- Build 41.5: 6a (auth, five tables) 18 against 16 to 21 with the reading; 6b 5, 6c 3, 6d 4, each at or under the low end; tests at two widths and docs 11.5.
- The pull request took 19 against 7: one CI run lost to a cash test that only fails on a Tuesday (yesterday is this week's Monday, already submitted by the test before), the third date flake in that file; and 1 minute of the lead's review keeping the Office app Android-only on expo.dev until the Apple account exists.
- The date flakes cost about 8 minutes a time. A whole-suite rule would be cheaper than fixing one a day: run the API tests at a fixed clock (a test helper that sets the venue's "today" to a mid-week noon) for any test that names days. Listed for infra.
- Cost about $55.

### 44.11 step 7 against the fourth revision (24 Nov 2026)

- Estimated 46 to 69 minutes in all; actual 50: **on the estimate (87% of the midpoint)**, the third in a row on the fourth revision. CI was green first time; the extra 4 minutes of the pull request were a second CI run for an evaluation task's wording.
- Build 35: reading 4, 7a 7, 7b 8 (half of it waiting on the sweep, with 7c written meanwhile), 7c about 5, 7d 3.5, tests, browser and docs 11.6. Cheapest step yet at about $32 in all: fewer, smaller files, and the agent overlapped writing with the sweep.
- **The scale has settled:** across steps 5 to 7 the fourth revision landed at 97%, 99% and 87% of its midpoint. Keep it, with 10 to 15 minutes for a sub-step that adds several tables or touches auth, and 8 minutes of slack when CI may hit a date-only test.

### 44.11 step 8 part A against the fourth revision (24 Nov 2026)

- Estimated 51 to 67 minutes; actual 81: **37% over the midpoint**, the first miss on the fourth revision.
- Where it went: 8A2 took 16 against 8 to 12 (54 fields' synonyms, instructions and examples written by hand: content, not code), and 8A3 took 27 against 8 to 12 plus the docs window (four routes' schemas exported, four existing pages moved onto the new renderer, and the full run of 551 tests). The plan said "a renderer"; the brief also asked to convert four forms, which is four page changes.
- The pull request took 21 against 7: CI was green at once, but the live evaluation (now part of every merge) found a real routing fault: Pepper asked the Help guide about a figure. One line in how_do_i's description fixed it (8 of 8 after).
- **For the scale:** a sub-step that converts existing pages to a new shared component costs 5 to 7 minutes a page, not one sub-step's 8 to 12; content written by hand (synonyms, examples, help) is about a minute per ten entries. A live evaluation run with a fix adds 10 minutes when it finds something.

### 44.11 step 8 part B against the fourth revision (24 Nov 2026)

- Estimated 53 to 70 minutes; actual 95: **54% over the midpoint**, the second miss in a row, both in step 8.
- Build 68 against 46 to 63: 8B1 20 and 8B2 19 against 10 to 15 each. Each touched four or more other areas (custom fields on four objects' routes, pages and tools; rule hooks in four areas' routes), and each added tables with RLS, fixtures and report decisions. 8B3 was on the estimate at 8.
- The pull request took 27 against 7: CI was green at once, but the live evaluation showed the new rule reader failed on every real model call (six system parts each marked for caching; the API takes four). The tests' stand-in model never checks that, and Pepper hid it by writing the rule itself through the tool's optional input. Fixed in `askForJson()` and the tool, then 32 of 32 live.
- **For the scale:** a sub-step that adds a feature across several other areas' routes and pages is 15 to 20 minutes, not 10 to 15; count it per area touched (about 4 each). A new model reader needs a live run before the pull request, not after: the stand-in can't catch request-shape errors.
- **The Pepper-first plan is complete** (steps 0 to 8, PRs #500 to #510).

